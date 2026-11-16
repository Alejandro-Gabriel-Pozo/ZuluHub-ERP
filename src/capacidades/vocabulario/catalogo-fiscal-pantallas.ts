import { TEXTOS_DE_FISCAL_PANTALLAS_1 } from "./partes/fiscal-pantallas-1";
import { TEXTOS_DE_FISCAL_PANTALLAS_2 } from "./partes/fiscal-pantallas-2";
import { TEXTOS_DE_FISCAL_PANTALLAS_3 } from "./partes/fiscal-pantallas-3";
import { TEXTOS_DE_FISCAL_PANTALLAS_4 } from "./partes/fiscal-pantallas-4";
import { TEXTOS_DE_FISCAL_PANTALLAS_5 } from "./partes/fiscal-pantallas-5";
import { TEXTOS_DE_FISCAL_PANTALLAS_6 } from "./partes/fiscal-pantallas-6";
import { TEXTOS_DE_FISCAL_PANTALLAS_7 } from "./partes/fiscal-pantallas-7";

/**
 * Los textos de las PANTALLAS del facturador (prefijo `fiscal.pantalla.*`), hoy la del detalle de un comprobante, la del
 * listado (sección «Listado») y la anulación (los de Configuración fiscal están en `catalogo-fiscal-configuracion.ts`): los rótulos, los siete estados (D-25), la etiqueta de anulación (D-29) y los avisos por estado de la guía de pantallas y
 * mensajes (§1.2). Viven aparte de `catalogo-fiscal.ts` (errores y mensajes de ARCA) para que ninguno de los dos crezca sin
 * tope; `catalogo.ts` los incluye y su prueba (`catalogo.test.ts`) los revisa como a todos. Castellano neutro y en
 * términos del negocio: ninguna palabra técnica ni el código crudo de nada. No se usa «acreditado» en lo que ve la
 * persona (D-29): se dice «anulado».
 *
 * Fuente de cada texto (verificable): PROTO = prototipo aprobado `detalle.html`; GUIA = `06-facturador-pantallas-y-mensajes.md`;
 * CONTRATO = `facturador-contratos-de-pantalla.md`. Un texto que no figure literalmente en una de las tres no entra:
 * lo prueba `catalogo.test.ts` solo en lo que puede (sin código crudo); la cita es la que se revisa a mano.
 *
 * El listado cita, además, CONTRATO-LISTADO = la sección «Contrato de la pantalla 1: Listado de comprobantes» del mismo contrato y
 * MENSAJE-DUEÑO = lo que el dueño dijo con fecha. El prototipo `Listado.dc.html` NO es fuente. Un texto marcado «PROPUESTA sin
 * fuente verificable, pendiente del dueño» no figura en ninguna fuente: es del carril web y espera la aprobación del dueño.
 * RESPUESTA-DUEÑO-2026-10-29 = «dueño, 2026-10-29, respuesta en la sesión web del carril web» (cuestionario de opciones).
 */
export const TEXTOS_DE_FISCAL_PANTALLAS = {
  ...TEXTOS_DE_FISCAL_PANTALLAS_1,
  ...TEXTOS_DE_FISCAL_PANTALLAS_2,
  ...TEXTOS_DE_FISCAL_PANTALLAS_3,
  ...TEXTOS_DE_FISCAL_PANTALLAS_4,
  ...TEXTOS_DE_FISCAL_PANTALLAS_5,
  ...TEXTOS_DE_FISCAL_PANTALLAS_6,
  ...TEXTOS_DE_FISCAL_PANTALLAS_7,
} as const;
