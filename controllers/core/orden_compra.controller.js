const OrdenCompraModel = require('../../models/core/tbl_orden_compra.model');
const SolicitudCompraModel = require('../../models/core/tbl_solicitud_compra.model');
const LineaSolicitudCompraModel = require('../../models/core/tbl_linea_solicitud_compra.model');
const LineaOrdenCompraModel = require('../../models/core/tbl_linea_orden_compra.model');
const LineaOrdenProveedorModel = require('../../models/core/tbl_linea_orden_proveedor.model')
const EmpresaModel = require('../../models/core/tbl_empresa.model');
const UsersModel = require('../../models/pioapp/users.model');
const AprobacionOrdenCompraModel = require('../../models/core/tbl_aprobacion_orden_compra.model');
const NivelMatrizAprobacionOrdenModel = require('../../models/core/tbl_nivel_matriz_aprobacion_orden_compra.model');
const EstrategiaAdquisicionModel = require('../../models/core/tbl_estrategia_adquisicion.model');
const MatrizAprobacionOrdenModel = require('../../models/core/tbl_matriz_aprobacion_orden_compra.model');
const { sequelize } = require('../../configuration/db');
const { buildOrdenCompraS3Key, uploadBufferToS3, buildImagenProveedorS3Key } = require('../../integrations/aws/s3');
const { Op } = require('sequelize');
const { enviarNotificacionPush } = require('../../controllers/core/solicitud_compra.controller');
const path = require('path');

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

OrdenCompraModel.hasMany(LineaOrdenCompraModel, {
    foreignKey: 'orden_id',
    as: 'lineas'
});

LineaOrdenCompraModel.belongsTo(OrdenCompraModel, {
    foreignKey: 'orden_id',
    as: 'orden'
});

LineaOrdenCompraModel.hasMany(LineaOrdenProveedorModel, {
    foreignKey: 'linea_orden_id',
    as: 'proveedores'
});

LineaOrdenProveedorModel.belongsTo(LineaOrdenCompraModel, {
    foreignKey: 'linea_orden_id',
    as: 'lineaOrden'
});

