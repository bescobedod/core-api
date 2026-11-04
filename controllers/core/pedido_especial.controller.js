const { Op } = require('sequelize');
const sequelizeInit = require('../../configuration/db');
const UsersModel = require('../../models/pioapp/users.model');
const { nivelPermisoDeMenu, nombreDelUsuario } = require('../../services/permisosMenu.service');
const { parsearPaginacion, armarPaginacion } = require('../../services/paginacion.service');
const PedidoEspecialModel = require('../../models/core/tbl_pedido_especial.model');
const PedidoEspecialDetalleModel = require('../../models/core/tbl_pedido_especial_detalle.model');
const PedidoEspecialHistorialModel = require('../../models/core/tbl_pedido_especial_historial.model');
const { consultarStockPollo } = require('../../integrations/sap/sapClient');
const { obtenerCodigosTiendaPorDivision, obtenerMapaDivisionPorTienda } = require('./pedido.controller');

// Menús (config.tbl_menu.nombre_menu) que dan acceso a cada parte. El permiso
// sale de tbl_menu_rol por rol, igual que en el resto de Core.
const MENU_AUTORIZAR = 'AutorizarPedidosEspecialesView';
const MENU_DESPACHO = 'PedidosEspecialesView';

// Los pedidos especiales se preparan siempre en el muelle Central.
const WHS_MUELLE_CENTRAL = 'RAS-002';

const ESTADOS_VALIDOS = ['PENDIENTE_APROBACION', 'RECHAZADO', 'AUTORIZADO', 'EN_PREPARACION', 'LISTO_PARA_RECOGER', 'ENTREGADO'];
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ZONA_HORARIA = 'America/Guatemala';

class ErrorPedidoEspecial extends Error {
    constructor(status, mensaje) {
        super(mensaje);
        this.status = status;
    }
}

function responderError(res, error, mensajeGenerico) {
    if (error instanceof ErrorPedidoEspecial) {
        return res.status(error.status).json({ error: error.message, success: false });
    }

    return res.status(500).json({ error: mensajeGenerico, details: error.message, success: false });
}

// Quien autoriza necesita el menú de autorizar con nivel 'escritura'.
async function exigirAutorizacion(req) {
    if ((await nivelPermisoDeMenu(req, MENU_AUTORIZAR)) !== 'escritura') {
        throw new ErrorPedidoEspecial(403, 'No tienes permiso para autorizar pedidos especiales');
    }
}

// Quien despacha necesita el menú de pedidos especiales con nivel 'escritura'.
async function exigirDespacho(req) {
    if ((await nivelPermisoDeMenu(req, MENU_DESPACHO)) !== 'escritura') {
        throw new ErrorPedidoEspecial(403, 'No tienes permiso para despachar pedidos especiales');
    }
}

function fechaGuatemala(fecha) {
    return fecha ? new Date(fecha).toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA }) : null;
}

function mapearPedido(pedido, divisionPorTienda) {
    const p = pedido.get({ plain: true });

    return {
        id: p.id,
        numero_pedido: p.numero_pedido,
        codigo_tienda: p.codigo_tienda,
        nombre_tienda: p.nombre_tienda || p.codigo_tienda,
        division: divisionPorTienda.get(p.codigo_tienda) || null,
        fecha_pedido: p.fecha_pedido,
        fecha_requerida: p.fecha_requerida,
        estado: p.estado,
        comentario: p.comentario,
        motivo_rechazo: p.motivo_rechazo,
        autorizado_por: p.autorizado_por_nombre,
        fecha_autorizacion: fechaGuatemala(p.fecha_autorizacion),
        items: [...(p.detalle || [])]
            .sort((a, b) => a.numero_linea - b.numero_linea)
            .map(d => ({
                id: d.id,
                codigo_producto: d.codigo_producto,
                descripcion_producto: d.descripcion_producto,
                unidad_medida: d.unidad_medida,
                cantidad_solicitada: Number(d.cantidad_solicitada),
                cantidad_asignada: Number(d.cantidad_asignada)
            }))
    };
}

async function cargarPedidoMapeado(id) {
    const pedido = await PedidoEspecialModel.findByPk(id, {
        include: [{ model: PedidoEspecialDetalleModel, as: 'detalle' }]
    });

    return mapearPedido(pedido, await obtenerMapaDivisionPorTienda());
}

function validarId(id) {
    if (!id || !REGEX_UUID.test(id)) throw new ErrorPedidoEspecial(400, 'id de pedido inválido');
}

