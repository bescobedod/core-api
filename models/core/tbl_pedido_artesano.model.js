const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');
const PedidoArtesanoDetalleModel = require('./tbl_pedido_artesano_detalle.model');

class PedidoArtesanoModel extends Model {}

// Pedidos de pollo artesano: los crea la asistente de avícola en Core para un
// cliente (no una tienda) y salen en una ruta. La tienda es solo la
// referencia para saber la ruta; se entregan en direccion_entrega.
PedidoArtesanoModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    numero_pedido: { type: DataTypes.STRING(30), allowNull: false },
    fecha_requerida: { type: DataTypes.DATEONLY, allowNull: false },
    ruta_id: { type: DataTypes.UUID, allowNull: false },
    nombre_ruta: { type: DataTypes.STRING(100), allowNull: false },
    codigo_tienda_referencia: { type: DataTypes.STRING(20), allowNull: true },
    nombre_tienda_referencia: { type: DataTypes.STRING(150), allowNull: true },
    cliente_id: { type: DataTypes.UUID, allowNull: false },
    // Foto del cliente al crear el pedido, para que el historial no cambie.
    cliente_nombre: { type: DataTypes.STRING(250), allowNull: false },
    cliente_nit: { type: DataTypes.STRING(20), allowNull: true },
    direccion_entrega: { type: DataTypes.STRING(250), allowNull: false },
    condicion_pago: { type: DataTypes.STRING(10), allowNull: false }, // PAGADO | CREDITO
    numero_boleta: { type: DataTypes.STRING(50), allowNull: true },
    comentario: { type: DataTypes.TEXT, allowNull: true },
    estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'CREADO' },
    creado_por: { type: DataTypes.BIGINT, allowNull: false },
    creado_por_nombre: { type: DataTypes.STRING(150), allowNull: false },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    actualizado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_pedido_artesano',
    schema: 'logistica',
    timestamps: false
})

PedidoArtesanoModel.hasMany(PedidoArtesanoDetalleModel, { foreignKey: 'pedido_id', as: 'detalle' });
PedidoArtesanoDetalleModel.belongsTo(PedidoArtesanoModel, { foreignKey: 'pedido_id', as: 'pedido' });

module.exports = PedidoArtesanoModel;
