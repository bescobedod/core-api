// Carga de un camión de Pollo (canastas y peso), según lo asignado
// (cantidad_asignada, en la unidad de venta: bolsas/unidades) de los
// artículos IPTV.
//
// Canastas: un grupo de códigos comparte canastas — se suma lo asignado de
// todos sus códigos y se divide entre `porCanasta`. Una canasta parcial
// cuenta como canasta completa.
const REGLAS_CANASTA = [
    { codigos: ['IPTV0008', 'IPTV0009'], porCanasta: 12 },
    // Bolsas de 5 lb: 10 bolsas = 50 lb = 1 canasta.
    { codigos: ['IPTV0003', 'IPTV0004', 'IPTV0005', 'IPTV0006'], porCanasta: 10 },
    // 6 bolsas de 5 lb = 30 lb.
    { codigos: ['IPTV0002'], porCanasta: 6 },
    // 8 bolsas de 5 lb = 40 lb.
    { codigos: ['IPTV0013'], porCanasta: 8 },
    { codigos: ['IPTV0014'], porCanasta: 16 }
];

// Peso en libras de una unidad de venta de cada artículo. Los artículos que
// no están aquí no cuentan para el peso (ni para las canastas).
const LIBRAS_POR_UNIDAD = {
    IPTV0002: 5,
    IPTV0003: 5,
    IPTV0004: 5,
    IPTV0005: 5,
    IPTV0006: 5,
    IPTV0013: 5,
    IPTV0008: 3.3,
    IPTV0009: 3.3,
    IPTV0014: 0.83
};

const LIBRAS_POR_TONELADA = 2000;

// lineas: [{ codigo_producto, cantidad }]
// Devuelve { canastas, libras, toneladas }.
function calcularCarga(lineas) {
    const totalesPorRegla = REGLAS_CANASTA.map(() => 0);
    let libras = 0;

    for (const linea of lineas) {
        const cantidad = Number(linea.cantidad) || 0;
        const indice = REGLAS_CANASTA.findIndex(r => r.codigos.includes(linea.codigo_producto));

        if (indice >= 0) totalesPorRegla[indice] += cantidad;
        libras += cantidad * (LIBRAS_POR_UNIDAD[linea.codigo_producto] || 0);
    }

    const canastas = REGLAS_CANASTA.reduce(
        (suma, regla, i) => suma + Math.max(0, Math.ceil(totalesPorRegla[i] / regla.porCanasta - 1e-9)),
        0
    );
    const librasRedondeadas = Math.round(libras * 100) / 100;

    return { canastas, libras: librasRedondeadas, toneladas: librasRedondeadas / LIBRAS_POR_TONELADA };
}

// bloques: los de construirBloquesPedido (items con cantidad_asignada).
function cargaDeBloques(bloques) {
    return calcularCarga(
        bloques.flatMap(b => b.items.map(i => ({ codigo_producto: i.codigo_producto, cantidad: i.cantidad_asignada })))
    );
}

function formatearToneladas(carga) {
    return carga.toneladas.toFixed(2);
}

// Texto para los encabezados de los PDF: "Canastas: 37    Toneladas: 1.85".
function describirCarga(carga) {
    return `Canastas: ${carga.canastas}    Toneladas: ${formatearToneladas(carga)}`;
}

// Un "viaje" es una ruta en una fecha requerida (un camión). Devuelve solo los
// viajes con carga, ordenados por fecha y ruta.
function viajesConCarga(bloques) {
    const viajes = new Map();

    for (const bloque of bloques) {
        const clave = `${bloque.ruta_id}|${bloque.fecha_requerida}`;

        if (!viajes.has(clave)) {
            viajes.set(clave, {
                ruta_id: bloque.ruta_id,
                nombre_ruta: bloque.nombre_ruta,
                fecha_requerida: bloque.fecha_requerida,
                muelle: bloque.muelle,
                piloto_nombre: bloque.piloto_nombre,
                camion_placa: bloque.camion_placa,
                bloques: []
            });
        }

        viajes.get(clave).bloques.push(bloque);
    }

    return [...viajes.values()]
        .map(({ bloques: delViaje, ...viaje }) => ({ ...viaje, ...cargaDeBloques(delViaje) }))
        .filter(v => v.canastas > 0)
        .sort((a, b) =>
            String(a.fecha_requerida).localeCompare(String(b.fecha_requerida)) ||
            (a.nombre_ruta || '').localeCompare(b.nombre_ruta || ''));
}

module.exports = { calcularCarga, cargaDeBloques, describirCarga, formatearToneladas, viajesConCarga };
