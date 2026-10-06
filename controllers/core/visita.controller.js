const { Op, fn, col } = require('sequelize');
const VisitaModel = require('../../models/core/tbl_visita.model');
const VisitaEvidenciaModel = require('../../models/core/tbl_visita_evidencia.model');
const UsersModel = require('../../models/pioapp/users.model');
const { getPresignedUrl } = require('../../integrations/aws/s3');
const { dibujarPdfVisitas, enviarExcelVisitas } = require('../../services/visitaReportes');

const LIMITE_LISTADO = 500;
const LIMITE_EXPORTACION = 5000;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Guatemala no usa horario de verano: siempre UTC-6.
const OFFSET_GUATEMALA = '-06:00';
const EXPIRA_URL_EVIDENCIA_SEG = 3600;

class FiltroInvalidoError extends Error {}

function nombreCompleto(u) {
    return [u.first_name, u.second_name, u.first_last_name, u.second_last_name].filter(Boolean).join(' ');
}

// Arma el where de Sequelize a partir de los filtros del query string.
// Las fechas se interpretan en hora de Guatemala (el día completo).
function construirFiltros(query) {
    const { id_usuario, fecha_desde, fecha_hasta, whs_name } = query;
    const where = {};

    if (id_usuario) {
        if (!/^\d+$/.test(id_usuario)) throw new FiltroInvalidoError('id_usuario inválido');
        where.id_usuario = id_usuario;
    }

    if (fecha_desde && !REGEX_FECHA.test(fecha_desde)) throw new FiltroInvalidoError('fecha_desde inválida (YYYY-MM-DD)');
    if (fecha_hasta && !REGEX_FECHA.test(fecha_hasta)) throw new FiltroInvalidoError('fecha_hasta inválida (YYYY-MM-DD)');
    if (fecha_desde && fecha_hasta && fecha_desde > fecha_hasta) {
        throw new FiltroInvalidoError('fecha_desde no puede ser mayor que fecha_hasta');
    }

    if (fecha_desde || fecha_hasta) {
        where.fecha_visita = {};
        if (fecha_desde) where.fecha_visita[Op.gte] = new Date(`${fecha_desde}T00:00:00.000${OFFSET_GUATEMALA}`);
        if (fecha_hasta) where.fecha_visita[Op.lte] = new Date(`${fecha_hasta}T23:59:59.999${OFFSET_GUATEMALA}`);
    }

    const nombreLugar = typeof whs_name === 'string' ? whs_name.trim().replace(/[%_]/g, '') : '';
    if (nombreLugar) {
        where.whs_name = { [Op.iLike]: `%${nombreLugar}%` };
    }

    return { where, nombreLugar };
}

function numeroONull(valor) {
    return valor === null || valor === undefined ? null : Number(valor);
}

function describirFiltros({ fecha_desde, fecha_hasta, nombreLugar }, usuarioNombre) {
    const partes = [];

    if (usuarioNombre) partes.push(`Usuario: ${usuarioNombre}`);
    if (fecha_desde && fecha_hasta) {
        partes.push(fecha_desde === fecha_hasta ? `Fecha: ${fecha_desde}` : `Fechas: ${fecha_desde} a ${fecha_hasta}`);
    } else if (fecha_desde) {
        partes.push(`Desde: ${fecha_desde}`);
    } else if (fecha_hasta) {
        partes.push(`Hasta: ${fecha_hasta}`);
    }
    if (nombreLugar) partes.push(`Lugar: ${nombreLugar}`);

    return partes.length > 0 ? partes.join(' · ') : 'Sin filtros (todas las visitas)';
}

