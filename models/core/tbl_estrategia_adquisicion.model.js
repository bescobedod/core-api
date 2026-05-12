const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class EstrategiaAdquisicionModel extends Model {}

EstrategiaAdquisicionModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    codigo: { type: DataTypes.STRING(20),  allowNull: true },
    nombre: { type: DataTypes.STRING(100), allowNull: false },
    descripcion: { type: DataTypes.TEXT, allowNull: false },
    requiere_cotizaciones: { type: DataTypes.BOOLEAN, allowNull: true },
    minimo_cotizaciones: { type: DataTypes.INTEGER, allowNull: true },
    esta_activo: { type: DataTypes.BOOLEAN, allowNull: true },
    departamento_id: { type: DataTypes.UUID, allowNull: true },
    area_id: { type: DataTypes.UUID, allowNull: true },
    codigo_departamento: { type: DataTypes.STRING(20), allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_estrategia_adquisicion',
    schema: 'compras',
    timestamps: false,
    createdAt: 'fecha_creacion',
    updatedAt: 'fecha_actualizacion'
});

module.exports = EstrategiaAdquisicionModel;