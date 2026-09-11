const NotificacionContextoModel = require('../../models/core/tbl_notificacion_contexto.model');

// Lista todos los contextos de notificación (activos e inactivos, la
// vista de mantenimiento decide qué mostrar/permitir).
async function getContextos(req, res) {
    try {
        const contextos = await NotificacionContextoModel.findAll({
            order: [['nombre', 'ASC']]
        });

        return res.json({ success: true, contextos });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener los contextos de notificación',
            details: error.message,
            success: false
        });
    }
}

// Crea un contexto nuevo. El código se normaliza (mayúsculas, espacios
// a guión bajo) para mantener la misma convención que los contextos ya
// usados en código (ej. 'ENTREGA_PRODUCTO').
async function crearContexto(req, res) {
    const { codigo, nombre, descripcion } = req.body;

    if (!codigo || !nombre) {
        return res.status(400).json({ error: 'codigo y nombre son requeridos', success: false });
    }

    const codigoNormalizado = codigo.trim().toUpperCase().replace(/\s+/g, '_');

    try {
        const contexto = await NotificacionContextoModel.create({
            codigo: codigoNormalizado,
            nombre: nombre.trim(),
            descripcion: descripcion ? descripcion.trim() : null,
            activo: true
        });

        return res.json({ success: true, contexto });
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({ error: 'Ya existe un contexto con ese código', success: false });
        }

        return res.status(500).json({
            error: 'Error al crear el contexto',
            details: error.message,
            success: false
        });
    }
}

module.exports = {
    getContextos,
    crearContexto
};