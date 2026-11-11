const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// Constancia de envío de un pedido de pollo artesano: una página por pedido, en
// media carta (5.5 x 8.5 in) como el envío que se imprime hoy en Nomina. Se firma
// al entregar, por eso lleva el pie de recepción con nombre y firma.
const ANCHO = 396;
const ALTO = 612;
const MARGEN = 28;

// Logo de Avígua. Si el archivo no está, el envío sale sin logo.
const RUTA_LOGO = path.join(__dirname, '..', 'assets', 'logos', 'avigua.png');
const TAMANO_LOGO = 50;

// QR de la esquina inferior derecha: la PioApp lo escanea al entregar. Lleva el id y el número del pedido.
const TAMANO_QR = 66;

async function generarQr(pedido) {
    const carga = JSON.stringify({ tipo: 'POLLO_ARTESANO', id_pedido: pedido.id, serie: pedido.numero_pedido });

    // Corrección baja: menos módulos, más legible en tamaño pequeño.
    return QRCode.toBuffer(carga, { margin: 0, errorCorrectionLevel: 'L', width: 330 });
}

function formatearFecha(fecha) {
    const [anio, mes, dia] = String(fecha).slice(0, 10).split('-');

    return `${dia}/${mes}/${anio}`;
}

function formatearCantidad(n) {
    return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

// Dibuja "ETIQUETA: valor" y devuelve la altura usada.
function campo(doc, etiqueta, valor, x, y, ancho) {
    const texto = `${etiqueta}: ${valor || '—'}`;

    doc.font('Helvetica-Bold').fontSize(9).text(texto, x, y, { width: ancho });

    return doc.heightOfString(texto, { width: ancho });
}

const TEXTO_PAGO = { DEPOSITO: 'Depósito / Transferencia', PLANILLA: 'Descuento de planilla', PENDIENTE: 'Pendiente de pago' };

function formatearQuetzales(n) {
    return `Q${Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

// Cuadro de cobro de colaboradores: datos del cliente, forma de pago, detalle con precios y total.
function dibujarCuadroCobro(doc, pedido, yPie) {
    const ancho = ANCHO - MARGEN * 2;
    const x = MARGEN;
    const alto = { fila: 15, encabezado: 17, linea: 15, total: 20 };

    const lineas = pedido.items
        .map(i => ({ ...i, cantidad_envio: i.cantidad_autorizada === null ? i.cantidad : i.cantidad_autorizada }))
        .filter(i => i.cantidad_envio > 0);

    const datos = [];
    datos.push(['Código', pedido.codigo_empleado]);
    datos.push(['Nombre', pedido.cliente_nombre]);
    datos.push(['Pago', TEXTO_PAGO[pedido.condicion_pago] || pedido.condicion_pago]);
    if (pedido.condicion_pago === 'DEPOSITO' && pedido.numero_boleta) datos.push(['Boleta', pedido.numero_boleta]);

    const altoTotal = datos.length * alto.fila + alto.encabezado + lineas.length * alto.linea + alto.total;
    const y0 = yPie - altoTotal - 24; // deja aire sobre el pie y el QR
    const colEtiqueta = 62;
    const cols = [{ w: ancho - 172, align: 'left' }, { w: 58, align: 'right' }, { w: 48, align: 'center' }, { w: 66, align: 'right' }];
    let y = y0;

    doc.lineWidth(1).strokeColor('#000000').rect(x, y0, ancho, altoTotal).stroke();
    doc.fillColor('#000000');

    datos.forEach(([etiqueta, valor]) => {
        doc.font('Helvetica-Bold').fontSize(8.5).text(etiqueta, x + 4, y + 4, { width: colEtiqueta - 6 });
        doc.font('Helvetica').fontSize(8.5).text(valor || '—', x + colEtiqueta, y + 4, { width: ancho - colEtiqueta - 6, lineBreak: false, ellipsis: true });
        y += alto.fila;
        doc.lineWidth(0.5).moveTo(x, y).lineTo(x + ancho, y).stroke();
    });

    const titulos = ['Producto', 'Entero / Libra', 'Cantidad', 'Total'];
    let cx = x + 4;
    doc.font('Helvetica-Bold').fontSize(8);
    cols.forEach((c, i) => {
        doc.text(titulos[i], cx, y + 5, { width: c.w - 6, align: c.align === 'left' ? 'left' : 'center', lineBreak: false });
        cx += c.w;
    });
    y += alto.encabezado;

    let total = 0;
    let sinPrecio = false;

    doc.font('Helvetica').fontSize(8.5);
    lineas.forEach((l) => {
        const tienePrecio = l.precio_unitario !== null && l.precio_unitario !== undefined;
        const importe = tienePrecio ? l.precio_unitario * l.cantidad_envio : null;

        if (tienePrecio) total += importe;
        else sinPrecio = true;

        const celdas = [
            l.descripcion_producto || l.codigo_producto,
            tienePrecio ? formatearQuetzales(l.precio_unitario) : '—',
            formatearCantidad(l.cantidad_envio),
            importe === null ? '—' : formatearQuetzales(importe)
        ];

        cx = x + 4;
        cols.forEach((c, i) => {
            doc.text(celdas[i], cx, y + 3, { width: c.w - 6, height: 11, align: i === 2 ? 'center' : c.align, ellipsis: true });
            cx += c.w;
        });
        y += alto.linea;
    });

    doc.lineWidth(0.5).moveTo(x, y).lineTo(x + ancho, y).stroke();
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Total a cancelar', x + 4, y + 6, { width: ancho - 80, align: 'right', lineBreak: false });
    doc.text(sinPrecio ? 'Sin precio' : formatearQuetzales(total), x + ancho - 74, y + 6, { width: 70, align: 'right', lineBreak: false });
}

function dibujarPedido(doc, pedido, numeroPagina, conCuadro, qr) {
    const ancho = ANCHO - MARGEN * 2;
    const tercio = ancho / 3;
    let y = MARGEN;

    if (fs.existsSync(RUTA_LOGO)) {
        try {
            doc.image(RUTA_LOGO, MARGEN, y, { fit: [TAMANO_LOGO, TAMANO_LOGO] });
        } catch (error) {
            console.error('[PedidoArtesano] No se pudo dibujar el logo en el PDF:', error.message);
        }
    }

    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(14).text('ENVIO A CLIENTE', MARGEN, y, { width: ancho, align: 'center' });
    y += 17;
    doc.text('PEDIDO ESPECIAL', MARGEN, y, { width: ancho, align: 'center' });
    y += 26;

    // Encabezado: tres columnas como en el envío actual.
    let alto = Math.max(
        campo(doc, 'RUTA', pedido.nombre_ruta, MARGEN, y, tercio),
        campo(doc, 'FECHA', formatearFecha(pedido.fecha_requerida), MARGEN + tercio, y, tercio),
        campo(doc, 'SERIE', pedido.serie, MARGEN + tercio * 2, y, tercio)
    );
    y += alto + 5;

    alto = Math.max(
        campo(doc, 'PILOTO', pedido.nombre_piloto, MARGEN, y, tercio * 2),
        campo(doc, 'NUMERO', pedido.numero_pedido, MARGEN + tercio * 2, y, tercio)
    );
    y += alto + 5;

    y += campo(doc, 'ORIGEN', pedido.creado_por, MARGEN, y, ancho) + 5;
    y += campo(doc, 'TIENDA', pedido.nombre_tienda_referencia, MARGEN, y, ancho) + 5;
    y += campo(doc, 'CLIENTE', pedido.cliente_nombre, MARGEN, y, ancho) + 5;
    if (pedido.direccion_entrega) y += campo(doc, 'DIRECCION', pedido.direccion_entrega, MARGEN, y, ancho) + 5;
    if (pedido.telefono_contacto) y += campo(doc, 'TELEFONO', pedido.telefono_contacto, MARGEN, y, ancho) + 5;
    if (pedido.comentario) y += campo(doc, 'OBSERVACIONES', pedido.comentario, MARGEN, y, ancho) + 5;

    y += 6;
    doc.moveTo(MARGEN, y).lineTo(MARGEN + ancho, y).lineWidth(0.5).strokeColor('#000000').stroke();
    y += 8;

    // Solo lo que se autorizó; lo que quedó en 0 no se envía.
    const lineas = pedido.items
        .map(i => ({ ...i, cantidad_envio: i.cantidad_autorizada === null ? i.cantidad : i.cantidad_autorizada }))
        .filter(i => i.cantidad_envio > 0);

    const colCantidad = 60;
    const colCodigo = 90;

    // Una línea por producto, en el orden del pedido, separadas por una línea divisora.
    lineas.forEach((l) => {
        doc.font('Helvetica').fontSize(10);
        doc.text(formatearCantidad(l.cantidad_envio), MARGEN, y, { width: colCantidad, align: 'center' });
        doc.text(l.codigo_producto, MARGEN + colCantidad, y, { width: colCodigo, align: 'center' });
        const descripcion = l.descripcion_producto || l.codigo_producto;
        doc.text(descripcion, MARGEN + colCantidad + colCodigo, y, { width: ancho - colCantidad - colCodigo });
        y += Math.max(14, doc.heightOfString(descripcion, { width: ancho - colCantidad - colCodigo }) + 3) + 3;
        doc.moveTo(MARGEN, y).lineTo(MARGEN + ancho, y).lineWidth(0.5).strokeColor('#000000').stroke();
        y += 5;
    });

    // Pie fijo al fondo de la página.
    const yPie = ALTO - MARGEN - 52;

    // El cuadro de cobro es solo para colaboradores (clientes con código de empleado).
    if (conCuadro && pedido.codigo_empleado) dibujarCuadroCobro(doc, pedido, yPie);

    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('DEVOLUCION EN TIENDA', MARGEN, yPie, { width: ancho });
    // El pie deja libre la esquina derecha para el QR.
    const anchoPie = ancho - TAMANO_QR - 10;
    doc.text('NOMBRE:______________________________', MARGEN, yPie + 16, { width: anchoPie });
    doc.text('FIRMA QUIEN RECIBE: ________________', MARGEN, yPie + 32, { width: anchoPie });

    doc.image(qr, ANCHO - MARGEN - TAMANO_QR, ALTO - MARGEN - TAMANO_QR, { width: TAMANO_QR, height: TAMANO_QR });

    doc.font('Helvetica').fontSize(8).text(`Página ${numeroPagina}`, MARGEN, ALTO - 16, { width: ancho, align: 'right' });
}

// Escribe en res un PDF con una página por pedido.
// conCuadro: agrega el cuadro de cobro a los pedidos de colaboradores (es el envío de Pollo Artesano;
// Avícola lo imprime sin él).
async function generarPdfEnvios(res, pedidos, nombreArchivo, { conCuadro = false } = {}) {
    // Los QR se generan antes de escribir la respuesta.
    const qrs = await Promise.all(pedidos.map(generarQr));
    const doc = new PDFDocument({ size: [ANCHO, ALTO], margin: MARGEN, autoFirstPage: false });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
    doc.pipe(res);

    pedidos.forEach((pedido, i) => {
        doc.addPage({ size: [ANCHO, ALTO], margin: MARGEN });
        // El número de página y el pie van dentro del margen inferior: sin esto pdfkit
        // los toma por desborde y agrega una página en blanco después de cada pedido.
        doc.page.margins.bottom = 0;
        dibujarPedido(doc, pedido, i + 1, conCuadro, qrs[i]);
    });

    doc.end();
}

module.exports = { generarPdfEnvios };
