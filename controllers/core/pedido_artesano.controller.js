const { Op, QueryTypes, fn, col } = require('sequelize');
const sequelizeInit = require('../../configuration/db');
const CatalogoRutaPolloModel = require('../../models/core/tbl_catalogo_rutas_pollo.model');
const TiendaRutaPolloModel = require('../../models/core/tbl_tiendas_rutas_pollo.model');
const ClienteAvicolaModel = require('../../models/core/tbl_cliente_avicola.model');
const PedidoArtesanoModel = require('../../models/core/tbl_pedido_artesano.model');
const PedidoArtesanoDetalleModel = require('../../models/core/tbl_pedido_artesano_detalle.model');
const PedidoArtesanoHistorialModel = require('../../models/core/tbl_pedido_artesano_historial.model');
const PedidoArtesanoProductoModel = require('../../models/core/tbl_pedido_artesano_producto.model');
const { consultarStockPollo } = require('../../integrations/sap/sapClient');
const { nivelPermisoDeMenu, nombreDelUsuario } = require('../../services/permisosMenu.service');
const { parsearPaginacion, armarPaginacion } = require('../../services/paginacion.service');

// Menú (config.tbl_menu.nombre_menu) del pollo artesano. Cualquier nivel puede
// buscar pedidos; crear y modificar pedidos y clientes pide 'escritura'.
const MENU_ARTESANO = 'PedidosArtesanoView';

// Menú del rastro: autoriza, rechaza y (fase 3) despacha. 'lectura' consulta;
// autorizar y rechazar piden 'escritura'.
const MENU_RASTRO = 'AvicolaPedidosArtesanoView';

// Bodega de la que sale el pollo artesano y donde se consulta el stock.
const WHS_STOCK_ARTESANO = 'RAS-002';

// El nombre y la unidad de los productos se consultan en SAP (muelle Central).
const WHS_CONSULTA_PRODUCTOS = 'RAS-002';
const TTL_PRODUCTOS_MS = 10 * 60 * 1000;

const LIMITE_LISTADO = 1000;
const MAX_COMENTARIO = 500;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZONA_HORARIA = 'America/Guatemala';

const ESTADOS = ['CREADO', 'AUTORIZADO', 'RECHAZADO', 'CARGADO', 'ENTREGADO'];

class ErrorPedidoArtesano extends Error {
    constructor(status, mensaje) {
        super(mensaje);
        this.status = status;
    }
}

function responderError(res, error, mensajeGenerico) {
    if (error instanceof ErrorPedidoArtesano) {
        return res.status(error.status).json({ error: error.message, success: false });
    }

    return res.status(500).json({ error: mensajeGenerico, details: error.message, success: false });
}

async function exigirNivel(req, nivelesPermitidos, mensaje) {
    const nivel = await nivelPermisoDeMenu(req, MENU_ARTESANO);

    if (!nivel || !nivelesPermitidos.includes(nivel)) {
        throw new ErrorPedidoArtesano(403, mensaje);
    }
}

const exigirLectura = (req) => exigirNivel(req, ['lectura', 'lectura_division', 'escritura'], 'No tienes permiso para ver pedidos de pollo artesano');
const exigirEscritura = (req) => exigirNivel(req, ['escritura'], 'No tienes permiso para crear pedidos de pollo artesano');

async function exigirNivelRastro(req, nivelesPermitidos, mensaje) {
    const nivel = await nivelPermisoDeMenu(req, MENU_RASTRO);

    if (!nivel || !nivelesPermitidos.includes(nivel)) {
        throw new ErrorPedidoArtesano(403, mensaje);
    }
}

const exigirLecturaRastro = (req) => exigirNivelRastro(req, ['lectura', 'lectura_division', 'escritura'], 'No tienes permiso para ver los pedidos del rastro');
const exigirEscrituraRastro = (req) => exigirNivelRastro(req, ['escritura'], 'No tienes permiso para autorizar o rechazar pedidos de pollo artesano');

function fechaGuatemala(fecha) {
    return fecha ? new Date(fecha).toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA }) : null;
}

function validarId(id) {
    if (!id || !REGEX_UUID.test(id)) throw new ErrorPedidoArtesano(400, 'id de pedido inválido');
}

function textoOpcional(valor, maximo, nombreCampo) {
    const texto = String(valor ?? '').trim();

    if (texto.length > maximo) throw new ErrorPedidoArtesano(400, `${nombreCampo} no puede pasar de ${maximo} caracteres`);

    return texto || null;
}

function textoObligatorio(valor, maximo, nombreCampo) {
    const texto = textoOpcional(valor, maximo, nombreCampo);

    if (!texto) throw new ErrorPedidoArtesano(400, `${nombreCampo} es obligatorio`);

    return texto;
}

