const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class CatalogoRutaPolloModel extends Model {}

CatalogoRutaPolloModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    nombre_ruta: { type: DataTypes.STRING(100), allowNull: false },
    whs_code_origen: { type: DataTypes.STRING(20), allowNull: false },
    whs_code_destino: { type: DataTypes.STRING(20), allowNull: false },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creado_en: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize: sequelize,
    tableName: 'tbl_catalogo_rutas_pollo',
    schema: 'logistica',
    timestamps: false
})

module.exports = CatalogoRutaPolloModel;