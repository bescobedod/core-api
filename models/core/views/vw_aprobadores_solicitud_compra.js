const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../../configuration/db');

class VwAprobadorSolicitudCompraModel extends Model {}

VwAprobadorSolicitudCompraModel.init({
    id: { type: DataTypes.UUID, primaryKey: true },
    requisicion_id: { type: DataTypes.UUID, allowNull: false },
    numero_requisicion: { type: DataTypes.STRING(50) },
    nivel: { type: DataTypes.INTEGER, allowNull: false },
    usuario_aprobador_id: { type: DataTypes.UUID, allowNull: false },
    aprobador: { type: DataTypes.TEXT, allowNull: false },
    puesto: { type: DataTypes.TEXT, allowNull: true },
    estado: { type: DataTypes.STRING(20), allowNull: false },
    comentarios: { type: DataTypes.TEXT, allowNull: false },
    fecha_aprobacion: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize: sequelize,
    tableName: 'vw_aprobadores_solicitud_compra',
    schema: 'compras',
    timestamps: false,
    underscored: false
});

module.exports = VwAprobadorSolicitudCompraModel;