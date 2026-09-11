const { Op } = require('sequelize');
const DespachoRutaModel = require('../../models/core/tbl_despacho_ruta.model');
const CatalogoRutaPolloModel = require('../../models/core/tbl_catalogo_rutas_pollo.model');
const CatalogoRutaInsumosModel = require('../../models/core/tbl_catalogo_rutas_insumos.model');
const UsuarioUbicacionLogModel = require('../../models/pioapp/usuario_ubicacion_logs.model');
const PedidoPosCabeceraModel = require('../../models/core/tbl_pedido_pos_cabecera.model');
const PedidoPosDetalleModel = require('../../models/core/tbl_pedido_pos_detalle.model');
const TrasladoCuartoFrioModel = require('../../models/core/tbl_traslados_cuarto_frio.model');
const EntregaProductoModel = require('../../models/core/tbl_entregas_producto.model');
const NotificacionDestinatarioModel = require('../../models/core/tbl_notificacion_destinatario.model');
const PilotoClienteSapModel = require('../../models/core/tbl_piloto_cliente_sap.model');
const { enviarCorreo } = require('../../integrations/notificaciones/mailClient');
const {
    consultarStockPollo,
    consultarStockInsumos,
    obtenerBodegasCuartoFrioPollo,
    obtenerBodegasCuartoFrioInsumos,
    crearTransferenciaPollo,
    crearTransferenciaInsumos,
    crearEntregaPollo,
    crearEntregaInsumos
} = require('../../integrations/sap/sapClient');

const CONTEXTO_NOTIFICACION_ENTREGA = {
    POLLO: 'ENTREGA_PRODUCTO_POLLO',
    INSUMOS: 'ENTREGA_PRODUCTO_INSUMOS'
};
const TIPOS_INSUMOS_Y_ACTIVO_FIJO = ['INSUMOS', 'ACTIVO_FIJO'];

DespachoRutaModel.belongsTo(CatalogoRutaPolloModel, { foreignKey: 'ruta_id', as: 'rutaPollo' });
DespachoRutaModel.belongsTo(CatalogoRutaInsumosModel, { foreignKey: 'ruta_id', as: 'rutaInsumos' });

const CATALOGO_POR_TIPO = {
    POLLO: { model: CatalogoRutaPolloModel, as: 'rutaPollo' },
    INSUMOS: { model: CatalogoRutaInsumosModel, as: 'rutaInsumos' }
};

// Trae la última posición reportada (por fecha_hora) de cada piloto en
// pilotoIds, en un solo query contra PIOAPP. latitud/longitud vienen como
// varchar en la tabla, por eso se parsean a número acá; si algún registro
// viene corrupto (no numérico) se descarta esa posición para ese piloto.
async function obtenerUltimasUbicaciones(pilotoIds) {
    if (pilotoIds.length === 0) return new Map();

    const registros = await UsuarioUbicacionLogModel.findAll({
        where: { id_usuario: { [Op.in]: pilotoIds } },
        order: [['id_usuario', 'ASC'], ['fecha_hora', 'DESC']]
    });

    const ubicacionPorPiloto = new Map();

    for (const registro of registros) {
        if (ubicacionPorPiloto.has(registro.id_usuario)) continue;

        const lat = Number(registro.latitud);
        const lng = Number(registro.longitud);

        if (isNaN(lat) || isNaN(lng)) continue;

        ubicacionPorPiloto.set(registro.id_usuario, {
            lat,
            lng,
            fecha_ubicacion: registro.fecha_hora
        });
    }

    return ubicacionPorPiloto;
}

