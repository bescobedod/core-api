const { Op, fn, col } = require('sequelize');
const MarcajeModel = require('../../models/core/tbl_marcaje.model');
const MarcajeZonaModel = require('../../models/core/tbl_marcaje_zona.model');
const MarcajeZonaUsuarioModel = require('../../models/core/tbl_marcaje_zona_usuario.model');
const MarcajeRolesModel = require('../../models/core/tbl_marcaje_roles.model');
const UsersModel = require('../../models/pioapp/users.model');
const { urlDeEvidencia } = require('./visita.controller');
const { enviarExcelMarcajes } = require('../../services/marcajeReportes');

const TAMANO_PAGINA_DEFECTO = 50;
const TAMANO_PAGINA_MAXIMO = 200;
const LIMITE_EXPORTACION = 5000;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Guatemala no usa horario de verano: siempre UTC-6.
const OFFSET_GUATEMALA = '-06:00';
const TIPOS_VALIDOS = ['ENTRADA', 'SALIDA'];
const ESTADOS_VALIDOS = ['valido', 'invalido'];
const RADIO_TIERRA_M = 6371000;

class FiltroInvalidoError extends Error {}
class AccesoDenegadoError extends Error {}

const PREFIJO_TODAS_LAS_EMPRESAS = '*';

function nombreCompleto(u) {
    return [u.first_name, u.second_name, u.first_last_name, u.second_last_name].filter(Boolean).join(' ');
}

function numeroONull(valor) {
    return valor === null || valor === undefined ? null : Number(valor);
}

function distanciaMetros(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(a));
}

// Si las tablas de zonas no existen el reporte sigue sin información de zonas (42P01 = tabla inexistente).
async function tolerarTablaInexistente(consulta, valorPorDefecto) {
    try {
        return await consulta();
    } catch (error) {
        if (error?.original?.code === '42P01' || error?.parent?.code === '42P01') return valorPorDefecto;
        throw error;
    }
}

// Ids de los usuarios cuyas empresas (prefijo del código de empleado) puede ver el rol.
// null = todas las empresas.
async function idsUsuariosPermitidos(rol) {
    const permisos = await MarcajeRolesModel.findAll({ where: { id_rol: Number(rol) || 0 }, raw: true });

    if (permisos.length === 0) throw new AccesoDenegadoError('Tu rol no tiene acceso a los marcajes');
    if (permisos.some(p => p.prefijo === PREFIJO_TODAS_LAS_EMPRESAS)) return null;

    const prefijos = [...new Set(permisos.map(p => p.prefijo))].filter(p => /^[A-Za-z]+$/.test(p));
    if (prefijos.length === 0) throw new AccesoDenegadoError('Tu rol no tiene acceso a los marcajes');

    const usuarios = await UsersModel.findAll({
        where: { codigo_user: { [Op.iRegexp]: `^(${prefijos.join('|')})([^A-Za-z]|$)` } },
        attributes: ['id_users'],
        raw: true
    });

    return usuarios.map(u => String(u.id_users));
}

// Limita where.id_usuario a los usuarios permitidos (null = sin restricción).
function restringirUsuarios(where, idsPermitidos) {
    if (idsPermitidos === null) return;

    const actual = where.id_usuario;
    const permitidos = new Set(idsPermitidos);

    if (actual === undefined) {
        where.id_usuario = idsPermitidos.length > 0 ? idsPermitidos : null;
    } else if (Array.isArray(actual)) {
        const interseccion = actual.filter(id => permitidos.has(String(id)));
        where.id_usuario = interseccion.length > 0 ? interseccion : null;
    } else if (actual !== null && !permitidos.has(String(actual))) {
        where.id_usuario = null;
    }
}

function responderErrorAcceso(res, error) {
    if (!(error instanceof AccesoDenegadoError)) return false;
    res.status(403).json({ error: error.message, success: false });
    return true;
}

