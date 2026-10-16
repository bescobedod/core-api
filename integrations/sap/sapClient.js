const axios = require('axios');
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });
const EmpresaModel = require('../../models/core/tbl_empresa.model');
const initvwTiendasModulo = require('../../models/pdv/views/vwTiendasModulo.view');
const sequelizeInit = require('../../configuration/db');

// ------------------------------------------------------------
// Sesiones del Service Layer
//
// Cada base/credencial tiene UNA sesión guardada en memoria, por clave:
// 'insumos', 'avigua', 'global' o el id de la empresa (EmpresaModel). La
// sesión se reutiliza entre llamadas y solo se inicia otra cuando no hay o
// cuando SAP la rechaza: el Service Layer cierra las sesiones inactivas
// (30 min por defecto) y la siguiente llamada recibe 401 / código 301.
//
// REGLA para toda llamada a SAP (incluidas las nuevas): obtener la sesión con
// uno de los get*Session de abajo DENTRO de la función de la petición, y
// ejecutarla con conReintentoSesion(clave, peticion). Así, si la sesión
// venció, se inicia sesión otra vez y se reintenta una vez sin que el
// usuario vea el error. No manejar el 401 a mano en cada función.
// ------------------------------------------------------------
const sapSessions = {
    byEmpresa: {}
};

function esErrorDeSesionSap(error) {
    const status = error?.response?.status;
    const code = error?.response?.data?.error?.code;

    return status === 401 || code === "301" || code === "302" || code === "206"
        || code === 301 || code === 302 || code === 206;
}

// Ejecuta peticion(); si SAP responde que la sesión de `clave` no es válida,
// la descarta y reintenta UNA vez (la petición vuelve a pedir la sesión y,
// al no haber, se inicia una nueva). Cualquier otro error se propaga igual.
async function conReintentoSesion(clave, peticion) {
    try {
        return await peticion();
    } catch (error) {
        if (!esErrorDeSesionSap(error)) throw error;

        delete sapSessions.byEmpresa[clave];
        return await peticion();
    }
}

async function obtenerSesion(clave, login) {
    let session = sapSessions.byEmpresa[clave];

    if (!session || !session.sessionId) {
        session = await login();
        sapSessions.byEmpresa[clave] = session;
    }

    return session;
}

function headersSesion(session, extra = {}) {
    return {
        Cookie: `B1SESSION=${session.sessionId}; ROUTEID=${session.routeId}`,
        ...extra
    };
}

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

// OWTR/ODLN.Comments es NVARCHAR(254): SAP rechaza el documento completo si
// se pasa. Se corta en el último ", " que quepa y se indica cuántos quedaron fuera.
const SAP_COMMENTS_MAX = 254;

function ajustarComentariosSap(texto) {
    if (!texto || texto.length <= SAP_COMMENTS_MAX) return texto;

    const reserva = 14; // espacio para "… (+999 más)"
    const corte = texto.lastIndexOf(', ', SAP_COMMENTS_MAX - reserva);
    const visible = corte > 0 ? texto.slice(0, corte) : texto.slice(0, SAP_COMMENTS_MAX - reserva);
    const omitidos = texto.slice(visible.length).split(', ').filter(Boolean).length;

    return `${visible}… (+${omitidos} más)`;
}

// ------------------------------------------------------------
// Conexión a la base de AVIGUA (pollo) — servidor/base distintos
// a los de las demás empresas, por eso loginSAP acepta un baseUrl
// aparte en vez de usar siempre process.env.SAP_URL.
// ------------------------------------------------------------
const SAP_AVIGUA_URL = process.env.SAP_AVIGUA_URL;
const SAP_AVIGUA_BD = process.env.SAP_AVIGUA_BD
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

    sapSessions.byEmpresa['global'] = session;

    return session;
}

function getGlobalSession() {
    return obtenerSesion('global', loginSAPGlobal);
}

