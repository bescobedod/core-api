const ExcelJS = require('exceljs');
const { cargaDeBloques } = require('./canastasPollo');

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

// "2026-10-12" -> fecha de Excel (formato dd/mm/aaaa vía numFmt). Se arma en
// UTC porque ExcelJS escribe las fechas en UTC; así no se corre un día.
function fechaExcel(fechaIso) {
    const [anio, mes, dia] = String(fechaIso || '').split('-').map(Number);
    return anio && mes && dia ? new Date(Date.UTC(anio, mes - 1, dia)) : fechaIso;
}

// "2026-10-12" -> "12/10/2026", para los títulos de las hojas.
function fechaTexto(fechaIso) {
    const [anio, mes, dia] = String(fechaIso || '').split('-');
    return anio && mes && dia ? `${dia}/${mes}/${anio}` : fechaIso;
}

// columnas: [{ header, key, width, centrada, numFmt }]; filas: objetos con esas keys.
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
            if (c.numFmt) nueva.getCell(i + 1).numFmt = c.numFmt;
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

// Columnas de diferencia (mismos nombres que en el PDF):
// - No enviado = Pedido − Enviado (lo que la sede no puso en el camión).
// - No recibido vs pedido = Pedido − Recibido (lo que a la tienda le faltó contra su pedido).
// - No recibido vs enviado = Enviado − Recibido (lo que salió y la tienda no recibió).
// Las dos últimas solo con entregas, igual que "Recibido".
function columnasDiferencias(conEntregas) {
    return [
        { header: 'No enviado', key: 'diferencia', width: 14, centrada: true },
        ...(conEntregas ? [
            { header: 'No recibido vs pedido', key: 'no_recibido_vs_pedido', width: 22, centrada: true },
            { header: 'No recibido vs enviado', key: 'no_recibido_vs_enviado', width: 22, centrada: true }
        ] : [])
    ];
}

// Si la tienda todavía no confirmó la línea (recibido null), las diferencias
// contra lo recibido quedan vacías.
function valoresDiferencias(pedido, enviado, recibido) {
    const hayRecibido = recibido !== null && recibido !== undefined;

    return {
        diferencia: pedido - enviado,
        no_recibido_vs_pedido: hayRecibido ? pedido - recibido : null,
        no_recibido_vs_enviado: hayRecibido ? enviado - recibido : null
    };
}

function columnasResumenGeneral(conEntregas) {
    return [
        { header: 'Código', key: 'codigo', width: 14 },
        { header: 'Código antiguo', key: 'codigo_antiguo', width: 16 },
        { header: 'Artículo', key: 'nombre', width: 48 },
        { header: 'Pedido', key: 'pedido', width: 12, centrada: true },
        { header: 'Enviado', key: 'enviado', width: 12, centrada: true },
        ...(conEntregas ? [{ header: 'Recibido', key: 'recibido', width: 12, centrada: true }] : []),
        ...columnasDiferencias(conEntregas)
    ];
}

// codigosAntiguos: Map(codigo_producto -> SWW de SAP).
function filasResumenGeneral(resumenGeneral, codigosAntiguos = new Map()) {
    return resumenGeneral.map(t => ({
        codigo: t.codigo_producto,
        codigo_antiguo: codigosAntiguos.get(t.codigo_producto),
        nombre: t.nombre_producto,
        pedido: t.cantidad_solicitada,
        enviado: t.cantidad_asignada,
        recibido: t.cantidad_recibida,
        ...valoresDiferencias(t.cantidad_solicitada, t.cantidad_asignada, t.cantidad_recibida)
    }));
}

