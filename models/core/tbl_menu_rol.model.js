const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class MenuRolModel extends Model {}

MenuRolModel.init({
    id_menu_rol: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    id_rol: { type: DataTypes.INTEGER, allowNull: false },
    id_menu: { type: DataTypes.INTEGER, allowNull: false },
    fecha_creacion: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    fecha_actualizacion: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    id_rol_core: { type: DataTypes.INTEGER, allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_menu_rol',
    schema: 'config',
    timestamps: true,
    createdAt: 'fecha_creacion',
    updatedAt: 'fecha_actualizacion'
})

module.exports = MenuRolModel;