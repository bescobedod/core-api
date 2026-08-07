const AreaModel = require('../../models/pioapp/tbl_area.model');
const VwAreasModel = require('../../models/pioapp/views/vw_areas');
const { Op } = require('sequelize');
const { sequelizePioApp } = require('../../configuration/db');
const VwUsuariosModel = require('../../models/pioapp/views/vw_usuarios');

const ROLES_CON_ACCESO_TOTAL = [1];

async function getAreasByDepartamento(req, res) {
    try {
        const esAdmin = ROLES_CON_ACCESO_TOTAL.includes(Number(req.user.rol));
        const departamentoId = esAdmin && req.query.departamento_id
            ? req.query.departamento_id
            : req.user.id_departamento;

        const areas = await AreaModel.findAll({
            where: {
                departamento_id: departamentoId,
                activo: true
            }
        });

        if(areas.length === 0) {
            throw new Error("No se encontraron areas para el departamento");
        }

        return res.json(areas);
    } catch (err) {
        console.error("Error al buscar areas del departamento", err);
        return res.status(500).json({ error: err.message });
    }
}

async function getAreasYEmpleadosByDepartamento(req, res) {
    const { departamento_id } = req.params;

    try {
        const areas = await VwAreasModel.findAll({
            where: {
                departamento_id: departamento_id,
                activo: true
            }
        });

        const usuarios = await VwUsuariosModel.findAll({
            where: {
                id_departamento: departamento_id
            }
        });

        return res.json({
            Areas: areas,
            Usuarios: usuarios
        })
    } catch (err) {
        console.error("Error al areas del departamento", err);
        return res.status(500).json({ error: err.message });
    }
}

module.exports = {
    getAreasByDepartamento,
    getAreasYEmpleadosByDepartamento
}