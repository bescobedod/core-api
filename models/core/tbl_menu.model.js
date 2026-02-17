const { Model, DataTypes } = require('sequelize');

class MenuModel extends Model {}

function initMenuModel(sequelizeInstance) {
    MenuModel.init({
        id_menu: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        nombre: { type: DataTypes.STRING(50), allowNull: false },
        icono: { type: DataTypes.STRING(20), allowNull: false },
        nombre_menu: { type: DataTypes.STRING(50), allowNull: false },
        descripcion: { type: DataTypes.STRING(255), allowNull: false},
        visible: { type: DataTypes.BOOLEAN, allowNull: false }
    }, {
        sequelize: sequelizeInstance,
        tableName: 'tbl_menu',
        schema: 'config',
        timestamps: false
    })

    return MenuModel
}

module.exports = initMenuModel;