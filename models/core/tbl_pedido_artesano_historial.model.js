const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class PedidoArtesanoHistorialModel extends Model {}

PedidoArtesanoHistorialModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    pedido_id: { type: DataTypes.UUID, allowNull: false },
    estado_anterior: { type: DataTypes.STRING(30), allowNull: true },
    estado_nuevo: { type: DataTypes.STRING(30), allowNull: false },
    usuario: { type: DataTypes.STRING(150), allowNull: true },
    comentario: { type: DataTypes.TEXT, allowNull: true },
    fecha: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_pedido_artesano_historial',
    schema: 'logistica',
    timestamps: false
})

module.exports = PedidoArtesanoHistorialModel;
