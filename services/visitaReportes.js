const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ZONA_HORARIA = 'America/Guatemala';
const COLOR_ENCABEZADO = '#2183AE';
const MAX_CARACTERES_COMENTARIO_PDF = 800;

function formatearFechaHora(fecha) {
    if (!fecha) return '';
    return new Date(fecha).toLocaleString('es-GT', { timeZone: ZONA_HORARIA, dateStyle: 'short', timeStyle: 'short' });
}

function formatearCoordenadas(lat, lng) {
    if (lat === null || lng === null || lat === undefined || lng === undefined) return '';
    return `${lat.toFixed(6)}\n${lng.toFixed(6)}`;
}

// Prefiere el GPS del teléfono; si no vino, usa el de la foto.
function urlMapa(fila) {
    const lat = fila.phone_lat ?? fila.photo_lat;
    const lng = fila.phone_lng ?? fila.photo_lng;
    if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
    return `https://www.google.com/maps?q=${lat},${lng}`;
}

const COLUMNAS_PDF = [
    { titulo: 'Fecha', ancho: 80, valor: f => formatearFechaHora(f.fecha_visita) },
    { titulo: 'Usuario', ancho: 110, valor: f => f.usuario_nombre || '' },
    { titulo: 'Lugar', ancho: 125, valor: f => [f.whs_name, f.whs_code].filter(Boolean).join('\n') },
    {
        titulo: 'Comentario',
        ancho: 200,
        valor: f => {
            const texto = f.comentario || '';
            return texto.length > MAX_CARACTERES_COMENTARIO_PDF
                ? `${texto.slice(0, MAX_CARACTERES_COMENTARIO_PDF)}…`
                : texto;
        }
    },
    { titulo: 'GPS teléfono', ancho: 80, valor: f => formatearCoordenadas(f.phone_lat, f.phone_lng) },
    { titulo: 'GPS foto', ancho: 80, valor: f => formatearCoordenadas(f.photo_lat, f.photo_lng) },
    { titulo: 'Evid.', ancho: 45, valor: f => String(f.total_evidencias), centrada: true }
];

const PADDING_CELDA = 4;
const TAMANO_TEXTO = 7.5;

function dibujarEncabezadoTabla(doc, x0, y) {
    const alto = 18;
    let x = x0;

    COLUMNAS_PDF.forEach((col) => {
        doc.rect(x, y, col.ancho, alto).fill(COLOR_ENCABEZADO);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8)
            .text(col.titulo, x + PADDING_CELDA, y + 5, { width: col.ancho - PADDING_CELDA * 2, align: col.centrada ? 'center' : 'left' });
        x += col.ancho;
    });

    return y + alto;
}

// filas: salida de consultarVisitas() del controlador. total: cuántas visitas
// cumplen el filtro (puede ser mayor que filas.length si se truncó).
function dibujarPdfVisitas(res, { filas, total, descripcionFiltros, nombreArchivo }) {
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 36 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
    doc.pipe(res);

    const x0 = doc.page.margins.left;
    const anchoTabla = COLUMNAS_PDF.reduce((suma, c) => suma + c.ancho, 0);
    const limiteY = doc.page.height - doc.page.margins.bottom;

    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(15).text('Reporte de Visitas a Avícolas', x0, doc.page.margins.top);
    doc.font('Helvetica').fontSize(9).fillColor('#555555');
    if (descripcionFiltros) doc.text(descripcionFiltros);
    doc.text(`Generado: ${formatearFechaHora(new Date())} · ${filas.length} visita${filas.length !== 1 ? 's' : ''}`);

    let y = dibujarEncabezadoTabla(doc, x0, doc.y + 8);

    filas.forEach((fila, indice) => {
        doc.font('Helvetica').fontSize(TAMANO_TEXTO);

        const textos = COLUMNAS_PDF.map(c => c.valor(fila));
        const alturaTexto = Math.max(...textos.map((t, i) =>
            doc.heightOfString(t, { width: COLUMNAS_PDF[i].ancho - PADDING_CELDA * 2 })));
        const alto = alturaTexto + PADDING_CELDA * 2;

        if (y + alto > limiteY) {
            doc.addPage();
            y = dibujarEncabezadoTabla(doc, x0, doc.page.margins.top);
        }

        if (indice % 2 === 1) {
            doc.rect(x0, y, anchoTabla, alto).fill('#F3F7FA');
        }

        let x = x0;
        COLUMNAS_PDF.forEach((col, i) => {
            doc.fillColor('#222222').font('Helvetica').fontSize(TAMANO_TEXTO)
                .text(textos[i], x + PADDING_CELDA, y + PADDING_CELDA, {
                    width: col.ancho - PADDING_CELDA * 2,
                    align: col.centrada ? 'center' : 'left'
                });
            x += col.ancho;
        });

        doc.moveTo(x0, y + alto).lineTo(x0 + anchoTabla, y + alto).lineWidth(0.5).strokeColor('#E5E7EB').stroke();
        y += alto;
    });

    if (total > filas.length && y + 20 <= limiteY) {
        doc.fillColor('#B45309').font('Helvetica-Oblique').fontSize(8)
            .text(`Se muestran las primeras ${filas.length} de ${total} visitas. Acota los filtros para ver el resto.`, x0, y + 8, { width: anchoTabla });
    }

    doc.end();
}

