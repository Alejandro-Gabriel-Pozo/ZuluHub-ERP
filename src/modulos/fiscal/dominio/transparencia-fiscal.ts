import { importeATexto, importeCero, type Importe } from "../../../primitivas/dinero/importe";
import type { Moneda } from "../../../primitivas/dinero/moneda";
import type { Receptor } from "./receptor";

/**
 * Bloque de transparencia fiscal del modelo de impresión (versión 2 en adelante): el «espacio inferior izquierdo»
 * de la B a consumidor final. Vive aparte de `modelo-de-impresion.ts` para que ese archivo no pase el tope de líneas
 * y para que lo propio del bloque (textos, cuándo corresponde, el valor de «Otros Impuestos…») tenga un solo lugar.
 *
 * Textos legales (versión 2), copiados de la norma sin parafrasear; si ARCA los cambia, es una versión nueva.
 * FUENTE (repositorio de docs, `12-referencias-externas/arca-normas-de-comprobantes/`, rama
 * `web/especificaciones-del-qr`, PR #3; SHA-256 en su README): `norma_5614_2024.html`, RG 5614/2024 art. 2 punto 7
 * (sustituye el inciso g) del Apartado B del Anexo II de la RG 1415; subpunto 1, «espacio inferior izquierdo»),
 * art. 5 (la representación gráfica de la RG 4291 debe incluirlos) y art. 6 b) (obligatorio desde el 01/04/2025).
 * Texto vigente: `rg1415_dcp.html`, «Anexo II - Texto vigente según Resolución General Nº 5866/2026 ARCA»,
 * Apartado B, inciso g) 1.
 */
const TITULO_DE_TRANSPARENCIA_FISCAL = "Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)";
const ROTULO_DE_IVA_CONTENIDO = "IVA Contenido";
const ROTULO_DE_OTROS_IMPUESTOS_INDIRECTOS = "Otros Impuestos Nacionales Indirectos";

/**
 * Bloque «espacio inferior izquierdo» de la B a consumidor final (versión 2 en adelante). Los textos son los de la
 * norma (ver la fuente arriba); los valores salen de los mismos importes que `totales`.
 */
export type TransparenciaFiscalImpresa = Readonly<{
  titulo: string;
  ivaContenido: Readonly<{
    rotulo: string;
    /** Por alícuota, como `totales.ivaContenido` (decisión 9 del dueño; el contador debe ratificarla, C23). */
    porAlicuota: readonly { alicuota: string; iva: string }[];
  }>;
  otrosImpuestosNacionalesIndirectos: Readonly<{ rotulo: string; valor: string }>;
}>;

/** Lo que el bloque necesita de los totales: la letra y, en la B, el IVA contenido (`TotalesImpresos` lo cumple). */
type TotalesParaTransparencia =
  | Readonly<{
      letra: "B";
      ivaContenido: readonly { alicuota: string; iva: string }[];
    }>
  | Readonly<{ letra: "A" | "C" }>;

/**
 * «Otros Impuestos Nacionales Indirectos» que inciden en el precio (RG 5614 art. 2 punto 4: Anexo II A.III.f; art. 6
 * a): los impuestos internos). SUPUESTO: el producto no tiene hoy ese dato (no hay impuestos internos ni otros
 * tributos en el comprobante: `ImpTrib` es cero), así que el valor es siempre cero. Lo confirma el contador (C23).
 * ÚNICO lugar para cambiarlo cuando el producto tenga el dato.
 */
function otrosImpuestosNacionalesIndirectos(moneda: Moneda): Importe {
  return importeCero(moneda);
}

/**
 * El bloque de transparencia fiscal, o `null` si no corresponde: letra B (sus `totales` traen el IVA contenido) y
 * receptor consumidor final, según la autorización del dueño del 2026-11-04. PREGUNTAS PENDIENTES (contador, C23),
 * por eso NO se agrega fuera de este caso: ¿lleva el bloque la C a consumidor final (monotributo o exento; la RG 5614
 * art. 2 punto 7 no limita la letra y el art. 99 de la Ley 27.743 no está en el repo)? ¿La A? ¿La B a exento o no
 * alcanzado (Anexo II A.IV.a punto 2 manda discriminar el IVA también a ellos)?
 */
export function transparenciaFiscal(
  totales: TotalesParaTransparencia,
  receptor: Receptor,
  moneda: Moneda,
): TransparenciaFiscalImpresa | null {
  if (totales.letra !== "B" || receptor.condicionIva !== "CONSUMIDOR_FINAL") return null;
  return {
    titulo: TITULO_DE_TRANSPARENCIA_FISCAL,
    ivaContenido: { rotulo: ROTULO_DE_IVA_CONTENIDO, porAlicuota: totales.ivaContenido },
    otrosImpuestosNacionalesIndirectos: {
      rotulo: ROTULO_DE_OTROS_IMPUESTOS_INDIRECTOS,
      valor: importeATexto(otrosImpuestosNacionalesIndirectos(moneda)),
    },
  };
}
