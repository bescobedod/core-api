const ExcelJS = require('exceljs');
const { acortarNombre } = require('./nombres.service');

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ZONA_HORARIA = 'America/Guatemala';
const ARGB_ENCABEZADO = 'FF2183AE';

const TEXTO_ESTADO = {
    CREADO: 'Creado',
    RECHAZADO: 'Rechazado',
    CARGADO: 'Cargado',
    ENTREGADO: 'Entregado'
};

function formatearFechaHora(fecha) {
    if (!fecha) return '';
    return new Date(fecha).toLocaleString('es-GT', { timeZone: ZONA_HORARIA, dateStyle: 'short', timeStyle: 'short' });
}

function formatearFecha(fecha) {
    if (!fecha) return '';
    const [anio, mes, dia] = String(fecha).slice(0, 10).split('-');
    return `${dia}/${mes}/${anio}`;
}

function redondear(n) {
    return Math.round(n * 100) / 100;
}

function estilarEncabezado(fila) {
    fila.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    fila.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    fila.eachCell((celda) => {
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_ENCABEZADO } };
    });
}

function agregarTitulo(hoja, titulo, { descripcionFiltros, pedidos, total }) {
    hoja.addRow([titulo]).font = { bold: true, size: 14 };
    if (descripcionFiltros) hoja.addRow([descripcionFiltros]).font = { color: { argb: 'FF555555' } };
    hoja.addRow([`Generado: ${formatearFechaHora(new Date())} · ${pedidos.length} pedido${pedidos.length !== 1 ? 's' : ''}`])
        .font = { color: { argb: 'FF555555' } };
    if (total > pedidos.length) {
        hoja.addRow([`Se incluyen los primeros ${pedidos.length} de ${total} pedidos. Acota los filtros para ver el resto.`])
            .font = { color: { argb: 'FFB45309' }, italic: true };
    }
    hoja.addRow([]);
}

// Lo que se envía de una línea: lo autorizado; sin autorizar todavía, lo solicitado.
function cantidadEnvio(linea) {
    return linea.cantidad_autorizada === null || linea.cantidad_autorizada === undefined
        ? Number(linea.cantidad)
        : Number(linea.cantidad_autorizada);
}

function equivalencias(cantidad, producto) {
    return {
        cajas: producto && producto.factor_caja ? redondear(cantidad / Number(producto.factor_caja)) : null,
        libras: producto && producto.factor_libras ? redondear(cantidad * Number(producto.factor_libras)) : null
    };
}

const COLUMNAS_PEDIDOS = [
    { header: 'Número de pedido', key: 'numero', width: 18 },
    { header: 'Serie', key: 'serie', width: 8 },
    { header: 'Estado', key: 'estado', width: 12, centrada: true },
    { header: 'Fecha requerida', key: 'fecha_requerida', width: 14, centrada: true },
    { header: 'Ruta', key: 'ruta', width: 20 },
    { header: 'Tienda', key: 'tienda', width: 22 },
    { header: 'Cliente', key: 'cliente', width: 28 },
    { header: 'NIT', key: 'nit', width: 12 },
    { header: 'Dirección de entrega', key: 'direccion', width: 36, ajustar: true },
    { header: 'Teléfono', key: 'telefono', width: 13 },
    { header: 'Pago', key: 'pago', width: 12 },
    { header: 'Boleta', key: 'boleta', width: 12 },
    { header: 'Comentario', key: 'comentario', width: 36, ajustar: true },
    { header: 'Creado por', key: 'creado_por', width: 24 },
    { header: 'Fecha de creación', key: 'creado_en', width: 17 },
    { header: 'Rechazado por', key: 'rechazado_por', width: 24 },
    { header: 'Fecha de rechazo', key: 'fecha_rechazo', width: 17 },
    { header: 'Motivo de rechazo', key: 'motivo_rechazo', width: 30, ajustar: true },
    { header: 'Piloto', key: 'piloto', width: 26 },
    { header: 'Cargado por', key: 'cargado_por', width: 24 },
    { header: 'Fecha de carga', key: 'fecha_carga', width: 17 },
    { header: 'Entregado por', key: 'entregado_por', width: 24 },
    { header: 'Fecha de entrega', key: 'fecha_entrega', width: 17 },
    { header: 'Código producto', key: 'codigo', width: 14 },
    { header: 'Producto', key: 'producto', width: 30 },
    { header: 'Solicitado', key: 'solicitado', width: 11, centrada: true },
    { header: 'Autorizado', key: 'autorizado', width: 11, centrada: true },
    { header: 'Cajas', key: 'cajas', width: 9, centrada: true },
    { header: 'Libras', key: 'libras', width: 9, centrada: true },
    { header: 'Precio', key: 'precio', width: 10, centrada: true, moneda: true },
    { header: 'Total', key: 'total', width: 11, centrada: true, moneda: true },
    { header: 'Evidencia de entrega', key: 'evidencia', width: 12, centrada: true }
];

