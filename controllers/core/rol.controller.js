const RolModel = require('../../models/core/tbl_rol.model');

// Lista todos los roles (config.tbl_rol) — catálogo usado para
// asignar acceso a menús.
async function getAllRoles(req, res) {
    try {
        const roles = await RolModel.findAll({ order: [['nombre', 'ASC']] });
        return res.json({ success: true, roles });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener los roles',
            details: error.message,
            success: false
        });
    }
}

module.exports = {
    getAllRoles
};