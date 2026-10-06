const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');
const VisitaEvidenciaModel = require('./tbl_visita_evidencia.model');

class VisitaModel extends Model {}

VisitaModel.init({
    id_visita: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    id_usuario: { type: DataTypes.BIGINT, allowNull: false },
    id_empresa: { type: DataTypes.UUID, allowNull: false },
    whs_code: { type: DataTypes.STRING(20), allowNull: false },
    whs_name: { type: DataTypes.STRING(150), allowNull: true },
    comentario: { type: DataTypes.TEXT, allowNull: false },
    phone_gps_latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
    phone_gps_longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
    photo_gps_latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
    photo_gps_longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
    device_uuid: { type: DataTypes.STRING(150), allowNull: true },
    device_model: { type: DataTypes.STRING(150), allowNull: true },
    device_so: { type: DataTypes.STRING(150), allowNull: true },
    is_offline: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    fecha_visita: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize: sequelize,
    tableName: 'tbl_visita',
    schema: 'logistica',
    timestamps: true
})

VisitaModel.hasMany(VisitaEvidenciaModel, { foreignKey: 'id_visita', as: 'evidencias' });
VisitaEvidenciaModel.belongsTo(VisitaModel, { foreignKey: 'id_visita', as: 'visita' });

module.exports = VisitaModel;
