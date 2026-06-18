const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class CamionModel extends Model {}

CamionModel.init({
    id_camion: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    placa: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    marca: { type: DataTypes.STRING(100), allowNull: true },
    linea: { type: DataTypes.STRING(100), allowNull: true },
    modelo: { type: DataTypes.INTEGER, allowNull: true },
    color: { type: DataTypes.STRING(50), allowNull: true },
    kilometraje_actual: { type: DataTypes.INTEGER, defaultValue: 0 },
    kilometraje_ultimo_mantenimiento: { type: DataTypes.INTEGER, defaultValue: 0 },
    intervalo_mantenimiento: { type: DataTypes.INTEGER, defaultValue: 5000 },
    id_supervisor: { type: DataTypes.BIGINT },
    id_conductor_habitual: { type: DataTypes.BIGINT },
    tarjeta_circulacion: { type: DataTypes.STRING(100) },
    vencimiento_seguro: { type: DataTypes.DATEONLY },
    foto_camion_url: { type: DataTypes.TEXT },
    estado: { type: DataTypes.STRING(20), defaultValue: 'ACTIVO' },
    nombre_conductor_ultimo: { type: DataTypes.STRING(255) },
    numero_licencia_ultimo: { type: DataTypes.STRING(50) }
}, {
    sequelize: sequelize,
    tableName: 'tbl_camiones',
    schema: 'logistica',
    timestamps: false,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
});

module.exports = CamionModel;