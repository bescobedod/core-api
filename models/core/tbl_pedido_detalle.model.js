const { Model, DataTypes } = require('sequelize');

class PedidoDetalleModel extends Model {}

function initPedidoDetalleModel(sequelizeInstance) {
    PedidoDetalleModel.init({
        id_pedido_detalle: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
        id_pedido: { type: DataTypes.UUID, allowNull: false },
        codigo_articulo: { type: DataTypes.STRING(50), allowNull: false },
        cantidad: { type: DataTypes.INTEGER, allowNull: false },
        nombre_articulo: { type: DataTypes.STRING(255), allowNull: false},
        descripcion: { type: DataTypes.TEXT, allowNull: false },
        unidad_medida: { type: DataTypes.STRING(50), allowNull: true }
    }, {
        sequelize: sequelizeInstance,
        tableName: 'tbl_pedido_detalle',
        schema: 'logistica',
        timestamps: false,
        indexes: [
            {
                name: 'pedido_articulo_unique',
                unique: true,
                fields: ['id_pedido', 'codigo_articulo']
            }
        ]
    });

    return PedidoDetalleModel;
}

module.exports = initPedidoDetalleModel;