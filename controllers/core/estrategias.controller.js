const EstrategiaAdquisicionModel = require('../../models/core/tbl_estrategia_adquisicion.model');
const MatrizAprobacionSolicitudModel = require('../../models/core/tbl_matriz_aprobacion_solicitud_compra.model');
const VwNivelMatrizAprovacionSolicitudCompra = require('../../models/core/views/vw_nivel_matriz_aprobacion_solicitud_compra');
const VwAreasModel = require('../../models/pioapp/views/vw_areas');
const NivelMatrizAprobacionSolicitudModel = require('../../models/core/tbl_nivel_matriz_aprobacion_solicitud_compra.model');
const UserModel = require('../../models/core/tbl_usuario.model');
const UsersModel = require('../../models/pioapp/users.model');
const sap = require('../../integrations/sap/sapClient');
const { Op } = require('sequelize');
const { sequelize } = require('../../configuration/db');
const AreaModel = require('../../models/pioapp/tbl_area.model');
const DepartamentoModel = require('../../models/pioapp/tbl_departamento.model');

async function getEstrategias(req, res) {
    try {
        const estrategias = await EstrategiaAdquisicionModel.findAll({
            where: {
                departamento_id: req.user.id_departamento
            }
        });

        if(estrategias.length === 0) {
            return res.status(404).json({  error: "No se encontraron estrategias para el departamento" });
        }

        return res.json(estrategias);
    } catch (err) {
        console.error("Error al obtener estrategias de adquisicion", err);
        return res.status(500).json({ error: err.message });
    }
}

async function getMatrizAprobacion(req, res) {
    const { id_estrategia } = req.params;
    
    try {
        const matriz = await MatrizAprobacionSolicitudModel.findOne({
            where: {
                estrategia_adquisicion_id: id_estrategia
            }
        });

        if(!matriz) {
            return res.status(404).json({ error: "No se encontraron matrices de aprobación" })
        }

        const niveles = await NivelMatrizAprobacionSolicitudModel.findAll({
            where: {
                matriz_id: matriz.id
            },
            order: [['nivel', 'ASC']]
        });

        const usersId = niveles.map(n => n.usuario_aprobador_id);

        const usuarios = await UsersModel.findAll({
            where: {
                id_users: {
                    [Op.in]: usersId
                }
            }
        });

        const usuariosMap = {};
        usuarios.forEach(u => {
            usuariosMap[u.id_users] = u;
        });

        const nivelesCargados = niveles.map(n => {
            const nivel = n.toJSON();
            const usuario = usuariosMap[nivel.usuario_aprobador_id];

            return {
                ...nivel,
                aprobador: usuario
                ? `${usuario.first_name || ''} ${usuario.second_name || ''} ${usuario.first_last_name || ''} ${usuario.second_last_name || ''}`.trim()
                : null,
                puesto_aprobador: usuario ? usuario.puesto_trabajo : null
            }
        })

        return res.json({
            matrices_solicitud: {
                ...matriz.toJSON(),
                niveles: nivelesCargados
            }
        });
    } catch (err) {
        console.error("Error al obtener matrices de aprobacion", err);
        return res.status(500).json({ error: err.message });
    }
}

async function deleteNivelMatrizSolicitud(req, res) {
    const { matriz_id, nivel } = req.body;
    const t = await sequelize.transaction();

    try {
        const nivelObj = await NivelMatrizAprobacionSolicitudModel.findOne({
            where: {
                matriz_id,
                nivel
            },
            transaction: t
        });

        if(nivelObj.length === 0) {
            await t.rollback();
            throw new Error("Nivel no encontrado");
        }

        await nivelObj.destroy({ transaction: t });

        await NivelMatrizAprobacionSolicitudModel.update(
            {
                nivel: sequelize.literal('nivel - 1')
            },
            {
                where: {
                    matriz_id,
                    nivel: {
                        [Op.gt]: nivel
                    }
                },
                transaction: t
            }
        );

        await t.commit();

        return res.json({ message: "Nivel eliminado correctamente" });
    } catch (err) {
        console.error("Error al obtener matrices de aprobacion", err);
        return res.status(500).json({ error: err.message });
    }
}

