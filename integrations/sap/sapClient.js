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

// ------------------------------------------------------------
// Fecha de hoy en horario de Guatemala, formato YYYY-MM-DD. No usar
// new Date().toISOString() para esto: el servidor corre en UTC, y entre
// las 18:00 y 23:59 hora local esa fecha ya cae en el día siguiente, lo
// que hace que SAP rechace el documento con "Posting date que sea igual
// o anterior a la fecha del sistema".
// ------------------------------------------------------------
function fechaSapHoy() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date());
}

// ------------------------------------------------------------
// Conexión a la base de AVIGUA (pollo) — servidor/base distintos
// a los de las demás empresas, por eso loginSAP acepta un baseUrl
// aparte en vez de usar siempre process.env.SAP_URL.
// ------------------------------------------------------------
const SAP_AVIGUA_URL = process.env.SAP_AVIGUA_URL;
// El whsCode ya no es fijo: viene del maestro de rutas de pollo (cada ruta
// pertenece a un muelle — RAS-002/003/004), se recibe como parámetro.


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

// baseUrl es opcional: por defecto sigue usando process.env.SAP_URL como
// siempre (no rompe nada existente), pero AVIGUA pasa su propia URL.
async function loginSAP(empresa, baseUrl = process.env.SAP_URL) {
    try {
        if (!empresa?.CompanyDB || !empresa?.UserName || !empresa?.Password) {
            throw new Error("Faltan credenciales SAP en empresa");
        }

        const payload = {
            CompanyDB: empresa.CompanyDB,
            UserName: empresa.UserName,
            Password: empresa.Password,
        };

        const url = `${baseUrl.replace(/\/$/, '')}/Login`;

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
            DocDate: fechaSapHoy(),
            DocDueDate: solicitud.fecha_requerida,
            TaxDate: fechaSapHoy(),
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

// ------------------------------------------------------------
// AVIGUA (pollo): credenciales fijas por variables de entorno,
// no dependen de la tienda ni de EmpresaModel — siempre la misma base.
// ------------------------------------------------------------
function obtenerCredencialesAvigua() {
    if (!process.env.SAP_AVIGUA_BD || !process.env.SAP_AVIGUA_USER || !process.env.SAP_AVIGUA_PASSWORD) {
        throw new Error("Faltan variables de entorno SAP_AVIGUA_BD / SAP_AVIGUA_USER / SAP_AVIGUA_PASSWORD");
    }

    return {
        id: 'avigua',
        CompanyDB: process.env.SAP_AVIGUA_BD,
        UserName: process.env.SAP_AVIGUA_USER,
        Password: process.env.SAP_AVIGUA_PASSWORD
    };
}

async function getAviguaSession() {
    let session = sapSessions.byEmpresa['avigua'];

    if (!session || !session.sessionId) {
        const empresa = obtenerCredencialesAvigua();
        session = await loginSAP(empresa, SAP_AVIGUA_URL);
        sapSessions.byEmpresa['avigua'] = session;
    }

    return session;
}

// Consulta el stock disponible en la bodega indicada (el muelle de la ruta
// que se esté trabajando) para una lista de códigos de artículo, en AVIGUA.
async function consultarStockPollo(codigosArticulo, whsCode) {
    const codigosUnicos = [...new Set((codigosArticulo || []).filter(Boolean))];

    if (codigosUnicos.length === 0) {
        return [];
    }

    if (!whsCode) {
        throw new Error('whsCode es requerido para consultar stock de pollo');
    }

    const executeRequest = async () => {
        const session = await getAviguaSession();
        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`
        };

        // Se consulta un artículo a la vez (secuencial, no en paralelo):
        // SAP Service Layer no soporta bien varias peticiones concurrentes
        // usando la misma sesión (B1SESSION) — dispara errores de bloqueo.
        const resultados = [];

        for (const codigo of codigosUnicos) {
            const codigoEscapado = String(codigo).replace(/'/g, "''");
            const url = `${SAP_AVIGUA_URL.replace(/\/$/, '')}/Items('${codigoEscapado}')`;

            try {
                const response = await axios.get(url, { headers, httpsAgent: agent });
                const item = response.data;
                const infoBodega = (item.ItemWarehouseInfoCollection || [])
                    .find(w => w.WarehouseCode === whsCode);

                // InStock viene en la Unidad de Inventario (ej. Libra), no en la
                // Unidad de Venta (ej. Bolsa) — se calcula cuántas bolsas
                // completas hay usando SalesItemsPerUnit como factor de
                // conversión, para no comparar libras contra bolsas.
                const stockDisponible = infoBodega ? infoBodega.InStock : 0;
                const salesItemsPerUnit = item.SalesItemsPerUnit || 1;
                const bolsasCompletas = Math.floor(stockDisponible / salesItemsPerUnit);

                resultados.push({
                    codigo_articulo: item.ItemCode,
                    nombre_articulo: item.ItemName,
                    stock_disponible: stockDisponible,
                    unidad_venta: item.SalesUnit,
                    sales_items_per_unit: salesItemsPerUnit,
                    bolsas_completas: bolsasCompletas
                });
            } catch (err) {
                if (err.response?.status === 404) {
                    continue; // el artículo no existe en esta base de SAP
                }
                throw err; // otros errores (ej. sesión expirada) sí deben propagarse
            }
        }

        return resultados;
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
            delete sapSessions.byEmpresa['avigua'];
            return await executeRequest();
        }

        console.log("===== SAP AVIGUA ERROR =====");
        console.log("STATUS:", error.response?.status);
        console.log(JSON.stringify(error.response?.data, null, 2));

        const sapErrorData = error.response?.data?.error;
        const sapMessage =
            typeof sapErrorData?.message === 'string'
                ? sapErrorData.message
                : sapErrorData?.message?.value;

        const finalError = new Error(sapMessage || error.message);
        finalError.sapCode = sapErrorData?.code;
        finalError.sapStatus = error.response?.status;

        throw finalError;
    }
}

// ------------------------------------------------------------
// INSUMOS: una sola conexión SAP fija (variables de entorno genéricas),
// bodega siempre "01". A diferencia de POLLO, no hay múltiples muelles.
// ------------------------------------------------------------
const WHS_INSUMOS = '01';

function obtenerCredencialesInsumos() {
    if (!process.env.SAP_COMPANY_DB || !process.env.SAP_USER || !process.env.SAP_PASSWORD) {
        throw new Error("Faltan variables de entorno SAP_COMPANY_DB / SAP_USER / SAP_PASSWORD");
    }

    return {
        id: 'insumos',
        CompanyDB: process.env.SAP_COMPANY_DB,
        UserName: process.env.SAP_USER,
        Password: process.env.SAP_PASSWORD
    };
}

async function getInsumosSession() {
    let session = sapSessions.byEmpresa['insumos'];

    if (!session || !session.sessionId) {
        const empresa = obtenerCredencialesInsumos();
        session = await loginSAP(empresa, process.env.SAP_URL);
        sapSessions.byEmpresa['insumos'] = session;
    }

    return session;
}

// Busca artículos de activo fijo (prefijo "UC" en ItemCode) por nombre,
// en la misma base fija de insumos. Usada por Pedidos de Activos Fijos.
async function buscarActivosFijos(req, res) {
    const { page = 1, query } = req.query;

    if (!query || query.trim().length < 3) {
        return res.status(400).json({ error: "Mínimo 3 caracteres" });
    }

    const pageSize = 50;
    const skip = (page - 1) * pageSize;

    try {
        const session = await getInsumosSession();
        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`
        };

        const safeQuery = query.replace(/'/g, "''");

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/Items?` +
            `$select=ItemCode,ItemName&` +
            `$filter=startswith(ItemCode,'UC') and contains(ItemName,'${safeQuery}')&` +
            `$top=${pageSize}&$skip=${skip}&$count=true`;

        const response = await axios.get(url, { headers, httpsAgent: agent });

        return res.json({
            items: response.data.value || [],
            total: response.data['@odata.count'] || 0
        });

    } catch (error) {
        if (error.response?.status === 401) {
            delete sapSessions.byEmpresa['insumos'];
        }

        return res.status(500).json({
            error: "Error SAP búsqueda de activos fijos",
            details: error.message
        });
    }
}

// Consulta el stock disponible en el WhsCode indicado (por defecto la
// bodega fija "01") para una lista de códigos de artículo, en la base fija
// de insumos. El segundo parámetro permite consultar otra bodega (por
// ejemplo la bodega móvil de un camión) sin romper a quien ya la llama solo
// con codigosArticulo.
async function consultarStockInsumos(codigosArticulo, whsCode = WHS_INSUMOS) {
    const codigosUnicos = [...new Set((codigosArticulo || []).filter(Boolean))];

    if (codigosUnicos.length === 0) {
        return [];
    }

    const executeRequest = async () => {
        const session = await getInsumosSession();
        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`
        };

        // Igual que en POLLO: se consulta un artículo a la vez porque
        // ItemWarehouseInfoCollection solo viene completo en GET de un
        // solo Item, y varias peticiones concurrentes con la misma
        // sesión causan errores de bloqueo en SAP.
        const resultados = [];

        for (const codigo of codigosUnicos) {
            const codigoEscapado = String(codigo).replace(/'/g, "''");
            const url = `${process.env.SAP_URL.replace(/\/$/, '')}/Items('${codigoEscapado}')`;

            try {
                const response = await axios.get(url, { headers, httpsAgent: agent });
                const item = response.data;
                const infoBodega = (item.ItemWarehouseInfoCollection || [])
                    .find(w => w.WarehouseCode === whsCode);

                resultados.push({
                    codigo_articulo: item.ItemCode,
                    nombre_articulo: item.ItemName,
                    stock_disponible: infoBodega ? infoBodega.InStock : 0
                });
            } catch (err) {
                if (err.response?.status === 404) {
                    continue;
                }
                throw err;
            }
        }

        return resultados;
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
            delete sapSessions.byEmpresa['insumos'];
            return await executeRequest();
        }

        console.log("===== SAP INSUMOS ERROR =====");
        console.log("STATUS:", error.response?.status);
        console.log(JSON.stringify(error.response?.data, null, 2));

        const sapErrorData = error.response?.data?.error;
        const sapMessage =
            typeof sapErrorData?.message === 'string'
                ? sapErrorData.message
                : sapErrorData?.message?.value;

        const finalError = new Error(sapMessage || error.message);
        finalError.sapCode = sapErrorData?.code;
        finalError.sapStatus = error.response?.status;

        throw finalError;
    }
}

// ------------------------------------------------------------
// Crea la transferencia de inventario (OWTR / StockTransfers) de la
// bodega origen a la bodega destino de la ruta, en la base de AVIGUA.
// lineas: [{ codigo_producto, cantidad }]
// ------------------------------------------------------------
async function crearTransferenciaPollo({ fromWarehouse, toWarehouse, lineas, comentarios }) {
    if (!fromWarehouse || !toWarehouse) {
        throw new Error('fromWarehouse y toWarehouse son requeridos');
    }

    if (!lineas || lineas.length === 0) {
        throw new Error('Se requiere al menos una línea para transferir');
    }

    const executeRequest = async () => {
        const session = await getAviguaSession();
        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`,
            'Content-Type': 'application/json'
        };

        const payload = {
            DocDate: fechaSapHoy(),
            FromWarehouse: fromWarehouse,
            ToWarehouse: toWarehouse,
            Comments: comentarios || undefined,
            StockTransferLines: lineas.map(l => ({
                ItemCode: l.codigo_producto,
                Quantity: Number(l.cantidad),
                WarehouseCode: toWarehouse,
                FromWarehouseCode: fromWarehouse
            }))
        };

        const url = `${SAP_AVIGUA_URL.replace(/\/$/, '')}/StockTransfers`;
        const response = await axios.post(url, payload, { headers, httpsAgent: agent });

        return { DocEntry: response.data.DocEntry, DocNum: response.data.DocNum };
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
            delete sapSessions.byEmpresa['avigua'];
            return await executeRequest();
        }

        console.log("===== SAP AVIGUA TRANSFERENCIA ERROR =====");
        console.log("STATUS:", error.response?.status);
        console.log(JSON.stringify(error.response?.data, null, 2));

        const sapErrorData = error.response?.data?.error;
        const sapMessage =
            typeof sapErrorData?.message === 'string'
                ? sapErrorData.message
                : sapErrorData?.message?.value;

        const finalError = new Error(sapMessage || error.message);
        finalError.sapCode = sapErrorData?.code;
        finalError.sapStatus = error.response?.status;

        throw finalError;
    }
}

// Igual que crearTransferenciaPollo, pero en la base fija de insumos
// (WhsCode origen siempre "01").
async function crearTransferenciaInsumos({ fromWarehouse, toWarehouse, lineas, comentarios }) {
    if (!fromWarehouse || !toWarehouse) {
        throw new Error('fromWarehouse y toWarehouse son requeridos');
    }

    if (!lineas || lineas.length === 0) {
        throw new Error('Se requiere al menos una línea para transferir');
    }

    const executeRequest = async () => {
        const session = await getInsumosSession();
        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`,
            'Content-Type': 'application/json'
        };

        const payload = {
            DocDate: fechaSapHoy(),
            FromWarehouse: fromWarehouse,
            ToWarehouse: toWarehouse,
            Comments: comentarios || undefined,
            StockTransferLines: lineas.map(l => ({
                ItemCode: l.codigo_producto,
                Quantity: Number(l.cantidad),
                WarehouseCode: toWarehouse,
                FromWarehouseCode: fromWarehouse
            }))
        };

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/StockTransfers`;
        const response = await axios.post(url, payload, { headers, httpsAgent: agent });

        return { DocEntry: response.data.DocEntry, DocNum: response.data.DocNum };
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
            delete sapSessions.byEmpresa['insumos'];
            return await executeRequest();
        }

        console.log("===== SAP INSUMOS TRANSFERENCIA ERROR =====");
        console.log("STATUS:", error.response?.status);
        console.log(JSON.stringify(error.response?.data, null, 2));

        const sapErrorData = error.response?.data?.error;
        const sapMessage =
            typeof sapErrorData?.message === 'string'
                ? sapErrorData.message
                : sapErrorData?.message?.value;

        const finalError = new Error(sapMessage || error.message);
        finalError.sapCode = sapErrorData?.code;
        finalError.sapStatus = error.response?.status;

        throw finalError;
    }
}

// ------------------------------------------------------------
// Crea la entrega (Deliveries) del camión al piloto, en AVIGUA. El piloto
// se registra como el cliente (CardCode) de esa entrega — no hay tienda de
// por medio, es el mismo botón "Entregar Producto" del camión completo.
// lineas: [{ codigo_producto, cantidad }]
// ------------------------------------------------------------
async function crearEntregaPollo({ cardCode, whsCode, lineas, comentarios }) {
    if (!cardCode || !whsCode) {
        throw new Error('cardCode y whsCode son requeridos');
    }

    if (!lineas || lineas.length === 0) {
        throw new Error('Se requiere al menos una línea para entregar');
    }

    const executeRequest = async () => {
        const session = await getAviguaSession();
        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`,
            'Content-Type': 'application/json'
        };

        const payload = {
            CardCode: cardCode,
            DocDate: fechaSapHoy(),
            Comments: comentarios || undefined,
            DocumentLines: lineas.map(l => ({
                ItemCode: l.codigo_producto,
                Quantity: Number(l.cantidad),
                WarehouseCode: whsCode
            }))
        };

        const url = `${SAP_AVIGUA_URL.replace(/\/$/, '')}/Deliveries`;
        const response = await axios.post(url, payload, { headers, httpsAgent: agent });

        return { DocEntry: response.data.DocEntry, DocNum: response.data.DocNum };
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
            delete sapSessions.byEmpresa['avigua'];
            return await executeRequest();
        }

        console.log("===== SAP AVIGUA ENTREGA ERROR =====");
        console.log("STATUS:", error.response?.status);
        console.log(JSON.stringify(error.response?.data, null, 2));

        const sapErrorData = error.response?.data?.error;
        const sapMessage =
            typeof sapErrorData?.message === 'string'
                ? sapErrorData.message
                : sapErrorData?.message?.value;

        const finalError = new Error(sapMessage || error.message);
        finalError.sapCode = sapErrorData?.code;
        finalError.sapStatus = error.response?.status;

        throw finalError;
    }
}

