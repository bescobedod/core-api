const OrdenCompraModel = require('../../models/core/tbl_orden_compra.model');
const SolicitudCompraModel = require('../../models/core/tbl_solicitud_compra.model');
const LineaSolicitudCompraModel = require('../../models/core/tbl_linea_solicitud_compra.model');
const LineaOrdenCompraModel = require('../../models/core/tbl_linea_orden_compra.model');
const EmpresaModel = require('../../models/core/tbl_empresa.model');
const UsersModel = require('../../models/pioapp/users.model');
const NivelOrdenCompraModel = require('../../models/core/tbl_nivel_matriz_aprobacion_orden_compra.model');
const AprobacionOrdenCompraModel = require('../../models/core/tbl_aprobacion_orden_compra.model');
const NivelMatrizAprobacionOrdenModel = require('../../models/core/tbl_nivel_matriz_aprobacion_orden_compra.model');
const EstrategiaAdquisicionModel = require('../../models/core/tbl_estrategia_adquisicion.model');
const MatrizAprobacionOrdenModel = require('../../models/core/tbl_matriz_aprobacion_orden_compra.model');
const { sequelize } = require('../../configuration/db');
const { buildOrdenCompraS3Key, uploadBufferToS3 } = require('../../integrations/aws/s3');
const { Op } = require('sequelize');
const { enviarNotificacionPush } = require('../../controllers/core/solicitud_compra.controller');

const S3_BUCKET = process.env.AWS_BUCKET_NAME;
const REGION = process.env.AWS_BUCKET_REGION;

OrdenCompraModel.belongsTo(EmpresaModel, {
    foreignKey: 'id_empresa',
    as: 'empresa'
});

EmpresaModel.hasMany(OrdenCompraModel, {
    foreignKey: 'id_empresa',
    as: 'ordenes'
});

OrdenCompraModel.belongsTo(SolicitudCompraModel, {
    foreignKey: 'solicitud_id',
    as: 'solicitud'
});

SolicitudCompraModel.hasMany(OrdenCompraModel, {
    foreignKey: 'solicitud_id',
    as: 'ordenes_compra'
});

