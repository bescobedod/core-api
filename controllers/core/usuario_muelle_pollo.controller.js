const { Op } = require('sequelize');
const UsersModel = require('../../models/pioapp/users.model');
const UsuarioMuellePolloModel = require('../../models/core/tbl_usuario_muelle_pollo.model');

// Rol de PioApp que opera los muelles de Pollo.
const ROL_MUELLE_PIOAPP = [1, 5];

// Lista los usuarios ya asignados a un muelle (whs_code_origen).
async function getUsuariosPorMuelle(req, res) {
    const { whs_code_origen } = req.query;

    if (!whs_code_origen) {
        return res.status(400).json({ error: 'whs_code_origen es requerido', success: false });
    }

    try {
        const asignaciones = await UsuarioMuellePolloModel.findAll({
            where: { whs_code_origen, activo: true }
        });

        const usuarios = await UsersModel.findAll({
            where: { id_users: asignaciones.map(a => a.id_usuario) },
            attributes: ['id_users', 'codigo_user', 'first_name', 'second_name', 'first_last_name', 'second_last_name', 'email_office']
        });

        const usuarioPorId = new Map(usuarios.map(u => [String(u.id_users), u]));

        const resultado = asignaciones.map(a => {
            const u = usuarioPorId.get(String(a.id_usuario));
            const nombre = u
                ? [u.first_name, u.second_name, u.first_last_name, u.second_last_name].filter(Boolean).join(' ')
                : null;

            return {
                id_usuario: a.id_usuario,
                codigo_user: u ? u.codigo_user : null,
                nombre: nombre || `Usuario #${a.id_usuario}`,
                email_office: u ? u.email_office : null
            };
        });

        return res.json({ success: true, usuarios: resultado });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener los usuarios del muelle',
            details: error.message,
            success: false
        });
    }
}

// Busca usuarios de PioApp con id_rol = 5 por nombre o código de
// empleado — nunca lista todos de una vez.
async function buscarUsuarios(req, res) {
    const { query } = req.query;

    if (!query || query.trim().length < 2) {
        return res.status(400).json({ error: 'query debe tener al menos 2 caracteres', success: false });
    }

    try {
        const safeQuery = `%${query.trim()}%`;

        const usuarios = await UsersModel.findAll({
            where: {
                id_rol_core: {[Op.in]: ROL_MUELLE_PIOAPP},
                [Op.or]: [
                    { first_name: { [Op.iLike]: safeQuery } },
                    { second_name: { [Op.iLike]: safeQuery } },
                    { first_last_name: { [Op.iLike]: safeQuery } },
                    { second_last_name: { [Op.iLike]: safeQuery } },
                    { codigo_user: { [Op.iLike]: safeQuery } }
                ]
            },
            attributes: ['id_users', 'codigo_user', 'first_name', 'second_name', 'first_last_name', 'second_last_name', 'email_office'],
            order: [['first_name', 'ASC']],
            limit: 30
        });

        const resultado = usuarios.map(u => ({
            id_usuario: u.id_users,
            codigo_user: u.codigo_user,
            nombre: [u.first_name, u.second_name, u.first_last_name, u.second_last_name].filter(Boolean).join(' '),
            email_office: u.email_office
        }));

        return res.json({ success: true, usuarios: resultado });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener los usuarios',
            details: error.message,
            success: false
        });
    }
}

// Asigna (o reemplaza) el muelle de Pollo de un usuario. Un usuario
// solo tiene un muelle activo a la vez — findOrCreate + update sobre el
// mismo id_usuario, igual que asignarClienteSap en piloto_cliente_sap.
async function asignarMuelle(req, res) {
    const { id_usuario, whs_code_origen, nombre_muelle } = req.body;

    if (!id_usuario || !whs_code_origen) {
        return res.status(400).json({ error: 'id_usuario y whs_code_origen son requeridos', success: false });
    }

    try {
        const [asignacion] = await UsuarioMuellePolloModel.findOrCreate({
            where: { id_usuario },
            defaults: { id_usuario, whs_code_origen, nombre_muelle: nombre_muelle || null, activo: true, creado_en: new Date() }
        });

        await asignacion.update({ whs_code_origen, nombre_muelle: nombre_muelle || null, activo: true });

        return res.json({ success: true, asignacion });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al asignar el muelle',
            details: error.message,
            success: false
        });
    }
}

// Quita el muelle asignado a un usuario (se desactiva, no se borra).
async function quitarMuelle(req, res) {
    const { id_usuario } = req.params;

    try {
        const [actualizados] = await UsuarioMuellePolloModel.update(
            { activo: false },
            { where: { id_usuario, activo: true } }
        );

        return res.json({ success: true, actualizado: actualizados > 0 });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al quitar el muelle',
            details: error.message,
            success: false
        });
    }
}

module.exports = {
    getUsuariosPorMuelle,
    buscarUsuarios,
    asignarMuelle,
    quitarMuelle
};