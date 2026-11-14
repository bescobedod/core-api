const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { acortarNombre } = require('./nombres.service');
const {
    MIME_XLSX,
    TEXTO_ESTADO,
    SIN_ENVIO,
    formatearFecha,
    cantidadEnvio,
    equivalencias,
    estilarEncabezado
} = require('./pedidoArtesanoReportes');

// Reportes de pollo artesano por ruta: detalle de pedidos y pedidos en tránsito, en PDF y Excel.
// Los dos usan la misma estructura: viajes (ruta + fecha) con sus pedidos y líneas.

const COLOR_PRINCIPAL = '#2183AE';
const COLOR_ESTADO = {
    CREADO: '#6b7280',
    VALIDADO: '#b45309',
    EN_TRANSITO: '#6d28d9',
    ENTREGADO: '#047857',
    RECHAZADO: '#b91c1c',
    CANCELADO: '#b91c1c'
};
const TEXTO_PAGO = { DEPOSITO: 'Depósito', PLANILLA: 'Planilla', PENDIENTE: 'Pendiente' };

function numero(n) {
    return Number(n).toLocaleString('es-GT', { maximumFractionDigits: 2 });
}

function numeroOGuion(n) {
    return n === null || n === undefined ? '—' : numero(n);
}

// Arma los viajes (ruta + fecha) a partir de los pedidos con su detalle.
// catalogo: Map codigo -> producto (factores); despachos: Map `${ruta_id}|${fecha}` -> despacho de transporte.
function armarViajes(pedidos, catalogo, despachos) {
    const viajes = new Map();

    pedidos.forEach((p) => {
        const fecha = String(p.fecha_requerida).slice(0, 10);
        const clave = `${fecha}|${p.ruta_id || ''}`;
        const despacho = despachos.get(`${p.ruta_id}|${fecha}`);

        if (!viajes.has(clave)) {
            viajes.set(clave, {
                fecha_requerida: fecha,
                ruta_id: p.ruta_id,
                nombre_ruta: p.nombre_ruta || 'Sin ruta',
                piloto: despacho && despacho.piloto_nombre ? acortarNombre(despacho.piloto_nombre) : null,
                camion_placa: despacho ? despacho.camion_placa : null,
                pedidos: []
            });
        }

        const viaje = viajes.get(clave);
        const sinEnvio = SIN_ENVIO.includes(p.estado);

        if (!viaje.piloto && p.nombre_piloto) viaje.piloto = acortarNombre(p.nombre_piloto);

        viaje.pedidos.push({
            numero_pedido: p.numero_pedido,
            estado: p.estado,
            cliente: p.cliente_nombre,
            nit: p.cliente_nit || '',
            direccion: p.direccion_entrega || '',
            pago: TEXTO_PAGO[p.condicion_pago] || p.condicion_pago || '',
            boleta: p.numero_boleta || '',
            sap_traslado: p.sap_traslado_docnum || null,
            sap_traslado_entry: p.sap_traslado_docentry || null,
            sap_entrega: p.sap_entrega_docnum || null,
            sap_entrega_entry: p.sap_entrega_docentry || null,
            items: [...(p.detalle || [])]
                .sort((a, b) => a.numero_linea - b.numero_linea)
                .map((l) => {
                    const autorizado = sinEnvio || l.cantidad_autorizada === null || l.cantidad_autorizada === undefined
                        ? null
                        : Number(l.cantidad_autorizada);
                    const { cajas, libras } = sinEnvio
                        ? { cajas: null, libras: null }
                        : equivalencias(cantidadEnvio(l), catalogo.get(l.codigo_producto));

                    return {
                        codigo: l.codigo_producto,
                        nombre: l.descripcion_producto,
                        unidad: (l.unidad_medida || '').toLowerCase(),
                        pedido: Number(l.cantidad),
                        autorizado,
                        cajas,
                        libras
                    };
                })
        });
    });

    return [...viajes.values()].sort((a, b) =>
        a.fecha_requerida.localeCompare(b.fecha_requerida) || a.nombre_ruta.localeCompare(b.nombre_ruta));
}

