const initTiendaModel = require('../../models/pdv/tTienda.model');
const CatalogoRutaPolloModel = require('../../models/core/tbl_catalogo_rutas_pollo.model');
const TiendaRutaPolloModel = require('../../models/core/tbl_tiendas_rutas_pollo.model');
const BloqueoRutaPolloModel = require('../../models/core/tbl_bloqueo_ruta_pollo.model');
const UsuarioMuellePolloModel = require('../../models/core/tbl_usuario_muelle_pollo.model');
const sequelizeInit = require('../../configuration/db');
const { Op, fn, col } = require('sequelize');

// TODO: confirmar el nombre real de la clave de conexión a PDV en configDatabase
const PDV_CONNECTION = 'PDV';

// ------------------------------------------------------------
// GET: lista las rutas de pollo, opcionalmente filtradas por muelle
// (whs_code_origen). Incluye cuántas tiendas tiene asignadas cada una.
// ------------------------------------------------------------
async function getRutasPollo(req, res) {
    const { whs_code_origen } = req.query;

    try {
        const where = {};
        if (whs_code_origen) where.whs_code_origen = whs_code_origen;

        const rutas = await CatalogoRutaPolloModel.findAll({
            where,
            order: [['nombre_ruta', 'ASC']]
        });

        const rutaIds = rutas.map(r => r.id);

        const conteos = await TiendaRutaPolloModel.findAll({
            attributes: [
                'ruta_id',
                [fn('COUNT', col('id')), 'total']
            ],
            where: {
                ruta_id: { [Op.in]: rutaIds },
                fecha_fin_asignacion: null
            },
            group: ['ruta_id'],
            raw: true
        });

        const conteoMap = new Map(conteos.map(c => [c.ruta_id, Number(c.total)]));

        const resultado = rutas.map(r => ({
            id: r.id,
            nombre_ruta: r.nombre_ruta,
            whs_code_origen: r.whs_code_origen,
            whs_code_destino: r.whs_code_destino,
            activo: r.activo,
            total_tiendas: conteoMap.get(r.id) || 0
        }));

        return res.json({ success: true, rutas: resultado });
    } catch (error) {
        return res.status(500).json({ error: 'Error al obtener las rutas de pollo', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// POST: crea una ruta de pollo nueva
// ------------------------------------------------------------
async function crearRutaPollo(req, res) {
    const { nombre_ruta, whs_code_origen, whs_code_destino } = req.body;

    if (!nombre_ruta || !whs_code_origen || !whs_code_destino) {
        return res.status(400).json({
            error: 'nombre_ruta, whs_code_origen y whs_code_destino son requeridos',
            success: false
        });
    }

    try {
        const ruta = await CatalogoRutaPolloModel.create({
            nombre_ruta,
            whs_code_origen,
            whs_code_destino,
            activo: true,
            creado_en: new Date()
        });

        return res.json({ success: true, ruta });
    } catch (error) {
        return res.status(500).json({ error: 'Error al crear la ruta de pollo', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// GET: busca tiendas en PDV (tTienda) por nombre o código, e indica
// si ya están asignadas a alguna ruta de pollo vigente.
// ------------------------------------------------------------
async function buscarTiendasPdv(req, res) {
    const { query } = req.query;

    if (!query || query.trim().length < 2) {
        return res.status(400).json({ error: 'query debe tener al menos 2 caracteres', success: false });
    }

    try {
        const sequelizePdv = await sequelizeInit.sequelizeInit(PDV_CONNECTION);
        const TiendaModel = initTiendaModel(sequelizePdv);

        const tiendas = await TiendaModel.findAll({
            where: {
                [Op.or]: [
                    { tda_nombre: { [Op.like]: `%${query}%` } },
                    { tienda: { [Op.like]: `%${query}%` } },
                    { StoreNumberSimphony: { [Op.like]: `%${query}%` } }
                ]
            },
            limit: 30
        });

        const simphonyIds = tiendas.map(t => t.StoreNumberSimphony).filter(Boolean);

        const asignadas = await TiendaRutaPolloModel.findAll({
            where: {
                id_tienda_simphony: { [Op.in]: simphonyIds },
                fecha_fin_asignacion: null
            }
        });

        const asignadaMap = new Map(asignadas.map(a => [a.id_tienda_simphony, a]));

        const resultado = tiendas.map(t => {
            const asignacion = asignadaMap.get(t.StoreNumberSimphony);

            return {
                id_tienda_pdv: t.idTienda,
                id_tienda_simphony: t.StoreNumberSimphony,
                codigo_tienda: t.tienda,
                nombre_tienda: t.tda_nombre,
                codigo_empresa: t.empresa,
                whs_code: t.whsCode,
                ya_asignada: !!asignacion,
                ruta_id_actual: asignacion ? asignacion.ruta_id : null
            };
        });

        return res.json({ success: true, tiendas: resultado });
    } catch (error) {
        return res.status(500).json({ error: 'Error al buscar tiendas en PDV', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// GET: tiendas asignadas actualmente (vigentes) a una ruta
// ------------------------------------------------------------
async function getTiendasDeRuta(req, res) {
    const { ruta_id } = req.params;

    try {
        const tiendas = await TiendaRutaPolloModel.findAll({
            where: { ruta_id, fecha_fin_asignacion: null },
            order: [['nombre_tienda', 'ASC']]
        });

        return res.json({ success: true, tiendas });
    } catch (error) {
        return res.status(500).json({ error: 'Error al obtener las tiendas de la ruta', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// POST: asigna una tienda a una ruta de pollo. Si la tienda ya estaba
// asignada a otra ruta (o a la misma), cierra esa asignación vigente
// antes de crear la nueva — así nunca queda una tienda en dos rutas
// a la vez.
// ------------------------------------------------------------
async function asignarTiendaRutaPollo(req, res) {
    const {
        ruta_id,
        id_tienda_simphony,
        id_tienda_pdv,
        codigo_tienda,
        nombre_tienda,
        codigo_empresa,
        whs_code
    } = req.body;

    if (!ruta_id || !id_tienda_simphony) {
        return res.status(400).json({
            error: 'ruta_id e id_tienda_simphony son requeridos',
            success: false
        });
    }

    const sequelizeCore = await sequelizeInit.sequelizeInit('CORE');
    const t = await sequelizeCore.transaction();

    try {
        const ahora = new Date();

        await TiendaRutaPolloModel.update(
            { fecha_fin_asignacion: ahora },
            { where: { id_tienda_simphony, fecha_fin_asignacion: null }, transaction: t }
        );

        const nuevaAsignacion = await TiendaRutaPolloModel.create({
            ruta_id,
            id_tienda_simphony,
            id_tienda_pdv: id_tienda_pdv || null,
            codigo_tienda: codigo_tienda || null,
            nombre_tienda: nombre_tienda || null,
            codigo_empresa: codigo_empresa || null,
            whs_code: whs_code || null,
            fecha_asignacion: ahora,
            fecha_fin_asignacion: null
        }, { transaction: t });

        await t.commit();

        return res.json({ success: true, asignacion: nuevaAsignacion });
    } catch (error) {
        await t.rollback();
        return res.status(500).json({ error: 'Error al asignar la tienda a la ruta', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// POST: quita una tienda de su ruta actual (sin reasignarla a otra)
// ------------------------------------------------------------
async function quitarTiendaDeRutaPollo(req, res) {
    const { id_tienda_simphony } = req.body;

    if (!id_tienda_simphony) {
        return res.status(400).json({ error: 'id_tienda_simphony es requerido', success: false });
    }

    try {
        await TiendaRutaPolloModel.update(
            { fecha_fin_asignacion: new Date() },
            { where: { id_tienda_simphony, fecha_fin_asignacion: null } }
        );

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: 'Error al quitar la tienda de la ruta', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// GET: obtiene el muelle (whs_code_origen) asignado al usuario logueado
// ------------------------------------------------------------
async function getMuelleUsuario(req, res) {
    const id_usuario = req.user && req.user.id_usuario;

    if (!id_usuario) {
        return res.status(401).json({ error: 'Usuario no identificado', success: false });
    }

    try {
        const asignacion = await UsuarioMuellePolloModel.findOne({
            where: { id_usuario, activo: true }
        });

        if (!asignacion) {
            return res.status(404).json({
                error: 'Este usuario no tiene un muelle de pollo asignado',
                success: false
            });
        }

        return res.json({
            success: true,
            whs_code_origen: asignacion.whs_code_origen,
            nombre_muelle: asignacion.nombre_muelle
        });
    } catch (error) {
        return res.status(500).json({ error: 'Error al obtener el muelle del usuario', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// GET: candado activo (si existe) de un muelle
// ------------------------------------------------------------
async function getCandadoActivo(req, res) {
    const { whs_code_origen } = req.query;

    if (!whs_code_origen) {
        return res.status(400).json({ error: 'whs_code_origen es requerido', success: false });
    }

    try {
        const candado = await BloqueoRutaPolloModel.findOne({
            where: { whs_code_origen, estado: 'ACTIVO' }
        });

        return res.json({ success: true, candado: candado || null });
    } catch (error) {
        return res.status(500).json({ error: 'Error al consultar el candado', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// POST: toma el candado de una ruta+fecha. Falla con 409 si ya hay
// otra ruta activa en el mismo muelle (o si el índice único de la
// tabla lo detecta primero, por una condición de carrera).
// ------------------------------------------------------------
async function tomarCandado(req, res) {
    const { ruta_id, fecha } = req.body;
    const id_usuario = req.user && req.user.id_usuario;

    if (!ruta_id || !fecha) {
        return res.status(400).json({ error: 'ruta_id y fecha son requeridos', success: false });
    }

    try {
        const ruta = await CatalogoRutaPolloModel.findByPk(ruta_id);

        if (!ruta) {
            return res.status(404).json({ error: 'Ruta no encontrada', success: false });
        }

        const candadoExistente = await BloqueoRutaPolloModel.findOne({
            where: { whs_code_origen: ruta.whs_code_origen, estado: 'ACTIVO' }
        });

        if (candadoExistente) {
            const esLaMismaRutaYUsuario =
                candadoExistente.ruta_id === ruta_id &&
                candadoExistente.fecha === fecha &&
                String(candadoExistente.id_usuario) === String(id_usuario);

            if (esLaMismaRutaYUsuario) {
                // ya lo tenía tomado él mismo — se reutiliza, no es error
                return res.json({ success: true, candado: candadoExistente });
            }

            return res.status(409).json({
                error: candadoExistente.ruta_id === ruta_id
                    ? 'Ya tienes esta ruta en proceso para otra fecha'
                    : 'Hay otra ruta en proceso en este muelle — libérala antes de tomar otra',
                candado: candadoExistente,
                success: false
            });
        }

        const nuevoCandado = await BloqueoRutaPolloModel.create({
            whs_code_origen: ruta.whs_code_origen,
            ruta_id,
            fecha,
            id_usuario,
            estado: 'ACTIVO',
            fecha_bloqueo: new Date()
        });

        return res.json({ success: true, candado: nuevoCandado });
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({
                error: 'Hay otra ruta en proceso en este muelle — libérala antes de tomar otra',
                success: false
            });
        }

        return res.status(500).json({ error: 'Error al tomar el candado', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// POST: libera el candado de una ruta+fecha. Por ahora es manual;
// cuando se construya el envío real a SAP, debería llamarse automático
// justo después de que la transferencia se confirme.
// ------------------------------------------------------------
async function liberarCandado(req, res) {
    const { ruta_id, fecha } = req.body;

    if (!ruta_id || !fecha) {
        return res.status(400).json({ error: 'ruta_id y fecha son requeridos', success: false });
    }

    try {
        const [actualizados] = await BloqueoRutaPolloModel.update(
            { estado: 'LIBERADO', fecha_liberacion: new Date() },
            { where: { ruta_id, fecha, estado: 'ACTIVO' } }
        );

        return res.json({ success: true, liberado: actualizados > 0 });
    } catch (error) {
        return res.status(500).json({ error: 'Error al liberar el candado', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// PUT: actualiza el nombre y/o el whs_code_destino (bodega SAP móvil)
// de una ruta de pollo ya existente. whs_code_origen (el muelle) no se
// toca aquí — cambiar de muelle a una ruta ya creada no aplica.
// ------------------------------------------------------------
async function actualizarRutaPollo(req, res) {
    const { ruta_id, nombre_ruta, whs_code_destino } = req.body;

    if (!ruta_id) {
        return res.status(400).json({ error: 'ruta_id es requerido', success: false });
    }

    try {
        const ruta = await CatalogoRutaPolloModel.findByPk(ruta_id);

        if (!ruta) {
            return res.status(404).json({ error: 'Ruta no encontrada', success: false });
        }

        const cambios = {};
        if (nombre_ruta !== undefined && nombre_ruta.trim()) cambios.nombre_ruta = nombre_ruta.trim();
        if (whs_code_destino !== undefined && whs_code_destino.trim()) cambios.whs_code_destino = whs_code_destino.trim();

        if (Object.keys(cambios).length === 0) {
            return res.status(400).json({ error: 'No se envió ningún campo para actualizar', success: false });
        }

        await ruta.update(cambios);

        return res.json({ success: true, ruta });
    } catch (error) {
        return res.status(500).json({ error: 'Error al actualizar la ruta', details: error.message, success: false });
    }
}

module.exports = {
    getRutasPollo,
    crearRutaPollo,
    actualizarRutaPollo,
    buscarTiendasPdv,
    getTiendasDeRuta,
    asignarTiendaRutaPollo,
    quitarTiendaDeRutaPollo,
    getMuelleUsuario,
    getCandadoActivo,
    tomarCandado,
    liberarCandado
};