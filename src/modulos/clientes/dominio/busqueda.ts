/**
 * La búsqueda del directorio (E9 §3.1): documento idéntico primero, luego los nombres que empiezan con lo escrito y al final los que lo contienen.
 * `normalizarParaBusqueda` es la MISMA transformación que la columna generada `parte.nombre_busqueda` de la base (sin tildes ni diéresis ni ñ ni ç,
 * en minúsculas); una prueba de integración compara las dos con los mismos textos. Las tildes se pasan a su letra base con una tabla explícita (no con
 * la normalización Unicode) para que coincida con la `translate` de SQL, que no depende de la configuración regional.
 */
const CON_ACENTO = "ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç";
const SIN_ACENTO = "AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc";

const ACENTOS = new Map<string, string>(
  [...CON_ACENTO].map((letra, i) => [letra, SIN_ACENTO.charAt(i)]),
);

export const LETRAS_CON_ACENTO_DE_BUSQUEDA = CON_ACENTO;
export const LETRAS_SIN_ACENTO_DE_BUSQUEDA = SIN_ACENTO;

export function normalizarParaBusqueda(texto: string): string {
  return [...texto]
    .map((letra) => ACENTOS.get(letra) ?? letra)
    .join("")
    .toLowerCase();
}

/**
 * El nombre completo de una parte tal como lo arma la columna generada `nombre_busqueda` antes de normalizarlo: apellido, nombre y alias separados por un
 * espacio, sin blancos de más cuando falta alguno. Se usa para comparar partes (posibles duplicados) con la misma forma que la base.
 */
export function nombreCompletoDeParte(
  partes: Readonly<{ apellido: string | null; nombre: string | null; alias: string | null }>,
): string {
  return [partes.apellido, partes.nombre, partes.alias]
    .filter((p): p is string => p !== null)
    .join(" ");
}

export type ClaseDeCoincidencia = "DOCUMENTO" | "EMPIEZA" | "CONTIENE";

const ORDEN_DE_CLASE: Readonly<Record<ClaseDeCoincidencia, number>> = {
  DOCUMENTO: 0,
  EMPIEZA: 1,
  CONTIENE: 2,
};

export type CandidatoDeBusqueda = Readonly<{
  id: string;
  /** El valor de `nombre_busqueda` de la parte. */
  nombreDeBusqueda: string;
  /** El valor de `documento_normalizado`, o `null` si no tiene documento. */
  documentoNormalizado: string | null;
}>;

/**
 * Cómo coincide una parte con lo escrito, o `null` si no coincide. `textoNormalizado` ya pasó por `normalizarParaBusqueda`; `documentoBuscado`
 * es el documento en la misma forma que `documentoNormalizado` (o `null` si lo escrito no parece un documento). Un texto vacío no coincide con nada.
 */
export function claseDeCoincidencia(
  candidato: CandidatoDeBusqueda,
  textoNormalizado: string,
  documentoBuscado: string | null,
): ClaseDeCoincidencia | null {
  if (documentoBuscado !== null && candidato.documentoNormalizado === documentoBuscado) {
    return "DOCUMENTO";
  }
  if (textoNormalizado === "") return null;
  if (candidato.nombreDeBusqueda.startsWith(textoNormalizado)) return "EMPIEZA";
  if (candidato.nombreDeBusqueda.includes(textoNormalizado)) return "CONTIENE";
  return null;
}

/** Ordena las coincidencias: por clase y, dentro de una clase, por nombre y por id (el desempate fija el orden aunque el nombre se repita). */
export function ordenarCoincidencias<T extends CandidatoDeBusqueda>(
  coincidencias: readonly Readonly<{ clase: ClaseDeCoincidencia; candidato: T }>[],
): readonly T[] {
  return [...coincidencias]
    .sort(
      (a, b) =>
        ORDEN_DE_CLASE[a.clase] - ORDEN_DE_CLASE[b.clase] ||
        compararTexto(a.candidato.nombreDeBusqueda, b.candidato.nombreDeBusqueda) ||
        compararTexto(a.candidato.id, b.candidato.id),
    )
    .map((c) => c.candidato);
}

function compararTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