// Una fila por línea de producto de cada pedido, con los datos del pedido repetidos.
function construirHojaPedidos(libro, datos, catalogo) {
    const hoja = libro.addWorksheet('Pedidos');

    agregarTitulo(hoja, 'Reporte de Pollo Artesano', datos);

    const filaEncabezado = hoja.addRow(COLUMNAS_PEDIDOS.map(c => c.header));
    estilarEncabezado(filaEncabezado);
    COLUMNAS_PEDIDOS.forEach((c, i) => { hoja.getColumn(i + 1).width = c.width; });

    let filas = 0;

    datos.pedidos.forEach((p) => {
        const lineas = [...(p.detalle || [])].sort((a, b) => a.numero_linea - b.numero_linea);

        lineas.forEach((l) => {
            const enviado = cantidadEnvio(l);
            const { cajas, libras } = p.estado === 'RECHAZADO' ? { cajas: null, libras: null } : equivalencias(enviado, catalogo.get(l.codigo_producto));

            const valores = {
                numero: p.numero_pedido,
                serie: p.serie,
                estado: TEXTO_ESTADO[p.estado] || p.estado,
                fecha_requerida: formatearFecha(p.fecha_requerida),
                ruta: p.nombre_ruta,
                tienda: p.nombre_tienda_referencia || '',
                cliente: p.cliente_nombre,
                nit: p.cliente_nit || '',
                direccion: p.direccion_entrega,
                telefono: p.telefono_contacto || '',
                pago: { DEPOSITO: 'Depósito', PLANILLA: 'Planilla', PENDIENTE: 'Pendiente' }[p.condicion_pago] || p.condicion_pago,
                boleta: p.numero_boleta || '',
                comentario: p.comentario || '',
                creado_por: acortarNombre(p.creado_por_nombre),
                creado_en: formatearFechaHora(p.creado_en),
                rechazado_por: acortarNombre(p.rechazado_por_nombre),
                fecha_rechazo: formatearFechaHora(p.fecha_rechazo),
                motivo_rechazo: p.motivo_rechazo || '',
                piloto: acortarNombre(p.nombre_piloto),
                cargado_por: acortarNombre(p.cargado_por_nombre),
                fecha_carga: formatearFechaHora(p.fecha_carga),
                entregado_por: acortarNombre(p.entregado_por_nombre),
                fecha_entrega: formatearFechaHora(p.fecha_entrega),
                codigo: l.codigo_producto,
                producto: l.descripcion_producto || l.codigo_producto,
                solicitado: Number(l.cantidad),
                autorizado: l.cantidad_autorizada === null || l.cantidad_autorizada === undefined ? '' : Number(l.cantidad_autorizada),
                cajas: cajas === null ? '' : cajas,
                libras: libras === null ? '' : libras,
                precio: l.precio_unitario === null || l.precio_unitario === undefined ? '' : Number(l.precio_unitario),
                // Lo que se cobra: precio por lo que se envía; un pedido rechazado no cobra nada.
                total: p.estado === 'RECHAZADO' || l.precio_unitario === null || l.precio_unitario === undefined ? '' : redondear(Number(l.precio_unitario) * enviado),
                evidencia: p.evidencia_entrega_key ? 'Sí' : 'No'
            };

            const fila = hoja.addRow(COLUMNAS_PEDIDOS.map(c => valores[c.key] ?? ''));

            COLUMNAS_PEDIDOS.forEach((c, i) => {
                const celda = fila.getCell(i + 1);
                if (c.moneda && typeof celda.value === 'number') celda.numFmt = '"Q"#,##0.00';
                if (c.centrada) celda.alignment = { horizontal: 'center', vertical: 'top' };
                else if (c.ajustar) celda.alignment = { wrapText: true, vertical: 'top' };
                else celda.alignment = { vertical: 'top' };
            });

            if (p.estado === 'RECHAZADO') {
                fila.getCell(COLUMNAS_PEDIDOS.findIndex(c => c.key === 'estado') + 1).font = { color: { argb: 'FFB91C1C' }, bold: true };
            }

            filas += 1;
        });
    });

    hoja.views = [{ state: 'frozen', ySplit: filaEncabezado.number }];

    if (filas > 0) {
        hoja.autoFilter = {
            from: { row: filaEncabezado.number, column: 1 },
            to: { row: filaEncabezado.number + filas, column: COLUMNAS_PEDIDOS.length }
        };
    }
}