async function createOrdenCompra(req, res) {
    const t = await sequelize.transaction();

    // Creamos un arreglo temporal para guardar las operaciones de S3 que haremos SOLO si el commit es exitoso
    const pendientesS3 = [];

    try {
        const header = JSON.parse(req.body.header);
        const items = JSON.parse(req.body.items); 
        const { solicitud_id, notas, moneda = 'GTQ' } = header;

        console.log('Archivos recibidos:', req.files?.map(f => ({
          fieldname: f.fieldname,
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size
        })));

        console.log('Items recibidos:', JSON.stringify(items.map(i => ({
  linea_solicitud_id: i.linea_solicitud_id,
  proveedores: i.proveedores?.map(p => p.proveedor_id)
})), null, 2));

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

        let monto_total = 0;
        const itemsProcesados = items.map(item => {
            const proveedores = item.proveedores || [];
            let seleccionado = proveedores.find(p => p.es_seleccionado === true || p.es_seleccionado === 'true');
            
            if (!seleccionado && proveedores.length > 0) {
                seleccionado = proveedores[0];
                seleccionado.es_seleccionado = true;
            }

            const precioUnitarioSeleccionado = seleccionado ? Number(seleccionado.precio_unitario) : 0;
            const cantidad = Number(item.cantidad) || 0;
            const totalLinea = cantidad * precioUnitarioSeleccionado;

            monto_total += totalLinea;

            return {
                ...item,
                precio_unitario: precioUnitarioSeleccionado,
                total_linea: totalLinea,
                proveedorSeleccionado: seleccionado
            };
        });

        // --- PRE-PREPARAR ARCHIVO DE COTIZACIÓN PRINCIPAL ---
        let cotizacion_s3_key = null;
        let cotizacion_nombre = null;
        let cotizacion_url = null;

        const cotizacionFile = req.files?.find(f => f.fieldname === 'cotizacionFile');

        if (cotizacionFile) {
            const ext = cotizacionFile.originalname.split('.').pop().toLowerCase();
            if (!['xlsx', 'xls'].includes(ext)) {
                await t.rollback();
                return res.status(400).json({ error: 'Solo se permiten archivos Excel (.xlsx o .xls)' });
            }

            cotizacion_s3_key = buildOrdenCompraS3Key({
                ordenId: solicitud_id, 
                originalName: cotizacionFile.originalname,
                mimeType: cotizacionFile.mimetype
            });

            cotizacion_url = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_BUCKET_REGION}.amazonaws.com/${cotizacion_s3_key}`;
            cotizacion_nombre = cotizacionFile.originalname;

            // En lugar de subirlo ya, guardamos las instrucciones en nuestra lista de pendientes
            pendientesS3.push({
                bucket: process.env.AWS_BUCKET_NAME,
                key: cotizacion_s3_key,
                buffer: cotizacionFile.buffer,
                contentType: getXlsxContentType(cotizacionFile.originalname),
                originalName: cotizacionFile.originalname
            });
        }

        const estrategia = await EstrategiaAdquisicionModel.findByPk(solicitud.estrategia_adquisicion_id, { transaction: t });
        if (!estrategia) throw new Error('No se encontró la estrategia de adquisición asociada a la solicitud');

        const matriz = await MatrizAprobacionOrdenModel.findOne({
            where: {
                estrategia_adquisicion_id: estrategia.id,
                monto_minimo: { [Op.lte]: monto_total },
                monto_maximo: { [Op.gte]: monto_total },
                moneda,
                esta_activo: true
            },
            transaction: t
        });

        if (!matriz) {
            throw new Error(`No existe una matriz de aprobación activa para el monto ${monto_total} ${moneda}`);
        }

        const primerProvSeleccionado = itemsProcesados[0]?.proveedorSeleccionado;

        // 1. Crear Orden de Compra (Cabecera)
        const orden = await OrdenCompraModel.create({
            numero_orden: '',
            solicitud_id,
            proveedor_id: primerProvSeleccionado ? primerProvSeleccionado.proveedor_id : '',
            proveedor: primerProvSeleccionado ? primerProvSeleccionado.nombre_proveedor : '',
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

        // 2. Iterar e Insertar las Líneas de la Orden
        const lineasDeProveedoresABulkear = [];

        for (let index = 0; index < itemsProcesados.length; index++) {
            const item = itemsProcesados[index];
            console.log(item)
            const nuevaLinea = await LineaOrdenCompraModel.create({
                orden_id: orden.id,
                linea_solicitud_id: item.linea_solicitud_id,
                numero_linea: index + 1,
                codigo_articulo: item.codigo_articulo,
                nombre_articulo: item.nombre_articulo,
                descripcion: item.descripcion,
                cantidad: item.cantidad,
                precio_unitario: item.precio_unitario, 
                total_linea: item.total_linea,        
                centro_costo: item.centro_costo,
                cuenta_contable: item.cuenta_contable,
                fecha_creacion: new Date()
            }, { transaction: t });

            if (item.proveedores && Array.isArray(item.proveedores)) {
                for (const prov of item.proveedores) {
                    let imagen_s3_key = prov.imagen_s3_key || null;
                    let imagen_url = prov.imagen_url || null;
                    let imagen_nombre = prov.imagen_nombre || null;

                    const provFile = req.files?.find(f => f.fieldname === `img_prov_${index}_${prov.proveedor_id}`);
                    
                    if (provFile) {
                        imagen_s3_key = buildImagenProveedorS3Key({
                            ordenId: orden.id,
                            originalName: provFile.originalname,
                            mimeType: provFile.mimetype
                        });

                        imagen_url = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_BUCKET_REGION}.amazonaws.com/${imagen_s3_key}`;
                        imagen_nombre = provFile.originalname;

                        // En lugar de subirlo ya, guardamos las instrucciones en nuestra lista de pendientes
                        pendientesS3.push({
                            bucket: process.env.AWS_BUCKET_NAME,
                            key: imagen_s3_key,
                            buffer: provFile.buffer,
                            contentType: provFile.mimetype,
                            originalName: provFile.originalname
                        });
                    }

                    lineasDeProveedoresABulkear.push({
                        linea_orden_id: nuevaLinea.id, 
                        proveedor_id: prov.proveedor_id,
                        nombre_proveedor: prov.nombre_proveedor,
                        precio_unitario: Number(prov.precio_unitario) || 0,
                        imagen_s3_key,
                        imagen_nombre,
                        imagen_url,
                        descripcion: prov.descripcion || null,
                        es_seleccionado: prov.es_seleccionado === true || prov.es_seleccionado === 'true',
                        fecha_creacion: new Date()
                    });
                }
            }
        }

        if (lineasDeProveedoresABulkear.length > 0) {
            await LineaOrdenProveedorModel.bulkCreate(lineasDeProveedoresABulkear, { transaction: t });
        }

        const niveles = await NivelMatrizAprobacionOrdenModel.findAll({
            where: { matriz_id: matriz.id },
            order: [['nivel', 'ASC']]
        });

        if (!niveles.length) {
            throw new Error(`La matriz ${matriz.nombre} no tiene niveles configurados`);
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

        await solicitud.update({ estado: 'PROCESO_ORDEN' }, { transaction: t });

        // --- 3. SI TODO SALIÓ BIEN HASTA AQUÍ, HACEMOS COMMIT ---
        await t.commit();

        // --- 4. AHORA SÍ SUBIMOS A S3 (La base de datos ya está segura) ---
        if (pendientesS3.length > 0) {
            console.log(`[S3] Procesando ${pendientesS3.length} archivos pendientes de subir tras commit exitoso.`);
            // Usamos Promise.all para subirlos en paralelo de manera eficiente
            await Promise.all(pendientesS3.map(archivo => uploadBufferToS3(archivo)));
        }

        // Envío de notificaciones Push (Asíncrono)
        try {
            const primerNivel = niveles[0]; 
            const idPrimerAprobador = primerNivel.usuario_aprobador_id;
            await enviarNotificacionPush(
                idPrimerAprobador,
                'Nueva Orden de Compra Pendiente',
                `Tienes una nueva orden de compra por aprobar para la requisición N° ${solicitud.numero_requisicion || ''}`,
                solicitud_id,
                solicitud.numero_requisicion
            );
        } catch (errorPush) {
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
                cotizacion_url
            }
        });

    } catch (err) {
        // Si ocurre cualquier error de validación o base de datos ANTES del commit, se ejecuta esto:
        if (t && !t.finished) await t.rollback();
        console.error('Error al crear orden de compra:', err.stack);
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

        if(total === 0) {
            return res.status(404).json({ error: 'No se encontraron órdenes de compra con los parámetros seleccionados' })
        }

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

async function getOrdenCompraDetalle(req, res) {
    const { id_orden } = req.params;

    try {
        const orden = await OrdenCompraModel.findByPk(id_orden, {
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
                },
                {
                    model: LineaOrdenCompraModel,
                    as: 'lineas',
                    include: [
                        {
                            model: LineaOrdenProveedorModel,
                            as: 'proveedores'
                        }
                    ]
                }
            ],
            order: [
                [{ model: LineaOrdenCompraModel, as: 'lineas' }, 'numero_linea', 'ASC']
            ]
        });

        if (!orden) {
            return res.status(404).json({ error: 'No se encontró la orden de compra' });
        }

        const usuario = await UsersModel.findByPk(orden.solicitado_por, {
            attributes: ['id_users', 'first_name', 'first_last_name']
        });

        const ordenJson = orden.toJSON();

        const response = {
            ...ordenJson,
            solicitado_por_id: ordenJson.solicitado_por,
            solicitado_por: usuario
                ? `${usuario.first_name} ${usuario.first_last_name}`
                : null,
            empresa: ordenJson.empresa
                ? { id: ordenJson.empresa.id, nombre: ordenJson.empresa.nombre }
                : null,
            solicitud: ordenJson.solicitud
                ? { id: ordenJson.solicitud.id, numero_requisicion: ordenJson.solicitud.numero_requisicion }
                : null,
            items: (ordenJson.lineas || []).map(linea => ({
                ...linea,
                proveedores: (linea.proveedores || []).sort(
                    (a, b) => (b.es_seleccionado === true) - (a.es_seleccionado === true)
                )
            }))
        };

        delete response.lineas;

        return res.json(response);

    } catch (err) {
        console.error('Error al obtener el detalle de la orden de compra', err);
        return res.status(500).json({ error: err.message });
    }
}

function getXlsxContentType(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.xls') return 'application/vnd.ms-excel';
  return 'application/octet-stream';
}

module.exports = {
    createOrdenCompra,
    getOrdenesCompraByUser,
    getOrdenesCompra,
    getAprobacionOrden,
    getOrdenCompraDetalle
};