// ---------------------------------------------------------------------------
// Nombre y unidad de los productos (SAP), con caché corta por código.
// ---------------------------------------------------------------------------
const cacheProductos = new Map();

async function detalleProductos(codigos) {
    const pendientes = codigos.filter((c) => {
        const guardado = cacheProductos.get(c);
        return !guardado || guardado.expira <= Date.now();
    });

    if (pendientes.length > 0) {
        try {
            const productosSap = await consultarStockPollo(pendientes, WHS_CONSULTA_PRODUCTOS);

            productosSap.forEach((p) => cacheProductos.set(p.codigo_articulo, {
                descripcion: p.nombre_articulo,
                unidad: p.unidad_venta,
                expira: Date.now() + TTL_PRODUCTOS_MS
            }));
        } catch (error) {
            // Sin SAP se sigue con el código como descripción; el pedido no depende de eso.
            console.error('[PedidoArtesano] No se pudo consultar el nombre de los productos en SAP:', error.message);
        }
    }

    return new Map(codigos.map((c) => {
        const info = cacheProductos.get(c);

        return [c, { descripcion: info ? info.descripcion : c, unidad: info ? info.unidad : null }];
    }));
}

// Productos activos del catálogo, en el orden en que se muestran.
function productosHabilitados() {
    return PedidoArtesanoProductoModel.findAll({
        where: { activo: true },
        attributes: ['codigo_producto', 'orden', 'factor_caja', 'factor_libras'],
        order: [['orden', 'ASC'], ['codigo_producto', 'ASC']]
    });
}

async function codigosHabilitados() {
    const filas = await productosHabilitados();

    return filas.map(f => f.codigo_producto);
}

// ---------------------------------------------------------------------------
// Mapeos
// ---------------------------------------------------------------------------
function mapearCliente(c) {
    return { id: c.id, nombre: c.nombre, nit: c.nit, direccion: c.direccion, direccion_fisica: c.direccion_fisica, telefono: c.telefono };
}

function mapearHistorial(h) {
    return {
        estado_anterior: h.estado_anterior,
        estado_nuevo: h.estado_nuevo,
        usuario: h.usuario,
        comentario: h.comentario,
        fecha: new Date(h.fecha).toISOString()
    };
}

function mapearPedido(pedido) {
    const p = pedido.get({ plain: true });

    return {
        id: p.id,
        numero_pedido: p.numero_pedido,
        serie: p.serie,
        estado: p.estado,
        fecha_requerida: p.fecha_requerida,
        creado_en: fechaGuatemala(p.creado_en),
        creado_por: p.creado_por_nombre,
        ruta_id: p.ruta_id,
        nombre_ruta: p.nombre_ruta,
        codigo_tienda_referencia: p.codigo_tienda_referencia,
        nombre_tienda_referencia: p.nombre_tienda_referencia,
        cliente_id: p.cliente_id,
        cliente_nombre: p.cliente_nombre,
        cliente_nit: p.cliente_nit,
        direccion_entrega: p.direccion_entrega,
        telefono_contacto: p.telefono_contacto,
        condicion_pago: p.condicion_pago,
        numero_boleta: p.numero_boleta,
        comentario: p.comentario,
        motivo_rechazo: p.motivo_rechazo,
        autorizado_por: p.autorizado_por_nombre,
        fecha_autorizacion: fechaGuatemala(p.fecha_autorizacion),
        codigo_piloto: p.codigo_piloto ? Number(p.codigo_piloto) : null,
        nombre_piloto: p.nombre_piloto,
        cargado_por: p.cargado_por_nombre,
        fecha_carga: fechaGuatemala(p.fecha_carga),
        entregado_por: p.entregado_por_nombre,
        fecha_entrega: fechaGuatemala(p.fecha_entrega),
        items: [...(p.detalle || [])]
            .sort((a, b) => a.numero_linea - b.numero_linea)
            .map(d => ({
                codigo_producto: d.codigo_producto,
                descripcion_producto: d.descripcion_producto,
                unidad_medida: d.unidad_medida,
                cantidad: Number(d.cantidad),
                cantidad_autorizada: d.cantidad_autorizada === null || d.cantidad_autorizada === undefined ? null : Number(d.cantidad_autorizada)
            })),
        historial: [...(p.historial || [])]
            .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
            .map(mapearHistorial)
    };
}

function cargarPedido(id, transaction) {
    return PedidoArtesanoModel.findByPk(id, {
        include: [
            { model: PedidoArtesanoDetalleModel, as: 'detalle' },
            { model: PedidoArtesanoHistorialModel, as: 'historial' }
        ],
        transaction
    });
}