// Totales por producto de los pedidos que no se rechazaron.
function construirHojaResumen(libro, datos, catalogo) {
    const hoja = libro.addWorksheet('Resumen por producto');
    const encabezados = [
        { header: 'Código producto', width: 16 },
        { header: 'Producto', width: 34 },
        { header: 'Solicitado', width: 12 },
        { header: 'Autorizado', width: 12 },
        { header: 'Cajas', width: 10 },
        { header: 'Libras', width: 10 }
    ];

    agregarTitulo(hoja, 'Resumen por producto (sin pedidos rechazados)', datos);

    const filaEncabezado = hoja.addRow(encabezados.map(e => e.header));
    estilarEncabezado(filaEncabezado);
    encabezados.forEach((e, i) => { hoja.getColumn(i + 1).width = e.width; });

    const totales = new Map();

    datos.pedidos.filter(p => p.estado !== 'RECHAZADO').forEach((p) => {
        (p.detalle || []).forEach((l) => {
            const actual = totales.get(l.codigo_producto) || { descripcion: l.descripcion_producto || l.codigo_producto, solicitado: 0, autorizado: 0, enviado: 0 };

            actual.solicitado += Number(l.cantidad);
            actual.autorizado += l.cantidad_autorizada === null || l.cantidad_autorizada === undefined ? 0 : Number(l.cantidad_autorizada);
            actual.enviado += cantidadEnvio(l);
            totales.set(l.codigo_producto, actual);
        });
    });

    [...totales.entries()]
        .sort((a, b) => ((catalogo.get(a[0]) || {}).orden ?? 0) - ((catalogo.get(b[0]) || {}).orden ?? 0))
        .forEach(([codigo, t]) => {
            const { cajas, libras } = equivalencias(t.enviado, catalogo.get(codigo));
            const fila = hoja.addRow([codigo, t.descripcion, t.solicitado, t.autorizado, cajas === null ? '' : cajas, libras === null ? '' : libras]);
            for (let i = 3; i <= 6; i += 1) fila.getCell(i).alignment = { horizontal: 'center' };
        });

    hoja.addRow([]);
    hoja.addRow(['Cajas y libras se calculan sobre lo autorizado (o lo solicitado si aún no se autoriza), con los factores del catálogo.'])
        .font = { italic: true, color: { argb: 'FF555555' } };

    hoja.views = [{ state: 'frozen', ySplit: filaEncabezado.number }];
}

// datos: { pedidos (modelos en plano con detalle), total, descripcionFiltros, productos (catálogo) }
async function enviarExcelPedidosArtesano(res, datos, nombreArchivo) {
    const catalogo = new Map(datos.productos.map(p => [p.codigo_producto, p]));
    const libro = new ExcelJS.Workbook();

    construirHojaPedidos(libro, datos, catalogo);
    construirHojaResumen(libro, datos, catalogo);

    res.setHeader('Content-Type', MIME_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

    await libro.xlsx.write(res);
    res.end();
}

module.exports = { enviarExcelPedidosArtesano, MIME_XLSX };