// Sesión de una empresa de EmpresaModel (lo que devuelven obtenerEmpresaSAP /
// obtenerEmpresaSAPPorTienda). Clave = empresa.id.
function getSesionEmpresa(empresa) {
    return obtenerSesion(empresa.id, () => loginSAP(empresa));
}

async function verificarArticulosSAP(req, res) {
    const { items } = req.body;

    if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: "Se requiere un arreglo de items" });
    }

    try {
        const filterQuery = items
            .map(i => `ItemCode eq '${String(i.codigo_articulo || "").replace(/'/g, "''")}'`)
            .join(' or ');

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/Items?$select=ItemCode,ItemName&$filter=${filterQuery}`;
        const response = await conReintentoSesion('global', async () => {
            const session = await getGlobalSession();
            return axios.get(url, { headers: headersSesion(session), httpsAgent: agent });
        });
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
        return res.status(500).json({
            error: "Error SAP al validar artículos",
            details: error.message
        });
    }
}

async function sendSolicitudCompra(solicitud, empresa) {
    const execute = async () => {
        const session = await getSesionEmpresa(empresa);
        const headers = headersSesion(session, { "Content-Type": "application/json" });

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
        return await conReintentoSesion(empresa.id, execute);
    } catch (error) {

        console.log("===== SAP ERROR =====");
        console.log("STATUS:", error.response?.status);
        console.log(JSON.stringify(error.response?.data, null, 2));

        const sapErrorData = error.response?.data?.error;
        const code = sapErrorData?.code;
        const status = error.response?.status;

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
        const safeQuery = query.replace(/'/g, "''");

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/Items?` +
            `$select=ItemCode,ItemName&` +
            `$filter=contains(ItemName,'${safeQuery}')&` +
            `$top=${pageSize}&$skip=${skip}&$count=true`;

        const response = await conReintentoSesion(empresa.id, async () => {
            const session = await getSesionEmpresa(empresa);
            return axios.get(url, { headers: headersSesion(session), httpsAgent: agent });
        });

        return res.json({
            items: response.data.value || [],
            total: response.data['@odata.count'] || 0
        });

    } catch (error) {
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

        let filterQuery = "CardType eq 'cSupplier' and Valid eq 'tYES'";

        if (query && query.trim().length > 0) {
            const safeQuery = query.replace(/'/g, "''");
            filterQuery += ` and contains(CardName, '${safeQuery}')`;
        }

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/BusinessPartners?` +
            `$select=CardCode,CardName&` +
            `$filter=${filterQuery}&` +
            `$top=20`;

        const response = await conReintentoSesion(empresa.id, async () => {
            const session = await getSesionEmpresa(empresa);
            return axios.get(url, { headers: headersSesion(session), httpsAgent: agent });
        });

        return res.json({
            status: "success",
            proveedores: response.data.value || []
        });

    } catch (error) {
        return res.status(500).json({
            error: "Error SAP al obtener proveedores",
            details: error.response?.data?.error?.message?.value || error.message
        });
    }
}

async function obtenerProductosData(id_tienda) {
    const empresa = await obtenerEmpresaSAPPorTienda(id_tienda);

    const executeRequest = async () => {
        const session = await getSesionEmpresa(empresa);
        const headers = headersSesion(session, { Prefer: 'odata.maxpagesize=5000' });

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

    return await conReintentoSesion(empresa.id, executeRequest);
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

function getAviguaSession() {
    return obtenerSesion('avigua', () => loginSAP(obtenerCredencialesAvigua(), SAP_AVIGUA_URL));
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
                    unidad_inventario: item.InventoryUOM || null,
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
        console.log(SAP_AVIGUA_BD)
        return resultados;
    };

    try {
        return await conReintentoSesion('avigua', executeRequest);
    } catch (error) {
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

function getInsumosSession() {
    return obtenerSesion('insumos', () => loginSAP(obtenerCredencialesInsumos(), process.env.SAP_URL));
}

// Busca artículos de activo fijo (prefijos "UL"/"UC"/"UA" en ItemCode) por
// nombre, en la misma base fija de insumos. Usada por Pedidos de Activos Fijos.
const PREFIJOS_ACTIVO_FIJO = ['UL', 'UC', 'UA', 'RA', 'PR', 'PU'];

async function buscarActivosFijos(req, res) {
    const { page = 1, query } = req.query;

    if (!query || query.trim().length < 3) {
        return res.status(400).json({ error: "Mínimo 3 caracteres" });
    }

    const pageSize = 50;
    const skip = (page - 1) * pageSize;

    try {
        const safeQuery = query.replace(/'/g, "''");
        const filtroPrefijos = PREFIJOS_ACTIVO_FIJO
            .map(p => `startswith(ItemCode,'${p}')`)
            .join(' or ');

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/Items?` +
            `$select=ItemCode,ItemName&` +
            `$filter=(${filtroPrefijos}) and contains(ItemName,'${safeQuery}') and Frozen eq 'N' and Valid eq 'Y'&` +
            `$top=${pageSize}&$skip=${skip}&$count=true`;

        const response = await conReintentoSesion('insumos', async () => {
            const session = await getInsumosSession();
            return axios.get(url, { headers: headersSesion(session), httpsAgent: agent });
        });

        return res.json({
            items: response.data.value || [],
            total: response.data['@odata.count'] || 0
        });

    } catch (error) {
        return res.status(500).json({
            error: "Error SAP búsqueda de activos fijos",
            details: error.message
        });
    }
}