// Pedido con su detalle, dentro de la transacción. El cambio de estado se
// protege con un UPDATE condicionado al estado leído (ver cambiarEstado).
async function pedidoParaCambio(id, transaction) {
    const pedido = await PedidoEspecialModel.findByPk(id, {
        include: [{ model: PedidoEspecialDetalleModel, as: 'detalle' }],
        transaction
    });

    if (!pedido) throw new ErrorPedidoEspecial(404, 'El pedido no existe');

    return pedido;
}

// Cambia el estado solo si nadie más lo cambió antes (evita que dos personas
// autoricen o procesen el mismo pedido a la vez) y deja el rastro en el historial.
async function cambiarEstado(pedido, estadosPermitidos, estadoNuevo, campos, usuario, comentario, transaction) {
    if (!estadosPermitidos.includes(pedido.estado)) {
        throw new ErrorPedidoEspecial(409, 'El pedido ya no está en un estado que permita esta acción');
    }

    const ahora = new Date();

    const [actualizados] = await PedidoEspecialModel.update(
        { ...campos, estado: estadoNuevo, actualizado_en: ahora },
        { where: { id: pedido.id, estado: pedido.estado }, transaction }
    );

    if (actualizados !== 1) {
        throw new ErrorPedidoEspecial(409, 'El pedido cambió mientras lo procesabas, vuelve a cargarlo');
    }

    await PedidoEspecialHistorialModel.create({
        pedido_id: pedido.id,
        estado_anterior: pedido.estado,
        estado_nuevo: estadoNuevo,
        usuario,
        comentario,
        fecha: ahora
    }, { transaction });
}

// GET /pedidoEspecial/getPedidos?estados=A,B&fecha_desde=&fecha_hasta=
// Quien tiene el menú de autorizar o el de despacho con nivel 'lectura' o
// 'escritura' ve todos; con 'lectura_division' (asistente de división) solo
// los de las tiendas de SU división, que se toma de su usuario, no de la petición.
async function getPedidos(req, res) {
    try {
        const [nivelAutorizar, nivelDespacho] = await Promise.all([
            nivelPermisoDeMenu(req, MENU_AUTORIZAR),
            nivelPermisoDeMenu(req, MENU_DESPACHO)
        ]);

        if (!nivelAutorizar && !nivelDespacho) {
            throw new ErrorPedidoEspecial(403, 'No tienes permiso para ver pedidos especiales');
        }

        const where = {};

        if (req.query.estados) {
            const estados = String(req.query.estados).split(',').map(e => e.trim()).filter(Boolean);

            if (estados.length === 0 || estados.some(e => !ESTADOS_VALIDOS.includes(e))) {
                throw new ErrorPedidoEspecial(400, 'estados inválidos');
            }

            where.estado = { [Op.in]: estados };
        }

        const { fecha_desde, fecha_hasta } = req.query;

        if ((fecha_desde && !REGEX_FECHA.test(fecha_desde)) || (fecha_hasta && !REGEX_FECHA.test(fecha_hasta))) {
            throw new ErrorPedidoEspecial(400, 'Las fechas deben tener el formato YYYY-MM-DD');
        }

        if (fecha_desde && fecha_hasta && fecha_desde > fecha_hasta) {
            throw new ErrorPedidoEspecial(400, 'fecha_desde no puede ser mayor que fecha_hasta');
        }

        if (fecha_desde || fecha_hasta) {
            where.fecha_requerida = {};
            if (fecha_desde) where.fecha_requerida[Op.gte] = fecha_desde;
            if (fecha_hasta) where.fecha_requerida[Op.lte] = fecha_hasta;
        }

        if (!nivelAutorizar && nivelDespacho === 'lectura_division') {
            const usuario = await UsersModel.findByPk(req.user.id_usuario, { attributes: ['division'] });

            if (!usuario || !usuario.division) {
                throw new ErrorPedidoEspecial(403, 'Tu usuario no tiene una división asignada');
            }

            where.codigo_tienda = { [Op.in]: await obtenerCodigosTiendaPorDivision(String(usuario.division)) };
        }

        const solicitada = parsearPaginacion(req.query);
        const { page, pageSize, total, totalPages, offset } = armarPaginacion(
            await PedidoEspecialModel.count({ where }),
            solicitada.page,
            solicitada.pageSize
        );

        const [pedidos, divisionPorTienda] = await Promise.all([
            PedidoEspecialModel.findAll({
                where,
                include: [{ model: PedidoEspecialDetalleModel, as: 'detalle' }],
                order: [['fecha_requerida', 'ASC'], ['numero_pedido', 'ASC']],
                limit: pageSize,
                offset
            }),
            obtenerMapaDivisionPorTienda()
        ]);

        return res.json({
            success: true,
            pedidos: pedidos.map(p => mapearPedido(p, divisionPorTienda)),
            paginacion: { page, pageSize, total, totalPages }
        });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los pedidos especiales');
    }
}

