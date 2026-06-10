const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class AprobacionOrdenCompraModel extends Model {}

AprobacionOrdenCompraModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    orden_compra_id: { type: DataTypes.UUID,  allowNull: true },
    nivel: { type: DataTypes.INTEGER, allowNull: true },
    usuario_aprobador_id: { type: DataTypes.BIGINT, allowNull: false },
    delegado_desde_usuario_id: { type: DataTypes.BIGINT, allowNull: true },
    estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'PENDIENTE' },
    comentarios: { type: DataTypes.TEXT, allowNull: false },
    fecha_aprobacion: { type: DataTypes.DATE, allowNull: true },
    fecha_creacion: { type: DataTypes.DATE, allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_aprobacion_orden_compra',
    schema: 'compras',
    timestamps: false
});

module.exports = AprobacionOrdenCompraModel;