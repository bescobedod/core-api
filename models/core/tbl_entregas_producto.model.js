const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class EntregaProductoModel extends Model {}

EntregaProductoModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    tipo_pedido: { type: DataTypes.STRING(10), allowNull: false },
    ruta_id: { type: DataTypes.UUID, allowNull: false },
    nombre_ruta: { type: DataTypes.STRING(100), allowNull: true },
    fecha: { type: DataTypes.DATEONLY, allowNull: false },
    whs_code_ruta: { type: DataTypes.STRING(20), allowNull: false },
    camion_placa: { type: DataTypes.STRING(20), allowNull: true },
    piloto_id: { type: DataTypes.BIGINT, allowNull: true },
    piloto_nombre: { type: DataTypes.STRING(255), allowNull: true },
    card_code: { type: DataTypes.STRING(20), allowNull: false },
    usuario_registro: { type: DataTypes.STRING(100), allowNull: true },
    sap_docentry: { type: DataTypes.INTEGER, allowNull: true },
    sap_docnum: { type: DataTypes.INTEGER, allowNull: true },
    lineas: { type: DataTypes.JSONB, allowNull: false },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_entregas_producto',
    schema: 'logistica',
    timestamps: false
});

module.exports = EntregaProductoModel;