async function createOrdenCompra(req, res) {
    const t = await sequelize.transaction();

    try {
        const header = JSON.parse(req.body.header);
        const items = JSON.parse(req.body.items);
        const { solicitud_id, notas, moneda = 'GTQ' } = header;

        if (!solicitud_id) {
            await t.rollback();
            return res.status(400).json({ error: 'El campo solicitud_id es requerido' });
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            await t.rollback();
            return res.status(400).json({ error: 'Se requiere al menos un ítem para crear la orden' });
        }

        const solicitud = await SolicitudCompraModel.findByPk(solicitud_id, {
            include: [
                { model: LineaSolicitudCompraModel, as: 'items' },
                { model: EmpresaModel, as: 'empresa' }
            ]
        });

        if (!solicitud) {
            await t.rollback();
            return res.status(404).json({ error: 'No se encontró la solicitud de compra' });
        }

        if (solicitud.estado !== 'APROBADO_COMPRAS') {
            await t.rollback();
            return res.status(400).json({
                error: `La solicitud debe estar aprobada por compras para iniciar una orden.`
            });
        }

        const idsLineasSolicitud = new Set(solicitud.items.map(i => i.id));
        const lineaInvalida = items.find(i => !idsLineasSolicitud.has(i.linea_solicitud_id));

        if (lineaInvalida) {
            await t.rollback();
            return res.status(400).json({
                error: `La línea ${lineaInvalida.linea_solicitud_id} no pertenece a la solicitud ${solicitud_id}`
            });
        }

        const monto_total = items.reduce((acc, item) => {
            const cantidad = Number(item.cantidad)       || 0;
            const precio_unitario = Number(item.precio_unitario) || 0;
            return acc + cantidad * precio_unitario;
        }, 0);

        let cotizacion_s3_key = null;
        let cotizacion_nombre = null;
        let cotizacion_url = null;

        const cotizacionFile = req.file;

        if (cotizacionFile) {
            const ext = cotizacionFile.originalname.split('.').pop().toLowerCase();

            if (!['xlsx', 'xls'].includes(ext)) {
                await t.rollback();
                return res.status(400).json({ error: 'Solo se permiten archivos Excel (.xlsx o .xls)' });
            }

            cotizacion_s3_key = buildOrdenCompraS3Key({
                id_solicitud: solicitud_id,
                originalName: cotizacionFile.originalname,
                mimeType: cotizacionFile.mimetype
            });

            await uploadBufferToS3({
                bucket: S3_BUCKET,
                key: cotizacion_s3_key,
                buffer: cotizacionFile.buffer,
                contentType: cotizacionFile.mimetype
            });

            cotizacion_url = `https://${S3_BUCKET}.s3.${REGION}.amazonaws.com/${cotizacion_s3_key}`;
            cotizacion_nombre = cotizacionFile.originalname;
        }

        const estrategia = await EstrategiaAdquisicionModel.findByPk(
            solicitud.estrategia_adquisicion_id,
            {
                transaction: t
            }
        );

        if (!estrategia) {
            throw new Error('No se encontró la estrategia de adquisición asociada a la solicitud');
        }

        const matriz = await MatrizAprobacionOrdenModel.findOne({
            where: {
                estrategia_adquisicion_id: estrategia.id,
                monto_minimo: { [Op.lte]: monto_total },
                monto_maximo: { [Op.gte]: monto_total },
                moneda,
                esta_activo: true
            }
        });

        if (!matriz) {
            throw new Error(
                `No existe una matriz de aprobación activa para el monto ${monto_total} ${moneda}`
            );
        }

        const orden = await OrdenCompraModel.create({
            numero_orden: '',
            solicitud_id,
            proveedor_id: items[0].proveedor_id,
            proveedor: items[0].proveedor,
            fecha_orden: new Date(),
            estado: 'PENDIENTE',
            monto_total: parseFloat(monto_total.toFixed(2)),
            moneda,
            notas: notas || null,
            id_empresa: solicitud.id_empresa,
            codigo_departamento: solicitud.codigo_departamento,
            cotizacion_s3_key,
            cotizacion_nombre,
            cotizacion_url,
            solicitado_por: solicitud.solicitado_por,
            departamento_id: solicitud.departamento_id,
            estrategia_adquisicion_id: solicitud.estrategia_adquisicion_id,
            matriz_id: matriz.id,
            fecha_requerida: solicitud.fecha_requerida
        }, { transaction: t });

        await LineaOrdenCompraModel.bulkCreate(
            items.map((item, index) => ({
                orden_id: orden.id,
                linea_solicitud_id: item.linea_solicitud_id,
                numero_linea: index + 1,
                codigo_articulo: item.codigo_articulo,
                nombre_articulo: item.nombre_articulo,
                descripcion: item.nombre_articulo,
                cantidad: item.cantidad,
                precio_unitario: item.precio_unitario,
                total_linea: Number(item.cantidad) * Number(item.precio_unitario),
                centro_costo: item.centro_costo,
                cuenta_contable: item.cuenta_contable
            })),
            { transaction: t }
        );

        const niveles = await NivelMatrizAprobacionOrdenModel.findAll({
            where: { matriz_id: matriz.id },
            order: [['nivel', 'ASC']]
        });

        if (!niveles.length) {
            throw new Error(
                `La matriz ${matriz.nombre} no tiene niveles configurados`
            );
        }

        await AprobacionOrdenCompraModel.bulkCreate(
            niveles.map((nivel, index) => ({
                orden_compra_id: orden.id,
                nivel: nivel.nivel,
                usuario_aprobador_id: nivel.usuario_aprobador_id,
                estado: index === 0 ? 'PENDIENTE' : 'ESPERA',
                comentarios: null
            })),
            { transaction: t }
        );

        const usuario = await UsersModel.findByPk(solicitud.solicitado_por, {
            attributes: ['id_users', 'first_name', 'first_last_name'],
        });

        await solicitud.update(
            {
                estado: 'PROCESO_ORDEN'
            },
            {
                transaction: t
            }
        );

        await t.commit();

        try {
            // Como 'niveles' viene ordenado por ['nivel', 'ASC'], el índice 0 es el más bajo.
            const primerNivel = niveles[0]; 
            const idPrimerAprobador = primerNivel.usuario_aprobador_id;

            const tituloNotificacion = 'Nueva Orden de Compra Pendiente';
            const mensajeNotificacion = `Tienes una nueva orden de compra por aprobar para la requisición N° ${solicitud.numero_requisicion || ''}`;

            // Llamamos a tu función pasando los datos requeridos
            await enviarNotificacionPush(
                idPrimerAprobador,
                tituloNotificacion,
                mensajeNotificacion,
                solicitud_id, // id_solicitud
                solicitud.numero_requisicion // numero_requisicion
            );

            console.log(`Notificación Push enviada con éxito al aprobador ID: ${idPrimerAprobador}`);
        } catch (errorPush) {
            // Un error en la notificación externa no debe tumbar la respuesta HTTP exitosa
            console.error('Error al procesar el envío de la notificación push:', errorPush.message);
        }

        return res.status(201).json({
            message: 'Orden de compra creada correctamente',
            orden: {
                id: orden.id,
                numero_orden: orden.numero_orden,
                estado: orden.estado,
                monto_total: orden.monto_total,
                moneda: orden.moneda,
                fecha_orden: orden.fecha_orden,
                cotizacion_url,
                cotizacion_nombre,
                solicitud: {
                    id: solicitud.id,
                    numero_requisicion: solicitud.numero_requisicion,
                    justificacion: solicitud.justificacion,
                    solicitado_por: usuario
                        ? `${usuario.first_name} ${usuario.first_last_name}`
                        : null,
                    empresa: solicitud.empresa
                        ? { id: solicitud.empresa.id, nombre: solicitud.empresa.nombre }
                        : null
                }
            }
        });

    } catch (err) {
        if (t) await t.rollback();
        console.error('Error al crear orden de compra:', err);
        return res.status(500).json({ error: err.message });
    }
}

