const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../../configuration/db');

class CamionInspeccionModel extends Model {}

CamionInspeccionModel.init({
    id_checklist: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    tipo_checklist: { type: DataTypes.STRING(20), allowNull: false },
    id_usuario: { type: DataTypes.BIGINT, allowNull: false },
    placa_vehiculo: { type: DataTypes.STRING(20), allowNull: false },
    licencia_conducir: { type: DataTypes.STRING(50) },
    kilometraje: { type: DataTypes.STRING(20) },
    fecha_inspeccion: { type: DataTypes.DATE },
    estado_checklist: { type: DataTypes.STRING(20), defaultValue: 'ENVIADO' },
    niveles: { type: DataTypes.JSONB },
    chequeo_funcionamiento: { type: DataTypes.JSONB },
    equipo_basico: { type: DataTypes.JSONB },
    varios: { type: DataTypes.JSONB },
    marcas_danos: { type: DataTypes.JSONB },
    foto_placa_url: { type: DataTypes.TEXT },
    foto_kilometraje_url: { type: DataTypes.TEXT },
    firma_canvas_base64: { type: DataTypes.TEXT, allowNull: false },
    firma_supervisor: { type: DataTypes.TEXT },
    puntos_frontal: { type: DataTypes.JSONB },
    puntos_trasero: { type: DataTypes.JSONB },
    puntos_lateral_izq: { type: DataTypes.JSONB },
    puntos_lateral_der: { type: DataTypes.JSONB },
    nombre_conductor: { type: DataTypes.STRING(150) },
    fecha_mantenimiento: { type: DataTypes.STRING(20) },
    coordenadas: { type: DataTypes.JSONB },
    limpieza_exterior: { type: DataTypes.JSONB },
    limpieza_cabina: { type: DataTypes.JSONB },
    limpieza_furgon: { type: DataTypes.JSONB },
    foto_licencia_url: { type: DataTypes.TEXT },
    licencia_conducir_num: { type: DataTypes.STRING(50) }
}, {
    sequelize: sequelize,
    tableName: 'tbl_camion_inspeccion',
    schema: 'logistica',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
});

module.exports = CamionInspeccionModel;