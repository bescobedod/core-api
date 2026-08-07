const initPedidoEncabezadoModel = require('../../models/core/tbl_pedido_encabezado.model');
const initPedidoDetalleModel = require('../../models/core/tbl_pedido_detalle.model');
const initTiendaModel = require('../../models/pdv/tTienda.model');
const UsersModel = require('../../models/pioapp/users.model');
const { obtenerProductosData, consultarStockPollo, consultarStockInsumos, crearTransferenciaPollo, crearTransferenciaInsumos } = require('../../integrations/sap/sapClient');
const CatalogoRutaPolloModel = require('../../models/core/tbl_catalogo_rutas_pollo.model');
const BloqueoRutaPolloModel = require('../../models/core/tbl_bloqueo_ruta_pollo.model');
const CatalogoRutaInsumosModel = require('../../models/core/tbl_catalogo_rutas_insumos.model');
const BloqueoRutaInsumosModel = require('../../models/core/tbl_bloqueo_ruta_insumos.model');
const sequelizeInit = require('../../configuration/db');
const { Op, fn, col } = require('sequelize');
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

// ============================================================
// servicio que recibe/procesa los pedidos POS de Oracle Simphony (SFTP -> middleware -> Core)
// ============================================================

function formatearFechaOracle(valor) {
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
        vendor_id: campos[1],
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

        const esAvicolaGuadalupe = (vendor_name || '').trim().toUpperCase().includes('AVICOLA GUADALUPE');
        const tipo_pedido = vendor_name ? (esAvicolaGuadalupe ? 'POLLO' : 'INSUMOS') : null;
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
    const contenido = buffer.toString('latin1');
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
// obtiene los pedidos POS ya guardados, agrupados por ruta -> tienda,
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
        fecha_requerida = manana.toISOString().split('T')[0];
    }

    try {
        const whereCabecera = { tipo_pedido, fecha_requerida };

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
        }

        return res.json({
            success: true,
            tipo_pedido: tipo_pedido,
            fecha_requerida: fecha_requerida,
            rutas: Array.from(rutasMap.values()).map(ruta => {
                const estadosUnicos = [...new Set(ruta.tiendas.map(t => t.estado))];
                const estado_general = estadosUnicos.length === 1 ? estadosUnicos[0] : 'MIXTO';
                const pedidoConDoc = ruta.tiendas.find(t => t.sap_docnum);
                const sap_docnum = pedidoConDoc ? pedidoConDoc.sap_docnum : null;
                const sap_docentry = pedidoConDoc ? pedidoConDoc.sap_docentry : null;

                return { ...ruta, estado_general, sap_docnum, sap_docentry };
            })
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al obtener pedidos POS',
            details: error.message,
            success: false
        });
    }
}

// ------------------------------------------------------------
// Obtiene las asignaciones de camión/piloto por ruta para una fecha
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
// Asigna (crea o actualiza) camión + piloto para una ruta en una
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

        return res.json({ success: true, asignacion });
    } catch (error) {
        await t.rollback();

        if (error.name === 'SequelizeUniqueConstraintError') {
            const campo = (error.errors && error.errors[0] && error.errors[0].path) || '';
            let mensaje = 'Ese camión o piloto ya está asignado a otra ruta este día';

            if (campo.includes('camion')) mensaje = 'Ese camión ya está asignado a otra ruta este día';
            if (campo.includes('piloto')) mensaje = 'Ese piloto ya está asignado a otra ruta este día';

            return res.status(409).json({ error: mensaje, success: false });
        }

        return res.status(500).json({
            error: 'Error al asignar transporte',
            details: error.message,
            success: false
        });
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
            const stockDisponible = stock ? Number(stock.stock_disponible) : 0;

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
// Comparativo de stock de INSUMOS, escopado por ruta (igual que
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
                where: { tipo_pedido: 'INSUMOS', fecha_requerida: fecha, ruta_id }
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
            const stockDisponible = stock ? Number(stock.stock_disponible) : 0;

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
// Guarda el resultado final de la asignación de cantidades por línea
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
// Envía la transferencia de inventario (bodega -> camión) a SAP
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

        const lineasSap = lineasDetalle.map(l => ({
            codigo_producto: l.codigo_producto,
            cantidad: Number(l.cantidad_total)
        }));

        const cabecerasAfectadas = await PedidoPosCabeceraModel.findAll({
            where: { tipo_pedido: 'POLLO', fecha_requerida: fecha, ruta_id },
            attributes: ['id', 'numero_pedido']
        });
        const idsPedidos = cabecerasAfectadas.map(c => c.id);
        const comentarios = [...new Set(cabecerasAfectadas.map(c => c.numero_pedido).filter(Boolean))].join(', ');

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
// Igual que enviarTransferenciaPollo, pero para INSUMOS
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
                where: { tipo_pedido: 'INSUMOS', fecha_requerida: fecha, ruta_id }
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

        const lineasSap = lineasDetalle.map(l => ({
            codigo_producto: l.codigo_producto,
            cantidad: Number(l.cantidad_total)
        }));

        const cabecerasAfectadas = await PedidoPosCabeceraModel.findAll({
            where: { tipo_pedido: 'INSUMOS', fecha_requerida: fecha, ruta_id },
            attributes: ['id', 'numero_pedido']
        });
        const idsPedidos = cabecerasAfectadas.map(c => c.id);
        const comentarios = [...new Set(cabecerasAfectadas.map(c => c.numero_pedido).filter(Boolean))].join(', ');

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

module.exports = {
    getAllPedidosEncabezado,
    getPedidoDetalleByEncabezado,
    createPedido,
    validarYObtenerPedido,
    subirYProcesarArchivosPedidoPos,
    procesarArchivoPedidoPos,
    guardarPedidoPos,
    agruparLineasPorPedido,
    getPedidosPos,
    getAsignacionesTransporte,
    asignarTransporte,
    getComparativoStockPollo,
    getComparativoStockInsumos,
    enviarTransferenciaPollo,
    enviarTransferenciaInsumos,
    guardarAsignacionCantidades
}