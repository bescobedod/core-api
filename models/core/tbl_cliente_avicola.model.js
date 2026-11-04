const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class ClienteAvicolaModel extends Model {}

// Clientes del pollo artesano. Se importaron una vez desde tClienteAvicola
// (PINULITO_NOMINA, id_cliente_origen) y desde entonces se dan de alta aquí.
ClienteAvicolaModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    id_cliente_origen: { type: DataTypes.INTEGER, allowNull: true },
    nombre: { type: DataTypes.STRING(250), allowNull: false },
    nit: { type: DataTypes.STRING(20), allowNull: true },
    direccion: { type: DataTypes.STRING(250), allowNull: true },
    // Dirección real de entrega; vacía en los clientes recién importados.
    direccion_fisica: { type: DataTypes.STRING(250), allowNull: true },
    vigente: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    creado_por: { type: DataTypes.BIGINT, allowNull: true },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    actualizado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    sequelize: sequelize,
    tableName: 'tbl_cliente_avicola',
    schema: 'logistica',
    timestamps: false
})

module.exports = ClienteAvicolaModel;
