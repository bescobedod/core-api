const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class ValesCombustibleModel extends Model {}

ValesCombustibleModel.init({
    id_vale: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    id_usuario: { type: DataTypes.BIGINT, allowNull: false, },
    placa_vehiculo: { type: DataTypes.STRING(20), allowNull: false },
    monto: { type: DataTypes.DECIMAL(10,2), allowNull: false },
    foto_vale_url: { type: DataTypes.TEXT, allowNull: true },
    foto_bomba_url: { type: DataTypes.TEXT, allowNull: true },
    coordenadas: { type: DataTypes.JSONB }
}, {
    sequelize: sequelize,
    tableName: 'tbl_vales_combustible',
    schema: 'logistica',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
});

module.exports = ValesCombustibleModel;