// Visitas que cumplen el filtro, con el nombre del usuario y el total de
// evidencias. Devuelve también cuántas cumplen el filtro en total (puede ser
// más que las devueltas, que se limitan a `limite`).
async function consultarVisitas(where, limite) {
    const [total, visitas] = await Promise.all([
        VisitaModel.count({ where }),
        VisitaModel.findAll({ where, order: [['fecha_visita', 'DESC']], limit: limite })
    ]);

    if (visitas.length === 0) return { total, filas: [] };

    const idsUsuario = [...new Set(visitas.map(v => String(v.id_usuario)))];
    const idsVisita = visitas.map(v => v.id_visita);

    const [usuarios, conteoEvidencias] = await Promise.all([
        UsersModel.findAll({
            where: { id_users: idsUsuario },
            attributes: ['id_users', 'codigo_user', 'first_name', 'second_name', 'first_last_name', 'second_last_name']
        }),
        VisitaEvidenciaModel.findAll({
            attributes: ['id_visita', [fn('COUNT', col('id_evidencia')), 'total']],
            where: { id_visita: { [Op.in]: idsVisita } },
            group: ['id_visita'],
            raw: true
        })
    ]);

    const usuarioPorId = new Map(usuarios.map(u => [String(u.id_users), u]));
    const evidenciasPorVisita = new Map(conteoEvidencias.map(e => [e.id_visita, Number(e.total)]));

    const filas = visitas.map((v) => {
        const u = usuarioPorId.get(String(v.id_usuario));

        return {
            id_visita: v.id_visita,
            id_usuario: String(v.id_usuario),
            usuario_nombre: u ? nombreCompleto(u) : `Usuario #${v.id_usuario}`,
            codigo_user: u ? u.codigo_user : null,
            whs_code: v.whs_code,
            whs_name: v.whs_name,
            comentario: v.comentario,
            fecha_visita: v.fecha_visita,
            phone_lat: numeroONull(v.phone_gps_latitude),
            phone_lng: numeroONull(v.phone_gps_longitude),
            photo_lat: numeroONull(v.photo_gps_latitude),
            photo_lng: numeroONull(v.photo_gps_longitude),
            is_offline: v.is_offline,
            device_model: v.device_model,
            device_so: v.device_so,
            total_evidencias: evidenciasPorVisita.get(v.id_visita) || 0
        };
    });

    return { total, filas };
}

// GET /visita/getUsuarios — usuarios que tienen al menos una visita, para el
// filtro por usuario.
async function getUsuariosConVisitas(req, res) {
    try {
        const ids = await VisitaModel.findAll({
            attributes: [[fn('DISTINCT', col('id_usuario')), 'id_usuario']],
            raw: true
        });

        const usuarios = await UsersModel.findAll({
            where: { id_users: ids.map(i => String(i.id_usuario)) },
            attributes: ['id_users', 'codigo_user', 'first_name', 'second_name', 'first_last_name', 'second_last_name']
        });

        const resultado = ids.map((i) => {
            const u = usuarios.find(x => String(x.id_users) === String(i.id_usuario));

            return {
                id_usuario: String(i.id_usuario),
                codigo_user: u ? u.codigo_user : null,
                nombre: u ? nombreCompleto(u) : `Usuario #${i.id_usuario}`
            };
        }).sort((a, b) => a.nombre.localeCompare(b.nombre));

        return res.json({ success: true, usuarios: resultado });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener los usuarios con visitas',
            details: error.message,
            success: false
        });
    }
}

// GET /visita/buscarVisitas?id_usuario=&fecha_desde=&fecha_hasta=&whs_name=
async function buscarVisitas(req, res) {
    try {
        const { where } = construirFiltros(req.query);
        const { total, filas } = await consultarVisitas(where, LIMITE_LISTADO);

        return res.json({ success: true, total, limite: LIMITE_LISTADO, visitas: filas });
    } catch (error) {
        if (error instanceof FiltroInvalidoError) {
            return res.status(400).json({ error: error.message, success: false });
        }

        return res.status(500).json({
            error: 'Error al buscar las visitas',
            details: error.message,
            success: false
        });
    }
}

