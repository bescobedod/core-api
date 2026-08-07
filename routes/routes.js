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
const camiones = require('../controllers/core/camion.controller.js');
const rutasPollo = require('../controllers/core/ruta_pollo.controller.js');
const rutasInsumos = require('../controllers/core/ruta_insumo.controller.js');
const vales = require('../controllers/core/vales_combustible.controller.js');
const auth = require('../middlewares/auth.js');
const upload = require('../middlewares/upload.js');
const rateLimit = require('express-rate-limit');

// Limita cuántas veces se puede llamar el procesamiento de archivo de pedidos
// POS en una ventana de tiempo, ya que es una operación costosa (I/O + varias
// consultas a PDV/Core por cada pedido del archivo).
const limitePedidosPos = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutos
    max: 30,                 // 30 archivos por IP en esa ventana
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes de pedidos POS, intenta más tarde', success: false }
});

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
router.get('/pedido/getAllPedidosEncabezado', auth, pedidos.getAllPedidosEncabezado);
router.get('/pedido/getPedidoDetalleByEncabezado/:id_p', auth, pedidos.getPedidoDetalleByEncabezado);
router.get('/pedido/validarYObtenerPedido', auth, pedidos.validarYObtenerPedido)
router.post('/pedido/createPedido', auth, pedidos.createPedido)

//PEDIDOS POS (Oracle Simphony -> SFTP -> middleware -> Core)
// TODO: evaluar si esta ruta debe llevar 'auth' (login de usuario) o un
// middleware de autenticación de servicio (API key) distinto, ya que quien
// llama aquí es el middleware, no un usuario logueado desde el portal.
// Acepta uno o más archivos .txt en la misma petición (form-data, campo repetible).
router.post('/pedido/subirArchivoPedidoPos', limitePedidosPos, upload.uploadPedidosPos.any(), pedidos.subirYProcesarArchivosPedidoPos)
router.get('/pedido/getPedidosPos', auth, pedidos.getPedidosPos)
router.get('/pedido/getComparativoStockPollo', auth, pedidos.getComparativoStockPollo)
router.get('/pedido/getComparativoStockInsumos', auth, pedidos.getComparativoStockInsumos)
router.post('/pedido/guardarAsignacionCantidades', auth, pedidos.guardarAsignacionCantidades)
router.post('/pedido/enviarTransferenciaPollo', auth, pedidos.enviarTransferenciaPollo)
router.post('/pedido/enviarTransferenciaInsumos', auth, pedidos.enviarTransferenciaInsumos)
router.get('/pedido/getAsignacionesTransporte', auth, pedidos.getAsignacionesTransporte)
router.post('/pedido/asignarTransporte', auth, pedidos.asignarTransporte)

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
// Cambia esto en tu archivo de rutas:
router.post('/orden/createOrdenCompra',
    auth,
    upload.uploadDocumentos.any(),
    ordenes.createOrdenCompra);
router.get('/orden/getOrdenesCompraByUser', auth, ordenes.getOrdenesCompraByUser);
router.get('/orden/getOrdenesCompra', auth, ordenes.getOrdenesCompra);
router.get('/orden/getAprobacionOrden/:id_orden', auth, ordenes.getAprobacionOrden);
router.get('/orden/getOrdenCompraDetalle/:id_orden', auth, ordenes.getOrdenCompraDetalle);

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
router.put('/usuario/updateUser', auth, usuarios.updateUser);
router.get('/usuario/getUsersByRol', auth, usuarios.getUsersByRol);

//DEPARTAMENTO
router.get('/departamento/getDepartamentos', auth, departamentos.getDepartamentos);
router.post('/departamento/updateDepartamento/:id_d', auth, departamentos.updateDepartamento);

//AREA
router.get('/area/getAreasByDepartamento', auth, areas.getAreasByDepartamento);
router.get('/area/getAreasYEmpleadosByDepartamento/:departamento_id', auth, areas.getAreasYEmpleadosByDepartamento);

//EMPRESA
router.get('/empresa/getEmpresasActivas', auth, empresas.getEmpresasActivas);

//CAMION
router.get('/camion/getInspecciones', auth, camiones.getInspecciones);
router.get('/camion/getAllCamiones', auth, camiones.getAllCamiones);

//RUTAS DE POLLO (maestro de rutas + asignación de tiendas)
router.get('/rutaPollo/getRutas', auth, rutasPollo.getRutasPollo);
router.post('/rutaPollo/crearRuta', auth, rutasPollo.crearRutaPollo);
router.put('/rutaPollo/actualizarRuta', auth, rutasPollo.actualizarRutaPollo);
router.get('/rutaPollo/buscarTiendasPdv', auth, rutasPollo.buscarTiendasPdv);
router.get('/rutaPollo/getTiendasDeRuta/:ruta_id', auth, rutasPollo.getTiendasDeRuta);
router.post('/rutaPollo/asignarTiendaRuta', auth, rutasPollo.asignarTiendaRutaPollo);
router.post('/rutaPollo/quitarTiendaDeRuta', auth, rutasPollo.quitarTiendaDeRutaPollo);
router.get('/rutaPollo/getMuelleUsuario', auth, rutasPollo.getMuelleUsuario);
router.get('/rutaPollo/getCandadoActivo', auth, rutasPollo.getCandadoActivo);
router.post('/rutaPollo/tomarCandado', auth, rutasPollo.tomarCandado);
router.post('/rutaPollo/liberarCandado', auth, rutasPollo.liberarCandado);

//RUTAS DE INSUMOS (maestro de rutas + asignación de tiendas + candado global)
router.get('/rutaInsumos/getRutas', auth, rutasInsumos.getRutasInsumos);
router.post('/rutaInsumos/crearRuta', auth, rutasInsumos.crearRutaInsumos);
router.put('/rutaInsumos/actualizarRuta', auth, rutasInsumos.actualizarRutaInsumos);
router.get('/rutaInsumos/buscarTiendasPdv', auth, rutasInsumos.buscarTiendasPdv);
router.get('/rutaInsumos/getTiendasDeRuta/:ruta_id', auth, rutasInsumos.getTiendasDeRuta);
router.post('/rutaInsumos/asignarTiendaRuta', auth, rutasInsumos.asignarTiendaRutaInsumos);
router.post('/rutaInsumos/quitarTiendaDeRuta', auth, rutasInsumos.quitarTiendaDeRutaInsumos);
router.get('/rutaInsumos/getCandadoActivo', auth, rutasInsumos.getCandadoActivoInsumos);
router.post('/rutaInsumos/tomarCandado', auth, rutasInsumos.tomarCandadoInsumos);
router.post('/rutaInsumos/liberarCandado', auth, rutasInsumos.liberarCandadoInsumos);

//VALES DE COMBUSTIBLE
router.get('/vale/getValesCombustible', auth, vales.getValesCombustible)

module.exports = router