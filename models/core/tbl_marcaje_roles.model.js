const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class MarcajeRolesModel extends Model {}

MarcajeRolesModel.init({
    id_marcaje_rol: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    id_rol: { type: DataTypes.INTEGER, allowNull: false },
    prefijo: { type: DataTypes.STRING(10), allowNull: false },
    fecha_creacion: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_marcaje_roles',
    schema: 'config',
    timestamps: false
});

module.exports = MarcajeRolesModel;