// Rutas con despacho asignado (piloto + camión) para una fecha dada,
// de un solo tipo (POLLO o INSUMOS) a la vez — un usuario nunca ve ambos
// tipos juntos en "Camiones en Ruta". El include con required:true actúa
// como filtro: si el ruta_id del despacho no existe en el catálogo de ese
// tipo, la fila queda fuera (INNER JOIN).
async function getRutasActivas(req, res) {
    const { tipo, fecha } = req.query;
    const catalogo = CATALOGO_POR_TIPO[tipo];
    if (!catalogo) {
        return res.status(400).json({ error: "tipo debe ser 'POLLO' o 'INSUMOS'", success: false });
    }

    const fechaConsulta = fecha || new Date().toISOString().slice(0, 10);

    try {
        const despachos = await DespachoRutaModel.findAll({
            where: { fecha: fechaConsulta },
            include: [{
                model: catalogo.model,
                as: catalogo.as,
                required: true,
                where: { activo: true },
                attributes: ['id', 'nombre_ruta', 'whs_code_origen', 'whs_code_destino']
            }],
            order: [[{ model: catalogo.model, as: catalogo.as }, 'nombre_ruta', 'ASC']]
        });

        const pilotoIds = [...new Set(despachos.map(d => d.piloto_id))];
        const ubicacionPorPiloto = await obtenerUltimasUbicaciones(pilotoIds);
        const rutas = despachos.map(d => {
            const info = d[catalogo.as];
            const ubicacion = ubicacionPorPiloto.get(d.piloto_id) || null;

            return {
                ruta_id: d.ruta_id,
                nombre_ruta: info.nombre_ruta,
                whs_code_origen: info.whs_code_origen,
                whs_code_destino: info.whs_code_destino,
                fecha: d.fecha,
                camion_id: d.camion_id,
                camion_placa: d.camion_placa,
                piloto_id: d.piloto_id,
                piloto_nombre: d.piloto_nombre,
                piloto_lat: ubicacion ? ubicacion.lat : null,
                piloto_lng: ubicacion ? ubicacion.lng : null,
                piloto_fecha_ubicacion: ubicacion ? ubicacion.fecha_ubicacion : null
            };
        });

        return res.json({ success: true, tipo, fecha: fechaConsulta, rutas });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener las rutas activas',
            details: error.message,
            success: false
        });
    }
}

// SAP no soporta consultar "todos los artículos con stock en un WhsCode"
// de un solo golpe (probado: ni el filtro any(), ni $expand con filtro
// anidado — el Service Layer de este SAP los rechaza). En su lugar, se
// obtienen los códigos candidatos desde lo que Core ya sabe que se cargó a
// esa ruta (tbl_pedidos_pos_detalle, vía la cabecera con ese ruta_id +
// fecha) y luego se consulta el stock real de esos códigos puntuales en el
// WhsCode del camión, igual que ya hace consultarStockPollo/Insumos.
async function obtenerCodigosCandidatos(tipo, rutaId, fecha) {
    const where = {
        ruta_id: rutaId,
        fecha_requerida: fecha,
        tipo_pedido: tipo === 'POLLO' ? 'POLLO' : { [Op.in]: TIPOS_INSUMOS_Y_ACTIVO_FIJO }
    };

    const cabeceras = await PedidoPosCabeceraModel.findAll({ where, attributes: ['id'] });
    const idsPedidos = cabeceras.map(c => c.id);

    if (idsPedidos.length === 0) return new Map();

    const detalles = await PedidoPosDetalleModel.findAll({
        where: {
            pedido_id: { [Op.in]: idsPedidos },
            codigo_producto: { [Op.ne]: null }
        },
        attributes: ['codigo_producto', 'unidad_medida', 'descripcion_producto']
    });

    const candidatos = new Map();
    for (const d of detalles) {
        if (!candidatos.has(d.codigo_producto)) {
            candidatos.set(d.codigo_producto, {
                unidad_medida: d.unidad_medida || 'UND',
                descripcion_producto: d.descripcion_producto
            });
        }
    }

    return candidatos;
}