// POST /pedidoEspecial/autorizar  { id, items: [{ item_id, cantidad_solicitada }] }
// Autoriza un pedido pendiente; las cantidades que mande reemplazan las pedidas
// (cantidad_original conserva lo que pidió la tienda).
async function autorizar(req, res) {
    try {
        await exigirAutorizacion(req);

        const { id, items } = req.body;
        validarId(id);

        if (!Array.isArray(items)) throw new ErrorPedidoEspecial(400, 'items es requerido');

        const usuario = await nombreDelUsuario(req);
        const t = await sequelizeInit.sequelize.transaction();

        try {
            const pedido = await pedidoParaCambio(id, t);
            const lineas = new Map(pedido.detalle.map(d => [d.id, d]));
            const cambios = [];

            for (const item of items) {
                const linea = lineas.get(item.item_id);
                const cantidad = Number(item.cantidad_solicitada);

                if (!linea) throw new ErrorPedidoEspecial(400, 'Una línea no pertenece a este pedido');
                if (!Number.isFinite(cantidad) || cantidad < 0) {
                    throw new ErrorPedidoEspecial(400, `Cantidad inválida en ${linea.descripcion_producto}`);
                }

                if (cantidad !== Number(linea.cantidad_solicitada)) {
                    cambios.push(`${linea.descripcion_producto}: ${Number(linea.cantidad_solicitada)} → ${cantidad}`);
                    linea.cantidad_solicitada = cantidad;
                }
            }

            if (pedido.detalle.every(d => Number(d.cantidad_solicitada) === 0)) {
                throw new ErrorPedidoEspecial(400, 'Al menos una línea debe tener cantidad mayor a 0');
            }

            const ahora = new Date();

            for (const linea of pedido.detalle) {
                await PedidoEspecialDetalleModel.update(
                    { cantidad_solicitada: linea.cantidad_solicitada, actualizado_en: ahora },
                    { where: { id: linea.id }, transaction: t }
                );
            }

            await cambiarEstado(
                pedido,
                ['PENDIENTE_APROBACION'],
                'AUTORIZADO',
                { autorizado_por: req.user.id_usuario, autorizado_por_nombre: usuario, fecha_autorizacion: ahora },
                usuario,
                cambios.length > 0 ? `Cantidades ajustadas al autorizar — ${cambios.join('; ')}` : 'Pedido autorizado',
                t
            );

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }

        return res.json({ success: true, pedido: await cargarPedidoMapeado(id) });
    } catch (error) {
        return responderError(res, error, 'Error al autorizar el pedido');
    }
}

// POST /pedidoEspecial/rechazar  { id, motivo }
async function rechazar(req, res) {
    try {
        await exigirAutorizacion(req);

        const { id } = req.body;
        const motivo = String(req.body.motivo || '').trim();
        validarId(id);

        if (motivo.length < 5) throw new ErrorPedidoEspecial(400, 'El motivo del rechazo es obligatorio (mínimo 5 caracteres)');

        const usuario = await nombreDelUsuario(req);
        const t = await sequelizeInit.sequelize.transaction();

        try {
            const pedido = await pedidoParaCambio(id, t);

            await cambiarEstado(
                pedido,
                ['PENDIENTE_APROBACION'],
                'RECHAZADO',
                {
                    autorizado_por: req.user.id_usuario,
                    autorizado_por_nombre: usuario,
                    fecha_autorizacion: new Date(),
                    motivo_rechazo: motivo
                },
                usuario,
                `Rechazado: ${motivo}`,
                t
            );

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }

        return res.json({ success: true, pedido: await cargarPedidoMapeado(id) });
    } catch (error) {
        return responderError(res, error, 'Error al rechazar el pedido');
    }
}

