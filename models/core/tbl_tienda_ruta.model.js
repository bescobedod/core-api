const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class TiendaRutaModel extends Model {}

TiendaRutaModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    codigo_tienda: { type: DataTypes.STRING(20), allowNull: false },
    ruta_id: { type: DataTypes.UUID, allowNull: false },
    fecha_asignacion: { type: DataTypes.DATE, allowNull: false },
    fecha_fin_asignacion: { type: DataTypes.DATE, allowNull: true }
}, {
    sequelize: sequelize,
    tableName: 'tbl_tiendas_rutas',
    schema: 'logistica',
    timestamps: false
})

module.exports = TiendaRutaModel;