// Igual que crearEntregaPollo, pero en la base fija de insumos.
async function crearEntregaInsumos({ cardCode, whsCode, lineas, comentarios }) {
    if (!cardCode || !whsCode) {
        throw new Error('cardCode y whsCode son requeridos');
    }

    if (!lineas || lineas.length === 0) {
        throw new Error('Se requiere al menos una línea para entregar');
    }

    const executeRequest = async () => {
        const session = await getInsumosSession();
        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`,
            'Content-Type': 'application/json'
        };

        const payload = {
            CardCode: cardCode,
            DocDate: fechaSapHoy(),
            Comments: comentarios || undefined,
            DocumentLines: lineas.map(l => ({
                ItemCode: l.codigo_producto,
                Quantity: Number(l.cantidad),
                WarehouseCode: whsCode
            }))
        };

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/Deliveries`;
        const response = await axios.post(url, payload, { headers, httpsAgent: agent });

        return { DocEntry: response.data.DocEntry, DocNum: response.data.DocNum };
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
            delete sapSessions.byEmpresa['insumos'];
            return await executeRequest();
        }

        console.log("===== SAP INSUMOS ENTREGA ERROR =====");
        console.log("STATUS:", error.response?.status);
        console.log(JSON.stringify(error.response?.data, null, 2));

        const sapErrorData = error.response?.data?.error;
        const sapMessage =
            typeof sapErrorData?.message === 'string'
                ? sapErrorData.message
                : sapErrorData?.message?.value;

        const finalError = new Error(sapMessage || error.message);
        finalError.sapCode = sapErrorData?.code;
        finalError.sapStatus = error.response?.status;

        throw finalError;
    }
}

