const SolicitudCompraModel = require('../../models/core/tbl_solicitud_compra.model');
const LineaSolicitudCompraModel = require('../../models/core/tbl_linea_solicitud_compra.model');
const MatrizAprobacionSolicitudModel = require('../../models/core/tbl_matriz_aprobacion_solicitud_compra.model');
const NivelMatrizAprobacionSolicitudModel = require('../../models/core/tbl_nivel_matriz_aprobacion_solicitud_compra.model');
const AprobacionSolicitudCompraModel = require('../../models/core/tbl_aprobacion_solicitud_compra.model');
const VwSolicitudCompraModel = require('../../models/core/views/vw_solicitud_compra');
const VwAprobadoresSolicitudCompraModel = require('../../models/core/views/vw_aprobadores_solicitud_compra');
const UsersModel = require('../../models/pioapp/users.model');
const EstrategiaAdquisicionModel = require('../../models/core/tbl_estrategia_adquisicion.model');
const DepartamentoModel = require('../../models/pioapp/tbl_departamento.model');
const { Op } = require('sequelize');
const { sequelize } = require('../../configuration/db');
const { buildS3Key, uploadBufferToS3 } = require('../../integrations/aws/s3');
const sap = require('../../integrations/sap/sapClient');
const axios = require('axios');

const S3_BUCKET = process.env.AWS_BUCKET_NAME;
const REGION = process.env.AWS_BUCKET_REGION;

VwSolicitudCompraModel.hasMany(LineaSolicitudCompraModel, { 
    foreignKey: 'requisicion_id', 
    as: 'items' 
});

SolicitudCompraModel.hasMany(LineaSolicitudCompraModel, { 
    foreignKey: 'requisicion_id', 
    as: 'items' 
});

LineaSolicitudCompraModel.belongsTo(SolicitudCompraModel, { 
    foreignKey: 'requisicion_id' 
});

SolicitudCompraModel.belongsTo(UsersModel, {
    foreignKey: 'solicitado_por',
    targetKey: 'id_users',
    as: 'usuario'
});

async function enviarNotificacionPush(idUsuario, titulo, mensaje, id_solicitud, numero_requisicion) {
    try {
        await axios.post('https://kevin-unrelegated-ramon.ngrok-free.dev/api/notificaciones/send', {
            id_usuario: [idUsuario],
            title: titulo,
            body: mensaje,
            id_asunto_notificacion: 3,
            payload: {
              id_solicitud,
              numero_requisicion,
              tipo: 'solicitud_compra'
            }
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': '3b0d0dc323531f4e87196737b9e6f529d27b5c15becc0938cfb1e0283666c9f4'
            }
        });
    } catch (error) {
        console.error('Error enviando notificación:', error.message);
    }
}