function registrarHistorial(pedidoId, estadoAnterior, estadoNuevo, usuario, comentario, transaction) {
    return PedidoArtesanoHistorialModel.create({
        pedido_id: pedidoId,
        estado_anterior: estadoAnterior,
        estado_nuevo: estadoNuevo,
        usuario,
        comentario,
        fecha: new Date()
    }, { transaction });
}

// ---------------------------------------------------------------------------
// Datos del pedido: validación común de crear y modificar
// ---------------------------------------------------------------------------

// Valida el cuerpo y resuelve ruta, cliente y tienda de referencia. Devuelve los
// datos ya limpios; lanza ErrorPedidoArtesano si algo no cuadra.
async function validarDatosPedido(body) {
    // El artesano no tiene la regla de las 4 pm: solo no se acepta una fecha pasada.
    const hoy = fechaGuatemala(new Date());

    if (!REGEX_FECHA.test(String(body.fecha_requerida || ''))) {
        throw new ErrorPedidoArtesano(400, 'fecha_requerida debe tener el formato YYYY-MM-DD');
    }

    if (body.fecha_requerida < hoy) throw new ErrorPedidoArtesano(400, 'La fecha requerida no puede ser anterior a hoy');

    if (!['DEPOSITO', 'PLANILLA'].includes(body.condicion_pago)) {
        throw new ErrorPedidoArtesano(400, "condicion_pago debe ser 'DEPOSITO' o 'PLANILLA'");
    }

    // La boleta del depósito es opcional por ahora; con descuento de planilla no aplica.
    const numeroBoleta = body.condicion_pago === 'DEPOSITO' ? textoOpcional(body.numero_boleta, 50, 'El número de boleta') : null;
    const direccionFisica = textoObligatorio(body.direccion_fisica, 250, 'La dirección de entrega');
    const telefono = textoOpcional(body.telefono_contacto, 30, 'El teléfono de contacto');
    const comentario = textoOpcional(body.comentario, MAX_COMENTARIO, 'El comentario');

    // El código de empleado del descuento de planilla se registra en las observaciones.
    if (body.condicion_pago === 'PLANILLA' && !comentario) {
        throw new ErrorPedidoArtesano(400, 'Con descuento de planilla, indica el código de empleado en las observaciones');
    }

    if (!Array.isArray(body.items) || body.items.length === 0) {
        throw new ErrorPedidoArtesano(400, 'Se requiere al menos un producto');
    }

    const codigos = body.items.map(i => String(i.codigo_producto || '').trim());

    if (new Set(codigos).size !== codigos.length) throw new ErrorPedidoArtesano(400, 'Hay productos repetidos');

    const habilitados = new Set(await codigosHabilitados());

    body.items.forEach((item, i) => {
        const cantidad = Number(item.cantidad);

        if (!habilitados.has(codigos[i])) throw new ErrorPedidoArtesano(400, `El producto ${codigos[i]} no está habilitado para pollo artesano`);
        if (!Number.isFinite(cantidad) || cantidad <= 0) throw new ErrorPedidoArtesano(400, `Cantidad inválida para ${codigos[i]}`);
    });

    const ruta = await CatalogoRutaPolloModel.findByPk(body.ruta_id);

    if (!ruta || !ruta.activo) throw new ErrorPedidoArtesano(400, 'La ruta no existe o no está activa');

    const cliente = await ClienteAvicolaModel.findByPk(body.cliente_id);

    if (!cliente || !cliente.vigente) throw new ErrorPedidoArtesano(400, 'El cliente no existe o no está vigente');

    // La tienda es solo la referencia de la ruta: tiene que estar asignada
    // a esa ruta (tbl_tiendas_rutas_pollo, asignación vigente).
    let tiendaReferencia = null;

    if (body.id_tienda_simphony_referencia) {
        tiendaReferencia = await TiendaRutaPolloModel.findOne({
            where: {
                ruta_id: ruta.id,
                id_tienda_simphony: String(body.id_tienda_simphony_referencia),
                fecha_fin_asignacion: null
            }
        });

        if (!tiendaReferencia) throw new ErrorPedidoArtesano(400, 'La tienda de referencia no pertenece a la ruta seleccionada');
    }

    return {
        fechaRequerida: body.fecha_requerida,
        condicionPago: body.condicion_pago,
        numeroBoleta,
        direccionFisica,
        telefono,
        comentario,
        items: body.items,
        codigos,
        ruta,
        cliente,
        tiendaReferencia
    };
}

