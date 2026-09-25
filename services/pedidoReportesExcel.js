const ExcelJS = require('exceljs');

// Versiones en Excel de los reportes PDF de pedidos. Llevan exactamente la
// misma información que el PDF, pero en tablas planas (una fila por artículo)
// para poder filtrarlas y ordenarlas en Excel.

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const COLOR_ENCABEZADO = 'FF2183AE';

function nuevoLibro() {
    const libro = new ExcelJS.Workbook();
    libro.creator = 'Core';
    libro.created = new Date();
    return libro;
}

function agregarTitulo(hoja, titulo, lineas = []) {
    const filaTitulo = hoja.addRow([titulo]);
    filaTitulo.font = { bold: true, size: 14 };

    lineas.filter(Boolean).forEach((linea) => {
        const fila = hoja.addRow([linea]);
        fila.font = { color: { argb: 'FF555555' } };
    });

    hoja.addRow([]);
}

// columnas: [{ header, key, width, centrada }]; filas: objetos con esas keys.
function agregarTabla(hoja, columnas, filas) {
    const filaEncabezado = hoja.addRow(columnas.map(c => c.header));
    filaEncabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    filaEncabezado.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    filaEncabezado.eachCell((celda) => {
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ENCABEZADO } };
    });

    columnas.forEach((c, i) => {
        const columna = hoja.getColumn(i + 1);
        columna.width = Math.max(columna.width || 0, c.width);
    });

    filas.forEach((fila) => {
        const nueva = hoja.addRow(columnas.map(c => fila[c.key] ?? ''));
        columnas.forEach((c, i) => {
            if (c.centrada) nueva.getCell(i + 1).alignment = { horizontal: 'center' };
        });
    });

    hoja.views = [{ state: 'frozen', ySplit: filaEncabezado.number }];

    if (filas.length > 0) {
        hoja.autoFilter = {
            from: { row: filaEncabezado.number, column: 1 },
            to: { row: filaEncabezado.number + filas.length, column: columnas.length }
        };
    }
}

// rutasConBloques: [{ nombre_ruta, bloques: [...] }] (mismo formato que el PDF).
// resumenGeneral / conEntregas / resumenEstados / etiquetaEstado los calcula
// el controlador con los mismos helpers del PDF, para que no puedan diferir.
function construirExcelDetalle({
    fecha, descripcionFiltros, rutasConBloques, resumenGeneral, conEntregas, resumenEstados, faltantes, etiquetaEstado
}) {
    const libro = nuevoLibro();

    // ---- Resumen General ----
    const hojaResumen = libro.addWorksheet('Resumen General');
    agregarTitulo(hojaResumen, 'Detalle de Pedidos por Tienda — Resumen General', [
        `Fecha Entrega: ${fecha}`,
        descripcionFiltros,
        conEntregas ? `Estado de los pedidos: ${resumenEstados}` : null
    ]);

    const columnasResumen = [
        { header: 'Código', key: 'codigo', width: 14 },
        { header: 'Artículo', key: 'nombre', width: 48 },
        { header: 'Pedido', key: 'pedido', width: 12, centrada: true },
        { header: 'Enviado', key: 'enviado', width: 12, centrada: true },
        ...(conEntregas ? [{ header: 'Recibido', key: 'recibido', width: 12, centrada: true }] : []),
        { header: 'Diferencia', key: 'diferencia', width: 12, centrada: true }
    ];

    agregarTabla(hojaResumen, columnasResumen, resumenGeneral.map(t => ({
        codigo: t.codigo_producto,
        nombre: t.nombre_producto,
        pedido: t.cantidad_solicitada,
        enviado: t.cantidad_asignada,
        recibido: t.cantidad_recibida,
        diferencia: t.cantidad_solicitada - t.cantidad_asignada
    })));

    // ---- Detalle (una fila por artículo de cada pedido) ----
    const hojaDetalle = libro.addWorksheet('Detalle');
    agregarTitulo(hojaDetalle, 'Detalle de Pedidos por Tienda', [`Fecha Entrega: ${fecha}`, descripcionFiltros]);

    const columnasDetalle = [
        { header: 'Ruta', key: 'ruta', width: 22 },
        { header: 'Tienda', key: 'tienda', width: 32 },
        { header: 'Tipo', key: 'tipo', width: 14 },
        { header: 'N° Pedido', key: 'numero_pedido', width: 18 },
        ...(conEntregas ? [{ header: 'Estado', key: 'estado', width: 18 }] : []),
        { header: 'Código', key: 'codigo', width: 14 },
        { header: 'Artículo', key: 'nombre', width: 44 },
        { header: 'Pedido', key: 'pedido', width: 12, centrada: true },
        { header: 'Enviado', key: 'enviado', width: 12, centrada: true },
        ...(conEntregas ? [{ header: 'Recibido', key: 'recibido', width: 12, centrada: true }] : []),
        { header: 'Diferencia', key: 'diferencia', width: 12, centrada: true },
        ...(conEntregas ? [
            { header: 'Delivery DocEntry', key: 'delivery_docentry', width: 18, centrada: true },
            { header: 'Delivery DocNum', key: 'delivery_docnum', width: 18, centrada: true },
            { header: 'Entrada DocEntry', key: 'entry_docentry', width: 18, centrada: true },
            { header: 'Entrada DocNum', key: 'entry_docnum', width: 18, centrada: true }
        ] : [])
    ];

    const filasDetalle = [];

    rutasConBloques.forEach((ruta) => {
        ruta.bloques.forEach((bloque) => {
            bloque.items.forEach((item) => {
                filasDetalle.push({
                    ruta: ruta.nombre_ruta,
                    tienda: bloque.nombre_tienda,
                    tipo: bloque.label || 'Pedido',
                    numero_pedido: bloque.numero_pedido,
                    estado: etiquetaEstado(bloque.estado).texto,
                    codigo: item.codigo_producto,
                    nombre: item.nombre_producto,
                    pedido: item.cantidad_solicitada,
                    enviado: item.cantidad_asignada,
                    recibido: item.cantidad_recibida,
                    diferencia: item.cantidad_solicitada - item.cantidad_asignada,
                    delivery_docentry: bloque.sap_delivery_docentry,
                    delivery_docnum: bloque.sap_delivery_docnum,
                    entry_docentry: bloque.sap_entry_docentry,
                    entry_docnum: bloque.sap_entry_docnum
                });
            });
        });
    });

    agregarTabla(hojaDetalle, columnasDetalle, filasDetalle);

    // ---- Tiendas sin pedido ----
    const hojaFaltantes = libro.addWorksheet('Tiendas sin pedido');
    agregarTitulo(hojaFaltantes, 'Tiendas que no hicieron pedido para esta fecha', [`Fecha Entrega: ${fecha}`, descripcionFiltros]);

    const filasFaltantes = [];
    faltantes.forEach((porDivision) => {
        porDivision.rutas.forEach((ruta) => {
            ruta.tiendas.forEach((tienda) => {
                filasFaltantes.push({ division: `División ${porDivision.division}`, ruta: ruta.nombre_ruta, tienda });
            });
        });
    });

    if (filasFaltantes.length === 0) {
        hojaFaltantes.addRow(['Todas las tiendas asignadas hicieron pedido para esta fecha.']);
    } else {
        agregarTabla(hojaFaltantes, [
            { header: 'División', key: 'division', width: 14 },
            { header: 'Ruta', key: 'ruta', width: 26 },
            { header: 'Tienda', key: 'tienda', width: 40 }
        ], filasFaltantes);
    }

    return libro;
}

