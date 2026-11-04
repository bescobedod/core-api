const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class PedidoArtesanoProductoModel extends Model {}

// Códigos de SAP (IPTV...) que se pueden pedir como pollo artesano. Hay varios
// códigos de artesano que varían por peso, pero solo los que están activos
// aquí se ofrecen en el pedido; habilitar otro es cambiar esta tabla.
PedidoArtesanoProductoModel.init({
    codigo_producto: { type: DataTypes.STRING(30), primaryKey: true, allowNull: false },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_pedido_artesano_producto',
    schema: 'logistica',
    timestamps: false
})

module.exports = PedidoArtesanoProductoModel;
