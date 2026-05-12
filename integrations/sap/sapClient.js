const axios = require('axios');
const https = require('https');

const agent = new https.Agent({ rejectUnauthorized: false });
const sapSessions = {};
const EmpresaModel = require('../../models/core/tbl_empresa.model');

async function obtenerEmpresaSAP(empresaId) {

    if (!empresaId) {
        throw new Error("Debe enviar empresa_id");
    }

    const empresa = await EmpresaModel.findOne({
        where: {
            id: empresaId,
            esta_activo: true
        }
    });

    if (!empresa) {
        throw new Error("Empresa no encontrada o inactiva");
    }

    return {
        id: empresa.id,
        CompanyDB: empresa.sap_database,
        UserName: empresa.sap_user,
        Password: empresa.sap_password
    };
}

async function loginSAP(empresa) {

    try {

        const response = await axios.post(
            `${process.env.SAP_URL}/Login`,
            {
                CompanyDB: empresa.CompanyDB,
                UserName: empresa.UserName,
                Password: empresa.Password
            },
            {
                httpsAgent: agent
            }
        );

        sapSessions[empresa.id] = {
            sessionId: response.data.SessionId,
            routeId: response.headers['set-cookie']
                ?.find(cookie => cookie.includes('ROUTEID'))
                ?.split(';')[0]
        };

        return sapSessions[empresa.id];

    } catch (error) {

        console.error(
            `Error login SAP empresa ${empresa.CompanyDB}:`,
            error.response?.data || error.message
        );

        throw error;
    }
}

async function obtenerSesionSAP(empresaId) {

    const empresa = await obtenerEmpresaSAP(empresaId);

    if (!sapSessions[empresa.id]) {
        await loginSAP(empresa);
    }

    return {
        empresa,
        session: sapSessions[empresa.id]
    };
}

function construirHeadersSAP(session, pageSize = 5000) {

    return {
        Cookie: `B1SESSION=${session.sessionId}; ${session.routeId}`,
        Prefer: `odata.maxpagesize=${pageSize}`
    };
}

async function productosAgrupados(req, res) {
    const executeRequest = async () => {
        if (!sapSession.id) await loginSAP();

        const headers = { 
            'Cookie': `B1SESSION=${sapSession.id}; ${sapSession.routeId}`,
            'Prefer': 'odata.maxpagesize=5000'
        };

        // 1. Obtener Categorías (Metadatos)
        const catRes = await axios.get(
            `${process.env.SAP_URL}/UserFieldsMD?$filter=Name eq 'Categoria' and TableName eq 'OITM'`,
            { headers, httpsAgent: agent }
        );
        const listaCategorias = catRes.data.value[0]?.ValidValuesMD || [];

        // 2. Obtener Productos (Datos)
        const prodRes = await axios.get(
            `${process.env.SAP_URL}/Items?$select=ItemCode,ItemName,InventoryUOM,QuantityOnStock,SalesUnit,U_Categoria&$filter=U_Categoria ne null&$top=5000`,
            { headers, httpsAgent: agent }
        );
        const todosLosProductos = prodRes.data.value || [];

        // 3. Procesamiento y Agrupación (resultadoFinal se define AQUÍ)
        const resultadoFinal = listaCategorias
            .filter(cat => cat.Value && cat.Value !== "-")
            .map(cat => {
                const categoriaId = String(cat.Value).trim();

                const productosDeEstaCat = todosLosProductos
                    .filter(item => {
                        const itemCat = item.U_Categoria ? String(item.U_Categoria).trim() : null;
                        return itemCat === categoriaId;
                    })
                    .map(item => ({
                        id: item.ItemCode,
                        name: item.ItemName,
                        unit: item.InventoryUOM || "UND",
                        currentStock: item.QuantityOnStock,
                        salesUnit: item.SalesUnit
                    }));

                return {
                    id: categoriaId,
                    name: cat.Description,
                    products: productosDeEstaCat
                };
            })
            .filter(c => c.products.length > 0);

        return resultadoFinal;
    };

    try {
        const data = await executeRequest();
        return res.json(data);
    } catch (error) {
        // Manejo de sesión expirada (401)
        if (error.response?.status === 401) {
            console.warn("Sesión de SAP expirada. Intentando relogin...");
            sapSession.id = null;
            try {
                const data = await executeRequest();
                return res.json(data);
            } catch (retryError) {
                return res.status(401).json({ 
                    error: "No autorizado", 
                    details: "La sesión de SAP no pudo restablecerse." 
                });
            }
        }

        // Error general
        console.error("Error en integración SAP:", error.response?.data || error.message);
        return res.status(500).json({ 
            error: "Error interno en la integración con SAP", 
            details: error.response?.data?.error?.message?.value || error.message 
        });
    }
}