// Arma el where a partir de los filtros; las fechas se interpretan en hora de Guatemala.
async function construirFiltros(query, rol) {
    const { id_usuario, fecha_desde, fecha_hasta, tipo, estado, id_zona } = query;
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
        where.fecha_hora = {};
        if (fecha_desde) where.fecha_hora[Op.gte] = new Date(`${fecha_desde}T00:00:00.000${OFFSET_GUATEMALA}`);
        if (fecha_hasta) where.fecha_hora[Op.lte] = new Date(`${fecha_hasta}T23:59:59.999${OFFSET_GUATEMALA}`);
    }

    if (tipo) {
        if (!TIPOS_VALIDOS.includes(tipo)) throw new FiltroInvalidoError('tipo inválido');
        where.tipo = tipo;
    }

    if (estado) {
        if (!ESTADOS_VALIDOS.includes(estado)) throw new FiltroInvalidoError('estado inválido');
        where.es_valido = estado === 'valido';
    }

    // Zona: personas que han estado asignadas a ella (activas o dadas de baja).
    let nombreZona = null;
    if (id_zona) {
        if (!/^\d+$/.test(id_zona)) throw new FiltroInvalidoError('id_zona inválido');

        const zona = await MarcajeZonaModel.findByPk(id_zona);
        if (!zona) throw new FiltroInvalidoError('La zona indicada no existe');
        nombreZona = zona.nombre;

        const asignaciones = await MarcajeZonaUsuarioModel.findAll({
            where: { id_zona },
            attributes: ['id_usuario'],
            raw: true
        });
        const idsZona = [...new Set(asignaciones.map(a => String(a.id_usuario)))];

        if (where.id_usuario) {
            if (!idsZona.includes(String(where.id_usuario))) where.id_usuario = null;
        } else {
            where.id_usuario = idsZona.length > 0 ? idsZona : null;
        }
    }

    restringirUsuarios(where, await idsUsuariosPermitidos(rol));

    return { where, nombreZona };
}

function leerPaginacion({ pagina, tamano }) {
    if (pagina !== undefined && !/^\d+$/.test(pagina)) throw new FiltroInvalidoError('pagina inválida');
    if (tamano !== undefined && !/^\d+$/.test(tamano)) throw new FiltroInvalidoError('tamano inválido');

    const paginaActual = Math.max(Number(pagina) || 1, 1);
    const tamanoPagina = Math.min(Math.max(Number(tamano) || TAMANO_PAGINA_DEFECTO, 1), TAMANO_PAGINA_MAXIMO);

    return { pagina: paginaActual, tamano: tamanoPagina };
}

function describirFiltros({ fecha_desde, fecha_hasta, tipo, estado }, usuarioNombre, nombreZona) {
    const partes = [];

    if (usuarioNombre) partes.push(`Usuario: ${usuarioNombre}`);
    if (fecha_desde && fecha_hasta) {
        partes.push(fecha_desde === fecha_hasta ? `Fecha: ${fecha_desde}` : `Fechas: ${fecha_desde} a ${fecha_hasta}`);
    } else if (fecha_desde) {
        partes.push(`Desde: ${fecha_desde}`);
    } else if (fecha_hasta) {
        partes.push(`Hasta: ${fecha_hasta}`);
    }
    if (tipo) partes.push(`Tipo: ${tipo}`);
    if (estado) partes.push(`Estado: ${estado === 'valido' ? 'Válidos' : 'Inválidos'}`);
    if (nombreZona) partes.push(`Zona: ${nombreZona}`);

    return partes.length > 0 ? partes.join(' · ') : 'Sin filtros (todos los marcajes)';
}

