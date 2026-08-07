const DepartamentoModel = require('../../models/pioapp/tbl_departamento.model');
const { Op } = require('sequelize');
const { sequelizePioApp } = require('../../configuration/db');
const AreaModel = require('../../models/pioapp/tbl_area.model');
const UsersModel = require('../../models/pioapp/users.model');
const { v4: uuidv4 } = require('uuid');

async function getDepartamentos(req, res) {
    try {
        const departamentos = await DepartamentoModel.findAll({});

        if(departamentos.length === 0) {
            return res.status(404).json({ error: "No se encontraron departamentos creados" });
        }

        return res.json(departamentos);
    } catch (err) {
        console.error("Error al obtener los departamentos");
        return res.status(500).json({ error: err.message });
    }
}

async function createDepartamento(req, res) {
    const { codigo, nombre, descripcion, codigo_sap } = req.body;

    if (!codigo?.trim() || !nombre?.trim() || !descripcion?.trim() || !codigo_sap?.trim()) {
        return res.status(400).json({ error: "Código, nombre, descripción y código SAP son obligatorios" });
    }

    if (codigo.trim().length > 20) {
        return res.status(400).json({ error: "El código no puede exceder 20 caracteres" });
    }

    try {
        const nuevoDepartamento = await DepartamentoModel.create({
            codigo: codigo.trim().toUpperCase(),
            nombre,
            descripcion,
            codigo_sap,
            esta_activo: true
        });

        return res.status(201).json(nuevoDepartamento);
    } catch (err) {
        console.error("Error al crear el departamento", err);
        return res.status(500).json({ error: err.message });
    }
}

async function updateDepartamento(req, res) {
    const { id_d } = req.params;
    const {
        departamento,
        areas_nuevas,
        areas_inactivar,
        jefes_eliminar,
        jefes_actualizar,
        usuarios_nuevos
    } = req.body;
    const t = await sequelizePioApp.transaction();
    try {
        const dep = await DepartamentoModel.findByPk(id_d, { transaction: t });

        if (!dep) {
            await t.rollback();
            return res.status(404).json({ error: "Departamento no encontrado" });
        }

        if (departamento.nombre !== dep.nombre || departamento.descripcion !== dep.descripcion) {
            await DepartamentoModel.update(
                {
                    nombre: departamento.nombre,
                    descripcion: departamento.descripcion
                },
                {
                    where: { id_departamento: id_d },
                    transaction: t
                }
            );
        }

        if (Array.isArray(areas_inactivar) && areas_inactivar.length > 0) {
            const usuariosEnAreas = await UsersModel.count({
                where: {
                    id_area: areas_inactivar
                },
                transaction: t
            });

            if(usuariosEnAreas > 0) {
                throw new Error("Una o más áreas seleccionadas para inactivar tienen empleados asociados");
            }

            await AreaModel.update(
                { activo: false },
                {
                    where: {
                        id_area: areas_inactivar
                    },
                    transaction: t
                }
            )
        }
        if (Array.isArray(areas_nuevas) && areas_nuevas.length > 0) {
            const nuevasAreas = areas_nuevas.map(area => ({
                nombre: area.nombre,
                descripcion: area.descripcion,
                jefe_inmediato: area.jefe_inmediato,
                departamento_id: id_d,
                activo: true
            }));

            await AreaModel.bulkCreate(nuevasAreas, { transaction: t });
        }

        if (Array.isArray(jefes_eliminar) && jefes_eliminar.length > 0) {
            await AreaModel.update(
                {
                    id_jefe_inmediato: null,
                    jefe_inmediato: null
                },
                {
                    where: {
                        id_area: jefes_eliminar
                    },
                    transaction: t
                }
            );
        }

        if (jefes_actualizar && typeof jefes_actualizar === "object") {
            const updates = Object.entries(jefes_actualizar).map(
                ([id_area, id_jefe_inmediato]) =>
                    AreaModel.update(
                        {
                            jefe_inmediato: id_jefe_inmediato || null
                        },
                        {
                        where: { id_area },
                        transaction: t
                    }
                )
            );

            await Promise.all(updates);
        }

        if (Array.isArray(usuarios_nuevos) && usuarios_nuevos.length > 0) {
            const updates = usuarios_nuevos.map(user => {
                if (typeof user.id_users === 'string' && user.id_users.startsWith('temp-')) {
                    return null;
                }

                return UsersModel.update(
                    {
                        id_departamento: id_d,
                        id_area: user.id_area || null
                    },
                    {
                        where: {
                            id_users: user.id_users
                        },
                        transaction: t
                    }
                );
            }).filter(Boolean);

            await Promise.all(updates);
        }

        await t.commit();

        return res.json({
            message: "Departamento actualizado correctamente"
        });

    } catch (err) {
        await t.rollback();
        console.error("Error al actualizar la información del departamento", err);
        return res.status(500).json({ error: err.message });
    }
}

module.exports = {
    getDepartamentos,
    createDepartamento,
    updateDepartamento
}