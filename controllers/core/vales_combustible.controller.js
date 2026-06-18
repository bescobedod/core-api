const { Op } = require('sequelize');
const ValesCombustibleModel = require('../../models/core/tbl_vales_combustible.model');

async function getValesCombustible(req, res) {
    const {
        placa,
        fecha
    } = req.query;

    const fechaValida = fecha && fecha !== 'null' && fecha.trim() !== '';

    if (!placa && !fechaValida) {
        return res.status(400).json({ error: 'Se requiere placa y/o fecha para filtrar los vales de combustible' });
    }

    try {
        const where = {};

        if (placa) {
            where.placa_vehiculo = { [Op.iLike]: `%${placa}%` };
        }

        if (fechaValida) {
            where.createdAt = {
                [Op.between]: [
                    new Date(`${fecha} 00:00:00`),
                    new Date(`${fecha} 23:59:59`)
                ]
            };
        }

        const { count: total, rows: vales } = await ValesCombustibleModel.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
        });

        return res.json({
            data: vales
        });
    } catch (err) {
        console.error('Error al obtener vales de combustible:', err);
        return res.status(500).json({ error: err.message });
    }
}

module.exports = {
    getValesCombustible
};