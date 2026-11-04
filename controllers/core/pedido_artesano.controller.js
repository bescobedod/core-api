const { Op, QueryTypes, fn, col } = require('sequelize');
const sequelizeInit = require('../../configuration/db');
const CatalogoRutaPolloModel = require('../../models/core/tbl_catalogo_rutas_pollo.model');
const TiendaRutaPolloModel = require('../../models/core/tbl_tiendas_rutas_pollo.model');
const ClienteAvicolaModel = require('../../models/core/tbl_cliente_avicola.model');
const PedidoArtesanoModel = require('../../models/core/tbl_pedido_artesano.model');
const PedidoArtesanoDetalleModel = require('../../models/core/tbl_pedido_artesano_detalle.model');
const PedidoArtesanoProductoModel = require('../../models/core/tbl_pedido_artesano_producto.model');
const { consultarStockPollo } = require('../../integrations/sap/sapClient');
const { nivelPermisoDeMenu, nombreDelUsuario } = require('../../services/permisosMenu.service');
const { parsearPaginacion, armarPaginacion } = require('../../services/paginacion.service');

// Menú (config.tbl_menu.nombre_menu) del pollo artesano. Cualquier nivel puede
// buscar pedidos; crear pedidos y clientes pide 'escritura'.
const MENU_ARTESANO = 'PedidosArtesanoView';

// El nombre y la unidad de los productos se consultan en SAP (muelle Central).
const WHS_CONSULTA_PRODUCTOS = 'RAS-002';
const TTL_PRODUCTOS_MS = 10 * 60 * 1000;

const LIMITE_LISTADO = 1000;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ZONA_HORARIA = 'America/Guatemala';

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

function fechaGuatemala(fecha) {
    return fecha ? new Date(fecha).toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA }) : null;
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

async function codigosHabilitados() {
    const filas = await PedidoArtesanoProductoModel.findAll({ where: { activo: true }, attributes: ['codigo_producto'] });

    return filas.map(f => f.codigo_producto);
}

// ---------------------------------------------------------------------------
// Mapeos
// ---------------------------------------------------------------------------
function mapearCliente(c) {
    return { id: c.id, nombre: c.nombre, nit: c.nit, direccion: c.direccion, direccion_fisica: c.direccion_fisica };
}

