const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class LineaSolicitudCompraModel extends Model {}

LineaSolicitudCompraModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    requisicion_id: { type: DataTypes.STRING(50), allowNull: false },
    numero_linea: { type: DataTypes.STRING(20), allowNull: false },
    codigo_articulo: { type: DataTypes.STRING(50), allowNull: false },
    nombre_articulo: { type: DataTypes.STRING(255), allowNull: false},
    descripcion: { type: DataTypes.TEXT, allowNull: false },
    cantidad: { type: DataTypes.DECIMAL(15, 3), allowNull: false },
    unidad_medida: { type: DataTypes.STRING(50), allowNull: true },
    precio_unitario_estimado: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    total_estimado: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    cuenta_contable: { type: DataTypes.STRING(100), allowNull: false },
    centro_costo: { type: DataTypes.STRING(100), allowNull: false },
    notas: { type: DataTypes.TEXT, allowNull: false },
    imagen_s3_key: { type: DataTypes.STRING, allowNull: true },
    imagen_nombre: { type: DataTypes.STRING, allowNull: true }

}, {
    sequelize: sequelize,
    tableName: 'tbl_linea_solicitud_compra',
    schema: 'compras',
    timestamps: true,
    createdAt: 'fecha_creacion',
    updatedAt: 'fecha_actualizacion'
})

module.exports = LineaSolicitudCompraModel;