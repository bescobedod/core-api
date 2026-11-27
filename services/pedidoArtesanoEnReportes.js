const { Op } = require('sequelize');
const PedidoArtesanoModel = require('../models/core/tbl_pedido_artesano.model');
const PedidoArtesanoDetalleModel = require('../models/core/tbl_pedido_artesano_detalle.model');
const PedidoArtesanoProductoModel = require('../models/core/tbl_pedido_artesano_producto.model');
const DespachoRutaModel = require('../models/core/tbl_despacho_ruta.model');
const CatalogoRutaPolloModel = require('../models/core/tbl_catalogo_rutas_pollo.model');
const { acortarNombre } = require('./nombres.service');
const { sequelize } = require('../configuration/db');

// Pedidos de clientes de pollo artesano con la forma de los pedidos de tienda, para que los reportes de Pedidos de Pollo
// (detalle, en tránsito y resumen de ruta) los muestren junto a las tiendas. Solo cuentan los que van a despacharse:
// no entran los rechazados ni los cancelados.

const ESTADOS_DESPACHABLES = ['CREADO', 'VALIDADO', 'EN_TRANSITO', 'ENTREGADO'];

// Los clientes usan los estados de las tiendas en los reportes (recién creado = recibido).
const ESTADO_COMO_TIENDA = { CREADO: 'RECIBIDO', VALIDADO: 'VALIDADO', EN_TRANSITO: 'EN_TRANSITO', ENTREGADO: 'ENTREGADO' };

async function unidadesPorProducto() {
    const filas = await PedidoArtesanoProductoModel.findAll({ attributes: ['codigo_producto', 'unidades_sap'] });

    return new Map(filas.map(f => [f.codigo_producto, Number(f.unidades_sap) || 1]));
}

async function despachosDe(pedidos) {
    const rutaIds = [...new Set(pedidos.map(p => p.ruta_id).filter(Boolean))];

    if (rutaIds.length === 0) return new Map();

    const fechas = [...new Set(pedidos.map(p => String(p.fecha_requerida).slice(0, 10)))];
    const despachos = await DespachoRutaModel.findAll({ where: { ruta_id: { [Op.in]: rutaIds }, fecha: { [Op.in]: fechas } } });

    return new Map(despachos.map(d => [`${d.ruta_id}|${String(d.fecha).slice(0, 10)}`, d.get({ plain: true })]));
}

// Los nombres de SAP vienen en mayúsculas; se muestran como los de las tiendas (primera letra de cada palabra en mayúscula).
const formatoNombre = texto => String(texto || '').toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, sep, letra) => sep + letra.toUpperCase());

// Un bloque con la misma forma que construirBloquesPedido de los pedidos de tienda.
// Las cantidades van en unidades de SAP (bolsas), igual que las tiendas, para que los totales se puedan sumar.
function aBloque(p, unidades, despachos) {
    const factor = codigo => unidades.get(codigo) || 1;
    const fecha = String(p.fecha_requerida).slice(0, 10);
    const despacho = despachos.get(`${p.ruta_id}|${fecha}`);
    const salio = ['VALIDADO', 'EN_TRANSITO', 'ENTREGADO'].includes(p.estado);
    const detalles = [];

    if (p.nombre_tienda_referencia) detalles.push(`Tienda de referencia: ${p.nombre_tienda_referencia}`);
    if (p.direccion_entrega) detalles.push(`Dirección: ${p.direccion_entrega}`);

    return {
        id_pedido: p.id,
        es_cliente: true,
        codigo_tienda: p.codigo_tienda_referencia,
        ruta_id: p.ruta_id || 'sin_ruta',
        nombre_ruta: p.nombre_ruta || 'Sin ruta asignada',
        nombre_tienda: p.cliente_nombre,
        label: 'Cliente',
        detalles,
        numero_pedido: p.numero_pedido,
        estado: ESTADO_COMO_TIENDA[p.estado],
        fecha_requerida: fecha,
        camion_placa: despacho ? despacho.camion_placa : null,
        piloto_nombre: despacho && despacho.piloto_nombre ? despacho.piloto_nombre : (p.nombre_piloto ? acortarNombre(p.nombre_piloto) : null),
        sap_delivery_docentry: p.sap_entrega_docentry || null,
        sap_delivery_docnum: p.sap_entrega_docnum || null,
        sap_entry_docentry: null,
        sap_entry_docnum: null,
        items: [...(p.detalle || [])]
            .sort((a, b) => a.numero_linea - b.numero_linea)
            .map((d) => {
                const aut = d.cantidad_autorizada === null || d.cantidad_autorizada === undefined ? null : Number(d.cantidad_autorizada);

                return {
                    codigo_producto: d.codigo_producto,
                    nombre_producto: formatoNombre(d.descripcion_producto),
                    unidad_medida: d.unidad_medida || 'UND',
                    cantidad_solicitada: Number(d.cantidad) * factor(d.codigo_producto),
                    cantidad_asignada: salio && aut !== null ? aut * factor(d.codigo_producto) : 0,
                    cantidad_recibida: p.estado === 'ENTREGADO' && aut !== null ? aut * factor(d.codigo_producto) : null
                };
            })
    };
}

