const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class PedidoArtesanoDetalleModel extends Model {}

PedidoArtesanoDetalleModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    pedido_id: { type: DataTypes.UUID, allowNull: false },
    numero_linea: { type: DataTypes.INTEGER, allowNull: false },
    codigo_producto: { type: DataTypes.STRING(30), allowNull: false },
    descripcion_producto: { type: DataTypes.STRING(200), allowNull: true },
    unidad_medida: { type: DataTypes.STRING(30), allowNull: true },
    cantidad: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    cantidad_autorizada: { type: DataTypes.DECIMAL(14, 3), allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_pedido_artesano_detalle',
    schema: 'logistica',
    timestamps: false
})

module.exports = PedidoArtesanoDetalleModel;
