const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

// Sede (muelle de Pollo) en la que opera un camión. Un camión puede estar en
// varias sedes. Se usa para ordenar el dropdown de camiones al asignar
// transporte en Pedidos de Pollo. id_camion es logistica.tbl_camiones.id_camion.
class SedeCamionModel extends Model {}

SedeCamionModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    whs_code_origen: { type: DataTypes.STRING(20), allowNull: false },
    id_camion: { type: DataTypes.UUID, allowNull: false },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_sede_camion',
    schema: 'logistica',
    timestamps: false
});

module.exports = SedeCamionModel;
