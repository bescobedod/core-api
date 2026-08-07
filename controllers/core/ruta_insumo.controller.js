const initTiendaModel = require('../../models/pdv/tTienda.model');
const CatalogoRutaInsumosModel = require('../../models/core/tbl_catalogo_rutas_insumos.model');
const TiendaRutaInsumosModel = require('../../models/core/tbl_tiendas_rutas_insumos.model');
const BloqueoRutaInsumosModel = require('../../models/core/tbl_bloqueo_ruta_insumos.model');
const sequelizeInit = require('../../configuration/db');
const { Op, fn, col } = require('sequelize');

// Nota: la asociación CatalogoRutaInsumosModel <-> TiendaRutaInsumosModel
// se declara en pedido.controller.js (donde sí se usa con include), para
// no declararla dos veces sobre el mismo alias.

// TODO: confirmar el nombre real de la clave de conexión a PDV en configDatabase
const PDV_CONNECTION = 'PDV';

// ------------------------------------------------------------
// GET: lista las rutas de insumos, con cuántas tiendas tiene asignadas
// ------------------------------------------------------------
async function getRutasInsumos(req, res) {
    try {
        const rutas = await CatalogoRutaInsumosModel.findAll({
            order: [['nombre_ruta', 'ASC']]
        });

        const rutaIds = rutas.map(r => r.id);

        const conteos = await TiendaRutaInsumosModel.findAll({
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
        return res.status(500).json({ error: 'Error al obtener las rutas de insumos', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// POST: crea una ruta de insumos nueva (whs_code_origen siempre "01")
// ------------------------------------------------------------
async function crearRutaInsumos(req, res) {
    const { nombre_ruta, whs_code_destino } = req.body;

    if (!nombre_ruta || !whs_code_destino) {
        return res.status(400).json({
            error: 'nombre_ruta y whs_code_destino son requeridos',
            success: false
        });
    }

    try {
        const ruta = await CatalogoRutaInsumosModel.create({
            nombre_ruta,
            whs_code_origen: '01',
            whs_code_destino,
            activo: true,
            creado_en: new Date()
        });

        return res.json({ success: true, ruta });
    } catch (error) {
        return res.status(500).json({ error: 'Error al crear la ruta de insumos', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// GET: busca tiendas en PDV, e indica si ya están asignadas a alguna
// ruta de insumos vigente.
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

        const asignadas = await TiendaRutaInsumosModel.findAll({
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
// GET: tiendas vigentes de una ruta de insumos
// ------------------------------------------------------------
async function getTiendasDeRuta(req, res) {
    const { ruta_id } = req.params;

    try {
        const tiendas = await TiendaRutaInsumosModel.findAll({
            where: { ruta_id, fecha_fin_asignacion: null },
            order: [['nombre_tienda', 'ASC']]
        });

        return res.json({ success: true, tiendas });
    } catch (error) {
        return res.status(500).json({ error: 'Error al obtener las tiendas de la ruta', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// POST: asigna una tienda a una ruta de insumos (cierra la asignación
// vigente anterior, sea de la misma ruta o de otra)
// ------------------------------------------------------------
async function asignarTiendaRutaInsumos(req, res) {
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

        await TiendaRutaInsumosModel.update(
            { fecha_fin_asignacion: ahora },
            { where: { id_tienda_simphony, fecha_fin_asignacion: null }, transaction: t }
        );

        const nuevaAsignacion = await TiendaRutaInsumosModel.create({
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
// POST: quita una tienda de su ruta de insumos actual
// ------------------------------------------------------------
async function quitarTiendaDeRutaInsumos(req, res) {
    const { id_tienda_simphony } = req.body;

    if (!id_tienda_simphony) {
        return res.status(400).json({ error: 'id_tienda_simphony es requerido', success: false });
    }

    try {
        await TiendaRutaInsumosModel.update(
            { fecha_fin_asignacion: new Date() },
            { where: { id_tienda_simphony, fecha_fin_asignacion: null } }
        );

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: 'Error al quitar la tienda de la ruta', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// GET: candado global activo (si existe) — no depende de ningún muelle
// ------------------------------------------------------------
async function getCandadoActivoInsumos(req, res) {
    try {
        const candado = await BloqueoRutaInsumosModel.findOne({
            where: { alcance: 'GLOBAL', estado: 'ACTIVO' }
        });

        return res.json({ success: true, candado: candado || null });
    } catch (error) {
        return res.status(500).json({ error: 'Error al consultar el candado', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// POST: toma el candado global de insumos para una ruta+fecha
// ------------------------------------------------------------
async function tomarCandadoInsumos(req, res) {
    const { ruta_id, fecha } = req.body;
    const id_usuario = req.user && req.user.id_usuario;

    if (!ruta_id || !fecha) {
        return res.status(400).json({ error: 'ruta_id y fecha son requeridos', success: false });
    }

    try {
        const ruta = await CatalogoRutaInsumosModel.findByPk(ruta_id);

        if (!ruta) {
            return res.status(404).json({ error: 'Ruta no encontrada', success: false });
        }

        const candadoExistente = await BloqueoRutaInsumosModel.findOne({
            where: { alcance: 'GLOBAL', estado: 'ACTIVO' }
        });

        if (candadoExistente) {
            const esLaMismaRutaYUsuario =
                candadoExistente.ruta_id === ruta_id &&
                candadoExistente.fecha === fecha &&
                String(candadoExistente.id_usuario) === String(id_usuario);

            if (esLaMismaRutaYUsuario) {
                return res.json({ success: true, candado: candadoExistente });
            }

            return res.status(409).json({
                error: 'Hay otra ruta de insumos en proceso — libérala antes de tomar otra',
                candado: candadoExistente,
                success: false
            });
        }

        const nuevoCandado = await BloqueoRutaInsumosModel.create({
            alcance: 'GLOBAL',
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
                error: 'Hay otra ruta de insumos en proceso — libérala antes de tomar otra',
                success: false
            });
        }

        return res.status(500).json({ error: 'Error al tomar el candado', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// POST: libera el candado global de insumos
// ------------------------------------------------------------
async function liberarCandadoInsumos(req, res) {
    const { ruta_id, fecha } = req.body;

    if (!ruta_id || !fecha) {
        return res.status(400).json({ error: 'ruta_id y fecha son requeridos', success: false });
    }

    try {
        const [actualizados] = await BloqueoRutaInsumosModel.update(
            { estado: 'LIBERADO', fecha_liberacion: new Date() },
            { where: { ruta_id, fecha, estado: 'ACTIVO' } }
        );

        return res.json({ success: true, liberado: actualizados > 0 });
    } catch (error) {
        return res.status(500).json({ error: 'Error al liberar el candado', details: error.message, success: false });
    }
}

// ------------------------------------------------------------
// PUT: actualiza el nombre y/o el whs_code_destino de una ruta de
// insumos ya existente. whs_code_origen (siempre "01") no se toca.
// ------------------------------------------------------------
async function actualizarRutaInsumos(req, res) {
    const { ruta_id, nombre_ruta, whs_code_destino } = req.body;

    if (!ruta_id) {
        return res.status(400).json({ error: 'ruta_id es requerido', success: false });
    }

    try {
        const ruta = await CatalogoRutaInsumosModel.findByPk(ruta_id);

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
    getRutasInsumos,
    crearRutaInsumos,
    actualizarRutaInsumos,
    buscarTiendasPdv,
    getTiendasDeRuta,
    asignarTiendaRutaInsumos,
    quitarTiendaDeRutaInsumos,
    getCandadoActivoInsumos,
    tomarCandadoInsumos,
    liberarCandadoInsumos
};