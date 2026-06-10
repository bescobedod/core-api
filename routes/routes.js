const express = require('express');
const router = express.Router();
const login = require('../services/login');
const sap = require('../integrations/sap/sapClient');
const menus = require('../controllers/core/menu.controller');
const tiendas = require('../controllers/pdv/tienda.controller');
const empleados = require('../controllers/nomina/empleado.controller');
const tiposPedidoEnvio = require('../controllers/core/pedido_envio.controller');
const cootragua = require('../controllers/nomina/empleadoCootragua.controller');
const pedidos = require('../controllers/core/pedido.controller');
const solicitudes = require('../controllers/core/solicitud_compra.controller.js');
const ordenes = require('../controllers/core/orden_compra.controller.js');
const estrategias = require('../controllers/core/estrategias.controller.js');
const usuarios = require('../controllers/core/usuario.controller.js');
const areas = require('../controllers/core/area.controller.js');
const departamentos = require('../controllers/core/departamento.controller.js');
const empresas = require('../controllers/core/empresa.controller.js');
const auth = require('../middlewares/auth.js');
const upload = require('../middlewares/upload.js');

//TIENDAS
router.get('/tiendas/getAllTiendas', tiendas.getAllTiendas);
router.get('/tiendas/getTiendasBySupervisor/:codEmpleado', tiendas.getTiendasBySupervisor)

//EMPLEADOS
router.get('/empleados/getAllEmpleados', empleados.getAllEmpleados);
router.get('/empleados/getEmpleadoById/:codEmpleado', empleados.getEmpleadoById);

//EMPLEADOS COOTRAGUA
router.get('/cootragua/getAllEmpleadosCootragua', cootragua.getAllEmpleadosCootragua);

//MENUS
router.get('/menus/getAllMenus', auth, menus.getAllMenus);
router.get('/menus/getPermiso', auth, menus.getPermiso);

//PEDIDOS-ENVIOS
router.get('/pedido/getAllTipoPedidoEnvio', tiposPedidoEnvio.getAllTipoPedidoEnvio);

//PEDIDOS
router.get('/pedido/getAllPedidosEncabezado', pedidos.getAllPedidosEncabezado);
router.get('/pedido/getPedidoDetalleByEncabezado/:id_p', pedidos.getPedidoDetalleByEncabezado);
router.get('/pedido/validarYObtenerPedido', pedidos.validarYObtenerPedido)
router.post('/pedido/createPedido', pedidos.createPedido)

//LOGIN
router.post('/login', login.login);
router.post('/validateLogin/:email', login.validateLogin);

//SAP
// router.post('/loginSAP', sap.loginSAP);
// router.get('/sap/productosAgrupados', sap.productosAgrupados);
// router.get('/sap/obtenerGruposArticulos', sap.obtenerGruposArticulos);
// router.get('/sap/obtenerProductosPorGrupo', sap.obtenerProductosPorGrupo);
router.post('/sap/verificarArticulosSAP', auth, sap.verificarArticulosSAP);
router.get('/sap/buscarProductosPorNombre', auth, sap.buscarProductosPorNombre);
router.get('/sap/getProveedores', auth, sap.getProveedores);

//SOLICITUDES COMPRA
router.post('/solicitud/createSolicitudCompra',
    auth,
    upload.upload.any(),
    solicitudes.createSolicitudCompra);
router.get('/solicitud/getSolicitudCompraAF', auth, solicitudes.getSolicitudCompraAF);
router.get('/solicitud/getArticulosBySolicitud/:id_solicitud', auth, solicitudes.getArticulosBySolicitud);
router.post('/solicitud/updateArticulosCodes', auth, solicitudes.updateArticulosCodes);
router.get('/solicitud/getSolicitudesCompraByUser', auth, solicitudes.getSolicitudesCompraByUser);
router.get('/solicitud/getSolicitudesCompra', auth, solicitudes.getSolicitudesCompra);
router.get('/solicitud/getAprobacionSolicitud/:id_solicitud', auth, solicitudes.getAprobacionSolicitud);
router.get('/solicitud/getSolicitudCompra/:id_solicitud', auth, solicitudes.getSolicitudCompra);

//ORDENES COMPRA
router.post('/orden/createOrdenCompra',
    auth,
    upload.uploadDocumentos.single('cotizacion'),
    ordenes.createOrdenCompra);
router.get('/orden/getOrdenesCompraByUser', auth, ordenes.getOrdenesCompraByUser);
router.get('/orden/getOrdenesCompra', auth, ordenes.getOrdenesCompra);
router.get('/orden/getAprobacionOrden/:id_orden', auth, ordenes.getAprobacionOrden);

//ESTRATEGIAS
router.get('/estrategia/getEstrategias', auth, estrategias.getEstrategias);
router.get('/estrategia/getMatrizAprobacion/:id_estrategia', auth, estrategias.getMatrizAprobacion);
router.put('/estrategia/deleteNivelMatrizSolicitud', auth, estrategias.deleteNivelMatrizSolicitud);
router.put('/estrategia/updateEstrategiaAdquisicion', auth, estrategias.updateEstrategiaAdquisicion);
router.post('/estrategia/createEstrategiaByArea/:area', auth, estrategias.createEstrategiaByArea);
router.post('/estrategia/createMatrizAprobacionSolicitud', auth, estrategias.createMatrizAprobacionSolicitud);
router.post('/estrategia/createMatrizAprobacionOrden', auth, estrategias.createMatrizAprobacionOrden);
router.get('/estrategia/getJefeInmediatoByEstrategia/:id_estrategia', auth, estrategias.getJefeInmediatoByEstrategia);

//USUARIOS
router.get('/usuario/getUsersByDepartamento/:id_matriz', auth, usuarios.getUsersByDepartamento);
router.get('/usuario/getUsersByDepartamento2/:departamento_id', auth, usuarios.getUsersByDepartamento2);
router.get('/usuario/searchUsers', auth, usuarios.searchUsers);

//DEPARTAMENTO
router.get('/departamento/getDepartamentos', auth, departamentos.getDepartamentos);
router.post('/departamento/updateDepartamento/:id_d', auth, departamentos.updateDepartamento);

//AREA
router.get('/area/getAreasByDepartamento', auth, areas.getAreasByDepartamento);
router.get('/area/getAreasYEmpleadosByDepartamento/:departamento_id', auth, areas.getAreasYEmpleadosByDepartamento);

//EMPRESA
router.get('/empresa/getEmpresasActivas', auth, empresas.getEmpresasActivas);

module.exports = router