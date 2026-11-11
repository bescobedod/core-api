const { Op, QueryTypes, fn, col } = require('sequelize');
const sequelizeInit = require('../../configuration/db');
const CatalogoRutaPolloModel = require('../../models/core/tbl_catalogo_rutas_pollo.model');
const TiendaRutaPolloModel = require('../../models/core/tbl_tiendas_rutas_pollo.model');
const ClienteAvicolaModel = require('../../models/core/tbl_cliente_avicola.model');
const UsersModel = require('../../models/pioapp/users.model');
const ClienteAvicolaPrecioModel = require('../../models/core/tbl_cliente_avicola_precio.model');
const PedidoArtesanoModel = require('../../models/core/tbl_pedido_artesano.model');
const PedidoArtesanoDetalleModel = require('../../models/core/tbl_pedido_artesano_detalle.model');
const PedidoArtesanoHistorialModel = require('../../models/core/tbl_pedido_artesano_historial.model');
const PedidoArtesanoProductoModel = require('../../models/core/tbl_pedido_artesano_producto.model');
const { consultarStockPollo, crearTransferenciaPollo, crearEntregaArtesano } = require('../../integrations/sap/sapClient');
const { nivelPermisoDeMenu, nombreCortoDelUsuario } = require('../../services/permisosMenu.service');
const { parsearPaginacion, armarPaginacion } = require('../../services/paginacion.service');
const crypto = require('crypto');
const path = require('path');
const { generarPdfEnvios } = require('../../services/pedidoArtesanoPdf');
const { acortarNombre } = require('../../services/nombres.service');
const { enviarExcelPedidosArtesano } = require('../../services/pedidoArtesanoReportes');
const { uploadBufferToS3, getPresignedUrl, deleteFromS3 } = require('../../integrations/aws/s3');
const { upload } = require('../../middlewares/upload');

// Menú (config.tbl_menu.nombre_menu) del pollo artesano. Cualquier nivel puede
// buscar pedidos; crear y modificar pedidos y clientes pide 'escritura'.
const MENU_ARTESANO = 'PedidosArtesanoView';

// Menú del rastro: carga (autorizando total o parcialmente), rechaza y entrega.
// 'lectura' consulta; cargar, rechazar y entregar piden 'escritura'.
const MENU_RASTRO = 'AvicolaPedidosArtesanoView';

// Bodega de la que sale el pollo artesano y donde se consulta el stock.
const WHS_STOCK_ARTESANO = 'RAS-002';

// Evidencia de entrega (foto o PDF de la hoja firmada) en el mismo bucket que usan las
// demás evidencias; en la base solo se guarda la llave y la URL se firma al pedirla.
const PREFIJO_EVIDENCIA = 'logistica/pedido_artesano/entrega';
const EXPIRA_URL_EVIDENCIA_SEG = 3600;
const LIMITE_EXPORTACION = 5000;

// Máximo de pedidos que se cargan o imprimen en una sola operación.
const MAX_PEDIDOS_LOTE = 100;

// El nombre y la unidad de los productos se consultan en SAP (muelle Central).
const WHS_CONSULTA_PRODUCTOS = 'RAS-002';
const TTL_PRODUCTOS_MS = 10 * 60 * 1000;

const LIMITE_LISTADO = 1000;
const MAX_COMENTARIO = 500;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZONA_HORARIA = 'America/Guatemala';

// Estados: CREADO, CARGADO, ENTREGADO y RECHAZADO. Cargar incluye la autorización.
const ESTADOS = ['CREADO', 'RECHAZADO', 'CARGADO', 'ENTREGADO'];

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

// Ver pedidos y su constancia: sirve tener cualquiera de los dos menús (Pollo Artesano o el del rastro).
async function exigirLecturaPedidos(req) {
    const niveles = ['lectura', 'lectura_division', 'escritura'];
    const [artesano, rastro] = await Promise.all([nivelPermisoDeMenu(req, MENU_ARTESANO), nivelPermisoDeMenu(req, MENU_RASTRO)]);

    if (!niveles.includes(artesano) && !niveles.includes(rastro)) {
        throw new ErrorPedidoArtesano(403, 'No tienes permiso para ver pedidos de pollo artesano');
    }
}

const exigirLecturaRastro = (req) => exigirNivelRastro(req, ['lectura', 'lectura_division', 'escritura'], 'No tienes permiso para ver los pedidos del rastro');
const exigirEscrituraRastro = (req) => exigirNivelRastro(req, ['escritura'], 'No tienes permiso para cargar o rechazar pedidos de pollo artesano');

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

// Nombre y unidad de los productos (SAP), con caché corta por código.
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

