const initMenuModel = require('../../models/core/tbl_menu.model');
const sequelizeInit = require('../../configuration/db');
const Op = require('sequelize');

async function getAllMenus(req, res) {
    try {
        const sequelize = await sequelizeInit.sequelizeInit('CORE');
        const MenuModel = initMenuModel(sequelize);

        const menus = await MenuModel.findAll({ raw: true });

        return res.json(menus)
    } catch (err) {
        return res.status(500).json({
            error: 'Error al obtener los menús',
            details: err.message
        });
    }
}

module.exports = {
    getAllMenus
}