// Columnas del encabezado que salen de los datos validados.
function camposEncabezado(d) {
    return {
        fecha_requerida: d.fechaRequerida,
        ruta_id: d.ruta.id,
        nombre_ruta: d.ruta.nombre_ruta,
        codigo_tienda_referencia: d.tiendaReferencia ? d.tiendaReferencia.id_tienda_simphony : null,
        // La columna es de 150 caracteres y el nombre en la asignación admite más.
        nombre_tienda_referencia: d.tiendaReferencia && d.tiendaReferencia.nombre_tienda
            ? d.tiendaReferencia.nombre_tienda.slice(0, 150)
            : null,
        cliente_id: d.cliente.id,
        cliente_nombre: d.cliente.nombre,
        cliente_nit: d.cliente.nit,
        direccion_entrega: d.direccionFisica,
        telefono_contacto: d.telefono,
        condicion_pago: d.condicionPago,
        numero_boleta: d.numeroBoleta,
        comentario: d.comentario
    };
}

function lineasPedido(pedidoId, d, detalles) {
    return d.items.map((item, i) => ({
        pedido_id: pedidoId,
        numero_linea: i + 1,
        codigo_producto: d.codigos[i],
        descripcion_producto: detalles.get(d.codigos[i]).descripcion,
        unidad_medida: detalles.get(d.codigos[i]).unidad,
        cantidad: Number(item.cantidad)
    }));
}

// La dirección y el teléfono que se capturaron quedan guardados en el cliente.
async function guardarDatosEntregaEnCliente(cliente, d, transaction) {
    const cambios = {};

    if (cliente.direccion_fisica !== d.direccionFisica) cambios.direccion_fisica = d.direccionFisica;
    if (d.telefono && cliente.telefono !== d.telefono) cambios.telefono = d.telefono;

    if (Object.keys(cambios).length > 0) {
        await cliente.update({ ...cambios, actualizado_en: new Date() }, { transaction });
    }
}

