const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class VisitaEvidenciaModel extends Model {}

VisitaEvidenciaModel.init({
    id_evidencia: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    id_visita: { type: DataTypes.UUID, allowNull: false },
    tipo_archivo: { type: DataTypes.STRING(10), allowNull: false },
    url_s3: { type: DataTypes.TEXT, allowNull: false },
    orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    es_obligatoria: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
}, {
    sequelize: sequelize,
    tableName: 'tbl_visita_evidencia',
    schema: 'logistica',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: false
})

module.exports = VisitaEvidenciaModel;
