const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class MatrizAprobacionOrdenModel extends Model {}

MatrizAprobacionOrdenModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    estrategia_adquisicion_id: { type: DataTypes.UUID, allowNull: false },
    monto_minimo: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    monto_maximo: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    moneda: { type: DataTypes.STRING(3), allowNull: false },
    prioridad: { type: DataTypes.INTEGER, allowNull: false },
    esta_activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    fecha_creacion: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    fecha_actualizacion: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    departamento_id: { type: DataTypes.UUID, allowNull: true },
    nombre: { type: DataTypes.STRING(250), allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_matriz_aprobacion_orden_compra',
    schema: 'compras',
    timestamps: true,
    createdAt: 'fecha_creacion',
    updatedAt: 'fecha_actualizacion'
});

module.exports = MatrizAprobacionOrdenModel;