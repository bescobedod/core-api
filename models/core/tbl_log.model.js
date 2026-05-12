const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class LogModel extends Model {}

LogModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    fecha_hora: { type: DataTypes.DATE },
    nivel: { type: DataTypes.STRING(10) },
    mensaje: { type: DataTypes.TEXT },
    servicio: { type: DataTypes.STRING(50) },
    modulo: { type: DataTypes.STRING(50) },
    accion: { type: DataTypes.STRING(50) },
    usuario: { type: DataTypes.UUID },
    error_nombre: { type: DataTypes.TEXT },
    error_descripcion: { type: DataTypes.TEXT },
    status_code: { type: DataTypes.INTEGER },
    metodo: { type: DataTypes.STRING(10) },
    endpoint: { type: DataTypes.TEXT },
    parametros: { type: DataTypes.JSONB },
    body: { type: DataTypes.JSONB },
    tiempo_respuesta_ms: { type: DataTypes.INTEGER },
    solicitud_id: { type: DataTypes.STRING(100) }
}, {
    sequelize: sequelize,
    tableName: 'tbl_log',
    schema: 'logs',
    timestamps: false
});

module.exports = LogModel;