async function createSolicitudCompra(req, res) {
    const t = await sequelize.transaction();
    try {
        const header = JSON.parse(req.body.header);
        const items = JSON.parse(req.body.items);

        const departamento = await DepartamentoModel.findByPk(req.user.id_departamento);
        if (!departamento) throw new Error('No existe el departamento');

        const estrategia = await EstrategiaAdquisicionModel.findOne({
            where: {
                departamento_id: departamento.id_departamento,
                area_id: req.user.id_area,
                esta_activo: true
            }
        });

        if (!estrategia) throw new Error('No existe una estrategia de adquisición activa para este departamento');

        const matriz = await MatrizAprobacionSolicitudModel.findOne({
            where: {
                estrategia_adquisicion_id: estrategia.id,
                esta_activo: true
            },
            transaction: t
        });

        if (!matriz) throw new Error('No existe una matriz activa para este departamento');

        const nivelUsuario = await NivelMatrizAprobacionSolicitudModel.findOne({
            where: {
                matriz_id: matriz.id,
                usuario_aprobador_id: req.user.id_usuario
            },
            transaction: t
        });

        const nivelActualSolicitante = nivelUsuario ? nivelUsuario.nivel : 0;

        const todosLosNiveles = await NivelMatrizAprobacionSolicitudModel.findAll({
            where: { matriz_id: matriz.id },
            order: [['nivel', 'ASC']],
            transaction: t
        });

        const nivelSiguiente = todosLosNiveles.find(n => n.nivel > nivelActualSolicitante);
        const nivelDestino = nivelSiguiente ? nivelSiguiente.nivel : nivelActualSolicitante;

        const encabezado = await SolicitudCompraModel.create({
            ...header,
            numero_requisicion: 'REQ',
            codigo_departamento: departamento.codigo,
            solicitado_por: req.user.id_usuario,
            departamento_id: departamento.id_departamento,
            estrategia_adquisicion_id: estrategia.id,
            nivel_aprobador: nivelDestino,
            estado: nivelSiguiente ? 'PENDIENTE' : 'AUTO_APROBADO'
        }, { transaction: t });

        const itemsConId = await Promise.all(
            items.map(async (item, index) => {
                let imagen_s3_key = null;
                let imagen_nombre = null;

                const file = req.files?.find(f => f.fieldname === `imagen_${index}`);

                if (file) {
    const key = buildS3Key({
        id_solicitud: encabezado.id,
        originalName: file.originalname,
        mimeType: file.mimetype
    });

    await uploadBufferToS3({
        bucket: process.env.AWS_BUCKET_NAME,
        key,
        buffer: file.buffer,
        contentType: file.mimetype
    });

    const url_archivo = `https://${S3_BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

    imagen_s3_key = url_archivo; // 👈 AQUÍ guardas la URL
    imagen_nombre = file.originalname;
}

                return {
                    ...item,
                    requisicion_id: encabezado.id,
                    numero_linea: index + 1,
                    imagen_s3_key,
                    imagen_nombre
                };
            })
        );

        await LineaSolicitudCompraModel.bulkCreate(itemsConId, { transaction: t });

        if (todosLosNiveles.length > 0) {
            const registrosAprobacion = todosLosNiveles.map(n => {
                let estadoFila = '';
                let comentarioFila = null;

                if (n.nivel <= nivelActualSolicitante) {
                    estadoFila = 'NO APLICA';
                    comentarioFila = 'Nivel omitido por jerarquía del solicitante';
                } else if (n.nivel === nivelDestino) {
                    estadoFila = 'PENDIENTE';
                    comentarioFila = header.justificacion;
                } else {
                    estadoFila = 'EN ESPERA';
                }

                return {
                    requisicion_id: encabezado.id,
                    nivel: n.nivel,
                    usuario_aprobador_id: n.usuario_aprobador_id,
                    estado: estadoFila,
                    comentarios: comentarioFila
                };
            });

            await AprobacionSolicitudCompraModel.bulkCreate(registrosAprobacion, { transaction: t });

            if (nivelSiguiente) {
                await enviarNotificacionPush(
                    nivelSiguiente.usuario_aprobador_id,
                    "Nueva Solicitud de Compra",
                    `Solicitud ${encabezado.numero_requisicion} esperando tu aprobación.`,
                    encabezado.id,
                    encabezado.numero_requisicion
                );
            }
        }

        await t.commit();
        return res.json({ message: 'Solicitud enviada', id: encabezado.id });

    } catch (err) {
        if (t) await t.rollback();
        return res.status(500).json({ error: err.message });
    }
}

async function getSolicitudCompraAF(req, res) {
    try {
        const solicitudes = await SolicitudCompraModel.findAll({
            where: {
                estado: {
                    [Op.in]: ['APROBADO']
                }
            },
            include: [
                {
                    model: LineaSolicitudCompraModel,
                    as: 'items',
                    required: true
                }
            ],
            order: [
                ['fecha_creacion', 'DESC'],
                [{ model: LineaSolicitudCompraModel, as: 'items' }, 'numero_linea', 'ASC']
            ]
        });

        const userIds = [...new Set(solicitudes.map(s => s.solicitado_por))];

        const usuarios = await UsersModel.findAll({
            where: {
                id_users: userIds
            },
            attributes: ['id_users', 'first_name', 'first_last_name']
        });

        const usuariosMap = {};

        usuarios.forEach(u => {
            usuariosMap[u.id_users] = u;
        });

        const resultado = solicitudes.map(s => {
            const usuario = usuariosMap[s.solicitado_por];

            return {
                ...s.toJSON(),
                solicitado_por_id: s.solicitado_por,
                solicitado_por: usuario
                    ? `${usuario.first_name} ${usuario.first_last_name}`
                    : null,
                usuario: usuario
                    ? {
                        id: usuario.id_users,
                        nombre: `${usuario.first_name} ${usuario.first_last_name}`
                    }
                    : null
            };
        });

        if (solicitudes.length === 0) {
            return res.status(404).json({ error: 'No se encuentran solicitudes aprobadas' });
        }

        return res.json(resultado);

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

async function getArticulosBySolicitud(req, res) {
    const { id_solicitud } = req.params;

    try {
        const articulos = await LineaSolicitudCompraModel.findAll({
            where: {
                requisicion_id: id_solicitud
            }
        });

        if(!articulos) {
            return res.status(404).json({ error: 'No se encontraron artículos de la solicitud' });
        }

        return res.json(articulos);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

async function updateArticulosCodes(req, res) {
    const { items } = req.body;
    const t = await sequelize.transaction();

    try {
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Se requiere un arreglo de ítems para actualizar' });
        }

        const firstItem = await LineaSolicitudCompraModel.findByPk(items[0].id);
        if (!firstItem) throw new Error("No se encontró la línea de solicitud");
        const requisicionId = firstItem.requisicion_id;

        for (const item of items) {
            await LineaSolicitudCompraModel.update(
                {
                    codigo_articulo: item.codigo_articulo,
                    nombre_articulo: item.nombre_articulo,
                    descripcion: item.nombre_articulo
                },
                { where: { id: item.id }, transaction: t }
            );
        }

        const solicitudParaSAP = await SolicitudCompraModel.findByPk(requisicionId, {
            include: [{ model: LineaSolicitudCompraModel, as: 'items' }],
            transaction: t
        });

        let sapResponse;

        try {
            sapResponse = await sap.sendSolicitudCompra(solicitudParaSAP);
        } catch (sapError) {
            throw new Error(`SAP rechaza solicitud: ${sapError.message}`);
        }

        await SolicitudCompraModel.update(
            {
                DocEntry: sapResponse.DocEntry,
                DocNum: sapResponse.DocNum
            },
            { where: { id: requisicionId }, transaction: t }
        );

        await t.commit();
        return res.json({ 
            message: 'Códigos actualizados y enviado a SAP correctamente',
            DocNum: sapResponse.DocNum,
            DocEntry: sapResponse.DocEntry,
            numero_requisicion: solicitudParaSAP.numero_requisicion
        });

    } catch (err) {
        if (t) await t.rollback();
        return res.status(500).json({ error: err.message });
    }
}

async function getSolicitudesCompraByUser(req, res) {
    const {
        inicio,
        fin,
        estado,
        page = 1,
        limit = 20
    } = req.query;

    const inicioValido = inicio && inicio !== 'null';
    const finValido = fin && fin !== 'null';

    try {

        const where = {
            solicitado_por: req.user.id_usuario
        };

        if (estado && estado !== 'all') {
            where.estado = estado;
        }

        if (inicioValido && !finValido) {
            where.fecha_creacion = {
                [Op.between]: [
                    new Date(`${inicio} 00:00:00`),
                    new Date(`${inicio} 23:59:59`)
                ]
            };
        }

        if (inicioValido && finValido) {
            where.fecha_creacion = {
                [Op.between]: [
                    new Date(`${inicio} 00:00:00`),
                    new Date(`${fin} 23:59:59`)
                ]
            };
        }

        const pageNumber = Number(page);
        const pageSize = Number(limit);

        const offset = (pageNumber - 1) * pageSize;

        const total = await SolicitudCompraModel.count({
            where
        });

        const solicitudes = await SolicitudCompraModel.findAll({
            where,
            order: [
                ['fecha_creacion', 'DESC']
            ],
            limit: pageSize,
            offset
        });

        const solicitudIds = solicitudes.map(s => s.id);

        const items = await LineaSolicitudCompraModel.findAll({
            where: {
                requisicion_id: {
                    [Op.in]: solicitudIds
                }
            },
            order: [
                ['numero_linea', 'ASC']
            ]
        });

        const itemsMap = {};

        items.forEach(item => {

            if (!itemsMap[item.requisicion_id]) {
                itemsMap[item.requisicion_id] = [];
            }

            itemsMap[item.requisicion_id].push(item);
        });

        const userIds = [...new Set(solicitudes.map(s => s.solicitado_por))];

        const usuarios = await UsersModel.findAll({
            where: {
                id_users: userIds
            },
            attributes: ['id_users', 'first_name', 'first_last_name']
        });

        const usuariosMap = {};

        usuarios.forEach(u => {
            usuariosMap[u.id_users] = u;
        });

        const resultado = solicitudes.map(s => {

            const usuario = usuariosMap[s.solicitado_por];

            return {
                ...s.toJSON(),

                items: itemsMap[s.id] || [],

                solicitado_por_id: s.solicitado_por,

                solicitado_por: usuario
                    ? `${usuario.first_name} ${usuario.first_last_name}`
                    : null,

                usuario: usuario
                    ? {
                        id: usuario.id_users,
                        nombre: `${usuario.first_name} ${usuario.first_last_name}`
                    }
                    : null
            };
        });

        return res.json({
            data: resultado,
            pagination: {
                total,
                totalPages: Math.ceil(total / pageSize),
                currentPage: pageNumber,
                pageSize,
                hasNextPage: pageNumber < Math.ceil(total / pageSize),
                hasPrevPage: pageNumber > 1
            }
        });

    } catch (err) {

        console.error(
            'Error al obtener solicitudes de compra para el usuario',
            err
        );

        return res.status(500).json({
            error: err.message
        });
    }
}

async function getSolicitudesCompra(req, res) {
    const {
        inicio,
        fin,
        estado,
        page = 1,
        limit = 20
    } = req.query;

    const inicioValido = inicio && inicio !== 'null';
    const finValido = fin && fin !== 'null';

    try {

        const where = {};

        if (estado && estado !== 'all') {
            if (typeof estado === 'string' && estado.includes(',')) {
                where.estado = {
                    [Op.in]: estado.split(',')
                };
            } else {
                where.estado = estado;
            }
        }

        if (inicioValido && !finValido) {
            where.fecha_creacion = {
                [Op.between]: [
                    new Date(`${inicio} 00:00:00`),
                    new Date(`${inicio} 23:59:59`)
                ]
            };
        }

        if (inicioValido && finValido) {
            where.fecha_creacion = {
                [Op.between]: [
                    new Date(`${inicio} 00:00:00`),
                    new Date(`${fin} 23:59:59`)
                ]
            };
        }

        const pageNumber = Number(page);
        const pageSize = Number(limit);

        const offset = (pageNumber - 1) * pageSize;

        const total = await SolicitudCompraModel.count({
            where
        });

        const solicitudes = await SolicitudCompraModel.findAll({
            where,
            order: [
                ['fecha_creacion', 'DESC']
            ],
            limit: pageSize,
            offset
        });

        const solicitudIds = solicitudes.map(s => s.id);

        const items = await LineaSolicitudCompraModel.findAll({
            where: {
                requisicion_id: {
                    [Op.in]: solicitudIds
                }
            },
            order: [
                ['numero_linea', 'ASC']
            ]
        });

        const itemsMap = {};

        items.forEach(item => {

            if (!itemsMap[item.requisicion_id]) {
                itemsMap[item.requisicion_id] = [];
            }

            itemsMap[item.requisicion_id].push(item);
        });

        const userIds = [...new Set(solicitudes.map(s => s.solicitado_por))];

        const usuarios = await UsersModel.findAll({
            where: {
                id_users: userIds
            },
            attributes: ['id_users', 'first_name', 'first_last_name']
        });

        const usuariosMap = {};

        usuarios.forEach(u => {
            usuariosMap[u.id_users] = u;
        });

        const resultado = solicitudes.map(s => {

            const usuario = usuariosMap[s.solicitado_por];

            return {
                ...s.toJSON(),

                items: itemsMap[s.id] || [],

                solicitado_por_id: s.solicitado_por,

                solicitado_por: usuario
                    ? `${usuario.first_name} ${usuario.first_last_name}`
                    : null,

                usuario: usuario
                    ? {
                        id: usuario.id_users,
                        nombre: `${usuario.first_name} ${usuario.first_last_name}`
                    }
                    : null
            };
        });

        return res.json({
            data: resultado,
            pagination: {
                total,
                totalPages: Math.ceil(total / pageSize),
                currentPage: pageNumber,
                pageSize,
                hasNextPage: pageNumber < Math.ceil(total / pageSize),
                hasPrevPage: pageNumber > 1
            }
        });

    } catch (err) {

        console.error(
            'Error al obtener solicitudes de compra para el usuario',
            err
        );

        return res.status(500).json({
            error: err.message
        });
    }
}

async function getAprobacionSolicitud(req, res) {
    const { id_solicitud } = req.params;

    try {
        // 1. Obtener aprobaciones (CORE DB)
        const aprobaciones = await AprobacionSolicitudCompraModel.findAll({
            where: {
                requisicion_id: id_solicitud
            },
            order: [["nivel", "ASC"]]
        });

        if (!aprobaciones || aprobaciones.length === 0) {
            return res.json([]);
        }

        // 2. Extraer IDs de usuarios
        const userIds = aprobaciones
            .map(a => a.usuario_aprobador_id)
            .filter(id => id !== null && id !== undefined);

        // 3. Obtener usuarios (PIOAPP DB)
        const users = await UsersModel.findAll({
            where: {
                id_users: {
                    [Op.in]: userIds
                }
            }
        });

        // 4. Mapear usuarios por ID (para lookup rápido)
        const userMap = new Map();
        users.forEach(u => {
            userMap.set(u.id_users, u);
        });

        // 5. Merge manual
        const response = aprobaciones.map(a => {
            const u = userMap.get(a.usuario_aprobador_id);

            const nombreCompleto = u
                ? `${u.first_name || ''} ${u.second_name || ''} ${u.first_last_name || ''} ${u.second_last_name || ''}`.trim()
                : null;

            return {
                id: a.id,
                requisicion_id: a.requisicion_id,
                nivel: a.nivel,
                estado: a.estado,
                comentarios: a.comentarios,
                fecha_aprobacion: a.fecha_aprobacion,

                aprobador: nombreCompleto,
                puesto: u?.puesto_trabajo || null
            };
        });

        return res.json(response);

    } catch (err) {
        console.error("Error al obtener aprobaciones de solicitud de compra", err);
        return res.status(500).json({ error: err.message });
    }
}

module.exports = {
    createSolicitudCompra,
    getSolicitudCompraAF,
    getArticulosBySolicitud,
    updateArticulosCodes,
    getSolicitudesCompraByUser,
    getSolicitudesCompra,
    getAprobacionSolicitud
}