// GET /pedidoEspecial/getStock?id=...
// Stock del muelle Central de los artículos del pedido, en bolsas completas
// (la misma unidad en que se pide). Solo informativo: no reserva nada en SAP.
async function getStock(req, res) {
    try {
        await exigirDespacho(req);

        const { id } = req.query;
        validarId(id);

        const pedido = await pedidoParaCambio(id);

        if (!['AUTORIZADO', 'EN_PREPARACION'].includes(pedido.estado)) {
            throw new ErrorPedidoEspecial(409, 'Solo se calcula el stock de pedidos autorizados o en preparación');
        }

        const codigos = [...new Set(pedido.detalle.map(d => d.codigo_producto).filter(Boolean))];
        const stockSap = await consultarStockPollo(codigos, WHS_MUELLE_CENTRAL);
        const stockPorCodigo = new Map(stockSap.map(s => [s.codigo_articulo, s]));

        const stock = pedido.detalle.map((d) => {
            const info = stockPorCodigo.get(d.codigo_producto);

            return {
                codigo_producto: d.codigo_producto,
                stock_disponible: info ? Number(info.bolsas_completas ?? info.stock_disponible) : 0,
                encontrado_en_sap: !!info
            };
        });

        return res.json({ success: true, whs_code: WHS_MUELLE_CENTRAL, stock });
    } catch (error) {
        if (error instanceof ErrorPedidoEspecial) return responderError(res, error);

        return res.status(502).json({
            error: 'Error al consultar el stock en SAP',
            details: error.message,
            success: false
        });
    }
}

// POST /pedidoEspecial/guardarAsignacion  { id, asignaciones: [{ item_id, cantidad_asignada }] }
// Guarda lo asignado a TODAS las líneas; el pedido queda EN_PREPARACION.
async function guardarAsignacion(req, res) {
    try {
        await exigirDespacho(req);

        const { id, asignaciones } = req.body;
        validarId(id);

        if (!Array.isArray(asignaciones)) throw new ErrorPedidoEspecial(400, 'asignaciones es requerido');

        const usuario = await nombreDelUsuario(req);
        const t = await sequelizeInit.sequelize.transaction();

        try {
            const pedido = await pedidoParaCambio(id, t);
            const asignadas = new Map(asignaciones.map(a => [a.item_id, Number(a.cantidad_asignada)]));

            if (asignadas.size !== pedido.detalle.length || pedido.detalle.some(d => !asignadas.has(d.id))) {
                throw new ErrorPedidoEspecial(400, 'Hay que asignar todas las líneas del pedido');
            }

            const ahora = new Date();
            const resumen = [];

            for (const linea of pedido.detalle) {
                const cantidad = asignadas.get(linea.id);
                const solicitada = Number(linea.cantidad_solicitada);

                if (!Number.isFinite(cantidad) || cantidad < 0 || cantidad > solicitada) {
                    throw new ErrorPedidoEspecial(400, `Cantidad inválida en ${linea.descripcion_producto}`);
                }

                let estadoLinea = 'PARCIAL';
                if (cantidad <= 0) estadoLinea = 'SIN_STOCK';
                else if (cantidad >= solicitada) estadoLinea = 'VALIDADA';

                await PedidoEspecialDetalleModel.update({
                    cantidad_asignada: cantidad,
                    estado_linea: estadoLinea,
                    usuario_ajuste: usuario,
                    fecha_ajuste: ahora,
                    actualizado_en: ahora
                }, { where: { id: linea.id }, transaction: t });

                resumen.push(`${linea.descripcion_producto}: ${cantidad}/${solicitada}`);
            }

            await cambiarEstado(
                pedido,
                ['AUTORIZADO', 'EN_PREPARACION'],
                'EN_PREPARACION',
                pedido.fecha_preparacion ? {} : { fecha_preparacion: ahora },
                usuario,
                `Asignación guardada — ${resumen.join('; ')}`,
                t
            );

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }

        return res.json({ success: true, pedido: await cargarPedidoMapeado(id) });
    } catch (error) {
        return responderError(res, error, 'Error al guardar la asignación');
    }
}

// POST /pedidoEspecial/marcarListo  { id }
// Avisa que el pedido ya se puede recoger (EN_PREPARACION -> LISTO_PARA_RECOGER).
async function marcarListo(req, res) {
    try {
        await exigirDespacho(req);

        const { id } = req.body;
        validarId(id);

        const usuario = await nombreDelUsuario(req);
        const t = await sequelizeInit.sequelize.transaction();

        try {
            const pedido = await pedidoParaCambio(id, t);

            await cambiarEstado(
                pedido,
                ['EN_PREPARACION'],
                'LISTO_PARA_RECOGER',
                { fecha_listo: new Date(), usuario_listo: usuario },
                usuario,
                'Pedido listo para recoger',
                t
            );

            await t.commit();
        } catch (error) {
            await t.rollback();
            throw error;
        }

        return res.json({ success: true, pedido: await cargarPedidoMapeado(id) });
    } catch (error) {
        return responderError(res, error, 'Error al marcar el pedido como listo');
    }
}

module.exports = {
    getPedidos,
    autorizar,
    rechazar,
    getStock,
    guardarAsignacion,
    marcarListo
};
