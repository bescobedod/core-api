const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../../configuration/db');

class VwSolicitudCompraModel extends Model {}

VwSolicitudCompraModel.init({
    id: { type: DataTypes.UUID, primaryKey: true },
    numero_requisicion: { type: DataTypes.STRING(50) },
    departamento_id: { type: DataTypes.UUID },
    codigo: { type: DataTypes.STRING },
    nombre: { type: DataTypes.STRING },
    solicitado_por: { type: DataTypes.STRING },
    solicitado_por_id: { type: DataTypes.UUID },
    estrategia_adquisicion_id: { type: DataTypes.UUID },
    codigo_estrategia: { type: DataTypes.STRING },
    estrategia_adquisicion: { type: DataTypes.STRING },
    estado: { type: DataTypes.STRING(30) },
    justificacion: { type: DataTypes.TEXT },
    fecha_requerida: { type: DataTypes.DATEONLY },
    fecha_creacion: { type: DataTypes.DATE },
    nivel_aprobador: { type: DataTypes.INTEGER },
    cantidad_articulos: { type: DataTypes.INTEGER },
    cantidad_total: { type: DataTypes.INTEGER },
    es_activo_fijo: { type: DataTypes.BOOLEAN },
    DocEntry: { type: DataTypes.INTEGER, allowNull: true },
    DocNum: { type: DataTypes.INTEGER, allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'vw_solicitud_compra',
    schema: 'compras',
    timestamps: false,
    underscored: false
});

module.exports = VwSolicitudCompraModel;