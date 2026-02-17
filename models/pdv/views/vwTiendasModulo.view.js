
const { Model, DataTypes } = require('sequelize');

class vwTiendasModulo extends Model {}

function initvwTiendasModulo(sequelizeInstance) {
  vwTiendasModulo.init({
    id_departamento: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },
    id_tienda: { type: DataTypes.INTEGER, allowNull: false },
    codigo_empresa: { type: DataTypes.STRING(12), allowNull: false },
    nombre_empresa: { type: DataTypes.STRING(128), allowNull: false },
    codigo_tienda: { type: DataTypes.STRING(12), allowNull: false },
    nombre_tienda: { type: DataTypes.STRING(512), allowNull: false },
    direccion_tienda: { type: DataTypes.STRING(1024), allowNull: false },
    altitud: { type: DataTypes.STRING(100), allowNull: true },
    latitud: { type: DataTypes.STRING(100), allowNull: true },
    numero_establecimiento_sat: { type: DataTypes.INTEGER, allowNull: true },
    codigo_administrador: { type: DataTypes.INTEGER, allowNull: false },
    nombre_administrador: { type: DataTypes.STRING(114), allowNull: false },
    codigo_subadministrador: { type: DataTypes.INTEGER, allowNull: false },
    nombre_subadministrador: { type: DataTypes.STRING(114), allowNull: false },
    division: { type: DataTypes.STRING(128), allowNull: false },
    inactiva: { type: DataTypes.BOOLEAN, allowNull: true },
    nombre_lista_precio: { type: DataTypes.STRING(250), allowNull: false },
    listaPrecios: { type: DataTypes.INTEGER, allowNull: false },
    nombreComercial: { type: DataTypes.STRING(128), allowNull: false },
    nombre_menu: { type: DataTypes.STRING(255), allowNull: false },
    divisionNombre: { type: DataTypes.STRING(128), allowNull: false },
    celular: { type: DataTypes.STRING(16), allowNull: false },
    idSupervisor: { type: DataTypes.INTEGER, allowNull: false },
    administrador: { type: DataTypes.STRING(128), allowNull: false },
    afiliacionCredomatic: { type: DataTypes.STRING(22), allowNull: false },
    tipoMenu: { type: DataTypes.INTEGER, allowNull: false }
  }, {
    sequelize: sequelizeInstance,
    tableName: 'vwTiendasModulo',
    schema: 'dbo',
    timestamps: false
  });

  return vwTiendasModulo;
}

module.exports = initvwTiendasModulo;