// Qué cambió al modificar un pedido, para dejarlo en el historial.
function resumenCambios(pedido, d, lineasAnteriores, lineasNuevas) {
    const nuevo = camposEncabezado(d);
    const etiquetas = [
        ['fecha_requerida', 'Fecha requerida'],
        ['nombre_ruta', 'Ruta'],
        ['nombre_tienda_referencia', 'Tienda de referencia'],
        ['cliente_nombre', 'Cliente'],
        ['direccion_entrega', 'Dirección de entrega'],
        ['telefono_contacto', 'Teléfono'],
        ['condicion_pago', 'Condición de pago'],
        ['numero_boleta', 'Boleta'],
        ['comentario', 'Comentario']
    ];

    const cambios = etiquetas
        .filter(([campo]) => (pedido[campo] ?? null) !== (nuevo[campo] ?? null))
        .map(([campo, etiqueta]) => `${etiqueta}: ${pedido[campo] ?? '—'} → ${nuevo[campo] ?? '—'}`);

    const antes = new Map(lineasAnteriores.map(l => [l.codigo_producto, Number(l.cantidad)]));
    const despues = new Map(lineasNuevas.map(l => [l.codigo_producto, l.cantidad]));

    for (const [codigo, cantidad] of despues) {
        if (!antes.has(codigo)) cambios.push(`Producto agregado: ${codigo} (${cantidad})`);
        else if (antes.get(codigo) !== cantidad) cambios.push(`${codigo}: ${antes.get(codigo)} → ${cantidad}`);
    }

    for (const codigo of antes.keys()) {
        if (!despues.has(codigo)) cambios.push(`Producto quitado: ${codigo}`);
    }

    return cambios.length > 0 ? `Pedido modificado — ${cambios.join('; ')}` : 'Pedido modificado';
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

// GET /pedidoArtesano/getProductos — productos habilitados para pedir.
async function getProductos(req, res) {
    try {
        await exigirLectura(req);

        const filas = await productosHabilitados();
        const detalles = await detalleProductos(filas.map(f => f.codigo_producto));

        const productos = filas
            .map(fila => ({
                codigo_producto: fila.codigo_producto,
                descripcion_producto: detalles.get(fila.codigo_producto).descripcion,
                unidad_medida: detalles.get(fila.codigo_producto).unidad || 'UND',
                orden: fila.orden,
                factor_caja: fila.factor_caja === null ? null : Number(fila.factor_caja),
                factor_libras: fila.factor_libras === null ? null : Number(fila.factor_libras)
            }))
            .sort((a, b) => a.orden - b.orden || a.descripcion_producto.localeCompare(b.descripcion_producto));

        return res.json({ success: true, productos });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los productos');
    }
}

// GET /pedidoArtesano/getUsuarios — usuarios que han creado pedidos, para el filtro.
async function getUsuarios(req, res) {
    try {
        await exigirLectura(req);

        const filas = await PedidoArtesanoModel.findAll({
            attributes: ['creado_por', 'creado_por_nombre', [fn('MAX', col('creado_en')), 'ultimo']],
            group: ['creado_por', 'creado_por_nombre'],
            raw: true
        });

        const porUsuario = new Map();

        // Si un usuario aparece con más de un nombre se queda el más reciente.
        for (const f of filas) {
            const id = String(f.creado_por);
            const actual = porUsuario.get(id);

            if (!actual || new Date(f.ultimo) > new Date(actual.ultimo)) {
                porUsuario.set(id, { id_usuario: id, nombre: f.creado_por_nombre, ultimo: f.ultimo });
            }
        }

        const usuarios = [...porUsuario.values()]
            .map(({ id_usuario, nombre }) => ({ id_usuario, nombre }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre));

        return res.json({ success: true, usuarios });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los usuarios');
    }
}

// GET /pedidoArtesano/getPedidos?id_usuario=&fecha_desde=&fecha_hasta=&estado=A,B&numero=
async function getPedidos(req, res) {
    try {
        await exigirLectura(req);

        const { id_usuario, fecha_desde, fecha_hasta, estado, numero } = req.query;
        const where = {};

        if (id_usuario) {
            if (!/^\d+$/.test(id_usuario)) throw new ErrorPedidoArtesano(400, 'id_usuario inválido');
            where.creado_por = id_usuario;
        }

        if ((fecha_desde && !REGEX_FECHA.test(fecha_desde)) || (fecha_hasta && !REGEX_FECHA.test(fecha_hasta))) {
            throw new ErrorPedidoArtesano(400, 'Las fechas deben tener el formato YYYY-MM-DD');
        }

        if (fecha_desde && fecha_hasta && fecha_desde > fecha_hasta) {
            throw new ErrorPedidoArtesano(400, 'fecha_desde no puede ser mayor que fecha_hasta');
        }

        if (fecha_desde || fecha_hasta) {
            where.fecha_requerida = {};
            if (fecha_desde) where.fecha_requerida[Op.gte] = fecha_desde;
            if (fecha_hasta) where.fecha_requerida[Op.lte] = fecha_hasta;
        }

        if (estado) {
            const estados = String(estado).split(',').map(e => e.trim()).filter(Boolean);

            if (estados.length === 0 || estados.some(e => !ESTADOS.includes(e))) {
                throw new ErrorPedidoArtesano(400, `estado inválido; los valores válidos son ${ESTADOS.join(', ')}`);
            }

            where.estado = { [Op.in]: estados };
        }

        const textoNumero = String(numero || '').trim().replace(/[%_]/g, '');

        if (textoNumero) where.numero_pedido = { [Op.iLike]: `%${textoNumero}%` };

        const solicitada = parsearPaginacion(req.query);
        const { page, pageSize, total, totalPages, offset } = armarPaginacion(
            await PedidoArtesanoModel.count({ where }),
            solicitada.page,
            solicitada.pageSize
        );

        const pedidos = await PedidoArtesanoModel.findAll({
            where,
            include: [
                { model: PedidoArtesanoDetalleModel, as: 'detalle' },
                { model: PedidoArtesanoHistorialModel, as: 'historial' }
            ],
            order: [['fecha_requerida', 'DESC'], ['numero_pedido', 'DESC']],
            limit: pageSize,
            offset
        });

        return res.json({
            success: true,
            pedidos: pedidos.map(mapearPedido),
            paginacion: { page, pageSize, total, totalPages }
        });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los pedidos de pollo artesano');
    }
}

// GET /pedidoArtesano/buscarClientes?texto=
async function buscarClientes(req, res) {
    try {
        await exigirLectura(req);

        const texto = String(req.query.texto || '').trim().replace(/[%_]/g, '');
        const where = { vigente: true };

        if (texto) {
            where[Op.or] = [
                { nombre: { [Op.iLike]: `%${texto}%` } },
                { nit: { [Op.iLike]: `%${texto}%` } }
            ];
        }

        const clientes = await ClienteAvicolaModel.findAll({ where, order: [['nombre', 'ASC']], limit: LIMITE_LISTADO });

        return res.json({ success: true, clientes: clientes.map(mapearCliente) });
    } catch (error) {
        return responderError(res, error, 'Error al buscar los clientes');
    }
}

// POST /pedidoArtesano/crearCliente  { nombre, nit, direccion, direccion_fisica, telefono }
async function crearCliente(req, res) {
    try {
        await exigirEscritura(req);

        const cliente = await ClienteAvicolaModel.create({
            nombre: textoObligatorio(req.body.nombre, 250, 'El nombre'),
            nit: textoOpcional(req.body.nit, 20, 'El NIT'),
            direccion: textoOpcional(req.body.direccion, 250, 'La dirección'),
            direccion_fisica: textoObligatorio(req.body.direccion_fisica, 250, 'La dirección de entrega'),
            telefono: textoOpcional(req.body.telefono, 30, 'El teléfono'),
            creado_por: req.user.id_usuario
        });

        return res.status(201).json({ success: true, cliente: mapearCliente(cliente) });
    } catch (error) {
        return responderError(res, error, 'Error al crear el cliente');
    }
}

// POST /pedidoArtesano/crearPedido
// { fecha_requerida, ruta_id, id_tienda_simphony_referencia?, cliente_id, direccion_fisica,
//   telefono_contacto?, condicion_pago, numero_boleta?, comentario?, items: [{ codigo_producto, cantidad }] }
async function crearPedido(req, res) {
    try {
        await exigirEscritura(req);

        const d = await validarDatosPedido(req.body);
        const [usuario, detalles] = await Promise.all([nombreDelUsuario(req), detalleProductos(d.codigos)]);
        const t = await sequelizeInit.sequelize.transaction();
        let idPedido;

        try {
            await guardarDatosEntregaEnCliente(d.cliente, d, t);

            const [{ nextval }] = await sequelizeInit.sequelize.query(
                "SELECT nextval('logistica.seq_pedido_artesano') AS nextval",
                { type: QueryTypes.SELECT, transaction: t }
            );

            const ahora = new Date();

            const pedido = await PedidoArtesanoModel.create({
                numero_pedido: `PA-${new Date().getFullYear()}-${String(nextval).padStart(6, '0')}`,
                ...camposEncabezado(d),
                estado: 'CREADO',
                creado_por: req.user.id_usuario,
                creado_por_nombre: usuario,
                creado_en: ahora,
                actualizado_en: ahora
            }, { transaction: t });

            await PedidoArtesanoDetalleModel.bulkCreate(lineasPedido(pedido.id, d, detalles), { transaction: t });
            await registrarHistorial(pedido.id, null, 'CREADO', usuario, 'Pedido creado', t);

            await t.commit();
            idPedido = pedido.id;
        } catch (error) {
            await t.rollback();
            throw error;
        }

        return res.status(201).json({ success: true, pedido: mapearPedido(await cargarPedido(idPedido)) });
    } catch (error) {
        return responderError(res, error, 'Error al crear el pedido de pollo artesano');
    }
}

// POST /pedidoArtesano/editarPedido  { id, ...mismos campos que crearPedido }
// Solo se puede modificar mientras el pedido está CREADO; una vez autorizado o
// rechazado ya no se toca.
async function editarPedido(req, res) {
    try {
        await exigirEscritura(req);

        const { id } = req.body;
        validarId(id);

        const d = await validarDatosPedido(req.body);
        const [usuario, detalles] = await Promise.all([nombreDelUsuario(req), detalleProductos(d.codigos)]);
        const t = await sequelizeInit.sequelize.transaction();

        try {
            const pedido = await PedidoArtesanoModel.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });

            if (!pedido) throw new ErrorPedidoArtesano(404, 'El pedido no existe');
            if (pedido.estado !== 'CREADO') throw new ErrorPedidoArtesano(409, 'Solo se puede modificar un pedido que está en estado CREADO');

            const lineasAnteriores = await PedidoArtesanoDetalleModel.findAll({ where: { pedido_id: id }, transaction: t });
            const lineasNuevas = lineasPedido(id, d, detalles);
            const comentarioHistorial = resumenCambios(pedido, d, lineasAnteriores, lineasNuevas);

            await guardarDatosEntregaEnCliente(d.cliente, d, t);

            const [actualizados] = await PedidoArtesanoModel.update(
                { ...camposEncabezado(d), actualizado_en: new Date() },
                { where: { id, estado: 'CREADO' }, transaction: t }
            );

            if (actualizados !== 1) throw new ErrorPedidoArtesano(409, 'El pedido cambió mientras lo modificabas, vuelve a cargarlo');

            await PedidoArtesanoDetalleModel.destroy({ where: { pedido_id: id }, transaction: t });
            await PedidoArtesanoDetalleModel.bulkCreate(lineasNuevas, { transaction: t });
            await registrarHistorial(id, 'CREADO', 'CREADO', usuario, comentarioHistorial, t);

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }

        return res.json({ success: true, pedido: mapearPedido(await cargarPedido(id)) });
    } catch (error) {
        return responderError(res, error, 'Error al modificar el pedido de pollo artesano');
    }
}