// Evalúa el marcaje contra las zonas que la persona tenía asignadas en ese momento.
function evaluarZona(marcaje, asignaciones, zonasPorId) {
    const momento = new Date(marcaje.fecha_hora).getTime();
    const zonas = asignaciones
        .filter(a => new Date(a.fecha_alta).getTime() <= momento
            && (!a.fecha_baja || new Date(a.fecha_baja).getTime() > momento))
        .map(a => zonasPorId.get(a.id_zona))
        .filter(z => z && z.activo);

    if (zonas.length === 0) {
        return { zona_estado: 'SIN_RESTRICCION', zona_nombre: null, zona_distancia_m: null, zonas_asignadas: [] };
    }

    const zonasAsignadas = [...new Set(zonas.map(z => z.nombre))];
    const lat = numeroONull(marcaje.latitud);
    const lng = numeroONull(marcaje.longitud);

    if (lat === null || lng === null) {
        return { zona_estado: 'SIN_GPS', zona_nombre: null, zona_distancia_m: null, zonas_asignadas: zonasAsignadas };
    }

    let masCercana = null;
    let menorDistancia = Infinity;
    let dentro = false;

    for (const z of zonas) {
        const d = distanciaMetros(lat, lng, Number(z.latitud), Number(z.longitud));
        if (d <= z.radio_metros) {
            // Si cae en varias zonas se queda con la más cercana a su centro.
            if (!dentro || d < menorDistancia) {
                dentro = true;
                menorDistancia = d;
                masCercana = z;
            }
        } else if (!dentro && d < menorDistancia) {
            menorDistancia = d;
            masCercana = z;
        }
    }

    return {
        zona_estado: dentro ? 'DENTRO' : 'FUERA',
        zona_nombre: masCercana.nombre,
        zona_distancia_m: Math.round(menorDistancia),
        zonas_asignadas: zonasAsignadas
    };
}

// Marcajes del filtro con usuario y evaluación de zona; `total` es el conteo sin paginar.
async function consultarMarcajes(where, limite, desplazamiento = 0) {
    const [total, marcajes] = await Promise.all([
        MarcajeModel.count({ where }),
        MarcajeModel.findAll({
            where,
            order: [['fecha_hora', 'DESC'], ['id_marcaje', 'ASC']],
            limit: limite,
            offset: desplazamiento
        })
    ]);

    if (marcajes.length === 0) return { total, filas: [] };

    const idsUsuario = [...new Set(marcajes.map(m => String(m.id_usuario)))];

    const [usuarios, asignaciones, zonas] = await Promise.all([
        UsersModel.findAll({
            where: { id_users: idsUsuario },
            attributes: ['id_users', 'codigo_user', 'first_name', 'second_name', 'first_last_name', 'second_last_name', 'puesto_trabajo']
        }),
        tolerarTablaInexistente(
            () => MarcajeZonaUsuarioModel.findAll({ where: { id_usuario: idsUsuario }, raw: true }),
            []
        ),
        tolerarTablaInexistente(() => MarcajeZonaModel.findAll({ raw: true }), [])
    ]);

    const usuarioPorId = new Map(usuarios.map(u => [String(u.id_users), u]));
    const zonasPorId = new Map(zonas.map(z => [z.id_zona, z]));
    const asignacionesPorUsuario = new Map();
    asignaciones.forEach((a) => {
        const clave = String(a.id_usuario);
        if (!asignacionesPorUsuario.has(clave)) asignacionesPorUsuario.set(clave, []);
        asignacionesPorUsuario.get(clave).push(a);
    });

    const filas = marcajes.map((m) => {
        const u = usuarioPorId.get(String(m.id_usuario));
        const evaluacion = evaluarZona(m, asignacionesPorUsuario.get(String(m.id_usuario)) || [], zonasPorId);

        return {
            id_marcaje: m.id_marcaje,
            id_usuario: String(m.id_usuario),
            usuario_nombre: u ? nombreCompleto(u) : `Usuario #${m.id_usuario}`,
            codigo_user: u ? u.codigo_user : null,
            puesto_trabajo: u ? u.puesto_trabajo : null,
            tipo: m.tipo,
            fecha_hora: m.fecha_hora,
            latitud: numeroONull(m.latitud),
            longitud: numeroONull(m.longitud),
            es_valido: m.es_valido,
            razon_invalido: m.razon_invalido,
            is_offline: m.is_offline,
            dispositivo_info: m.dispositivo_info,
            ip_address: m.ip_address,
            fecha_sincronizacion: m.createdAt,
            ...evaluacion
        };
    });

    return { total, filas };
}

