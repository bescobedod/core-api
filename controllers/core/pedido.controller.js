const initPedidoEncabezadoModel = require('../../models/core/tbl_pedido_encabezado.model');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { MIME_XLSX, construirExcelDetalle, construirExcelEnTransito } = require('../../services/pedidoReportesExcel');
const TicketTrasladoModel = require('../../models/core/tbl_tickets_traslado.model');
const initPedidoDetalleModel = require('../../models/core/tbl_pedido_detalle.model');
const initTiendaModel = require('../../models/pdv/tTienda.model');
const UsersModel = require('../../models/pioapp/users.model');
const { obtenerProductosData, consultarStockPollo, consultarStockInsumos, crearTransferenciaPollo, crearTransferenciaInsumos, WHS_INSUMOS } = require('../../integrations/sap/sapClient');
const CatalogoRutaPolloModel = require('../../models/core/tbl_catalogo_rutas_pollo.model');
const BloqueoRutaPolloModel = require('../../models/core/tbl_bloqueo_ruta_pollo.model');
const CatalogoRutaInsumosModel = require('../../models/core/tbl_catalogo_rutas_insumos.model');
const BloqueoRutaInsumosModel = require('../../models/core/tbl_bloqueo_ruta_insumos.model');
const sequelizeInit = require('../../configuration/db');
const { Op, fn, col, QueryTypes } = require('sequelize');
const PedidoPosCabeceraModel = require('../../models/core/tbl_pedido_pos_cabecera.model');
const PedidoPosDetalleModel = require('../../models/core/tbl_pedido_pos_detalle.model');
const PedidoPosHistorialModel = require('../../models/core/tbl_pedido_pos_historial.model');
const CatalogoRutaModel = require('../../models/core/tbl_catalogo_ruta.model');
const TiendaRutaModel = require('../../models/core/tbl_tienda_ruta.model');
const TiendaRutaPolloModel = require('../../models/core/tbl_tiendas_rutas_pollo.model');
const TiendaRutaInsumosModel = require('../../models/core/tbl_tiendas_rutas_insumos.model');
const CamionModel = require('../../models/core/tbl_camion.model');
const DespachoRutaModel = require('../../models/core/tbl_despacho_ruta.model');

PedidoPosCabeceraModel.hasMany(PedidoPosDetalleModel, { foreignKey: 'pedido_id', as: 'detalle' });
PedidoPosDetalleModel.belongsTo(PedidoPosCabeceraModel, { foreignKey: 'pedido_id', as: 'cabecera' });
 
PedidoPosCabeceraModel.hasMany(PedidoPosHistorialModel, { foreignKey: 'pedido_id', as: 'historial' });
PedidoPosHistorialModel.belongsTo(PedidoPosCabeceraModel, { foreignKey: 'pedido_id', as: 'cabecera' });
 
CatalogoRutaModel.hasMany(TiendaRutaModel, { foreignKey: 'ruta_id', as: 'tiendas' });
TiendaRutaModel.belongsTo(CatalogoRutaModel, { foreignKey: 'ruta_id', as: 'ruta' });
 
CatalogoRutaPolloModel.hasMany(TiendaRutaPolloModel, { foreignKey: 'ruta_id', as: 'tiendas' });
TiendaRutaPolloModel.belongsTo(CatalogoRutaPolloModel, { foreignKey: 'ruta_id', as: 'ruta' });
 
CatalogoRutaInsumosModel.hasMany(TiendaRutaInsumosModel, { foreignKey: 'ruta_id', as: 'tiendas' });
TiendaRutaInsumosModel.belongsTo(CatalogoRutaInsumosModel, { foreignKey: 'ruta_id', as: 'ruta' });
 
PedidoPosCabeceraModel.belongsTo(CatalogoRutaModel, { foreignKey: 'ruta_id', as: 'ruta' });

// TODO: confirmar el nombre real de la clave de conexión a PDV en configDatabase
// (aquí se asume 'PDV', ajustar si en configDatabase.js tiene otro nombre)
const PDV_CONNECTION = 'PDV';

// Los pedidos de Activo Fijo salen de la misma bodega/base SAP que Insumos
// (warehouse "01"), así que comparten todo el flujo operativo: stock,
// transferencia SAP y ticket de traslado. Se buscan/procesan juntos en
// esas funciones (no así POLLO, que usa una base SAP separada, AVIGUA).
const TIPOS_INSUMOS_Y_ACTIVO_FIJO = ['INSUMOS', 'ACTIVO_FIJO'];

async function getAllPedidosEncabezado(req, res) {
    try {
        const sequelizeCore = await sequelizeInit.sequelizeInit('CORE');
        const PedidoEncabezadoModel = initPedidoEncabezadoModel(sequelizeCore);
        
        const pedidos_encabezado = await PedidoEncabezadoModel.findAll({ raw: true });
        
        return res.json(pedidos_encabezado);
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener pedidos',
            details: error.message
        })
    }
}

async function getPedidoDetalleByEncabezado(req, res) {
    const { id_p } = req.params;

    try {
        const sequelizeCore = await sequelizeInit.sequelizeInit('CORE');
        const PedidoDetalleModel = initPedidoDetalleModel(sequelizeCore);

        const detalle = await PedidoDetalleModel.findAll({
            where: {
                id_pedido: id_p
            }
        })

        return res.json(detalle);
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener detalle del pedido',
            details: error.message
        });
    }
}

async function createPedido(req, res) {
    const { header, items } = req.body;
    const sequelizeCore = await sequelizeInit.sequelizeInit('CORE');
    const t = await sequelizeCore.transaction();

    try {
        const PedidoEncabezadoModel = initPedidoEncabezadoModel(sequelizeCore);
        const PedidoDetalleModel = initPedidoDetalleModel(sequelizeCore);
        const idUsuarioActual = req.user.id_usuario;

        const usuario = await UsersModel.findByPk(idUsuarioActual);

        if (!usuario) {
            return res.status(400).json({
                error: 'El supervisor indicado no existe',
                success: false
            });
        }

        const [encabezado, created] = await PedidoEncabezadoModel.findOrCreate({
            where: {
                id_tienda: header.id_tienda,
                id_tipo: header.id_tipo,
                fecha_requerida: header.fecha_requerida
            },
            defaults: {
                ...header,
                userCeatedAt: idUsuarioActual,
                userUpdatedAt: idUsuarioActual
            },
            transaction: t
        });

        if(!created) {
            await encabezado.update({
                total_productos: header.total_productos,
                userUpdatedAt: idUsuarioActual
            }, { transaction: t });
        }

        const detallesExistentes = await PedidoDetalleModel.findAll({
            where: {
                id_pedido: encabezado.id_pedido
            },
            transaction: t
        });

        const mapaExistentes = new Map(
            detallesExistentes.map(d => [d.codigo_articulo, d])
        );

        for(const item of items) {
            const existente = mapaExistentes.get(item.codigo_articulo);

            if(item.cantidad > 0) {
                await PedidoDetalleModel.upsert({
                    id_pedido: encabezado.id_pedido,
                    codigo_articulo: item.codigo_articulo,
                    nombre_articulo: item.nombre_articulo,
                    cantidad: item.cantidad,
                    unidad_medida: item.unidad_medida,
                    descripcion: item.nombre_articulo
                }, {
                    transaction: t
                })
            } else {
                if(existente) {
                    await existente.destroy({transaction: t})
                }
            }
        }

        await t.commit();
        return res.json({
            message: 'Pedido sincronizado con éxito',
            success: true,
            id_pedido: encabezado.id_pedido
        });
    } catch (error) {
        return res.status(500).json({
            error: error.message,
            details: error.message
        });
    }
}