// Inventario (solo artículos con stock > 0) del WhsCode del camión de
// una ruta, consultado en vivo a SAP. tipo determina qué base de SAP
// consultar (AVIGUA para pollo, la fija de insumos para insumos).
async function getInventarioCamion(req, res) {
    const { tipo, ruta_id, whs_code, fecha } = req.query;

    if (!tipo || !['POLLO', 'INSUMOS'].includes(tipo)) {
        return res.status(400).json({ error: "tipo debe ser 'POLLO' o 'INSUMOS'", success: false });
    }

    if (!ruta_id || !whs_code) {
        return res.status(400).json({ error: 'ruta_id y whs_code son requeridos', success: false });
    }

    const fechaConsulta = fecha || new Date().toISOString().slice(0, 10);

    try {
        const candidatos = await obtenerCodigosCandidatos(tipo, ruta_id, fechaConsulta);
        const codigos = [...candidatos.keys()];
        const stock = codigos.length === 0
            ? []
            : tipo === 'POLLO'
                ? await consultarStockPollo(codigos, whs_code)
                : await consultarStockInsumos(codigos, whs_code);

        const inventario = stock
            .map(s => {
                const info = candidatos.get(s.codigo_articulo);

                // bolsas_completas convierte de la Unidad de Inventario a la
                // Unidad de Venta (Pollo e Insumos); si el artículo no trajera
                // el dato por alguna razón, cae al stock crudo. Se devuelven
                // ambos valores (crudo y convertido) para que la vista pueda
                // mostrar las dos referencias.
                return {
                    codigo_producto: s.codigo_articulo,
                    nombre_producto: s.nombre_articulo || info?.descripcion_producto || s.codigo_articulo,
                    unidad_medida: info?.unidad_medida || 'UND',
                    cantidad: Number(s.bolsas_completas ?? s.stock_disponible),
                    stock_libras: Number(s.stock_disponible),
                    unidad_venta: s.unidad_venta || null,
                    unidad_inventario: s.unidad_inventario || null
                };
            })
            // Si el sobrante en la unidad de inventario no completa ni una
            // unidad de venta (ej. 3 libras sobrantes con factor 5), no hay
            // nada entregable de ese artículo — se oculta.
            .filter(item => item.cantidad > 0);

        return res.json({ success: true, whs_code, inventario });
    } catch (error) {
        return res.status(502).json({
            error: 'Error al consultar el inventario en SAP',
            details: error.message,
            success: false
        });
    }
}

// Detalle por tienda (pedido vs. entregado) de una ruta+fecha. Es
// puramente informativo — no lo tocan los botones de trasladar/entregar.
// El estado que se muestra por tienda es el mismo cabecera.estado de Core,
// que va cambiando de dueño según la etapa: RECIBIDO/VALIDADO los pone Core
// al ingerir/validar el pedido, EN_TRANSITO lo pone Core al enviarlo a SAP,
// y ENTREGADO/ENTREGADO_PARCIAL los pone la app móvil cuando la TIENDA
// confirma la recepción física — no se deriva de cantidad_recibida, esa
// columna es aparte (informativa, por línea).
async function getDetalleTiendas(req, res) {
    const { tipo, ruta_id, fecha } = req.query;

    if (!tipo || !['POLLO', 'INSUMOS'].includes(tipo)) {
        return res.status(400).json({ error: "tipo debe ser 'POLLO' o 'INSUMOS'", success: false });
    }

    if (!ruta_id) {
        return res.status(400).json({ error: 'ruta_id es requerido', success: false });
    }

    const fechaConsulta = fecha || new Date().toISOString().slice(0, 10);

    try {
        const cabeceras = await PedidoPosCabeceraModel.findAll({
            where: {
                ruta_id,
                fecha_requerida: fechaConsulta,
                tipo_pedido: tipo === 'POLLO' ? 'POLLO' : { [Op.in]: TIPOS_INSUMOS_Y_ACTIVO_FIJO }
            },
            attributes: ['id', 'codigo_tienda', 'nombre_tienda', 'estado'],
            order: [['nombre_tienda', 'ASC']]
        });

        const idsPedidos = cabeceras.map(c => c.id);
        const detalles = idsPedidos.length === 0 ? [] : await PedidoPosDetalleModel.findAll({
            where: { pedido_id: { [Op.in]: idsPedidos } },
            attributes: [
                'pedido_id',
                'codigo_producto',
                'descripcion_producto',
                'unidad_medida',
                'cantidad_solicitada',
                'cantidad_recibida'
            ],
            order: [['numero_linea', 'ASC']]
        });

        const detallesPorPedido = new Map();
        for (const d of detalles) {
            if (!detallesPorPedido.has(d.pedido_id)) detallesPorPedido.set(d.pedido_id, []);
            detallesPorPedido.get(d.pedido_id).push(d);
        }

        const tiendas = cabeceras.map(c => {
            const lineas = detallesPorPedido.get(c.id) || [];

            const productos = lineas.map(l => ({
                codigo_producto: l.codigo_producto,
                nombre_producto: l.descripcion_producto,
                unidad_medida: l.unidad_medida || 'UND',
                cantidad_solicitada: Number(l.cantidad_solicitada),
                cantidad_recibida: l.cantidad_recibida === null ? null : Number(l.cantidad_recibida)
            }));

            return {
                codigo_tienda: c.codigo_tienda,
                nombre_tienda: c.nombre_tienda,
                estado: c.estado,
                productos
            };
        });

        return res.json({ success: true, tiendas });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener el detalle por tienda',
            details: error.message,
            success: false
        });
    }
}

