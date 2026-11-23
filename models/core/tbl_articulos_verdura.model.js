const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

// Artículos que identifican un pedido de verduras (Corporación RM).
// Para agregar o quitar artículos basta con insertar o desactivar filas.
class ArticuloVerduraModel extends Model {}

ArticuloVerduraModel.init({
    codigo_producto: { type: DataTypes.STRING(30), primaryKey: true, allowNull: false },
    descripcion: { type: DataTypes.STRING(200), allowNull: true },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creado_en: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize: sequelize,
    tableName: 'tbl_articulos_verdura',
    schema: 'logistica',
    timestamps: false
})

module.exports = ArticuloVerduraModel;
