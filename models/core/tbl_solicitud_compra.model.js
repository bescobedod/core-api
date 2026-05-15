const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class SolicitudCompraModel extends Model {}

SolicitudCompraModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    numero_requisicion: { type: DataTypes.STRING(50), allowNull: true },
    departamento_id: { type: DataTypes.UUID, allowNull: false },
    solicitado_por: { type: DataTypes.BIGINT, allowNull: false },
    estrategia_adquisicion_id: { type: DataTypes.UUID, allowNull: true },
    estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'PENDIENTE' },
    monto_total: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    moneda: { type: DataTypes.STRING(3), defaultValue: 'GTQ' },
    justificacion: { type: DataTypes.TEXT, allowNull: false },
    fecha_requerida: { type: DataTypes.DATEONLY, allowNull: false },
    correlativo: { type: DataTypes.INTEGER, allowNull: true, autoIncrement: true },
    nivel_aprobador: { type: DataTypes.INTEGER, allowNull: true },
    id_aprobador: { type: DataTypes.UUID, allowNull: true },
    es_activo_fijo: { type: DataTypes.BOOLEAN, allowNull: true },
    DocEntry: { type: DataTypes.INTEGER, allowNull: true },
    DocNum: { type: DataTypes.INTEGER, allowNull: true },
    codigo_departamento: { type: DataTypes.TEXT, allowNull: true },
    id_empresa: { type: DataTypes.UUID, allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_solicitud_compra',
    schema: 'compras',
    timestamps: true,
    createdAt: 'fecha_creacion',
    updatedAt: 'fecha_actualizacion'
});

module.exports = SolicitudCompraModel;