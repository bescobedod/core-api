const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class NotificacionDestinatarioModel extends Model {}

NotificacionDestinatarioModel.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    contexto: { type: DataTypes.STRING(50), allowNull: false },
    email: { type: DataTypes.STRING(200), allowNull: false },
    nombre: { type: DataTypes.STRING(150), allowNull: true },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_notificacion_destinatarios',
    schema: 'config',
    timestamps: false
});

module.exports = NotificacionDestinatarioModel;