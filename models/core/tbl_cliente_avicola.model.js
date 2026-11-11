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
    // Dirección de entrega. Vacía en los empleados, que no tienen dirección.
    direccion: { type: DataTypes.STRING(250), allowNull: true },
    telefono: { type: DataTypes.STRING(30), allowNull: true },
    // Solo si el cliente es empleado de la empresa (ej. "AL 8641").
    codigo_empleado: { type: DataTypes.STRING(20), allowNull: true },
    // CardCode del cliente en SAP (AVIGUA); sin él no se puede entregar el pedido.
    card_code: { type: DataTypes.STRING(20), allowNull: true },
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