// Trae el catálogo COMPLETO de activos fijos (los 6 prefijos), agrupado por
// su grupo de artículos real en SAP (ItemGroups.GroupName). Una sola llamada
// a Service Layer con $expand para no golpearlo con una request por grupo o
// por artículo — la usa Pedidos de Activos Fijos para mostrar todo el
// catálogo ya agrupado al cargar la vista, sin necesidad de buscar por nombre.
async function listarActivosFijos(req, res) {
    try {
        const filtroPrefijos = PREFIJOS_ACTIVO_FIJO
            .map(p => `startswith(ItemCode,'${p}')`)
            .join(' or ');

        const url = `${process.env.SAP_URL.replace(/\/$/, '')}/Items?` +
            `$select=ItemCode,ItemName,SalesUnit,ItemsGroupCode&` +
            `$expand=ItemGroups($select=GroupName)&` +
            `$filter=(${filtroPrefijos}) and Frozen eq 'N' and Valid eq 'Y'&` +
            `$top=5000`;

        const response = await conReintentoSesion('insumos', async () => {
            const session = await getInsumosSession();
            return axios.get(url, {
                headers: headersSesion(session, { Prefer: 'odata.maxpagesize=5000' }),
                httpsAgent: agent
            });
        });
        const items = response.data.value || [];

        const gruposPorCodigo = new Map();
        for (const item of items) {
            const codigoGrupo = item.ItemsGroupCode;
            if (!gruposPorCodigo.has(codigoGrupo)) {
                gruposPorCodigo.set(codigoGrupo, {
                    id: String(codigoGrupo),
                    name: item.ItemGroups?.GroupName || `Grupo ${codigoGrupo}`,
                    items: []
                });
            }
            gruposPorCodigo.get(codigoGrupo).items.push({
                ItemCode: item.ItemCode,
                ItemName: item.ItemName,
                SalesUnit: item.SalesUnit
            });
        }

        const categorias = Array.from(gruposPorCodigo.values())
            .sort((a, b) => a.name.localeCompare(b.name));

        return res.json({ categorias });

    } catch (error) {
        return res.status(500).json({
            error: "Error SAP al listar el catálogo de activos fijos",
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

                // Igual que en POLLO: InStock viene en la Unidad de Inventario,
                // no en la Unidad de Venta — se calcula cuántas unidades de
                // venta completas hay usando SalesItemsPerUnit.
                const stockDisponible = infoBodega ? infoBodega.InStock : 0;
                const salesItemsPerUnit = item.SalesItemsPerUnit || 1;
                const bolsasCompletas = Math.floor(stockDisponible / salesItemsPerUnit);

                resultados.push({
                    codigo_articulo: item.ItemCode,
                    nombre_articulo: item.ItemName,
                    stock_disponible: stockDisponible,
                    unidad_venta: item.SalesUnit,
                    unidad_inventario: item.InventoryUOM || null,
                    sales_items_per_unit: salesItemsPerUnit,
                    bolsas_completas: bolsasCompletas
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
        return await conReintentoSesion('insumos', executeRequest);
    } catch (error) {
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
            Comments: ajustarComentariosSap(comentarios) || undefined,
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
        return await conReintentoSesion('avigua', executeRequest);
    } catch (error) {
        console.log("===== SAP AVIGUA TRANSFERENCIA ERROR =====");
        console.log(process.env.SAP_AVIGUA_BD)
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
            Comments: ajustarComentariosSap(comentarios) || undefined,
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
        return await conReintentoSesion('insumos', executeRequest);
    } catch (error) {
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
            Comments: ajustarComentariosSap(comentarios) || undefined,
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
        return await conReintentoSesion('avigua', executeRequest);
    } catch (error) {
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
            Comments: ajustarComentariosSap(comentarios) || undefined,
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
        return await conReintentoSesion('insumos', executeRequest);
    } catch (error) {
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
        return await conReintentoSesion('avigua', executeRequest);
    } catch (error) {
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
        return await conReintentoSesion('insumos', executeRequest);
    } catch (error) {
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
        return await conReintentoSesion('avigua', executeRequest);
    } catch (error) {
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
        return await conReintentoSesion('insumos', executeRequest);
    } catch (error) {
        const sapErrorData = error.response?.data?.error;
        const sapMessage =
            typeof sapErrorData?.message === 'string' ? sapErrorData.message : sapErrorData?.message?.value;

        throw new Error(sapMessage || error.message);
    }
}

// Código antiguo de los artículos (OITM.SWW, "Identificador adicional") para
// una lista de códigos, en la base de Pollo (AVIGUA) o en la de insumos.
// Devuelve Map(ItemCode -> SWW); los artículos que no existen o no tienen
// SWW no vienen en el mapa. Se consulta en grupos con $filter para no hacer
// una petición por artículo ni armar URLs demasiado largas.
const CODIGOS_POR_CONSULTA_SWW = 20;

async function consultarCodigosAntiguos(codigosArticulo, tipo) {
    const codigosUnicos = [...new Set((codigosArticulo || []).filter(Boolean))];

    if (codigosUnicos.length === 0) {
        return new Map();
    }

    const esPollo = tipo === 'POLLO';
    const claveSesion = esPollo ? 'avigua' : 'insumos';
    const baseUrl = (esPollo ? SAP_AVIGUA_URL : process.env.SAP_URL).replace(/\/$/, '');

    const executeRequest = async () => {
        const session = esPollo ? await getAviguaSession() : await getInsumosSession();
        const headers = headersSesion(session);
        // Se arma de cero en cada intento, para que un reintento no mezcle resultados.
        const resultado = new Map();

        for (let i = 0; i < codigosUnicos.length; i += CODIGOS_POR_CONSULTA_SWW) {
            const grupo = codigosUnicos.slice(i, i + CODIGOS_POR_CONSULTA_SWW);
            const filtro = grupo
                .map(c => `ItemCode eq '${String(c).replace(/'/g, "''")}'`)
                .join(' or ');

            const url = `${baseUrl}/Items?$select=ItemCode,SWW&$filter=${encodeURIComponent(filtro)}&$top=${grupo.length}`;
            const response = await axios.get(url, { headers, httpsAgent: agent });

            for (const item of response.data.value || []) {
                if (item.SWW) resultado.set(item.ItemCode, item.SWW);
            }
        }

        return resultado;
    };

    try {
        return await conReintentoSesion(claveSesion, executeRequest);
    } catch (error) {
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
    listarActivosFijos,
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
    crearEntregaInsumos,
    consultarCodigosAntiguos
};