// ------------------------------------------------------------
// Bodegas de cuarto frío (WhsCode que empieza con "CFR-") disponibles como
// destino del botón "Trasladar a Cuarto Frío". A diferencia del inventario
// completo, esto sí funciona con un solo $filter directo (startswith),
// sin lambda ni $expand anidado — es el mismo tipo de filtro que ya usa
// buscarActivosFijos más arriba, así que no debería toparse con la misma
// limitación de Service Layer.
// ------------------------------------------------------------
async function obtenerBodegasCuartoFrioPollo() {
    const executeRequest = async () => {
        const session = await getAviguaSession();
        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`
        };

        const url = `${SAP_AVIGUA_URL.replace(/\/$/, '')}/Warehouses?` +
            `$select=WarehouseCode,WarehouseName&` +
            `$filter=startswith(WarehouseCode,'CFR-')`;

        const response = await axios.get(url, { headers, httpsAgent: agent });
        const bodegas = response.data.value || [];

        return bodegas.map(b => ({ whs_code: b.WarehouseCode, nombre: b.WarehouseName }));
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
            delete sapSessions.byEmpresa['avigua'];
            return await executeRequest();
        }

        console.log("===== SAP AVIGUA BODEGAS CUARTO FRIO ERROR =====");
        console.log("STATUS:", error.response?.status);
        console.log(JSON.stringify(error.response?.data, null, 2));

        const sapErrorData = error.response?.data?.error;
        const sapMessage =
            typeof sapErrorData?.message === 'string'
                ? sapErrorData.message
                : sapErrorData?.message?.value;

        const finalError = new Error(sapMessage || error.message);
        finalError.sapCode = sapErrorData?.code;
        finalError.sapStatus = error.response?.status;

        throw finalError;
    }
}

// Igual que obtenerBodegasCuartoFrioPollo, pero en la base fija de insumos.
async function obtenerBodegasCuartoFrioInsumos() {
    const executeRequest = async () => {
        const session = await getInsumosSession();
        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`
        };

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/Warehouses?` +
            `$select=WarehouseCode,WarehouseName&` +
            `$filter=startswith(WarehouseCode,'CFR-')`;

        const response = await axios.get(url, { headers, httpsAgent: agent });
        const bodegas = response.data.value || [];

        return bodegas.map(b => ({ whs_code: b.WarehouseCode, nombre: b.WarehouseName }));
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
            delete sapSessions.byEmpresa['insumos'];
            return await executeRequest();
        }

        console.log("===== SAP INSUMOS BODEGAS CUARTO FRIO ERROR =====");
        console.log("STATUS:", error.response?.status);
        console.log(JSON.stringify(error.response?.data, null, 2));

        const sapErrorData = error.response?.data?.error;
        const sapMessage =
            typeof sapErrorData?.message === 'string'
                ? sapErrorData.message
                : sapErrorData?.message?.value;

        const finalError = new Error(sapMessage || error.message);
        finalError.sapCode = sapErrorData?.code;
        finalError.sapStatus = error.response?.status;

        throw finalError;
    }
}

// ------------------------------------------------------------
// Busca clientes (CardType 'cCustomer') por nombre, en AVIGUA — para poder
// asignarle a un piloto su CardCode en la vista de mantenimiento.
// ------------------------------------------------------------
async function buscarClientesPollo(query) {
    const executeRequest = async () => {
        const session = await getAviguaSession();
        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`
        };

        let filterQuery = "CardType eq 'cCustomer'";
        if (query && query.trim().length > 0) {
            const safeQuery = query.replace(/'/g, "''");
            filterQuery += ` and contains(CardName,'${safeQuery}')`;
        }

        const url = `${SAP_AVIGUA_URL.replace(/\/$/, '')}/BusinessPartners?` +
            `$select=CardCode,CardName&$filter=${filterQuery}&$top=20`;

        const response = await axios.get(url, { headers, httpsAgent: agent });
        return response.data.value || [];
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
            delete sapSessions.byEmpresa['avigua'];
            return await executeRequest();
        }

        const sapErrorData = error.response?.data?.error;
        const sapMessage =
            typeof sapErrorData?.message === 'string' ? sapErrorData.message : sapErrorData?.message?.value;

        throw new Error(sapMessage || error.message);
    }
}

