const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class TicketTrasladoModel extends Model {}

TicketTrasladoModel.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    tipo_pedido: { type: DataTypes.STRING(10), allowNull: false },
    ruta_id: { type: DataTypes.UUID, allowNull: false },
    fecha: { type: DataTypes.DATEONLY, allowNull: false },

    nombre_ruta: { type: DataTypes.STRING(100), allowNull: true },
    whs_origen: { type: DataTypes.STRING(20), allowNull: true },
    whs_destino: { type: DataTypes.STRING(20), allowNull: true },
    camion_placa: { type: DataTypes.STRING(20), allowNull: true },
    piloto_id: { type: DataTypes.BIGINT, allowNull: true },
    piloto_nombre: { type: DataTypes.STRING(255), allowNull: true },
    sap_docnum: { type: DataTypes.INTEGER, allowNull: true },

    lineas: { type: DataTypes.JSONB, allowNull: false },

    estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'PENDIENTE_FIRMA_PILOTO' },

    firmado_admin_por: { type: DataTypes.BIGINT, allowNull: true },
    firmado_admin_nombre: { type: DataTypes.STRING(255), allowNull: true },
    firmado_admin_fecha: { type: DataTypes.DATE, allowNull: true },

    firmado_piloto_fecha: { type: DataTypes.DATE, allowNull: true },

    creado_en: { type: DataTypes.DATE, allowNull: false },
    actualizado_en: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize: sequelize,
    tableName: 'tbl_tickets_traslado',
    schema: 'logistica',
    timestamps: false
})

module.exports = TicketTrasladoModel;