const UserModel = require('../../models/core/tbl_usuario.model');
const UsersModel = require('../../models/pioapp/users.model');
const NivelMatrizAprobacionSolicitudModel = require('../../models/core/tbl_nivel_matriz_aprobacion_solicitud_compra.model');
const sap = require('../../integrations/sap/sapClient');
const { Op, fn, col, where } = require('sequelize');
const { sequelize } = require('../../configuration/db');

async function getUsersByDepartamento(req, res) {
    const { id_matriz } = req.params;

    try {
        const niveles = await NivelMatrizAprobacionSolicitudModel.findAll({
            where: {
                matriz_id: id_matriz
            }
        });

        const usuariosEnMatriz = niveles.map(n => n.usuario_aprobador_id);
        const usuarios = await UsersModel.findAll({
            where: {
                id_departamento: req.user.id_departamento,
                id_users: {
                    [Op.notIn]: usuariosEnMatriz.length > 0 ? usuariosEnMatriz: [0]
                }
            }
        });

        if(usuarios.length === 0) {
            throw new Error("Usuarios no encontrados");
        }

        return res.json(usuarios);
    } catch (err) {
        return res.status(500).json({ err: err.message });
    }
}

async function getUsersByDepartamento2(req, res) {
    const { departamento_id } = req.params;

    try {
        const usuarios = await UsersModel.findAll({
            where: {
                id_departamento: departamento_id
            }
        })

        if(usuarios.length === 0) {
            return res.status(404).json({ error: "No se encontraron usuarios en el departamento seleccionado" });
        }

        return res.json(usuarios);
    } catch (err) {
        return res.status(500).json({ err: err.message });
    }
}

async function searchUsers(req, res) {
    let { query, departamento_id } = req.query;

    try {
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: "El parámetro query es requerido" });
        }

        query = query.trim();

        if (query.length < 2) {
            return res.json([]);
        }

        if (query.length > 50) {
            return res.status(400).json({ error: "Query demasiado largo" });
        }

        const sanitizedQuery = query.replace(/[%_]/g, '');
        const likePattern = `%${sanitizedQuery}%`;
        const whereCondition = {
            [Op.or]: [
                {
                    first_name: {
                        [Op.iLike]: likePattern
                    }
                },
                {
                    second_name: {
                        [Op.iLike]: likePattern
                    }
                },
                {
                    first_last_name: {
                        [Op.iLike]: likePattern
                    }
                },
                {
                    second_last_name: {
                        [Op.iLike]: likePattern
                    }
                },
                {
                    codigo_user: {
                        [Op.iLike]: likePattern
                    }
                }
            ]
        };
        
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(departamento_id);

        if (departamento_id && !isUUID) {
            return res.status(400).json({ error: "departamento_id inválido" });
        }

        if (departamento_id) {
            whereCondition.id_departamento != departamento_id;
        }

        const usuarios = await UsersModel.findAll({
            where: whereCondition,
            attributes: ['id_users', 'first_name', 'second_name', 'first_last_name', 'second_last_name', 'codigo_user', 'email']
        });

        return res.json(usuarios);

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

module.exports = {
    getUsersByDepartamento,
    getUsersByDepartamento2,
    searchUsers
}