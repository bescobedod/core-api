const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class DespachoRutaModel extends Model {}

DespachoRutaModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    ruta_id: { type: DataTypes.UUID, allowNull: false },
    fecha: { type: DataTypes.DATEONLY, allowNull: false },
    camion_id: { type: DataTypes.UUID, allowNull: false },
    camion_placa: { type: DataTypes.STRING(20), allowNull: true },
    piloto_id: { type: DataTypes.BIGINT, allowNull: false },
    piloto_nombre: { type: DataTypes.STRING(500), allowNull: true },
    usuario_asigno: { type: DataTypes.STRING(100), allowNull: true },
    fecha_asignacion: { type: DataTypes.DATE, allowNull: false },
    actualizado_en: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize: sequelize,
    tableName: 'tbl_despacho_ruta',
    schema: 'logistica',
    timestamps: false
})

module.exports = DespachoRutaModel;