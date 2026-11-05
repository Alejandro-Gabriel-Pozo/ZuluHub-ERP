import type { ModeloDeImpresionParaLaPantalla } from "../servidor/facturacion";
import { formatearImporte } from "../ui/plantillas/facturacion/formato-fiscal";
import {
  ALTO_A4_MM,
  ANCHO_A4_MM,
  MARGEN_A4_MM,
} from "../ui/plantillas/facturacion/impresion/geometria";
import { entradaDelPaginador } from "../ui/plantillas/facturacion/impresion/medidas-de-la-hoja";
import {
  armarLaHoja,
  textoDeLaHoja,
} from "../ui/plantillas/facturacion/impresion/modelo-de-la-hoja";
import { paginar } from "../ui/plantillas/facturacion/impresion/paginador";
import { comprobanteParaLaHoja } from "./modelo-de-impresion";

type Modelo = ModeloDeImpresionParaLaPantalla["modelo"];

/**
 * Del modelo de impresión de fiscal a lo que recibe el generador de PDF: la hoja armada por la MISMA `armarLaHoja` que arma la pantalla
 * (mismos textos del catálogo, mismo formato de importes y fechas, mismo mapeo en lista blanca de `comprobanteParaLaHoja`), el paginador
 * y el formato de la pantalla, y la URL del QR del modelo. Acá no se escribe ningún formato ni texto: se junta lo que ya existe.
 * Previene: que el PDF diga algo distinto de la pantalla. Chequeo: `test/web/pdf-de-la-factura.test.ts`.
 *
 * Solo A4: el ticket de 80 mm queda para una entrega posterior (decisión del dueño, 2026-11-05).
 */
export function entradaDelPdf(m: Modelo, creadoEn: Date) {
  return {
    hoja: armarLaHoja({}, comprobanteParaLaHoja(m), "A4"),
    importes: m.renglones.map((r) => r.importe),
    qrUrl: m.qr.url,
    reglas: {
      papel: { anchoMm: ANCHO_A4_MM, altoMm: ALTO_A4_MM, margenMm: MARGEN_A4_MM },
      repartir: (medidas: Parameters<typeof entradaDelPaginador>[0], importes: readonly string[]) =>
        paginar(entradaDelPaginador(medidas, importes)),
      formatearImporte,
      textoDeLaHoja: (k: number, n: number) => textoDeLaHoja({}, k, n),
    },
    creadoEn,
  };
}
