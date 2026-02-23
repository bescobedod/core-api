const { Model, DataTypes, Sequelize } = require('sequelize');

class UserModel extends Model {}

function initUserModel(sequelizeInstance) {
    UserModel.init({
        id_usuario: { type: DataTypes.UUID, allowNull: true, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
        estado: { type: DataTypes.INTEGER, allowNull: true },
        id_rol: { type: DataTypes.INTEGER, allowNull: true },
        nombre_usuario: { type: DataTypes.STRING(200), allowNull: true },
        email: { type: DataTypes.STRING(200), allowNull: true },
        password_hash: { type: DataTypes.STRING(255), allowNull: true },
        nombre: { type: DataTypes.STRING(100), allowNull: false },
        apellido: { type: DataTypes.STRING(100), allowNull: false },
        id_departamento: { type: DataTypes.BIGINT, allowNull: false },
        esta_activo: { type: DataTypes.BOOLEAN, allowNull: false },
        fecha_ultimo_login: { type: DataTypes.DATE, allowNull: false },
        fecha_creacion: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
        fecha_actualizacion: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') }
    }, {
        sequelize: sequelizeInstance,
        tableName: 'tbl_usuario',
        schema: 'config',
        timestamps: true,
        createdAt: 'fecha_creacion',
        updatedAt: 'fecha_actualizacion'
    });

    return UserModel
}

module.exports = initUserModel;