// url_s3 puede venir como s3://bucket/key, como URL https de S3 (virtual-hosted
// o path-style) o solo como la key. Devuelve null si es una URL externa que no
// es de S3 (se usa tal cual).
function resolverObjetoS3(urlS3) {
    const bucketPorDefecto = process.env.AWS_BUCKET_NAME;

    if (urlS3.startsWith('s3://')) {
        const [, , bucket, ...resto] = urlS3.split('/');
        return { bucket, key: resto.join('/') };
    }

    if (/^https?:\/\//i.test(urlS3)) {
        const url = new URL(urlS3);
        const virtualHosted = url.hostname.match(/^(.+)\.s3[.-]/);

        if (virtualHosted) {
            return { bucket: virtualHosted[1], key: decodeURIComponent(url.pathname.slice(1)) };
        }

        if (/^s3[.-]/.test(url.hostname)) {
            const [bucket, ...resto] = url.pathname.slice(1).split('/');
            return { bucket, key: decodeURIComponent(resto.join('/')) };
        }

        return null;
    }

    return { bucket: bucketPorDefecto, key: urlS3.replace(/^\/+/, '') };
}

async function urlDeEvidencia(urlS3) {
    try {
        const objeto = resolverObjetoS3(urlS3);
        if (!objeto) return urlS3;

        return await getPresignedUrl({ bucket: objeto.bucket, key: objeto.key, expiresInSec: EXPIRA_URL_EVIDENCIA_SEG });
    } catch (error) {
        console.error('[Visitas] No se pudo firmar la URL de la evidencia:', error.message);
        return /^https?:\/\//i.test(urlS3) ? urlS3 : null;
    }
}

// GET /visita/getVisita?id_visita=... — detalle de una visita con sus
// evidencias (URLs firmadas de S3, válidas 1 hora).
async function getVisita(req, res) {
    const { id_visita } = req.query;

    if (!id_visita || !REGEX_UUID.test(id_visita)) {
        return res.status(400).json({ error: 'id_visita inválido', success: false });
    }

    try {
        const visita = await VisitaModel.findByPk(id_visita);

        if (!visita) {
            return res.status(404).json({ error: 'Visita no encontrada', success: false });
        }

        const { filas } = await consultarVisitas({ id_visita }, 1);
        const evidencias = await VisitaEvidenciaModel.findAll({
            where: { id_visita },
            order: [['orden', 'ASC']]
        });

        const evidenciasConUrl = await Promise.all(evidencias.map(async e => ({
            id_evidencia: e.id_evidencia,
            tipo_archivo: e.tipo_archivo,
            orden: e.orden,
            es_obligatoria: e.es_obligatoria,
            url: await urlDeEvidencia(e.url_s3)
        })));

        return res.json({
            success: true,
            visita: { ...filas[0], device_uuid: visita.device_uuid },
            evidencias: evidenciasConUrl
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener la visita',
            details: error.message,
            success: false
        });
    }
}

// GET /visita/exportarVisitas?...mismos filtros...&formato=pdf|excel
async function exportarVisitas(req, res) {
    const formato = req.query.formato === 'excel' ? 'excel' : 'pdf';

    try {
        const filtros = construirFiltros(req.query);
        const { total, filas } = await consultarVisitas(filtros.where, LIMITE_EXPORTACION);

        if (filas.length === 0) {
            return res.status(404).json({ error: 'No hay visitas para los filtros seleccionados', success: false });
        }

        const usuarioNombre = req.query.id_usuario ? filas[0].usuario_nombre : null;
        const descripcionFiltros = describirFiltros({ ...req.query, nombreLugar: filtros.nombreLugar }, usuarioNombre);
        const marcaDeTiempo = new Date().toISOString().slice(0, 10);

        if (formato === 'excel') {
            return await enviarExcelVisitas(res, { filas, total, descripcionFiltros }, `visitas_${marcaDeTiempo}.xlsx`);
        }

        return dibujarPdfVisitas(res, { filas, total, descripcionFiltros, nombreArchivo: `visitas_${marcaDeTiempo}.pdf` });
    } catch (error) {
        if (error instanceof FiltroInvalidoError) {
            return res.status(400).json({ error: error.message, success: false });
        }

        if (res.headersSent) {
            return res.end();
        }

        return res.status(500).json({
            error: 'Error al exportar las visitas',
            details: error.message,
            success: false
        });
    }
}

module.exports = {
    getUsuariosConVisitas,
    buscarVisitas,
    getVisita,
    exportarVisitas
};
