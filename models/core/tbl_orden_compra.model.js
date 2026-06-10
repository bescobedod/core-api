const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class OrdenCompraModel extends Model {}

OrdenCompraModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    numero_orden: { type: DataTypes.STRING(50), allowNull: false },
    solicitud_id: { type: DataTypes.UUID, allowNull: true },
    proveedor_id: { type: DataTypes.STRING(50), allowNull: false },
    proveedor: { type: DataTypes.STRING(250), allowNull: true },
    fecha_orden: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW },
    estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'BORRADOR' },
    monto_total: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    moneda: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'GTQ' },
    notas: { type: DataTypes.TEXT, allowNull: true },
    sap_doc_entry: { type: DataTypes.INTEGER, allowNull: true },
    sap_doc_num: { type: DataTypes.INTEGER, allowNull: true },
    id_empresa: { type: DataTypes.UUID, allowNull: true },
    correlativo: { type: DataTypes.INTEGER, allowNull: true },
    codigo_departamento: { type: DataTypes.STRING(20), allowNull: true },
    cotizacion_s3_key: { type: DataTypes.TEXT, allowNull: true },
    cotizacion_nombre: { type: DataTypes.STRING(255), allowNull: true },
    cotizacion_url: { type: DataTypes.TEXT, allowNull: true },
    solicitado_por: { type: DataTypes.BIGINT, allowNull: false },
    departamento_id: { type: DataTypes.UUID, allowNull: true },
    estrategia_adquisicion_id: { type: DataTypes.UUID, allowNull: true },
    matriz_id: { type: DataTypes.UUID, allowNull: true },
    fecha_requerida: { type: DataTypes.DATEONLY, allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_orden_compra',
    schema: 'compras',
    timestamps: true,
    createdAt: 'fecha_creacion',
    updatedAt: 'fecha_actualizacion'
});

module.exports = OrdenCompraModel;