// Mapeos
function mapearCliente(c) {
    return { id: c.id, nombre: c.nombre, nit: c.nit, direccion: c.direccion, telefono: c.telefono, codigo_empleado: c.codigo_empleado, card_code: c.card_code };
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
        creado_por: acortarNombre(p.creado_por_nombre),
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
        rechazado_por: p.rechazado_por_nombre ? acortarNombre(p.rechazado_por_nombre) : null,
        fecha_rechazo: fechaGuatemala(p.fecha_rechazo),
        codigo_piloto: p.codigo_piloto ? Number(p.codigo_piloto) : null,
        nombre_piloto: p.nombre_piloto ? acortarNombre(p.nombre_piloto) : null,
        cargado_por: p.cargado_por_nombre ? acortarNombre(p.cargado_por_nombre) : null,
        fecha_carga: fechaGuatemala(p.fecha_carga),
        entregado_por: p.entregado_por_nombre ? acortarNombre(p.entregado_por_nombre) : null,
        fecha_entrega: fechaGuatemala(p.fecha_entrega),
        tiene_evidencia_entrega: !!p.evidencia_entrega_key,
        // Documentos de SAP.
        sap_traslado_docnum: p.sap_traslado_docnum,
        sap_entrega_docnum: p.sap_entrega_docnum,
        // Versión del pedido: el rastro la devuelve al cargar para detectar cambios hechos mientras tanto.
        actualizado_en: new Date(p.actualizado_en).toISOString(),
        items: [...(p.detalle || [])]
            .sort((a, b) => a.numero_linea - b.numero_linea)
            .map(d => ({
                codigo_producto: d.codigo_producto,
                descripcion_producto: d.descripcion_producto,
                unidad_medida: d.unidad_medida,
                cantidad: Number(d.cantidad),
                precio_unitario: d.precio_unitario === null || d.precio_unitario === undefined ? null : Number(d.precio_unitario),
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

// Datos del pedido: validación común de crear y modificar

// Precio por cliente: el propio, o el de colaborador o tercero. Sin precio no se puede pedir.
async function resolverPrecios(cliente, codigos) {
    const [productos, propios] = await Promise.all([
        PedidoArtesanoProductoModel.findAll({ where: { codigo_producto: { [Op.in]: codigos } } }),
        ClienteAvicolaPrecioModel.findAll({ where: { cliente_id: cliente.id, codigo_producto: { [Op.in]: codigos } } })
    ]);

    const porCodigo = new Map(productos.map(p => [p.codigo_producto, p]));
    const especiales = new Map(propios.map(p => [p.codigo_producto, Number(p.precio)]));
    const esColaborador = !!cliente.codigo_empleado;

    return new Map(codigos.map((codigo) => {
        if (especiales.has(codigo)) return [codigo, especiales.get(codigo)];

        const producto = porCodigo.get(codigo);
        const precio = producto ? (esColaborador ? producto.precio_colaborador : producto.precio_tercero) : null;

        if (precio === null || precio === undefined) {
            throw new ErrorPedidoArtesano(
                400,
                esColaborador ? `El producto ${codigo} no se vende a colaboradores` : `El producto ${codigo} no tiene precio configurado`
            );
        }

        return [codigo, Number(precio)];
    }));
}

// Valida el cuerpo y resuelve ruta, cliente y tienda de referencia.
async function validarDatosPedido(body) {
    // El artesano no tiene la regla de las 4 pm: solo no se acepta una fecha pasada.
    const hoy = fechaGuatemala(new Date());

    if (!REGEX_FECHA.test(String(body.fecha_requerida || ''))) {
        throw new ErrorPedidoArtesano(400, 'fecha_requerida debe tener el formato YYYY-MM-DD');
    }

    if (body.fecha_requerida < hoy) throw new ErrorPedidoArtesano(400, 'La fecha requerida no puede ser anterior a hoy');

    if (!['DEPOSITO', 'PLANILLA', 'PENDIENTE'].includes(body.condicion_pago)) {
        throw new ErrorPedidoArtesano(400, "condicion_pago debe ser 'DEPOSITO', 'PLANILLA' o 'PENDIENTE'");
    }

    // La boleta del depósito es opcional por ahora; con descuento de planilla o pago pendiente no aplica.
    const numeroBoleta = body.condicion_pago === 'DEPOSITO' ? textoOpcional(body.numero_boleta, 50, 'El número de boleta') : null;
    // La dirección es obligatoria salvo para los empleados (se valida al tener el cliente).
    const direccion = textoOpcional(body.direccion, 250, 'La dirección de entrega');
    const telefono = textoOpcional(body.telefono_contacto, 30, 'El teléfono de contacto');
    const comentario = textoOpcional(body.comentario, MAX_COMENTARIO, 'El comentario');


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

    // Los empleados no tienen dirección de entrega; los demás clientes sí.
    if (!direccion && !cliente.codigo_empleado) throw new ErrorPedidoArtesano(400, 'La dirección de entrega es obligatoria');

    const precios = await resolverPrecios(cliente, codigos);

    // El descuento de planilla es solo para empleados: clientes con código de empleado.
    if (body.condicion_pago === 'PLANILLA' && !cliente.codigo_empleado) {
        throw new ErrorPedidoArtesano(400, 'El descuento de planilla es solo para clientes con código de empleado');
    }

    // La tienda de referencia debe estar asignada a la ruta (asignación vigente).
    if (!body.id_tienda_simphony_referencia) throw new ErrorPedidoArtesano(400, 'La tienda de referencia es obligatoria');

    const tiendaReferencia = await TiendaRutaPolloModel.findOne({
        where: {
            ruta_id: ruta.id,
            id_tienda_simphony: String(body.id_tienda_simphony_referencia),
            fecha_fin_asignacion: null
        }
    });

    if (!tiendaReferencia) throw new ErrorPedidoArtesano(400, 'La tienda de referencia no pertenece a la ruta seleccionada');

    return {
        fechaRequerida: body.fecha_requerida,
        condicionPago: body.condicion_pago,
        numeroBoleta,
        direccion,
        telefono,
        comentario,
        items: body.items,
        codigos,
        precios,
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
        direccion_entrega: d.direccion,
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
        cantidad: Number(item.cantidad),
        precio_unitario: d.precios.get(d.codigos[i])
    }));
}

// La dirección y el teléfono que se capturaron quedan guardados en el cliente.
async function guardarDatosEntregaEnCliente(cliente, d, transaction) {
    const cambios = {};

    if (d.direccion && cliente.direccion !== d.direccion) cambios.direccion = d.direccion;
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

// Endpoints

// GET /pedidoArtesano/getProductos: productos habilitados para pedir.
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

// GET /pedidoArtesano/getUsuarios: usuarios que han creado pedidos, para el filtro.
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

// Filtros de la búsqueda de pedidos: usuario, estado(s), número y fechas de entrega requerida.
function construirWhereBusqueda(query) {
    const { id_usuario, fecha_desde, fecha_hasta, estado, numero } = query;
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

    return where;
}

// GET /pedidoArtesano/getPedidos?id_usuario=&fecha_desde=&fecha_hasta=&estado=A,B&numero=
async function getPedidos(req, res) {
    try {
        await exigirLectura(req);

        const where = construirWhereBusqueda(req.query);
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

function describirFiltrosBusqueda(query) {
    const partes = [];

    if (query.fecha_desde || query.fecha_hasta) {
        partes.push(`Entrega requerida: ${query.fecha_desde || '…'} a ${query.fecha_hasta || '…'}`);
    }

    if (query.estado) partes.push(`Estado: ${String(query.estado).split(',').map(e => e.trim()).join(', ')}`);
    if (query.numero) partes.push(`Número: ${String(query.numero).trim()}`);
    if (query.id_usuario) partes.push(`Usuario (id): ${query.id_usuario}`);

    return partes.length > 0 ? `Filtros — ${partes.join(' · ')}` : 'Sin filtros';
}

// GET /pedidoArtesano/exportarPedidos?...mismos filtros que getPedidos
// Excel con una fila por línea de producto de cada pedido encontrado.
async function exportarPedidos(req, res) {
    try {
        await exigirLectura(req);

        const where = construirWhereBusqueda(req.query);
        const total = await PedidoArtesanoModel.count({ where });

        if (total === 0) throw new ErrorPedidoArtesano(404, 'No hay pedidos para los filtros seleccionados');

        const [pedidos, productos] = await Promise.all([
            PedidoArtesanoModel.findAll({
                where,
                include: [{ model: PedidoArtesanoDetalleModel, as: 'detalle' }],
                order: [['fecha_requerida', 'DESC'], ['numero_pedido', 'DESC']],
                limit: LIMITE_EXPORTACION
            }),
            PedidoArtesanoProductoModel.findAll()
        ]);

        const marcaDeTiempo = new Date().toISOString().slice(0, 10);

        return await enviarExcelPedidosArtesano(
            res,
            {
                pedidos: pedidos.map(p => p.get({ plain: true })),
                total,
                descripcionFiltros: describirFiltrosBusqueda(req.query),
                productos: productos.map(p => p.get({ plain: true }))
            },
            `pollo_artesano_${marcaDeTiempo}.xlsx`
        );
    } catch (error) {
        if (res.headersSent) return res.end();

        return responderError(res, error, 'Error al exportar los pedidos de pollo artesano');
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

// POST /pedidoArtesano/crearCliente  { nombre, nit, direccion, telefono, codigo_empleado? }
// La dirección es obligatoria salvo que se indique el código de empleado.
async function crearCliente(req, res) {
    try {
        await exigirEscritura(req);

        const codigoEmpleado = textoOpcional(req.body.codigo_empleado, 20, 'El código de empleado');
        const direccion = textoOpcional(req.body.direccion, 250, 'La dirección de entrega');

        if (!direccion && !codigoEmpleado) throw new ErrorPedidoArtesano(400, 'La dirección de entrega es obligatoria');

        const cliente = await ClienteAvicolaModel.create({
            nombre: textoObligatorio(req.body.nombre, 250, 'El nombre'),
            nit: textoOpcional(req.body.nit, 20, 'El NIT'),
            direccion,
            codigo_empleado: codigoEmpleado,
            card_code: textoOpcional(req.body.card_code, 20, 'El código de cliente SAP'),
            telefono: textoOpcional(req.body.telefono, 30, 'El teléfono'),
            creado_por: req.user.id_usuario
        });

        return res.status(201).json({ success: true, cliente: mapearCliente(cliente) });
    } catch (error) {
        return responderError(res, error, 'Error al crear el cliente');
    }
}

// POST /pedidoArtesano/crearPedido
// { fecha_requerida, ruta_id, id_tienda_simphony_referencia, cliente_id, direccion?,
//   telefono_contacto?, condicion_pago, numero_boleta?, comentario?, items: [{ codigo_producto, cantidad }] }
async function crearPedido(req, res) {
    try {
        await exigirEscritura(req);

        const d = await validarDatosPedido(req.body);
        const [usuario, detalles] = await Promise.all([nombreCortoDelUsuario(req), detalleProductos(d.codigos)]);
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

// POST /pedidoArtesano/completarPago { id, condicion_pago, numero_boleta? }
// Registra el pago de un pedido PENDIENTE sin tocar actualizado_en. Queda en el historial.
async function completarPago(req, res) {
    try {
        await exigirEscritura(req);

        const { id } = req.body;
        validarId(id);

        if (!['DEPOSITO', 'PLANILLA'].includes(req.body.condicion_pago)) {
            throw new ErrorPedidoArtesano(400, "condicion_pago debe ser 'DEPOSITO' o 'PLANILLA'");
        }

        const condicion = req.body.condicion_pago;
        const numeroBoleta = condicion === 'DEPOSITO' ? textoOpcional(req.body.numero_boleta, 50, 'El número de boleta') : null;
        const usuario = await nombreDelUsuario(req);
        const t = await sequelizeInit.sequelize.transaction();

        try {
            const pedido = await PedidoArtesanoModel.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });

            if (!pedido) throw new ErrorPedidoArtesano(404, 'El pedido no existe');
            if (pedido.estado === 'RECHAZADO') throw new ErrorPedidoArtesano(409, 'Un pedido rechazado no tiene pago que completar');
            if (pedido.condicion_pago !== 'PENDIENTE') throw new ErrorPedidoArtesano(409, 'El pago de este pedido ya está registrado');

            if (condicion === 'PLANILLA') {
                const cliente = await ClienteAvicolaModel.findByPk(pedido.cliente_id, { transaction: t });

                if (!cliente || !cliente.codigo_empleado) {
                    throw new ErrorPedidoArtesano(400, 'El descuento de planilla es solo para clientes con código de empleado');
                }
            }

            await pedido.update({ condicion_pago: condicion, numero_boleta: numeroBoleta }, { transaction: t });

            const detalle = condicion === 'DEPOSITO'
                ? `Depósito${numeroBoleta ? ` (boleta ${numeroBoleta})` : ' (sin boleta)'}`
                : 'Descuento de planilla';

            await registrarHistorial(id, pedido.estado, pedido.estado, usuario, `Pago completado — ${detalle}`, t);
            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }

        return res.json({ success: true, pedido: mapearPedido(await cargarPedido(id)) });
    } catch (error) {
        return responderError(res, error, 'Error al completar el pago del pedido');
    }
}

// POST /pedidoArtesano/editarPedido { id, ...campos de crearPedido }
// Solo se modifica mientras el pedido está CREADO.
async function editarPedido(req, res) {
    try {
        await exigirEscritura(req);

        const { id } = req.body;
        validarId(id);

        const d = await validarDatosPedido(req.body);
        const [usuario, detalles] = await Promise.all([nombreCortoDelUsuario(req), detalleProductos(d.codigos)]);
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

// Rastro: rechazar

// Cambia el estado solo si nadie lo cambió antes y deja el rastro en el historial.
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

// GET /pedidoArtesano/getPendientes?estado=CREADO|CARGADO&fecha_desde=&fecha_hasta=
// Pedidos del rastro por estado (por defecto CREADO), los de entrega más próxima primero.
async function getPendientes(req, res) {
    try {
        await exigirLecturaRastro(req);

        const { fecha_desde, fecha_hasta } = req.query;
        const estado = req.query.estado || 'CREADO';

        if (!['CREADO', 'CARGADO'].includes(estado)) {
            throw new ErrorPedidoArtesano(400, 'estado debe ser CREADO o CARGADO');
        }

        if ((fecha_desde && !REGEX_FECHA.test(fecha_desde)) || (fecha_hasta && !REGEX_FECHA.test(fecha_hasta))) {
            throw new ErrorPedidoArtesano(400, 'Las fechas deben tener el formato YYYY-MM-DD');
        }

        if (fecha_desde && fecha_hasta && fecha_desde > fecha_hasta) {
            throw new ErrorPedidoArtesano(400, 'fecha_desde no puede ser mayor que fecha_hasta');
        }

        const where = { estado };

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
        return responderError(res, error, 'Error al obtener los pedidos');
    }
}

// GET /pedidoArtesano/getStock
// Stock de la bodega del artesano por producto. Solo informativo.
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

// POST /pedidoArtesano/rechazar  { id, motivo }
async function rechazar(req, res) {
    try {
        await exigirEscrituraRastro(req);

        const { id } = req.body;
        validarId(id);

        const motivo = textoObligatorio(req.body.motivo, MAX_COMENTARIO, 'El motivo del rechazo');

        if (motivo.length < 5) throw new ErrorPedidoArtesano(400, 'El motivo del rechazo es obligatorio (mínimo 5 caracteres)');

        const usuario = await nombreCortoDelUsuario(req);
        const t = await sequelizeInit.sequelize.transaction();

        try {
            const pedido = await PedidoArtesanoModel.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });

            if (!pedido) throw new ErrorPedidoArtesano(404, 'El pedido no existe');

            await cambiarEstado(
                pedido,
                ['CREADO'],
                'RECHAZADO',
                { rechazado_por: req.user.id_usuario, rechazado_por_nombre: usuario, fecha_rechazo: new Date(), motivo_rechazo: motivo },
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

// Rastro: carga, piloto y PDF

// Los pilotos son los usuarios de PioApp con rol 1, igual que en los demás pedidos.
const ROL_PILOTO = 1;

async function consultarPilotos() {
    const usuarios = await UsersModel.findAll({ where: { id_rol: ROL_PILOTO }, attributes: ['id_users', 'first_name', 'first_last_name'], raw: true });
    const primera = (texto) => String(texto || '').trim().split(/\s+/)[0];

    return usuarios
        .map(u => ({ codigo: Number(u.id_users), nombre: `${primera(u.first_name)} ${primera(u.first_last_name)}`.trim() }))
        .filter(p => p.nombre !== '')
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// El nombre del piloto lo pone el servidor a partir del código; no se confía en el del cliente.
async function resolverPiloto(codigo) {
    if (codigo === null || codigo === undefined || codigo === '') throw new ErrorPedidoArtesano(400, 'Debe seleccionar el piloto');

    const numero = Number(codigo);

    if (!Number.isInteger(numero) || numero <= 0) throw new ErrorPedidoArtesano(400, 'Piloto inválido');

    const piloto = (await consultarPilotos()).find(p => p.codigo === numero);

    if (!piloto) throw new ErrorPedidoArtesano(400, 'El piloto no existe');

    return piloto;
}

function validarIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) throw new ErrorPedidoArtesano(400, 'Se requiere al menos un pedido');
    if (ids.length > MAX_PEDIDOS_LOTE) throw new ErrorPedidoArtesano(400, `Máximo ${MAX_PEDIDOS_LOTE} pedidos por operación`);

    ids.forEach(validarId);

    if (new Set(ids).size !== ids.length) throw new ErrorPedidoArtesano(400, 'Hay pedidos repetidos');
}

// GET /pedidoArtesano/getPilotos: pilotos que se pueden asignar.
async function getPilotos(req, res) {
    try {
        await exigirLecturaRastro(req);

        return res.json({ success: true, pilotos: await consultarPilotos() });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los pilotos');
    }
}

// Valida las cantidades a cargar de un pedido (pueden ser menores a lo solicitado) y las guarda en cada línea.
// Devuelve lo que se recortó, para el historial.
async function fijarCantidadesACargar(pedido, lineas, ajuste, transaction) {
    const enviadas = ajuste ? new Map(ajuste.map(i => [String(i.codigo_producto || '').trim(), i.cantidad])) : null;

    if (enviadas && (enviadas.size !== ajuste.length || enviadas.size !== lineas.length)) {
        throw new ErrorPedidoArtesano(400, `Las cantidades del pedido ${pedido.numero_pedido} deben cubrir cada producto, una sola vez`);
    }

    const diferencias = [];
    let hayCantidad = false;

    for (const linea of lineas) {
        const solicitada = Number(linea.cantidad);
        let aCargar = solicitada;

        if (enviadas) {
            if (!enviadas.has(linea.codigo_producto)) {
                throw new ErrorPedidoArtesano(400, `Falta la cantidad de ${linea.codigo_producto} en el pedido ${pedido.numero_pedido}`);
            }

            aCargar = Number(enviadas.get(linea.codigo_producto));

            if (!Number.isFinite(aCargar) || aCargar < 0) {
                throw new ErrorPedidoArtesano(400, `Cantidad inválida para ${linea.codigo_producto} en el pedido ${pedido.numero_pedido}`);
            }

            if (aCargar > solicitada) {
                throw new ErrorPedidoArtesano(400, `No se puede cargar más de lo solicitado en ${linea.codigo_producto} (${textoCantidad(solicitada)})`);
            }
        }

        if (aCargar > 0) hayCantidad = true;
        if (aCargar < solicitada) diferencias.push(`${linea.codigo_producto}: ${textoCantidad(solicitada)} → ${textoCantidad(aCargar)}`);

        await linea.update({ cantidad_autorizada: aCargar }, { transaction });
    }

    if (!hayCantidad) {
        throw new ErrorPedidoArtesano(400, `No hay nada que cargar en el pedido ${pedido.numero_pedido}: si no se puede enviar, recházalo con su motivo`);
    }

    return diferencias;
}

// SAP: transferencia al cargar y entrega al entregar

// Error de SAP: el usuario ve un mensaje genérico y el detalle se guarda en el pedido.
class ErrorSapArtesano extends ErrorPedidoArtesano {
    constructor(detalle) {
        super(502, 'No se pudo completar en SAP');
        this.detalle = detalle;
    }
}

// Los precios de Core incluyen IVA y las listas de AVIGUA no. Se manda el precio dividido entre 1.12.
const TASA_IVA = 0.12;

const redondear = (valor, decimales = 6) => Number(Number(valor).toFixed(decimales));

// Unidades de SAP por unidad del pedido: factor de SAP por unidades_sap del producto.
// Si SAP no tiene el artículo se corta.
async function factoresDeSap(codigos, whsCode) {
    let info;

    try {
        info = await consultarStockPollo(codigos, whsCode);
    } catch (error) {
        throw new ErrorSapArtesano(`No se pudo consultar los artículos en SAP: ${error.message}`);
    }

    const porSap = new Map(info.map(i => [i.codigo_articulo, Number(i.sales_items_per_unit) || 1]));
    const faltantes = codigos.filter(c => !porSap.has(c));

    if (faltantes.length > 0) throw new ErrorSapArtesano(`SAP no tiene el artículo ${faltantes.join(', ')}`);

    const productos = await PedidoArtesanoProductoModel.findAll({ where: { codigo_producto: { [Op.in]: codigos } }, attributes: ['codigo_producto', 'unidades_sap'] });
    const unidades = new Map(productos.map(p => [p.codigo_producto, Number(p.unidades_sap) || 1]));

    return new Map(codigos.map(c => [c, porSap.get(c) * (unidades.get(c) || 1)]));
}

// Guarda el último error de SAP en los pedidos, sin tocar actualizado_en.
async function guardarErrorSap(ids, mensaje) {
    try {
        await PedidoArtesanoModel.update({ sap_error: mensaje, sap_error_en: new Date() }, { where: { id: { [Op.in]: ids } } });
    } catch (error) {
        console.error('[PedidoArtesano] No se pudo guardar el error de SAP:', error.message);
    }
}

// Respuesta de cargar o entregar: pedidos procesados y errores del resto.
async function responderLote(res, procesadosIds, errores) {
    if (procesadosIds.length === 0) {
        const primero = errores[0];
        const mensaje = errores.length === 1 ? primero.mensaje : errores.map(e => e.mensaje).join(' | ');

        return res.status(primero.status).json({ error: mensaje, errores, success: false });
    }

    const pedidos = await Promise.all(procesadosIds.map(id => cargarPedido(id)));

    return res.json({ success: true, pedidos: pedidos.map(mapearPedido), errores });
}

function errorDeLote(error, etiqueta) {
    const status = error instanceof ErrorPedidoArtesano ? error.status : 500;
    const detalle = error instanceof ErrorPedidoArtesano ? error.message : `Error inesperado: ${error.message}`;

    return { status, mensaje: `${etiqueta}: ${detalle}` };
}

// Carga los pedidos de una ruta con una sola transferencia de SAP.
// Si SAP la rechaza, ningún pedido cambia.
async function cargarGrupoRuta({ ids, ajustes, versiones, piloto, usuario, req }) {
    const t = await sequelizeInit.sequelize.transaction();

    try {
        const pedidos = await PedidoArtesanoModel.findAll({ where: { id: { [Op.in]: ids } }, transaction: t, lock: t.LOCK.UPDATE });

        if (pedidos.length !== ids.length) throw new ErrorPedidoArtesano(404, 'Alguno de los pedidos no existe');

        // La ruta pudo cambiar entre agrupar y bloquear.
        if (pedidos.some(p => p.ruta_id !== pedidos[0].ruta_id)) {
            throw new ErrorPedidoArtesano(409, 'La ruta de alguno de los pedidos cambió, actualiza la lista');
        }

        const ruta = await CatalogoRutaPolloModel.findByPk(pedidos[0].ruta_id, { transaction: t });

        if (!ruta) throw new ErrorPedidoArtesano(400, 'La ruta del pedido ya no existe');

        const preparados = [];
        const totales = new Map();

        for (const pedido of pedidos) {
            if (pedido.estado !== 'CREADO') {
                throw new ErrorPedidoArtesano(409, `El pedido ${pedido.numero_pedido} ya no está pendiente de carga`);
            }

            if (versiones[pedido.id] && new Date(versiones[pedido.id]).getTime() !== new Date(pedido.actualizado_en).getTime()) {
                throw new ErrorPedidoArtesano(409, `El pedido ${pedido.numero_pedido} cambió mientras lo revisabas, actualiza la lista`);
            }

            const lineas = await PedidoArtesanoDetalleModel.findAll({ where: { pedido_id: pedido.id }, order: [['numero_linea', 'ASC']], transaction: t });
            const diferencias = await fijarCantidadesACargar(pedido, lineas, Array.isArray(ajustes[pedido.id]) ? ajustes[pedido.id] : null, t);

            lineas.forEach((l) => totales.set(l.codigo_producto, (totales.get(l.codigo_producto) || 0) + Number(l.cantidad_autorizada)));
            preparados.push({ pedido, diferencias });
        }

        const codigos = [...totales.keys()].filter(c => totales.get(c) > 0);
        const factores = await factoresDeSap(codigos, ruta.whs_code_origen);
        const lineasSap = codigos.map(c => ({ codigo_producto: c, cantidad: redondear(totales.get(c) * factores.get(c)) }));

        let documento;

        try {
            documento = await crearTransferenciaPollo({
                fromWarehouse: ruta.whs_code_origen,
                toWarehouse: ruta.whs_code_destino,
                lineas: lineasSap,
                comentarios: `Pollo Artesano ${ruta.nombre_ruta}: ${pedidos.map(p => p.numero_pedido).join(', ')}`
            });
        } catch (error) {
            throw new ErrorSapArtesano(`SAP rechazó la transferencia: ${error.message}`);
        }

        for (const { pedido, diferencias } of preparados) {
            const autorizacion = diferencias.length > 0 ? `Autorizado parcialmente — ${diferencias.join('; ')}` : 'Autorizado completo';

            await cambiarEstado(
                pedido,
                ['CREADO'],
                'CARGADO',
                {
                    cargado_por: req.user.id_usuario,
                    cargado_por_nombre: usuario,
                    fecha_carga: new Date(),
                    codigo_piloto: piloto.codigo,
                    nombre_piloto: piloto.nombre,
                    sap_traslado_docentry: documento.DocEntry,
                    sap_traslado_docnum: documento.DocNum,
                    sap_error: null,
                    sap_error_en: null
                },
                usuario,
                `Cargado. ${autorizacion}. Transferencia SAP ${documento.DocNum}. Piloto: ${piloto.nombre}`,
                t
            );
        }

        await t.commit();
    } catch (error) {
        await t.rollback();
        throw error;
    }
}

// POST /pedidoArtesano/cargar { ids, codigo_piloto, ajustes?, versiones? }
// Pasa los pedidos CREADOS a CARGADO con una transferencia de SAP por ruta (cantidad autorizada).
// Si SAP rechaza una ruta, esos pedidos no se cargan y el error queda en el pedido; las demás rutas sí.
async function cargar(req, res) {
    try {
        await exigirEscrituraRastro(req);

        const { ids } = req.body;
        const ajustes = req.body.ajustes || {};
        const versiones = req.body.versiones || {};
        validarIds(ids);

        const piloto = await resolverPiloto(req.body.codigo_piloto);
        const usuario = await nombreCortoDelUsuario(req);

        const existentes = await PedidoArtesanoModel.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'numero_pedido', 'ruta_id', 'nombre_ruta'] });

        if (existentes.length !== ids.length) throw new ErrorPedidoArtesano(404, 'Alguno de los pedidos no existe');

        const grupos = new Map();

        existentes.forEach((p) => {
            if (!grupos.has(p.ruta_id)) grupos.set(p.ruta_id, { nombre_ruta: p.nombre_ruta, pedidos: [] });
            grupos.get(p.ruta_id).pedidos.push(p);
        });

        const procesados = [];
        const errores = [];

        for (const grupo of grupos.values()) {
            const idsGrupo = grupo.pedidos.map(p => p.id);
            const numeros = grupo.pedidos.map(p => p.numero_pedido);

            try {
                await cargarGrupoRuta({ ids: idsGrupo, ajustes, versiones, piloto, usuario, req });
                procesados.push(...idsGrupo);
            } catch (error) {
                const { status, mensaje } = errorDeLote(error, `Ruta ${grupo.nombre_ruta} (${numeros.join(', ')})`);

                if (error instanceof ErrorSapArtesano) await guardarErrorSap(idsGrupo, error.detalle);

                errores.push({ pedidos: numeros, status, mensaje });
            }
        }

        return await responderLote(res, ids.filter(id => procesados.includes(id)), errores);
    } catch (error) {
        return responderError(res, error, 'Error al cargar los pedidos');
    }
}

// POST /pedidoArtesano/cambiarPiloto  { ids: [...], codigo_piloto }
// Cambia el piloto de pedidos CARGADOS; queda en el historial.
async function cambiarPiloto(req, res) {
    try {
        await exigirEscrituraRastro(req);

        const { ids } = req.body;
        validarIds(ids);

        const piloto = await resolverPiloto(req.body.codigo_piloto);
        const usuario = await nombreCortoDelUsuario(req);
        const t = await sequelizeInit.sequelize.transaction();

        try {
            const pedidos = await PedidoArtesanoModel.findAll({ where: { id: { [Op.in]: ids } }, transaction: t, lock: t.LOCK.UPDATE });

            if (pedidos.length !== ids.length) throw new ErrorPedidoArtesano(404, 'Alguno de los pedidos no existe');

            for (const pedido of pedidos) {
                if (pedido.estado !== 'CARGADO') {
                    throw new ErrorPedidoArtesano(409, `El piloto solo se cambia en pedidos cargados (${pedido.numero_pedido})`);
                }

                const anterior = pedido.nombre_piloto || 'sin piloto';
                const nuevo = piloto.nombre;

                await pedido.update({
                    codigo_piloto: piloto.codigo,
                    nombre_piloto: piloto.nombre,
                    actualizado_en: new Date()
                }, { transaction: t });

                await registrarHistorial(pedido.id, 'CARGADO', 'CARGADO', usuario, `Piloto: ${anterior} → ${nuevo}`, t);
            }

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }

        const actualizados = await Promise.all(ids.map(id => cargarPedido(id)));

        return res.json({ success: true, pedidos: actualizados.map(mapearPedido) });
    } catch (error) {
        return responderError(res, error, 'Error al cambiar el piloto');
    }
}

// GET /pedidoArtesano/pdf?ids=a,b,c: constancia de envío de pedidos CARGADOS
// (una página por pedido). Se puede reimprimir las veces que haga falta.
async function getPdf(req, res) {
    try {
        await exigirLecturaPedidos(req);

        const ids = String(req.query.ids || '').split(',').map(i => i.trim()).filter(Boolean);
        validarIds(ids);

        const pedidos = (await Promise.all(ids.map(id => cargarPedido(id)))).filter(Boolean);

        if (pedidos.length !== ids.length) throw new ErrorPedidoArtesano(404, 'Alguno de los pedidos no existe');

        const noCargado = pedidos.find(p => !['CARGADO', 'ENTREGADO'].includes(p.estado));

        if (noCargado) throw new ErrorPedidoArtesano(409, `El pedido ${noCargado.numero_pedido} todavía no se ha cargado`);

        const conCuadro = req.query.cuadro === '1';
        let mapeados = pedidos.map(mapearPedido);

        if (conCuadro) {
            // El cuadro lleva el código de empleado del cliente, que no viaja en el pedido.
            const clientes = await ClienteAvicolaModel.findAll({
                where: { id: { [Op.in]: [...new Set(mapeados.map(p => p.cliente_id))] } },
                attributes: ['id', 'codigo_empleado']
            });
            const codigos = new Map(clientes.map(c => [c.id, c.codigo_empleado]));

            mapeados = mapeados.map(p => ({ ...p, codigo_empleado: codigos.get(p.cliente_id) || null }));
        }

        return await generarPdfEnvios(res, mapeados, 'envio_pollo_artesano.pdf', { conCuadro });
    } catch (error) {
        return responderError(res, error, 'Error al generar el PDF del envío');
    }
}

// Rastro: entrega, evidencia y reporte

// Entrega un pedido CARGADO: crea la entrega en SAP y lo marca ENTREGADO. Si SAP la rechaza, sigue CARGADO.
async function entregarPedido(id, usuario, req) {
    const t = await sequelizeInit.sequelize.transaction();

    try {
        const pedido = await PedidoArtesanoModel.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });

        if (!pedido) throw new ErrorPedidoArtesano(404, 'El pedido no existe');

        if (pedido.estado !== 'CARGADO') {
            throw new ErrorPedidoArtesano(409, `El pedido ${pedido.numero_pedido} no está cargado, no se puede marcar como entregado`);
        }

        const cliente = await ClienteAvicolaModel.findByPk(pedido.cliente_id, { transaction: t });

        if (!cliente || !cliente.card_code) {
            throw new ErrorPedidoArtesano(409, `El cliente ${pedido.cliente_nombre} no tiene cliente SAP (CardCode) asignado`);
        }

        const ruta = await CatalogoRutaPolloModel.findByPk(pedido.ruta_id, { transaction: t });

        if (!ruta) throw new ErrorPedidoArtesano(400, 'La ruta del pedido ya no existe');

        const lineas = await PedidoArtesanoDetalleModel.findAll({
            where: { pedido_id: pedido.id, cantidad_autorizada: { [Op.gt]: 0 } },
            order: [['numero_linea', 'ASC']],
            transaction: t
        });

        if (lineas.length === 0) throw new ErrorPedidoArtesano(409, 'El pedido no tiene cantidades autorizadas para entregar');

        const sinPrecio = lineas.find(l => l.precio_unitario === null || l.precio_unitario === undefined);

        if (sinPrecio) throw new ErrorPedidoArtesano(409, `El producto ${sinPrecio.codigo_producto} no tiene precio guardado en el pedido`);

        const factores = await factoresDeSap(lineas.map(l => l.codigo_producto), ruta.whs_code_destino);

        // Cantidad y precio sin IVA, en unidades de SAP.
        const lineasSap = lineas.map((l) => {
            const factor = factores.get(l.codigo_producto);

            return {
                codigo_producto: l.codigo_producto,
                cantidad: redondear(Number(l.cantidad_autorizada) * factor),
                precio: redondear(Number(l.precio_unitario) / factor / (1 + TASA_IVA))
            };
        });

        let documento;

        try {
            documento = await crearEntregaArtesano({
                cardCode: cliente.card_code,
                whsCode: ruta.whs_code_destino,
                lineas: lineasSap,
                comentarios: `Pollo Artesano ${pedido.numero_pedido} - ${pedido.cliente_nombre}`,
                numAtCard: pedido.numero_pedido
            });
        } catch (error) {
            throw new ErrorSapArtesano(`SAP rechazó la entrega: ${error.message}`);
        }

        await cambiarEstado(
            pedido,
            ['CARGADO'],
            'ENTREGADO',
            {
                entregado_por: req.user.id_usuario,
                entregado_por_nombre: usuario,
                fecha_entrega: new Date(),
                sap_entrega_docentry: documento.DocEntry,
                sap_entrega_docnum: documento.DocNum,
                sap_error: null,
                sap_error_en: null
            },
            usuario,
            `Entregado al cliente. Entrega SAP ${documento.DocNum}`,
            t
        );

        await t.commit();
    } catch (error) {
        await t.rollback();
        throw error;
    }
}

// POST /pedidoArtesano/entregar { ids }
// Cada pedido se procesa por separado: si SAP rechaza uno, los demás se entregan.
async function entregar(req, res) {
    try {
        await exigirEscrituraRastro(req);

        const { ids } = req.body;
        validarIds(ids);

        const usuario = await nombreCortoDelUsuario(req);
        const existentes = await PedidoArtesanoModel.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'numero_pedido'] });

        if (existentes.length !== ids.length) throw new ErrorPedidoArtesano(404, 'Alguno de los pedidos no existe');

        const numeros = new Map(existentes.map(p => [p.id, p.numero_pedido]));
        const procesados = [];
        const errores = [];

        for (const id of ids) {
            try {
                await entregarPedido(id, usuario, req);
                procesados.push(id);
            } catch (error) {
                const { status, mensaje } = errorDeLote(error, `Pedido ${numeros.get(id)}`);

                if (error instanceof ErrorSapArtesano) await guardarErrorSap([id], error.detalle);

                errores.push({ pedidos: [numeros.get(id)], status, mensaje });
            }
        }

        return await responderLote(res, procesados, errores);
    } catch (error) {
        return responderError(res, error, 'Error al entregar los pedidos');
    }
}

// Recibe la foto (campo "foto") y devuelve un error JSON si el archivo no sirve.
function recibirFoto(req, res, next) {
    upload.single('foto')(req, res, (error) => {
        if (!error) return next();

        const mensaje = error.code === 'LIMIT_FILE_SIZE' ? 'El archivo es demasiado grande' : error.message;

        return res.status(400).json({ error: mensaje || 'Archivo inválido', success: false });
    });
}

function llaveEvidencia(pedidoId, file) {
    const porNombre = path.extname(file.originalname || '').toLowerCase();
    const porTipo = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' }[file.mimetype] || '';

    return `${PREFIJO_EVIDENCIA}/${pedidoId}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${porNombre || porTipo}`;
}

// POST /pedidoArtesano/subirEvidencia  (multipart: id, foto)
// Adjunta o reemplaza la foto de la hoja firmada de un pedido CARGADO o ENTREGADO.
async function subirEvidencia(req, res) {
    try {
        await exigirEscrituraRastro(req);

        const { id } = req.body;
        validarId(id);

        if (!req.file) throw new ErrorPedidoArtesano(400, 'Adjunta la foto de la hoja firmada');

        const pedido = await PedidoArtesanoModel.findByPk(id);

        if (!pedido) throw new ErrorPedidoArtesano(404, 'El pedido no existe');

        if (!['CARGADO', 'ENTREGADO'].includes(pedido.estado)) {
            throw new ErrorPedidoArtesano(409, 'Solo se adjunta evidencia a pedidos cargados o entregados');
        }

        const bucket = process.env.AWS_BUCKET_NAME;
        const key = llaveEvidencia(id, req.file);
        const usuario = await nombreCortoDelUsuario(req);

        await uploadBufferToS3({ bucket, key, buffer: req.file.buffer, contentType: req.file.mimetype, originalName: req.file.originalname });

        const llaveAnterior = pedido.evidencia_entrega_key;
        const t = await sequelizeInit.sequelize.transaction();

        try {
            await pedido.update({ evidencia_entrega_key: key, actualizado_en: new Date() }, { transaction: t });
            await registrarHistorial(
                id,
                pedido.estado,
                pedido.estado,
                usuario,
                llaveAnterior ? 'Evidencia de entrega reemplazada' : 'Evidencia de entrega adjuntada',
                t
            );
            await t.commit();
        } catch (error) {
            await t.rollback();
            // El archivo ya se subió pero no quedó ligado: se quita para no dejar basura.
            deleteFromS3({ bucket, key }).catch(() => {});
            throw error;
        }

        if (llaveAnterior) deleteFromS3({ bucket, key: llaveAnterior }).catch(() => {});

        return res.json({ success: true, pedido: mapearPedido(await cargarPedido(id)) });
    } catch (error) {
        return responderError(res, error, 'Error al adjuntar la evidencia de entrega');
    }
}

// GET /pedidoArtesano/getEvidencia?id=: URL firmada (válida 1 hora) de la foto.
async function getEvidencia(req, res) {
    try {
        await exigirLecturaPedidos(req);

        const { id } = req.query;
        validarId(id);

        const pedido = await PedidoArtesanoModel.findByPk(id, { attributes: ['id', 'evidencia_entrega_key'] });

        if (!pedido) throw new ErrorPedidoArtesano(404, 'El pedido no existe');
        if (!pedido.evidencia_entrega_key) throw new ErrorPedidoArtesano(404, 'El pedido no tiene evidencia de entrega');

        const url = await getPresignedUrl({
            bucket: process.env.AWS_BUCKET_NAME,
            key: pedido.evidencia_entrega_key,
            expiresInSec: EXPIRA_URL_EVIDENCIA_SEG
        });

        return res.json({ success: true, url });
    } catch (error) {
        return responderError(res, error, 'Error al obtener la evidencia de entrega');
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
    completarPago,
    getPendientes,
    getStock,
    rechazar,
    getPilotos,
    cargar,
    cambiarPiloto,
    getPdf,
    entregar,
    recibirFoto,
    subirEvidencia,
    getEvidencia,
    exportarPedidos
};
