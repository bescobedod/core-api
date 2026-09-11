const { Model, DataTypes } = require('sequelize');
const { sequelizePioApp } = require('../../configuration/db');

class UsuarioUbicacionLogModel extends Model {}

UsuarioUbicacionLogModel.init({
    id_log: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
    id_usuario: { type: DataTypes.BIGINT, allowNull: false },
    fecha_hora: { type: DataTypes.DATE, allowNull: false },
    latitud: { type: DataTypes.STRING(50), allowNull: false },
    longitud: { type: DataTypes.STRING(50), allowNull: false },
    bateria_nivel: { type: DataTypes.INTEGER, allowNull: true },
    dispositivo_uuid: { type: DataTypes.STRING(150), allowNull: true },
    dispositivo_info: { type: DataTypes.TEXT, allowNull: true },
    ip_address: { type: DataTypes.STRING(50), allowNull: true }
}, {
    sequelize: sequelizePioApp,
    tableName: 'usuario_ubicacion_logs',
    schema: 'app',
    timestamps: true
});

module.exports = UsuarioUbicacionLogModel;