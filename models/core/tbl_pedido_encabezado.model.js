const { Model, DataTypes } = require('sequelize');

class PedidoEncabezadoModel extends Model {}

function initPedidoEncabezadoModel(sequelizeInstance) {
    PedidoEncabezadoModel.init({
        id_pedido: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
        id_tipo: { type: DataTypes.UUID, allowNull: false },
        id_supervisor: { type: DataTypes.UUID, allowNull: false },
        total_productos: { type: DataTypes.INTEGER, allowNull: false },
        fecha_requerida: { type: DataTypes.DATEONLY, allowNull: false},
        id_estado_pedido: { type: DataTypes.INTEGER, allowNull: false },
        id_empresa: { type: DataTypes.STRING(20), allowNull: true },
        id_tienda: { type: DataTypes.STRING(20), allowNull: true },
        id_bodega: { type: DataTypes.TEXT, allowNull: true }
    }, {
        sequelize: sequelizeInstance,
        tableName: 'tbl_pedido_encabezado',
        schema: 'logistica',
        timestamps: false
    });

    return PedidoEncabezadoModel;
}

module.exports = initPedidoEncabezadoModel;