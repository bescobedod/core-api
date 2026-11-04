const MenuModel = require('../models/core/tbl_menu.model');
const MenuRolModel = require('../models/core/tbl_menu_rol.model');
const UsersModel = require('../models/pioapp/users.model');

// Nivel de permiso ('lectura' | 'lectura_division' | 'escritura') del rol del
// usuario para un menú (config.tbl_menu.nombre_menu), o null si no tiene acceso.
async function nivelPermisoDeMenu(req, nombreMenu) {
    const menu = await MenuModel.findOne({ where: { nombre_menu: nombreMenu, tipo: 'WEB' }, attributes: ['id_menu'] });

    if (!menu) return null;

    const permiso = await MenuRolModel.findOne({
        where: { id_rol_core: req.user.rol, id_menu: menu.id_menu },
        attributes: ['nivel_permiso']
    });

    return permiso ? permiso.nivel_permiso : null;
}

// Nombre completo del usuario del token (o su id si no se encuentra).
async function nombreDelUsuario(req) {
    const usuario = await UsersModel.findByPk(req.user.id_usuario, {
        attributes: ['first_name', 'second_name', 'first_last_name', 'second_last_name']
    });

    const nombre = usuario
        ? [usuario.first_name, usuario.second_name, usuario.first_last_name, usuario.second_last_name].filter(Boolean).join(' ')
        : '';

    return nombre || String(req.user.id_usuario);
}

module.exports = { nivelPermisoDeMenu, nombreDelUsuario };
