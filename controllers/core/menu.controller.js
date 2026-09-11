const MenuModel = require('../../models/core/tbl_menu.model');
const MenuRolModel = require('../../models/core/tbl_menu_rol.model');
const PermisoModel = require('../../models/core/tbl_permiso.model');
const RolModel = require('../../models/core/tbl_rol.model');
const sequelizeInit = require('../../configuration/db');
const Op = require('sequelize');
const ID_ROL_LEGACY = 11;

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

// Lista TODOS los menús que existen (sin filtrar por rol ni por
// visible) — para la vista de administración de permisos.
async function getAllMenusAdmin(req, res) {
    try {
        const menus = await MenuModel.findAll({
            order: [['id_menu', 'ASC']],
            where: {
                tipo: "WEB"
            }
        },);
        return res.json({ success: true, menus });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener los menús',
            details: error.message,
            success: false
        });
    }
}

// Crea un menú nuevo.
async function crearMenu(req, res) {
    const { nombre, icono, nombre_menu, descripcion, tipo } = req.body;

    if (!nombre || !icono || !nombre_menu || !descripcion) {
        return res.status(400).json({
            error: 'nombre, icono, nombre_menu y descripcion son requeridos',
            success: false
        });
    }

    try {
        const menu = await MenuModel.create({
            nombre,
            icono,
            nombre_menu,
            descripcion,
            tipo: tipo || 'WEB',
            visible: true
        });

        return res.json({ success: true, menu });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al crear el menú',
            details: error.message,
            success: false
        });
    }
}

// Muestra u oculta un menú (campo visible).
async function actualizarVisibilidadMenu(req, res) {
    const { id } = req.params;
    const { visible } = req.body;

    if (visible === undefined) {
        return res.status(400).json({ error: 'visible es requerido', success: false });
    }

    try {
        const menu = await MenuModel.findByPk(id);

        if (!menu) {
            return res.status(404).json({ error: 'Menú no encontrado', success: false });
        }

        await menu.update({ visible: !!visible });

        return res.json({ success: true, menu });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al actualizar el menú',
            details: error.message,
            success: false
        });
    }
}

// Lista los roles (config.tbl_rol) que tienen asignado un menú.
// Se resuelve el nombre del rol en JS (join en memoria), igual que en
// getAllMenus — no hay asociaciones Sequelize definidas en este proyecto.
async function getRolesDeMenu(req, res) {
    const { id_menu } = req.query;

    if (!id_menu) {
        return res.status(400).json({ error: 'id_menu es requerido', success: false });
    }

    try {
        const asignaciones = await MenuRolModel.findAll({ where: { id_menu } });

        const roles = await RolModel.findAll({
            where: { id_rol: asignaciones.map(a => a.id_rol_core).filter(id => id != null) }
        });

        const rolesPorId = new Map(roles.map(r => [r.id_rol, r]));

        const resultado = asignaciones.map(a => ({
            id_menu_rol: a.id_menu_rol,
            id_rol_core: a.id_rol_core,
            nombre_rol: rolesPorId.get(a.id_rol_core)?.nombre || null
        }));

        return res.json({ success: true, roles: resultado });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener los roles del menú',
            details: error.message,
            success: false
        });
    }
}

// Asigna un rol (config.tbl_rol) a un menú.
async function asignarRolAMenu(req, res) {
    const { id_menu, id_rol_core } = req.body;

    if (!id_menu || !id_rol_core) {
        return res.status(400).json({ error: 'id_menu y id_rol_core son requeridos', success: false });
    }

    try {
        const yaExiste = await MenuRolModel.findOne({ where: { id_menu, id_rol_core } });

        if (yaExiste) {
            return res.status(409).json({ error: 'Ese rol ya tiene acceso a este menú', success: false });
        }

        const asignacion = await MenuRolModel.create({
            id_menu,
            id_rol_core,
            id_rol: ID_ROL_LEGACY
        });

        return res.json({ success: true, asignacion });
    } catch (error) {
        if (error.name === 'SequelizeForeignKeyConstraintError') {
            return res.status(400).json({ error: 'El menú indicado no existe', success: false });
        }

        return res.status(500).json({
            error: 'Error al asignar el rol al menú',
            details: error.message,
            success: false
        });
    }
}

// Quita un rol de un menú.
async function quitarRolDeMenu(req, res) {
    const { id } = req.params;

    try {
        const eliminados = await MenuRolModel.destroy({ where: { id_menu_rol: id } });

        return res.json({ success: true, eliminado: eliminados > 0 });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al quitar el rol del menú',
            details: error.message,
            success: false
        });
    }
}

module.exports = {
    getAllMenus,
    getPermiso,
    getAllMenusAdmin,
    crearMenu,
    actualizarVisibilidadMenu,
    getRolesDeMenu,
    asignarRolAMenu,
    quitarRolDeMenu
}