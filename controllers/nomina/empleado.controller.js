const initEmpleadoModel = require('../../models/nomina/tEmpleado.model');
const sequelize = require('../../configuration/db');

async function getAllEmpleados(req, res) {
    try {
        const sequelizeNomina = await sequelize.sequelizeInit('NOMINA');
        const EmpleadoModel = initEmpleadoModel(sequelizeNomina);

        const empleados = await EmpleadoModel.findAll({ raw: true })
        return res.json(empleados);
    } catch (err) {
        return res.status(500).json({
            error: 'Error al obtener los empleados',
            details: err.message
        })
    }
}

async function getEmpleadoById(req, res) {
    const { codEmpleado } = req.params

    try {
        const sequelizeNomina = await sequelize.sequelizeInit('NOMINA');
        const EmpleadoModel = initEmpleadoModel(sequelizeNomina);

        const empleado = await EmpleadoModel.findByPk(codEmpleado);
        return res.json(empleado);
    } catch (err) {
        return res.status(500).json({
            error: 'Error al obtener empleado',
            details: err.message
        })
    }
}

module.exports = {
    getAllEmpleados,
    getEmpleadoById
}