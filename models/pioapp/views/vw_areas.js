const { Model, DataTypes } = require('sequelize');
const { sequelizePioApp } = require('../../../configuration/db');

class VwAreasModel extends Model {}

VwAreasModel.init({
    id_area: { type: DataTypes.UUID, primaryKey: true },
    nombre: { type: DataTypes.STRING(250) },
    descripcion: { type: DataTypes.TEXT },
    activo: { type: DataTypes.BOOLEAN },
    departamento_id: { type: DataTypes.UUID },
    nombre_departamento: { type: DataTypes.STRING(100) },
    jefe_inmediato: { type: DataTypes.UUID },
    nombre_jefe_inmediato: { type: DataTypes.TEXT }
}, {
    sequelize: sequelizePioApp,
    tableName: 'vw_areas',
    schema: 'config',
    timestamps: false,
    underscored: false
});

module.exports = VwAreasModel;