// Totales de todo el filtro; "fuera de zona" se evalúa en memoria.
async function calcularResumen(where) {
    const contar = extra => MarcajeModel.count({ where: { [Op.and]: [where, extra] } });

    const [entradas, salidas, offline, asignaciones, zonas] = await Promise.all([
        contar({ tipo: 'ENTRADA' }),
        contar({ tipo: 'SALIDA' }),
        contar({ is_offline: true }),
        tolerarTablaInexistente(() => MarcajeZonaUsuarioModel.findAll({ raw: true }), []),
        tolerarTablaInexistente(() => MarcajeZonaModel.findAll({ raw: true }), [])
    ]);

    let fueraZona = 0;

    if (asignaciones.length > 0 && zonas.length > 0) {
        const zonasPorId = new Map(zonas.map(z => [z.id_zona, z]));
        const asignacionesPorUsuario = new Map();
        asignaciones.forEach((a) => {
            const clave = String(a.id_usuario);
            if (!asignacionesPorUsuario.has(clave)) asignacionesPorUsuario.set(clave, []);
            asignacionesPorUsuario.get(clave).push(a);
        });

        const marcajes = await MarcajeModel.findAll({
            where: { [Op.and]: [where, { id_usuario: [...asignacionesPorUsuario.keys()] }] },
            attributes: ['id_usuario', 'fecha_hora', 'latitud', 'longitud'],
            raw: true
        });

        fueraZona = marcajes.filter(m =>
            evaluarZona(m, asignacionesPorUsuario.get(String(m.id_usuario)) || [], zonasPorId).zona_estado === 'FUERA'
        ).length;
    }

    return { entradas, salidas, fuera_zona: fueraZona, offline };
}

async function getUsuariosConMarcajes(req, res) {
    try {
        const where = {};
        restringirUsuarios(where, await idsUsuariosPermitidos(req.user.rol));

        const ids = await MarcajeModel.findAll({
            where,
            attributes: [[fn('DISTINCT', col('id_usuario')), 'id_usuario']],
            raw: true
        });

        const usuarios = await UsersModel.findAll({
            where: { id_users: ids.map(i => String(i.id_usuario)) },
            attributes: ['id_users', 'codigo_user', 'first_name', 'second_name', 'first_last_name', 'second_last_name']
        });

        const usuarioPorId = new Map(usuarios.map(u => [String(u.id_users), u]));

        const resultado = ids.map((i) => {
            const u = usuarioPorId.get(String(i.id_usuario));

            return {
                id_usuario: String(i.id_usuario),
                codigo_user: u ? u.codigo_user : null,
                nombre: u ? nombreCompleto(u) : `Usuario #${i.id_usuario}`
            };
        }).sort((a, b) => a.nombre.localeCompare(b.nombre));

        return res.json({ success: true, usuarios: resultado });
    } catch (error) {
        if (responderErrorAcceso(res, error)) return;

        return res.status(500).json({
            error: 'Error al obtener los usuarios con marcajes',
            details: error.message,
            success: false
        });
    }
}

// Zonas con el número de personas asignadas activamente.
async function getZonas(req, res) {
    try {
        const zonas = await tolerarTablaInexistente(
            () => MarcajeZonaModel.findAll({ order: [['nombre', 'ASC']], raw: true }),
            []
        );
        const asignaciones = zonas.length === 0 ? [] : await MarcajeZonaUsuarioModel.findAll({
            where: { activo: true },
            attributes: ['id_zona', [fn('COUNT', col('id_zona_usuario')), 'total']],
            group: ['id_zona'],
            raw: true
        });
        const totalPorZona = new Map(asignaciones.map(a => [a.id_zona, Number(a.total)]));

        return res.json({
            success: true,
            zonas: zonas.map(z => ({
                id_zona: z.id_zona,
                nombre: z.nombre,
                latitud: Number(z.latitud),
                longitud: Number(z.longitud),
                radio_metros: z.radio_metros,
                activo: z.activo,
                usuarios_activos: totalPorZona.get(z.id_zona) || 0
            }))
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener las zonas de marcaje',
            details: error.message,
            success: false
        });
    }
}

