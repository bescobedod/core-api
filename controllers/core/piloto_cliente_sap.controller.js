const { Op } = require('sequelize');
const UsersModel = require('../../models/pioapp/users.model');
const PilotoClienteSapModel = require('../../models/core/tbl_piloto_cliente_sap.model');
const { buscarClientesPollo, buscarClientesInsumos } = require('../../integrations/sap/sapClient');

const ROL_PILOTO_PIOAPP = 1;

// Busca usuarios de PioApp con id_rol = 1 (pilotos) por nombre (en
// cualquiera de los 4 campos: primer/segundo nombre, primer/segundo
// apellido) o por código de empleado — nunca lista todos de una vez.
// Devuelve el CardCode de SAP ya asignado para ese tipo (POLLO -> AVIGUA,
// INSUMOS -> CORPO), si lo tiene. PioApp y Core son bases distintas, así 
// que el cruce se hace en JS, no con un include de Sequelize.
async function getPilotos(req, res) {
    const { tipo, query } = req.query;

    if (!tipo || !['POLLO', 'INSUMOS'].includes(tipo)) {
        return res.status(400).json({ error: "tipo debe ser 'POLLO' o 'INSUMOS'", success: false });
    }

    if (!query || query.trim().length < 2) {
        return res.status(400).json({ error: 'query debe tener al menos 2 caracteres', success: false });
    }

    try {
        const safeQuery = `%${query.trim()}%`;

        const usuarios = await UsersModel.findAll({
            where: {
                id_rol: ROL_PILOTO_PIOAPP,
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

        const asignaciones = await PilotoClienteSapModel.findAll({
            where: { tipo, piloto_id: usuarios.map(u => u.id_users) }
        });

        const asignacionPorPiloto = new Map(asignaciones.map(a => [String(a.piloto_id), a]));

        const pilotos = usuarios.map(u => {
            const asignacion = asignacionPorPiloto.get(String(u.id_users));
            const nombre = [u.first_name, u.second_name, u.first_last_name, u.second_last_name]
                .filter(Boolean)
                .join(' ');

            return {
                piloto_id: u.id_users,
                codigo_user: u.codigo_user,
                nombre,
                email_office: u.email_office,
                card_code: asignacion ? asignacion.card_code : null,
                card_name: asignacion ? asignacion.card_name : null
            };
        });

        return res.json({ success: true, pilotos });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener los pilotos',
            details: error.message,
            success: false
        });
    }
}

// Asigna (o reemplaza) el CardCode de SAP de un piloto para un tipo.
async function asignarClienteSap(req, res) {
    const { piloto_id, tipo, card_code, card_name } = req.body;

    if (!piloto_id || !tipo || !card_code) {
        return res.status(400).json({ error: 'piloto_id, tipo y card_code son requeridos', success: false });
    }

    if (!['POLLO', 'INSUMOS'].includes(tipo)) {
        return res.status(400).json({ error: "tipo debe ser 'POLLO' o 'INSUMOS'", success: false });
    }

    try {
        const [asignacion] = await PilotoClienteSapModel.findOrCreate({
            where: { piloto_id, tipo },
            defaults: { piloto_id, tipo, card_code, card_name: card_name || null }
        });

        await asignacion.update({ card_code, card_name: card_name || null });

        return res.json({ success: true, asignacion });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al asignar el cliente SAP del piloto',
            details: error.message,
            success: false
        });
    }
}

// Busca clientes (Business Partners) en SAP por nombre, para el
// buscador de la vista de mantenimiento.
async function buscarClientes(req, res) {
    const { tipo, query } = req.query;

    if (!tipo || !['POLLO', 'INSUMOS'].includes(tipo)) {
        return res.status(400).json({ error: "tipo debe ser 'POLLO' o 'INSUMOS'", success: false });
    }

    if (!query || query.trim().length < 2) {
        return res.status(400).json({ error: 'query debe tener al menos 2 caracteres', success: false });
    }

    try {
        const clientes = tipo === 'POLLO'
            ? await buscarClientesPollo(query)
            : await buscarClientesInsumos(query);

        return res.json({ success: true, clientes });
    } catch (error) {
        return res.status(502).json({
            error: 'Error al buscar clientes en SAP',
            details: error.message,
            success: false
        });
    }
}

module.exports = {
    getPilotos,
    asignarClienteSap,
    buscarClientes
};