async function armarBloques(where, productos) {
    const [pedidos, unidades] = await Promise.all([
        PedidoArtesanoModel.findAll({
            where,
            include: [{ model: PedidoArtesanoDetalleModel, as: 'detalle', ...(productos ? { where: { codigo_producto: { [Op.in]: productos } } } : {}) }],
            order: [['fecha_requerida', 'ASC'], ['nombre_ruta', 'ASC'], ['numero_pedido', 'ASC']]
        }),
        unidadesPorProducto()
    ]);
    const planos = pedidos.map(p => p.get({ plain: true }));
    const despachos = await despachosDe(planos);

    return planos.map(p => aBloque(p, unidades, despachos));
}

// Bloques de clientes para el reporte de detalle: una fecha o un rango, productos y muelles opcionales.
async function bloquesClientesDetalle({ fecha, esRango, fechaHasta, productos, muelles }) {
    const where = {
        estado: { [Op.in]: ESTADOS_DESPACHABLES },
        fecha_requerida: esRango ? { [Op.between]: [fecha, fechaHasta] } : fecha
    };

    if (muelles) {
        const rutas = await CatalogoRutaPolloModel.findAll({ where: { whs_code_origen: { [Op.in]: muelles } }, attributes: ['id'], raw: true });

        where.ruta_id = { [Op.in]: rutas.map(r => r.id) };
    }

    return armarBloques(where, productos);
}

// Bloques de clientes con pedidos en tránsito (cualquier fecha).
function bloquesClientesEnTransito() {
    return armarBloques({ estado: 'EN_TRANSITO' }, null);
}

// Lo que los clientes aportan al resumen de ruta: una columna por cliente y las cantidades que salen (asignadas), en bolsas.
async function datosClientesResumenRuta(rutaId, fecha) {
    const pedidos = await PedidoArtesanoModel.findAll({
        where: { ruta_id: rutaId, fecha_requerida: fecha, estado: { [Op.in]: ['VALIDADO', 'EN_TRANSITO', 'ENTREGADO'] } },
        include: [{ model: PedidoArtesanoDetalleModel, as: 'detalle' }],
        order: [['cliente_nombre', 'ASC'], ['numero_pedido', 'ASC']]
    });
    const unidades = await unidadesPorProducto();

    const columnas = [];
    const cantidades = [];

    pedidos.forEach((p) => {
        // Una columna por cliente, aunque tenga más de un pedido en la ruta ese día.
        const clave = `cliente:${p.cliente_id}`;

        if (!columnas.some(c => c.codigo_tienda === clave)) {
            columnas.push({ codigo_tienda: clave, nombre_tienda: p.cliente_nombre, es_cliente: true, referencia: p.nombre_tienda_referencia || null });
        }

        p.detalle.forEach((d) => {
            const aut = Number(d.cantidad_autorizada);

            if (!Number.isFinite(aut) || aut <= 0) return;

            cantidades.push({
                clave,
                codigo_producto: d.codigo_producto,
                nombre_producto: formatoNombre(d.descripcion_producto),
                unidad_medida: d.unidad_medida || 'UND',
                cantidad: aut * (unidades.get(d.codigo_producto) || 1)
            });
        });
    });

    return { columnas, cantidades, yaEnviada: pedidos.some(p => ['EN_TRANSITO', 'ENTREGADO'].includes(p.estado)), hayPedidos: pedidos.length > 0 };
}