const COLUMNAS_EXCEL = [
    { header: 'Fecha', key: 'fecha', width: 18 },
    { header: 'Usuario', key: 'usuario', width: 28 },
    { header: 'Código usuario', key: 'codigo_user', width: 16 },
    { header: 'Lugar', key: 'whs_name', width: 30 },
    { header: 'Código lugar', key: 'whs_code', width: 14 },
    { header: 'Comentario', key: 'comentario', width: 60, ajustar: true },
    { header: 'Latitud teléfono', key: 'phone_lat', width: 15, coordenada: true },
    { header: 'Longitud teléfono', key: 'phone_lng', width: 15, coordenada: true },
    { header: 'Latitud foto', key: 'photo_lat', width: 15, coordenada: true },
    { header: 'Longitud foto', key: 'photo_lng', width: 15, coordenada: true },
    { header: 'Mapa', key: 'mapa', width: 12 },
    { header: 'Sin conexión', key: 'offline', width: 13, centrada: true },
    { header: 'Dispositivo', key: 'dispositivo', width: 22 },
    { header: 'Sistema operativo', key: 'so', width: 20 },
    { header: 'Evidencias', key: 'evidencias', width: 11, centrada: true }
];

function construirExcelVisitas({ filas, total, descripcionFiltros }) {
    const libro = new ExcelJS.Workbook();
    libro.creator = 'Core';
    libro.created = new Date();

    const hoja = libro.addWorksheet('Visitas');

    hoja.addRow(['Reporte de Visitas a Avícolas']).font = { bold: true, size: 14 };
    if (descripcionFiltros) hoja.addRow([descripcionFiltros]).font = { color: { argb: 'FF555555' } };
    hoja.addRow([`Generado: ${formatearFechaHora(new Date())} · ${filas.length} visita${filas.length !== 1 ? 's' : ''}`])
        .font = { color: { argb: 'FF555555' } };
    if (total > filas.length) {
        hoja.addRow([`Se incluyen las primeras ${filas.length} de ${total} visitas. Acota los filtros para ver el resto.`])
            .font = { color: { argb: 'FFB45309' }, italic: true };
    }
    hoja.addRow([]);

    const filaEncabezado = hoja.addRow(COLUMNAS_EXCEL.map(c => c.header));
    filaEncabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    filaEncabezado.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    filaEncabezado.eachCell((celda) => {
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2183AE' } };
    });

    COLUMNAS_EXCEL.forEach((c, i) => { hoja.getColumn(i + 1).width = c.width; });

    filas.forEach((f) => {
        const valores = {
            fecha: formatearFechaHora(f.fecha_visita),
            usuario: f.usuario_nombre || '',
            codigo_user: f.codigo_user || '',
            whs_name: f.whs_name || '',
            whs_code: f.whs_code || '',
            comentario: f.comentario || '',
            phone_lat: f.phone_lat,
            phone_lng: f.phone_lng,
            photo_lat: f.photo_lat,
            photo_lng: f.photo_lng,
            mapa: '',
            offline: f.is_offline ? 'Sí' : 'No',
            dispositivo: f.device_model || '',
            so: f.device_so || '',
            evidencias: f.total_evidencias
        };

        const fila = hoja.addRow(COLUMNAS_EXCEL.map(c => valores[c.key] ?? ''));

        COLUMNAS_EXCEL.forEach((c, i) => {
            const celda = fila.getCell(i + 1);
            if (c.centrada) celda.alignment = { horizontal: 'center', vertical: 'top' };
            else if (c.ajustar) celda.alignment = { wrapText: true, vertical: 'top' };
            else celda.alignment = { vertical: 'top' };
            if (c.coordenada && typeof celda.value === 'number') celda.numFmt = '0.000000';
        });

        const enlace = urlMapa(f);
        if (enlace) {
            const celdaMapa = fila.getCell(COLUMNAS_EXCEL.findIndex(c => c.key === 'mapa') + 1);
            celdaMapa.value = { text: 'Ver mapa', hyperlink: enlace };
            celdaMapa.font = { color: { argb: 'FF2183AE' }, underline: true };
        }
    });

    hoja.views = [{ state: 'frozen', ySplit: filaEncabezado.number }];

    if (filas.length > 0) {
        hoja.autoFilter = {
            from: { row: filaEncabezado.number, column: 1 },
            to: { row: filaEncabezado.number + filas.length, column: COLUMNAS_EXCEL.length }
        };
    }

    return libro;
}

async function enviarExcelVisitas(res, datos, nombreArchivo) {
    const libro = construirExcelVisitas(datos);

    res.setHeader('Content-Type', MIME_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    await libro.xlsx.write(res);
    res.end();
}

module.exports = { dibujarPdfVisitas, enviarExcelVisitas };
