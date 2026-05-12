
const { Op } = require('sequelize');
const { sequelize } = require('../../configuration/db');
const EmpresaModel = require('../../models/core/tbl_empresa.model');

async function getEmpresasActivas(req, res) {
    try {
        const empresas = await EmpresaModel.findAll({
            attributes: ['id', 'nombre', 'id_pdv'],
            where: {
                esta_activo: true
            }
        });

        if(empresas.length === 0) {
            return res.status(404).json({ error: "No se encontraron empresas activas" });
        }

        return res.json(empresas);
    } catch (error) {
        console.error("Error al buscar empresas activas", err);
        return res.status(500).json({ error: err.message });
    }
}

module.exports = {
    getEmpresasActivas
}