// secciones: [{ division, bloques }] (mismo formato que el PDF de pedidos en
// tránsito); una hoja por división.
function construirExcelEnTransito({ secciones, tituloTipo, conMuelle }) {
    const libro = nuevoLibro();

    secciones.forEach((seccion) => {
        const hoja = libro.addWorksheet(`División ${seccion.division}`);
        agregarTitulo(hoja, `Pedidos en Tránsito — ${tituloTipo} — División ${seccion.division}`, [
            'Pedidos enviados a SAP que todavía no han sido entregados (todas las fechas)',
            `Total: ${seccion.bloques.length} pedido${seccion.bloques.length !== 1 ? 's' : ''}`
        ]);

        const columnas = [
            { header: 'Fecha requerida', key: 'fecha', width: 16, centrada: true },
            { header: 'Ruta', key: 'ruta', width: 22 },
            ...(conMuelle ? [{ header: 'Muelle', key: 'muelle', width: 22 }] : []),
            { header: 'Piloto', key: 'piloto', width: 30 },
            { header: 'Camión', key: 'camion', width: 12 },
            { header: 'Tienda', key: 'tienda', width: 32 },
            { header: 'Tipo', key: 'tipo', width: 14 },
            { header: 'N° Pedido', key: 'numero_pedido', width: 18 },
            { header: 'Código', key: 'codigo', width: 14 },
            { header: 'Artículo', key: 'nombre', width: 44 },
            { header: 'Pedido', key: 'pedido', width: 12, centrada: true },
            { header: 'Enviado', key: 'enviado', width: 12, centrada: true },
            { header: 'Diferencia', key: 'diferencia', width: 12, centrada: true }
        ];

        const filas = [];

        seccion.bloques.forEach((bloque) => {
            bloque.items.forEach((item) => {
                filas.push({
                    fecha: bloque.fecha_requerida,
                    ruta: bloque.nombre_ruta,
                    muelle: bloque.muelle,
                    piloto: bloque.piloto_nombre || 'Sin asignar',
                    camion: bloque.camion_placa || 'Sin asignar',
                    tienda: bloque.nombre_tienda,
                    tipo: bloque.label || 'Pedido',
                    numero_pedido: bloque.numero_pedido,
                    codigo: item.codigo_producto,
                    nombre: item.nombre_producto,
                    pedido: item.cantidad_solicitada,
                    enviado: item.cantidad_asignada,
                    diferencia: item.cantidad_solicitada - item.cantidad_asignada
                });
            });
        });

        agregarTabla(hoja, columnas, filas);
    });

    return libro;
}

module.exports = { MIME_XLSX, construirExcelDetalle, construirExcelEnTransito };
