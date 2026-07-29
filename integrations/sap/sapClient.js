const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });
const EmpresaModel = require('../../models/core/tbl_empresa.model');
const initvwTiendasModulo = require('../../models/pdv/views/vwTiendasModulo.view');
const sequelizeInit = require('../../configuration/db');

const sapSessions = {
    global: null,
    byEmpresa: {}
};


function normalizeSession(data) {
    return {
        sessionId: data?.SessionId || data?.sessionId,
        routeId: data?.routeId || data?.RouteId || '',
        version: data?.Version
    };
}

async function obtenerEmpresaSAP(empresaId) {
    if (!empresaId) throw new Error("Debe enviar empresa_id");

    const empresa = await EmpresaModel.findOne({
        where: { id: empresaId, esta_activo: true }
    });

    if (!empresa) throw new Error("Empresa no encontrada o inactiva");

    return {
        id: empresa.id,
        CompanyDB: empresa.sap_database,
        UserName: empresa.sap_user,
        Password: empresa.sap_password
    };
}

async function obtenerEmpresaSAPPorTienda(id_tienda) {
    if (!id_tienda) {
        throw new Error("Debe enviar id_tienda");
    }

    const sequelizePDV = await sequelizeInit.sequelizeInit('PDV');
    const TiendaModel = initvwTiendasModulo(sequelizePDV);

    const tienda = await TiendaModel.findOne({
        where: {
            id_tienda
        }
    });

    if (!tienda) {
        throw new Error(`No existe la tienda ${id_tienda}`);
    }

    const empresa = await EmpresaModel.findOne({
        where: {
            id_pdv: tienda.codigo_empresa,
            esta_activo: true
        }
    });

    if (!empresa) {
        throw new Error(
            `No existe una empresa activa para el código PDV ${tienda.codigo_empresa}`
        );
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
        if (!empresa?.CompanyDB || !empresa?.UserName || !empresa?.Password) {
            throw new Error("Faltan credenciales SAP en empresa");
        }

        const payload = {
            CompanyDB: empresa.CompanyDB,
            UserName: empresa.UserName,
            Password: empresa.Password,
        };

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/Login`;

        const response = await axios.post(url, payload, {
            httpsAgent: agent,
            headers: { "Content-Type": "application/json" }
        });

        return normalizeSession(response.data);
    } catch (error) {
        throw error;
    }
}

async function loginSAPGlobal() {
    const empresa = await EmpresaModel.findOne({
        where: { esta_activo: true }
    });

    if (!empresa) throw new Error("No existe empresa activa para SAP global");

    const mapped = {
        id: "global",
        CompanyDB: empresa.sap_database,
        UserName: empresa.sap_user,
        Password: empresa.sap_password
    };

    const session = await loginSAP(mapped);

    sapSessions.global = session;

    return session;
}
async function getGlobalSession() {

    if (!sapSessions.global) {
        await loginSAPGlobal();
    }

    return sapSessions.global;
}

async function verificarArticulosSAP(req, res) {
    const { items } = req.body;

    if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: "Se requiere un arreglo de items" });
    }

    try {
        const session = await getGlobalSession();
        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`
        };

        const filterQuery = items
            .map(i => `ItemCode eq '${String(i.codigo_articulo || "").replace(/'/g, "''")}'`)
            .join(' or ');

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/Items?$select=ItemCode,ItemName&$filter=${filterQuery}`;
        const response = await axios.get(url, { headers, httpsAgent: agent });
        const productosSAP = response.data.value || [];
        const encontrados = [];
        const noEncontrados = [];

        for (const item of items) {
            const match = productosSAP.find(p => p.ItemCode === item.codigo_articulo);

            if (match) {
                encontrados.push({
                    ...item,
                    codigo_articulo: match.ItemCode,
                    nombre_articulo: match.ItemName,
                    existe: true
                });
            } else {
                noEncontrados.push(item.codigo_articulo);
            }
        }

        return res.json({
            status: noEncontrados.length ? "incomplete" : "success",
            missingCodes: noEncontrados,
            items: encontrados
        });

    } catch (error) {
        sapSessions.global = null;

        return res.status(500).json({
            error: "Error SAP al validar artículos",
            details: error.message
        });
    }
}

async function sendSolicitudCompra(solicitud, empresa) {
    const execute = async () => {
        let session = sapSessions[empresa.id];

        if (!session || !session.sessionId) {
            session = await loginSAP(empresa);
            sapSessions[empresa.id] = session;
        }

        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`,
            "Content-Type": "application/json"
        };

        const payload = {
            DocDate: new Date().toISOString().split('T')[0],
            DocDueDate: solicitud.fecha_requerida,
            TaxDate: new Date().toISOString().split('T')[0],
            RequriedDate: solicitud.fecha_requerida,
            Comments: solicitud.justificacion,
            DocumentLines: solicitud.items.map(i => ({
                ItemCode: i.codigo_articulo,
                Quantity: Number(i.cantidad),
                RequiredDate: solicitud.fecha_requerida,
                WarehouseCode: "01"
            }))
        };

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/PurchaseRequests`;
        const response = await axios.post(url, payload, {
            headers,
            httpsAgent: agent
        });

        return {
            DocEntry: response.data.DocEntry,
            DocNum: response.data.DocNum
        };
    };

    try {
        return await execute();
    } catch (error) {

        console.log("===== SAP ERROR =====");
        console.log("STATUS:", error.response?.status);
        console.log(JSON.stringify(error.response?.data, null, 2));

        const sapErrorData = error.response?.data?.error;
        const code = sapErrorData?.code;
        const status = error.response?.status;

        const isAuthError =
            code === "301" ||
            code === "302" ||
            code === "206" ||
            status === 401;

        if (isAuthError) {
            delete sapSessions[empresa.id];
            const newSession = await loginSAP(empresa);
            sapSessions[empresa.id] = newSession;
            return await execute();
        }

        // SAP a veces manda el mensaje como string plano,
        // a veces como { lang, value } — cubrimos ambos casos.
        const sapMessage =
            typeof sapErrorData?.message === 'string'
                ? sapErrorData.message
                : sapErrorData?.message?.value;

        const finalError = new Error(sapMessage || error.message);
        finalError.sapCode = code;
        finalError.sapStatus = status;

        throw finalError;
    }
}

async function buscarProductosPorNombre(req, res) {
    const { page = 1, query, empresa_id } = req.query;

    if (!empresa_id) {
        return res.status(400).json({ error: "Debe enviar empresa_id" });
    }

    if (!query || query.trim().length < 3) {
        return res.status(400).json({ error: "Mínimo 3 caracteres" });
    }

    const pageSize = 50;
    const skip = (page - 1) * pageSize;

    try {
        const empresa = await obtenerEmpresaSAP(empresa_id);
        let session = sapSessions.byEmpresa[empresa.id];

        if (!session || !session.sessionId) {
            session = await loginSAP(empresa);
            sapSessions.byEmpresa[empresa.id] = session;
        }

        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`
        };

        const safeQuery = query.replace(/'/g, "''");

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/Items?` +
            `$select=ItemCode,ItemName&` +
            `$filter=contains(ItemName,'${safeQuery}')&` +
            `$top=${pageSize}&$skip=${skip}&$count=true`;

        const response = await axios.get(url, { headers, httpsAgent: agent });

        return res.json({
            items: response.data.value || [],
            total: response.data['@odata.count'] || 0
        });

    } catch (error) {
        if (error.response?.status === 401) {
            delete sapSessions.byEmpresa[empresa_id];
        }

        return res.status(500).json({
            error: "Error SAP búsqueda",
            details: error.message
        });
    }
}

async function getProveedores(req, res) {
    const { query, empresa_id } = req.query;

    if (!empresa_id) {
        return res.status(400).json({ error: "Debe enviar empresa_id" });
    }

    try {
        const empresa = await obtenerEmpresaSAP(empresa_id);
        let session = sapSessions.byEmpresa[empresa.id];

        if (!session || !session.sessionId) {
            session = await loginSAP(empresa);
            sapSessions.byEmpresa[empresa.id] = session;
        }

        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`
        };

        let filterQuery = "CardType eq 'cSupplier' and Valid eq 'tYES'";

        if (query && query.trim().length > 0) {
            const safeQuery = query.replace(/'/g, "''");
            filterQuery += ` and contains(CardName, '${safeQuery}')`;
        }

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/BusinessPartners?` +
            `$select=CardCode,CardName&` +
            `$filter=${filterQuery}&` +
            `$top=20`;

        const response = await axios.get(url, { headers, httpsAgent: agent });

        return res.json({
            status: "success",
            proveedores: response.data.value || []
        });

    } catch (error) {
        if (error.response?.status === 401) {
            delete sapSessions.byEmpresa[empresa_id];
        }

        return res.status(500).json({
            error: "Error SAP al obtener proveedores",
            details: error.response?.data?.error?.message?.value || error.message
        });
    }
}

async function obtenerProductosData(id_tienda) {
    const empresa = await obtenerEmpresaSAPPorTienda(id_tienda);

    const executeRequest = async () => {
        let session = sapSessions.byEmpresa[empresa.id];

        if (!session || !session.sessionId) {
            session = await loginSAP(empresa);
            sapSessions.byEmpresa[empresa.id] = session;
        }

        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`,
            Prefer: 'odata.maxpagesize=5000'
        };

        const [catRes, prodRes] = await Promise.all([
            axios.get(
                `${process.env.SAP_URL}/UserFieldsMD?$filter=Name eq 'Categoria' and TableName eq 'OITM'`,
                { headers, httpsAgent: agent }
            ),
            axios.get(
                `${process.env.SAP_URL}/Items?$select=ItemCode,ItemName,InventoryUOM,QuantityOnStock,SalesUnit,U_Categoria&$filter=U_Categoria ne null&$top=5000`,
                { headers, httpsAgent: agent }
            )
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
        const isAuthError =
            error.response?.status === 401 ||
            error.response?.data?.error?.code === "301" ||
            error.response?.data?.error?.code === "302" ||
            error.response?.data?.error?.code === "206";

        if (isAuthError) {
            delete sapSessions.byEmpresa[empresa.id];
            return await executeRequest();
        }

        throw error;
    }
}

module.exports = {
    loginSAP,
    loginSAPGlobal,
    obtenerEmpresaSAP,
    verificarArticulosSAP,
    sendSolicitudCompra,
    buscarProductosPorNombre,
    getProveedores,
    obtenerProductosData
};