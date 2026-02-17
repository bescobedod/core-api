const initvwTiendasModulo = require('../../models/pdv/views/vwTiendasModulo.view');
const sequelizeInit = require('../../configuration/db');
const Op = require('sequelize');

async function getAllTiendas(req, res) {
    try {
        const sequelizePDV = await sequelizeInit.sequelizeInit('PDV');
        const TiendaModel = initvwTiendasModulo(sequelizePDV);

        const tiendas = await TiendaModel.findAll({ raw: true });
        return res.json(tiendas);
    } catch (err) {
        return res.status(500).json({ error: 'Error al obtener las tiendas', details: err.message })
    }
}

async function getTiendasBySupervisor(req, res) {
    const { codEmpleado } = req.params;
    
    try {
        const sequelizePDV = await sequelizeInit.sequelizeInit('PDV');
        const TiendaModel = initvwTiendasModulo(sequelizePDV);

        const tiendas = await TiendaModel.findAll({
            where: {
                codigo_administrador: codEmpleado
            },
            raw: true
        });
        return res.json(tiendas);
    } catch (err) {
        return res.status(500).json({
            error: 'Error al obtener tiendas del supervisor',
            details: err.message
        });
    }
}

module.exports = {
    getAllTiendas,
    getTiendasBySupervisor
};