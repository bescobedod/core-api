const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class TiendaRutaInsumosModel extends Model {}

TiendaRutaInsumosModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    ruta_id: { type: DataTypes.UUID, allowNull: false },
    id_tienda_simphony: { type: DataTypes.STRING(50), allowNull: false },
    id_tienda_pdv: { type: DataTypes.INTEGER, allowNull: true },
    codigo_tienda: { type: DataTypes.STRING(12), allowNull: true },
    nombre_tienda: { type: DataTypes.STRING(512), allowNull: true },
    codigo_empresa: { type: DataTypes.STRING(12), allowNull: true },
    whs_code: { type: DataTypes.STRING(20), allowNull: true },
    fecha_asignacion: { type: DataTypes.DATE, allowNull: false },
    fecha_fin_asignacion: { type: DataTypes.DATE, allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_tiendas_rutas_insumos',
    schema: 'logistica',
    timestamps: false
})

module.exports = TiendaRutaInsumosModel;