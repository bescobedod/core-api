const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class RolModel extends Model {}

RolModel.init({
    id_rol: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    nombre: { type: DataTypes.STRING(50), allowNull: false },
    descripcion: { type: DataTypes.TEXT, allowNull: true },
    fecha_creacion: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    fecha_actualizacion: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_rol',
    schema: 'config',
    timestamps: false
});

module.exports = RolModel;