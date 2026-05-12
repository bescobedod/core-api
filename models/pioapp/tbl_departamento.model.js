const { Model, DataTypes } = require('sequelize');
const { sequelizePioApp } = require('../../configuration/db');

class DepartamentoModel extends Model {}

DepartamentoModel.init({
    id_departamento: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    codigo: { type: DataTypes.UUID,  allowNull: false },
    nombre: { type: DataTypes.UUID, allowNull: false },
    descripcion: { type: DataTypes.STRING(250), allowNull: false },
    codigo_sap: { type: DataTypes.TEXT, allowNull: false },
    esta_activo: { type: DataTypes.BOOLEAN, allowNull: true }
}, {
    sequelize: sequelizePioApp,
    tableName: 'tbl_departamento',
    schema: 'config',
    timestamps: false,
    createdAt: 'fecha_creacion',
    updatedAt: 'fecha_actualizacion'
});

module.exports = DepartamentoModel;