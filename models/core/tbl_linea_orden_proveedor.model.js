const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class LineaOrdenProveedorModel extends Model {}

LineaOrdenProveedorModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    linea_orden_id: { type: DataTypes.UUID, allowNull: false },
    proveedor_id: { type: DataTypes.STRING(50), allowNull: false },
    nombre_proveedor: { type: DataTypes.STRING(255), allowNull: false },
    precio_unitario: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0.00 },
    imagen_s3_key: { type: DataTypes.STRING(500), allowNull: true },
    imagen_nombre: { type: DataTypes.STRING(255), allowNull: true },
    imagen_url: { type: DataTypes.TEXT, allowNull: true },
    descripcion: { type: DataTypes.TEXT, allowNull: true },
    es_seleccionado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    fecha_creacion: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_linea_orden_proveedor',
    schema: 'compras',
    timestamps: false
});

module.exports = LineaOrdenProveedorModel;