// Paginación de los listados de pedidos: `page` y `page_size` del query string.
function parsearPaginacion(query, { porDefecto = 10, maximo = 50 } = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const pageSize = Math.min(maximo, Math.max(1, parseInt(query.page_size, 10) || porDefecto));

    return { page, pageSize };
}

// Con el total ya contado, ajusta la página pedida al rango válido (si se
// borró o cambió de estado el último registro de la última página, devuelve la
// última que sí existe en vez de una página vacía).
function armarPaginacion(total, page, pageSize) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const paginaReal = Math.min(page, totalPages);

    return { page: paginaReal, pageSize, total, totalPages, offset: (paginaReal - 1) * pageSize };
}

module.exports = { parsearPaginacion, armarPaginacion };
