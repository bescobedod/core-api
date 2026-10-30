const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class MarcajeModel extends Model {}

MarcajeModel.init({
    id_marcaje: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false },
    id_usuario: { type: DataTypes.BIGINT, allowNull: false },
    tipo: { type: DataTypes.STRING(10), allowNull: false },
    fecha_hora: { type: DataTypes.DATE, allowNull: false },
    latitud: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
    longitud: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
    foto_s3_url: { type: DataTypes.STRING(500), allowNull: false },
    es_valido: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    razon_invalido: { type: DataTypes.TEXT, allowNull: true },
    dispositivo_uuid: { type: DataTypes.STRING(150), allowNull: true },
    dispositivo_info: { type: DataTypes.TEXT, allowNull: true },
    ip_address: { type: DataTypes.STRING(50), allowNull: true },
    is_offline: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
}, {
    sequelize: sequelize,
    tableName: 'tbl_marcaje',
    schema: 'logistica',
    timestamps: true
});

module.exports = MarcajeModel;
