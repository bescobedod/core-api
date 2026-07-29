const initPedidoEncabezadoModel = require('../../models/core/tbl_pedido_encabezado.model');
const initPedidoDetalleModel = require('../../models/core/tbl_pedido_detalle.model');
const initTiendaModel = require('../../models/pdv/tTienda.model');
const UsersModel = require('../../models/pioapp/users.model');
const { obtenerProductosData } = require('../../integrations/sap/sapClient');
const sequelizeInit = require('../../configuration/db');
const { Op } = require('sequelize');
const PedidoPosCabeceraModel = require('../../models/core/tbl_pedido_pos_cabecera.model');
const PedidoPosDetalleModel = require('../../models/core/tbl_pedido_pos_detalle.model');
const PedidoPosHistorialModel = require('../../models/core/tbl_pedido_pos_historial.model');
const CatalogoRutaModel = require('../../models/core/tbl_catalogo_ruta.model');
const TiendaRutaModel = require('../../models/core/tbl_tienda_ruta.model');

PedidoPosCabeceraModel.hasMany(PedidoPosDetalleModel, { foreignKey: 'pedido_id', as: 'detalle' });
PedidoPosDetalleModel.belongsTo(PedidoPosCabeceraModel, { foreignKey: 'pedido_id', as: 'cabecera' });
 
PedidoPosCabeceraModel.hasMany(PedidoPosHistorialModel, { foreignKey: 'pedido_id', as: 'historial' });
PedidoPosHistorialModel.belongsTo(PedidoPosCabeceraModel, { foreignKey: 'pedido_id', as: 'cabecera' });
 
CatalogoRutaModel.hasMany(TiendaRutaModel, { foreignKey: 'ruta_id', as: 'tiendas' });
TiendaRutaModel.belongsTo(CatalogoRutaModel, { foreignKey: 'ruta_id', as: 'ruta' });
 
PedidoPosCabeceraModel.belongsTo(CatalogoRutaModel, { foreignKey: 'ruta_id', as: 'ruta' });

// TODO: confirmar el nombre real de la clave de conexión a PDV en configDatabase
// (aquí se asume 'PDV', ajustar si en configDatabase.js tiene otro nombre)
const PDV_CONNECTION = 'PDV';

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

// async function getPedidosByTipoYFecha(req, res) {
//     const { }
// }

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
        let codigo_tienda = delivery_location_id || null;
        let nombre_tienda = null;
        let codigo_empresa = null;
        let codigo_bodega = null;
        let estado_inicial = 'RECIBIDO';

        if (delivery_location_id) {
            const tienda = await TiendaModel.findOne({
                where: { StoreNumberSimphony: delivery_location_id }
            });

            if (tienda) {
                codigo_tienda = tienda.tienda;
                nombre_tienda = tienda.tda_nombre;
                codigo_empresa = tienda.empresa;
                codigo_bodega = tienda.whsCode;
            } else {
                estado_inicial = 'PENDIENTE_ENRIQUECIMIENTO';
            }
        } else {
            estado_inicial = 'PENDIENTE_ENRIQUECIMIENTO';
        }

        // vendor_id clasifica el TIPO de pedido, no identifica bodega ni empresa:
        // '1004' (AVICOLA GUADALUPE) = POLLO, cualquier otro valor = INSUMOS
        const tipo_pedido = vendor_id ? (vendor_id === '1004' ? 'POLLO' : 'INSUMOS') : null;

        // nombre_bodega: SAP (Warehouses/OWHS) no trae el nombre en tTienda,
        // solo el WhsCode. Queda pendiente resolverlo si se necesita mostrar
        // (ej. consultando Service Layer al momento de mostrar en el portal).
        const nombre_bodega = null;

        let ruta_id = null;
        let nombre_ruta = null;

        if (codigo_tienda) {
            const asignacionRuta = await TiendaRutaModel.findOne({
                where: {
                    codigo_tienda: codigo_tienda,
                    fecha_fin_asignacion: null
                },
                include: [{ model: CatalogoRutaModel, as: 'ruta' }],
                transaction: t
            });

            if (asignacionRuta && asignacionRuta.ruta) {
                ruta_id = asignacionRuta.ruta.id;
                nombre_ruta = asignacionRuta.ruta.nombre_ruta;
            }
        }

        const ahora = new Date();

        const cabecera = await PedidoPosCabeceraModel.create({
            codigo_empresa: codigo_empresa,
            codigo_tienda: codigo_tienda,
            numero_pedido: numero_pedido,
            fecha_pedido: formatearFechaOracle(fecha_pedido),
            hora_pedido: hora_pedido,
            nombre_tienda: nombre_tienda,
            codigo_bodega: codigo_bodega,
            tipo_pedido: tipo_pedido,
            codigo_bodega_simphony: vendor_id || null,
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
            codigo_producto: linea.item_no,
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
        const whereCabecera = { tipo_pedido };

        if (codigo_bodega) {
            whereCabecera.codigo_bodega = codigo_bodega;
        }

        if (codigo_tienda) {
            whereCabecera.codigo_tienda = { [Op.iLike]: `%${codigo_tienda}%` };
        }

        if (ruta_id) {
            whereCabecera.ruta_id = ruta_id;
        }

        const pedidosConFecha = await PedidoPosDetalleModel.findAll({
            attributes: ['pedido_id'],
            where: { fecha_requerida },
            group: ['pedido_id'],
            raw: true
        });

        whereCabecera.id = { [Op.in]: pedidosConFecha.map(p => p.pedido_id) };

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

            rutasMap.get(claveRuta).tiendas.push({
                pedido_id: p.id,
                codigo_tienda: p.codigo_tienda,
                nombre_tienda: p.nombre_tienda,
                codigo_empresa: p.codigo_empresa,
                codigo_bodega: p.codigo_bodega,
                numero_pedido: p.numero_pedido,
                fecha_pedido: p.fecha_pedido,
                estado: p.estado,
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
        }

        return res.json({
            success: true,
            tipo_pedido: tipo_pedido,
            fecha_requerida: fecha_requerida,
            rutas: Array.from(rutasMap.values())
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener pedidos POS',
            details: error.message,
            success: false
        });
    }
}

module.exports = {
    getAllPedidosEncabezado,
    getPedidoDetalleByEncabezado,
    createPedido,
    validarYObtenerPedido,
    subirYProcesarArchivosPedidoPos,
    procesarArchivoPedidoPos,
    guardarPedidoPos,
    agruparLineasPorPedido,
    getPedidosPos
}