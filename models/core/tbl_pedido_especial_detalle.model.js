const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class PedidoEspecialDetalleModel extends Model {}

PedidoEspecialDetalleModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    pedido_id: { type: DataTypes.UUID, allowNull: false },
    numero_linea: { type: DataTypes.INTEGER, allowNull: false },
    codigo_producto: { type: DataTypes.STRING(30), allowNull: true },
    descripcion_producto: { type: DataTypes.STRING(200), allowNull: true },
    unidad_medida: { type: DataTypes.STRING(30), allowNull: true },
    factor: { type: DataTypes.DECIMAL(10, 3), allowNull: true, defaultValue: 1 },
    precio_unitario: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
    importe_total: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
    // Lo que pidió la tienda. cantidad_solicitada es lo que quedó autorizado
    // (la asistente de avícola puede cambiarlo al autorizar).
    cantidad_original: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    cantidad_solicitada: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    cantidad_asignada: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
    estado_linea: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'PENDIENTE' },
    usuario_ajuste: { type: DataTypes.STRING(150), allowNull: true },
    fecha_ajuste: { type: DataTypes.DATE, allowNull: true },
    // Recepción en PioApp — Core solo los lee.
    cantidad_recibida: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
    estado_recepcion: { type: DataTypes.STRING(30), allowNull: true },
    codigo_producto_entrada: { type: DataTypes.STRING(30), allowNull: true },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    actualizado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_pedido_especial_detalle',
    schema: 'logistica',
    timestamps: false
})

module.exports = PedidoEspecialDetalleModel;