// Bodegas de cuarto frío disponibles (WhsCode que empieza con "CFR-"),
// para el dropdown del botón "Trasladar a Cuarto Frío". Se consulta a SAP
// solo cuando el usuario le da clic a ese botón, no antes.
async function getBodegasCuartoFrio(req, res) {
    const { tipo } = req.query;

    if (!tipo || !['POLLO', 'INSUMOS'].includes(tipo)) {
        return res.status(400).json({ error: "tipo debe ser 'POLLO' o 'INSUMOS'", success: false });
    }

    try {
        const bodegas = tipo === 'POLLO'
            ? await obtenerBodegasCuartoFrioPollo()
            : await obtenerBodegasCuartoFrioInsumos();

        return res.json({ success: true, bodegas });
    } catch (error) {
        return res.status(502).json({
            error: 'Error al consultar las bodegas de cuarto frío en SAP',
            details: error.message,
            success: false
        });
    }
}

// Ejecuta la transferencia real en SAP (camión -> cuarto frío) con
// crearTransferenciaPollo/Insumos (las mismas que ya usa el flujo bodega ->
// camión), y guarda un registro del traslado en Core para el historial.
// Si SAP confirma la transferencia pero falla el guardado en Core, igual se
// responde success:true (con un aviso) — no tiene sentido decirle al
// usuario que falló algo que en SAP ya se hizo.
async function trasladarACuartoFrio(req, res) {
    const {
        tipo,
        ruta_id,
        nombre_ruta,
        fecha,
        whs_origen,
        whs_destino,
        camion_placa,
        piloto_id,
        piloto_nombre,
        lineas
    } = req.body;

    const usuario_registro = (req.user && (req.user.nombre || req.user.id_usuario)) || null;

    if (!tipo || !['POLLO', 'INSUMOS'].includes(tipo)) {
        return res.status(400).json({ error: "tipo debe ser 'POLLO' o 'INSUMOS'", success: false });
    }

    if (!ruta_id || !whs_origen || !whs_destino) {
        return res.status(400).json({ error: 'ruta_id, whs_origen y whs_destino son requeridos', success: false });
    }

    if (!whs_destino.startsWith('CFR-')) {
        return res.status(400).json({ error: 'whs_destino debe ser una bodega de cuarto frío (CFR-...)', success: false });
    }

    if (!Array.isArray(lineas) || lineas.length === 0) {
        return res.status(400).json({ error: 'Se requiere al menos una línea para trasladar', success: false });
    }

    let resultadoSap;

    try {
        // A diferencia de enviarTransferenciaPollo/Insumos y de
        // entregarProducto, aquí la cantidad que manda el frontend ya es la
        // que se debe mover tal cual — no se convierte ni se multiplica por
        // sales_items_per_unit.
        const lineasSap = lineas.map(l => ({ codigo_producto: l.codigo_producto, cantidad: l.cantidad }));

        const comentarios = `Traslado a cuarto frío - ruta ${nombre_ruta || ruta_id}`;

        resultadoSap = tipo === 'POLLO'
            ? await crearTransferenciaPollo({ fromWarehouse: whs_origen, toWarehouse: whs_destino, lineas: lineasSap, comentarios })
            : await crearTransferenciaInsumos({ fromWarehouse: whs_origen, toWarehouse: whs_destino, lineas: lineasSap, comentarios });
    } catch (sapError) {
        return res.status(502).json({
            error: 'SAP rechazó la transferencia',
            details: sapError.message,
            success: false
        });
    }

    try {
        const registro = await TrasladoCuartoFrioModel.create({
            tipo_pedido: tipo,
            ruta_id,
            nombre_ruta: nombre_ruta || null,
            fecha: fecha || new Date().toISOString().slice(0, 10),
            whs_origen,
            whs_destino,
            camion_placa: camion_placa || null,
            piloto_id: piloto_id || null,
            piloto_nombre: piloto_nombre || null,
            usuario_registro,
            sap_docentry: resultadoSap.DocEntry,
            sap_docnum: resultadoSap.DocNum,
            lineas
        });

        return res.json({
            success: true,
            traslado_id: registro.id,
            sap_docentry: resultadoSap.DocEntry,
            sap_docnum: resultadoSap.DocNum
        });
    } catch (dbError) {
        return res.json({
            success: true,
            warning: 'La transferencia se hizo en SAP pero no se pudo guardar el registro en Core',
            details: dbError.message,
            sap_docentry: resultadoSap.DocEntry,
            sap_docnum: resultadoSap.DocNum
        });
    }
}

