/**
 * Lo que se busca con `LIKE 'texto%'` (por prefijo): escapa `%`, `_` y `\` del texto, que es del usuario, y agrega el `%` final. Se usa con `escape '\\'`.
 * Vive acá, una sola vez, y el stock la importa por `publico.ts`: antes estaba escrita en los dos módulos. Previene: que un `%` o un `_` escrito en el buscador
 * ensanche la búsqueda en un módulo y no en el otro. Chequeo: `como-prefijo.test.ts`.
 */
export const comoPrefijo = (texto: string): string => `${texto.replace(/[\\%_]/g, "\\$&")}%`;
