const ExcelJS = require('exceljs');
const { acortarNombre } = require('./nombres.service');

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ZONA_HORARIA = 'America/Guatemala';
const ARGB_ENCABEZADO = 'FF2183AE';

// Pedidos que no se envían: no cuentan en totales ni cobran nada.
const SIN_ENVIO = ['RECHAZADO', 'CANCELADO'];

const TEXTO_ESTADO = {
    CREADO: 'Creado',
    VALIDADO: 'Validado',
    RECHAZADO: 'Rechazado',
    CANCELADO: 'Cancelado',
    EN_TRANSITO: 'En tránsito',
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
    { header: 'Cancelado por', key: 'cancelado_por', width: 24 },
    { header: 'Fecha de cancelación', key: 'fecha_cancelacion', width: 17 },
    { header: 'Motivo de cancelación', key: 'motivo_cancelacion', width: 30, ajustar: true },
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
            const { cajas, libras } = SIN_ENVIO.includes(p.estado) ? { cajas: null, libras: null } : equivalencias(enviado, catalogo.get(l.codigo_producto));

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
                cancelado_por: acortarNombre(p.cancelado_por_nombre),
                fecha_cancelacion: formatearFechaHora(p.fecha_cancelacion),
                motivo_cancelacion: p.motivo_cancelacion || '',
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
                total: SIN_ENVIO.includes(p.estado) || l.precio_unitario === null || l.precio_unitario === undefined ? '' : redondear(Number(l.precio_unitario) * enviado),
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

            if (SIN_ENVIO.includes(p.estado)) {
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

    agregarTitulo(hoja, 'Resumen por producto (sin pedidos rechazados ni cancelados)', datos);

    const filaEncabezado = hoja.addRow(encabezados.map(e => e.header));
    estilarEncabezado(filaEncabezado);
    encabezados.forEach((e, i) => { hoja.getColumn(i + 1).width = e.width; });

    const totales = new Map();

    datos.pedidos.filter(p => !SIN_ENVIO.includes(p.estado)).forEach((p) => {
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

// ------------------------------------------------------------
// Reporte por cliente: una hoja por cliente, igual al control de contabilidad.
// ------------------------------------------------------------
const ARGB_DEPOSITO = 'FFFFFFCC';
const ARGB_RECHAZADO = 'FFBDD7EE';
const BORDE_FINO = { style: 'thin' };
const FORMATO_MONEDA = '"Q"#,##0.00';

const TEXTO_PAGO = { DEPOSITO: 'pago por depósito', PLANILLA: 'descuento de planilla', PENDIENTE: 'pago pendiente' };

// Nombre de hoja: máximo 31 caracteres, sin caracteres no permitidos y sin repetirse.
function nombreDeHoja(nombre, usados) {
    const base = (acortarNombre(nombre) || 'CLIENTE').toUpperCase().replace(/[\[\]:*?/\\]/g, '').slice(0, 31) || 'CLIENTE';
    let candidato = base;
    let n = 2;

    while (usados.has(candidato)) {
        const sufijo = ` ${n}`;
        candidato = base.slice(0, 31 - sufijo.length) + sufijo;
        n += 1;
    }

    usados.add(candidato);

    return candidato;
}

function textoObservaciones(pedido, codigoEmpleado) {
    const empleado = codigoEmpleado ? ` - ${codigoEmpleado}` : '';
    const pago = TEXTO_PAGO[pedido.condicion_pago] || '';
    const base = `Pedido para ${pedido.cliente_nombre}${empleado}${pago ? `, ${pago}` : ''}.`;

    return pedido.comentario ? `${base} ${pedido.comentario}` : base;
}

function textoSinEnvio(p) {
    const cancelado = p.estado === 'CANCELADO';
    const motivo = cancelado ? p.motivo_cancelacion : p.motivo_rechazo;

    return `Envío ${cancelado ? 'cancelado' : 'rechazado'}${motivo ? `: ${motivo}` : ''}`;
}

function construirHojaCliente(libro, nombreHoja, pedidos, codigoEmpleado, catalogo) {
    const hoja = libro.addWorksheet(nombreHoja);

    // Productos que pidió el cliente, en el orden del catálogo; el nombre es el del pedido más reciente.
    const nombres = new Map();

    pedidos.forEach((p) => {
        (p.detalle || []).forEach((l) => nombres.set(l.codigo_producto, l.descripcion_producto || l.codigo_producto));
    });

    const codigos = [...nombres.keys()].sort((a, b) => ((catalogo.get(a) || {}).orden ?? 999) - ((catalogo.get(b) || {}).orden ?? 999));

    const encabezados = [
        '-', 'Tienda',
        ...codigos.map(c => nombres.get(c)),
        'Observaciones', 'Fecha', 'No. Envio', 'Ruta',
        'Facturación', 'Autorización', 'Banco', 'Fecha de depósito', 'Cantidad depositada',
        ...codigos.map(c => `Total ${nombres.get(c)}`),
        'Nombre', 'Firma', 'Obs'
    ];

    const filaEncabezado = hoja.addRow(encabezados);
    const colObservaciones = 3 + codigos.length;
    const colFacturacion = colObservaciones + 4;
    const colAutorizacion = colObservaciones + 5;
    const colUltimoDeposito = colObservaciones + 8;
    const colPrimerTotal = colUltimoDeposito + 1;

    filaEncabezado.font = { bold: true };
    filaEncabezado.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

    for (let c = colFacturacion; c <= colUltimoDeposito; c += 1) {
        filaEncabezado.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_DEPOSITO } };
    }

    const anchos = [2.4, 20, ...codigos.map(() => 13), 45, 12, 16, 22, 28, 15, 10, 20, 22, ...codigos.map(() => 18), 18, 18, 34];

    anchos.forEach((ancho, i) => { hoja.getColumn(i + 1).width = ancho; });

    const ordenados = [...pedidos].sort((a, b) => String(a.fecha_requerida).localeCompare(String(b.fecha_requerida)) || String(a.numero_pedido).localeCompare(String(b.numero_pedido)));

    ordenados.forEach((p) => {
        const rechazado = SIN_ENVIO.includes(p.estado);
        const planilla = p.condicion_pago === 'PLANILLA';
        const lineas = new Map((p.detalle || []).map(l => [l.codigo_producto, l]));
        const numeroFila = hoja.rowCount + 1;
        const facturacion = [p.cliente_nit, acortarNombre(p.cliente_nombre)].filter(Boolean).join(' - ');

        const valores = [
            '',
            (p.nombre_tienda_referencia || '').toUpperCase(),
            ...codigos.map(c => (lineas.has(c) ? cantidadEnvio(lineas.get(c)) : '-')),
            textoObservaciones(p, codigoEmpleado),
            String(p.fecha_requerida).slice(0, 10),
            p.numero_pedido,
            p.nombre_ruta,
            facturacion,
            planilla ? 'N/A' : (p.condicion_pago === 'DEPOSITO' && p.numero_boleta ? p.numero_boleta : ''),
            planilla ? 'N/A' : '',
            planilla ? 'N/A' : '',
            planilla ? 'N/A' : '',
            ...codigos.map((c, i) => {
                const linea = lineas.get(c);

                if (!linea) return '-';
                if (rechazado || linea.precio_unitario === null || linea.precio_unitario === undefined) return '';

                const columna = hoja.getColumn(3 + i).letter;
                const precio = Number(linea.precio_unitario);

                return { formula: `${precio}*${columna}${numeroFila}`, result: redondear(precio * cantidadEnvio(linea)) };
            }),
            '',
            '',
            rechazado ? textoSinEnvio(p) : ''
        ];

        const fila = hoja.addRow(valores);

        fila.eachCell({ includeEmpty: true }, (celda, col) => {
            celda.border = { top: BORDE_FINO, left: BORDE_FINO, bottom: BORDE_FINO, right: BORDE_FINO };

            const esTexto = col === colObservaciones || col === 2 || col === valores.length;

            celda.alignment = { horizontal: esTexto ? 'left' : 'center', vertical: 'middle', wrapText: col === colObservaciones };

            if (col >= 3 && col < colObservaciones) celda.numFmt = '0';
            if (col === colUltimoDeposito || (col >= colPrimerTotal && col < colPrimerTotal + codigos.length)) celda.numFmt = FORMATO_MONEDA;

            if (rechazado) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_RECHAZADO } };
        });
    });

    hoja.views = [{ state: 'frozen', ySplit: 1 }];

    // Marca en rojo los números de autorización repetidos.
    if (ordenados.length > 0) {
        const letra = hoja.getColumn(colAutorizacion).letter;
        const rango = `${letra}2:${letra}${ordenados.length + 1}`;

        hoja.addConditionalFormatting({
            ref: rango,
            rules: [{
                type: 'expression',
                priority: 1,
                formulae: [`AND(LEN(${letra}2)>0,${letra}2<>"N/A",COUNTIF($${letra}$2:$${letra}$${ordenados.length + 1},${letra}2)>1)`],
                style: {
                    fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } },
                    font: { color: { argb: 'FF9C0006' } }
                }
            }]
        });
    }
}