// ---------------------------------------------------------------------------
// Rastro: autorizar y rechazar
// ---------------------------------------------------------------------------

// Cambia el estado solo si nadie más lo cambió antes (dos personas del rastro no
// pueden resolver el mismo pedido) y deja el rastro en el historial.
async function cambiarEstado(pedido, estadosPermitidos, estadoNuevo, campos, usuario, comentario, transaction) {
    if (!estadosPermitidos.includes(pedido.estado)) {
        throw new ErrorPedidoArtesano(409, 'El pedido ya no está en un estado que permita esta acción');
    }

    const ahora = new Date();

    const [actualizados] = await PedidoArtesanoModel.update(
        { ...campos, estado: estadoNuevo, actualizado_en: ahora },
        { where: { id: pedido.id, estado: pedido.estado }, transaction }
    );

    if (actualizados !== 1) {
        throw new ErrorPedidoArtesano(409, 'El pedido cambió mientras lo procesabas, vuelve a cargarlo');
    }

    await registrarHistorial(pedido.id, pedido.estado, estadoNuevo, usuario, comentario, transaction);
}

// GET /pedidoArtesano/getPendientes?fecha_desde=&fecha_hasta=
// Pedidos CREADO por autorizar, los de entrega más próxima primero.
async function getPendientes(req, res) {
    try {
        await exigirLecturaRastro(req);

        const { fecha_desde, fecha_hasta } = req.query;

        if ((fecha_desde && !REGEX_FECHA.test(fecha_desde)) || (fecha_hasta && !REGEX_FECHA.test(fecha_hasta))) {
            throw new ErrorPedidoArtesano(400, 'Las fechas deben tener el formato YYYY-MM-DD');
        }

        if (fecha_desde && fecha_hasta && fecha_desde > fecha_hasta) {
            throw new ErrorPedidoArtesano(400, 'fecha_desde no puede ser mayor que fecha_hasta');
        }

        const where = { estado: 'CREADO' };

        if (fecha_desde || fecha_hasta) {
            where.fecha_requerida = {};
            if (fecha_desde) where.fecha_requerida[Op.gte] = fecha_desde;
            if (fecha_hasta) where.fecha_requerida[Op.lte] = fecha_hasta;
        }

        const pedidos = await PedidoArtesanoModel.findAll({
            where,
            include: [
                { model: PedidoArtesanoDetalleModel, as: 'detalle' },
                { model: PedidoArtesanoHistorialModel, as: 'historial' }
            ],
            order: [['fecha_requerida', 'ASC'], ['numero_pedido', 'ASC']],
            limit: LIMITE_LISTADO
        });

        return res.json({ success: true, pedidos: pedidos.map(mapearPedido) });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los pedidos por autorizar');
    }
}

