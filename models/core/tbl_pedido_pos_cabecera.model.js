const { Model, DataTypes, Op } = require('sequelize');
const { sequelize } = require('../../configuration/db');

const ESTADO_CANCELADO = 'CANCELADO';

class PedidoPosCabeceraModel extends Model {}

PedidoPosCabeceraModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    codigo_empresa: { type: DataTypes.STRING(12), allowNull: true },
    codigo_tienda: { type: DataTypes.STRING(20), allowNull: true },
    numero_pedido: { type: DataTypes.STRING(30), allowNull: false },
    fecha_pedido: { type: DataTypes.DATEONLY, allowNull: false },
    fecha_requerida: { type: DataTypes.DATEONLY, allowNull: true }, // tomada de la primera línea del archivo; se asume que todas las líneas comparten la misma fecha
    hora_pedido: { type: DataTypes.TIME, allowNull: false },
    nombre_tienda: { type: DataTypes.STRING(150), allowNull: true },
    codigo_bodega: { type: DataTypes.STRING(20), allowNull: true }, // resuelto en SAP, desde tTienda.whsCode
    tipo_pedido: { type: DataTypes.STRING(20), allowNull: true }, // POLLO o INSUMOS, derivado del Vendor ID del archivo
    codigo_bodega_simphony: { type: DataTypes.STRING(20), allowNull: true }, // Vendor ID del archivo (origen/bodega en Simphony)
    nombre_bodega_simphony: { type: DataTypes.STRING(150), allowNull: true }, // Vendor Name del archivo
    nombre_bodega: { type: DataTypes.STRING(150), allowNull: true },
    ruta_id: { type: DataTypes.UUID, allowNull: true },
    nombre_ruta: { type: DataTypes.STRING(100), allowNull: true },
    estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'RECIBIDO' },
    archivo_origen: { type: DataTypes.STRING(200), allowNull: true },
    lote_validacion_id: { type: DataTypes.UUID, allowNull: true },
    fecha_recepcion: { type: DataTypes.DATE, allowNull: false },
    fecha_validacion: { type: DataTypes.DATE, allowNull: true },
    usuario_ajuste: { type: DataTypes.STRING(100), allowNull: true },
    fecha_envio_sap: { type: DataTypes.DATE, allowNull: true },
    sap_docentry: { type: DataTypes.INTEGER, allowNull: true },
    sap_docnum: { type: DataTypes.INTEGER, allowNull: true },
    sap_error: { type: DataTypes.TEXT, allowNull: true },
    creado_en: { type: DataTypes.DATE, allowNull: false },
    actualizado_en: { type: DataTypes.DATE, allowNull: false },
    fecha_asignacion_transporte: { type: DataTypes.DATE, allowNull: true },
    usuario_asigno_transporte: { type: DataTypes.STRING(100), allowNull: true },
    camion_id: { type: DataTypes.UUID, allowNull: true },
    camion_placa: { type: DataTypes.STRING(20), allowNull: true },
    piloto_id: { type: DataTypes.BIGINT, allowNull: true },
    piloto_nombre: { type: DataTypes.STRING(500), allowNull: true },
    // Los llena un sistema externo (no Core) al crear el Delivery/Entrada en
    // SAP cuando la tienda confirma la recepción — Core solo los lee.
    sap_delivery_docentry: { type: DataTypes.INTEGER, allowNull: true },
    sap_delivery_docnum: { type: DataTypes.INTEGER, allowNull: true },
    sap_entry_docentry: { type: DataTypes.INTEGER, allowNull: true },
    sap_entry_docnum: { type: DataTypes.INTEGER, allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_pedidos_pos_cabecera',
    schema: 'logistica',
    timestamps: false,
    // Los pedidos CANCELADOS no se borran (quedan para auditoría), pero no
    // deben aparecer en ninguna vista, reporte, transferencia ni ticket. Este
    // filtro se aplica a TODA consulta de la cabecera (findAll, findOne,
    // count, update e includes desde el detalle o el historial).
    // whereMergeStrategy 'and': el filtro se combina con el where de cada
    // consulta en vez de reemplazarse — sin esto, un where propio sobre
    // `estado` (p. ej. { [Op.ne]: 'PENDIENTE_ENRIQUECIMIENTO' }) borraría el
    // filtro y los cancelados entrarían a las transferencias a SAP.
    // Para leer un cancelado a propósito: PedidoPosCabeceraModel.unscoped().
    defaultScope: {
        where: { estado: { [Op.ne]: ESTADO_CANCELADO } }
    },
    whereMergeStrategy: 'and'
})

PedidoPosCabeceraModel.ESTADO_CANCELADO = ESTADO_CANCELADO;

module.exports = PedidoPosCabeceraModel;