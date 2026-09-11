const NotificacionDestinatarioModel = require('../../models/core/tbl_notificacion_destinatario.model');

// Lista los destinatarios de un contexto de notificación (ej.
// 'ENTREGA_PRODUCTO'). Trae todos (activos e inactivos) para que la vista
// de mantenimiento pueda mostrar/alternar el estado.
async function getDestinatarios(req, res) {
    const { contexto } = req.query;

    if (!contexto) {
        return res.status(400).json({ error: 'contexto es requerido', success: false });
    }

    try {
        const destinatarios = await NotificacionDestinatarioModel.findAll({
            where: { contexto },
            order: [['nombre', 'ASC'], ['email', 'ASC']]
        });

        return res.json({ success: true, destinatarios });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener los destinatarios',
            details: error.message,
            success: false
        });
    }
}

// Agrega un destinatario nuevo a un contexto.
async function crearDestinatario(req, res) {
    const { contexto, email, nombre } = req.body;

    if (!contexto || !email) {
        return res.status(400).json({ error: 'contexto y email son requeridos', success: false });
    }

    try {
        const destinatario = await NotificacionDestinatarioModel.create({
            contexto,
            email: email.trim().toLowerCase(),
            nombre: nombre || null,
            activo: true
        });

        return res.json({ success: true, destinatario });
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({ error: 'Ese correo ya está registrado para este contexto', success: false });
        }

        if (error.name === 'SequelizeForeignKeyConstraintError') {
            return res.status(400).json({ error: 'El contexto indicado no existe', success: false });
        }

        return res.status(500).json({
            error: 'Error al crear el destinatario',
            details: error.message,
            success: false
        });
    }
}

// Actualiza nombre/activo de un destinatario (no se permite cambiar
// el contexto ni el correo — para eso se elimina y se crea de nuevo).
async function actualizarDestinatario(req, res) {
    const { id } = req.params;
    const { nombre, activo } = req.body;

    try {
        const destinatario = await NotificacionDestinatarioModel.findByPk(id);

        if (!destinatario) {
            return res.status(404).json({ error: 'Destinatario no encontrado', success: false });
        }

        const cambios = {};
        if (nombre !== undefined) cambios.nombre = nombre || null;
        if (activo !== undefined) cambios.activo = !!activo;

        await destinatario.update(cambios);

        return res.json({ success: true, destinatario });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al actualizar el destinatario',
            details: error.message,
            success: false
        });
    }
}

// Elimina un destinatario definitivamente.
async function eliminarDestinatario(req, res) {
    const { id } = req.params;

    try {
        const eliminados = await NotificacionDestinatarioModel.destroy({ where: { id } });

        return res.json({ success: true, eliminado: eliminados > 0 });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al eliminar el destinatario',
            details: error.message,
            success: false
        });
    }
}

module.exports = {
    getDestinatarios,
    crearDestinatario,
    actualizarDestinatario,
    eliminarDestinatario
};