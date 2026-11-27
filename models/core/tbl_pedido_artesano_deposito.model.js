const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class PedidoArtesanoDepositoModel extends Model {}

// Depósitos de un pedido: puede haber varios hasta cubrir el total.
PedidoArtesanoDepositoModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    pedido_id: { type: DataTypes.UUID, allowNull: false },
    numero_boleta: { type: DataTypes.STRING(50), allowNull: false },
    banco: { type: DataTypes.STRING(100), allowNull: true },
    fecha_deposito: { type: DataTypes.DATEONLY, allowNull: false },
    monto: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    creado_por: { type: DataTypes.BIGINT, allowNull: false },
    creado_por_nombre: { type: DataTypes.STRING(150), allowNull: true },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_pedido_artesano_deposito',
    schema: 'logistica',
    timestamps: false
})

module.exports = PedidoArtesanoDepositoModel;
