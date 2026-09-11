const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class PilotoClienteSapModel extends Model {}

PilotoClienteSapModel.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    piloto_id: { type: DataTypes.BIGINT, allowNull: false },
    tipo: { type: DataTypes.STRING(10), allowNull: false },
    card_code: { type: DataTypes.STRING(20), allowNull: false },
    card_name: { type: DataTypes.STRING(200), allowNull: true },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    actualizado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_piloto_cliente_sap',
    schema: 'config',
    timestamps: true,
    createdAt: 'creado_en',
    updatedAt: 'actualizado_en'
});

module.exports = PilotoClienteSapModel;