async function getOrdenesCompraByUser(req, res) {
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

        const total = await OrdenCompraModel.count({
            where
        });

        const ordenes = await OrdenCompraModel.findAll({
            where,
            include: [
                {
                    model: LineaOrdenCompraModel,
                    as: 'items',
                    required: true
                },
                {
                    model: EmpresaModel,
                    as: 'empresa',
                    attributes: ['id', 'nombre']
                },
                {
                    model: SolicitudCompraModel,
                    as: 'solicitud',
                    attributes: ['id', 'numero_requisicion']
                }
            ],
            order: [
                ['fecha_creacion', 'DESC']
            ],
            limit: pageSize,
            offset
        });

        const ordenIds = ordenes.map(o => o.id);

        const items = await LineaOrdenCompraModel.findAll({
            where: {
                orden_id: {
                    [Op.in]: ordenIds
                }
            },
            order: [
                ['numero_linea', 'ASC']
            ]
        });

        const itemsMap = {};

        items.forEach(item => {

            if (!itemsMap[item.orden_id]) {
                itemsMap[item.orden_id] = [];
            }

            itemsMap[item.orden_id].push(item);
        });

        const userIds = [...new Set(ordenes.map(o => o.solicitado_por))];

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

        const resultado = ordenes.map(o => {
            const usuario = usuariosMap[o.solicitado_por];

            return {
                ...o.toJSON(),
                items: itemsMap[o.id] || [],
                solicitado_por_id: o.solicitado_por,
                solicitado_por: usuario
                ? `${usuario.first_name} ${usuario.first_last_name}`
                : null,
                usuario: usuario
                ? {
                    id: usuario.id_users,
                    nombre: `${usuario.first_name} ${usuario.first_last_name}`
                }
                : null,
                empresa: o.empresa
                ? {
                    id: o.empresa.id,
                    nombre: o.empresa.nombre
                }
                : null,
                solicitud: o.solicitud
                ? {
                    id: o.solicitud.id,
                    numero_requisicion: o.solicitud.numero_requisicion
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

async function getOrdenesCompra(req, res) {
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

        const total = await OrdenCompraModel.count({
            where
        });

        const ordenes = await OrdenCompraModel.findAll({
            where,
            include: [
                {
                    model: EmpresaModel,
                    as: 'empresa',
                    attributes: ['id', 'nombre']
                },
                {
                    model: SolicitudCompraModel,
                    as: 'solicitud',
                    attributes: ['id', 'numero_requisicion']
                }
            ],
            order: [
                ['fecha_creacion', 'DESC']
            ],
            limit: pageSize,
            offset
        });

        const ordenIds = ordenes.map(o => o.id);

        const items = await LineaOrdenCompraModel.findAll({
            where: {
                orden_id: {
                    [Op.in]: ordenIds
                }
            },
            order: [
                ['numero_linea', 'ASC']
            ]
        });

        const itemsMap = {};

        items.forEach(item => {
            if (!itemsMap[item.orden_id]) {
                itemsMap[item.orden_id] = [];
            }

            itemsMap[item.orden_id].push(item);
        });

        const userIds = [...new Set(ordenes.map(o => o.solicitado_por))];

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

        const resultado = ordenes.map(o => {
            const usuario = usuariosMap[o.solicitado_por];

            return {
                ...o.toJSON(),
                items: itemsMap[o.id] || [],
                solicitado_por_id: o.solicitado_por,
                solicitado_por: usuario
                    ? `${usuario.first_name} ${usuario.first_last_name}`
                    : null,
                usuario: usuario
                    ? {
                        id: usuario.id_users,
                        nombre: `${usuario.first_name} ${usuario.first_last_name}`
                    }
                    : null,
                empresa: o.empresa
                    ? {
                        id: o.empresa.id,
                        nombre: o.empresa.nombre
                    }
                    : null,
                solicitud: o.solicitud
                    ? {
                        id: o.solicitud.id,
                        numero_requisicion: o.solicitud.numero_requisicion
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
        console.error('Error al obtener solicitudes de compra para el usuario', err);

        return res.status(500).json({
            error: err.message
        });
    }
}

async function getAprobacionOrden(req, res) {
    const { id_orden } = req.params;

    try {
        // 1. Obtener aprobaciones (CORE DB)
        const aprobaciones = await AprobacionOrdenCompraModel.findAll({
            where: {
                orden_compra_id: id_orden
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
                orden_compra_id: a.orden_compra_id,
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
        console.error("Error al obtener aprobaciones de orden de compra", err);
        return res.status(500).json({ error: err.message });
    }
}

module.exports = {
    createOrdenCompra,
    getOrdenesCompraByUser,
    getOrdenesCompra,
    getAprobacionOrden
};