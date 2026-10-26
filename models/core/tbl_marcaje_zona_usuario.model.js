const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class MarcajeZonaUsuarioModel extends Model {}

MarcajeZonaUsuarioModel.init({
    id_zona_usuario: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    id_zona: { type: DataTypes.INTEGER, allowNull: false },
    id_usuario: { type: DataTypes.BIGINT, allowNull: false },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    fecha_alta: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    fecha_baja: { type: DataTypes.DATE, allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_marcaje_zona_usuario',
    schema: 'logistica',
    timestamps: false
});

module.exports = MarcajeZonaUsuarioModel;
