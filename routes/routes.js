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

//TIENDAS
router.get('/tiendas/getAllTiendas', tiendas.getAllTiendas);
router.get('/tiendas/getTiendasBySupervisor/:codEmpleado', tiendas.getTiendasBySupervisor)

//EMPLEADOS
router.get('/empleados/getAllEmpleados', empleados.getAllEmpleados);
router.get('/empleados/getEmpleadoById/:codEmpleado', empleados.getEmpleadoById);

//EMPLEADOS COOTRAGUA
router.get('/cootragua/getAllEmpleadosCootragua', cootragua.getAllEmpleadosCootragua);

//MENUS
router.get('/menus/getAllMenus', menus.getAllMenus);

//PEDIDOS-ENVIOS
router.get('/pedido/getAllTipoPedidoEnvio', tiposPedidoEnvio.getAllTipoPedidoEnvio);

//PEDIDOS
router.get('/pedido/getAllPedidosEncabezado', pedidos.getAllPedidosEncabezado);
router.get('/pedido/getPedidoDetalleByEncabezado/:id_p', pedidos.getPedidoDetalleByEncabezado);
router.get('/pedido/validarYObtenerPedido', pedidos.validarYObtenerPedido)
router.post('/pedido/createPedido', pedidos.createPedido)

//LOGIN
router.post('/login', login);

//SAP
// router.post('/loginSAP', sap.loginSAP);
router.get('/sap/productosAgrupados', sap.productosAgrupados);

module.exports = router