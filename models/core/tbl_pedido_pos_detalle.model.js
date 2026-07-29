const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class PedidoPosDetalleModel extends Model {}

PedidoPosDetalleModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    pedido_id: { type: DataTypes.UUID, allowNull: false },
    numero_linea: { type: DataTypes.INTEGER, allowNull: false },
    codigo_producto: { type: DataTypes.STRING(30), allowNull: false },
    descripcion_producto: { type: DataTypes.STRING(200), allowNull: true },
    unidad_medida: { type: DataTypes.STRING(30), allowNull: true },
    fecha_requerida: { type: DataTypes.DATEONLY, allowNull: false },
    cantidad_solicitada: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    factor: { type: DataTypes.DECIMAL(10, 3), allowNull: true, defaultValue: 1 },
    precio_unitario: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
    importe_total: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
    stock_sap: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
    fecha_consulta_stock: { type: DataTypes.DATE, allowNull: true },
    cantidad_asignada: { type: DataTypes.DECIMAL(14, 3), allowNull: true, defaultValue: 0 },
    // cantidad_pendiente es una columna GENERATED ALWAYS en PostgreSQL
    // (cantidad_solicitada - cantidad_asignada); se lee pero nunca se envía en INSERT/UPDATE.
    cantidad_pendiente: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
    ajustado_manual: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    usuario_ajuste: { type: DataTypes.STRING(100), allowNull: true },
    fecha_ajuste: { type: DataTypes.DATE, allowNull: true },
    estado_linea: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'PENDIENTE' },
    creado_en: { type: DataTypes.DATE, allowNull: false },
    actualizado_en: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize: sequelize,
    tableName: 'tbl_pedidos_pos_detalle',
    schema: 'logistica',
    timestamps: false
})

module.exports = PedidoPosDetalleModel;