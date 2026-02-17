const { Model, DataTypes } = require('sequelize');

class TipoPedidoEnvioModel extends Model {}

function initTipoPedidoEnvioModel(sequelizeInstance) {
    TipoPedidoEnvioModel.init({
        id_tipo: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        nombre: { type: DataTypes.STRING(50), allowNull: true },
        descripcion: { type: DataTypes.TEXT, allowNull: true }
    }, {
        sequelize: sequelizeInstance,
        tableName: 'tbl_tipo_pedido_envio',
        schema: 'logistica',
        timestamps: false
    });

    return TipoPedidoEnvioModel;
}

module.exports = initTipoPedidoEnvioModel;