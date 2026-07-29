const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class EquivalenciaBodegaModel extends Model {}

EquivalenciaBodegaModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    codigo_bodega_simphony: { type: DataTypes.STRING(20), allowNull: false },
    nombre_bodega_simphony: { type: DataTypes.STRING(150), allowNull: true },
    codigo_bodega_sap: { type: DataTypes.STRING(20), allowNull: true },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creado_en: { type: DataTypes.DATE, allowNull: false },
    actualizado_en: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize: sequelize,
    tableName: 'equivalencia_bodegas',
    schema: 'config',
    timestamps: false
})

module.exports = EquivalenciaBodegaModel;