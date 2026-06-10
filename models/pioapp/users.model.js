const { Model, DataTypes } = require('sequelize');
const { sequelizePioApp } = require('../../configuration/db');

class UsersModel extends Model {}

UsersModel.init({
    id_users: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
    codigo_user: { type: DataTypes.STRING(100), allowNull: false },
    id_rol: { type: DataTypes.INTEGER, allowNull: false },
    first_name: { type: DataTypes.STRING(500), allowNull: false },
    second_name: { type: DataTypes.STRING(500), allowNull: true },
    first_last_name: { type: DataTypes.STRING(500), allowNull: true },
    second_last_name: { type: DataTypes.STRING(500), allowNull: true },
    email: { type: DataTypes.STRING(500), allowNull: true },
    password: { type: DataTypes.TEXT, allowNull: false },
    dpi: { type: DataTypes.TEXT, allowNull: true },
    fecha_nacimiento: { type: DataTypes.DATE, allowNull: true },
    direccion: { type: DataTypes.STRING(500), allowNull: true },
    puesto_trabajo: { type: DataTypes.STRING(500), allowNull: true },
    userCreatedAt: { type: DataTypes.BIGINT, allowNull: true },
    userUpdatedAt: { type: DataTypes.BIGINT, allowNull: true },
    division: { type: DataTypes.INTEGER, allowNull: true },
    email_office: { type: DataTypes.STRING(200), allowNull: true },
    id_departamento: { type: DataTypes.INTEGER, allowNull: true },
    id_area: { type: DataTypes.INTEGER, allowNull: true },
    id_rol_core: { type: DataTypes.INTEGER, allowNull: true }
}, {
    sequelize: sequelizePioApp,
    tableName: 'users',
    schema: 'app',
    timestamps: true
});

module.exports = UsersModel;