// GET /pedidoArtesano/getStock
// Stock de la bodega del artesano para cada producto habilitado. Solo informativo:
// no reserva nada en SAP. Si SAP no responde, el front muestra "sin dato".
async function getStock(req, res) {
    try {
        await exigirLecturaRastro(req);

        const codigos = await codigosHabilitados();

        let stockSap;

        try {
            stockSap = await consultarStockPollo(codigos, WHS_STOCK_ARTESANO);
        } catch (error) {
            console.error('[PedidoArtesano] No se pudo consultar el stock en SAP:', error.message);

            return res.status(502).json({ error: 'Error al consultar el stock en SAP', details: error.message, success: false });
        }

        const porCodigo = new Map(stockSap.map(s => [s.codigo_articulo, s]));

        const stock = codigos.map((codigo) => {
            const info = porCodigo.get(codigo);

            return {
                codigo_producto: codigo,
                // Misma unidad en que se pide (unidad de venta completa).
                stock_disponible: info ? Number(info.bolsas_completas ?? info.stock_disponible) : 0,
                encontrado_en_sap: !!info
            };
        });

        return res.json({ success: true, whs_code: WHS_STOCK_ARTESANO, stock });
    } catch (error) {
        return responderError(res, error, 'Error al consultar el stock');
    }
}

function textoCantidad(n) {
    return String(Number(n));
}

