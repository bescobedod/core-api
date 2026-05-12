const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class MenuModel extends Model {}

MenuModel.init({
    id_menu: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    nombre: { type: DataTypes.STRING(50), allowNull: false },
    icono: { type: DataTypes.STRING(20), allowNull: false },
    nombre_menu: { type: DataTypes.STRING(50), allowNull: false },
    descripcion: { type: DataTypes.STRING(255), allowNull: false},
    visible: { type: DataTypes.BOOLEAN, allowNull: false },
    tipo: { type: DataTypes.STRING(10) }
}, {
    sequelize: sequelize,
    tableName: 'tbl_menu',
    schema: 'config',
    timestamps: false
})

module.exports = MenuModel;