// conFecha agrega la columna "Fecha de entrega" (reporte por rango).
function columnasDetalle(conEntregas, conFecha) {
    return [
        ...(conFecha ? [{ header: 'Fecha de entrega', key: 'fecha', width: 16, centrada: true, numFmt: 'dd/mm/yyyy' }] : []),
        { header: 'Ruta', key: 'ruta', width: 22 },
        { header: 'Código empresa', key: 'codigo_empresa', width: 16, centrada: true },
        { header: 'Tienda', key: 'tienda', width: 32 },
        { header: 'Tipo', key: 'tipo', width: 14 },
        { header: 'N° Pedido', key: 'numero_pedido', width: 18 },
        ...(conEntregas ? [{ header: 'Estado', key: 'estado', width: 18 }] : []),
        { header: 'Código', key: 'codigo', width: 14 },
        { header: 'Código antiguo', key: 'codigo_antiguo', width: 16 },
        { header: 'Artículo', key: 'nombre', width: 44 },
        { header: 'Pedido', key: 'pedido', width: 12, centrada: true },
        { header: 'Enviado', key: 'enviado', width: 12, centrada: true },
        ...(conEntregas ? [{ header: 'Recibido', key: 'recibido', width: 12, centrada: true }] : []),
        ...columnasDiferencias(conEntregas),
        ...(conEntregas ? [
            { header: 'Delivery DocEntry', key: 'delivery_docentry', width: 18, centrada: true },
            { header: 'Delivery DocNum', key: 'delivery_docnum', width: 18, centrada: true },
            { header: 'Entrada DocEntry', key: 'entry_docentry', width: 18, centrada: true },
            { header: 'Entrada DocNum', key: 'entry_docnum', width: 18, centrada: true }
        ] : [])
    ];
}

// Una fila por artículo de cada pedido. `fecha` (opcional) se repite en cada fila.
// extras.codigosEmpresa: Map(id_pedido -> "empresa-tienda" de tTienda);
// extras.codigosAntiguos: Map(codigo_producto -> SWW de SAP).
function filasDetalle(rutasConBloques, etiquetaEstado, fecha, extras = {}) {
    const { codigosEmpresa = new Map(), codigosAntiguos = new Map() } = extras;
    const filas = [];

    rutasConBloques.forEach((ruta) => {
        ruta.bloques.forEach((bloque) => {
            bloque.items.forEach((item) => {
                filas.push({
                    fecha: fecha ? fechaExcel(fecha) : fecha,
                    ruta: ruta.nombre_ruta,
                    codigo_empresa: codigosEmpresa.get(bloque.id_pedido),
                    tienda: bloque.nombre_tienda,
                    tipo: bloque.label || 'Pedido',
                    numero_pedido: bloque.numero_pedido,
                    estado: etiquetaEstado(bloque.estado).texto,
                    codigo: item.codigo_producto,
                    codigo_antiguo: codigosAntiguos.get(item.codigo_producto),
                    nombre: item.nombre_producto,
                    pedido: item.cantidad_solicitada,
                    enviado: item.cantidad_asignada,
                    recibido: item.cantidad_recibida,
                    ...valoresDiferencias(item.cantidad_solicitada, item.cantidad_asignada, item.cantidad_recibida),
                    delivery_docentry: bloque.sap_delivery_docentry,
                    delivery_docnum: bloque.sap_delivery_docnum,
                    entry_docentry: bloque.sap_entry_docentry,
                    entry_docnum: bloque.sap_entry_docnum
                });
            });
        });
    });

    return filas;
}

