const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');
const PedidoEspecialDetalleModel = require('./tbl_pedido_especial_detalle.model');
const PedidoEspecialHistorialModel = require('./tbl_pedido_especial_historial.model');

class PedidoEspecialModel extends Model {}

// Pedidos especiales: llegan de Simphony con el vendor PE AVICOLA, se
// autorizan en Core y los recoge el supervisor (no llevan ruta ni camión).
// Viven en sus propias tablas, aparte de tbl_pedidos_pos_*.
PedidoEspecialModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    codigo_empresa: { type: DataTypes.STRING(12), allowNull: true },
    codigo_tienda: { type: DataTypes.STRING(20), allowNull: false }, // StoreNumberSimphony
    nombre_tienda: { type: DataTypes.STRING(150), allowNull: true },
    codigo_bodega: { type: DataTypes.STRING(20), allowNull: true },
    numero_pedido: { type: DataTypes.STRING(30), allowNull: false },
    fecha_pedido: { type: DataTypes.DATEONLY, allowNull: false },
    hora_pedido: { type: DataTypes.TIME, allowNull: false },
    fecha_requerida: { type: DataTypes.DATEONLY, allowNull: false },
    estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'PENDIENTE_APROBACION' },
    comentario: { type: DataTypes.TEXT, allowNull: true },
    codigo_bodega_simphony: { type: DataTypes.STRING(20), allowNull: true },
    nombre_bodega_simphony: { type: DataTypes.STRING(150), allowNull: true },
    archivo_origen: { type: DataTypes.STRING(200), allowNull: true },
    fecha_recepcion: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    autorizado_por: { type: DataTypes.BIGINT, allowNull: true },
    autorizado_por_nombre: { type: DataTypes.STRING(150), allowNull: true },
    fecha_autorizacion: { type: DataTypes.DATE, allowNull: true },
    motivo_rechazo: { type: DataTypes.TEXT, allowNull: true },
    fecha_preparacion: { type: DataTypes.DATE, allowNull: true },
    fecha_listo: { type: DataTypes.DATE, allowNull: true },
    usuario_listo: { type: DataTypes.STRING(150), allowNull: true },
    // Los llena PioApp al confirmar la recepción — Core solo los lee.
    sap_delivery_docentry: { type: DataTypes.INTEGER, allowNull: true },
    sap_delivery_docnum: { type: DataTypes.INTEGER, allowNull: true },
    sap_entry_docentry: { type: DataTypes.INTEGER, allowNull: true },
    sap_entry_docnum: { type: DataTypes.INTEGER, allowNull: true },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    actualizado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_pedido_especial',
    schema: 'logistica',
    timestamps: false
})

PedidoEspecialModel.hasMany(PedidoEspecialDetalleModel, { foreignKey: 'pedido_id', as: 'detalle' });
PedidoEspecialDetalleModel.belongsTo(PedidoEspecialModel, { foreignKey: 'pedido_id', as: 'pedido' });
PedidoEspecialModel.hasMany(PedidoEspecialHistorialModel, { foreignKey: 'pedido_id', as: 'historial' });

module.exports = PedidoEspecialModel;
