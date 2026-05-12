const { Model, DataTypes } = require('sequelize');
const { sequelizePioApp } = require('../../../configuration/db');

class VwUsuariosModel extends Model {}

VwUsuariosModel.init({
    id_users: { type: DataTypes.BIGINT, primaryKey: true },
    codigo_user: { type: DataTypes.STRING(100) },
    baja: { type: DataTypes.BOOLEAN },
    id_rol: { type: DataTypes.INTEGER },
    nombre_rol: { type: DataTypes.STRING(500) },
    email: { type: DataTypes.STRING(250) },
    nombre: { type: DataTypes.TEXT },
    id_departamento: { type: DataTypes.UUID },
    nombre_departamento: { type: DataTypes.STRING(100) },
    puesto_trabajo: { type: DataTypes.STRING(500) },
    id_area: { type: DataTypes.UUID },
    nombre_area: { type: DataTypes.STRING(250) }
}, {
    sequelize: sequelizePioApp,
    tableName: 'vw_usuarios',
    schema: 'config',
    timestamps: false,
    underscored: false
});

module.exports = VwUsuariosModel;