// Total por producto de los pedidos que sí se envían (sin rechazados ni cancelados).
function resumirProductos(viajes) {
    const mapa = new Map();

    viajes.forEach((v) => v.pedidos.forEach((p) => {
        if (SIN_ENVIO.includes(p.estado)) return;

        p.items.forEach((i) => {
            if (!mapa.has(i.codigo)) {
                mapa.set(i.codigo, { codigo: i.codigo, nombre: i.nombre, unidad: i.unidad, pedido: 0, autorizado: 0, conAutorizado: false, cajas: 0, libras: 0, conCajas: false, conLibras: false });
            }

            const fila = mapa.get(i.codigo);
            fila.pedido += i.pedido;

            if (i.autorizado !== null) {
                fila.autorizado += i.autorizado;
                fila.conAutorizado = true;
            }

            if (i.cajas !== null) {
                fila.cajas += i.cajas;
                fila.conCajas = true;
            }

            if (i.libras !== null) {
                fila.libras += i.libras;
                fila.conLibras = true;
            }
        });
    }));

    return [...mapa.values()]
        .map(f => ({
            ...f,
            autorizado: f.conAutorizado ? f.autorizado : null,
            cajas: f.conCajas ? Math.round(f.cajas * 100) / 100 : null,
            libras: f.conLibras ? Math.round(f.libras * 100) / 100 : null
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function contarPedidos(viajes) {
    return viajes.reduce((acc, v) => acc + v.pedidos.length, 0);
}

function resumenEstados(viajes) {
    const cuenta = {};

    viajes.forEach(v => v.pedidos.forEach((p) => { cuenta[p.estado] = (cuenta[p.estado] || 0) + 1; }));

    return Object.entries(cuenta).map(([estado, n]) => `${TEXTO_ESTADO[estado] || estado}: ${n}`).join('  ·  ');
}

function textoViaje(v) {
    return `Piloto: ${v.piloto || 'Sin asignar'}   ·   Camión: ${v.camion_placa || 'Sin asignar'}`;
}

// ---------------------------------------------------------------------------
// PDF (mismo formato que los reportes de pedidos de tienda)
// ---------------------------------------------------------------------------

function crearDocumento(res, nombreArchivo) {
    const doc = new PDFDocument({ margin: 40, size: 'LETTER' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    doc.pipe(res);

    return doc;
}

function crearLayout(doc) {
    const startX = doc.page.margins.left;
    const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const anchoCodigo = 60;
    const anchoNum = 56;
    const anchoNombre = anchoUtil - anchoCodigo - anchoNum * 4;
    const colNombre = startX + anchoCodigo;
    const colPedido = colNombre + anchoNombre;

    return {
        startX, anchoUtil, anchoCodigo, anchoNombre, anchoNum,
        colCodigo: startX, colNombre, colPedido,
        colAutorizado: colPedido + anchoNum,
        colCajas: colPedido + anchoNum * 2,
        colLibras: colPedido + anchoNum * 3
    };
}

function limiteInferior(doc) {
    return doc.page.height - doc.page.margins.bottom;
}

function dibujarTitulo(doc, titulo, lineas, lineaNegrita) {
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000').text(titulo, { align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#555555');
    lineas.filter(Boolean).forEach(linea => doc.text(linea, { align: 'center' }));
    if (lineaNegrita) doc.font('Helvetica-Bold').fillColor('#374151').text(lineaNegrita, { align: 'center' });
    doc.fillColor('#000000');
    doc.moveDown(0.8);
}

function dibujarSeccion(doc, L, texto) {
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR_PRINCIPAL);
    doc.text(texto, L.startX);
    doc.fillColor('#000000');
    doc.moveTo(L.startX, doc.y + 2).lineTo(L.startX + L.anchoUtil, doc.y + 2).strokeColor(COLOR_PRINCIPAL).stroke();
    doc.moveDown(0.5);
}

function dibujarEncabezadoTabla(doc, L) {
    const y = doc.y;

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000');
    doc.text('Código', L.colCodigo, y, { width: L.anchoCodigo });
    doc.text('Artículo', L.colNombre, y, { width: L.anchoNombre });
    doc.text('Pedido', L.colPedido, y, { width: L.anchoNum, align: 'center' });
    doc.text('Autorizado', L.colAutorizado, y, { width: L.anchoNum, align: 'center' });
    doc.text('Cajas', L.colCajas, y, { width: L.anchoNum, align: 'center' });
    doc.text('Libras', L.colLibras, y, { width: L.anchoNum, align: 'center' });

    doc.y = y + 12;
    doc.moveTo(L.startX, doc.y).lineTo(L.startX + L.anchoUtil, doc.y).strokeColor('#999999').stroke();
    doc.moveDown(0.2);
}

function dibujarFilaTabla(doc, L, i, { negritaPedido = false } = {}) {
    const y = doc.y;

    doc.font('Helvetica').fontSize(8).fillColor('#000000');
    doc.text(i.codigo || '—', L.colCodigo, y, { width: L.anchoCodigo });
    doc.text(i.unidad ? `${i.nombre} (${i.unidad})` : i.nombre || '—', L.colNombre, y, { width: L.anchoNombre });
    doc.font(negritaPedido ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(numero(i.pedido), L.colPedido, y, { width: L.anchoNum, align: 'center' });
    doc.font('Helvetica');
    doc.text(numeroOGuion(i.autorizado), L.colAutorizado, y, { width: L.anchoNum, align: 'center' });
    doc.text(numeroOGuion(i.cajas), L.colCajas, y, { width: L.anchoNum, align: 'center' });
    doc.text(numeroOGuion(i.libras), L.colLibras, y, { width: L.anchoNum, align: 'center' });

    doc.y = y + 14;
}

function dibujarResumenGeneral(doc, L, resumen, vacio) {
    dibujarSeccion(doc, L, 'Resumen General');
    dibujarEncabezadoTabla(doc, L);

    resumen.forEach((fila) => {
        if (doc.y + 14 > limiteInferior(doc)) doc.addPage();
        dibujarFilaTabla(doc, L, fila, { negritaPedido: true });
    });

    if (resumen.length === 0) {
        doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(vacio, L.startX);
    } else {
        doc.font('Helvetica').fontSize(7).fillColor('#6b7280')
            .text('No incluye pedidos rechazados ni cancelados. Cajas y libras: sobre lo autorizado o, si aún no hay, sobre lo pedido.', L.startX, doc.y + 3);
    }

    doc.fillColor('#000000');
}

function alturaEstimadaPedido(pedido) {
    return 46 + pedido.items.length * 14 + (pedido.sap_traslado || pedido.sap_entrega ? 30 : 0);
}

// Pedido: cliente, estado a la derecha, número y datos en gris, recuadro con los documentos de SAP y la tabla de productos.
function dibujarPedido(doc, L, pedido) {
    if (doc.y + alturaEstimadaPedido(pedido) > limiteInferior(doc)) doc.addPage();

    const anchoEstado = 120;
    const yTitulo = doc.y;
    const textoTitulo = pedido.cliente;
    const anchoTitulo = L.anchoUtil - anchoEstado - 10;

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
    const altoTitulo = doc.heightOfString(textoTitulo, { width: anchoTitulo });
    doc.text(textoTitulo, L.startX, yTitulo, { width: anchoTitulo });

    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR_ESTADO[pedido.estado] || '#374151');
    doc.text(TEXTO_ESTADO[pedido.estado] || pedido.estado, L.startX + L.anchoUtil - anchoEstado, yTitulo, { width: anchoEstado, align: 'right' });

    doc.y = yTitulo + altoTitulo + 2;
    doc.font('Helvetica').fontSize(8).fillColor('#666666');
    doc.text(`Pedido: ${pedido.numero_pedido}`, L.startX, doc.y, { width: L.anchoUtil });

    if (pedido.direccion) doc.text(`Dirección: ${pedido.direccion}`, L.startX, doc.y, { width: L.anchoUtil });


    if (pedido.sap_traslado || pedido.sap_entrega) {
        doc.moveDown(0.3);
        const yBox = doc.y;
        const altoBox = 26;
        const mitad = L.anchoUtil / 2;

        doc.rect(L.startX, yBox, L.anchoUtil, altoBox).fillColor('#f3f4f6').fill();

        const dibujarDocumento = (x, titulo, docentry, docnum) => {
            doc.font('Helvetica-Bold').fontSize(7).fillColor('#374151');
            doc.text(titulo, x + 8, yBox + 5, { width: mitad - 16 });
            doc.font('Helvetica').fontSize(8).fillColor('#111827');
            doc.text(docentry || docnum ? `DocEntry ${docentry ?? '—'}    DocNum ${docnum ?? '—'}` : 'Sin registro', x + 8, yBox + 14, { width: mitad - 16 });
        };

        dibujarDocumento(L.startX, 'TRASLADO EN SAP (TRANSFER)', pedido.sap_traslado_entry, pedido.sap_traslado);
        dibujarDocumento(L.startX + mitad, 'ENTREGA EN SAP (DELIVERY)', pedido.sap_entrega_entry, pedido.sap_entrega);

        doc.y = yBox + altoBox;
    }

    doc.fillColor('#000000');
    doc.moveDown(0.4);
    dibujarEncabezadoTabla(doc, L);

    pedido.items.forEach((i) => {
        if (doc.y + 14 > limiteInferior(doc)) {
            doc.addPage();
            dibujarEncabezadoTabla(doc, L);
        }
        dibujarFilaTabla(doc, L, i);
    });

    doc.moveDown(0.6);
}

// Ruta como sección: nombre, piloto y camión (y la fecha en el reporte de tránsito) y un bloque por pedido.
function dibujarViaje(doc, L, viaje, { conFecha }) {
    if (doc.y + 60 > limiteInferior(doc)) doc.addPage();

    dibujarSeccion(doc, L, conFecha ? `${viaje.nombre_ruta}  ·  ${formatearFecha(viaje.fecha_requerida)}` : viaje.nombre_ruta);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text(`${textoViaje(viaje)}   ·   ${viaje.pedidos.length} pedido${viaje.pedidos.length !== 1 ? 's' : ''}`, L.startX);
    doc.fillColor('#000000');
    doc.moveDown(0.4);

    viaje.pedidos.forEach(pedido => dibujarPedido(doc, L, pedido));
}

function pdfDetalle(res, { viajes, titulo, lineas, nombreArchivo, agruparPorFecha }) {
    const doc = crearDocumento(res, nombreArchivo);
    const L = crearLayout(doc);

    dibujarTitulo(doc, titulo, lineas, `Pedidos: ${contarPedidos(viajes)}   ·   ${resumenEstados(viajes)}`);
    dibujarResumenGeneral(doc, L, resumirProductos(viajes), 'No hay pedidos con esos filtros.');
    doc.addPage();

    let fechaActual = null;

    viajes.forEach((viaje) => {
        if (agruparPorFecha && viaje.fecha_requerida !== fechaActual) {
            if (fechaActual !== null) doc.addPage();
            fechaActual = viaje.fecha_requerida;
            doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text(`Fecha requerida: ${formatearFecha(fechaActual)}`, L.startX);
            doc.fillColor('#000000');
            doc.moveDown(0.5);
        }

        dibujarViaje(doc, L, viaje, { conFecha: false });
    });

    doc.end();
}

function pdfEnTransito(res, { viajes, nombreArchivo }) {
    const doc = crearDocumento(res, nombreArchivo);
    const L = crearLayout(doc);
    const totalPedidos = contarPedidos(viajes);

    dibujarTitulo(doc, 'Pedidos en Tránsito — Pollo Artesano', [
        'Pedidos enviados a SAP que todavía no han sido entregados (todas las fechas)',
        `Total: ${totalPedidos} pedido${totalPedidos !== 1 ? 's' : ''}`
    ]);

    // Cajas y libras por viaje (ruta + fecha).
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text('Carga por ruta', L.startX);
    doc.font('Helvetica').fontSize(9).fillColor('#000000');
    viajes.forEach((v) => {
        const resumen = resumirProductos([v]);
        const cajas = resumen.reduce((acc, f) => acc + (f.cajas || 0), 0);
        const libras = resumen.reduce((acc, f) => acc + (f.libras || 0), 0);

        if (doc.y + 12 > limiteInferior(doc)) doc.addPage();
        doc.text(`•  ${v.nombre_ruta} (${formatearFecha(v.fecha_requerida)}): ${numero(cajas)} cajas  ·  ${numero(libras)} libras`, L.startX + 8);
    });
    doc.moveDown(0.8);

    viajes.forEach(viaje => dibujarViaje(doc, L, viaje, { conFecha: true }));

    doc.end();
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

const COLUMNAS_EXCEL_RESUMEN = [
    { header: 'Código', key: 'codigo', width: 14 },
    { header: 'Producto', key: 'nombre', width: 34 },
    { header: 'Unidad', key: 'unidad', width: 10, centrada: true },
    { header: 'Pedido', key: 'pedido', width: 12, centrada: true },
    { header: 'Autorizado', key: 'autorizado', width: 12, centrada: true },
    { header: 'Cajas', key: 'cajas', width: 10, centrada: true },
    { header: 'Libras', key: 'libras', width: 10, centrada: true }
];

const COLUMNAS_EXCEL_DETALLE = [
    { header: 'Fecha requerida', key: 'fecha', width: 14, centrada: true },
    { header: 'Ruta', key: 'ruta', width: 22 },
    { header: 'Piloto', key: 'piloto', width: 24 },
    { header: 'Camión', key: 'camion', width: 11, centrada: true },
    { header: 'Pedido', key: 'numero', width: 17 },
    { header: 'Estado', key: 'estado', width: 13, centrada: true },
    { header: 'Cliente', key: 'cliente', width: 30 },
    { header: 'NIT', key: 'nit', width: 12 },
    { header: 'Dirección de entrega', key: 'direccion', width: 36, ajustar: true },
    { header: 'Pago', key: 'pago', width: 11 },
    { header: 'Boleta', key: 'boleta', width: 12 },
    { header: 'Traslado SAP', key: 'sap', width: 12, centrada: true },
    ...COLUMNAS_EXCEL_RESUMEN
];

function agregarTablaExcel(hoja, columnas, filas) {
    estilarEncabezado(hoja.addRow(columnas.map(c => c.header)));
    columnas.forEach((c, i) => { hoja.getColumn(i + 1).width = c.width; });

    filas.forEach((fila) => {
        const nueva = hoja.addRow(columnas.map(c => fila[c.key] ?? ''));

        columnas.forEach((c, i) => {
            const celda = nueva.getCell(i + 1);

            if (c.centrada) celda.alignment = { horizontal: 'center' };
            if (c.ajustar) celda.alignment = { wrapText: true, vertical: 'top' };
        });
    });
}

function tituloExcel(hoja, titulo, lineas) {
    hoja.addRow([titulo]).font = { bold: true, size: 14 };
    lineas.filter(Boolean).forEach(l => { hoja.addRow([l]).font = { color: { argb: 'FF555555' } }; });
    hoja.addRow([]);
}

function filasResumenExcel(resumen) {
    return resumen.map(f => ({ ...f, autorizado: f.autorizado ?? '', cajas: f.cajas ?? '', libras: f.libras ?? '' }));
}

function filasDetalleExcel(viajes) {
    const filas = [];

    viajes.forEach(v => v.pedidos.forEach(p => p.items.forEach((i) => {
        filas.push({
            fecha: formatearFecha(v.fecha_requerida),
            ruta: v.nombre_ruta,
            piloto: v.piloto || '',
            camion: v.camion_placa || '',
            numero: p.numero_pedido,
            estado: TEXTO_ESTADO[p.estado] || p.estado,
            cliente: p.cliente,
            nit: p.nit,
            direccion: p.direccion,
            pago: p.pago,
            boleta: p.boleta,
            sap: p.sap_traslado || '',
            codigo: i.codigo,
            nombre: i.nombre,
            unidad: i.unidad,
            pedido: i.pedido,
            autorizado: i.autorizado ?? '',
            cajas: i.cajas ?? '',
            libras: i.libras ?? ''
        });
    })));

    return filas;
}

async function excelReporte(res, { viajes, titulo, lineas, nombreArchivo, nombreHojaDetalle }) {
    const libro = new ExcelJS.Workbook();
    libro.creator = 'Core';
    libro.created = new Date();

    const encabezado = [...lineas, `Pedidos: ${contarPedidos(viajes)}   ·   ${resumenEstados(viajes)}`];

    const hojaResumen = libro.addWorksheet('Resumen');
    tituloExcel(hojaResumen, titulo, [...encabezado, 'Totales por producto sin rechazados ni cancelados. Cajas y libras sobre lo autorizado o, si aún no hay, lo pedido.']);
    agregarTablaExcel(hojaResumen, COLUMNAS_EXCEL_RESUMEN, filasResumenExcel(resumirProductos(viajes)));

    const hojaDetalle = libro.addWorksheet(nombreHojaDetalle);
    tituloExcel(hojaDetalle, titulo, encabezado);
    agregarTablaExcel(hojaDetalle, COLUMNAS_EXCEL_DETALLE, filasDetalleExcel(viajes));

    res.setHeader('Content-Type', MIME_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    await libro.xlsx.write(res);
    res.end();
}

// ---------------------------------------------------------------------------
// Entradas públicas
// ---------------------------------------------------------------------------

async function enviarReporteDetalle(res, { formato, viajes, lineas, agruparPorFecha, nombreBase }) {
    const datos = { viajes, titulo: 'Detalle de Pedidos — Pollo Artesano', lineas };

    if (formato === 'excel') {
        return excelReporte(res, { ...datos, nombreArchivo: `${nombreBase}.xlsx`, nombreHojaDetalle: 'Detalle' });
    }

    return pdfDetalle(res, { ...datos, nombreArchivo: `${nombreBase}.pdf`, agruparPorFecha });
}

async function enviarReporteEnTransito(res, { formato, viajes }) {
    if (formato === 'excel') {
        return excelReporte(res, {
            viajes,
            titulo: 'Pedidos en Tránsito — Pollo Artesano',
            lineas: ['Pedidos enviados a SAP que todavía no han sido entregados (todas las fechas)'],
            nombreArchivo: 'pollo_artesano_en_transito.xlsx',
            nombreHojaDetalle: 'En tránsito'
        });
    }

    return pdfEnTransito(res, { viajes, nombreArchivo: 'pollo_artesano_en_transito.pdf' });
}

module.exports = { armarViajes, enviarReporteDetalle, enviarReporteEnTransito };