async function obtenerProductosData() {
    const executeRequest = async () => {
        if (!sapSession.id) await loginSAP();

        const headers = { 
            'Cookie': `B1SESSION=${sapSession.id}; ${sapSession.routeId}`,
            'Prefer': 'odata.maxpagesize=5000'
        };

        const [catRes, prodRes] = await Promise.all([
            axios.get(`${process.env.SAP_URL}/UserFieldsMD?$filter=Name eq 'Categoria' and TableName eq 'OITM'`, { headers, httpsAgent: agent }),
            axios.get(`${process.env.SAP_URL}/Items?$select=ItemCode,ItemName,InventoryUOM,QuantityOnStock,SalesUnit,U_Categoria&$filter=U_Categoria ne null&$top=5000`, { headers, httpsAgent: agent })
        ]);

        const listaCategorias = catRes.data.value[0]?.ValidValuesMD || [];
        const todosLosProductos = prodRes.data.value || [];

        return listaCategorias
            .filter(cat => cat.Value && cat.Value !== "-")
            .map(cat => {
                const categoriaId = String(cat.Value).trim();
                const productosDeEstaCat = todosLosProductos
                    .filter(item => String(item.U_Categoria).trim() === categoriaId)
                    .map(item => ({
                        id: item.ItemCode,
                        name: item.ItemName,
                        unit: item.InventoryUOM || "UND",
                        currentStock: item.QuantityOnStock,
                        salesUnit: item.SalesUnit
                    }));

                return {
                    id: categoriaId,
                    name: cat.Description,
                    products: productosDeEstaCat
                };
            })
            .filter(c => c.products.length > 0);
    };

    try {
        return await executeRequest();
    } catch (error) {
        if (error.response?.status === 401) {
            sapSession.id = null;
            return await executeRequest();
        }
        throw error;
    }
}

async function obtenerGruposArticulos(req, res) {
    const executeRequest = async () => {
        if (!sapSession.id) await loginSAP();

        const headers = { 
            'Cookie': `B1SESSION=${sapSession.id}; ${sapSession.routeId}`,
            'Prefer': 'odata.maxpagesize=5000'
        };

        const itemGroups = await axios.get(`${process.env.SAP_URL}ItemGroups?$select=GroupName`, { headers, httpsAgent: agent });

        const listaGrupos = itemGroups.data.value || [];

        return listaGrupos.map(grupo => ({
            name: grupo.GroupName
        }));
    };

    try {
        const resultado = await executeRequest();

        if(res) {
            return res.json(resultado)
        }
    } catch (error) {
        if (error.response?.status === 401) {
            sapSession.id = null;
            return await executeRequest();
        }
        throw error;
    }
}

