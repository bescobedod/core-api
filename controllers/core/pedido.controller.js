const initPedidoEncabezadoModel = require('../../models/core/tbl_pedido_encabezado.model');
const initPedidoDetalleModel = require('../../models/core/tbl_pedido_detalle.model');
const { obtenerProductosData } = require('../../integrations/sap/sapClient');
const sequelizeInit = require('../../configuration/db');
const { Op } = require('sequelize');

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

        const [encabezado, created] = await PedidoEncabezadoModel.findOrCreate({
            where: {
                id_tienda: header.id_tienda,
                id_tipo: header.id_tipo,
                fecha_requerida: header.fecha_requerida
            },
            defaults: { ...header },
            transaction: t
        });

        if(!created) {
            await encabezado.update({
                total_productos: header.total_productos,
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
            error: 'Error general al intentar crear el pedido',
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
            obtenerProductosData(),
            
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
        return res.status(500).json({
            error: 'Error al validar información',
            details: error.error
        });
    }
}

// async function getPedidosByTipoYFecha(req, res) {
//     const { }
// }

module.exports = {
    getAllPedidosEncabezado,
    getPedidoDetalleByEncabezado,
    createPedido,
    validarYObtenerPedido
}