const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class UsuarioMuellePolloModel extends Model {}

UsuarioMuellePolloModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    id_usuario: { type: DataTypes.BIGINT, allowNull: false },
    whs_code_origen: { type: DataTypes.STRING(20), allowNull: false },
    nombre_muelle: { type: DataTypes.STRING(100), allowNull: true },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creado_en: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize: sequelize,
    tableName: 'tbl_usuario_muelle_pollo',
    schema: 'logistica',
    timestamps: false
})

module.exports = UsuarioMuellePolloModel;