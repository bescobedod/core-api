const initEmpleadoCootragua = require('../../models/nomina/views/vwDetalleEmpleadoCootragua.view');
const { sequelizeInit } = require('../../configuration/db');
const { Op } = require('sequelize');

async function getAllEmpleadosCootragua(req, res) {
    try {
        const sequelizeNomina = await sequelizeInit('NOMINA');
        const EmpleadoCootragua = initEmpleadoCootragua(sequelizeNomina);

        const empleados = await EmpleadoCootragua.findAll({
            where: {
                email: {
                    [Op.not]: [null, '']
                }
            },
            limit: 10
        });

        return res.json(empleados);
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener los empleados',
            details: error.message
        });
    }
}

module.exports = {
    getAllEmpleadosCootragua
}