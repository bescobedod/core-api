const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class MatrizAprobacionSolicitudModel extends Model {}

MatrizAprobacionSolicitudModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    departamento_id: { type: DataTypes.UUID, allowNull: false },
    estrategia_adquisicion_id: { type: DataTypes.UUID, allowNull: false},
    prioridad: { type: DataTypes.INTEGER, allowNull: false },
    esta_activo: { type: DataTypes.BOOLEAN, defaultValue: true },
    fecha_creacion: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    fecha_actualizacion: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    nombre: { type: DataTypes.STRING(250) }
}, {
    sequelize: sequelize,
    tableName: 'tbl_matriz_aprobacion_solicitud_compra',
    schema: 'compras',
    timestamps: true,
    createdAt: 'fecha_creacion',
    updatedAt: 'fecha_actualizacion'
});

module.exports = MatrizAprobacionSolicitudModel;