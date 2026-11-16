import { TEXTOS_DE_FISCAL_CONFIGURACION_1 } from "./partes/fiscal-configuracion-1";
import { TEXTOS_DE_FISCAL_CONFIGURACION_2 } from "./partes/fiscal-configuracion-2";
import { TEXTOS_DE_FISCAL_CONFIGURACION_3 } from "./partes/fiscal-configuracion-3";
import { TEXTOS_DE_FISCAL_CONFIGURACION_4 } from "./partes/fiscal-configuracion-4";

/**
 * Los textos de Configuración fiscal (prefijo `fiscal.pantalla.config_*`): la lista de lo que falta y las pantallas de Puntos de
 * venta y de Datos fiscales (D-43). Viven aparte de `catalogo-fiscal-pantallas.ts` para que ninguno de los dos pase del tope de líneas; `catalogo.ts`
 * los incluye y `catalogo.test.ts` los revisa como a todos. Castellano neutro y en términos del negocio.
 *
 * Una línea de fuente por texto, con el cuestionario real y la pregunta (preguntas hechas al dueño con AskUserQuestion en la sesión
 * web del carril web, 2026-10-29):
 *   Q17 = cuestionario de las 17:45Z: P1 provincias, P2 textos de la lista, P3 textos de Puntos de venta, P4 textos de Datos fiscales
 *   (el dueño contestó «Aprobar tal cual» a la P4, que listaba, entre otros: los botones «Guardar borrador», «Confirmar» y «Cancelar»;
 *   los campos «CUIT», «Razón social», «Condición frente al IVA», «Domicilio», «Inicio de actividades» y los mismos de domicilio
 *   que en Puntos de venta). El rótulo «Domicilio» (no «Domicilio fiscal») es el de D-82 (dueño, 2026-11-03).
 *   QA  = cuestionario A (21:08Z): P1 entrada, P2 sin puntos de venta, P3 rótulos y aviso de pruebas, P4 sucursal cerrada.
 *   QB  = cuestionario B (21:11Z): P1 accesos, P2 el certificado solo informa, P3 certificado sin punto de venta, P4 «Guardando…».
 *   CONTRATO-CONFIG = `facturador-contratos-de-pantalla.md` (D-43 a D-49 y D-60 a D-68); PROTO-PV = prototipo de Puntos de venta,
 *   opción A. Un texto marcado SUPUESTO (DEC-0049) es del ingeniero: el dueño no lo aprobó tal cual. Previene: dar por aprobado en bloque lo
 *   que se preguntó de a uno (o no se preguntó).
 */
export const TEXTOS_DE_FISCAL_CONFIGURACION = {
  ...TEXTOS_DE_FISCAL_CONFIGURACION_1,
  ...TEXTOS_DE_FISCAL_CONFIGURACION_2,
  ...TEXTOS_DE_FISCAL_CONFIGURACION_3,
  ...TEXTOS_DE_FISCAL_CONFIGURACION_4,
} as const;