// rutasConBloques: [{ nombre_ruta, bloques: [...] }] (mismo formato que el PDF).
// resumenGeneral / conEntregas / resumenEstados / etiquetaEstado los calcula
// el controlador con los mismos helpers del PDF, para que no puedan diferir.
function construirExcelDetalle({
    fecha, descripcionFiltros, rutasConBloques, resumenGeneral, conEntregas, resumenEstados, faltantes, etiquetaEstado,
    conCarga = false, codigosEmpresa, codigosAntiguos
}) {
    const libro = nuevoLibro();

    // ---- Resumen General ----
    const hojaResumen = libro.addWorksheet('Resumen General');
    agregarTitulo(hojaResumen, 'Detalle de Pedidos por Tienda — Resumen General', [
        `Fecha Entrega: ${fechaTexto(fecha)}`,
        descripcionFiltros,
        conEntregas ? `Estado de los pedidos: ${resumenEstados}` : null
    ]);

    agregarTabla(hojaResumen, columnasResumenGeneral(conEntregas), filasResumenGeneral(resumenGeneral, codigosAntiguos));

    // ---- Detalle (una fila por artículo de cada pedido) ----
    const hojaDetalle = libro.addWorksheet('Detalle');
    agregarTitulo(hojaDetalle, 'Detalle de Pedidos por Tienda', [`Fecha Entrega: ${fechaTexto(fecha)}`, descripcionFiltros]);

    agregarTabla(
        hojaDetalle,
        columnasDetalle(conEntregas, false),
        filasDetalle(rutasConBloques, etiquetaEstado, null, { codigosEmpresa, codigosAntiguos })
    );

    // ---- Carga por ruta (solo Pollo) ----
    const filasCarga = (conCarga ? rutasConBloques : [])
        .map(ruta => ({ ruta: ruta.nombre_ruta, ...cargaDeBloques(ruta.bloques) }))
        .filter(f => f.canastas > 0)
        .map(f => ({ ...f, toneladas: Number(f.toneladas.toFixed(2)) }));

    if (filasCarga.length > 0) {
        const hojaCarga = libro.addWorksheet('Carga por ruta');
        agregarTitulo(hojaCarga, 'Carga por ruta (canastas y toneladas)', [`Fecha Entrega: ${fechaTexto(fecha)}`, descripcionFiltros]);
        agregarTabla(hojaCarga, [
            { header: 'Ruta', key: 'ruta', width: 30 },
            { header: 'Canastas', key: 'canastas', width: 12, centrada: true },
            { header: 'Libras', key: 'libras', width: 12, centrada: true },
            { header: 'Toneladas', key: 'toneladas', width: 12, centrada: true }
        ], filasCarga);
    }

    // Con filtro de producto la hoja de tiendas sin pedido no aplica.
    if (faltantes === null) return libro;

    // ---- Tiendas sin pedido ----
    const hojaFaltantes = libro.addWorksheet('Tiendas sin pedido');
    agregarTitulo(hojaFaltantes, 'Tiendas que no hicieron pedido para esta fecha', [`Fecha Entrega: ${fechaTexto(fecha)}`, descripcionFiltros]);

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

// Excel del reporte por RANGO de fechas (búsqueda avanzada): documento
// distinto al de una sola fecha. fechas: [{ fecha, rutasConBloques }]
// ordenadas por fecha. Solo el de verduras lleva hoja de tiendas sin pedido,
// por semana y por jueves/viernes (faltantesPorSemana:
// [{ semana, lunes, domingo, dias: [{ fecha, nombre_dia, faltantes }] }]).
function construirExcelDetalleRango({
    fechaDesde, fechaHasta, descripcionFiltros, fechas, resumenGeneral, conEntregas, resumenEstados, etiquetaEstado,
    conCarga = false, codigosEmpresa, codigosAntiguos, faltantesPorSemana = null
}) {
    const libro = nuevoLibro();
    const lineaRango = `Fechas de entrega: ${fechaTexto(fechaDesde)} al ${fechaTexto(fechaHasta)}`;

    // ---- Resumen General (todo el rango) ----
    const hojaResumen = libro.addWorksheet('Resumen General');
    agregarTitulo(hojaResumen, 'Detalle de Pedidos por Rango de Fechas — Resumen General', [
        lineaRango,
        descripcionFiltros,
        conEntregas ? `Estado de los pedidos: ${resumenEstados}` : null
    ]);
    agregarTabla(hojaResumen, columnasResumenGeneral(conEntregas), filasResumenGeneral(resumenGeneral, codigosAntiguos));

    // ---- Detalle (una fila por artículo de cada pedido, con su fecha) ----
    const hojaDetalle = libro.addWorksheet('Detalle');
    agregarTitulo(hojaDetalle, 'Detalle de Pedidos por Rango de Fechas', [lineaRango, descripcionFiltros]);
    agregarTabla(
        hojaDetalle,
        columnasDetalle(conEntregas, true),
        fechas.flatMap(f => filasDetalle(f.rutasConBloques, etiquetaEstado, f.fecha, { codigosEmpresa, codigosAntiguos }))
    );

    // ---- Carga por ruta y fecha (solo Pollo) ----
    const filasCarga = conCarga
        ? fechas.flatMap(f => f.rutasConBloques.map(ruta => ({
            fecha: fechaExcel(f.fecha),
            ruta: ruta.nombre_ruta,
            ...cargaDeBloques(ruta.bloques)
        })))
            .filter(f => f.canastas > 0)
            .map(f => ({ ...f, toneladas: Number(f.toneladas.toFixed(2)) }))
        : [];

    if (filasCarga.length > 0) {
        const hojaCarga = libro.addWorksheet('Carga por ruta');
        agregarTitulo(hojaCarga, 'Carga por ruta y fecha (canastas y toneladas)', [lineaRango, descripcionFiltros]);
        agregarTabla(hojaCarga, [
            { header: 'Fecha de entrega', key: 'fecha', width: 16, centrada: true, numFmt: 'dd/mm/yyyy' },
            { header: 'Ruta', key: 'ruta', width: 30 },
            { header: 'Canastas', key: 'canastas', width: 12, centrada: true },
            { header: 'Libras', key: 'libras', width: 12, centrada: true },
            { header: 'Toneladas', key: 'toneladas', width: 12, centrada: true }
        ], filasCarga);
    }

    if (!faltantesPorSemana) return libro;

    // ---- Tiendas sin pedido por semana (verduras: jueves y viernes) ----
    const hojaFaltantes = libro.addWorksheet('Tiendas sin pedido');
    agregarTitulo(hojaFaltantes, 'Tiendas sin pedido por semana (jueves y viernes)', [lineaRango, descripcionFiltros]);

    const filasFaltantes = [];
    faltantesPorSemana.forEach((semana) => {
        const etiquetaSemana = `Semana ${semana.semana} (${fechaTexto(semana.lunes)} al ${fechaTexto(semana.domingo)})`;

        semana.dias.forEach((dia) => {
            dia.faltantes.forEach((porDivision) => {
                porDivision.rutas.forEach((ruta) => {
                    ruta.tiendas.forEach((tienda) => {
                        filasFaltantes.push({
                            semana: etiquetaSemana,
                            fecha: fechaExcel(dia.fecha),
                            dia: dia.nombre_dia,
                            division: `División ${porDivision.division}`,
                            ruta: ruta.nombre_ruta,
                            tienda
                        });
                    });
                });
            });
        });
    });

    if (filasFaltantes.length === 0) {
        hojaFaltantes.addRow(['Todas las tiendas asignadas hicieron pedido en todos los jueves y viernes del rango.']);
    } else {
        agregarTabla(hojaFaltantes, [
            { header: 'Semana', key: 'semana', width: 34 },
            { header: 'Fecha de entrega', key: 'fecha', width: 16, centrada: true, numFmt: 'dd/mm/yyyy' },
            { header: 'Día', key: 'dia', width: 10 },
            { header: 'División', key: 'division', width: 14 },
            { header: 'Ruta', key: 'ruta', width: 26 },
            { header: 'Tienda', key: 'tienda', width: 40 }
        ], filasFaltantes);
    }

    return libro;
}

// secciones: [{ division, bloques }] (mismo formato que el PDF de pedidos en
// tránsito); una hoja por división.
function construirExcelEnTransito({ secciones, viajes = [], tituloTipo, conMuelle }) {
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
            ...columnasDiferencias(false)
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

    // ---- Carga por ruta y fecha (un camión = una ruta en una fecha) ----
    if (viajes.length > 0) {
        const hojaCarga = libro.addWorksheet('Carga por ruta');
        agregarTitulo(hojaCarga, `Carga por ruta (canastas y toneladas) — ${tituloTipo}`, [
            'Pedidos en tránsito, agrupados por ruta y fecha requerida'
        ]);
        agregarTabla(hojaCarga, [
            { header: 'Fecha requerida', key: 'fecha', width: 16, centrada: true },
            { header: 'Ruta', key: 'ruta', width: 24 },
            ...(conMuelle ? [{ header: 'Muelle', key: 'muelle', width: 22 }] : []),
            { header: 'Piloto', key: 'piloto', width: 30 },
            { header: 'Camión', key: 'camion', width: 12 },
            { header: 'Canastas', key: 'canastas', width: 12, centrada: true },
            { header: 'Libras', key: 'libras', width: 12, centrada: true },
            { header: 'Toneladas', key: 'toneladas', width: 12, centrada: true }
        ], viajes.map(v => ({
            fecha: v.fecha_requerida,
            ruta: v.nombre_ruta,
            muelle: v.muelle,
            piloto: v.piloto_nombre || 'Sin asignar',
            camion: v.camion_placa || 'Sin asignar',
            canastas: v.canastas,
            libras: v.libras,
            toneladas: Number(v.toneladas.toFixed(2))
        })));
    }

    return libro;
}

module.exports = { MIME_XLSX, construirExcelDetalle, construirExcelDetalleRango, construirExcelEnTransito };
