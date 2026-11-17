const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

// Sede (muelle de Pollo: RAS-002 Central, RAS-003 Zacapa, RAS-004 Xela) a la
// que pertenece un piloto. Un piloto puede estar en varias sedes. Se usa
// para ordenar el dropdown de pilotos al asignar transporte en Pedidos de
// Pollo. piloto_id es app.users.id_users de PioApp (base distinta).
class SedePilotoModel extends Model {}

SedePilotoModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    whs_code_origen: { type: DataTypes.STRING(20), allowNull: false },
    piloto_id: { type: DataTypes.BIGINT, allowNull: false },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_sede_piloto',
    schema: 'logistica',
    timestamps: false
});

module.exports = SedePilotoModel;
