const { Model, DataTypes } = require('sequelize');

class EmpleadoModel extends Model {}

function initEmpleadoModel(sequelizeInstance) {
    EmpleadoModel.init({
        codEmpleado: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        nombreEmpleado: { type: DataTypes.STRING(32), allowNull: false },
        apellidoEmpleado: { type: DataTypes.STRING(24), allowNull: false },
        apellidoCasada: { type: DataTypes.STRING(24), allowNull: true },
        sexo: { type: DataTypes.STRING(9), allowNull: false },
        direccion: { type: DataTypes.STRING(100), allowNull: false },
        paisOrigen: { type: DataTypes.STRING(56), allowNull: false },
        discapacidad: { type: DataTypes.STRING(20), allowNull: false },
        estadoCivil: { type: DataTypes.STRING(10), allowNull: false },
        raza: { type: DataTypes.STRING(10), allowNull: false },
        tipoDoc: { type: DataTypes.STRING(10), allowNull: false },
        noDoc: { type: DataTypes.STRING(20), allowNull: false },
        departNac: { type: DataTypes.STRING(35), allowNull: false },
        muniNac: { type: DataTypes.STRING(35), allowNull: false },
        departVec: { type: DataTypes.STRING(35), allowNull: false },
        muniVec: { type: DataTypes.STRING(35), allowNull: false },
        fechaNac: { type: DataTypes.DATEONLY, allowNull: false },
        conyugue: { type: DataTypes.STRING(128), allowNull: true },
        noIGGS: { type: DataTypes.STRING(20), allowNull: false },
        NIT: { type: DataTypes.STRING(12), allowNull: false },
        fechaVecIRTRA: { type: DataTypes.DATEONLY, allowNull: true },
        email: { type: DataTypes.STRING(512), allowNull: true },
        noTel: { type: DataTypes.STRING(9), allowNull: true },
        noTelEmerg: { type: DataTypes.STRING(9), allowNull: false },
        noTelNoti: { type: DataTypes.STRING(9), allowNull: false },
        nomBeneficiario: { type: DataTypes.STRING(128), allowNull: true },
        celBeneficiario: { type: DataTypes.STRING(9), allowNull: false },
        banco: { type: DataTypes.STRING(32), allowNull: false },
        noCuenta: { type: DataTypes.STRING(32), allowNull: false },
        noLicen: { type: DataTypes.STRING(15), allowNull: true },
        tipoLicen: { type: DataTypes.STRING(2), allowNull: true },
        fechaVecLicen: { type: DataTypes.DATEONLY, allowNull: true },
        noLicenGun: { type: DataTypes.STRING(15), allowNull: true },
        fechaVecLicenGun: { type: DataTypes.DATEONLY, allowNull: true },
        noContract: { type: DataTypes.INTEGER, allowNull: true },
        venciTarjSal: { type: DataTypes.DATEONLY, allowNull: true },
        venciTarjPul: { type: DataTypes.DATEONLY, allowNull: true },
        venciTarjMan: { type: DataTypes.DATEONLY, allowNull: true },
        codEmpleadoJefe: { type: DataTypes.INTEGER, allowNull: true },
        password: { type: DataTypes.STRING(32), allowNull: true },
        profesion: { type: DataTypes.STRING(128), allowNull: true },
        activo: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: true },
        aliasCodigo: { type: DataTypes.STRING(6), allowNull: true },
        codForaneo: { type: DataTypes.INTEGER, allowNull: true },
        nomContactEmerg: { type: DataTypes.STRING(128), allowNull: true },
        numContactEmerg: { type: DataTypes.STRING(9), allowNull: true },
        parenContactEmerg: { type: DataTypes.STRING(64), allowNull: true },
        tipoSangre: { type: DataTypes.STRING(12), allowNull: true },
        creadoPor: { type: DataTypes.INTEGER, allowNull: true },
        modificadoPor: { type: DataTypes.INTEGER, allowNull: true },
        tokenWeb: { type: DataTypes.STRING(256), allowNull: true },
        segundoNombre: { type: DataTypes.STRING(128), allowNull: true },
        segundoApellido: { type: DataTypes.STRING(128), allowNull: true },
        empleadoTrato: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
        empresaTrato: { type: DataTypes.INTEGER, allowNull: true },
        departamentoTrato: { type: DataTypes.INTEGER, allowNull: true },
        noDependientes: { type: DataTypes.INTEGER, allowNull: true },
        firma: { type: DataTypes.STRING(250), allowNull: true },
        huega: { type: DataTypes.TEXT, allowNull: true },
        keyPass: { type: DataTypes.BLOB, allowNull: false, defaultValue: 0 },
        numeroHijos: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 }
    }, {
        sequelize: sequelizeInstance,
        tableName: 'tEmpleado',
        schema: 'dbo',
        timestamps: false
    });

    return EmpleadoModel
}

module.exports = initEmpleadoModel;