// POST /pedidoArtesano/autorizar
// { id, items: [{ codigo_producto, cantidad_autorizada }], comentario? }
// Cada línea del pedido debe venir con lo que se autoriza (0 hasta lo solicitado);
// si es menos de lo pedido es una autorización parcial. Al menos una línea debe
// quedar con cantidad: si no se puede enviar nada, el pedido se rechaza.
async function autorizar(req, res) {
    try {
        await exigirEscrituraRastro(req);

        const { id } = req.body;
        validarId(id);

        const comentario = textoOpcional(req.body.comentario, MAX_COMENTARIO, 'La observación');

        if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
            throw new ErrorPedidoArtesano(400, 'Se requieren las cantidades a autorizar');
        }

        const usuario = await nombreDelUsuario(req);
        const t = await sequelizeInit.sequelize.transaction();

        try {
            const pedido = await PedidoArtesanoModel.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });

            if (!pedido) throw new ErrorPedidoArtesano(404, 'El pedido no existe');
            if (pedido.estado !== 'CREADO') throw new ErrorPedidoArtesano(409, 'El pedido ya no está en un estado que permita esta acción');

            const lineas = await PedidoArtesanoDetalleModel.findAll({ where: { pedido_id: id }, order: [['numero_linea', 'ASC']], transaction: t });
            const enviadas = new Map(req.body.items.map(i => [String(i.codigo_producto || '').trim(), i.cantidad_autorizada]));

            if (enviadas.size !== req.body.items.length || enviadas.size !== lineas.length) {
                throw new ErrorPedidoArtesano(400, 'Las cantidades deben cubrir cada producto del pedido, una sola vez');
            }

            const diferencias = [];
            let hayCantidad = false;

            for (const linea of lineas) {
                if (!enviadas.has(linea.codigo_producto)) {
                    throw new ErrorPedidoArtesano(400, `Falta la cantidad a autorizar de ${linea.codigo_producto}`);
                }

                const autorizada = Number(enviadas.get(linea.codigo_producto));
                const solicitada = Number(linea.cantidad);

                if (!Number.isFinite(autorizada) || autorizada < 0) {
                    throw new ErrorPedidoArtesano(400, `Cantidad inválida para ${linea.codigo_producto}`);
                }

                if (autorizada > solicitada) {
                    throw new ErrorPedidoArtesano(400, `No se puede autorizar más de lo solicitado en ${linea.codigo_producto} (${textoCantidad(solicitada)})`);
                }

                if (autorizada > 0) hayCantidad = true;
                if (autorizada < solicitada) diferencias.push(`${linea.codigo_producto}: ${textoCantidad(solicitada)} → ${textoCantidad(autorizada)}`);

                await linea.update({ cantidad_autorizada: autorizada }, { transaction: t });
            }

            if (!hayCantidad) throw new ErrorPedidoArtesano(400, 'No hay nada que autorizar: si no se puede enviar el pedido, recházalo con su motivo');

            const detalle = diferencias.length > 0 ? `Autorizado parcialmente — ${diferencias.join('; ')}` : 'Autorizado completo';

            await cambiarEstado(
                pedido,
                ['CREADO'],
                'AUTORIZADO',
                { autorizado_por: req.user.id_usuario, autorizado_por_nombre: usuario, fecha_autorizacion: new Date() },
                usuario,
                comentario ? `${detalle}. ${comentario}` : detalle,
                t
            );

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }

        return res.json({ success: true, pedido: mapearPedido(await cargarPedido(id)) });
    } catch (error) {
        return responderError(res, error, 'Error al autorizar el pedido');
    }
}

// POST /pedidoArtesano/rechazar  { id, motivo }
async function rechazar(req, res) {
    try {
        await exigirEscrituraRastro(req);

        const { id } = req.body;
        validarId(id);

        const motivo = textoObligatorio(req.body.motivo, MAX_COMENTARIO, 'El motivo del rechazo');

        if (motivo.length < 5) throw new ErrorPedidoArtesano(400, 'El motivo del rechazo es obligatorio (mínimo 5 caracteres)');

        const usuario = await nombreDelUsuario(req);
        const t = await sequelizeInit.sequelize.transaction();

        try {
            const pedido = await PedidoArtesanoModel.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });

            if (!pedido) throw new ErrorPedidoArtesano(404, 'El pedido no existe');

            await cambiarEstado(
                pedido,
                ['CREADO'],
                'RECHAZADO',
                { autorizado_por: req.user.id_usuario, autorizado_por_nombre: usuario, fecha_autorizacion: new Date(), motivo_rechazo: motivo },
                usuario,
                `Rechazado: ${motivo}`,
                t
            );

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }

        return res.json({ success: true, pedido: mapearPedido(await cargarPedido(id)) });
    } catch (error) {
        return responderError(res, error, 'Error al rechazar el pedido');
    }
}

module.exports = {
    getProductos,
    getUsuarios,
    getPedidos,
    buscarClientes,
    crearCliente,
    crearPedido,
    editarPedido,
    getPendientes,
    getStock,
    autorizar,
    rechazar
};
