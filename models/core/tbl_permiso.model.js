const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class PermisoModel extends Model {}

PermisoModel.init({
    id_permiso: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false },
    id_users: { type: DataTypes.BIGINT },
    id_rol: { type: DataTypes.INTEGER }
}, {
    sequelize: sequelize,
    tableName: 'tbl_permiso',
    schema: 'config',
    timestamps: false
});

module.exports = PermisoModel;