const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class PedidoPosCabeceraModel extends Model {}

PedidoPosCabeceraModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    codigo_empresa: { type: DataTypes.STRING(12), allowNull: true },
    codigo_tienda: { type: DataTypes.STRING(20), allowNull: true },
    numero_pedido: { type: DataTypes.STRING(30), allowNull: false },
    fecha_pedido: { type: DataTypes.DATEONLY, allowNull: false },
    hora_pedido: { type: DataTypes.TIME, allowNull: false },
    nombre_tienda: { type: DataTypes.STRING(150), allowNull: true },
    codigo_bodega: { type: DataTypes.STRING(20), allowNull: true }, // resuelto en SAP, desde tTienda.whsCode
    tipo_pedido: { type: DataTypes.STRING(20), allowNull: true }, // POLLO o INSUMOS, derivado del Vendor ID del archivo
    codigo_bodega_simphony: { type: DataTypes.STRING(20), allowNull: true }, // crudo, viene de la posición 2 del archivo ("Vendor ID")
    nombre_bodega: { type: DataTypes.STRING(150), allowNull: true },
    ruta_id: { type: DataTypes.UUID, allowNull: true },
    nombre_ruta: { type: DataTypes.STRING(100), allowNull: true },
    estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'RECIBIDO' },
    archivo_origen: { type: DataTypes.STRING(200), allowNull: true },
    lote_validacion_id: { type: DataTypes.UUID, allowNull: true },
    fecha_recepcion: { type: DataTypes.DATE, allowNull: false },
    fecha_validacion: { type: DataTypes.DATE, allowNull: true },
    usuario_ajuste: { type: DataTypes.STRING(100), allowNull: true },
    fecha_envio_sap: { type: DataTypes.DATE, allowNull: true },
    sap_docentry: { type: DataTypes.INTEGER, allowNull: true },
    sap_docnum: { type: DataTypes.INTEGER, allowNull: true },
    sap_error: { type: DataTypes.TEXT, allowNull: true },
    creado_en: { type: DataTypes.DATE, allowNull: false },
    actualizado_en: { type: DataTypes.DATE, allowNull: false },
    fecha_asignacion_transporte: { type: DataTypes.DATE, allowNull: true },
    usuario_asigno_transporte: { type: DataTypes.STRING(100), allowNull: true },
    camion_id: { type: DataTypes.UUID, allowNull: true },
    camion_placa: { type: DataTypes.STRING(20), allowNull: true },
    piloto_id: { type: DataTypes.BIGINT, allowNull: true },
    piloto_nombre: { type: DataTypes.STRING(500), allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_pedidos_pos_cabecera',
    schema: 'logistica',
    timestamps: false
})

module.exports = PedidoPosCabeceraModel;