async function updateEstrategiaAdquisicion(req, res) {
    const { estrategia, matriz_solicitud } = req.body;

    try {
        if (!estrategia?.id) {
            const error = new Error("ID de estrategia requerido");
            error.status = 400;
            throw error;
        }

        if (!matriz_solicitud?.id) {
            const error = new Error("ID de matriz requerido");
            error.status = 400;
            throw error;
        }

        if (!Array.isArray(matriz_solicitud.niveles) || matriz_solicitud.niveles.length !== 1) {
            const error = new Error("Debe existir exactamente un nivel en la matriz");
            error.status = 400;
            throw error;
        }

        const nivel = matriz_solicitud.niveles[0];

        if (!nivel.usuario_aprobador_id) {
            const error = new Error("usuario_aprobador_id es requerido");
            error.status = 400;
            throw error;
        }

        const usuario = await UsersModel.findByPk(nivel.usuario_aprobador_id);

        if (!usuario) {
            const error = new Error("El usuario aprobador no existe");
            error.status = 404;
            throw error;
        }

        const estrategiaDB = await EstrategiaAdquisicionModel.findByPk(estrategia.id);

        if (!estrategiaDB) {
            const error = new Error("Estrategia no encontrada");
            error.status = 404;
            throw error;
        }

        const matrizDB = await MatrizAprobacionSolicitudModel.findOne({
            where: {
                id: matriz_solicitud.id,
                estrategia_adquisicion_id: estrategia.id
            }
        });

        if (!matrizDB) {
            const error = new Error("Matriz no encontrada o no pertenece a la estrategia");
            error.status = 404;
            throw error;
        }

        await sequelize.transaction(async (t) => {

            await EstrategiaAdquisicionModel.update(
                {
                    nombre: estrategia.nombre,
                    descripcion: estrategia.descripcion,
                    esta_activo: estrategia.esta_activo,
                    requiere_cotizaciones: estrategia.requiere_cotizaciones,
                    fecha_actualizacion: new Date()
                },
                {
                    where: { id: estrategia.id },
                    transaction: t
                }
            );

            await MatrizAprobacionSolicitudModel.update(
                {
                    fecha_actualizacion: new Date(),
                    nombre: matriz_solicitud.nombre || matrizDB.nombre
                },
                {
                    where: { id: matriz_solicitud.id },
                    transaction: t
                }
            );

            const nivelDB = await NivelMatrizAprobacionSolicitudModel.findOne({
                where: { matriz_id: matriz_solicitud.id },
                transaction: t
            });

            if (!nivelDB) {
                throw new Error("La matriz no tiene niveles definidos");
            }

            await nivelDB.update({
                usuario_aprobador_id: nivel.usuario_aprobador_id
            }, { transaction: t });

        });

        return res.json({ message: "Estrategia actualizada correctamente" });

    } catch (err) {
        console.error(err);

        return res.status(err.status || 500).json({
            error: err.message
        });
    }
}

