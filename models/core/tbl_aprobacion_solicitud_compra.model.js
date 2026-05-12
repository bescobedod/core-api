const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class AprobacionSolicitudCompraModel extends Model {}

AprobacionSolicitudCompraModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    requisicion_id: { type: DataTypes.UUID,  allowNull: true },
    nivel: { type: DataTypes.INTEGER, allowNull: true },
    usuario_aprobador_id: { type: DataTypes.UUID, allowNull: true },
    estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'PENDIENTE' },
    comentarios: { type: DataTypes.TEXT, allowNull: false },
    fecha_aprobacion: { type: DataTypes.DATE, allowNull: true },
    fecha_creacion: { type: DataTypes.DATE, allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_aprobacion_solicitud_compra',
    schema: 'compras',
    timestamps: false
});

module.exports = AprobacionSolicitudCompraModel;