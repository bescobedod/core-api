const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');
const PedidoArtesanoDetalleModel = require('./tbl_pedido_artesano_detalle.model');
const PedidoArtesanoHistorialModel = require('./tbl_pedido_artesano_historial.model');

class PedidoArtesanoModel extends Model {}

// Pedidos de pollo artesano: los crea la asistente de avícola en Core para un
// cliente (no una tienda) y salen en una ruta. La tienda es solo la
// referencia para saber la ruta; se entregan en direccion_entrega.
// Estados: CREADO -> AUTORIZADO | RECHAZADO -> CARGADO -> ENTREGADO.
PedidoArtesanoModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    numero_pedido: { type: DataTypes.STRING(30), allowNull: false },
    // Serie que se imprime junto al número en el envío; el número es el que identifica el documento.
    serie: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'AGPE' },
    fecha_requerida: { type: DataTypes.DATEONLY, allowNull: false },
    ruta_id: { type: DataTypes.UUID, allowNull: false },
    nombre_ruta: { type: DataTypes.STRING(100), allowNull: false },
    codigo_tienda_referencia: { type: DataTypes.STRING(20), allowNull: true },
    nombre_tienda_referencia: { type: DataTypes.STRING(150), allowNull: true },
    cliente_id: { type: DataTypes.UUID, allowNull: false },
    // Foto del cliente al crear el pedido, para que el historial no cambie.
    cliente_nombre: { type: DataTypes.STRING(250), allowNull: false },
    cliente_nit: { type: DataTypes.STRING(20), allowNull: true },
    direccion_entrega: { type: DataTypes.STRING(250), allowNull: true },
    telefono_contacto: { type: DataTypes.STRING(30), allowNull: true },
    condicion_pago: { type: DataTypes.STRING(10), allowNull: false }, // DEPOSITO | PLANILLA | PENDIENTE (aún no se paga)
    numero_boleta: { type: DataTypes.STRING(50), allowNull: true },
    comentario: { type: DataTypes.TEXT, allowNull: true },
    estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'CREADO' },
    creado_por: { type: DataTypes.BIGINT, allowNull: false },
    creado_por_nombre: { type: DataTypes.STRING(150), allowNull: false },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    actualizado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    rechazado_por: { type: DataTypes.BIGINT, allowNull: true },
    rechazado_por_nombre: { type: DataTypes.STRING(150), allowNull: true },
    fecha_rechazo: { type: DataTypes.DATE, allowNull: true },
    motivo_rechazo: { type: DataTypes.TEXT, allowNull: true },
    codigo_piloto: { type: DataTypes.BIGINT, allowNull: true },
    nombre_piloto: { type: DataTypes.STRING(150), allowNull: true },
    cargado_por: { type: DataTypes.BIGINT, allowNull: true },
    cargado_por_nombre: { type: DataTypes.STRING(150), allowNull: true },
    fecha_carga: { type: DataTypes.DATE, allowNull: true },
    entregado_por: { type: DataTypes.BIGINT, allowNull: true },
    entregado_por_nombre: { type: DataTypes.STRING(150), allowNull: true },
    fecha_entrega: { type: DataTypes.DATE, allowNull: true },
    evidencia_entrega_key: { type: DataTypes.TEXT, allowNull: true },
    // Documentos de SAP: transferencia bodega -> camión (al cargar) y entrega (al entregar).
    sap_traslado_docentry: { type: DataTypes.INTEGER, allowNull: true },
    sap_traslado_docnum: { type: DataTypes.INTEGER, allowNull: true },
    sap_entrega_docentry: { type: DataTypes.INTEGER, allowNull: true },
    sap_entrega_docnum: { type: DataTypes.INTEGER, allowNull: true },
    // Último error que devolvió SAP; se limpia cuando la operación sale bien.
    sap_error: { type: DataTypes.TEXT, allowNull: true },
    sap_error_en: { type: DataTypes.DATE, allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_pedido_artesano',
    schema: 'logistica',
    timestamps: false
})

PedidoArtesanoModel.hasMany(PedidoArtesanoDetalleModel, { foreignKey: 'pedido_id', as: 'detalle' });
PedidoArtesanoDetalleModel.belongsTo(PedidoArtesanoModel, { foreignKey: 'pedido_id', as: 'pedido' });

PedidoArtesanoModel.hasMany(PedidoArtesanoHistorialModel, { foreignKey: 'pedido_id', as: 'historial' });
PedidoArtesanoHistorialModel.belongsTo(PedidoArtesanoModel, { foreignKey: 'pedido_id', as: 'pedido' });

module.exports = PedidoArtesanoModel;
