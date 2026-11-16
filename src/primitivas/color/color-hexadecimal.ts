/**
 * Un color es `#rrggbb` con letras minúsculas: nada de `#fff`, `rgb()`, `url()` ni nombres. LA regla de forma, una sola vez: el tema de la marca
 * (`COLOR_DEL_TEMA`) y la identidad de la carta (0077) la importan; la base la copia en `color_de_carta_valido` y una prueba falla si difieren.
 * No mide contraste (eso es de quien lo muestra).
 */
export const COLOR_HEXADECIMAL = /^#[0-9a-f]{6}$/;
