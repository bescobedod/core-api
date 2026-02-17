const axios = require('axios');
const https = require('https');

const agent = new https.Agent({ rejectUnauthorized: false });
let sapSession = { id: null, routeId: null };

async function loginSAP() {
    try {
        const response = await axios.post(`${process.env.SAP_URL}/Login`, {
            CompanyDB: process.env.SAP_COMPANY_DB,
            UserName: process.env.SAP_USER,
            Password: process.env.SAP_PASSWORD
        }, { httpsAgent: agent });

        sapSession.id = response.data.SessionId;
        sapSession.routeId = response.headers['set-cookie']?.find(c => c.includes('ROUTEID'))?.split(';')[0];
    } catch (error) {
        console.error("Error crítico en Login SAP:", error.message);
        throw error;
    }
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

module.exports = {
    productosAgrupados,
    obtenerProductosData
};