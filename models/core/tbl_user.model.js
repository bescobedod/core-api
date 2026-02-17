const { Model, DataTypes } = require('sequelize');

class UserModel extends Model {}

function initUserModel(sequelizeInstance) {
    UserModel.init({
        id_usuario: { type: DataTypes.STRING(6), allowNull: true, primaryKey: true },
        estado: { type: DataTypes.INTEGER, allowNull: true },
        nombre_completo: { type: DataTypes.STRING(200), allowNull: true },
        email: { type: DataTypes.STRING(100), allowNull: true },
        contrasena: { type: DataTypes.TEXT, allowNull: true },
        id_rol: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        sequelize: sequelizeInstance,
        tableName: 'tbl_usuario',
        schema: 'lg',
        timestamps: false
    });

    return UserModel
}

module.exports = initUserModel;