// Igual que buscarClientesPollo, pero en la base fija de insumos.
async function buscarClientesInsumos(query) {
    const executeRequest = async () => {
        const session = await getInsumosSession();
        const headers = {
            Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`
        };

        let filterQuery = "CardType eq 'cCustomer'";
        if (query && query.trim().length > 0) {
            const safeQuery = query.replace(/'/g, "''");
            filterQuery += ` and contains(CardName,'${safeQuery}')`;
        }

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/BusinessPartners?` +
            `$select=CardCode,CardName&$filter=${filterQuery}&$top=20`;

        const response = await axios.get(url, { headers, httpsAgent: agent });
        return response.data.value || [];
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
            delete sapSessions.byEmpresa['insumos'];
            return await executeRequest();
        }

        const sapErrorData = error.response?.data?.error;
        const sapMessage =
            typeof sapErrorData?.message === 'string' ? sapErrorData.message : sapErrorData?.message?.value;

        throw new Error(sapMessage || error.message);
    }
}

module.exports = {
    loginSAP,
    loginSAPGlobal,
    obtenerEmpresaSAP,
    verificarArticulosSAP,
    sendSolicitudCompra,
    buscarProductosPorNombre,
    buscarActivosFijos,
    getProveedores,
    WHS_INSUMOS,
    obtenerProductosData,
    consultarStockPollo,
    consultarStockInsumos,
    crearTransferenciaPollo,
    crearTransferenciaInsumos,
    obtenerBodegasCuartoFrioPollo,
    obtenerBodegasCuartoFrioInsumos,
    buscarClientesPollo,
    buscarClientesInsumos,
    crearEntregaPollo,
    crearEntregaInsumos
};