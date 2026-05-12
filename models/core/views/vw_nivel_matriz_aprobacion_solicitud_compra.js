const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../../configuration/db');

class VwNivelMatrizAprovacionSolicitudCompra extends Model {}

VwNivelMatrizAprovacionSolicitudCompra.init({
    id: { type: DataTypes.UUID, primaryKey: true },
    matriz_id: { type: DataTypes.UUID, allowNull: false },
    nivel: { type: DataTypes.INTEGER, allowNull: false },
    rol_aprobador_id: { type: DataTypes.INTEGER },
    usuario_aprobador_id: { type: DataTypes.UUID, allowNull: false },
    aprobador: { type: DataTypes.TEXT, allowNull: false },
    puesto_aprobador: { type: DataTypes.TEXT, allowNull: true },
    es_requerido: { type: DataTypes.BOOLEAN, allowNull: true },
    puede_delegar: { type: DataTypes.BOOLEAN, allowNull: false },
    fecha_creacion: { type: DataTypes.DATE, allowNull: false },
    fecha_actualizacion: { type: DataTypes.DATE, allowNull: false }
}, {
    sequelize: sequelize,
    tableName: 'vw_nivel_matriz_aprobacion_solicitud_compra',
    schema: 'compras',
    timestamps: false,
    underscored: false
});

module.exports = VwNivelMatrizAprovacionSolicitudCompra;