async function createEstrategiaByArea(req, res) {
    const { estrategia } = req.body;
    const { area } = req.params;

    try {
        const estrategiaExistente = await EstrategiaAdquisicionModel.findOne({
            where: {
                area_id: area,
                esta_activo: true
            }
        });

        if(estrategiaExistente) {
            return res.status(401).json({ error: "Tienes una estrategia de adquisición activa para esta área, por favor inactivala y vuelvelo a intentar" });
        }

        const departamento = await DepartamentoModel.findByPk(req.user.id_departamento);

        if(!departamento) return res.status(404).json({ error: "Departamento no encontrado o no existe" });

        const nuevaEstrategia = EstrategiaAdquisicionModel.create({
            ...estrategia,
            area_id: area,
            departamento_id: req.user.id_departamento,
            codigo_departamento: departamento.codigo
        });

        return res.json(nuevaEstrategia);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

async function createMatrizAprobacionSolicitud(req, res) {
    const { id_estrategia, nombre } = req.body;

    try {
        if (!id_estrategia) {
            const error = new Error("id_estrategia es requerido");
            error.status = 400;
            throw error;
        }

        const estrategia = await EstrategiaAdquisicionModel.findByPk(id_estrategia);

        if (!estrategia) {
            const error = new Error("Estrategia no encontrada");
            error.status = 404;
            throw error;
        }

        const matrizActiva = await MatrizAprobacionSolicitudModel.findOne({
            where: {
                estrategia_adquisicion_id: estrategia.id,
                esta_activo: true
            }
        });

        if (matrizActiva) {
            const error = new Error("Ya existe una matriz activa para esta estrategia");
            error.status = 409;
            throw error;
        }

        const area = await AreaModel.findByPk(estrategia.area_id);

        if (!area) {
            const error = new Error("Área no encontrada");
            error.status = 404;
            throw error;
        }

        if (!area.jefe_inmediato) {
            const error = new Error("El área no tiene un jefe inmediato asignado");
            error.status = 400;
            throw error;
        }

        const jefe = await UsersModel.findByPk(area.jefe_inmediato);

        if (!jefe) {
            const error = new Error("El jefe inmediato no existe en el sistema");
            error.status = 404;
            throw error;
        }

        const matriz = await sequelize.transaction(async (t) => {
            const matriz = await MatrizAprobacionSolicitudModel.create({
                departamento_id: estrategia.departamento_id,
                estrategia_adquisicion_id: estrategia.id,
                prioridad: 1,
                nombre: nombre || "Matriz de aprobación",
                esta_activo: true
            }, { transaction: t });

            await NivelMatrizAprobacionSolicitudModel.create({
                matriz_id: matriz.id,
                nivel: 1,
                usuario_aprobador_id: area.jefe_inmediato
            }, {
                transaction: t
            });

            return matriz;
        });

        return res.json({ matriz });

    } catch (err) {
        console.error(err);

        if (err.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({
                error: "Ya existe una matriz activa para esta estrategia"
            });
        }

        return res.status(err.status || 500).json({
            error: err.message
        });
    }
}

async function getJefeInmediatoByEstrategia(req, res) {
    const { id_estrategia } = req.params;

    try {
        if (!id_estrategia) {
            return res.status(400).json({ error: "id_estrategia es requerido" });
        }

        const estrategia = await EstrategiaAdquisicionModel.findByPk(id_estrategia);

        if (!estrategia) {
            return res.status(404).json({ error: "Estrategia no encontrada" });
        }

        const area = await VwAreasModel.findOne({
            where: {
                id_area: estrategia.area_id
            }
        });

        if (!area) {
            return res.status(404).json({ error: "Área no encontrada" });
        }

        if (!area.jefe_inmediato) {
            return res.status(400).json({ error: "El área no tiene jefe inmediato asignado" });
        }

        const jefe = await UsersModel.findByPk(area.jefe_inmediato);

        if (!jefe) {
            return res.status(404).json({ error: "El jefe inmediato no existe en el sistema" });
        }

        return res.json({
            usuario_aprobador_id: area.jefe_inmediato,
            aprobador: area.nombre_jefe_inmediato,
            puesto_aprobador: jefe.puesto_trabajo
        });

    } catch (err) {
        console.error("Error al obtener jefe inmediato", err);
        return res.status(500).json({ error: err.message });
    }
}

module.exports = {
    getEstrategias,
    getMatrizAprobacion,
    deleteNivelMatrizSolicitud,
    updateEstrategiaAdquisicion,
    createEstrategiaByArea,
    createMatrizAprobacionSolicitud,
    getJefeInmediatoByEstrategia
}