const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const UserModel = require('../models/core/tbl_usuario.model');
const UsersModel = require('../models/pioapp/users.model');
const initDetalleEmpleadoCootragua = require('../models/nomina/views/vwDetalleEmpleadoCootragua.view');
const sequelize = require('../configuration/db');
const { sequelizeInit } = require('../configuration/db');
const { Op } = require('sequelize');
require('dotenv').config();

const SECRET = process.env.DB_SECRET_KEY;

//Servicio para inicio de sesión y autenticación por token
async function login(req, res) {
    const { identifier, password } = req.body;

    const sequelizeNomina = await sequelizeInit('NOMINA');
    const EmpleadoModel = await initDetalleEmpleadoCootragua(sequelizeNomina);

    try {
        if (!identifier || !password) {
            return res.status(400).json({ error: "Credenciales requeridos" });
        }

        let user = await findUserInPioApp(UsersModel, identifier);

        if (!user) {
            const empleado = await findEmployeeInNomina(EmpleadoModel, identifier);

            if (!empleado) {
                return res.status(404).json({ error: "Usuario no encontrado" });
            }

            const isPasswordCorrect = validatePassword(
                password,
                empleado.password,
                "NOMINA"
            );

            if (!isPasswordCorrect) {
                return res.status(401).json({ error: "Contraseña incorrecta" });
            }

            user = await createUserFromEmployee(UsersModel, empleado);
        } else {
            const isPasswordCorrect = validatePassword(
                password,
                user.password,
                "PIOAPP"
            );

            if (!isPasswordCorrect) {
                return res.status(401).json({ error: "Contraseña incorrecta" });
            }
        }

        const mustChangePassword = checkPasswordPolicy(user);

        const token = generateToken(user, SECRET);

        return res.json({
            ok: true,
            token,
            user,
            mustChangePassword
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            error: "Error en login",
            details: err.message
        });
    }
}

//Validacion y comparacion de inicio de sesion con Microsoft contra base de datos
async function validateLogin(req, res) {
    const { email } = req.params;

    try {
        const user = await UsersModel.findOne({
            where: {
                email: email
            }
        })
        if(user){
            const token = generateToken(user, SECRET);

            return res.json({
                ok: true,
                token,
                user,
                mustChangePassword: false
            })
        } else {
            return res.json({
                details: 'Usuario no encontrado',
                email: email,
                ok: false
            });
        }
    } catch (error) {
        return res.status(500).json({
            error: "Error al validar usuario",
            details: error.message
        });
    }
}

async function findUserInPioApp(UsersModel, identifier) {
    return await UsersModel.findOne({
        where: {
            [Op.or]: [
                { email: identifier },
                { codigo_user: identifier }
            ]
        }
    });
}

async function findEmployeeInNomina(EmpleadoModel, identifier) {
    return await EmpleadoModel.findOne({
        where: {
            [Op.or]: [
                { aliasCodigo: identifier },
                { email: identifier }
            ],
            baja: 0
        }
    });
}

async function createUserFromEmployee(UsersModel, empleadoResult) {
    const now = new Date();

    return await UsersModel.create({
        id_users: empleadoResult.codEmpleado,
        codigo_user: empleadoResult.aliasCodigo,
        id_rol: empleadoResult.idRol,
        first_name: empleadoResult.nombreEmpleado,
        second_name: empleadoResult.segundoNombre,
        first_last_name: empleadoResult.apellidoEmpleado,
        second_last_name: empleadoResult.segundoApellido,
        email: empleadoResult.email,
        password: bcrypt.hashSync(empleadoResult.password, 10),
        dpi: empleadoResult.noDoc,
        fecha_nacimiento: empleadoResult.fechaNac,
        direccion: empleadoResult.direccion,
        puesto_trabajo: empleadoResult.nomPuesto,
        createdAt: now,
        updatedAt: now,
        is_temporal_password: true,
        last_password_change: now,
        password_expiration_days: 60,
        division: null,
        id_departamento: null,
        id_area: null
    });
}

function generateToken(user, SECRET) {
    return jwt.sign({
        id_usuario: user.id_users,
        nombre: user.first_name + ' ' + user.first_last_name,
        rol: user.id_rol_core,
        email: user.email,
        puesto: user.puesto_trabajo,
        id_departamento: user.id_departamento,
        id_area: user.id_area
    }, SECRET, { expiresIn: "24h" });
}

function checkPasswordPolicy(user) {
    let mustChangePassword = false;

    if (user.is_temporal_password === true) {
        mustChangePassword = true;
    }

    if (user.last_password_change && user.password_expiration_days) {
        const diffDays =
            (new Date() - new Date(user.last_password_change)) /
            (1000 * 60 * 60 * 24);

        if (diffDays > user.password_expiration_days) {
            mustChangePassword = true;
        }
    }

    return mustChangePassword;
}

function validatePassword(inputPassword, storedPassword, source) {
    if (!storedPassword) return false;

    if (source === "PIOAPP") {
        return bcrypt.compareSync(inputPassword, storedPassword);
    }

    if (source === "NOMINA") {
        return inputPassword === storedPassword;
    }

    return false;
}

module.exports = {
    login,
    validateLogin
};