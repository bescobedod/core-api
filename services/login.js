const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const empleadoCootragua = require('../models/nomina/views/vwDetalleEmpleadoCootragua.view');
const userModel = require('../models/core/tbl_user.model');
const { sequelizeInit } = require('../configuration/db');
require('dotenv').config();

const SECRET = process.env.DB_SECRET_KEY;

//Servicio para inicio de sesión y autenticación por token
async function login(req, res) {
    const { cod_empleado, password } = req.body;

    try {
        if (!cod_empleado || !password) {
            return res.status(400).json({ error: "Código y contraseña requeridos" });
        }

        const sequelizeCore = await sequelizeInit('CORE')
        const User = userModel(sequelizeCore);

        const user = await User.findByPk(cod_empleado);

        if(!user) {
            const sequelizeNomina = await sequelizeInit('NOMINA')
            const EmpleadoCootragua = empleadoCootragua(sequelizeNomina);

            const userCootragua = await EmpleadoCootragua.findOne({
                where: {
                    aliasCodigo: cod_empleado,
                    password: password
                }
            })

            if( !userCootragua) {
                return res.status(404).json({ error: "Usuario o contraseña incorrectos" })
            }
            else {
                const passwordHash = await bcrypt.hash(userCootragua.password, 2);
                return res.json({ message: passwordHash });
            }
        } else {
            return res.json({ message: "Usuario encontrado en Core" })
        }

        // if (!userResult) {
        //     return res.status(404).json({ error: "Usuario no encontrado" });
        // }

        // const isPasswordCorrect = await bcrypt.compare(password, userResult.password);

        // if (!isPasswordCorrect) {
        //     return res.status(401).json({ error: "Credenciales incorrectas" });
        // }

        // const payload = {
        //     id_user: userResult.id_users,
        //     nombre: `${userResult.first_name} ${userResult.first_last_name}`,
        //     puesto: userResult.puesto_trabajo,
        //     rol: userResult.id_rol,
        //     email: userResult.email,
        //     division: userResult.division
        // };
        // const token = jwt.sign(payload, SECRET, { expiresIn: "24h" });

        // return res.json({
        //     details: "Login exitoso",
        //     token,
        //     user: payload
        // });

    } catch (err) {
        console.error("LOGIN ERROR:", err);
        return res.status(500).json({
            error: "Error al iniciar sesión",
            details: err.message
        });
    }
}

async function validateLogin(req, res) {
    const { email } = req.params;

    try {
        const sequelizeCore = await sequelizeInit('CORE');
        const Usuario = userModel(sequelizeCore);

        const user = await Usuario.findOne({
            where: {
                email: email
            }
        })

        if(user){
            const payload = {
                id_user: user.id_user,
                nombre: user.nombre + ' ' + user.apellido,
                rol: user.id_rol,
                email: user.email
            }

            const token = jwt.sign(payload, SECRET, { expiresIn: "48h" });

            return res.json({
                message: "Login Exitoso",
                token,
                user: payload
            })
        } else {
            return res.status(404).json({
                message: 'Usuario no encontrado'
            });
        }

    } catch (error) {
        return res.status(500).json({
            error: "Error al validar usuario",
            details: error.message
        });
    }
}

module.exports = {
    login,
    validateLogin
};