async function buscarMarcajes(req, res) {
    try {
        const { where } = await construirFiltros(req.query, req.user.rol);
        const { pagina, tamano } = leerPaginacion(req.query);
        const [{ total, filas }, resumen] = await Promise.all([
            consultarMarcajes(where, tamano, (pagina - 1) * tamano),
            req.query.resumen === '1' ? calcularResumen(where) : null
        ]);

        return res.json({
            success: true,
            total,
            ...(resumen && { resumen }),
            pagina,
            tamano,
            total_paginas: Math.max(Math.ceil(total / tamano), 1),
            marcajes: filas
        });
    } catch (error) {
        if (responderErrorAcceso(res, error)) return;

        if (error instanceof FiltroInvalidoError) {
            return res.status(400).json({ error: error.message, success: false });
        }

        return res.status(500).json({
            error: 'Error al buscar los marcajes',
            details: error.message,
            success: false
        });
    }
}

// Detalle del marcaje con la foto (URL firmada de S3, válida 1 hora).
async function getMarcaje(req, res) {
    const { id_marcaje } = req.query;

    if (!id_marcaje || !REGEX_UUID.test(id_marcaje)) {
        return res.status(400).json({ error: 'id_marcaje inválido', success: false });
    }

    try {
        const marcaje = await MarcajeModel.findByPk(id_marcaje);

        if (!marcaje) {
            return res.status(404).json({ error: 'Marcaje no encontrado', success: false });
        }

        const permitidos = await idsUsuariosPermitidos(req.user.rol);
        if (permitidos !== null && !permitidos.includes(String(marcaje.id_usuario))) {
            return res.status(404).json({ error: 'Marcaje no encontrado', success: false });
        }

        const { filas } = await consultarMarcajes({ id_marcaje }, 1);

        // Zonas vigentes al momento del marcaje, para dibujarlas en el mapa.
        const momento = marcaje.fecha_hora;
        const asignaciones = await tolerarTablaInexistente(() => MarcajeZonaUsuarioModel.findAll({
            where: {
                id_usuario: marcaje.id_usuario,
                fecha_alta: { [Op.lte]: momento },
                [Op.or]: [{ fecha_baja: null }, { fecha_baja: { [Op.gt]: momento } }]
            },
            raw: true
        }), []);
        const zonas = asignaciones.length === 0 ? [] : await MarcajeZonaModel.findAll({
            where: { id_zona: asignaciones.map(a => a.id_zona), activo: true },
            raw: true
        });

        return res.json({
            success: true,
            marcaje: {
                ...filas[0],
                dispositivo_uuid: marcaje.dispositivo_uuid,
                foto_url: marcaje.foto_s3_url ? await urlDeEvidencia(marcaje.foto_s3_url) : null,
                zonas: zonas.map(z => ({
                    id_zona: z.id_zona,
                    nombre: z.nombre,
                    latitud: Number(z.latitud),
                    longitud: Number(z.longitud),
                    radio_metros: z.radio_metros
                }))
            }
        });
    } catch (error) {
        if (responderErrorAcceso(res, error)) return;

        return res.status(500).json({
            error: 'Error al obtener el marcaje',
            details: error.message,
            success: false
        });
    }
}

async function exportarMarcajes(req, res) {
    try {
        const filtros = await construirFiltros(req.query, req.user.rol);
        const { total, filas } = await consultarMarcajes(filtros.where, LIMITE_EXPORTACION);

        if (filas.length === 0) {
            return res.status(404).json({ error: 'No hay marcajes para los filtros seleccionados', success: false });
        }

        const usuarioNombre = req.query.id_usuario ? filas[0].usuario_nombre : null;
        const descripcionFiltros = describirFiltros(req.query, usuarioNombre, filtros.nombreZona);
        const marcaDeTiempo = new Date().toISOString().slice(0, 10);

        return await enviarExcelMarcajes(res, { filas, total, descripcionFiltros }, `marcajes_${marcaDeTiempo}.xlsx`);
    } catch (error) {
        if (!res.headersSent && responderErrorAcceso(res, error)) return;

        if (error instanceof FiltroInvalidoError) {
            return res.status(400).json({ error: error.message, success: false });
        }

        if (res.headersSent) {
            return res.end();
        }

        return res.status(500).json({
            error: 'Error al exportar los marcajes',
            details: error.message,
            success: false
        });
    }
}

module.exports = {
    getUsuariosConMarcajes,
    getZonas,
    buscarMarcajes,
    getMarcaje,
    exportarMarcajes
};
