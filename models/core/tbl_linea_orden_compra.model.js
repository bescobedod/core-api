const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class LineaOrdenCompraModel extends Model {}

LineaOrdenCompraModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    orden_id: { type: DataTypes.UUID, allowNull: false },
    linea_solicitud_id: { type: DataTypes.UUID, allowNull: true },
    numero_linea: { type: DataTypes.INTEGER, allowNull: false },
    codigo_articulo: { type: DataTypes.STRING(50), allowNull: false },
    nombre_articulo: { type: DataTypes.STRING(255), allowNull: false},
    descripcion: { type: DataTypes.TEXT, allowNull: false },
    cantidad: { type: DataTypes.DECIMAL(15, 3), allowNull: false },
    precio_unitario: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    total_linea: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    centro_costo: { type: DataTypes.STRING(100), allowNull: false },
    cuenta_contable: { type: DataTypes.STRING(100), allowNull: false },
    fecha_creacion: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize: sequelize,
    tableName: 'tbl_linea_orden_compra',
    schema: 'compras',
    timestamps: false
})

module.exports = LineaOrdenCompraModel;