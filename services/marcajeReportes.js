const ExcelJS = require('exceljs');

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ZONA_HORARIA = 'America/Guatemala';
const ARGB_ENCABEZADO = 'FF2183AE';

function formatearFechaHora(fecha) {
    if (!fecha) return '';
    return new Date(fecha).toLocaleString('es-GT', { timeZone: ZONA_HORARIA, dateStyle: 'short', timeStyle: 'short' });
}

function urlMapa(fila) {
    if (fila.latitud === null || fila.longitud === null) return null;
    return `https://www.google.com/maps?q=${fila.latitud},${fila.longitud}`;
}

function textoZona(fila) {
    switch (fila.zona_estado) {
        case 'DENTRO': return 'Dentro de la zona';
        case 'FUERA': return 'Fuera de la zona';
        case 'SIN_GPS': return 'Sin GPS';
        default: return 'Sin restricción';
    }
}

const COLUMNAS_MARCAJES = [
    { header: 'Fecha y hora', key: 'fecha', width: 18 },
    { header: 'Usuario', key: 'usuario', width: 28 },
    { header: 'Código usuario', key: 'codigo_user', width: 16 },
    { header: 'Puesto', key: 'puesto', width: 24 },
    { header: 'Tipo', key: 'tipo', width: 10, centrada: true },
    { header: 'Válido', key: 'valido', width: 9, centrada: true },
    { header: 'Razón de invalidez', key: 'razon', width: 45, ajustar: true },
    { header: 'Zonas asignadas', key: 'zonas_asignadas', width: 24 },
    { header: 'Resultado de zona', key: 'zona_resultado', width: 18 },
    { header: 'Zona evaluada', key: 'zona_nombre', width: 22 },
    { header: 'Distancia a la zona (m)', key: 'distancia', width: 14, centrada: true },
    { header: 'Latitud', key: 'latitud', width: 12, coordenada: true },
    { header: 'Longitud', key: 'longitud', width: 12, coordenada: true },
    { header: 'Mapa', key: 'mapa', width: 11 },
    { header: 'Sin conexión', key: 'offline', width: 13, centrada: true },
    { header: 'Dispositivo', key: 'dispositivo', width: 30 },
    { header: 'IP', key: 'ip', width: 16 },
    { header: 'Sincronizado', key: 'sincronizado', width: 18 }
];

function construirResumenPorUsuario(filas) {
    const resumen = new Map();

    filas.forEach((f) => {
        if (!resumen.has(f.id_usuario)) {
            resumen.set(f.id_usuario, {
                usuario: f.usuario_nombre,
                codigo_user: f.codigo_user || '',
                entradas: 0,
                salidas: 0,
                invalidos: 0,
                fuera_zona: 0,
                offline: 0,
                primero: f.fecha_hora,
                ultimo: f.fecha_hora
            });
        }

        const r = resumen.get(f.id_usuario);
        if (f.tipo === 'ENTRADA') r.entradas += 1;
        if (f.tipo === 'SALIDA') r.salidas += 1;
        if (!f.es_valido) r.invalidos += 1;
        if (f.zona_estado === 'FUERA') r.fuera_zona += 1;
        if (f.is_offline) r.offline += 1;
        if (new Date(f.fecha_hora) < new Date(r.primero)) r.primero = f.fecha_hora;
        if (new Date(f.fecha_hora) > new Date(r.ultimo)) r.ultimo = f.fecha_hora;
    });

    return [...resumen.values()].sort((a, b) => a.usuario.localeCompare(b.usuario));
}

function estilarEncabezado(fila) {
    fila.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    fila.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    fila.eachCell((celda) => {
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_ENCABEZADO } };
    });
}

function agregarTitulo(hoja, titulo, { descripcionFiltros, filas, total }) {
    hoja.addRow([titulo]).font = { bold: true, size: 14 };
    if (descripcionFiltros) hoja.addRow([descripcionFiltros]).font = { color: { argb: 'FF555555' } };
    hoja.addRow([`Generado: ${formatearFechaHora(new Date())} · ${filas.length} marcaje${filas.length !== 1 ? 's' : ''}`])
        .font = { color: { argb: 'FF555555' } };
    if (total > filas.length) {
        hoja.addRow([`Se incluyen los primeros ${filas.length} de ${total} marcajes. Acota los filtros para ver el resto.`])
            .font = { color: { argb: 'FFB45309' }, italic: true };
    }
    hoja.addRow([]);
}

