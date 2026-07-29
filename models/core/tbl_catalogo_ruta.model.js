const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class CatalogoRutaModel extends Model {}

CatalogoRutaModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    nombre_ruta: { type: DataTypes.STRING(100), allowNull: false },
    codigo_camion: { type: DataTypes.STRING(30), allowNull: true },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creado_en: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize: sequelize,
    tableName: 'tbl_catalogo_rutas',
    schema: 'logistica',
    timestamps: false
})

module.exports = CatalogoRutaModel;