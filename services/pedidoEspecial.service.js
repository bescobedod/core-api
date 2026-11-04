const sequelizeInit = require('../configuration/db');
const initTiendaModel = require('../models/pdv/tTienda.model');
const PedidoEspecialModel = require('../models/core/tbl_pedido_especial.model');
const PedidoEspecialDetalleModel = require('../models/core/tbl_pedido_especial_detalle.model');
const PedidoEspecialHistorialModel = require('../models/core/tbl_pedido_especial_historial.model');

// Vendor Name del archivo de Simphony que identifica un pedido especial.
const VENDOR_PEDIDO_ESPECIAL = 'PE AVICOLA';

function esPedidoEspecial(vendorName) {
    return (vendorName || '').trim().toUpperCase() === VENDOR_PEDIDO_ESPECIAL;
}

// Oracle Simphony manda fechas como 'AAAAMMDD' (ej. '20260718').
function formatearFechaOracle(valor) {
    if (!valor) return null;

    const texto = valor.toString();

    return `${texto.substring(0, 4)}-${texto.substring(4, 6)}-${texto.substring(6, 8)}`;
}

// Guarda un pedido especial del archivo de Simphony en sus propias tablas, en
// estado PENDIENTE_APROBACION. A diferencia de guardarPedidoPos no resuelve
// ruta ni tipo: los especiales no van en camión, los recoge el supervisor.
async function guardarPedidoEspecial(datosPedido, archivo_origen) {
    const {
        vendor_name,
        vendor_id,
        numero_pedido,
        fecha_pedido,
        hora_pedido,
        delivery_location_id,
        lineas
    } = datosPedido;

    const sequelizeCore = await sequelizeInit.sequelizeInit('CORE');
    const t = await sequelizeCore.transaction();

    try {
        if (!delivery_location_id) {
            throw new Error('El pedido especial no trae la tienda (Delivery Location ID)');
        }

        const fecha_requerida = lineas.length > 0 ? formatearFechaOracle(lineas[0].fecha_entrega) : null;

        if (!fecha_requerida) {
            throw new Error('El pedido especial no trae fecha requerida');
        }

        const sequelizePdv = await sequelizeInit.sequelizeInit('PDV');
        const TiendaModel = initTiendaModel(sequelizePdv);
        const tienda = await TiendaModel.findOne({ where: { StoreNumberSimphony: delivery_location_id } });

        const ahora = new Date();

        const cabecera = await PedidoEspecialModel.create({
            codigo_empresa: tienda ? tienda.empresa : null,
            codigo_tienda: delivery_location_id,
            nombre_tienda: tienda ? tienda.tda_nombre : null,
            codigo_bodega: tienda ? tienda.whsCode : null,
            numero_pedido,
            fecha_pedido: formatearFechaOracle(fecha_pedido),
            hora_pedido,
            fecha_requerida,
            estado: 'PENDIENTE_APROBACION',
            // Pendiente: todavía no está definido de qué campo del .txt sale el comentario.
            comentario: null,
            codigo_bodega_simphony: vendor_id || null,
            nombre_bodega_simphony: vendor_name || null,
            archivo_origen: archivo_origen || null,
            fecha_recepcion: ahora,
            creado_en: ahora,
            actualizado_en: ahora
        }, { transaction: t });

        await PedidoEspecialDetalleModel.bulkCreate(lineas.map(linea => ({
            pedido_id: cabecera.id,
            numero_linea: linea.posicion,
            codigo_producto: linea.item_no || null,
            descripcion_producto: linea.nombre_articulo,
            unidad_medida: linea.unidad_orden,
            factor: linea.factor || 1,
            precio_unitario: linea.precio || null,
            importe_total: linea.cantidad && linea.precio ? linea.cantidad * linea.precio : null,
            cantidad_original: linea.cantidad,
            cantidad_solicitada: linea.cantidad,
            creado_en: ahora,
            actualizado_en: ahora
        })), { transaction: t });

        await PedidoEspecialHistorialModel.create({
            pedido_id: cabecera.id,
            estado_anterior: null,
            estado_nuevo: 'PENDIENTE_APROBACION',
            usuario: null,
            comentario: 'Pedido especial recibido desde Simphony',
            fecha: ahora
        }, { transaction: t });

        await t.commit();

        return {
            success: true,
            tipo: 'ESPECIAL',
            id_pedido: cabecera.id,
            numero_pedido,
            estado: 'PENDIENTE_APROBACION',
            total_lineas: lineas.length
        };
    } catch (error) {
        await t.rollback();

        return {
            success: false,
            tipo: 'ESPECIAL',
            numero_pedido,
            error: error.message
        };
    }
}

module.exports = { esPedidoEspecial, formatearFechaOracle, guardarPedidoEspecial };