// Historial de traslados a cuarto frío. Filtra opcionalmente por
// fecha; siempre por tipo (un usuario nunca ve Pollo e Insumos mezclados).
async function getTrasladosCuartoFrio(req, res) {
    const { tipo, fecha } = req.query;

    if (!tipo || !['POLLO', 'INSUMOS'].includes(tipo)) {
        return res.status(400).json({ error: "tipo debe ser 'POLLO' o 'INSUMOS'", success: false });
    }

    const where = { tipo_pedido: tipo };
    if (fecha) where.fecha = fecha;

    try {
        const traslados = await TrasladoCuartoFrioModel.findAll({
            where,
            order: [['creado_en', 'DESC']],
            limit: 200
        });

        return res.json({ success: true, traslados });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener el historial de traslados',
            details: error.message,
            success: false
        });
    }
}

// Historial de entregas de producto (piloto como CardCode). Mismo criterio
// que getTrasladosCuartoFrio — pensado para alimentar un futuro dashboard
// de cuánto se entrega vs. cuánto se traslada a cuarto frío por ruta/piloto.
async function getEntregasProducto(req, res) {
    const { tipo, fecha } = req.query;

    if (!tipo || !['POLLO', 'INSUMOS'].includes(tipo)) {
        return res.status(400).json({ error: "tipo debe ser 'POLLO' o 'INSUMOS'", success: false });
    }

    const where = { tipo_pedido: tipo };
    if (fecha) where.fecha = fecha;

    try {
        const entregas = await EntregaProductoModel.findAll({
            where,
            order: [['creado_en', 'DESC']],
            limit: 200
        });

        return res.json({ success: true, entregas });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener el historial de entregas',
            details: error.message,
            success: false
        });
    }
}

