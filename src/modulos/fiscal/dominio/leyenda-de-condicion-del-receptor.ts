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
  // A.II c) 4: «"NO RESPONSABLE IVA" o "IVA EXENTO", según corresponda». La norma no dice cuál va con cuál: el dueño decidió que va por
  // nombre (P1; dueño, 2026-11-06, conversación con el orquestador): el exento lleva «IVA EXENTO» y el no alcanzado «NO RESPONSABLE IVA».
  EXENTO: "IVA EXENTO",
  IVA_NO_ALCANZADO: "NO RESPONSABLE IVA",
  // A.II d) 1. El dueño decidió que se imprima SIEMPRE, con o sin nombre (P4; dueño, 2026-11-06, conversación con el orquestador).
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

/** La leyenda de la condición del receptor (versión 3 en adelante); `null` si la norma no da una aplicable. */
export function leyendaDeCondicionDelReceptor(condicion: CondicionIvaReceptor): string | null {
  return LEYENDAS_DE_CONDICION[condicion];
}
