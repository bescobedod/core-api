const MenuModel = require('../../models/core/tbl_menu.model');
const MenuRolModel = require('../../models/core/tbl_menu_rol.model');
const PermisoModel = require('../../models/core/tbl_permiso.model');
const sequelizeInit = require('../../configuration/db');
const Op = require('sequelize');

async function getAllMenus(req, res) {
    try {
        const permisos = await MenuRolModel.findAll({
            where: { id_rol_core: req.user.rol },
        });

        const menus = await MenuModel.findAll({
            where: {
                id_menu: permisos.map(permiso => permiso.id_menu),
                tipo: 'WEB'
            },
            order: [["id_menu", "ASC"]]
        });

        return res.json(menus)
    } catch (err) {
        return res.status(500).json({
            error: 'Error al obtener los menús',
            details: err.message
        });
    }
}

async function getPermiso(req, res) {
    try {
        const permiso = await PermisoModel.findOne({
            where: {
                id_users: req.user.id_usuario,
                id_rol: req.user.rol
            }
        });

        if(!permiso) {
            return res.json(false);
        }

        return res.json(true)
    } catch (err) {
        return res.status(500).json({
            error: 'Error al obtener permiso',
            details: err.message
        });
    }
}

module.exports = {
    getAllMenus,
    getPermiso
}