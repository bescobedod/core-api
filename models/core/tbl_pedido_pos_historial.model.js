const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class PedidoPosHistorialModel extends Model {}

PedidoPosHistorialModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    pedido_id: { type: DataTypes.UUID, allowNull: false },
    estado_anterior: { type: DataTypes.STRING(30), allowNull: true },
    estado_nuevo: { type: DataTypes.STRING(30), allowNull: false },
    usuario: { type: DataTypes.STRING(100), allowNull: true },
    comentario: { type: DataTypes.TEXT, allowNull: true },
    fecha: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize: sequelize,
    tableName: 'tbl_pedidos_pos_historial',
    schema: 'logistica',
    timestamps: false
})

module.exports = PedidoPosHistorialModel;