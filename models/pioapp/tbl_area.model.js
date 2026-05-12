const { Model, DataTypes } = require('sequelize');
const { sequelizePioApp } = require('../../configuration/db');

class AreaModel extends Model {}

AreaModel.init({
    id_area: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    departamento_id: { type: DataTypes.UUID,  allowNull: false },
    jefe_inmediato: { type: DataTypes.UUID, allowNull: true },
    nombre: { type: DataTypes.STRING(250), allowNull: false },
    descripcion: { type: DataTypes.TEXT, allowNull: false },
    activo: { type: DataTypes.BOOLEAN, allowNull: true }
}, {
    sequelize: sequelizePioApp,
    tableName: 'tbl_area',
    schema: 'config',
    timestamps: false
});

module.exports = AreaModel;