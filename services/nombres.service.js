// Nombre y primer apellido a partir de un nombre completo en un solo texto: con 4 o más
// palabras, la 1.ª y la 3.ª (nombre, segundo nombre, apellido, segundo apellido); con 3, la
// 1.ª y la 2.ª; con menos, tal cual. Un nombre que ya viene corto no cambia.
function acortarNombre(completo) {
    const palabras = String(completo || '').trim().split(/\s+/).filter(Boolean);

    if (palabras.length >= 4) return `${palabras[0]} ${palabras[2]}`;
    if (palabras.length === 3) return `${palabras[0]} ${palabras[1]}`;

    return palabras.join(' ');
}

module.exports = { acortarNombre };
