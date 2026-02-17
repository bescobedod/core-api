const initTipoPedidoEnvioModel = require('../../models/core/tbl_tipo_pedido_envio.model');
const sequelizeInit = require('../../configuration/db');
const Op = require('sequelize');

async function getAllTipoPedidoEnvio(req, res) {
    try {
        const sequelizeCore = await sequelizeInit.sequelizeInit('CORE');
        const TipoPedidoEnvioModel = initTipoPedidoEnvioModel(sequelizeCore);

        const tipoPedidoEnvios = await TipoPedidoEnvioModel.findAll({ raw: true });
        return res.json(tipoPedidoEnvios);
    } catch (err) {
        return res.status(500).json({ error: 'Error al obtener los tipos de pedido', details: err.message })
    }
}

module.exports = {
    getAllTipoPedidoEnvio
};