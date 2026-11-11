const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class ClienteAvicolaPrecioModel extends Model {}

// Precio propio de un cliente para un producto; gana sobre los precios del producto
// (precio_colaborador / precio_tercero de tbl_pedido_artesano_producto).
ClienteAvicolaPrecioModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    cliente_id: { type: DataTypes.UUID, allowNull: false },
    codigo_producto: { type: DataTypes.STRING(30), allowNull: false },
    precio: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_cliente_avicola_precio',
    schema: 'logistica',
    timestamps: false
})

module.exports = ClienteAvicolaPrecioModel;