function mapearPedido(pedido) {
    const p = pedido.get({ plain: true });

    return {
        id: p.id,
        numero_pedido: p.numero_pedido,
        fecha_requerida: p.fecha_requerida,
        creado_en: fechaGuatemala(p.creado_en),
        creado_por: p.creado_por_nombre,
        ruta_id: p.ruta_id,
        nombre_ruta: p.nombre_ruta,
        nombre_tienda_referencia: p.nombre_tienda_referencia,
        cliente_nombre: p.cliente_nombre,
        cliente_nit: p.cliente_nit,
        direccion_entrega: p.direccion_entrega,
        condicion_pago: p.condicion_pago,
        numero_boleta: p.numero_boleta,
        comentario: p.comentario,
        items: [...(p.detalle || [])]
            .sort((a, b) => a.numero_linea - b.numero_linea)
            .map(d => ({
                codigo_producto: d.codigo_producto,
                descripcion_producto: d.descripcion_producto,
                unidad_medida: d.unidad_medida,
                cantidad: Number(d.cantidad)
            }))
    };
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

// GET /pedidoArtesano/getProductos — productos habilitados para pedir.
async function getProductos(req, res) {
    try {
        await exigirLectura(req);

        const codigos = await codigosHabilitados();
        const detalles = await detalleProductos(codigos);

        const productos = codigos
            .map(codigo => ({
                codigo_producto: codigo,
                descripcion_producto: detalles.get(codigo).descripcion,
                unidad_medida: detalles.get(codigo).unidad || 'UND'
            }))
            .sort((a, b) => a.descripcion_producto.localeCompare(b.descripcion_producto));

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

// GET /pedidoArtesano/getPedidos?id_usuario=&fecha_desde=&fecha_hasta=
async function getPedidos(req, res) {
    try {
        await exigirLectura(req);

        const { id_usuario, fecha_desde, fecha_hasta } = req.query;
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

        const solicitada = parsearPaginacion(req.query);
        const { page, pageSize, total, totalPages, offset } = armarPaginacion(
            await PedidoArtesanoModel.count({ where }),
            solicitada.page,
            solicitada.pageSize
        );

        const pedidos = await PedidoArtesanoModel.findAll({
            where,
            include: [{ model: PedidoArtesanoDetalleModel, as: 'detalle' }],
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

// POST /pedidoArtesano/crearCliente  { nombre, nit, direccion, direccion_fisica }
async function crearCliente(req, res) {
    try {
        await exigirEscritura(req);

        const cliente = await ClienteAvicolaModel.create({
            nombre: textoObligatorio(req.body.nombre, 250, 'El nombre'),
            nit: textoOpcional(req.body.nit, 20, 'El NIT'),
            direccion: textoOpcional(req.body.direccion, 250, 'La dirección'),
            direccion_fisica: textoObligatorio(req.body.direccion_fisica, 250, 'La dirección física'),
            creado_por: req.user.id_usuario
        });

        return res.status(201).json({ success: true, cliente: mapearCliente(cliente) });
    } catch (error) {
        return responderError(res, error, 'Error al crear el cliente');
    }
}

// POST /pedidoArtesano/crearPedido
// { fecha_requerida, ruta_id, id_tienda_simphony_referencia?, cliente_id, direccion_fisica,
//   condicion_pago, numero_boleta?, comentario?, items: [{ codigo_producto, cantidad }] }
async function crearPedido(req, res) {
    try {
        await exigirEscritura(req);

        const body = req.body;

        // El artesano no tiene la regla de las 4 pm: solo no se acepta una fecha pasada.
        const hoy = fechaGuatemala(new Date());

        if (!REGEX_FECHA.test(String(body.fecha_requerida || ''))) {
            throw new ErrorPedidoArtesano(400, 'fecha_requerida debe tener el formato YYYY-MM-DD');
        }

        if (body.fecha_requerida < hoy) throw new ErrorPedidoArtesano(400, 'La fecha requerida no puede ser anterior a hoy');

        if (!['PAGADO', 'CREDITO'].includes(body.condicion_pago)) {
            throw new ErrorPedidoArtesano(400, "condicion_pago debe ser 'PAGADO' o 'CREDITO'");
        }

        const numeroBoleta = body.condicion_pago === 'PAGADO' ? textoObligatorio(body.numero_boleta, 50, 'El número de boleta') : null;
        const direccionFisica = textoObligatorio(body.direccion_fisica, 250, 'La dirección física');
        const comentario = textoOpcional(body.comentario, 1000, 'El comentario');

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

        const [usuario, detalles] = await Promise.all([nombreDelUsuario(req), detalleProductos(codigos)]);
        const t = await sequelizeInit.sequelize.transaction();
        let idPedido;

        try {
            // La dirección de entrega que se capturó queda guardada en el cliente.
            if (cliente.direccion_fisica !== direccionFisica) {
                await cliente.update({ direccion_fisica: direccionFisica, actualizado_en: new Date() }, { transaction: t });
            }

            const [{ nextval }] = await sequelizeInit.sequelize.query(
                "SELECT nextval('logistica.seq_pedido_artesano') AS nextval",
                { type: QueryTypes.SELECT, transaction: t }
            );

            const ahora = new Date();

            const pedido = await PedidoArtesanoModel.create({
                numero_pedido: `PA-${new Date().getFullYear()}-${String(nextval).padStart(6, '0')}`,
                fecha_requerida: body.fecha_requerida,
                ruta_id: ruta.id,
                nombre_ruta: ruta.nombre_ruta,
                codigo_tienda_referencia: tiendaReferencia ? tiendaReferencia.id_tienda_simphony : null,
                // La columna es de 150 caracteres y el nombre en la asignación admite más.
                nombre_tienda_referencia: tiendaReferencia && tiendaReferencia.nombre_tienda
                    ? tiendaReferencia.nombre_tienda.slice(0, 150)
                    : null,
                cliente_id: cliente.id,
                cliente_nombre: cliente.nombre,
                cliente_nit: cliente.nit,
                direccion_entrega: direccionFisica,
                condicion_pago: body.condicion_pago,
                numero_boleta: numeroBoleta,
                comentario,
                estado: 'CREADO',
                creado_por: req.user.id_usuario,
                creado_por_nombre: usuario,
                creado_en: ahora,
                actualizado_en: ahora
            }, { transaction: t });

            await PedidoArtesanoDetalleModel.bulkCreate(body.items.map((item, i) => ({
                pedido_id: pedido.id,
                numero_linea: i + 1,
                codigo_producto: codigos[i],
                descripcion_producto: detalles.get(codigos[i]).descripcion,
                unidad_medida: detalles.get(codigos[i]).unidad,
                cantidad: Number(item.cantidad)
            })), { transaction: t });

            await t.commit();
            idPedido = pedido.id;
        } catch (error) {
            await t.rollback();
            throw error;
        }

        const creado = await PedidoArtesanoModel.findByPk(idPedido, {
            include: [{ model: PedidoArtesanoDetalleModel, as: 'detalle' }]
        });

        return res.status(201).json({ success: true, pedido: mapearPedido(creado) });
    } catch (error) {
        return responderError(res, error, 'Error al crear el pedido de pollo artesano');
    }
}

module.exports = {
    getProductos,
    getUsuarios,
    getPedidos,
    buscarClientes,
    crearCliente,
    crearPedido
};
