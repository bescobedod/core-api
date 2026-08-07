const CamionInspeccionModel = require('../../models/core/tbl_camion_inspeccion.model');
const CamionModel = require('../../models/core/tbl_camion.model');
const UsersModel = require('../../models/pioapp/users.model');
const ValesCombustibleModel = require('../../models/core/tbl_vales_combustible.model');
const { Op } = require('sequelize');

async function getInspecciones(req, res) {
    const {
        placa,
        nombre_conductor,
        inicio,
        fin,
        page = 1,
        limit = 20
    } = req.query;

    // Validaciones para evitar strings 'null' o vacíos
    const inicioValido = inicio && inicio !== 'null' && inicio.trim() !== '';
    const finValido = fin && fin !== 'null' && fin.trim() !== '';

    try {
        const where = {};

        if (placa) {
            where.placa_vehiculo = { [Op.iLike]: `%${placa}%` };
        }

        if (nombre_conductor) {
            const palabras = nombre_conductor.trim().split(/\s+/);

            where[Op.and] = palabras.map(palabra => ({
                nombre_conductor: { [Op.iLike]: `%${palabra}%` }
            }));
        }

        if (inicioValido && !finValido) {
            // Caso 1: Fecha única (Solo mandan inicio)
            where.fecha_inspeccion = {
                [Op.between]: [
                    new Date(`${inicio} 00:00:00`),
                    new Date(`${inicio} 23:59:59`)
                ]
            };
        } else if (inicioValido && finValido) {
            // Caso 2: Rango de fechas (Mandan inicio y fin)
            where.fecha_inspeccion = {
                [Op.between]: [
                    new Date(`${inicio} 00:00:00`),
                    new Date(`${fin} 23:59:59`)
                ]
            };
        }

        const pageNumber = Number(page);
        const pageSize   = Number(limit);
        const offset     = (pageNumber - 1) * pageSize;

        const { count: total, rows: inspecciones } = await CamionInspeccionModel.findAndCountAll({
            where,
            order: [['fecha_inspeccion', 'DESC']],
            limit:  pageSize,
            offset
        });

        if (inspecciones.length === 0) {
            return res.status(404).json({
                error: 'No se encuentran inspecciones con los parámetros seleccionados'
            });
        }

        const userIds = [...new Set(inspecciones.map(i => i.id_usuario))];

        const usuarios = await UsersModel.findAll({
            where: { id_users: { [Op.in]: userIds } },
            attributes: [
                'id_users',
                'first_name',
                'second_name',
                'first_last_name',
                'second_last_name',
                'puesto_trabajo',
                'email'
            ]
        });

        const usuariosMap = new Map();
        usuarios.forEach(u => usuariosMap.set(Number(u.id_users), u));

        // 1. Obtener todas las fechas de inspecciones para buscar vales
        const fechasInspecciones = inspecciones.map(i => {
            const fecha = new Date(i.fecha_inspeccion);
            return {
                inicio: new Date(`${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')} 00:00:00`),
                fin: new Date(`${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')} 23:59:59`)
            };
        });

        // Crear un conjunto de fechas únicas para el rango de la consulta masiva
        const fechasUnicas = [];
        const fechasVistas = new Set();
        fechasInspecciones.forEach(f => {
            const key = f.inicio.toISOString().split('T')[0];
            if (!fechasVistas.has(key)) {
                fechasVistas.add(key);
                fechasUnicas.push(f);
            }
        });

        // 2. Extraer todas las placas de las inspecciones actuales para optimizar la query de vales
        const placasEnInspecciones = [...new Set(inspecciones.map(i => i.placa_vehiculo))];

        // 3. Buscar vales filtrando por rango de fechas Y por el listado de placas obtenidas
        const valesExistentes = await ValesCombustibleModel.findAll({
            where: {
                createdAt: {
                    [Op.gte]: Math.min(...fechasUnicas.map(f => f.inicio)),
                    [Op.lte]: Math.max(...fechasUnicas.map(f => f.fin))
                },
                placa_vehiculo: {
                    [Op.in]: placasEnInspecciones // <-- Nueva restricción para no traer vales de otros camiones
                }
            }
        });

        // 4. Crear un mapa utilizando una clave compuesta: "FECHA_PLACA"
        const mapValesPorFechaYPlaca = new Map();
        valesExistentes.forEach(vale => {
            const fecha = vale.createdAt.toISOString().split('T')[0];
            // Normalizamos la placa a mayúsculas para evitar fallos por minúsculas/mayúsculas
            const placaNormalizada = vale.placa_vehiculo.trim().toUpperCase(); 
            
            const compositeKey = `${fecha}_${placaNormalizada}`;
            
            if (!mapValesPorFechaYPlaca.has(compositeKey)) {
                mapValesPorFechaYPlaca.set(compositeKey, []);
            }
            mapValesPorFechaYPlaca.get(compositeKey).push(vale);
        });

        const data = inspecciones.map(inspeccion => {
            const u = usuariosMap.get(Number(inspeccion.id_usuario));
            
            // 5. Verificar usando la clave compuesta correspondiente a esta inspección
            const fechaInspeccion = new Date(inspeccion.fecha_inspeccion).toISOString().split('T')[0];
            const placaInspeccionNormalizada = inspeccion.placa_vehiculo.trim().toUpperCase();
            
            const compositeKeyBusqueda = `${fechaInspeccion}_${placaInspeccionNormalizada}`;
            const tieneVale = mapValesPorFechaYPlaca.has(compositeKeyBusqueda);

            const nombre_completo = u
                ? [u.first_name, u.second_name, u.first_last_name, u.second_last_name]
                    .filter(Boolean)
                    .join(' ')
                : null;

            return {
                ...inspeccion.toJSON(),
                tiene_vale_combustible: tieneVale,
                usuario: u
                    ? {
                        id:             u.id_users,
                        nombre:         nombre_completo,
                        puesto_trabajo: u.puesto_trabajo || null,
                        email:          u.email          || null
                    }
                    : null
            };
        });

        return res.json({
            data,
            pagination: {
                total,
                totalPages:  Math.ceil(total / pageSize),
                currentPage: pageNumber,
                pageSize,
                hasNextPage: pageNumber < Math.ceil(total / pageSize),
                hasPrevPage: pageNumber > 1
            }
        });

    } catch (err) {
        console.error('Error al obtener inspecciones de camiones:', err);
        return res.status(500).json({ error: err.message });
    }
}

// ------------------------------------------------------------
// Lista todos los camiones (para dropdowns de asignación, etc.)
// ------------------------------------------------------------
async function getAllCamiones(req, res) {
    try {
        const camiones = await CamionModel.findAll({
            order: [['placa', 'ASC']]
        });

        return res.json(camiones);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

module.exports = {
    getInspecciones,
    getAllCamiones
};