// Arma el HTML del correo de aviso de "Entregar Producto".
function construirCorreoEntrega({ tipo, nombreRuta, whsCodeRuta, camionPlaca, pilotoNombre, fecha, lineas, usuarioNombre, usuarioEmail, sapDocnum, cardCode }) {
    const filasLineas = lineas.map(l =>
        `<tr><td>${l.codigo_producto}</td><td>${l.nombre_producto}</td><td style="text-align:right">${l.cantidad} ${l.unidad_medida}</td></tr>`
    ).join('');

    return `
        <h2>Entrega de producto registrada</h2>
        <p>Se confirmó una entrega de producto desde el camión de la ruta <strong>${nombreRuta}</strong> (${tipo}).</p>
        <p>
            <strong>Camión:</strong> ${camionPlaca || '—'}<br>
            <strong>Piloto:</strong> ${pilotoNombre || '—'} (cliente SAP ${cardCode})<br>
            <strong>WhsCode origen:</strong> ${whsCodeRuta}<br>
            <strong>Documento SAP:</strong> ${sapDocnum ?? '—'}<br>
            <strong>Fecha:</strong> ${fecha}<br>
            <strong>Registrado por:</strong> ${usuarioNombre || '—'}${usuarioEmail ? ` (${usuarioEmail})` : ''}
        </p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
            <thead>
                <tr><th>Código</th><th>Producto</th><th>Cantidad</th></tr>
            </thead>
            <tbody>
                ${filasLineas}
            </tbody>
        </table>
    `;
}

