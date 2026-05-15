const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class EmpresaModel extends Model {}

EmpresaModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    nombre: { type: DataTypes.STRING },
    sap_database: { type: DataTypes.STRING(100) },
    sap_user: { type: DataTypes.STRING(100) },
    sap_password: { type: DataTypes.STRING(100) },
    id_pdv: { type: DataTypes.STRING(100) },
    esta_activo: { type: DataTypes.BOOLEAN },
    fecha_creacion: { type: DataTypes.DATE }
}, {
    sequelize: sequelize,
    tableName: 'tbl_empresa',
    schema: 'config',
    timestamps: false
});

module.exports = EmpresaModel;