const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class MarcajeZonaModel extends Model {}

MarcajeZonaModel.init({
    id_zona: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    nombre: { type: DataTypes.STRING(100), allowNull: false },
    latitud: { type: DataTypes.DECIMAL(10, 7), allowNull: false },
    longitud: { type: DataTypes.DECIMAL(10, 7), allowNull: false },
    radio_metros: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 150 },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_marcaje_zona',
    schema: 'logistica',
    timestamps: true,
    updatedAt: false
});

module.exports = MarcajeZonaModel;
