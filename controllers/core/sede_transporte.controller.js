const UsersModel = require('../../models/pioapp/users.model');
const CamionModel = require('../../models/core/tbl_camion.model');
const SedePilotoModel = require('../../models/core/tbl_sede_piloto.model');
const SedeCamionModel = require('../../models/core/tbl_sede_camion.model');

// Sedes = muelles de Pollo (misma lista fija que en el resto de Core).
const SEDES_POLLO = ['RAS-002', 'RAS-003', 'RAS-004'];

function sedeValida(whs_code_origen) {
    return SEDES_POLLO.includes(whs_code_origen);
}

function nombreCompleto(u) {
    return [u.first_name, u.second_name, u.first_last_name, u.second_last_name].filter(Boolean).join(' ');
}

// GET: pilotos y camiones asignados a una sede, con nombre y placa, para la
// vista de mantenimiento "Pilotos y Camiones por Sede".
async function getAsignacionesSede(req, res) {
    const { whs_code_origen } = req.query;

    if (!sedeValida(whs_code_origen)) {
        return res.status(400).json({ error: `whs_code_origen debe ser uno de: ${SEDES_POLLO.join(', ')}`, success: false });
    }

    try {
        const [sedePilotos, sedeCamiones] = await Promise.all([
            SedePilotoModel.findAll({ where: { whs_code_origen, activo: true } }),
            SedeCamionModel.findAll({ where: { whs_code_origen, activo: true } })
        ]);

        // PioApp y Core son bases distintas: el cruce se hace en JS.
        const [usuarios, camiones] = await Promise.all([
            sedePilotos.length === 0 ? [] : UsersModel.findAll({
                where: { id_users: sedePilotos.map(s => s.piloto_id) },
                attributes: ['id_users', 'codigo_user', 'first_name', 'second_name', 'first_last_name', 'second_last_name']
            }),
            sedeCamiones.length === 0 ? [] : CamionModel.findAll({
                where: { id_camion: sedeCamiones.map(s => s.id_camion) },
                attributes: ['id_camion', 'placa', 'marca', 'linea', 'estado']
            })
        ]);

        const usuarioPorId = new Map(usuarios.map(u => [String(u.id_users), u]));
        const camionPorId = new Map(camiones.map(c => [c.id_camion, c]));

        const pilotos = sedePilotos.map(s => {
            const u = usuarioPorId.get(String(s.piloto_id));
            return {
                piloto_id: Number(s.piloto_id),
                codigo_user: u ? u.codigo_user : null,
                nombre: u ? nombreCompleto(u) : `Piloto #${s.piloto_id}`
            };
        }).sort((a, b) => a.nombre.localeCompare(b.nombre));

        const camionesSede = sedeCamiones.map(s => {
            const c = camionPorId.get(s.id_camion);
            return {
                id_camion: s.id_camion,
                placa: c ? c.placa : '(camión eliminado)',
                descripcion: c ? [c.marca, c.linea].filter(Boolean).join(' ') : null,
                estado: c ? c.estado : null
            };
        }).sort((a, b) => a.placa.localeCompare(b.placa));

        return res.json({ success: true, pilotos, camiones: camionesSede });
    } catch (error) {
        return res.status(500).json({ error: 'Error al obtener las asignaciones de la sede', details: error.message, success: false });
    }
}

// GET: todas las asignaciones vigentes (piloto/camión -> sede). Lo usan los
// dropdowns de transporte de Pedidos de Pollo para separar los de la sede
// que se está despachando de los que no tienen sede.
async function getMapaSedes(req, res) {
    try {
        const [pilotos, camiones] = await Promise.all([
            SedePilotoModel.findAll({ where: { activo: true }, attributes: ['piloto_id', 'whs_code_origen'], raw: true }),
            SedeCamionModel.findAll({ where: { activo: true }, attributes: ['id_camion', 'whs_code_origen'], raw: true })
        ]);

        return res.json({
            success: true,
            pilotos: pilotos.map(p => ({ piloto_id: Number(p.piloto_id), whs_code_origen: p.whs_code_origen })),
            camiones
        });
    } catch (error) {
        return res.status(500).json({ error: 'Error al obtener las sedes de pilotos y camiones', details: error.message, success: false });
    }
}

// Asigna (o reactiva) un registro sede-recurso. El índice único de la tabla
// es (whs_code_origen, <recurso>), así que nunca se duplica.
async function asignar(Model, campo, req, res, etiqueta) {
    const { whs_code_origen } = req.body;
    const valor = req.body[campo];

    if (!sedeValida(whs_code_origen) || !valor) {
        return res.status(400).json({ error: `whs_code_origen (${SEDES_POLLO.join(', ')}) y ${campo} son requeridos`, success: false });
    }

    try {
        const [registro] = await Model.findOrCreate({
            where: { whs_code_origen, [campo]: valor },
            defaults: { whs_code_origen, [campo]: valor, activo: true, creado_en: new Date() }
        });

        if (!registro.activo) await registro.update({ activo: true });

        return res.json({ success: true, asignacion: registro });
    } catch (error) {
        return res.status(500).json({ error: `Error al asignar el ${etiqueta} a la sede`, details: error.message, success: false });
    }
}

// Quita un recurso de una sede (se desactiva, no se borra).
async function quitar(Model, campo, req, res, etiqueta) {
    const { whs_code_origen } = req.body;
    const valor = req.body[campo];

    if (!sedeValida(whs_code_origen) || !valor) {
        return res.status(400).json({ error: `whs_code_origen (${SEDES_POLLO.join(', ')}) y ${campo} son requeridos`, success: false });
    }

    try {
        const [actualizados] = await Model.update(
            { activo: false },
            { where: { whs_code_origen, [campo]: valor, activo: true } }
        );

        return res.json({ success: true, actualizado: actualizados > 0 });
    } catch (error) {
        return res.status(500).json({ error: `Error al quitar el ${etiqueta} de la sede`, details: error.message, success: false });
    }
}

const asignarPiloto = (req, res) => asignar(SedePilotoModel, 'piloto_id', req, res, 'piloto');
const quitarPiloto = (req, res) => quitar(SedePilotoModel, 'piloto_id', req, res, 'piloto');
const asignarCamion = (req, res) => asignar(SedeCamionModel, 'id_camion', req, res, 'camión');
const quitarCamion = (req, res) => quitar(SedeCamionModel, 'id_camion', req, res, 'camión');

module.exports = {
    getAsignacionesSede,
    getMapaSedes,
    asignarPiloto,
    quitarPiloto,
    asignarCamion,
    quitarCamion
};
