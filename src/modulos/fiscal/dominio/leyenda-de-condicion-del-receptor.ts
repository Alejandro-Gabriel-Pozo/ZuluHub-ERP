import type { CondicionIvaReceptor } from "./condicion-iva-receptor";

/**
 * Leyenda de la condición del receptor frente al IVA, copiada de la norma sin parafrasear; si ARCA la cambia, es una versión nueva
 * del modelo de impresión. Una regla, un lugar: la hoja, el rollo de 80 mm y el PDF dibujan lo que el modelo trae, no tienen texto propio.
 *
 * FUENTE de cada texto (repositorio de docs, `12-referencias-externas/arca-normas-de-comprobantes/rg1415_dcp.html`): RG 1415,
 * Anexo II, Apartado A, Título II («Respecto del comprador, locatario o prestatario»), inciso citado junto a cada constante.
 * Análisis y preguntas: `11-especificaciones/emitir-leyendas-receptor-v3.md` (Fase 1, 2026-11-06).
 *
 * Previene: una factura A a un responsable inscripto o monotributista que sale sin la leyenda de su condición, que la norma exige
 * (a.4, e.4). Chequeo: el `Record` es exhaustivo (una condición nueva no compila sin decidir su leyenda) y
 * `leyenda-de-condicion-del-receptor.test.ts` fija cada texto y que ningún otro archivo de `src` ni `apps` lo repite.
 */
/** «A CONSUMIDOR FINAL» (versión 2 en adelante). */
export const LEYENDA_A_CONSUMIDOR_FINAL = "A CONSUMIDOR FINAL";

export const LEYENDAS_DE_CONDICION: Readonly<Record<CondicionIvaReceptor, string | null>> = {
  // A.II a) 4
  RESPONSABLE_INSCRIPTO: "IVA RESPONSABLE INSCRITO",
  // A.II c) 4 admite «NO RESPONSABLE IVA» o «IVA EXENTO, según corresponda» sin decir cuál va con cuál. SIN LEYENDA POR DECIDIR
  // (pregunta P1 al dueño, 2026-11-06): hasta su respuesta ni el exento ni el no alcanzado imprimen leyenda.
  EXENTO: null,
  IVA_NO_ALCANZADO: null,
  // A.II d) 1
  CONSUMIDOR_FINAL: LEYENDA_A_CONSUMIDOR_FINAL,
  // A.II e) 4
  MONOTRIBUTO: "RESPONSABLE MONOTRIBUTO",
  // A.II e) 4
  MONOTRIBUTISTA_SOCIAL: "MONOTRIBUTISTA SOCIAL",
  // A.II e) 4
  MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO: "MONOTRIBUTO TRABAJADOR INDEPENDIENTE PROMOVIDO",
  // A.II f) 4
  NO_CATEGORIZADO: "SUJETO NO CATEGORIZADO",
  // SUPUESTO del orquestador (P2, 2026-11-06), revertible: sin leyenda. A.II g) 2 («IVA EXENTO OPERACION DE EXPORTACION») es solo de
  // operaciones de exportación (clase E), que el sistema no emite; la norma no da otra para un receptor del exterior en A, B o C.
  CLIENTE_DEL_EXTERIOR: null,
  PROVEEDOR_DEL_EXTERIOR: null,
  // SUPUESTO del orquestador (P3, 2026-11-06), revertible: la norma no trae leyenda para este caso.
  IVA_LIBERADO_LEY_19640: null,
};

/**
 * La leyenda de la condición de un receptor que NO es consumidor final (versión 3 en adelante); `null` si la norma no da una
 * aplicable o está por decidir. El consumidor final tiene su propio campo (`receptor.leyenda`, versión 2) y NO se repite acá.
 */
export function leyendaDeCondicionDelReceptor(condicion: CondicionIvaReceptor): string | null {
  return condicion === "CONSUMIDOR_FINAL" ? null : LEYENDAS_DE_CONDICION[condicion];
}