// Ejecuta la entrega real en SAP (Deliveries, con el piloto como
// CardCode) y, SOLO si SAP la confirma, envía el correo de aviso a los
// destinatarios del contexto correspondiente + el usuario que hizo el
// registro. Si SAP rechaza la entrega, no se manda ningún correo.
async function entregarProducto(req, res) {
    const { tipo, ruta_id, nombre_ruta, whs_code_ruta, camion_placa, piloto_id, piloto_nombre, fecha, lineas } = req.body;
    const usuario_registro = (req.user && (req.user.nombre || req.user.id_usuario)) || null;

    if (!tipo || !['POLLO', 'INSUMOS'].includes(tipo)) {
        return res.status(400).json({ error: "tipo debe ser 'POLLO' o 'INSUMOS'", success: false });
    }

    if (!piloto_id || !whs_code_ruta) {
        return res.status(400).json({ error: 'piloto_id y whs_code_ruta son requeridos', success: false });
    }

    if (!Array.isArray(lineas) || lineas.length === 0) {
        return res.status(400).json({ error: 'Se requiere al menos una línea para entregar', success: false });
    }

    const asignacion = await PilotoClienteSapModel.findOne({ where: { piloto_id, tipo } });

    if (!asignacion) {
        return res.status(400).json({
            error: `El piloto ${piloto_nombre || piloto_id} no tiene un cliente SAP asignado para ${tipo}. Configúralo en "Pilotos — Cliente SAP" antes de entregar.`,
            success: false
        });
    }

    let resultadoSap;

    try {
        let lineasSap = lineas.map(l => ({ codigo_producto: l.codigo_producto, cantidad: l.cantidad }));

        // Igual que en trasladarACuartoFrio: las cantidades llegan en bolsas
        // (Unidad de Venta), la entrega en SAP se mueve en libras (Unidad de
        // Inventario) — se convierte re-consultando SAP, sin confiar en el cliente.
        {
            const codigos = lineasSap.map(l => l.codigo_producto);
            const stockInfo = tipo === 'POLLO'
                ? await consultarStockPollo(codigos, whs_code_ruta)
                : await consultarStockInsumos(codigos, whs_code_ruta);
            const factorPorCodigo = new Map(stockInfo.map(s => [s.codigo_articulo, s.sales_items_per_unit || 1]));

            lineasSap = lineasSap.map(l => ({
                ...l,
                cantidad: Number(l.cantidad) * (factorPorCodigo.get(l.codigo_producto) || 1)
            }));
        }

        const comentarios = `Entrega de producto - ruta ${nombre_ruta || ruta_id}`;

        resultadoSap = tipo === 'POLLO'
            ? await crearEntregaPollo({ cardCode: asignacion.card_code, whsCode: whs_code_ruta, lineas: lineasSap, comentarios })
            : await crearEntregaInsumos({ cardCode: asignacion.card_code, whsCode: whs_code_ruta, lineas: lineasSap, comentarios });
    } catch (sapError) {
        return res.status(502).json({
            error: 'SAP rechazó la entrega',
            details: sapError.message,
            success: false
        });
    }

    // A partir de aquí la entrega YA se hizo en SAP — que falle el registro
    // en Core o el correo no debe hacer parecer que la entrega falló.
    const advertencias = [];

    try {
        await EntregaProductoModel.create({
            tipo_pedido: tipo,
            ruta_id,
            nombre_ruta: nombre_ruta || null,
            fecha: fecha || new Date().toISOString().slice(0, 10),
            whs_code_ruta,
            camion_placa: camion_placa || null,
            piloto_id: piloto_id || null,
            piloto_nombre: piloto_nombre || null,
            card_code: asignacion.card_code,
            usuario_registro,
            sap_docentry: resultadoSap.DocEntry,
            sap_docnum: resultadoSap.DocNum,
            lineas
        });
    } catch (dbError) {
        advertencias.push(`no se pudo guardar el registro de la entrega en Core: ${dbError.message}`);
    }

    try {
        const destinatarios = await NotificacionDestinatarioModel.findAll({
            where: { contexto: CONTEXTO_NOTIFICACION_ENTREGA[tipo], activo: true },
            attributes: ['email']
        });

        const correos = new Set(destinatarios.map(d => d.email).filter(Boolean));

        if (req.user && req.user.email_office) {
            correos.add(req.user.email_office);
        }

        if (correos.size > 0) {
            const bodyHtml = construirCorreoEntrega({
                tipo,
                nombreRuta: nombre_ruta || '—',
                whsCodeRuta: whs_code_ruta,
                camionPlaca: camion_placa,
                pilotoNombre: piloto_nombre,
                fecha: fecha || new Date().toISOString().slice(0, 10),
                lineas,
                usuarioNombre: req.user && req.user.nombre,
                usuarioEmail: req.user && req.user.email_office,
                sapDocnum: resultadoSap.DocNum,
                cardCode: asignacion.card_code
            });

            // El servicio de notificaciones solo acepta 'PIOAPP', 'ALISA' o
            // 'AVICOLA' como emisor — no 'CORE'. Pollo usa AVICOLA, insumos ALISA.
            await enviarCorreo({
                emisor: tipo === 'POLLO' ? 'AVICOLA' : 'ALISA',
                emailReceptor: [...correos],
                asunto: `Entrega de producto — ${nombre_ruta || tipo}`,
                bodyHtml
            });
        }

        return res.json({
            success: true,
            sap_docentry: resultadoSap.DocEntry,
            sap_docnum: resultadoSap.DocNum,
            notificados: [...correos],
            warning: advertencias.length > 0
                ? `La entrega se hizo en SAP (doc. ${resultadoSap.DocNum}), pero ${advertencias.join('; ')}`
                : undefined
        });
    } catch (correoError) {
        advertencias.push(`falló el envío del correo: ${correoError.message}`);

        return res.json({
            success: true,
            sap_docentry: resultadoSap.DocEntry,
            sap_docnum: resultadoSap.DocNum,
            warning: `La entrega se hizo en SAP (doc. ${resultadoSap.DocNum}), pero ${advertencias.join('; ')}`
        });
    }
}

module.exports = {
    getRutasActivas,
    getInventarioCamion,
    getDetalleTiendas,
    getBodegasCuartoFrio,
    trasladarACuartoFrio,
    getTrasladosCuartoFrio,
    entregarProducto,
    getEntregasProducto
};