// datos: { pedidos (con detalle), clientes (Map id -> codigo_empleado), productos (catálogo) }
async function enviarExcelPorCliente(res, datos, nombreArchivo) {
    const catalogo = new Map(datos.productos.map(p => [p.codigo_producto, p]));
    const libro = new ExcelJS.Workbook();
    const porCliente = new Map();

    datos.pedidos.forEach((p) => {
        if (!porCliente.has(p.cliente_id)) porCliente.set(p.cliente_id, []);
        porCliente.get(p.cliente_id).push(p);
    });

    const usados = new Set();

    [...porCliente.entries()]
        .sort((a, b) => String(a[1][0].cliente_nombre).localeCompare(String(b[1][0].cliente_nombre), 'es'))
        .forEach(([clienteId, pedidos]) => {
            construirHojaCliente(libro, nombreDeHoja(pedidos[0].cliente_nombre, usados), pedidos, datos.clientes.get(clienteId), catalogo);
        });

    res.setHeader('Content-Type', MIME_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

    await libro.xlsx.write(res);
    res.end();
}

module.exports = {
    enviarExcelPedidosArtesano,
    enviarExcelPorCliente,
    MIME_XLSX,
    TEXTO_ESTADO,
    SIN_ENVIO,
    formatearFecha,
    redondear,
    cantidadEnvio,
    equivalencias,
    estilarEncabezado
};
