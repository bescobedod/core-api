const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class PedidoArtesanoProductoModel extends Model {}

// Códigos de SAP (IPTV...) que se pueden pedir como pollo artesano. Hay varios
// códigos de artesano que varían por peso, pero solo los que están activos
// aquí se ofrecen en el pedido; habilitar otro es cambiar esta tabla.
// factor_caja: unidades por caja; factor_libras: libras por unidad (NULL = no aplica).
PedidoArtesanoProductoModel.init({
    codigo_producto: { type: DataTypes.STRING(30), primaryKey: true, allowNull: false },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    factor_caja: { type: DataTypes.DECIMAL(10, 3), allowNull: true },
    factor_libras: { type: DataTypes.DECIMAL(10, 3), allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_pedido_artesano_producto',
    schema: 'logistica',
    timestamps: false
})

module.exports = PedidoArtesanoProductoModel;