function construirHojaMarcajes(libro, datos) {
    const { filas } = datos;
    const hoja = libro.addWorksheet('Marcajes');

    agregarTitulo(hoja, 'Reporte de Marcajes', datos);

    const filaEncabezado = hoja.addRow(COLUMNAS_MARCAJES.map(c => c.header));
    estilarEncabezado(filaEncabezado);

    COLUMNAS_MARCAJES.forEach((c, i) => { hoja.getColumn(i + 1).width = c.width; });

    filas.forEach((f) => {
        const valores = {
            fecha: formatearFechaHora(f.fecha_hora),
            usuario: f.usuario_nombre || '',
            codigo_user: f.codigo_user || '',
            puesto: f.puesto_trabajo || '',
            tipo: f.tipo,
            valido: f.es_valido ? 'Sí' : 'No',
            razon: f.razon_invalido || '',
            zonas_asignadas: f.zonas_asignadas.join(', '),
            zona_resultado: textoZona(f),
            zona_nombre: f.zona_nombre || '',
            distancia: f.zona_distancia_m,
            latitud: f.latitud,
            longitud: f.longitud,
            mapa: '',
            offline: f.is_offline ? 'Sí' : 'No',
            dispositivo: f.dispositivo_info || '',
            ip: f.ip_address || '',
            sincronizado: formatearFechaHora(f.fecha_sincronizacion)
        };

        const fila = hoja.addRow(COLUMNAS_MARCAJES.map(c => valores[c.key] ?? ''));

        COLUMNAS_MARCAJES.forEach((c, i) => {
            const celda = fila.getCell(i + 1);
            if (c.centrada) celda.alignment = { horizontal: 'center', vertical: 'top' };
            else if (c.ajustar) celda.alignment = { wrapText: true, vertical: 'top' };
            else celda.alignment = { vertical: 'top' };
            if (c.coordenada && typeof celda.value === 'number') celda.numFmt = '0.000000';
        });

        const indiceCelda = key => COLUMNAS_MARCAJES.findIndex(c => c.key === key) + 1;

        if (!f.es_valido) {
            fila.getCell(indiceCelda('valido')).font = { color: { argb: 'FFB91C1C' }, bold: true };
        }
        if (f.zona_estado === 'FUERA') {
            fila.getCell(indiceCelda('zona_resultado')).font = { color: { argb: 'FFB91C1C' }, bold: true };
        } else if (f.zona_estado === 'DENTRO') {
            fila.getCell(indiceCelda('zona_resultado')).font = { color: { argb: 'FF15803D' } };
        }

        const enlace = urlMapa(f);
        if (enlace) {
            const celdaMapa = fila.getCell(indiceCelda('mapa'));
            celdaMapa.value = { text: 'Ver mapa', hyperlink: enlace };
            celdaMapa.font = { color: { argb: ARGB_ENCABEZADO }, underline: true };
        }
    });

    hoja.views = [{ state: 'frozen', ySplit: filaEncabezado.number }];

    if (filas.length > 0) {
        hoja.autoFilter = {
            from: { row: filaEncabezado.number, column: 1 },
            to: { row: filaEncabezado.number + filas.length, column: COLUMNAS_MARCAJES.length }
        };
    }
}

function construirHojaResumen(libro, datos) {
    const hoja = libro.addWorksheet('Resumen por usuario');
    const encabezados = [
        { header: 'Usuario', width: 30 },
        { header: 'Código usuario', width: 16 },
        { header: 'Entradas', width: 11 },
        { header: 'Salidas', width: 11 },
        { header: 'Inválidos', width: 11 },
        { header: 'Fuera de zona', width: 14 },
        { header: 'Sin conexión', width: 13 },
        { header: 'Primer marcaje', width: 18 },
        { header: 'Último marcaje', width: 18 }
    ];

    agregarTitulo(hoja, 'Resumen de Marcajes por Usuario', datos);

    const filaEncabezado = hoja.addRow(encabezados.map(e => e.header));
    estilarEncabezado(filaEncabezado);
    encabezados.forEach((e, i) => { hoja.getColumn(i + 1).width = e.width; });

    construirResumenPorUsuario(datos.filas).forEach((r) => {
        const fila = hoja.addRow([
            r.usuario, r.codigo_user, r.entradas, r.salidas, r.invalidos, r.fuera_zona, r.offline,
            formatearFechaHora(r.primero), formatearFechaHora(r.ultimo)
        ]);
        for (let i = 3; i <= 7; i += 1) fila.getCell(i).alignment = { horizontal: 'center' };
    });

    hoja.views = [{ state: 'frozen', ySplit: filaEncabezado.number }];
}

function construirExcelMarcajes(datos) {
    const libro = new ExcelJS.Workbook();
    libro.creator = 'Core';
    libro.created = new Date();

    construirHojaMarcajes(libro, datos);
    construirHojaResumen(libro, datos);

    return libro;
}

async function enviarExcelMarcajes(res, datos, nombreArchivo) {
    const libro = construirExcelMarcajes(datos);

    res.setHeader('Content-Type', MIME_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    await libro.xlsx.write(res);
    res.end();
}

module.exports = { enviarExcelMarcajes };