async function obtenerProductosPorGrupo(req, res) {
    const { prefix, page = 1 } = req.query;
    const pageSize = 250;
    const currentPage = parseInt(page);
    const skip = (currentPage - 1) * pageSize;

    const executeRequest = async () => {
        if (!sapSession.id) await loginSAP();

        const headers = { 
            'Cookie': `B1SESSION=${sapSession.id}; ${sapSession.routeId}`,
            'Prefer': `odata.maxpagesize=${pageSize}` 
        };

        const itemsUrl = `${process.env.SAP_URL}Items?` + 
            `$select=ItemCode,ItemName,SalesUnit&` +
            `$filter=startswith(ItemCode, '${prefix}')&` + 
            `$top=${pageSize}&` +   
            `$skip=${skip}&` +      
            `$count=true`;

        const response = await axios.get(itemsUrl, { headers, httpsAgent: agent });
        
        const totalCount = parseInt(response.data['@odata.count'] || 0);
        const items = response.data.value || [];
        const itemsEncontrados = items.length;

        const desde = totalCount === 0 ? 0 : skip + 1;
        const hasta = skip + itemsEncontrados;

        return {
            items: items,
            pagination: {
                totalCount: totalCount,
                currentPage: currentPage,
                pageSize: pageSize,
                desde: desde,
                hasta: hasta,
                mensaje: `Mostrando artículos del ${desde} al ${hasta} de ${totalCount}`,
                nextPage: hasta < totalCount ? currentPage + 1 : null
            }
        };
    };

    try {
        const resultado = await executeRequest();
        return res.json(resultado);
    } catch (error) {
        if (error.response?.status === 401) {
            sapSession.id = null;
            const retry = await executeRequest();
            return res.json(retry);
        }
        return res.status(error.response?.status || 500).json({
            error: error.response?.data?.error?.message?.value || error.message
        });
    }
}

async function verificarArticulosSAP(req, res) {
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: "Se requiere un arreglo de items con codigo_articulo" });
    }

    const executeRequest = async () => {
        if (!sapSession.id) await loginSAP();

        const headers = { 
            'Cookie': `B1SESSION=${sapSession.id}; ${sapSession.routeId}`,
        };

        const filterQuery = items
            .map(item => `ItemCode eq '${item.codigo_articulo}'`)
            .join(' or ');

        const url = `${process.env.SAP_URL}/Items?$select=ItemCode,ItemName&$filter=${filterQuery}`;
        const response = await axios.get(url, { headers, httpsAgent: agent });
        const productosSAP = response.data.value || [];

        const encontrados = [];
        const noEncontrados = [];

        items.forEach(itemOriginal => {
            const sapMatch = productosSAP.find(p => p.ItemCode === itemOriginal.codigo_articulo);

            if (sapMatch) {
                encontrados.push({
                    ...itemOriginal,
                    codigo_articulo: sapMatch.ItemCode,
                    nombre_articulo: sapMatch.ItemName,
                    existe: true
                });
            } else {
                noEncontrados.push(itemOriginal.codigo_articulo);
            }
        });

        if (noEncontrados.length > 0) {
            return {
                status: "incomplete",
                message: `No se encontraron los siguientes códigos en SAP: ${noEncontrados.join(', ')}`,
                missingCodes: noEncontrados,
                items: encontrados
            };
        }
        return {
            status: "success",
            message: "Todos los artículos fueron encontrados y validados",
            items: encontrados
        };
    };

    try {
        const resultado = await executeRequest();
        return res.json(resultado);
    } catch (error) {
        if (error.response?.status === 401) {
            sapSession.id = null;
            try {
                const retry = await executeRequest();
                return res.json(retry);
            } catch (retryErr) {
                return res.status(401).json({ error: "Error de sesión en SAP" });
            }
        }
        return res.status(500).json({ 
            error: "Error al validar artículos en SAP",
            details: error.response?.data?.error?.message?.value || error.message 
        });
    }
}

