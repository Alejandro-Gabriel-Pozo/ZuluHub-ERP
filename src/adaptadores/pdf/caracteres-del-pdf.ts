/**
 * Los caracteres que el PDF puede dibujar. Se usa la tipografía base del PDF (Helvetica, que no se embebe ni pesa nada): cubre el
 * ASCII imprimible, el Latin-1 (tildes, ñ, ü, ¿, ¡) y los signos de Windows-1252 (€, comillas, rayas, «…»). Fuera de eso la tipografía
 * no tiene el glifo y pdfkit escribe basura sin avisar (un emoji sale como dos caracteres sueltos): por eso el texto se valida ANTES de
 * dibujarlo y un carácter fuera de la lista corta la generación (falla cerrado), nunca se reemplaza ni se omite en silencio.
 * Previene: un nombre de cliente con emoji o escritura de derecha a izquierda impreso corrupto en una factura. Chequeo:
 * `caracteres-del-pdf.test.ts` (cada carácter permitido se dibuja y se vuelve a leer igual; los de afuera se rechazan).
 *
 * El espacio de no separación (U+00A0), el guion blando (U+00AD) y el signo micro (U+00B5, que el lector devuelve como la mu griega
 * U+03BC) quedan afuera a propósito: el lector de PDF los normaliza y el texto leído ya no coincide con el impreso.
 * SIN DECIDIR (pregunta pendiente al dueño, 2026-11-05): si un carácter fuera de la lista debe impedirse al CARGAR el dato (una
 * primitiva común a todo texto que llega a un comprobante) en vez de descubrirse recién al descargar el PDF.
 */

const SIGNOS_DE_WINDOWS_1252 = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

function construirLaLista(): ReadonlySet<number> {
  const permitidos = new Set<number>();
  for (let c = 0x20; c <= 0x7e; c += 1) permitidos.add(c);
  for (let c = 0xa1; c <= 0xff; c += 1) if (c !== 0xad && c !== 0xb5) permitidos.add(c);
  for (const signo of SIGNOS_DE_WINDOWS_1252) permitidos.add(signo.codePointAt(0) ?? 0);
  return permitidos;
}

/** Los puntos de código permitidos (exportada para la prueba que los dibuja uno por uno). */
export const CARACTERES_DEL_PDF: ReadonlySet<number> = construirLaLista();

/** El primer carácter (como punto de código) que el PDF no puede dibujar; `null` si el texto entero se puede. */
export function primerCaracterNoSoportado(texto: string): number | null {
  for (const caracter of texto) {
    const punto = caracter.codePointAt(0) ?? 0;
    if (!CARACTERES_DEL_PDF.has(punto)) return punto;
  }
  return null;
}

/**
 * El texto trae un carácter que la tipografía del PDF no tiene. El mensaje lleva SOLO el punto de código (`U+1F600`), nunca el texto
 * del cliente: va al registro del servidor y no tiene que filtrar datos personales.
 */
export class CaracterNoSoportadoEnElPdf extends Error {
  readonly puntoDeCodigo: number;
  constructor(puntoDeCodigo: number) {
    super(`carácter fuera de la tipografía del PDF: U+${puntoDeCodigo.toString(16).toUpperCase()}`);
    this.name = "CaracterNoSoportadoEnElPdf";
    this.puntoDeCodigo = puntoDeCodigo;
  }
}

/** Corta si el texto trae un carácter que el PDF no puede dibujar. */
export function exigirTextoSoportado(texto: string): void {
  const punto = primerCaracterNoSoportado(texto);
  if (punto !== null) throw new CaracterNoSoportadoEnElPdf(punto);
}
