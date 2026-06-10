const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class NivelMatrizAprobacionOrdenModel extends Model {}

NivelMatrizAprobacionOrdenModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    matriz_id: { type: DataTypes.UUID, allowNull: false },
    nivel: { type: DataTypes.INTEGER, allowNull: false },
    usuario_aprobador_id: { type: DataTypes.BIGINT, allowNull: false },
    es_requerido: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    puede_delegar: { type: DataTypes.BOOLEAN, allowNull: false,defaultValue: false },
    timeout_aprobacion_horas: { type: DataTypes.INTEGER, allowNull: true },
    fecha_creacion: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    fecha_actualizacion: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_nivel_matriz_aprobacion_orden_compra',
    schema: 'compras',
    timestamps: true,
    createdAt: 'fecha_creacion',
    updatedAt: 'fecha_actualizacion'
});

module.exports = NivelMatrizAprobacionOrdenModel;