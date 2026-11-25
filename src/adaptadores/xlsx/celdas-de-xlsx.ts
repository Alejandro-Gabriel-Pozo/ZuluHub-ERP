import type { Celda } from "../../primitivas/planilla/celda";

/**
 * De una celda de la planilla a lo que escribe la biblioteca. Puro. Las tres reglas de seguridad y exactitud del archivo (dueño, 25/11/2026):
 *
 *  1. El dinero y las cantidades salen como NÚMERO solo si el texto exacto de la base vuelve idéntico al leerlo como número y no pasa de 15 dígitos significativos; si no, como TEXTO
 *     exacto. Nunca se escribe un importe distinto del que guarda la base. Previene: un importe de 17 dígitos redondeado en silencio por el número binario de Excel.
 *  2. Un texto que empieza con `=`, `+`, `-`, `@`, tabulador o retorno de carro lleva una comilla simple antepuesta: queda como texto inofensivo si el archivo se pega en otra
 *     planilla o se guarda como CSV. Previene la inyección de fórmulas (un proveedor llamado `=HYPERLINK(...)`). Los números no pasan por esta regla (un importe negativo es un número).
 *  3. Una fecha es una fecha civil sin hora ni zona: se escribe a medianoche UTC del día y su formato es `aaaa-mm-dd`, así el número de serie es el del día y no corre por la zona del servidor.
 *
 * Chequeo: `celdas-de-xlsx.test.ts` y `escritor-de-xlsx.test.ts`.
 */

export type CeldaDeLaBiblioteca =
  | null
  | Readonly<{ value: string; type: StringConstructor }>
  | Readonly<{ value: number; type: NumberConstructor; format: string }>
  | Readonly<{ value: Date; type: DateConstructor; format: string }>;

export const FORMATO_DE_FECHA = "yyyy-mm-dd";
const FORMATO_POR_DECIMALES = { 2: "0.00", 4: "0.0000", 6: "0.000000" } as const;
const DIGITOS_EXACTOS_DE_UN_NUMERO = 15;
const EMPIEZA_COMO_FORMULA = /^[=+\-@\t\r]/;
const FORMA_DE_UN_DECIMAL = /^-?\d+(?:\.\d+)?$/;
const FORMA_DE_UNA_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** El texto que se escribe en una celda de texto: con la comilla simple antepuesta si podría leerse como fórmula. */
export const textoInofensivo = (texto: string): string =>
  EMPIEZA_COMO_FORMULA.test(texto) ? `'${texto}` : texto;

/** El decimal sin ceros de más (`266252.40` → `266252.4`, `0.00` → `0`), que es como lo escribe `String(Number(...))`. */
function canonico(texto: string): string {
  const sinCeros = texto.includes(".") ? texto.replace(/0+$/, "").replace(/\.$/, "") : texto;
  const negativo = sinCeros.startsWith("-");
  const cuerpo = negativo ? sinCeros.slice(1) : sinCeros;
  const entero = cuerpo.replace(/^0+(?=\d)/, "");
  return `${negativo && entero !== "0" ? "-" : ""}${entero}`;
}

/** ¿Se puede escribir este decimal como número sin cambiarlo? (idéntico al leerlo como número y a lo sumo 15 dígitos significativos). */
export function seEscribeComoNumero(texto: string): boolean {
  if (!FORMA_DE_UN_DECIMAL.test(texto)) return false;
  const c = canonico(texto);
  const significativos = c.replace(/[-.]/g, "").replace(/^0+/, "").length;
  return significativos <= DIGITOS_EXACTOS_DE_UN_NUMERO && String(Number(texto)) === c;
}

/** El día civil como instante a medianoche UTC; `null` si el texto no es una fecha real. */
function fechaAMedianocheUtc(texto: string): Date | null {
  const m = FORMA_DE_UNA_FECHA.exec(texto);
  if (m === null) return null;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
    ? fecha
    : null;
}

export function celdaDeLaBiblioteca(celda: Celda): CeldaDeLaBiblioteca {
  if (celda === null) return null;
  switch (celda.tipo) {
    case "texto":
      return { value: textoInofensivo(celda.valor), type: String };
    case "entero":
      if (!Number.isSafeInteger(celda.valor)) throw new RangeError("celda: entero fuera de rango");
      return { value: celda.valor, type: Number, format: "0" };
    case "decimal":
      return seEscribeComoNumero(celda.valor)
        ? { value: Number(celda.valor), type: Number, format: FORMATO_POR_DECIMALES[celda.decimales] }
        : { value: celda.valor, type: String };
    case "fecha": {
      const fecha = fechaAMedianocheUtc(celda.valor);
      if (fecha === null) throw new RangeError("celda: fecha civil inválida");
      return { value: fecha, type: Date, format: FORMATO_DE_FECHA };
    }
  }
}
