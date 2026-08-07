const { Model, DataTypes } = require('sequelize');

class TiendaModel extends Model {}

function initTiendaModel(sequelizeInstance) {
    TiendaModel.init({
        idTienda: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        empresa: { type: DataTypes.STRING(12), allowNull: false },
        tienda: { type: DataTypes.STRING(12), allowNull: false },
        tda_nombre: { type: DataTypes.STRING(512), allowNull: false },
        direccion: { type: DataTypes.STRING(1024), allowNull: false },
        altitudGps: { type: DataTypes.STRING(100), allowNull: true },
        latitudGps: { type: DataTypes.STRING(100), allowNull: true },
        clienteSAP: { type: DataTypes.STRING(8), allowNull: false },
        whsCode: { type: DataTypes.STRING(32), allowNull: true },
        StoreNumberSimphony: { type: DataTypes.STRING(50), allowNull: true }
    }, {
        sequelize: sequelizeInstance,
        tableName: 'tTienda',
        schema: 'dbo',
        timestamps: false
    })

    return TiendaModel
}

module.exports = initTiendaModel;