// Productos que los clientes han pedido en los últimos 12 meses, para el filtro de productos de los reportes.
async function productosClientesReporte() {
    const desde = new Date();
    desde.setMonth(desde.getMonth() - 12);

    const filas = await sequelize.query(
        `SELECT d.codigo_producto, d.descripcion_producto, d.unidad_medida, MAX(p.fecha_requerida) AS ultima_fecha
           FROM logistica.tbl_pedido_artesano_detalle d
           JOIN logistica.tbl_pedido_artesano p ON p.id = d.pedido_id
          WHERE p.fecha_requerida >= :desde AND p.estado IN (:estados) AND d.codigo_producto IS NOT NULL
          GROUP BY d.codigo_producto, d.descripcion_producto, d.unidad_medida`,
        { replacements: { desde: desde.toISOString().slice(0, 10), estados: ESTADOS_DESPACHABLES }, type: 'SELECT' }
    );

    const masReciente = new Map();

    filas.forEach((f) => {
        const actual = masReciente.get(f.codigo_producto);

        if (!actual || String(f.ultima_fecha) > String(actual.ultima_fecha)) masReciente.set(f.codigo_producto, f);
    });

    return [...masReciente.values()].map(f => ({
        codigo_producto: f.codigo_producto,
        descripcion_producto: formatoNombre(f.descripcion_producto) || f.codigo_producto,
        unidad_medida: f.unidad_medida || null
    }));
}

// Bloques de los clientes de una ruta y fecha (los que van a despacharse), para la hoja de entrega con firma.
function bloquesClientesRuta(rutaId, fecha) {
    return armarBloques({ ruta_id: rutaId, fecha_requerida: fecha, estado: { [Op.in]: ESTADOS_DESPACHABLES } }, null);
}

// Lo que los clientes suben al camión en una ruta y fecha (ya enviados), para el ticket de traslado: totales por artículo en
// unidades de SAP y los documentos de la transferencia.
async function datosClientesTicket(rutaId, fecha) {
    const pedidos = await PedidoArtesanoModel.findAll({
        where: { ruta_id: rutaId, fecha_requerida: fecha, estado: { [Op.in]: ['EN_TRANSITO', 'ENTREGADO'] } },
        include: [{ model: PedidoArtesanoDetalleModel, as: 'detalle' }],
        order: [['numero_pedido', 'ASC']]
    });
    const unidades = await unidadesPorProducto();
    const porCodigo = new Map();

    pedidos.forEach(p => (p.detalle || []).forEach((d) => {
        const aut = Number(d.cantidad_autorizada);

        if (!Number.isFinite(aut) || aut <= 0) return;

        const linea = porCodigo.get(d.codigo_producto) || {
            codigo_producto: d.codigo_producto,
            descripcion_producto: formatoNombre(d.descripcion_producto),
            unidad_medida: d.unidad_medida || 'UND',
            cantidad: 0
        };

        linea.cantidad += aut * (unidades.get(d.codigo_producto) || 1);
        porCodigo.set(d.codigo_producto, linea);
    }));

    return {
        hayPedidos: pedidos.length > 0,
        enTransito: pedidos.some(p => p.estado === 'EN_TRANSITO'),
        lineas: [...porCodigo.values()],
        docnums: [...new Set(pedidos.map(p => p.sap_traslado_docnum).filter(Boolean))]
    };
}

module.exports = { datosClientesTicket, bloquesClientesRuta, bloquesClientesDetalle, bloquesClientesEnTransito, datosClientesResumenRuta, productosClientesReporte };
