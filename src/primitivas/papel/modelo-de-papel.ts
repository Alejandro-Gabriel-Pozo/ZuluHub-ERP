/**
 * EL MODELO DE PAPEL Y SU MAQUETADO (E7 §3.5; K6 del mostrador): lo que comparten la comanda de cocina (módulo `comandas`) y el ticket del cliente (módulo
 * `ventas`): el ancho del rollo (58 u 80 mm), las líneas de texto con su estilo y cómo se parte un texto por palabras dentro del ancho. Vive acá, y no en uno
 * de los dos módulos, porque comandas ya importa ventas y ventas no puede importar comandas (ciclo): una regla, un lugar (ADR-014: dos módulos reales la
 * necesitan). `comandas` la reexporta con los MISMOS nombres. Puro: sin reloj, sin azar, sin I/O, sin textos del negocio (los rótulos son de cada documento).
 * Previene: texto cortado por el papel y dos maquetados distintos del mismo rollo. Chequeo: las pruebas de `comandas/dominio` (papel byte a byte, `paridad-del-papel.test.ts`)
 * y `modelo-de-papel.test.ts`.
 */
export const PAPELES_EN_MM = [58, 80] as const;
export type PapelEnMm = (typeof PAPELES_EN_MM)[number];

export type EstiloDeLinea = "NORMAL" | "GRANDE" | "NEGRITA" | "SEPARADOR";
export type LineaDePapel = Readonly<{ texto: string; estilo: EstiloDeLinea }>;
export type ModeloDePapel = Readonly<{ ancho: PapelEnMm; lineas: readonly LineaDePapel[] }>;

/** Columnas de texto normal por ancho de papel (fuente de impresora térmica estándar). */
export function columnasDelPapel(ancho: PapelEnMm): number {
  return ancho === 58 ? 32 : 48;
}

export const SEPARADOR: LineaDePapel = { texto: "", estilo: "SEPARADOR" };

/** Parte un texto en renglones de a lo sumo `columnas` caracteres, por palabras (una palabra más larga se corta). Previene: texto cortado por el papel. */
export function envolver(texto: string, columnas: number, estilo: EstiloDeLinea): LineaDePapel[] {
  const ancho = estilo === "GRANDE" ? Math.max(1, Math.floor(columnas / 2)) : columnas;
  const lineas: string[] = [];
  for (const palabra of texto.split(" ")) {
    // Los espacios de más dejan palabras vacías, que no dan ningún trozo. Una palabra más larga que el ancho se corta en trozos de a `ancho`; cada trozo se pega al renglón anterior solo si entra con su espacio.
    for (let desde = 0; desde < palabra.length; desde += ancho) {
      const trozo = palabra.slice(desde, desde + ancho);
      const previo = lineas.at(-1);
      if (previo !== undefined && previo.length + 1 + trozo.length <= ancho) {
        lineas[lineas.length - 1] = `${previo} ${trozo}`;
      } else {
        lineas.push(trozo);
      }
    }
  }
  return lineas.map((t) => ({ texto: t, estilo }));
}