// ------------------------------------------------------------
// POST: crea manualmente un pedido de Activo Fijo (desde FixedAssetsView),
// insertando directo en cabecera + detalle + historial de
// tbl_pedidos_pos_*, igual que si viniera del middleware de Simphony pero
// sin archivo de por medio. Sale siempre de la bodega "01" (misma base SAP
// que INSUMOS), así que la ruta se resuelve con el mismo maestro de rutas
// de insumos (tbl_tiendas_rutas_insumos, vía id_tienda_pdv).
// ------------------------------------------------------------
async function crearPedidoActivoFijo(req, res) {
    const { id_tienda, codigo_tienda, nombre_tienda, codigo_empresa, fecha_requerida, items } = req.body;

    if (!id_tienda) {
        return res.status(400).json({ error: 'id_tienda es requerido', success: false });
    }

    if (!fecha_requerida) {
        return res.status(400).json({ error: 'fecha_requerida es requerida', success: false });
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Se requiere al menos un artículo', success: false });
    }

    const sequelizeCore = sequelizeInit.sequelize;
    const t = await sequelizeCore.transaction();

    try {
        const asignacionRuta = await TiendaRutaInsumosModel.findOne({
            where: { id_tienda_pdv: id_tienda, fecha_fin_asignacion: null },
            include: [{ model: CatalogoRutaInsumosModel, as: 'ruta' }],
            transaction: t
        });

        const ruta_id = asignacionRuta?.ruta?.id || null;
        const nombre_ruta = asignacionRuta?.ruta?.nombre_ruta || null;

        // El código de tienda que usan los pedidos de Insumos/Pollo (los que
        // vienen del archivo/middleware Simphony) es el StoreNumberSimphony
        // de tTienda, no el código interno de PDV que manda el frontend acá
        // — hay que guardar el mismo valor, si no getPedidosPos no logra
        // fusionar en una sola tarjeta los pedidos de la misma tienda.
        const sequelizePdv = await sequelizeInit.sequelizeInit('PDV');
        const TiendaPdvModel = initTiendaModel(sequelizePdv);
        const tiendaPdv = await TiendaPdvModel.findOne({ where: { idTienda: id_tienda } });
        const codigoTiendaSimphony = tiendaPdv?.StoreNumberSimphony || codigo_tienda || String(id_tienda);

        const [{ nextval }] = await sequelizeCore.query(
            "SELECT nextval('logistica.seq_pedido_activo_fijo') as nextval",
            { type: QueryTypes.SELECT, transaction: t }
        );
        const numero_pedido = `AF-${new Date().getFullYear()}-${String(nextval).padStart(6, '0')}`;

        const ahora = new Date();
        const hoy = ahora.toISOString().split('T')[0];

        const cabecera = await PedidoPosCabeceraModel.create({
            codigo_empresa: codigo_empresa || null,
            codigo_tienda: codigoTiendaSimphony,
            numero_pedido,
            fecha_pedido: hoy,
            fecha_requerida,
            hora_pedido: ahora.toTimeString().split(' ')[0],
            nombre_tienda: nombre_tienda || null,
            codigo_bodega: WHS_INSUMOS,
            tipo_pedido: 'ACTIVO_FIJO',
            ruta_id,
            nombre_ruta,
            estado: 'RECIBIDO',
            fecha_recepcion: ahora,
            creado_en: ahora,
            actualizado_en: ahora
        }, { transaction: t });

        const detalles = items.map((item, index) => ({
            pedido_id: cabecera.id,
            numero_linea: index + 1,
            codigo_producto: item.codigo_articulo,
            descripcion_producto: item.nombre_articulo,
            unidad_medida: item.unidad_medida || 'Unidad',
            fecha_requerida,
            cantidad_solicitada: item.cantidad,
            estado_linea: 'PENDIENTE',
            creado_en: ahora,
            actualizado_en: ahora
        }));

        await PedidoPosDetalleModel.bulkCreate(detalles, { transaction: t });

        await PedidoPosHistorialModel.create({
            pedido_id: cabecera.id,
            estado_anterior: null,
            estado_nuevo: 'RECIBIDO',
            usuario: (req.user && (req.user.nombre || req.user.id_usuario)) || null,
            comentario: 'Pedido de activo fijo creado manualmente desde Core',
            fecha: ahora
        }, { transaction: t });

        await t.commit();

        return res.json({
            success: true,
            id_pedido: cabecera.id,
            numero_pedido,
            estado: 'RECIBIDO'
        });
    } catch (error) {
        await t.rollback();

        return res.status(500).json({
            error: 'Error al crear el pedido de activo fijo',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// GET: lista (paginado) los pedidos de Activo Fijo de una tienda, para la
// pestaña "Buscar Pedidos" de FixedAssetsView. Solo lectura, no toca SAP,
// candados ni transporte. Acepta una fecha única o un rango de
// fecha_requerida; si no se manda ninguna, trae todas las fechas.
// ------------------------------------------------------------
async function buscarPedidosActivoFijo(req, res) {
    const { codigo_tienda, fecha, fecha_inicio, fecha_fin } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = parseInt(req.query.pageSize, 10) || 9;

    if (!codigo_tienda) {
        return res.status(400).json({ error: 'codigo_tienda es requerido', success: false });
    }

    // El selector de tienda del frontend manda el código interno de PDV
    // (vwTiendasModulo.codigo_tienda), pero los pedidos ya se guardan con el
    // StoreNumberSimphony (ver crearPedidoActivoFijo) — hay que traducirlo
    // antes de buscar, si no, no encuentra nada.
    const sequelizePdv = await sequelizeInit.sequelizeInit('PDV');
    const TiendaPdvModel = initTiendaModel(sequelizePdv);
    const tiendaPdv = await TiendaPdvModel.findOne({ where: { tienda: codigo_tienda } });
    const codigoTiendaSimphony = tiendaPdv?.StoreNumberSimphony || codigo_tienda;

    const whereCabecera = { tipo_pedido: 'ACTIVO_FIJO', codigo_tienda: codigoTiendaSimphony };

    if (fecha) {
        whereCabecera.fecha_requerida = fecha;
    } else if (fecha_inicio && fecha_fin) {
        whereCabecera.fecha_requerida = { [Op.between]: [fecha_inicio, fecha_fin] };
    }

    try {
        const { rows, count } = await PedidoPosCabeceraModel.findAndCountAll({
            where: whereCabecera,
            include: [{ model: PedidoPosDetalleModel, as: 'detalle' }],
            order: [['fecha_requerida', 'DESC'], ['creado_en', 'DESC']],
            limit: pageSize,
            offset: (page - 1) * pageSize,
            distinct: true
        });

        const data = rows.map((pedido) => {
            const p = pedido.get({ plain: true });

            return {
                pedido_id: p.id,
                numero_pedido: p.numero_pedido,
                codigo_tienda: p.codigo_tienda,
                nombre_tienda: p.nombre_tienda,
                fecha_pedido: p.fecha_pedido,
                fecha_requerida: p.fecha_requerida,
                estado: p.estado,
                items: p.detalle.map((d) => ({
                    id: d.id,
                    codigo_producto: d.codigo_producto,
                    descripcion_producto: d.descripcion_producto,
                    unidad_medida: d.unidad_medida,
                    cantidad_solicitada: d.cantidad_solicitada,
                    cantidad_asignada: d.cantidad_asignada,
                    estado_linea: d.estado_linea
                }))
            };
        });

        return res.json({
            success: true,
            data,
            pagination: {
                page,
                pageSize,
                total: count,
                totalPages: Math.max(1, Math.ceil(count / pageSize))
            }
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al buscar pedidos de activo fijo',
            details: error.message,
            success: false
        });
    }
}

async function validarYObtenerPedido(req, res) {
    const { fecha_requerida, id_tipo } = req.query;
    let { id_tienda } = req.query;

    try {
        const sequelizeCore = await sequelizeInit.sequelizeInit('CORE');
        const PedidoEncabezadoModel = initPedidoEncabezadoModel(sequelizeCore);
        const PedidoDetalleModel = initPedidoDetalleModel(sequelizeCore);
        PedidoEncabezadoModel.hasMany(PedidoDetalleModel, { foreignKey: 'id_pedido', as: 'detalles' });
        PedidoDetalleModel.belongsTo(PedidoEncabezadoModel, { foreignKey: 'id_pedido' });

        const [catalogoSAP, encabezadoExiste] = await Promise.all([
        obtenerProductosData(id_tienda),

        PedidoEncabezadoModel.findOne({
            where: {
                id_tienda: id_tienda.toString(),
                id_tipo: id_tipo,
                fecha_requerida: {
                    [Op.eq]: fecha_requerida
                }
            },
            include: [{ model: PedidoDetalleModel, as: 'detalles' }]
            })
        ]);

        if(!encabezadoExiste) {
            return res.json({
                nuevoPedido: true,
                id_pedido: null,
                categorias: catalogoSAP
            })
        }

        const encabezadoDoc = encabezadoExiste.get({ plain: true });

        const mapaCantidades = {};
        encabezadoDoc.detalles.forEach(det => {
            if(det.codigo_articulo) {
                mapaCantidades[det.codigo_articulo] = det.cantidad;
            }
        });

        const categoriasValores = catalogoSAP.map(cat => ({
            ...cat,
            products: cat.products.map(prod => {
                const cantidadRegistrada = mapaCantidades[prod.id] || 0;

                return {
                    ...prod,
                    cantidad: cantidadRegistrada,
                    codigo_articulo: prod.id
                }
            })
        }));

        return res.json({
            nuevoPedido: false,
            id_pedido: encabezadoExiste.id_pedido,
            header: encabezadoExiste,
            categorias: categoriasValores
        })
    } catch (error) {
    console.error(error);

    return res.status(500).json({
        error: 'Error al validar información',
        details: error.message,
        stack: error.stack
    });
}
}

// ============================================================
// A PARTIR DE AQUÍ: servicio que recibe/procesa los pedidos POS
// de Oracle Simphony (SFTP -> middleware -> Core)
// ============================================================

function formatearFechaOracle(valor) {
    // Oracle Simphony manda fechas como 'AAAAMMDD' (ej. '20260718')
    if (!valor) return null;

    const texto = valor.toString();
    const anio = texto.substring(0, 4);
    const mes = texto.substring(4, 6);
    const dia = texto.substring(6, 8);

    return `${anio}-${mes}-${dia}`;
}

// ------------------------------------------------------------
// Parseo del archivo txt (formato B2B Purchase Orders de Oracle Simphony,
// pipe-delimited). Agrupa las líneas por numero_pedido, ya que un mismo
// archivo puede traer más de un pedido.
// ------------------------------------------------------------
function parsearLineaArchivo(lineaTexto) {
    const campos = lineaTexto.split('|');

    return {
        vendor_name: campos[0],
        vendor_id: campos[1],              // codigo_bodega_simphony (ej. "1004")
        numero_pedido: campos[2],
        fecha_pedido: campos[3],
        hora_pedido: campos[4],
        delivery_location_id: campos[5] || null,
        numero_linea: parseInt(campos[6], 10),
        codigo_producto: campos[7],
        fecha_requerida: campos[8],
        cantidad_solicitada: parseFloat(campos[9]),
        factor: parseFloat(campos[10]),
        precio_unitario: parseFloat(campos[11]),
        descuento: parseFloat(campos[12]),
        informacion: campos[13],
        nombre_articulo: campos[14],
        unidad_medida: campos[15]
        // campos[16] (Order Qty/Base Unit) no está soportado por Oracle, se ignora
    };
}

function agruparLineasPorPedido(contenidoArchivo) {
    const lineasTexto = contenidoArchivo
        .split(/\r?\n/)
        .filter(linea => linea.trim().length > 0);

    const pedidosMap = new Map();

    for (const lineaTexto of lineasTexto) {
        const linea = parsearLineaArchivo(lineaTexto);

        if (!pedidosMap.has(linea.numero_pedido)) {
            pedidosMap.set(linea.numero_pedido, {
                vendor_name: linea.vendor_name,
                vendor_id: linea.vendor_id,
                numero_pedido: linea.numero_pedido,
                fecha_pedido: linea.fecha_pedido,
                hora_pedido: linea.hora_pedido,
                delivery_location_id: linea.delivery_location_id,
                lineas: []
            });
        }

        pedidosMap.get(linea.numero_pedido).lineas.push({
            posicion: linea.numero_linea,
            item_no: linea.codigo_producto,
            fecha_entrega: linea.fecha_requerida,
            cantidad: linea.cantidad_solicitada,
            factor: linea.factor,
            precio: linea.precio_unitario,
            descuento: linea.descuento,
            informacion: linea.informacion,
            nombre_articulo: linea.nombre_articulo,
            unidad_orden: linea.unidad_medida
        });
    }

    return Array.from(pedidosMap.values());
}

// ------------------------------------------------------------
// Lógica de enriquecimiento + inserción transaccional (encabezado + detalle
// + historial). La usan tanto el endpoint que recibe JSON del middleware
// como el procesamiento directo del archivo .txt.
// ------------------------------------------------------------
async function guardarPedidoPos(datosPedido, archivo_origen) {
    const {
        vendor_name,
        vendor_id,
        numero_pedido,
        fecha_pedido,
        hora_pedido,
        delivery_location_id,
        lineas
    } = datosPedido;

    const sequelizeCore = await sequelizeInit.sequelizeInit('CORE');
    const sequelizePdv = await sequelizeInit.sequelizeInit(PDV_CONNECTION);
    const TiendaModel = initTiendaModel(sequelizePdv);

    const t = await sequelizeCore.transaction();

    try {
        // codigo_tienda es directo el Delivery Location ID del archivo
        // (StoreNumberSimphony de Simphony), no el código interno de tTienda
        let codigo_tienda = delivery_location_id || null;
        let nombre_tienda = null;
        let codigo_empresa = null;
        // codigo_bodega se resuelve vía tTienda.whsCode (ya no viene directo
        // del archivo) — Delivery Location ID volvió a ser el StoreNumberSimphony
        let codigo_bodega = null;
        // codigo_bodega_simphony es el Vendor ID del archivo (posición 2):
        // identifica el ORIGEN/bodega en Simphony (AVICOLA GUADALUPE, CORPORACION
        // RM, etc.) — distinto de codigo_tienda, que es el DESTINO (tienda)
        let codigo_bodega_simphony = vendor_id || null;
        let estado_inicial = 'RECIBIDO';

        if (delivery_location_id) {
            const tienda = await TiendaModel.findOne({
                where: { StoreNumberSimphony: delivery_location_id }
            });

            if (tienda) {
                nombre_tienda = tienda.tda_nombre;
                codigo_empresa = tienda.empresa;
                codigo_bodega = tienda.whsCode;
            } else {
                estado_inicial = 'PENDIENTE_ENRIQUECIMIENTO';
            }
        } else {
            estado_inicial = 'PENDIENTE_ENRIQUECIMIENTO';
        }

        // tipo_pedido se clasifica por el NOMBRE del proveedor, no por su ID
        // (el Vendor ID de AVICOLA GUADALUPE ha cambiado entre archivos: "1004",
        // "CLI0011"... el nombre es el dato estable).
        const esAvicolaGuadalupe = (vendor_name || '').trim().toUpperCase().includes('AVICOLA GUADALUPE');
        const tipo_pedido = vendor_name ? (esAvicolaGuadalupe ? 'POLLO' : 'INSUMOS') : null;

        // nombre_bodega: SAP (Warehouses/OWHS) no trae el nombre en tTienda,
        // solo el WhsCode. Queda pendiente resolverlo si se necesita mostrar
        // (ej. consultando Service Layer al momento de mostrar en el portal).
        const nombre_bodega = null;

        let ruta_id = null;
        let nombre_ruta = null;

        // POLLO usa el maestro de rutas nuevo (tbl_catalogo_rutas_pollo /
        // tbl_tiendas_rutas_pollo, por whs_code_origen/muelle). INSUMOS
        // todavía usa el maestro viejo hasta que se construya el suyo propio.
        if (delivery_location_id) {
            if (tipo_pedido === 'POLLO') {
                const asignacionRutaPollo = await TiendaRutaPolloModel.findOne({
                    where: {
                        id_tienda_simphony: delivery_location_id,
                        fecha_fin_asignacion: null
                    },
                    include: [{ model: CatalogoRutaPolloModel, as: 'ruta' }],
                    transaction: t
                });

                if (asignacionRutaPollo && asignacionRutaPollo.ruta) {
                    ruta_id = asignacionRutaPollo.ruta.id;
                    nombre_ruta = asignacionRutaPollo.ruta.nombre_ruta;
                }
            } else {
                const asignacionRutaInsumos = await TiendaRutaInsumosModel.findOne({
                    where: {
                        id_tienda_simphony: delivery_location_id,
                        fecha_fin_asignacion: null
                    },
                    include: [{ model: CatalogoRutaInsumosModel, as: 'ruta' }],
                    transaction: t
                });

                if (asignacionRutaInsumos && asignacionRutaInsumos.ruta) {
                    ruta_id = asignacionRutaInsumos.ruta.id;
                    nombre_ruta = asignacionRutaInsumos.ruta.nombre_ruta;
                }
            }
        }

        const ahora = new Date();

        // fecha_requerida: se toma de la primera línea, asumiendo que todas
        // las líneas del pedido comparten la misma fecha (así viene en la
        // práctica en los archivos reales).
        const fecha_requerida = lineas.length > 0
            ? formatearFechaOracle(lineas[0].fecha_entrega)
            : null;

        const cabecera = await PedidoPosCabeceraModel.create({
            codigo_empresa: codigo_empresa,
            codigo_tienda: codigo_tienda,
            numero_pedido: numero_pedido,
            fecha_pedido: formatearFechaOracle(fecha_pedido),
            fecha_requerida: fecha_requerida,
            hora_pedido: hora_pedido,
            nombre_tienda: nombre_tienda,
            codigo_bodega: codigo_bodega,
            tipo_pedido: tipo_pedido,
            codigo_bodega_simphony: codigo_bodega_simphony,
            nombre_bodega_simphony: vendor_name || null,
            nombre_bodega: nombre_bodega,
            ruta_id: ruta_id,
            nombre_ruta: nombre_ruta,
            estado: estado_inicial,
            archivo_origen: archivo_origen || null,
            fecha_recepcion: ahora,
            // camion/piloto y su fecha/usuario de asignación se llenan después,
            // manualmente, desde el endpoint de asignación de transporte por ruta
            camion_id: null,
            camion_placa: null,
            piloto_id: null,
            piloto_nombre: null,
            fecha_asignacion_transporte: null,
            usuario_asigno_transporte: null,
            creado_en: ahora,
            actualizado_en: ahora
        }, { transaction: t });

        const detalles = lineas.map(linea => ({
            pedido_id: cabecera.id,
            numero_linea: linea.posicion,
            codigo_producto: linea.item_no || null,
            descripcion_producto: linea.nombre_articulo,
            unidad_medida: linea.unidad_orden,
            fecha_requerida: formatearFechaOracle(linea.fecha_entrega),
            cantidad_solicitada: linea.cantidad,
            factor: linea.factor || 1,
            precio_unitario: linea.precio || null,
            importe_total: linea.cantidad && linea.precio ? linea.cantidad * linea.precio : null,
            estado_linea: 'PENDIENTE',
            creado_en: ahora,
            actualizado_en: ahora
        }));

        await PedidoPosDetalleModel.bulkCreate(detalles, { transaction: t });

        await PedidoPosHistorialModel.create({
            pedido_id: cabecera.id,
            estado_anterior: null,
            estado_nuevo: estado_inicial,
            usuario: null,
            comentario: 'Pedido recibido desde middleware Oracle Simphony',
            fecha: ahora
        }, { transaction: t });

        await t.commit();

        return {
            success: true,
            id_pedido: cabecera.id,
            numero_pedido: numero_pedido,
            estado: estado_inicial,
            total_lineas: detalles.length
        };
    } catch (error) {
        await t.rollback();

        return {
            success: false,
            numero_pedido: numero_pedido,
            error: error.message
        };
    }
}

// ------------------------------------------------------------
// Procesa un archivo .txt recibido en memoria (multer memoryStorage,
// mismo formato pipe-delimited), parseándolo y guardando cada pedido
// que contenga.
// ------------------------------------------------------------
async function procesarArchivoPedidoPos(buffer, nombreArchivoOriginal) {
    const contenido = buffer.toString('latin1'); // latin1 por acentos (ej. "Lasaña")
    const pedidosDelArchivo = agruparLineasPorPedido(contenido);

    const resultados = [];

    for (const datosPedido of pedidosDelArchivo) {
        const resultado = await guardarPedidoPos(datosPedido, nombreArchivoOriginal);
        resultados.push(resultado);
    }

    return resultados;
}

// ------------------------------------------------------------
// Handler de Express: recibe uno o más archivos .txt por upload (multer),
// cada uno representa un pedido (o varios, si el archivo trae más de un
// numero_pedido), los procesa todos y devuelve el resultado por archivo.
// ------------------------------------------------------------
async function subirYProcesarArchivosPedidoPos(req, res) {
    const archivos = req.files;

    if (!archivos || archivos.length === 0) {
        return res.status(400).json({
            error: 'No se recibió ningún archivo',
            success: false
        });
    }

    const resultadosPorArchivo = [];

    for (const archivo of archivos) {
        try {
            const resultadosPedidos = await procesarArchivoPedidoPos(archivo.buffer, archivo.originalname);

            resultadosPorArchivo.push({
                archivo: archivo.originalname,
                success: true,
                pedidos: resultadosPedidos
            });
        } catch (error) {
            resultadosPorArchivo.push({
                archivo: archivo.originalname,
                success: false,
                error: error.message
            });
        }
    }

    return res.json({
        success: true,
        total_archivos: archivos.length,
        resultados: resultadosPorArchivo
    });
}

// ------------------------------------------------------------
// GET: obtiene los pedidos POS ya guardados, agrupados por ruta -> tienda,
// separado por tipo_pedido (POLLO / INSUMOS, son dos vistas distintas),
// con filtros opcionales de bodega, tienda, ruta y fecha requerida
// (si no se manda fecha_requerida, se usa el día siguiente por defecto).
// ------------------------------------------------------------
// Agrupa cabeceras de tbl_pedidos_pos_cabecera (ya cargadas con su detalle)
// en rutas -> tiendas, igual para getPedidosPos y getPedidosPorDivision —
// ambas hacen la misma transformación, solo cambia cómo llegan filtradas
// las cabeceras.
function agruparPedidosPosPorRuta(pedidos, esInsumos) {
    const mapearPedido = (p) => ({
        pedido_id: p.id,
        numero_pedido: p.numero_pedido,
        fecha_pedido: p.fecha_pedido,
        hora_pedido: p.hora_pedido,
        fecha_requerida: p.fecha_requerida,
        estado: p.estado,
        sap_docentry: p.sap_docentry,
        sap_docnum: p.sap_docnum,
        sap_error: p.sap_error,
        items: p.detalle.map(d => ({
            id: d.id,
            codigo_producto: d.codigo_producto,
            descripcion_producto: d.descripcion_producto,
            unidad_medida: d.unidad_medida,
            fecha_requerida: d.fecha_requerida,
            cantidad_solicitada: d.cantidad_solicitada,
            cantidad_asignada: d.cantidad_asignada,
            estado_linea: d.estado_linea
        }))
    });

    // Agrupar por ruta -> tienda (los datos de ruta/camion/piloto ya
    // vienen "aplanados" en el encabezado, no hace falta otro join)
    const rutasMap = new Map();

    for (const pedido of pedidos) {
        const p = pedido.get({ plain: true });
        const claveRuta = p.ruta_id || 'sin_ruta';

        if (!rutasMap.has(claveRuta)) {
            rutasMap.set(claveRuta, {
                ruta_id: p.ruta_id,
                nombre_ruta: p.nombre_ruta || 'Sin ruta asignada',
                camion_id: p.camion_id,
                camion_placa: p.camion_placa,
                piloto_id: p.piloto_id,
                piloto_nombre: p.piloto_nombre,
                tiendas: []
            });
        }

        const grupo = rutasMap.get(claveRuta);

        if (!esInsumos) {
            // POLLO: un registro por pedido, comportamiento original sin fusionar.
            grupo.tiendas.push({
                pedido_id: p.id,
                codigo_tienda: p.codigo_tienda,
                nombre_tienda: p.nombre_tienda,
                codigo_empresa: p.codigo_empresa,
                codigo_bodega: p.codigo_bodega,
                ...mapearPedido(p)
            });
            continue;
        }

        // INSUMOS: se fusiona con la tarjeta de la misma tienda si ya existe
        // (puede llegar primero el pedido de insumos o el de activo fijo,
        // el orden no importa), si no existe se crea con ambos bloques null.
        let tarjeta = grupo.tiendas.find(tda => tda.codigo_tienda === p.codigo_tienda);

        if (!tarjeta) {
            tarjeta = {
                codigo_tienda: p.codigo_tienda,
                nombre_tienda: p.nombre_tienda,
                codigo_empresa: p.codigo_empresa,
                codigo_bodega: p.codigo_bodega,
                insumos: null,
                activo_fijo: null
            };
            grupo.tiendas.push(tarjeta);
        }

        if (p.tipo_pedido === 'ACTIVO_FIJO') {
            tarjeta.activo_fijo = mapearPedido(p);
        } else {
            tarjeta.insumos = mapearPedido(p);
        }
    }

    return Array.from(rutasMap.values()).map(ruta => {
        const estadosUnicos = esInsumos
            ? [...new Set(ruta.tiendas.flatMap(t => [t.insumos?.estado, t.activo_fijo?.estado].filter(Boolean)))]
            : [...new Set(ruta.tiendas.map(t => t.estado))];
        const estado_general = estadosUnicos.length === 1 ? estadosUnicos[0] : 'MIXTO';

        // sap_docnum es el mismo documento para toda la ruta (una sola
        // transferencia por ruta+fecha), así que basta con tomar el
        // primero que no sea null
        const docnumDe = (tda) => esInsumos ? (tda.insumos?.sap_docnum || tda.activo_fijo?.sap_docnum) : tda.sap_docnum;
        const docentryDe = (tda) => esInsumos ? (tda.insumos?.sap_docentry || tda.activo_fijo?.sap_docentry) : tda.sap_docentry;
        const pedidoConDoc = ruta.tiendas.find(t => docnumDe(t));
        const sap_docnum = pedidoConDoc ? docnumDe(pedidoConDoc) : null;
        const sap_docentry = pedidoConDoc ? docentryDe(pedidoConDoc) : null;

        return { ...ruta, estado_general, sap_docnum, sap_docentry };
    });
}

async function getPedidosPos(req, res) {
    const { tipo_pedido, codigo_bodega, codigo_tienda, ruta_id } = req.query;
    let { fecha_requerida } = req.query;

    if (!tipo_pedido || !['POLLO', 'INSUMOS'].includes(tipo_pedido)) {
        return res.status(400).json({
            error: "El parámetro tipo_pedido es requerido y debe ser 'POLLO' o 'INSUMOS'",
            success: false
        });
    }

    if (!fecha_requerida) {
        const manana = new Date();
        manana.setDate(manana.getDate() + 1);
        fecha_requerida = manana.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    try {
        // POLLO no cambia (una base SAP separada, AVIGUA, no se fusiona con nada).
        // INSUMOS ahora también trae ACTIVO_FIJO (misma bodega/base SAP), para
        // fusionar en una sola tarjeta por tienda los pedidos de ambos tipos.
        const esInsumos = tipo_pedido === 'INSUMOS';
        const tiposConsulta = esInsumos ? TIPOS_INSUMOS_Y_ACTIVO_FIJO : [tipo_pedido];

        const whereCabecera = { tipo_pedido: { [Op.in]: tiposConsulta }, fecha_requerida };

        if (codigo_bodega) {
            whereCabecera.codigo_bodega = codigo_bodega;
        }

        if (codigo_tienda) {
            whereCabecera.codigo_tienda = { [Op.iLike]: `%${codigo_tienda}%` };
        }

        if (ruta_id) {
            whereCabecera.ruta_id = ruta_id;
        }

        const pedidos = await PedidoPosCabeceraModel.findAll({
            where: whereCabecera,
            include: [
                { model: PedidoPosDetalleModel, as: 'detalle' }
            ],
            order: [
                ['nombre_ruta', 'ASC'],
                ['nombre_tienda', 'ASC']
            ]
        });

        return res.json({
            success: true,
            tipo_pedido: tipo_pedido,
            fecha_requerida: fecha_requerida,
            rutas: agruparPedidosPosPorRuta(pedidos, esInsumos)
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener pedidos POS',
            details: error.message,
            success: false
        });
    }
}

// Divisiones válidas para los reportes ('1' y '2'; no hay más).
const DIVISIONES_VALIDAS = ['1', '2'];

// Interpreta el parámetro `division` de un request: una lista separada por
// comas ("1", "2" o "1,2"). Devuelve null si no se mandó (= sin filtro),
// o un arreglo de divisiones válidas; lanza si trae algo distinto de 1/2.
function parsearDivisiones(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') return null;

    const divisiones = [...new Set(String(valor).split(',').map(d => d.trim()).filter(Boolean))];

    if (divisiones.length === 0 || divisiones.some(d => !DIVISIONES_VALIDAS.includes(d))) {
        throw new Error("division debe ser '1', '2' o '1,2'");
    }

    return divisiones;
}

// StoreNumberSimphony de las tiendas de una o varias divisiones, según
// dbo.tTienda — es el mismo código que usa tbl_pedidos_pos_cabecera.codigo_tienda.
async function obtenerCodigosTiendaPorDivision(division) {
    const divisiones = [].concat(division).map(String);
    const sequelizePdv = await sequelizeInit.sequelizeInit('PDV');
    const TiendaPdvModel = initTiendaModel(sequelizePdv);

    const tiendasDivision = await TiendaPdvModel.findAll({
        attributes: ['StoreNumberSimphony'],
        where: { division: { [Op.in]: divisiones } },
        raw: true
    });

    return [...new Set(tiendasDivision.map(t => t.StoreNumberSimphony).filter(Boolean))];
}

// Mapa StoreNumberSimphony -> división ('1' | '2'), para poder indicar a qué
// división pertenece cada pedido en los reportes.
async function obtenerMapaDivisionPorTienda() {
    const sequelizePdv = await sequelizeInit.sequelizeInit('PDV');
    const TiendaPdvModel = initTiendaModel(sequelizePdv);

    const tiendas = await TiendaPdvModel.findAll({
        attributes: ['StoreNumberSimphony', 'division'],
        where: { division: { [Op.in]: DIVISIONES_VALIDAS } },
        raw: true
    });

    return new Map(
        tiendas
            .filter(t => t.StoreNumberSimphony)
            .map(t => [t.StoreNumberSimphony, String(t.division).trim()])
    );
}

// GET /pedido/getPedidosPorDivision?tipo_pedido=POLLO&fecha_requerida=...&division=1
// Usada por las vistas de solo lectura (nivel_permiso lectura/lectura_division):
// en vez de traer todos los pedidos del día y filtrar por división en el
// frontend, se filtra directo en la consulta — primero se buscan en
// dbo.tTienda las tiendas de esa división (por StoreNumberSimphony, el mismo
// código que usa tbl_pedidos_pos_cabecera.codigo_tienda), y con esa lista ya
// se filtran los pedidos.
async function getPedidosPorDivision(req, res) {
    const { tipo_pedido, fecha_requerida, division } = req.query;

    if (!tipo_pedido || !['POLLO', 'INSUMOS'].includes(tipo_pedido)) {
        return res.status(400).json({
            error: "El parámetro tipo_pedido es requerido y debe ser 'POLLO' o 'INSUMOS'",
            success: false
        });
    }

    if (!fecha_requerida) {
        return res.status(400).json({ error: 'fecha_requerida es requerida', success: false });
    }

    if (!division || !['1', '2'].includes(String(division))) {
        return res.status(400).json({ error: "division es requerida y debe ser '1' o '2'", success: false });
    }

    try {
        const codigosTienda = await obtenerCodigosTiendaPorDivision(division);

        if (codigosTienda.length === 0) {
            return res.json({ success: true, tipo_pedido, fecha_requerida, rutas: [] });
        }

        const esInsumos = tipo_pedido === 'INSUMOS';
        const tiposConsulta = esInsumos ? TIPOS_INSUMOS_Y_ACTIVO_FIJO : [tipo_pedido];

        const pedidos = await PedidoPosCabeceraModel.findAll({
            where: {
                tipo_pedido: { [Op.in]: tiposConsulta },
                fecha_requerida,
                codigo_tienda: { [Op.in]: codigosTienda }
            },
            include: [
                { model: PedidoPosDetalleModel, as: 'detalle' }
            ],
            order: [
                ['nombre_ruta', 'ASC'],
                ['nombre_tienda', 'ASC']
            ]
        });

        return res.json({
            success: true,
            tipo_pedido,
            fecha_requerida,
            rutas: agruparPedidosPosPorRuta(pedidos, esInsumos)
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener pedidos por división',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// GET: obtiene las asignaciones de camión/piloto por ruta para una fecha
// (útil para que el frontend sepa qué camiones/pilotos ya están tomados
// ese día, y los deshabilite en los dropdowns de las demás rutas).
// ------------------------------------------------------------
async function getAsignacionesTransporte(req, res) {
    const { fecha } = req.query;

    if (!fecha) {
        return res.status(400).json({ error: 'El parámetro fecha es requerido', success: false });
    }

    try {
        const asignaciones = await DespachoRutaModel.findAll({
            where: { fecha }
        });

        return res.json({ success: true, asignaciones });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener asignaciones de transporte',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// Upsert de tbl_despacho_ruta + propagación a tbl_pedidos_pos_cabecera.
// Compartido por asignarTransporte (sin restricción de estado, para la
// asignación inicial) y trasladarPiloto (solo con la ruta EN_TRANSITO).
// ------------------------------------------------------------
async function actualizarTransporte({ ruta_id, fecha, camion_id, piloto_id, usuario_asigno }) {
    const sequelizeCore = await sequelizeInit.sequelizeInit('CORE');
    const t = await sequelizeCore.transaction();

    try {
        const camion = await CamionModel.findByPk(camion_id, { transaction: t });
        const piloto = await UsersModel.findByPk(piloto_id);

        const camion_placa = camion ? camion.placa : null;
        const piloto_nombre = piloto
            ? [piloto.first_name, piloto.second_name, piloto.first_last_name, piloto.second_last_name].filter(Boolean).join(' ')
            : null;

        const ahora = new Date();

        const [asignacion, created] = await DespachoRutaModel.findOrCreate({
            where: { ruta_id, fecha },
            defaults: {
                camion_id,
                camion_placa,
                piloto_id,
                piloto_nombre,
                usuario_asigno,
                fecha_asignacion: ahora,
                actualizado_en: ahora
            },
            transaction: t
        });

        if (!created) {
            await asignacion.update({
                camion_id,
                camion_placa,
                piloto_id,
                piloto_nombre,
                usuario_asigno,
                actualizado_en: ahora
            }, { transaction: t });
        }

        // Propagar a todos los pedidos de esa ruta+fecha requerida
        await PedidoPosCabeceraModel.update({
            camion_id,
            camion_placa,
            piloto_id,
            piloto_nombre,
            fecha_asignacion_transporte: ahora,
            usuario_asigno_transporte: usuario_asigno
        }, {
            where: { ruta_id, fecha_requerida: fecha },
            transaction: t
        });

        await t.commit();

        return asignacion;
    } catch (error) {
        await t.rollback();
        throw error;
    }
}

function mapearErrorTransporte(error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
        const campo = (error.errors && error.errors[0] && error.errors[0].path) || '';
        let mensaje = 'Ese camión o piloto ya está asignado a otra ruta este día';

        if (campo.includes('camion')) mensaje = 'Ese camión ya está asignado a otra ruta este día';
        if (campo.includes('piloto')) mensaje = 'Ese piloto ya está asignado a otra ruta este día';

        return { status: 409, mensaje };
    }

    return { status: 500, mensaje: 'Error al asignar transporte', details: error.message };
}

// ------------------------------------------------------------
// POST: asigna (crea o actualiza) camión + piloto para una ruta en una
// fecha específica. Las constraints UNIQUE de tbl_despacho_ruta evitan que
// se repita el mismo camión o piloto en otra ruta ese mismo día.
// Además propaga camion/piloto a todos los pedidos de esa ruta+fecha.
// ------------------------------------------------------------
async function asignarTransporte(req, res) {
    const { ruta_id, fecha, camion_id, piloto_id } = req.body;
    const usuario_asigno = (req.user && (req.user.nombre || req.user.id_usuario)) || null;

    if (!ruta_id || !fecha || !camion_id || !piloto_id) {
        return res.status(400).json({
            error: 'ruta_id, fecha, camion_id y piloto_id son requeridos',
            success: false
        });
    }

    try {
        const asignacion = await actualizarTransporte({ ruta_id, fecha, camion_id, piloto_id, usuario_asigno });
        return res.json({ success: true, asignacion });
    } catch (error) {
        const { status, mensaje, details } = mapearErrorTransporte(error);
        return res.status(status).json({ error: mensaje, details, success: false });
    }
}

// ------------------------------------------------------------
// POST: "Trasladar Envío" — cambia el piloto/camión de una ruta que ya
// está en camino, sin tocar nada más (mismo efecto que asignarTransporte,
// misma tabla). Solo se permite mientras TODOS los pedidos de esa
// ruta+fecha sigan en EN_TRANSITO — si alguno ya fue confirmado como
// recibido por la tienda (RECIBIDO/RECIBIDO_PARCIAL, lo pone la app móvil
// aparte), ya no se puede cambiar el piloto retroactivamente.
// ------------------------------------------------------------
async function trasladarPiloto(req, res) {
    const { ruta_id, fecha, camion_id, piloto_id } = req.body;
    const usuario_asigno = (req.user && (req.user.nombre || req.user.id_usuario)) || null;

    if (!ruta_id || !fecha || !camion_id || !piloto_id) {
        return res.status(400).json({
            error: 'ruta_id, fecha, camion_id y piloto_id son requeridos',
            success: false
        });
    }

    try {
        const cabeceras = await PedidoPosCabeceraModel.findAll({
            where: { ruta_id, fecha_requerida: fecha },
            attributes: ['estado']
        });

        if (cabeceras.length === 0) {
            return res.status(404).json({ error: 'No hay pedidos para esa ruta y fecha', success: false });
        }

        const estadosUnicos = [...new Set(cabeceras.map(c => c.estado))];

        if (estadosUnicos.length !== 1 || estadosUnicos[0] !== 'EN_TRANSITO') {
            return res.status(409).json({
                error: 'Solo se puede trasladar el piloto mientras el envío está en tránsito — ya hay tiendas con la entrega confirmada',
                success: false
            });
        }

        const asignacion = await actualizarTransporte({ ruta_id, fecha, camion_id, piloto_id, usuario_asigno });
        return res.json({ success: true, asignacion });
    } catch (error) {
        const { status, mensaje, details } = mapearErrorTransporte(error);
        return res.status(status).json({ error: mensaje, details, success: false });
    }
}

// ------------------------------------------------------------
// PASO 1: totales solicitados de POLLO por artículo (sumando todas las
// tiendas para una fecha_requerida) + stock disponible en SAP AVIGUA,
// bodega RAS-002 (Muelle Despacho Pollo). Es solo comparativo, no asigna
// nada todavía (eso es el Paso 2, en frontend).
// ------------------------------------------------------------
async function getComparativoStockPollo(req, res) {
    const { fecha, ruta_id } = req.query;
    const id_usuario = req.user && req.user.id_usuario;

    if (!fecha || !ruta_id) {
        return res.status(400).json({ error: 'fecha y ruta_id son requeridos', success: false });
    }

    try {
        const ruta = await CatalogoRutaPolloModel.findByPk(ruta_id);

        if (!ruta) {
            return res.status(404).json({ error: 'Ruta no encontrada', success: false });
        }

        const candado = await BloqueoRutaPolloModel.findOne({
            where: { ruta_id, fecha, estado: 'ACTIVO' }
        });

        if (!candado || String(candado.id_usuario) !== String(id_usuario)) {
            return res.status(403).json({
                error: 'Debes tomar el candado de esta ruta antes de calcular el stock',
                success: false
            });
        }

        const totales = await PedidoPosDetalleModel.findAll({
            attributes: [
                'codigo_producto',
                [fn('SUM', col('cantidad_solicitada')), 'cantidad_solicitada_total'],
                [fn('MAX', col('descripcion_producto')), 'descripcion_producto'],
                [fn('MAX', col('unidad_medida')), 'unidad_medida']
            ],
            include: [{
                model: PedidoPosCabeceraModel,
                as: 'cabecera',
                attributes: [],
                where: { tipo_pedido: 'POLLO', fecha_requerida: fecha, ruta_id }
            }],
            group: ['codigo_producto'],
            subQuery: false,
            raw: true
        });

        const codigos = totales.map(t => t.codigo_producto).filter(Boolean);
        const stockSAP = await consultarStockPollo(codigos, ruta.whs_code_origen);
        const stockMap = new Map(stockSAP.map(s => [s.codigo_articulo, s]));

        const comparativo = totales.map(t => {
            const stock = t.codigo_producto ? stockMap.get(t.codigo_producto) : null;
            const cantidadSolicitada = Number(t.cantidad_solicitada_total);
            const stockDisponible = stock ? Number(stock.bolsas_completas ?? stock.stock_disponible) : 0;

            return {
                codigo_producto: t.codigo_producto,
                descripcion_producto: t.descripcion_producto,
                unidad_medida: t.unidad_medida,
                cantidad_solicitada_total: cantidadSolicitada,
                stock_disponible: stockDisponible,
                encontrado_en_sap: !!stock,
                diferencia: stockDisponible - cantidadSolicitada
            };
        });

        return res.json({
            success: true,
            fecha,
            ruta_id,
            whs_code: ruta.whs_code_origen,
            comparativo
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener el comparativo de stock de pollo',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// GET: comparativo de stock de INSUMOS, escopado por ruta (igual que
// pollo), verificando el candado GLOBAL de insumos.
// ------------------------------------------------------------
async function getComparativoStockInsumos(req, res) {
    const { fecha, ruta_id } = req.query;
    const id_usuario = req.user && req.user.id_usuario;

    if (!fecha || !ruta_id) {
        return res.status(400).json({ error: 'fecha y ruta_id son requeridos', success: false });
    }

    try {
        const ruta = await CatalogoRutaInsumosModel.findByPk(ruta_id);

        if (!ruta) {
            return res.status(404).json({ error: 'Ruta no encontrada', success: false });
        }

        const candado = await BloqueoRutaInsumosModel.findOne({
            where: { ruta_id, fecha, estado: 'ACTIVO' }
        });

        if (!candado || String(candado.id_usuario) !== String(id_usuario)) {
            return res.status(403).json({
                error: 'Debes tomar el candado de esta ruta antes de calcular el stock',
                success: false
            });
        }

        const totales = await PedidoPosDetalleModel.findAll({
            attributes: [
                'codigo_producto',
                [fn('SUM', col('cantidad_solicitada')), 'cantidad_solicitada_total'],
                [fn('MAX', col('descripcion_producto')), 'descripcion_producto'],
                [fn('MAX', col('unidad_medida')), 'unidad_medida']
            ],
            include: [{
                model: PedidoPosCabeceraModel,
                as: 'cabecera',
                attributes: [],
                where: { tipo_pedido: { [Op.in]: TIPOS_INSUMOS_Y_ACTIVO_FIJO }, fecha_requerida: fecha, ruta_id }
            }],
            group: ['codigo_producto'],
            subQuery: false,
            raw: true
        });

        const codigos = totales.map(t => t.codigo_producto).filter(Boolean);
        const stockSAP = await consultarStockInsumos(codigos);
        const stockMap = new Map(stockSAP.map(s => [s.codigo_articulo, s]));

        const comparativo = totales.map(t => {
            const stock = t.codigo_producto ? stockMap.get(t.codigo_producto) : null;
            const cantidadSolicitada = Number(t.cantidad_solicitada_total);
            const stockDisponible = stock ? Number(stock.bolsas_completas ?? stock.stock_disponible) : 0;

            return {
                codigo_producto: t.codigo_producto,
                descripcion_producto: t.descripcion_producto,
                unidad_medida: t.unidad_medida,
                cantidad_solicitada_total: cantidadSolicitada,
                stock_disponible: stockDisponible,
                encontrado_en_sap: !!stock,
                diferencia: stockDisponible - cantidadSolicitada
            };
        });

        return res.json({
            success: true,
            fecha,
            ruta_id,
            whs_code: ruta.whs_code_origen,
            comparativo
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener el comparativo de stock de insumos',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// POST: guarda el resultado final de la asignación de cantidades por línea
// (ya sea automática por FIFO o ajustada manualmente en el frontend).
// Actualiza cantidad_asignada + estado_linea en el detalle, y marca el
// encabezado como VALIDADO. No toca SAP todavía — es el paso previo.
// ------------------------------------------------------------
async function guardarAsignacionCantidades(req, res) {
    const { fecha, asignaciones } = req.body;
    const usuario_ajuste = (req.user && (req.user.nombre || req.user.id_usuario)) || null;

    if (!fecha || !Array.isArray(asignaciones) || asignaciones.length === 0) {
        return res.status(400).json({
            error: 'fecha y asignaciones (arreglo) son requeridos',
            success: false
        });
    }

    const sequelizeCore = await sequelizeInit.sequelizeInit('CORE');
    const t = await sequelizeCore.transaction();

    try {
        const idsPedidosAfectados = new Set();

        for (const asign of asignaciones) {
            const { detalle_id, cantidad_asignada, ajustado_manual } = asign;

            if (!detalle_id || cantidad_asignada === undefined || cantidad_asignada === null) {
                throw new Error(`Cada asignación requiere detalle_id y cantidad_asignada (falló en: ${JSON.stringify(asign)})`);
            }

            const detalle = await PedidoPosDetalleModel.findByPk(detalle_id, { transaction: t });

            if (!detalle) {
                throw new Error(`No existe la línea de detalle ${detalle_id}`);
            }

            const cantidadNum = Number(cantidad_asignada);
            const solicitada = Number(detalle.cantidad_solicitada);

            if (isNaN(cantidadNum) || cantidadNum < 0) {
                throw new Error(`Cantidad inválida para la línea ${detalle_id}: ${cantidad_asignada}`);
            }

            if (cantidadNum > solicitada) {
                throw new Error(`La línea ${detalle_id} no puede asignar más de lo solicitado (${solicitada})`);
            }

            let estado_linea = 'PENDIENTE';
            if (cantidadNum <= 0) estado_linea = 'SIN_STOCK';
            else if (cantidadNum >= solicitada) estado_linea = 'VALIDADA';
            else estado_linea = 'PARCIAL';

            await detalle.update({
                cantidad_asignada: cantidadNum,
                estado_linea,
                ajustado_manual: ajustado_manual === true,
                usuario_ajuste,
                fecha_ajuste: new Date()
            }, { transaction: t });

            idsPedidosAfectados.add(detalle.pedido_id);
        }

        const ahora = new Date();

        await PedidoPosCabeceraModel.update({
            estado: 'VALIDADO',
            fecha_validacion: ahora,
            usuario_ajuste
        }, {
            where: { id: { [Op.in]: Array.from(idsPedidosAfectados) } },
            transaction: t
        });

        await t.commit();

        return res.json({
            success: true,
            pedidos_actualizados: idsPedidosAfectados.size,
            lineas_actualizadas: asignaciones.length
        });
    } catch (error) {
        await t.rollback();

        return res.status(400).json({
            error: 'Error al guardar la asignación de cantidades',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// POST: envía la transferencia de inventario (bodega -> camión) a SAP
// para una ruta+fecha de POLLO. Agrupa por artículo (suma entre tiendas),
// solo líneas con cantidad_asignada > 0. Si sale bien, marca EN_TRANSITO
// y libera el candado; si falla, marca ERROR_ENVIO_SAP y el candado sigue.
// ------------------------------------------------------------
async function enviarTransferenciaPollo(req, res) {
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

        const candado = await BloqueoRutaPolloModel.findOne({
            where: { ruta_id, fecha, estado: 'ACTIVO' }
        });

        if (!candado || String(candado.id_usuario) !== String(id_usuario)) {
            return res.status(403).json({
                error: 'Debes tener el candado de esta ruta activo para enviar la transferencia',
                success: false
            });
        }

        const despacho = await DespachoRutaModel.findOne({ where: { ruta_id, fecha } });

        if (!despacho || !despacho.camion_id || !despacho.piloto_id) {
            return res.status(400).json({
                error: 'Debes asignar piloto y camión a esta ruta antes de enviarla a SAP',
                success: false
            });
        }

        const lineasDetalle = await PedidoPosDetalleModel.findAll({
            attributes: [
                'codigo_producto',
                [fn('SUM', col('cantidad_asignada')), 'cantidad_total']
            ],
            include: [{
                model: PedidoPosCabeceraModel,
                as: 'cabecera',
                attributes: [],
                where: { tipo_pedido: 'POLLO', fecha_requerida: fecha, ruta_id }
            }],
            where: { cantidad_asignada: { [Op.gt]: 0 } },
            group: ['codigo_producto'],
            raw: true
        });

        if (lineasDetalle.length === 0) {
            return res.status(400).json({
                error: 'No hay artículos con cantidad asignada para transferir. Primero calcula el stock y guarda la asignación.',
                success: false
            });
        }

        // cantidad_asignada está en bolsas (Unidad de Venta), pero el
        // StockTransfer de SAP se mueve en la Unidad de Inventario (libras)
        // — se reconsulta SAP (no se confía en un factor guardado) para
        // convertir cada línea antes de crear la transferencia.
        const codigosDetalle = lineasDetalle.map(l => l.codigo_producto);
        const stockInfo = await consultarStockPollo(codigosDetalle, ruta.whs_code_origen);
        const factorPorCodigo = new Map(stockInfo.map(s => [s.codigo_articulo, s.sales_items_per_unit || 1]));

        const lineasSap = lineasDetalle.map(l => ({
            codigo_producto: l.codigo_producto,
            cantidad: Number(l.cantidad_total) * (factorPorCodigo.get(l.codigo_producto) || 1)
        }));

        const cabecerasAfectadas = await PedidoPosCabeceraModel.findAll({
            where: { tipo_pedido: 'POLLO', fecha_requerida: fecha, ruta_id },
            attributes: ['id', 'numero_pedido', 'codigo_tienda']
        });
        const idsPedidos = cabecerasAfectadas.map(c => c.id);
        // codigo_tienda (no nombre_tienda) para no arriesgar el límite de
        // longitud del campo Comments de SAP en rutas con muchas tiendas.
        const comentarios = [...new Set(
            cabecerasAfectadas
                .filter(c => c.numero_pedido)
                .map(c => c.codigo_tienda ? `${c.numero_pedido} (${c.codigo_tienda})` : c.numero_pedido)
        )].join(', ');

        let resultadoSap;

        try {
            resultadoSap = await crearTransferenciaPollo({
                fromWarehouse: ruta.whs_code_origen,
                toWarehouse: ruta.whs_code_destino,
                lineas: lineasSap,
                comentarios
            });
        } catch (sapError) {
            await PedidoPosCabeceraModel.update({
                estado: 'ERROR_ENVIO_SAP',
                sap_error: sapError.message
            }, { where: { id: { [Op.in]: idsPedidos } } });

            return res.status(502).json({
                error: 'SAP rechazó la transferencia',
                details: sapError.message,
                success: false
            });
        }

        const sequelizeCore = await sequelizeInit.sequelizeInit('CORE');
        const t = await sequelizeCore.transaction();

        try {
            const ahora = new Date();

            await PedidoPosCabeceraModel.update({
                estado: 'EN_TRANSITO',
                fecha_envio_sap: ahora,
                sap_docentry: resultadoSap.DocEntry,
                sap_docnum: resultadoSap.DocNum,
                sap_error: null
            }, { where: { id: { [Op.in]: idsPedidos } }, transaction: t });

            await PedidoPosDetalleModel.update({
                estado_linea: 'DESPACHADA'
            }, {
                where: {
                    pedido_id: { [Op.in]: idsPedidos },
                    cantidad_asignada: { [Op.gt]: 0 }
                },
                transaction: t
            });

            await BloqueoRutaPolloModel.update({
                estado: 'LIBERADO',
                fecha_liberacion: ahora
            }, { where: { ruta_id, fecha, estado: 'ACTIVO' }, transaction: t });

            await t.commit();
        } catch (dbError) {
            await t.rollback();
            throw dbError;
        }

        return res.json({
            success: true,
            sap_docentry: resultadoSap.DocEntry,
            sap_docnum: resultadoSap.DocNum,
            pedidos_actualizados: idsPedidos.length
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al enviar la transferencia a SAP',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// POST: igual que enviarTransferenciaPollo, pero para INSUMOS
// (candado global, sin dimensión de muelle).
// ------------------------------------------------------------
async function enviarTransferenciaInsumos(req, res) {
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

        const candado = await BloqueoRutaInsumosModel.findOne({
            where: { ruta_id, fecha, estado: 'ACTIVO' }
        });

        if (!candado || String(candado.id_usuario) !== String(id_usuario)) {
            return res.status(403).json({
                error: 'Debes tener el candado de esta ruta activo para enviar la transferencia',
                success: false
            });
        }

        const despacho = await DespachoRutaModel.findOne({ where: { ruta_id, fecha } });

        if (!despacho || !despacho.camion_id || !despacho.piloto_id) {
            return res.status(400).json({
                error: 'Debes asignar piloto y camión a esta ruta antes de enviarla a SAP',
                success: false
            });
        }

        const lineasDetalle = await PedidoPosDetalleModel.findAll({
            attributes: [
                'codigo_producto',
                [fn('SUM', col('cantidad_asignada')), 'cantidad_total']
            ],
            include: [{
                model: PedidoPosCabeceraModel,
                as: 'cabecera',
                attributes: [],
                where: { tipo_pedido: { [Op.in]: TIPOS_INSUMOS_Y_ACTIVO_FIJO }, fecha_requerida: fecha, ruta_id }
            }],
            where: { cantidad_asignada: { [Op.gt]: 0 } },
            group: ['codigo_producto'],
            raw: true
        });

        if (lineasDetalle.length === 0) {
            return res.status(400).json({
                error: 'No hay artículos con cantidad asignada para transferir. Primero calcula el stock y guarda la asignación.',
                success: false
            });
        }

        // cantidad_asignada está en bolsas (Unidad de Venta), pero el
        // StockTransfer de SAP se mueve en la Unidad de Inventario — se
        // reconsulta SAP (no se confía en un factor guardado) para
        // convertir cada línea antes de crear la transferencia.
        const codigosDetalle = lineasDetalle.map(l => l.codigo_producto);
        const stockInfo = await consultarStockInsumos(codigosDetalle, ruta.whs_code_origen);
        const factorPorCodigo = new Map(stockInfo.map(s => [s.codigo_articulo, s.sales_items_per_unit || 1]));

        const lineasSap = lineasDetalle.map(l => ({
            codigo_producto: l.codigo_producto,
            cantidad: Number(l.cantidad_total) * (factorPorCodigo.get(l.codigo_producto) || 1)
        }));

        const cabecerasAfectadas = await PedidoPosCabeceraModel.findAll({
            where: { tipo_pedido: { [Op.in]: TIPOS_INSUMOS_Y_ACTIVO_FIJO }, fecha_requerida: fecha, ruta_id },
            attributes: ['id', 'numero_pedido', 'codigo_tienda']
        });
        const idsPedidos = cabecerasAfectadas.map(c => c.id);
        // codigo_tienda (no nombre_tienda) para no arriesgar el límite de
        // longitud del campo Comments de SAP en rutas con muchas tiendas.
        const comentarios = [...new Set(
            cabecerasAfectadas
                .filter(c => c.numero_pedido)
                .map(c => c.codigo_tienda ? `${c.numero_pedido} (${c.codigo_tienda})` : c.numero_pedido)
        )].join(', ');

        let resultadoSap;

        try {
            resultadoSap = await crearTransferenciaInsumos({
                fromWarehouse: ruta.whs_code_origen,
                toWarehouse: ruta.whs_code_destino,
                lineas: lineasSap,
                comentarios
            });
        } catch (sapError) {
            await PedidoPosCabeceraModel.update({
                estado: 'ERROR_ENVIO_SAP',
                sap_error: sapError.message
            }, { where: { id: { [Op.in]: idsPedidos } } });

            return res.status(502).json({
                error: 'SAP rechazó la transferencia',
                details: sapError.message,
                success: false
            });
        }

        const sequelizeCore = await sequelizeInit.sequelizeInit('CORE');
        const t = await sequelizeCore.transaction();

        try {
            const ahora = new Date();

            await PedidoPosCabeceraModel.update({
                estado: 'EN_TRANSITO',
                fecha_envio_sap: ahora,
                sap_docentry: resultadoSap.DocEntry,
                sap_docnum: resultadoSap.DocNum,
                sap_error: null
            }, { where: { id: { [Op.in]: idsPedidos } }, transaction: t });

            await PedidoPosDetalleModel.update({
                estado_linea: 'DESPACHADA'
            }, {
                where: {
                    pedido_id: { [Op.in]: idsPedidos },
                    cantidad_asignada: { [Op.gt]: 0 }
                },
                transaction: t
            });

            await BloqueoRutaInsumosModel.update({
                estado: 'LIBERADO',
                fecha_liberacion: ahora
            }, { where: { ruta_id, fecha, estado: 'ACTIVO' }, transaction: t });

            await t.commit();
        } catch (dbError) {
            await t.rollback();
            throw dbError;
        }

        return res.json({
            success: true,
            sap_docentry: resultadoSap.DocEntry,
            sap_docnum: resultadoSap.DocNum,
            pedidos_actualizados: idsPedidos.length
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al enviar la transferencia a SAP',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// Arma el PDF del ticket de traslado (bodega -> camión): datos de la
// ruta, totales por artículo, y líneas de firma. Se comparte entre
// POLLO e INSUMOS, solo cambia de dónde saca los datos cada wrapper.
// ------------------------------------------------------------
function construirPdfTicket(res, { nombreRuta, tipoPedido, fecha, whsOrigen, whsDestino, camionPlaca, pilotoNombre, sapDocnum, lineas, nombreArchivo, firmaAdmin, firmaPiloto }) {
    const doc = new PDFDocument({ margin: 40, size: 'LETTER' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    doc.pipe(res);

    doc.fontSize(16).font('Helvetica-Bold').text('Ticket de Traslado de Inventario', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').fillColor('#555555')
        .text(`Tipo de pedido: ${tipoPedido}`, { align: 'center' });
    doc.moveDown(1);
    doc.fillColor('#000000');

    // Datos generales
    const datos = [
        ['Ruta', nombreRuta || '—'],
        ['Fecha requerida', fecha],
        ['Bodega origen', whsOrigen || '—'],
        ['Bodega destino', whsDestino || '—'],
        ['Camión', camionPlaca || '—'],
        ['Piloto', pilotoNombre || '—'],
        ['Documento SAP', sapDocnum ? String(sapDocnum) : '—']
    ];

    doc.fontSize(10);
    datos.forEach(([label, value]) => {
        doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
        doc.font('Helvetica').text(value);
    });

    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(12).text('Detalle de artículos');
    doc.moveDown(0.5);

    // Tabla simple (sin librería extra): columnas fijas por posición X
    const startX = doc.x;
    const anchoCodigo = 65;
    const anchoDescripcion = 195;
    const anchoUnidad = 110;
    const anchoCantidad = 70;
    const colCodigo = startX;
    const colDescripcion = startX + anchoCodigo + 10;
    const colUnidad = startX + anchoCodigo + anchoDescripcion + 20;
    const colCantidad = startX + anchoCodigo + anchoDescripcion + anchoUnidad + 30;
    const anchoTabla = anchoCodigo + anchoDescripcion + anchoUnidad + anchoCantidad + 30;

    const filaEncabezado = () => {
        doc.font('Helvetica-Bold').fontSize(9);
        doc.text('Código', colCodigo, doc.y, { width: anchoCodigo });
        doc.text('Descripción', colDescripcion, doc.y, { width: anchoDescripcion });
        doc.text('Unidad', colUnidad, doc.y, { width: anchoUnidad });
        doc.text('Cantidad', colCantidad, doc.y, { width: anchoCantidad, align: 'right' });
        doc.moveDown(0.3);
        doc.moveTo(startX, doc.y).lineTo(startX + anchoTabla, doc.y).strokeColor('#cccccc').stroke();
        doc.moveDown(0.4);
    };

    filaEncabezado();
    doc.font('Helvetica').fontSize(9);

    lineas.forEach(l => {
        if (doc.y > 680) {
            doc.addPage();
            filaEncabezado();
            doc.font('Helvetica').fontSize(9);
        }

        const y = doc.y;
        const codigo = l.codigo_producto || '—';
        const descripcion = l.descripcion_producto || '—';
        const unidad = l.unidad_medida || '—';
        const cantidad = String(l.cantidad);

        // La altura de la fila la define la celda más alta (código,
        // descripción o unidad pueden partirse en más de una línea)
        const alturaFila = Math.max(
            doc.heightOfString(codigo, { width: anchoCodigo }),
            doc.heightOfString(descripcion, { width: anchoDescripcion }),
            doc.heightOfString(unidad, { width: anchoUnidad }),
            doc.heightOfString(cantidad, { width: anchoCantidad })
        );

        doc.text(codigo, colCodigo, y, { width: anchoCodigo });
        doc.text(descripcion, colDescripcion, y, { width: anchoDescripcion });
        doc.text(unidad, colUnidad, y, { width: anchoUnidad });
        doc.text(cantidad, colCantidad, y, { width: anchoCantidad, align: 'right' });

        doc.y = y + alturaFila + 6;
    });

    doc.moveDown(2);

    // Líneas de firma
    if (doc.y > 660) doc.addPage();

    const anchoFirma = 200;
    const colAdmin = startX;
    const colPiloto = startX + 270;
    const yEtiqueta = doc.y;
    const ySello = yEtiqueta + 14;
    const yNombre = ySello + 13;
    const yFecha = yNombre + 11;
    const yLineaVacia = ySello + 6;
    const yTextoLineaVacia = yLineaVacia + 5;

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000');
    doc.text('Autorización administrador', colAdmin, yEtiqueta, { width: anchoFirma });
    doc.text('Firma piloto', colPiloto, yEtiqueta, { width: anchoFirma });

    dibujarCeldaFirma(doc, {
        firma: firmaAdmin,
        x: colAdmin,
        anchoFirma,
        ySello,
        yNombre,
        yFecha,
        yLineaVacia,
        yTextoLineaVacia,
        textoSello: 'AUTORIZADO',
        textoVacio: 'Firma Administrador'
    });

    dibujarCeldaFirma(doc, {
        firma: firmaPiloto,
        x: colPiloto,
        anchoFirma,
        ySello,
        yNombre,
        yFecha,
        yLineaVacia,
        yTextoLineaVacia,
        textoSello: 'FIRMADO',
        textoVacio: 'Firma Piloto'
    });

    doc.end();
}

// ------------------------------------------------------------
// Dibuja una de las dos celdas de firma (admin o piloto) en el ticket:
// si ya está firmada, un sello de texto en verde con nombre+fecha; si
// no, la línea en blanco de siempre.
// ------------------------------------------------------------
function dibujarCeldaFirma(doc, { firma, x, anchoFirma, ySello, yNombre, yFecha, yLineaVacia, yTextoLineaVacia, textoSello, textoVacio }) {
    if (firma) {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a7a3d')
            .text(textoSello, x, ySello, { width: anchoFirma, align: 'center' });
        doc.fontSize(8).font('Helvetica').fillColor('#1a7a3d')
            .text(firma.nombre || '—', x, yNombre, { width: anchoFirma, align: 'center' });
        doc.text(formatearFechaHoraTicket(firma.fecha), x, yFecha, { width: anchoFirma, align: 'center' });
        doc.fillColor('#000000');
    } else {
        doc.moveTo(x, yLineaVacia).lineTo(x + anchoFirma, yLineaVacia).strokeColor('#000000').stroke();
        doc.fontSize(9).font('Helvetica').fillColor('#000000')
            .text(textoVacio, x, yTextoLineaVacia, { width: anchoFirma, align: 'center' });
    }
}

function formatearFechaHoraTicket(fecha) {
    if (!fecha) return '';
    const d = new Date(fecha);
    return d.toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });
}

// ------------------------------------------------------------
// GET: genera y descarga el ticket PDF de la transferencia de POLLO
// para una ruta+fecha ya EN_TRANSITO.
// ------------------------------------------------------------
async function generarTicketPollo(req, res) {
    const { ruta_id, fecha } = req.query;

    if (!ruta_id || !fecha) {
        return res.status(400).json({ error: 'ruta_id y fecha son requeridos', success: false });
    }

    try {
        const ruta = await CatalogoRutaPolloModel.findByPk(ruta_id);

        if (!ruta) {
            return res.status(404).json({ error: 'Ruta no encontrada', success: false });
        }

        const cabecera = await PedidoPosCabeceraModel.findOne({
            where: { tipo_pedido: 'POLLO', fecha_requerida: fecha, ruta_id, estado: 'EN_TRANSITO' }
        });

        if (!cabecera) {
            return res.status(400).json({
                error: 'Esta ruta no está en tránsito para esta fecha, no se puede generar el ticket',
                success: false
            });
        }

        const lineasDetalle = await PedidoPosDetalleModel.findAll({
            attributes: [
                'codigo_producto',
                [fn('SUM', col('cantidad_asignada')), 'cantidad_total'],
                [fn('MAX', col('descripcion_producto')), 'descripcion_producto'],
                [fn('MAX', col('unidad_medida')), 'unidad_medida']
            ],
            include: [{
                model: PedidoPosCabeceraModel,
                as: 'cabecera',
                attributes: [],
                where: { tipo_pedido: 'POLLO', fecha_requerida: fecha, ruta_id }
            }],
            where: { cantidad_asignada: { [Op.gt]: 0 } },
            group: ['codigo_producto'],
            raw: true
        });

        const lineas = lineasDetalle.map(l => ({
            codigo_producto: l.codigo_producto,
            descripcion_producto: l.descripcion_producto,
            unidad_medida: l.unidad_medida,
            cantidad: Number(l.cantidad_total)
        }));

        const ticketExistente = await TicketTrasladoModel.findOne({
            where: { tipo_pedido: 'POLLO', ruta_id, fecha }
        });

        const firmaAdmin = ticketExistente && ticketExistente.firmado_admin_fecha
            ? { nombre: ticketExistente.firmado_admin_nombre, fecha: ticketExistente.firmado_admin_fecha }
            : null;
        const firmaPiloto = ticketExistente && ticketExistente.firmado_piloto_fecha
            ? { nombre: ticketExistente.piloto_nombre, fecha: ticketExistente.firmado_piloto_fecha }
            : null;

        construirPdfTicket(res, {
            nombreRuta: cabecera.nombre_ruta,
            tipoPedido: 'POLLO',
            fecha,
            whsOrigen: ruta.whs_code_origen,
            whsDestino: ruta.whs_code_destino,
            camionPlaca: cabecera.camion_placa,
            pilotoNombre: cabecera.piloto_nombre,
            sapDocnum: cabecera.sap_docnum,
            lineas,
            firmaAdmin,
            firmaPiloto,
            nombreArchivo: `ticket_pollo_${cabecera.nombre_ruta}_${fecha}.pdf`
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al generar el ticket',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// GET: igual que generarTicketPollo, pero para INSUMOS.
// ------------------------------------------------------------
async function generarTicketInsumos(req, res) {
    const { ruta_id, fecha } = req.query;

    if (!ruta_id || !fecha) {
        return res.status(400).json({ error: 'ruta_id y fecha son requeridos', success: false });
    }

    try {
        const ruta = await CatalogoRutaInsumosModel.findByPk(ruta_id);

        if (!ruta) {
            return res.status(404).json({ error: 'Ruta no encontrada', success: false });
        }

        const cabecera = await PedidoPosCabeceraModel.findOne({
            where: { tipo_pedido: { [Op.in]: TIPOS_INSUMOS_Y_ACTIVO_FIJO }, fecha_requerida: fecha, ruta_id, estado: 'EN_TRANSITO' }
        });

        if (!cabecera) {
            return res.status(400).json({
                error: 'Esta ruta no está en tránsito para esta fecha, no se puede generar el ticket',
                success: false
            });
        }

        const lineasDetalle = await PedidoPosDetalleModel.findAll({
            attributes: [
                'codigo_producto',
                [fn('SUM', col('cantidad_asignada')), 'cantidad_total'],
                [fn('MAX', col('descripcion_producto')), 'descripcion_producto'],
                [fn('MAX', col('unidad_medida')), 'unidad_medida']
            ],
            include: [{
                model: PedidoPosCabeceraModel,
                as: 'cabecera',
                attributes: [],
                where: { tipo_pedido: { [Op.in]: TIPOS_INSUMOS_Y_ACTIVO_FIJO }, fecha_requerida: fecha, ruta_id }
            }],
            where: { cantidad_asignada: { [Op.gt]: 0 } },
            group: ['codigo_producto'],
            raw: true
        });

        const lineas = lineasDetalle.map(l => ({
            codigo_producto: l.codigo_producto,
            descripcion_producto: l.descripcion_producto,
            unidad_medida: l.unidad_medida,
            cantidad: Number(l.cantidad_total)
        }));

        const ticketExistente = await TicketTrasladoModel.findOne({
            where: { tipo_pedido: 'INSUMOS', ruta_id, fecha }
        });

        const firmaAdmin = ticketExistente && ticketExistente.firmado_admin_fecha
            ? { nombre: ticketExistente.firmado_admin_nombre, fecha: ticketExistente.firmado_admin_fecha }
            : null;
        const firmaPiloto = ticketExistente && ticketExistente.firmado_piloto_fecha
            ? { nombre: ticketExistente.piloto_nombre, fecha: ticketExistente.firmado_piloto_fecha }
            : null;

        construirPdfTicket(res, {
            nombreRuta: cabecera.nombre_ruta,
            tipoPedido: 'INSUMOS',
            fecha,
            whsOrigen: ruta.whs_code_origen,
            whsDestino: ruta.whs_code_destino,
            camionPlaca: cabecera.camion_placa,
            pilotoNombre: cabecera.piloto_nombre,
            sapDocnum: cabecera.sap_docnum,
            lineas,
            firmaAdmin,
            firmaPiloto,
            nombreArchivo: `ticket_insumos_${cabecera.nombre_ruta}_${fecha}.pdf`
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al generar el ticket',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// GET: PDF con el detalle de cantidad_asignada por artículo x tienda de
// una ruta+fecha de Insumos (Insumos + Activo Fijo fusionados, igual que
// el resto del flujo). A diferencia del ticket, no exige EN_TRANSITO — se
// puede generar antes de enviar a SAP (con lo ya asignado en el Paso 1) y
// después también, sin cambios en el criterio.
// ------------------------------------------------------------
async function generarResumenRutaInsumos(req, res) {
    const { ruta_id, fecha } = req.query;

    if (!ruta_id || !fecha) {
        return res.status(400).json({ error: 'ruta_id y fecha son requeridos', success: false });
    }

    try {
        const ruta = await CatalogoRutaInsumosModel.findByPk(ruta_id);

        if (!ruta) {
            return res.status(404).json({ error: 'Ruta no encontrada', success: false });
        }

        const cabeceras = await PedidoPosCabeceraModel.findAll({
            where: { tipo_pedido: { [Op.in]: TIPOS_INSUMOS_Y_ACTIVO_FIJO }, fecha_requerida: fecha, ruta_id },
            attributes: ['id', 'codigo_tienda', 'nombre_tienda', 'estado']
        });

        if (cabeceras.length === 0) {
            return res.status(404).json({ error: 'No hay pedidos para esta ruta y fecha', success: false });
        }

        // Una tienda puede tener dos cabeceras (Insumos + Activo Fijo) — se
        // fusionan en una sola columna por codigo_tienda, igual que hace
        // getPedidosPos al mostrarlas juntas en una tarjeta.
        const tiendasPorCodigo = new Map();
        for (const c of cabeceras) {
            if (!tiendasPorCodigo.has(c.codigo_tienda)) {
                tiendasPorCodigo.set(c.codigo_tienda, {
                    codigo_tienda: c.codigo_tienda,
                    nombre_tienda: c.nombre_tienda || c.codigo_tienda,
                    pedidoIds: []
                });
            }
            tiendasPorCodigo.get(c.codigo_tienda).pedidoIds.push(c.id);
        }

        const tiendas = [...tiendasPorCodigo.values()]
            .sort((a, b) => (a.nombre_tienda || '').localeCompare(b.nombre_tienda || ''));

        const pedidoATienda = new Map();
        for (const info of tiendasPorCodigo.values()) {
            for (const pid of info.pedidoIds) pedidoATienda.set(pid, info.codigo_tienda);
        }

        const idsPedidos = cabeceras.map(c => c.id);
        const detalles = await PedidoPosDetalleModel.findAll({
            where: { pedido_id: { [Op.in]: idsPedidos }, cantidad_asignada: { [Op.gt]: 0 } },
            attributes: ['pedido_id', 'codigo_producto', 'descripcion_producto', 'unidad_medida', 'cantidad_asignada']
        });

        const articulosPorCodigo = new Map();
        for (const d of detalles) {
            const codigoTienda = pedidoATienda.get(d.pedido_id);
            if (!codigoTienda) continue;

            if (!articulosPorCodigo.has(d.codigo_producto)) {
                articulosPorCodigo.set(d.codigo_producto, {
                    codigo_producto: d.codigo_producto,
                    nombre_producto: d.descripcion_producto,
                    unidad_medida: d.unidad_medida || 'UND',
                    cantidadPorTienda: new Map()
                });
            }

            const articulo = articulosPorCodigo.get(d.codigo_producto);
            const actual = articulo.cantidadPorTienda.get(codigoTienda) || 0;
            articulo.cantidadPorTienda.set(codigoTienda, actual + Number(d.cantidad_asignada));
        }

        const articulos = [...articulosPorCodigo.values()]
            .sort((a, b) => (a.codigo_producto || '').localeCompare(b.codigo_producto || ''));

        if (articulos.length === 0) {
            return res.status(400).json({
                error: 'No hay artículos con cantidad asignada para esta ruta. Primero calcula el stock y guarda la asignación.',
                success: false
            });
        }

        const yaEnviada = cabeceras.some(c => ['EN_TRANSITO', 'ENTREGADO', 'ENTREGADO_PARCIAL'].includes(c.estado));

        construirPdfResumenRuta(res, {
            nombreRuta: ruta.nombre_ruta,
            fecha,
            preliminar: !yaEnviada,
            tiendas,
            articulos,
            nombreArchivo: `resumen_ruta_insumos_${ruta.nombre_ruta || ruta_id}_${fecha}.pdf`
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al generar el resumen de ruta',
            details: error.message,
            success: false
        });
    }
}

// Igual que generarResumenRutaInsumos, pero para Pollo: una sola cabecera
// por tienda (no hay fusión con Activo Fijo), y usa CatalogoRutaPolloModel
// en vez de CatalogoRutaInsumosModel. Reutiliza el mismo dibujado de PDF.
async function generarResumenRutaPollo(req, res) {
    const { ruta_id, fecha } = req.query;

    if (!ruta_id || !fecha) {
        return res.status(400).json({ error: 'ruta_id y fecha son requeridos', success: false });
    }

    try {
        const ruta = await CatalogoRutaPolloModel.findByPk(ruta_id);

        if (!ruta) {
            return res.status(404).json({ error: 'Ruta no encontrada', success: false });
        }

        const cabeceras = await PedidoPosCabeceraModel.findAll({
            where: { tipo_pedido: 'POLLO', fecha_requerida: fecha, ruta_id },
            attributes: ['id', 'codigo_tienda', 'nombre_tienda', 'estado']
        });

        if (cabeceras.length === 0) {
            return res.status(404).json({ error: 'No hay pedidos para esta ruta y fecha', success: false });
        }

        // Agrupado defensivo por codigo_tienda, por si alguna vez hay más de
        // una cabecera de Pollo para la misma tienda (mismo criterio que
        // usa generarResumenRutaInsumos, aunque aquí lo normal es una sola).
        const tiendasPorCodigo = new Map();
        for (const c of cabeceras) {
            if (!tiendasPorCodigo.has(c.codigo_tienda)) {
                tiendasPorCodigo.set(c.codigo_tienda, {
                    codigo_tienda: c.codigo_tienda,
                    nombre_tienda: c.nombre_tienda || c.codigo_tienda,
                    pedidoIds: []
                });
            }
            tiendasPorCodigo.get(c.codigo_tienda).pedidoIds.push(c.id);
        }

        const tiendas = [...tiendasPorCodigo.values()]
            .sort((a, b) => (a.nombre_tienda || '').localeCompare(b.nombre_tienda || ''));

        const pedidoATienda = new Map();
        for (const info of tiendasPorCodigo.values()) {
            for (const pid of info.pedidoIds) pedidoATienda.set(pid, info.codigo_tienda);
        }

        const idsPedidos = cabeceras.map(c => c.id);
        const detalles = await PedidoPosDetalleModel.findAll({
            where: { pedido_id: { [Op.in]: idsPedidos }, cantidad_asignada: { [Op.gt]: 0 } },
            attributes: ['pedido_id', 'codigo_producto', 'descripcion_producto', 'unidad_medida', 'cantidad_asignada']
        });

        const articulosPorCodigo = new Map();
        for (const d of detalles) {
            const codigoTienda = pedidoATienda.get(d.pedido_id);
            if (!codigoTienda) continue;

            if (!articulosPorCodigo.has(d.codigo_producto)) {
                articulosPorCodigo.set(d.codigo_producto, {
                    codigo_producto: d.codigo_producto,
                    nombre_producto: d.descripcion_producto,
                    unidad_medida: d.unidad_medida || 'UND',
                    cantidadPorTienda: new Map()
                });
            }

            const articulo = articulosPorCodigo.get(d.codigo_producto);
            const actual = articulo.cantidadPorTienda.get(codigoTienda) || 0;
            articulo.cantidadPorTienda.set(codigoTienda, actual + Number(d.cantidad_asignada));
        }

        const articulos = [...articulosPorCodigo.values()]
            .sort((a, b) => (a.codigo_producto || '').localeCompare(b.codigo_producto || ''));

        if (articulos.length === 0) {
            return res.status(400).json({
                error: 'No hay artículos con cantidad asignada para esta ruta. Primero calcula el stock y guarda la asignación.',
                success: false
            });
        }

        const yaEnviada = cabeceras.some(c => ['EN_TRANSITO', 'ENTREGADO', 'ENTREGADO_PARCIAL'].includes(c.estado));

        construirPdfResumenRuta(res, {
            nombreRuta: ruta.nombre_ruta,
            fecha,
            preliminar: !yaEnviada,
            tiendas,
            articulos,
            nombreArchivo: `resumen_ruta_pollo_${ruta.nombre_ruta || ruta_id}_${fecha}.pdf`
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al generar el resumen de ruta',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// Dibuja el PDF de generarResumenRutaInsumos: una tabla en horizontal con
// un artículo por fila y una tienda por columna (más una columna de
// Total). Si hay más tiendas de las que caben legibles en una página, se
// reparten en grupos y cada grupo arranca en una página nueva, repitiendo
// el encabezado — el total de cada fila siempre suma TODAS las tiendas,
// no solo las del grupo que se esté mostrando en esa página.
// ------------------------------------------------------------
function construirPdfResumenRuta(res, { nombreRuta, fecha, preliminar, tiendas, articulos, nombreArchivo }) {
    const doc = new PDFDocument({ margin: 30, size: 'LETTER', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    doc.pipe(res);

    const anchoCodigo = 50;
    const anchoNombre = 150;
    const anchoUnidad = 65;
    const anchoTotal = 45;
    const anchoFijo = anchoCodigo + anchoNombre + anchoUnidad;
    const MAX_TIENDAS_POR_PAGINA = 12;

    const grupos = [];
    for (let i = 0; i < tiendas.length; i += MAX_TIENDAS_POR_PAGINA) {
        grupos.push(tiendas.slice(i, i + MAX_TIENDAS_POR_PAGINA));
    }
    if (grupos.length === 0) grupos.push([]);

    const anchoDisponibleTiendas = doc.page.width - doc.page.margins.left - doc.page.margins.right - anchoFijo - anchoTotal;
    const startX = doc.page.margins.left;

    const dibujarEncabezado = (grupoTiendas) => {
        doc.fontSize(14).font('Helvetica-Bold').text(`Resumen de Ruta${preliminar ? ' (Preliminar)' : ''}`, { align: 'center' });
        doc.fontSize(9).font('Helvetica').fillColor('#555555')
            .text(`Fecha Entrega: ${fecha}    Ruta: ${nombreRuta || '—'}`, { align: 'center' });
        doc.fillColor('#000000');
        doc.moveDown(0.6);

        const anchoTienda = grupoTiendas.length > 0 ? anchoDisponibleTiendas / grupoTiendas.length : anchoDisponibleTiendas;
        const colCodigo = startX;
        const colNombre = colCodigo + anchoCodigo;
        const colUnidad = colNombre + anchoNombre;
        const colsTiendas = grupoTiendas.map((_, i) => colUnidad + anchoUnidad + i * anchoTienda);
        const colTotal = colUnidad + anchoUnidad + grupoTiendas.length * anchoTienda;

        const yEncabezado = doc.y;
        doc.font('Helvetica-Bold').fontSize(8);
        doc.text('Código', colCodigo, yEncabezado, { width: anchoCodigo });
        doc.text('Nombre', colNombre, yEncabezado, { width: anchoNombre });
        doc.text('Unidad', colUnidad, yEncabezado, { width: anchoUnidad });
        grupoTiendas.forEach((t, i) => {
            doc.text(t.nombre_tienda, colsTiendas[i], yEncabezado, { width: anchoTienda, align: 'center' });
        });
        doc.text('Total', colTotal, yEncabezado, { width: anchoTotal, align: 'center' });

        const alturaEncabezado = Math.max(
            10,
            ...grupoTiendas.map(t => doc.heightOfString(t.nombre_tienda, { width: anchoTienda }))
        );
        doc.y = yEncabezado + alturaEncabezado + 4;
        doc.moveTo(startX, doc.y).lineTo(colTotal + anchoTotal, doc.y).strokeColor('#999999').stroke();
        doc.moveDown(0.3);

        return { colCodigo, colNombre, colUnidad, colsTiendas, colTotal, anchoTienda };
    };

    grupos.forEach((grupoTiendas, indiceGrupo) => {
        if (indiceGrupo > 0) doc.addPage();

        let cols = dibujarEncabezado(grupoTiendas);
        doc.font('Helvetica').fontSize(8);

        articulos.forEach(articulo => {
            if (doc.y > doc.page.height - doc.page.margins.bottom - 20) {
                doc.addPage();
                cols = dibujarEncabezado(grupoTiendas);
                doc.font('Helvetica').fontSize(8);
            }

            const y = doc.y;
            const total = [...articulo.cantidadPorTienda.values()].reduce((a, b) => a + b, 0);

            const alturaFila = Math.max(
                10,
                doc.heightOfString(articulo.codigo_producto || '—', { width: anchoCodigo }),
                doc.heightOfString(articulo.nombre_producto || '—', { width: anchoNombre }),
                doc.heightOfString(articulo.unidad_medida || '—', { width: anchoUnidad })
            );

            doc.text(articulo.codigo_producto || '—', cols.colCodigo, y, { width: anchoCodigo });
            doc.text(articulo.nombre_producto || '—', cols.colNombre, y, { width: anchoNombre });
            doc.text(articulo.unidad_medida || '—', cols.colUnidad, y, { width: anchoUnidad });

            grupoTiendas.forEach((t, i) => {
                const cantidad = articulo.cantidadPorTienda.get(t.codigo_tienda) || 0;
                doc.text(String(cantidad), cols.colsTiendas[i], y, { width: cols.anchoTienda, align: 'center' });
            });

            doc.font('Helvetica-Bold').text(String(total), cols.colTotal, y, { width: anchoTotal, align: 'center' });
            doc.font('Helvetica');

            doc.y = y + alturaFila + 4;
        });
    });

    doc.end();
}

// ------------------------------------------------------------
// Un bloque por pedido/cabecera (no por tienda: en Insumos una tienda puede
// tener pedido de Insumos Y de Activo Fijo, cada uno con su propio UUID).
// Es la base compartida por el reporte con QR (una ruta a la vez) y el
// reporte de detalle sin QR (todas las rutas de una fecha).
// ------------------------------------------------------------
function construirBloquesPedido(cabeceras) {
    return cabeceras.map(cabecera => {
        const p = cabecera.get({ plain: true });

        return {
            id_pedido: p.id,
            codigo_tienda: p.codigo_tienda,
            ruta_id: p.ruta_id || 'sin_ruta',
            nombre_ruta: p.nombre_ruta || 'Sin ruta asignada',
            nombre_tienda: p.nombre_tienda || p.codigo_tienda,
            label: p.tipo_pedido === 'ACTIVO_FIJO' ? 'Activo Fijo' : (p.tipo_pedido === 'INSUMOS' ? 'Insumos' : null),
            numero_pedido: p.numero_pedido,
            estado: p.estado,
            fecha_requerida: p.fecha_requerida,
            camion_placa: p.camion_placa,
            piloto_nombre: p.piloto_nombre,
            sap_delivery_docentry: p.sap_delivery_docentry,
            sap_delivery_docnum: p.sap_delivery_docnum,
            sap_entry_docentry: p.sap_entry_docentry,
            sap_entry_docnum: p.sap_entry_docnum,
            items: p.detalle.map(d => ({
                codigo_producto: d.codigo_producto,
                nombre_producto: d.descripcion_producto,
                unidad_medida: d.unidad_medida || 'UND',
                cantidad_solicitada: Number(d.cantidad_solicitada) || 0,
                cantidad_asignada: Number(d.cantidad_asignada) || 0,
                // null = la tienda todavía no confirmó recepción de esta línea
                cantidad_recibida: d.cantidad_recibida === null || d.cantidad_recibida === undefined
                    ? null
                    : Number(d.cantidad_recibida)
            }))
        };
    });
}

// Agrupa bloques (ya armados por construirBloquesPedido) por ruta, para el
// reporte de detalle de todas las rutas.
function agruparBloquesPorRuta(bloques) {
    const mapa = new Map();

    for (const bloque of bloques) {
        if (!mapa.has(bloque.ruta_id)) {
            mapa.set(bloque.ruta_id, { ruta_id: bloque.ruta_id, nombre_ruta: bloque.nombre_ruta, bloques: [] });
        }
        mapa.get(bloque.ruta_id).bloques.push(bloque);
    }

    return Array.from(mapa.values());
}

// QR por pedido para que el piloto lo imprima y lo entregue junto al
// pedido — una app externa (que no es parte de Core) lo escanea para
// consultar el pedido por su id_pedido (el UUID de Postgres).
async function construirBloquesQr(cabeceras) {
    const bloques = construirBloquesPedido(cabeceras);

    for (const bloque of bloques) {
        const qrPayload = JSON.stringify({ id_pedido: bloque.id_pedido, serie: bloque.numero_pedido, nombre_tienda: bloque.nombre_tienda });
        bloque.qrBuffer = await QRCode.toBuffer(qrPayload, { margin: 1, width: 160 });
    }

    return bloques;
}

// Dibuja el PDF de generarQrsRutaPollo/generarQrsRutaInsumos: carta vertical,
// un bloque por pedido apilado uno tras otro (nombre de tienda, tabla simple
// de artículos, y el QR al final) — nada de matriz ni columnas por tienda,
// a propósito, para que sea lo más simple posible de leer e imprimir.
function dibujarPdfQrsRuta(res, { nombreRuta, fecha, bloques, nombreArchivo }) {
    const doc = new PDFDocument({ margin: 40, size: 'LETTER' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    doc.pipe(res);

    const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left;
    const QR_SIZE = 90;

    const anchoCodigo = 60;
    const anchoPedido = 70;
    const anchoEnviado = 70;
    const anchoDif = 70;
    const anchoNombre = anchoUtil - anchoCodigo - anchoPedido - anchoEnviado - anchoDif;

    doc.fontSize(14).font('Helvetica-Bold').text('Códigos QR de Pedidos', { align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#555555')
        .text(`Ruta: ${nombreRuta || '—'}    Fecha Entrega: ${fecha}`, { align: 'center' });
    doc.fillColor('#000000');
    doc.moveDown(0.8);

    bloques.forEach((bloque) => {
        const alturaEstimada = 50 + bloque.items.length * 14 + QR_SIZE + 25;

        if (doc.y + alturaEstimada > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
        }

        doc.moveTo(startX, doc.y).lineTo(startX + anchoUtil, doc.y).strokeColor('#cccccc').stroke();
        doc.moveDown(0.4);

        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000');
        doc.text(bloque.label ? `${bloque.nombre_tienda} — ${bloque.label}` : bloque.nombre_tienda, startX);
        doc.font('Helvetica').fontSize(8).fillColor('#666666');
        doc.text(`Pedido: ${bloque.numero_pedido}`, startX);
        doc.fillColor('#000000');
        doc.moveDown(0.3);

        const colCodigo = startX;
        const colNombre = colCodigo + anchoCodigo;
        const colPedido = colNombre + anchoNombre;
        const colEnviado = colPedido + anchoPedido;
        const colDif = colEnviado + anchoEnviado;

        const yEncabezado = doc.y;
        doc.font('Helvetica-Bold').fontSize(8);
        doc.text('Código', colCodigo, yEncabezado, { width: anchoCodigo });
        doc.text('Artículo', colNombre, yEncabezado, { width: anchoNombre });
        doc.text('Pedido', colPedido, yEncabezado, { width: anchoPedido, align: 'center' });
        doc.text('Enviado', colEnviado, yEncabezado, { width: anchoEnviado, align: 'center' });
        doc.text('Diferencia', colDif, yEncabezado, { width: anchoDif, align: 'center' });
        doc.y = yEncabezado + 12;
        doc.moveTo(startX, doc.y).lineTo(startX + anchoUtil, doc.y).strokeColor('#999999').stroke();
        doc.moveDown(0.2);

        doc.font('Helvetica').fontSize(8);
        bloque.items.forEach((item) => {
            const diferencia = item.cantidad_solicitada - item.cantidad_asignada;
            const y = doc.y;

            doc.text(item.codigo_producto || '—', colCodigo, y, { width: anchoCodigo });
            doc.text(item.nombre_producto || '—', colNombre, y, { width: anchoNombre });
            doc.text(String(item.cantidad_solicitada), colPedido, y, { width: anchoPedido, align: 'center' });
            doc.text(String(item.cantidad_asignada), colEnviado, y, { width: anchoEnviado, align: 'center' });
            doc.text(String(diferencia), colDif, y, { width: anchoDif, align: 'center' });

            doc.y = y + 14;
        });

        doc.moveDown(0.5);
        const yQr = doc.y;
        doc.image(bloque.qrBuffer, startX, yQr, { width: QR_SIZE, height: QR_SIZE });

        // Línea de firma junto al QR, para que quede como comprobante físico
        // de que la tienda recibió el pedido.
        const xFirma = startX + QR_SIZE + 25;
        const anchoFirma = anchoUtil - QR_SIZE - 25;
        const yLineaFirma = yQr + QR_SIZE - 22;

        doc.moveTo(xFirma, yLineaFirma).lineTo(xFirma + anchoFirma, yLineaFirma).strokeColor('#000000').stroke();
        doc.font('Helvetica').fontSize(8).fillColor('#000000');
        doc.text('Firma de Recepción de Tienda', xFirma, yLineaFirma + 4, { width: anchoFirma });

        doc.y = yQr + QR_SIZE + 15;
    });

    doc.end();
}

// Suma cantidad_solicitada/asignada/recibida por código de producto, entre
// TODAS las rutas/tiendas/pedidos del documento — es el total que hay que
// despachar ese día para cada artículo, sin importar en qué ruta o tienda
// vaya cada unidad. cantidad_recibida solo suma las líneas que la tienda ya
// confirmó (las demás no cuentan); queda null si ninguna se ha confirmado.
function calcularResumenGeneral(rutasConBloques) {
    const totalesPorCodigo = new Map();

    for (const ruta of rutasConBloques) {
        for (const bloque of ruta.bloques) {
            for (const item of bloque.items) {
                const codigo = item.codigo_producto || '—';

                if (!totalesPorCodigo.has(codigo)) {
                    totalesPorCodigo.set(codigo, {
                        codigo_producto: codigo,
                        nombre_producto: item.nombre_producto,
                        cantidad_solicitada: 0,
                        cantidad_asignada: 0,
                        cantidad_recibida: null
                    });
                }

                const total = totalesPorCodigo.get(codigo);
                total.cantidad_solicitada += item.cantidad_solicitada;
                total.cantidad_asignada += item.cantidad_asignada;

                if (item.cantidad_recibida !== null && item.cantidad_recibida !== undefined) {
                    total.cantidad_recibida = (total.cantidad_recibida || 0) + item.cantidad_recibida;
                }
            }
        }
    }

    return Array.from(totalesPorCodigo.values())
        .sort((a, b) => (a.codigo_producto || '').localeCompare(b.codigo_producto || ''));
}

// ------------------------------------------------------------
// Helpers de dibujo compartidos por los reportes de detalle y de pedidos en
// tránsito (tabla de artículos, estado del pedido y documentos SAP).
// ------------------------------------------------------------
const ESTADOS_ENTREGADO = ['ENTREGADO', 'ENTREGADO_PARCIAL'];

const ETIQUETAS_ESTADO_PEDIDO = {
    ENTREGADO: { texto: 'Entregado', color: '#15803d' },
    ENTREGADO_PARCIAL: { texto: 'Entregado parcial', color: '#c2410c' },
    EN_TRANSITO: { texto: 'En ruta', color: '#1d4ed8' },
    RECIBIDO: { texto: 'Sin enviar', color: '#6b7280' },
    VALIDADO: { texto: 'Sin enviar', color: '#6b7280' },
    ERROR_ENVIO_SAP: { texto: 'Error de envío a SAP', color: '#b91c1c' }
};

function etiquetaEstadoPedido(estado) {
    return ETIQUETAS_ESTADO_PEDIDO[estado] || { texto: estado || '—', color: '#6b7280' };
}

// Las columnas "Recibido" y los documentos SAP solo salen si al menos un
// pedido del reporte ya está entregado (total o parcial).
function reporteTieneEntregas(rutasConBloques) {
    return rutasConBloques.some(r => r.bloques.some(b => ESTADOS_ENTREGADO.includes(b.estado)));
}

// "2 Entregado · 1 Entregado parcial · 5 En ruta"
function resumenEstadosPedidos(rutasConBloques) {
    const conteo = new Map();

    for (const ruta of rutasConBloques) {
        for (const bloque of ruta.bloques) {
            const texto = etiquetaEstadoPedido(bloque.estado).texto;
            conteo.set(texto, (conteo.get(texto) || 0) + 1);
        }
    }

    return [...conteo.entries()].map(([texto, n]) => `${n} ${texto}`).join('   ·   ');
}

function crearLayoutTabla(doc, mostrarRecibido) {
    const startX = doc.page.margins.left;
    const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const anchoCodigo = 60;
    const anchoNum = mostrarRecibido ? 60 : 70;
    const columnasNumericas = mostrarRecibido ? 4 : 3;
    const anchoNombre = anchoUtil - anchoCodigo - anchoNum * columnasNumericas;

    const colCodigo = startX;
    const colNombre = colCodigo + anchoCodigo;
    const colPedido = colNombre + anchoNombre;
    const colEnviado = colPedido + anchoNum;
    const colRecibido = mostrarRecibido ? colEnviado + anchoNum : null;
    const colDif = (mostrarRecibido ? colRecibido : colEnviado) + anchoNum;

    return {
        startX, anchoUtil, anchoCodigo, anchoNombre, anchoNum, mostrarRecibido,
        colCodigo, colNombre, colPedido, colEnviado, colRecibido, colDif
    };
}

function dibujarEncabezadoTabla(doc, L) {
    const y = doc.y;

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000');
    doc.text('Código', L.colCodigo, y, { width: L.anchoCodigo });
    doc.text('Artículo', L.colNombre, y, { width: L.anchoNombre });
    doc.text('Pedido', L.colPedido, y, { width: L.anchoNum, align: 'center' });
    doc.text('Enviado', L.colEnviado, y, { width: L.anchoNum, align: 'center' });
    if (L.mostrarRecibido) {
        doc.text('Recibido', L.colRecibido, y, { width: L.anchoNum, align: 'center' });
    }
    doc.text('Diferencia', L.colDif, y, { width: L.anchoNum, align: 'center' });

    doc.y = y + 12;
    doc.moveTo(L.startX, doc.y).lineTo(L.startX + L.anchoUtil, doc.y).strokeColor('#999999').stroke();
    doc.moveDown(0.2);
}

function dibujarFilaTabla(doc, L, { codigo, nombre, pedido, enviado, recibido, negritaPedido }) {
    const y = doc.y;

    doc.font('Helvetica').fontSize(8).fillColor('#000000');
    doc.text(codigo || '—', L.colCodigo, y, { width: L.anchoCodigo });
    doc.text(nombre || '—', L.colNombre, y, { width: L.anchoNombre });
    doc.font(negritaPedido ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(String(pedido), L.colPedido, y, { width: L.anchoNum, align: 'center' });
    doc.font('Helvetica');
    doc.text(String(enviado), L.colEnviado, y, { width: L.anchoNum, align: 'center' });
    if (L.mostrarRecibido) {
        const textoRecibido = recibido === null || recibido === undefined ? '—' : String(recibido);
        doc.text(textoRecibido, L.colRecibido, y, { width: L.anchoNum, align: 'center' });
    }
    doc.text(String(pedido - enviado), L.colDif, y, { width: L.anchoNum, align: 'center' });

    doc.y = y + 14;
}

function bloqueTieneDocsSap(bloque) {
    return !!(bloque.sap_delivery_docentry || bloque.sap_delivery_docnum
        || bloque.sap_entry_docentry || bloque.sap_entry_docnum);
}

function alturaEstimadaBloque(bloque, { mostrarDocsSap, lineasExtra = 0 }) {
    const docsSap = mostrarDocsSap && bloqueTieneDocsSap(bloque) ? 30 : 0;
    return 40 + lineasExtra * 11 + docsSap + bloque.items.length * 14;
}

// Encabezado de un pedido: tienda (+ tipo), estado a la derecha, número de
// pedido y, si aplica, un recuadro con los documentos de SAP (Delivery y
// Entrada) — cada uno con su DocEntry y DocNum en su propia mitad, para que
// se lea de un vistazo. `detalles` son líneas extra de texto gris chico.
function dibujarEncabezadoBloque(doc, L, bloque, { mostrarEstado, mostrarDocsSap, detalles = [] }) {
    const anchoEstado = 120;
    const yTitulo = doc.y;
    const textoTitulo = bloque.label ? `${bloque.nombre_tienda} — ${bloque.label}` : bloque.nombre_tienda;
    const anchoTitulo = mostrarEstado ? L.anchoUtil - anchoEstado - 10 : L.anchoUtil;

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
    const altoTitulo = doc.heightOfString(textoTitulo, { width: anchoTitulo });
    doc.text(textoTitulo, L.startX, yTitulo, { width: anchoTitulo });

    if (mostrarEstado) {
        const etiqueta = etiquetaEstadoPedido(bloque.estado);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(etiqueta.color);
        doc.text(etiqueta.texto, L.startX + L.anchoUtil - anchoEstado, yTitulo, { width: anchoEstado, align: 'right' });
    }

    doc.y = yTitulo + altoTitulo + 2;
    doc.font('Helvetica').fontSize(8).fillColor('#666666');
    doc.text(`Pedido: ${bloque.numero_pedido}`, L.startX, doc.y, { width: L.anchoUtil });

    detalles.forEach((linea) => {
        doc.text(linea, L.startX, doc.y, { width: L.anchoUtil });
    });

    if (mostrarDocsSap && bloqueTieneDocsSap(bloque)) {
        doc.moveDown(0.3);
        const yBox = doc.y;
        const altoBox = 26;
        const mitad = L.anchoUtil / 2;

        doc.rect(L.startX, yBox, L.anchoUtil, altoBox).fillColor('#f3f4f6').fill();

        const dibujarDocumento = (x, titulo, docentry, docnum) => {
            doc.font('Helvetica-Bold').fontSize(7).fillColor('#374151');
            doc.text(titulo, x + 8, yBox + 5, { width: mitad - 16 });
            doc.font('Helvetica').fontSize(8).fillColor('#111827');
            const valor = docentry || docnum
                ? `DocEntry ${docentry ?? '—'}    DocNum ${docnum ?? '—'}`
                : 'Sin registro';
            doc.text(valor, x + 8, yBox + 14, { width: mitad - 16 });
        };

        dibujarDocumento(L.startX, 'ENTREGA EN SAP (DELIVERY)', bloque.sap_delivery_docentry, bloque.sap_delivery_docnum);
        dibujarDocumento(L.startX + mitad, 'ENTRADA EN SAP (ENTRY)', bloque.sap_entry_docentry, bloque.sap_entry_docnum);

        doc.y = yBox + altoBox;
    }

    doc.fillColor('#000000');
    doc.moveDown(0.4);
}

// Dibuja el PDF de generarReporteDetallePollo/generarReporteDetalleInsumos:
// carta vertical. Primero un resumen general con el total pedido/enviado
// por artículo entre TODAS las rutas (para saber de un vistazo cuánto hay
// que despachar ese día), y debajo el detalle: cada ruta como sección, y
// dentro un bloque por pedido igual que en dibujarPdfQrsRuta pero sin QR
// ni línea de firma — pensado para poder generarse en cualquier momento
// (incluso antes de procesar cualquier ruta).
// Si al menos un pedido ya está ENTREGADO/ENTREGADO_PARCIAL, se agregan la
// columna "Recibido", el estado de cada pedido y sus documentos de SAP.
function dibujarPdfDetallePorRuta(res, { fecha, rutasConBloques, nombreArchivo, descripcionFiltros, faltantes = [] }) {
    const doc = new PDFDocument({ margin: 40, size: 'LETTER' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    doc.pipe(res);

    const conEntregas = reporteTieneEntregas(rutasConBloques);
    const L = crearLayoutTabla(doc, conEntregas);
    const { startX, anchoUtil } = L;

    doc.fontSize(14).font('Helvetica-Bold').text('Detalle de Pedidos por Tienda', { align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#555555').text(`Fecha Entrega: ${fecha}`, { align: 'center' });
    if (descripcionFiltros) {
        doc.text(descripcionFiltros, { align: 'center' });
    }
    if (conEntregas) {
        doc.font('Helvetica-Bold').fillColor('#374151')
            .text(`Estado de los pedidos: ${resumenEstadosPedidos(rutasConBloques)}`, { align: 'center' });
    }
    doc.fillColor('#000000');
    doc.moveDown(0.8);

    // Resumen general: total por artículo entre todas las rutas, para saber
    // de un vistazo cuánto hay que despachar ese día.
    const resumenGeneral = calcularResumenGeneral(rutasConBloques);

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#2183AE');
    doc.text('Resumen General', startX);
    doc.fillColor('#000000');
    doc.moveTo(startX, doc.y + 2).lineTo(startX + anchoUtil, doc.y + 2).strokeColor('#2183AE').stroke();
    doc.moveDown(0.5);

    dibujarEncabezadoTabla(doc, L);

    resumenGeneral.forEach((total) => {
        if (doc.y + 14 > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
        }

        dibujarFilaTabla(doc, L, {
            codigo: total.codigo_producto,
            nombre: total.nombre_producto,
            pedido: total.cantidad_solicitada,
            enviado: total.cantidad_asignada,
            recibido: total.cantidad_recibida,
            negritaPedido: true
        });
    });

    if (resumenGeneral.length === 0) {
        doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
            .text('No hubo pedidos para esta fecha con esos filtros.', startX);
        doc.fillColor('#000000');
    }

    doc.addPage();

    rutasConBloques.forEach((ruta) => {
        if (doc.y + 40 > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
        }

        doc.font('Helvetica-Bold').fontSize(12).fillColor('#2183AE');
        doc.text(ruta.nombre_ruta, startX);
        doc.fillColor('#000000');
        doc.moveTo(startX, doc.y + 2).lineTo(startX + anchoUtil, doc.y + 2).strokeColor('#2183AE').stroke();
        doc.moveDown(0.5);

        ruta.bloques.forEach((bloque) => {
            if (doc.y + alturaEstimadaBloque(bloque, { mostrarDocsSap: conEntregas }) > doc.page.height - doc.page.margins.bottom) {
                doc.addPage();
            }

            dibujarEncabezadoBloque(doc, L, bloque, { mostrarEstado: conEntregas, mostrarDocsSap: conEntregas });
            dibujarEncabezadoTabla(doc, L);

            bloque.items.forEach((item) => {
                dibujarFilaTabla(doc, L, {
                    codigo: item.codigo_producto,
                    nombre: item.nombre_producto,
                    pedido: item.cantidad_solicitada,
                    enviado: item.cantidad_asignada,
                    recibido: item.cantidad_recibida
                });
            });

            doc.moveDown(0.6);
        });
    });

    // Tiendas asignadas a las rutas del reporte que no hicieron pedido esa
    // fecha, por división y por ruta. Sin rutas con pedidos ya estamos en una
    // hoja nueva (la del salto de arriba), así que no se agrega otra.
    if (rutasConBloques.length > 0) doc.addPage();

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#2183AE');
    doc.text('Tiendas sin pedido para esta fecha', startX);
    doc.fillColor('#000000');
    doc.moveTo(startX, doc.y + 2).lineTo(startX + anchoUtil, doc.y + 2).strokeColor('#2183AE').stroke();
    doc.moveDown(0.6);

    if (faltantes.length === 0) {
        doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
            .text('Todas las tiendas asignadas hicieron pedido para esta fecha.', startX);
        doc.fillColor('#000000');
    }

    faltantes.forEach((porDivision) => {
        if (doc.y + 40 > doc.page.height - doc.page.margins.bottom) doc.addPage();

        doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827');
        doc.text(`División ${porDivision.division}`, startX);
        doc.moveDown(0.3);

        porDivision.rutas.forEach((ruta) => {
            if (doc.y + 30 > doc.page.height - doc.page.margins.bottom) doc.addPage();

            doc.font('Helvetica-Bold').fontSize(9).fillColor('#2183AE');
            doc.text(`${ruta.nombre_ruta}  (${ruta.tiendas.length})`, startX + 8);

            doc.font('Helvetica').fontSize(9).fillColor('#000000');
            ruta.tiendas.forEach((tienda) => {
                if (doc.y + 12 > doc.page.height - doc.page.margins.bottom) doc.addPage();
                doc.text(`•  ${tienda}`, startX + 20);
            });

            doc.moveDown(0.4);
        });

        doc.moveDown(0.4);
    });

    doc.end();
}

// Dibuja el PDF de generarReporteEnTransito*: carta vertical, pedidos que ya
// se enviaron a SAP y siguen en ruta (sin importar la fecha), separados en
// secciones por división y ordenados por fecha requerida, ruta y tienda.
function dibujarPdfEnTransito(res, { secciones, tituloTipo, nombreArchivo }) {
    const doc = new PDFDocument({ margin: 40, size: 'LETTER' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    doc.pipe(res);

    const L = crearLayoutTabla(doc, false);
    const totalPedidos = secciones.reduce((acc, s) => acc + s.bloques.length, 0);

    doc.fontSize(14).font('Helvetica-Bold').text(`Pedidos en Tránsito — ${tituloTipo}`, { align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#555555')
        .text('Pedidos enviados a SAP que todavía no han sido entregados (todas las fechas)', { align: 'center' });
    doc.text(`Total: ${totalPedidos} pedido${totalPedidos !== 1 ? 's' : ''}`, { align: 'center' });
    doc.fillColor('#000000');
    doc.moveDown(0.8);

    secciones.forEach((seccion, indice) => {
        // Cada división arranca en hoja nueva para poder separarlas físicamente.
        if (indice > 0) doc.addPage();

        doc.font('Helvetica-Bold').fontSize(13).fillColor('#2183AE');
        doc.text(`División ${seccion.division}  (${seccion.bloques.length} pedido${seccion.bloques.length !== 1 ? 's' : ''})`, L.startX);
        doc.fillColor('#000000');
        doc.moveTo(L.startX, doc.y + 2).lineTo(L.startX + L.anchoUtil, doc.y + 2).strokeColor('#2183AE').stroke();
        doc.moveDown(0.6);

        seccion.bloques.forEach((bloque) => {
            const detalles = [
                bloque.muelle
                    ? `Despachado desde el muelle: ${bloque.muelle}   ·   Ruta: ${bloque.nombre_ruta}`
                    : `Ruta: ${bloque.nombre_ruta}`,
                `Fecha requerida: ${bloque.fecha_requerida || '—'}   ·   Piloto: ${bloque.piloto_nombre || 'Sin asignar'}   ·   Camión: ${bloque.camion_placa || 'Sin asignar'}`
            ];

            if (doc.y + alturaEstimadaBloque(bloque, { mostrarDocsSap: false, lineasExtra: detalles.length }) > doc.page.height - doc.page.margins.bottom) {
                doc.addPage();
            }

            dibujarEncabezadoBloque(doc, L, bloque, { mostrarEstado: false, mostrarDocsSap: false, detalles });
            dibujarEncabezadoTabla(doc, L);

            bloque.items.forEach((item) => {
                dibujarFilaTabla(doc, L, {
                    codigo: item.codigo_producto,
                    nombre: item.nombre_producto,
                    pedido: item.cantidad_solicitada,
                    enviado: item.cantidad_asignada
                });
            });

            doc.moveDown(0.6);
        });
    });

    doc.end();
}

// Muelles de Pollo (whs_code_origen de tbl_catalogo_rutas_pollo). Insumos no
// tiene muelles: todas sus rutas salen de la bodega "01".
const MUELLES_POLLO = { 'RAS-002': 'Central', 'RAS-003': 'Zacapa', 'RAS-004': 'Xela' };

// Interpreta el parámetro `muelles` ("RAS-002,RAS-004"). null = todos.
function parsearMuelles(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') return null;

    const muelles = [...new Set(String(valor).split(',').map(m => m.trim()).filter(Boolean))];

    if (muelles.length === 0 || muelles.some(m => !MUELLES_POLLO[m])) {
        throw new Error(`muelles debe ser una lista de: ${Object.keys(MUELLES_POLLO).join(', ')}`);
    }

    return muelles;
}

function describirFiltrosReporte(divisiones, muelles) {
    const partes = [];

    partes.push(divisiones ? `División ${divisiones.join(' y ')}` : 'Todas las divisiones');

    if (muelles) {
        partes.push(`Muelle${muelles.length !== 1 ? 's' : ''}: ${muelles.map(m => MUELLES_POLLO[m]).join(', ')}`);
    }

    return partes.join('   ·   ');
}

function parsearFormato(valor) {
    const formato = String(valor || 'pdf').trim().toLowerCase();

    if (!['pdf', 'excel'].includes(formato)) {
        throw new Error("formato debe ser 'pdf' o 'excel'");
    }

    return formato;
}

async function enviarLibroExcel(res, libro, nombreArchivo) {
    res.setHeader('Content-Type', MIME_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    await libro.xlsx.write(res);
    res.end();
}

// Tiendas asignadas a las rutas del reporte (activas y con la tienda vigente
// en esa fecha), dentro de la división y muelle pedidos, que NO tienen ningún
// pedido para la fecha. Devuelve [{ division, rutas: [{ nombre_ruta, tiendas }] }].
// Un pedido de cualquier tipo del reporte cuenta (en Insumos, Insumos o
// Activo Fijo): la tienda sale en la lista solo si no aparece en el reporte.
async function calcularTiendasSinPedido({ esPollo, fecha, divisiones, muelles }) {
    const CatalogoRutaModel = esPollo ? CatalogoRutaPolloModel : CatalogoRutaInsumosModel;
    const TiendaRutaModel = esPollo ? TiendaRutaPolloModel : TiendaRutaInsumosModel;
    const tiposPedido = esPollo ? ['POLLO'] : TIPOS_INSUMOS_Y_ACTIVO_FIJO;
    const divisionesAlcance = divisiones || DIVISIONES_VALIDAS;

    const whereRutas = { activo: true };

    if (esPollo && muelles) {
        whereRutas.whs_code_origen = { [Op.in]: muelles };
    }

    const rutas = await CatalogoRutaModel.findAll({
        where: whereRutas,
        attributes: ['id', 'nombre_ruta'],
        raw: true
    });

    if (rutas.length === 0) return [];

    const inicioDia = new Date(`${fecha}T00:00:00`);
    const finDia = new Date(`${fecha}T23:59:59.999`);

    const asignaciones = await TiendaRutaModel.findAll({
        where: {
            ruta_id: { [Op.in]: rutas.map(r => r.id) },
            fecha_asignacion: { [Op.lte]: finDia },
            [Op.or]: [{ fecha_fin_asignacion: null }, { fecha_fin_asignacion: { [Op.gte]: inicioDia } }]
        },
        attributes: ['ruta_id', 'id_tienda_simphony', 'nombre_tienda'],
        raw: true
    });

    const divisionPorTienda = await obtenerMapaDivisionPorTienda();
    const enAlcance = asignaciones.filter(a => divisionesAlcance.includes(divisionPorTienda.get(a.id_tienda_simphony)));

    if (enAlcance.length === 0) return [];

    const conPedido = await PedidoPosCabeceraModel.findAll({
        where: {
            tipo_pedido: { [Op.in]: tiposPedido },
            fecha_requerida: fecha,
            codigo_tienda: { [Op.in]: [...new Set(enAlcance.map(a => a.id_tienda_simphony))] }
        },
        attributes: ['codigo_tienda'],
        raw: true
    });

    const codigosConPedido = new Set(conPedido.map(c => c.codigo_tienda));
    const nombreRuta = new Map(rutas.map(r => [r.id, r.nombre_ruta]));
    const porDivision = new Map();
    const vistos = new Set();

    for (const a of enAlcance) {
        if (codigosConPedido.has(a.id_tienda_simphony)) continue;

        const clave = `${a.ruta_id}::${a.id_tienda_simphony}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);

        const division = divisionPorTienda.get(a.id_tienda_simphony);
        if (!porDivision.has(division)) porDivision.set(division, new Map());

        const porRuta = porDivision.get(division);
        if (!porRuta.has(a.ruta_id)) porRuta.set(a.ruta_id, []);
        porRuta.get(a.ruta_id).push(a.nombre_tienda || a.id_tienda_simphony);
    }

    return [...porDivision.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([division, porRuta]) => ({
            division,
            rutas: [...porRuta.entries()]
                .map(([rutaId, tiendas]) => ({
                    nombre_ruta: nombreRuta.get(rutaId) || 'Sin nombre',
                    tiendas: tiendas.sort((x, y) => x.localeCompare(y))
                }))
                .sort((x, y) => x.nombre_ruta.localeCompare(y.nombre_ruta))
        }));
}

// Arma la respuesta del reporte de pedidos por fecha, en PDF o Excel: mismos
// datos (resumen general, detalle y tiendas sin pedido) en los dos formatos.
async function responderReporteDetalle(res, { formato, fecha, cabeceras, faltantes, descripcionFiltros, nombreBase }) {
    if (cabeceras.length === 0 && faltantes.length === 0) {
        return res.status(404).json({
            error: 'No hay pedidos ni tiendas asignadas para esos filtros y esta fecha',
            success: false
        });
    }

    const rutasConBloques = agruparBloquesPorRuta(construirBloquesPedido(cabeceras));

    if (formato === 'excel') {
        const libro = construirExcelDetalle({
            fecha,
            descripcionFiltros,
            rutasConBloques,
            faltantes,
            resumenGeneral: calcularResumenGeneral(rutasConBloques),
            conEntregas: reporteTieneEntregas(rutasConBloques),
            resumenEstados: resumenEstadosPedidos(rutasConBloques),
            etiquetaEstado: etiquetaEstadoPedido
        });

        return enviarLibroExcel(res, libro, `${nombreBase}.xlsx`);
    }

    return dibujarPdfDetallePorRuta(res, {
        fecha,
        rutasConBloques,
        descripcionFiltros,
        faltantes,
        nombreArchivo: `${nombreBase}.pdf`
    });
}

// GET /pedido/generarReporteDetallePollo?fecha=...&division=1,2&muelles=RAS-002,RAS-003&formato=pdf|excel
// Reporte de las rutas de Pollo para una fecha, sin importar el estado ni
// si ya se procesó algo — solo el detalle de lo que pide cada tienda,
// agrupado por ruta. Se puede generar en cualquier momento, incluso antes de
// tomar el candado de cualquier ruta.
// division (opcional, "1", "2" o "1,2") filtra por división de la tienda;
// muelles (opcional) filtra por el muelle de la ruta — si se manda, los
// pedidos que aún no tienen ruta quedan fuera porque no tienen muelle.
async function generarReporteDetallePollo(req, res) {
    const { fecha } = req.query;

    if (!fecha) {
        return res.status(400).json({ error: 'fecha es requerida', success: false });
    }

    let divisiones;
    let muelles;
    let formato;

    try {
        divisiones = parsearDivisiones(req.query.division);
        muelles = parsearMuelles(req.query.muelles);
        formato = parsearFormato(req.query.formato);
    } catch (error) {
        return res.status(400).json({ error: error.message, success: false });
    }

    try {
        const where = { tipo_pedido: 'POLLO', fecha_requerida: fecha };

        if (divisiones) {
            where.codigo_tienda = { [Op.in]: await obtenerCodigosTiendaPorDivision(divisiones) };
        }

        if (muelles) {
            const rutasDeMuelles = await CatalogoRutaPolloModel.findAll({
                where: { whs_code_origen: { [Op.in]: muelles } },
                attributes: ['id'],
                raw: true
            });

            where.ruta_id = { [Op.in]: rutasDeMuelles.map(r => r.id) };
        }

        const cabeceras = await PedidoPosCabeceraModel.findAll({
            where,
            include: [{ model: PedidoPosDetalleModel, as: 'detalle' }],
            order: [['nombre_ruta', 'ASC'], ['nombre_tienda', 'ASC']]
        });

        const faltantes = await calcularTiendasSinPedido({ esPollo: true, fecha, divisiones, muelles });

        return await responderReporteDetalle(res, {
            formato,
            fecha,
            cabeceras,
            faltantes,
            descripcionFiltros: describirFiltrosReporte(divisiones, muelles),
            nombreBase: `detalle_pedidos_pollo_${fecha}`
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al generar el reporte',
            details: error.message,
            success: false
        });
    }
}

// GET /pedido/generarReporteDetalleInsumos?fecha=...&division=1,2
// Igual que el de Pollo, pero sin muelles (Insumos no tiene).
async function generarReporteDetalleInsumos(req, res) {
    const { fecha } = req.query;

    if (!fecha) {
        return res.status(400).json({ error: 'fecha es requerida', success: false });
    }

    let divisiones;
    let formato;

    try {
        divisiones = parsearDivisiones(req.query.division);
        formato = parsearFormato(req.query.formato);
    } catch (error) {
        return res.status(400).json({ error: error.message, success: false });
    }

    try {
        const where = { tipo_pedido: { [Op.in]: TIPOS_INSUMOS_Y_ACTIVO_FIJO }, fecha_requerida: fecha };

        if (divisiones) {
            where.codigo_tienda = { [Op.in]: await obtenerCodigosTiendaPorDivision(divisiones) };
        }

        const cabeceras = await PedidoPosCabeceraModel.findAll({
            where,
            include: [{ model: PedidoPosDetalleModel, as: 'detalle' }],
            order: [['nombre_ruta', 'ASC'], ['nombre_tienda', 'ASC']]
        });

        const faltantes = await calcularTiendasSinPedido({ esPollo: false, fecha, divisiones, muelles: null });

        return await responderReporteDetalle(res, {
            formato,
            fecha,
            cabeceras,
            faltantes,
            descripcionFiltros: describirFiltrosReporte(divisiones, null),
            nombreBase: `detalle_pedidos_insumos_${fecha}`
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al generar el reporte',
            details: error.message,
            success: false
        });
    }
}

// Pedidos EN_TRANSITO (enviados a SAP, aún sin entregar) de cualquier fecha,
// separados por división. Si se manda `division` (una sola, p. ej. para un
// usuario lectura_division) solo salen las tiendas de esa división; si no,
// salen las divisiones 1 y 2, cada una en su sección y en ese orden.
async function generarReporteEnTransito(req, res, { tiposPedido, tituloTipo, prefijoArchivo, conMuelle = false }) {
    let divisiones;
    let formato;

    try {
        divisiones = parsearDivisiones(req.query.division) || DIVISIONES_VALIDAS;
        formato = parsearFormato(req.query.formato);
    } catch (error) {
        return res.status(400).json({ error: error.message, success: false });
    }

    try {
        const [codigosTienda, divisionPorTienda] = await Promise.all([
            obtenerCodigosTiendaPorDivision(divisiones),
            obtenerMapaDivisionPorTienda()
        ]);

        const cabeceras = await PedidoPosCabeceraModel.findAll({
            where: {
                tipo_pedido: { [Op.in]: tiposPedido },
                estado: 'EN_TRANSITO',
                codigo_tienda: { [Op.in]: codigosTienda }
            },
            include: [{ model: PedidoPosDetalleModel, as: 'detalle' }],
            order: [['fecha_requerida', 'ASC'], ['nombre_ruta', 'ASC'], ['nombre_tienda', 'ASC']]
        });

        if (cabeceras.length === 0) {
            return res.status(404).json({ error: 'No hay pedidos en tránsito', success: false });
        }

        // El muelle que despachó el pedido es el de su ruta (solo Pollo tiene
        // muelles; en Insumos todo sale de la bodega "01").
        const muellePorRuta = new Map();

        if (conMuelle) {
            const rutaIds = [...new Set(cabeceras.map(c => c.ruta_id).filter(Boolean))];
            const rutas = await CatalogoRutaPolloModel.findAll({
                where: { id: { [Op.in]: rutaIds } },
                attributes: ['id', 'whs_code_origen'],
                raw: true
            });

            rutas.forEach(r => muellePorRuta.set(r.id, r.whs_code_origen));
        }

        const bloquesPorDivision = new Map(divisiones.map(d => [d, []]));

        for (const bloque of construirBloquesPedido(cabeceras)) {
            if (conMuelle) {
                const codigoMuelle = muellePorRuta.get(bloque.ruta_id);
                bloque.muelle = codigoMuelle
                    ? `${MUELLES_POLLO[codigoMuelle] || codigoMuelle} (${codigoMuelle})`
                    : 'Sin muelle';
            }

            const division = divisionPorTienda.get(bloque.codigo_tienda);
            if (bloquesPorDivision.has(division)) {
                bloquesPorDivision.get(division).push(bloque);
            }
        }

        const secciones = [...bloquesPorDivision.entries()]
            .filter(([, bloques]) => bloques.length > 0)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([division, bloques]) => ({ division, bloques }));

        if (secciones.length === 0) {
            return res.status(404).json({ error: 'No hay pedidos en tránsito', success: false });
        }

        if (formato === 'excel') {
            const libro = construirExcelEnTransito({ secciones, tituloTipo, conMuelle });
            return await enviarLibroExcel(res, libro, `${prefijoArchivo}_en_transito.xlsx`);
        }

        dibujarPdfEnTransito(res, {
            secciones,
            tituloTipo,
            nombreArchivo: `${prefijoArchivo}_en_transito.pdf`
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al generar el reporte de pedidos en tránsito',
            details: error.message,
            success: false
        });
    }
}

// GET /pedido/generarReporteEnTransitoPollo?division=1
function generarReporteEnTransitoPollo(req, res) {
    return generarReporteEnTransito(req, res, {
        tiposPedido: ['POLLO'],
        tituloTipo: 'Pollo',
        prefijoArchivo: 'pedidos_pollo',
        conMuelle: true
    });
}

// GET /pedido/generarReporteEnTransitoInsumos?division=1
function generarReporteEnTransitoInsumos(req, res) {
    return generarReporteEnTransito(req, res, {
        tiposPedido: TIPOS_INSUMOS_Y_ACTIVO_FIJO,
        tituloTipo: 'Insumos y Activo Fijo',
        prefijoArchivo: 'pedidos_insumos'
    });
}

// GET /pedido/generarQrsRutaPollo?ruta_id=...&fecha=...
async function generarQrsRutaPollo(req, res) {
    const { ruta_id, fecha } = req.query;

    if (!ruta_id || !fecha) {
        return res.status(400).json({ error: 'ruta_id y fecha son requeridos', success: false });
    }

    try {
        const ruta = await CatalogoRutaPolloModel.findByPk(ruta_id);

        if (!ruta) {
            return res.status(404).json({ error: 'Ruta no encontrada', success: false });
        }

        const cabeceras = await PedidoPosCabeceraModel.findAll({
            where: { tipo_pedido: 'POLLO', fecha_requerida: fecha, ruta_id },
            include: [{ model: PedidoPosDetalleModel, as: 'detalle' }],
            order: [['nombre_tienda', 'ASC']]
        });

        if (cabeceras.length === 0) {
            return res.status(404).json({ error: 'No hay pedidos para esta ruta y fecha', success: false });
        }

        const bloques = await construirBloquesQr(cabeceras);

        dibujarPdfQrsRuta(res, {
            nombreRuta: ruta.nombre_ruta,
            fecha,
            bloques,
            nombreArchivo: `qrs_ruta_pollo_${ruta.nombre_ruta || ruta_id}_${fecha}.pdf`
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al generar los códigos QR',
            details: error.message,
            success: false
        });
    }
}

// GET /pedido/generarQrsRutaInsumos?ruta_id=...&fecha=...
async function generarQrsRutaInsumos(req, res) {
    const { ruta_id, fecha } = req.query;

    if (!ruta_id || !fecha) {
        return res.status(400).json({ error: 'ruta_id y fecha son requeridos', success: false });
    }

    try {
        const ruta = await CatalogoRutaInsumosModel.findByPk(ruta_id);

        if (!ruta) {
            return res.status(404).json({ error: 'Ruta no encontrada', success: false });
        }

        const cabeceras = await PedidoPosCabeceraModel.findAll({
            where: { tipo_pedido: { [Op.in]: TIPOS_INSUMOS_Y_ACTIVO_FIJO }, fecha_requerida: fecha, ruta_id },
            include: [{ model: PedidoPosDetalleModel, as: 'detalle' }],
            order: [['nombre_tienda', 'ASC']]
        });

        if (cabeceras.length === 0) {
            return res.status(404).json({ error: 'No hay pedidos para esta ruta y fecha', success: false });
        }

        const bloques = await construirBloquesQr(cabeceras);

        dibujarPdfQrsRuta(res, {
            nombreRuta: ruta.nombre_ruta,
            fecha,
            bloques,
            nombreArchivo: `qrs_ruta_insumos_${ruta.nombre_ruta || ruta_id}_${fecha}.pdf`
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al generar los códigos QR',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// Arma el snapshot de líneas (por artículo, sumando entre tiendas) para
// guardar en el ticket. Mismo criterio que usa el PDF y la transferencia
// a SAP (solo líneas con cantidad_asignada > 0).
// ------------------------------------------------------------
async function armarLineasTicket(tipoPedido, rutaId, fecha) {
    const lineasDetalle = await PedidoPosDetalleModel.findAll({
        attributes: [
            'codigo_producto',
            [fn('SUM', col('cantidad_asignada')), 'cantidad_total'],
            [fn('MAX', col('descripcion_producto')), 'descripcion_producto'],
            [fn('MAX', col('unidad_medida')), 'unidad_medida']
        ],
        include: [{
            model: PedidoPosCabeceraModel,
            as: 'cabecera',
            attributes: [],
            where: { tipo_pedido: { [Op.in]: Array.isArray(tipoPedido) ? tipoPedido : [tipoPedido] }, fecha_requerida: fecha, ruta_id: rutaId }
        }],
        where: { cantidad_asignada: { [Op.gt]: 0 } },
        group: ['codigo_producto'],
        raw: true
    });

    return lineasDetalle.map(l => ({
        codigo_producto: l.codigo_producto,
        descripcion_producto: l.descripcion_producto,
        unidad_medida: l.unidad_medida,
        cantidad: Number(l.cantidad_total)
    }));
}

// ------------------------------------------------------------
// POST: el administrador firma/autoriza el ticket desde el portal.
// Crea (o actualiza, si ya existía) el registro en tbl_tickets_traslado
// con estado PENDIENTE_FIRMA_PILOTO — desde ahí queda disponible para
// que la app móvil se lo muestre al piloto.
// ------------------------------------------------------------
async function firmarTicketPollo(req, res) {
    const { ruta_id, fecha } = req.body;
    const id_usuario = req.user && req.user.id_usuario;
    const nombre_usuario = (req.user && (req.user.nombre || req.user.id_usuario)) || null;

    if (!ruta_id || !fecha) {
        return res.status(400).json({ error: 'ruta_id y fecha son requeridos', success: false });
    }

    try {
        const ruta = await CatalogoRutaPolloModel.findByPk(ruta_id);

        if (!ruta) {
            return res.status(404).json({ error: 'Ruta no encontrada', success: false });
        }

        const cabecera = await PedidoPosCabeceraModel.findOne({
            where: { tipo_pedido: 'POLLO', fecha_requerida: fecha, ruta_id, estado: 'EN_TRANSITO' }
        });

        if (!cabecera) {
            return res.status(400).json({
                error: 'Esta ruta no está en tránsito para esta fecha, no se puede firmar el ticket',
                success: false
            });
        }

        const lineas = await armarLineasTicket('POLLO', ruta_id, fecha);
        const ahora = new Date();

        const datosTicket = {
            nombre_ruta: cabecera.nombre_ruta,
            whs_origen: ruta.whs_code_origen,
            whs_destino: ruta.whs_code_destino,
            camion_placa: cabecera.camion_placa,
            piloto_id: cabecera.piloto_id,
            piloto_nombre: cabecera.piloto_nombre,
            sap_docnum: cabecera.sap_docnum,
            lineas,
            estado: 'PENDIENTE_FIRMA_PILOTO',
            firmado_admin_por: id_usuario,
            firmado_admin_nombre: nombre_usuario,
            firmado_admin_fecha: ahora,
            actualizado_en: ahora
        };

        const [ticket, created] = await TicketTrasladoModel.findOrCreate({
            where: { tipo_pedido: 'POLLO', ruta_id, fecha },
            defaults: { ...datosTicket, tipo_pedido: 'POLLO', ruta_id, fecha, creado_en: ahora }
        });

        if (!created) {
            await ticket.update(datosTicket);
        }

        return res.json({ success: true, ticket_id: ticket.id, estado: ticket.estado });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al firmar el ticket',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// POST: igual que firmarTicketPollo, pero para INSUMOS.
// ------------------------------------------------------------
async function firmarTicketInsumos(req, res) {
    const { ruta_id, fecha } = req.body;
    const id_usuario = req.user && req.user.id_usuario;
    const nombre_usuario = (req.user && (req.user.nombre || req.user.id_usuario)) || null;

    if (!ruta_id || !fecha) {
        return res.status(400).json({ error: 'ruta_id y fecha son requeridos', success: false });
    }

    try {
        const ruta = await CatalogoRutaInsumosModel.findByPk(ruta_id);

        if (!ruta) {
            return res.status(404).json({ error: 'Ruta no encontrada', success: false });
        }

        const cabecera = await PedidoPosCabeceraModel.findOne({
            where: { tipo_pedido: { [Op.in]: TIPOS_INSUMOS_Y_ACTIVO_FIJO }, fecha_requerida: fecha, ruta_id, estado: 'EN_TRANSITO' }
        });

        if (!cabecera) {
            return res.status(400).json({
                error: 'Esta ruta no está en tránsito para esta fecha, no se puede firmar el ticket',
                success: false
            });
        }

        const lineas = await armarLineasTicket(TIPOS_INSUMOS_Y_ACTIVO_FIJO, ruta_id, fecha);
        const ahora = new Date();

        const datosTicket = {
            nombre_ruta: cabecera.nombre_ruta,
            whs_origen: ruta.whs_code_origen,
            whs_destino: ruta.whs_code_destino,
            camion_placa: cabecera.camion_placa,
            piloto_id: cabecera.piloto_id,
            piloto_nombre: cabecera.piloto_nombre,
            sap_docnum: cabecera.sap_docnum,
            lineas,
            estado: 'PENDIENTE_FIRMA_PILOTO',
            firmado_admin_por: id_usuario,
            firmado_admin_nombre: nombre_usuario,
            firmado_admin_fecha: ahora,
            actualizado_en: ahora
        };

        const [ticket, created] = await TicketTrasladoModel.findOrCreate({
            where: { tipo_pedido: 'INSUMOS', ruta_id, fecha },
            defaults: { ...datosTicket, tipo_pedido: 'INSUMOS', ruta_id, fecha, creado_en: ahora }
        });

        if (!created) {
            await ticket.update(datosTicket);
        }

        return res.json({ success: true, ticket_id: ticket.id, estado: ticket.estado });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al firmar el ticket',
            details: error.message,
            success: false
        });
    }
}

module.exports = {
    getAllPedidosEncabezado,
    getPedidoDetalleByEncabezado,
    createPedido,
    crearPedidoActivoFijo,
    buscarPedidosActivoFijo,
    validarYObtenerPedido,
    subirYProcesarArchivosPedidoPos,
    procesarArchivoPedidoPos,
    guardarPedidoPos,
    agruparLineasPorPedido,
    getPedidosPos,
    getPedidosPorDivision,
    getAsignacionesTransporte,
    asignarTransporte,
    trasladarPiloto,
    getComparativoStockPollo,
    getComparativoStockInsumos,
    enviarTransferenciaPollo,
    enviarTransferenciaInsumos,
    generarTicketPollo,
    generarTicketInsumos,
    generarResumenRutaInsumos,
    generarResumenRutaPollo,
    generarQrsRutaPollo,
    generarQrsRutaInsumos,
    generarReporteDetallePollo,
    generarReporteDetalleInsumos,
    generarReporteEnTransitoPollo,
    generarReporteEnTransitoInsumos,
    firmarTicketPollo,
    firmarTicketInsumos,
    guardarAsignacionCantidades
}