async function buscarProductosPorNombre(req, res) {

    const {
        page = 1,
        query,
        empresa_id
    } = req.query;

    const pageSize = 50;
    const currentPage = parseInt(page);
    const skip = (currentPage - 1) * pageSize;

    if (!empresa_id) {
        return res.status(400).json({
            error: "Debe enviar empresa_id"
        });
    }

    if (typeof query !== 'string' || query.trim().length < 3) {
        return res.status(400).json({
            error: "La búsqueda debe tener al menos 3 caracteres"
        });
    }

    const executeRequest = async () => {

        const { empresa, session } = await obtenerSesionSAP(empresa_id);

        const headers = construirHeadersSAP(session, pageSize);

        const safeQuery = query.replace(/'/g, "''");

        const url =
            `${process.env.SAP_URL}/Items?` +
            `$select=ItemCode,ItemName,SalesUnit&` +
            `$filter=contains(ItemName, '${safeQuery}')&` +
            `$top=${pageSize}&` +
            `$skip=${skip}&` +
            `$count=true`;

        const response = await axios.get(
            url,
            {
                headers,
                httpsAgent: agent
            }
        );

        const totalCount = parseInt(response.data['@odata.count'] || 0);

        const items = response.data.value || [];

        return {
            empresa: empresa.CompanyDB,
            items,
            pagination: {
                totalCount,
                currentPage,
                pageSize,
                hasNextPage: (skip + items.length) < totalCount
            }
        };
    };

    try {

        const resultado = await executeRequest();

        return res.json(resultado);

    } catch (error) {

        if (error.response?.status === 401) {

            delete sapSessions[empresa_id];

            try {

                const retry = await executeRequest();

                return res.json(retry);

            } catch (retryErr) {

                return res.status(401).json({
                    error: "No se pudo restablecer la sesión SAP"
                });
            }
        }

        console.error(
            "Error buscando productos SAP:",
            error.response?.data || error.message
        );

        return res.status(error.response?.status || 500).json({
            error: "Error al buscar artículos en SAP",
            details:
                error.response?.data?.error?.message?.value ||
                error.message
        });
    }
}

async function sendSolicitudCompra(solicitud) {
    const executeRequest = async () => {
        // 1. Verificar/Obtener sesión
        if (!sapSession.id) await loginSAP();

        const headers = { 
            'Cookie': `B1SESSION=${sapSession.id}; ${sapSession.routeId}`,
            'Content-Type': 'application/json'
        };

        const hoy = new Date().toISOString().split('T')[0];

        // 2. Mapear el cuerpo de la solicitud al formato de SAP
        const sapPayload = {
            DocDate: new Date().toISOString().split('T')[0],
            DocDueDate: solicitud.fecha_requerida,
            RequriedDate: solicitud.fecha_requerida,
            Comments: solicitud.justificacion,
    
            DocumentLines: solicitud.items.map(item => ({
                ItemCode: item.codigo_articulo,
                Quantity: item.cantidad,
                RequiredDate: solicitud.fecha_requerida 
            }))
        };

        // 3. Realizar el POST al Service Layer
        const response = await axios.post(
            `${process.env.SAP_URL}/PurchaseRequests`, 
            sapPayload, 
            { headers, httpsAgent: agent }
        );

        return {
            DocEntry: response.data.DocEntry,
            DocNum: response.data.DocNum
        };
    };

    try {
        const resultado = await executeRequest();
        return resultado;
    } catch (error) {
        // 4. Manejo de sesión expirada (401)
        console.log(JSON.stringify(error.response?.data, null, 2));
        if (error.response?.status === 401) {
            console.warn("Sesión expirada al enviar a SAP. Reintentando...");
            sapSession.id = null;
            try {
                return await executeRequest();
            } catch (retryError) {
                throw new Error("No se pudo restablecer la sesión de SAP para crear la solicitud.");
            }
        }

        // 5. Manejo de errores específicos de SAP (ej. Artículos cerrados, falta de stock, etc.)
        const sapErrorMessage = error.response?.data?.error?.message?.value || error.message;
        throw new Error(`SAP Service Layer dice: ${sapErrorMessage}`);
    }
}

module.exports = {
    productosAgrupados,
    obtenerProductosData,
    obtenerGruposArticulos,
    obtenerProductosPorGrupo,
    verificarArticulosSAP,
    buscarProductosPorNombre,
    sendSolicitudCompra
};