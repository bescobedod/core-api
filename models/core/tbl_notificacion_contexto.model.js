const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class NotificacionContextoModel extends Model {}

NotificacionContextoModel.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    codigo: { type: DataTypes.STRING(50), allowNull: false },
    nombre: { type: DataTypes.STRING(150), allowNull: false },
    descripcion: { type: DataTypes.STRING(255), allowNull: true },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_notificacion_contextos',
    schema: 'config',
    timestamps: false
});

module.exports = NotificacionContextoModel;