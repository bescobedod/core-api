const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class UserModel extends Model {}

UserModel.init({
    id_usuario: { type: DataTypes.UUID, allowNull: true, primaryKey: true, defaultValue: sequelize.literal('gen_random_uuid()') },
    estado: { type: DataTypes.INTEGER, allowNull: true },
    id_rol: { type: DataTypes.INTEGER, allowNull: true },
    nombre_usuario: { type: DataTypes.STRING(200), allowNull: true },
    email: { type: DataTypes.STRING(200), allowNull: true },
    password_hash: { type: DataTypes.STRING(255), allowNull: true },
    nombre: { type: DataTypes.STRING(100), allowNull: false },
    apellido: { type: DataTypes.STRING(100), allowNull: false },
    codigo_empleado: { type: DataTypes.STRING(10), allowNull: false },
    id_departamento: { type: DataTypes.UUID, allowNull: false },
    esta_activo: { type: DataTypes.BOOLEAN, allowNull: false },
    fecha_ultimo_login: { type: DataTypes.DATE, allowNull: false },
    fecha_creacion: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('now()') },
    fecha_actualizacion: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('now()') },
    puesto: { type: DataTypes.TEXT, allowNull: false },
    fecha_nacimiento: { type: DataTypes.DATE, allowNull: true },
    id_area: { type: DataTypes.UUID, allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_usuario',
    schema: 'config',
    timestamps: true,
    createdAt: 'fecha_creacion',
    updatedAt: 'fecha_actualizacion'
});

module.exports = UserModel;