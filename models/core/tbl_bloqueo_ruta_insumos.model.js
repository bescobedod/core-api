const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class BloqueoRutaInsumosModel extends Model {}

BloqueoRutaInsumosModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    alcance: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'GLOBAL' },
    ruta_id: { type: DataTypes.UUID, allowNull: false },
    fecha: { type: DataTypes.DATEONLY, allowNull: false },
    id_usuario: { type: DataTypes.BIGINT, allowNull: false },
    estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'ACTIVO' },
    fecha_bloqueo: { type: DataTypes.DATE, allowNull: false },
    fecha_liberacion: { type: DataTypes.DATE, allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_bloqueo_ruta_insumos',
    schema: 'logistica',
    timestamps: false
})

module.exports = BloqueoRutaInsumosModel;