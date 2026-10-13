/**
 * Nivel de un control (ADR-008): qué pasa cuando la condición que vigila se cumple. Los valores son
 * los mismos del CHECK `nivel_de_control_nivel_ck` de la base (0007); una prueba de integración los
 * compara. Un control NO es una invariante: la integridad (idempotencia, aislamiento, trazabilidad,
 * exactitud del dinero, autorización) nunca pasa por acá.
 */
export const NIVELES_DE_CONTROL = ["PERMITIR", "AVISAR", "BLOQUEAR"] as const;

export type NivelDeControl = (typeof NIVELES_DE_CONTROL)[number];

/** Sin fila guardada, o con el control no disponible en el plan: el negocio no se frena (ADR-008). */
export const NIVEL_POR_DEFECTO: NivelDeControl = "PERMITIR";

export function esNivelDeControl(texto: string): texto is NivelDeControl {
  return (NIVELES_DE_CONTROL as readonly string[]).includes(texto);
}

/**
 * El nivel que rige, con lo que ya se leyó (puro y síncrono, como el guard):
 *  - control no disponible en el plan → `PERMITIR`, digan lo que digan los niveles guardados;
 *  - si no, el de la empresa (sin fila: `PERMITIR`), y la sucursal puede ENDURECERLO pero no
 *    aflojarlo (supuesto de ADR-008): rige el más exigente de los dos, `BLOQUEAR` antes que `AVISAR`
 *    antes que `PERMITIR`.
 * Previene que un módulo resuelva el nivel a su manera: una sucursal con `PERMITIR` no puede abrir lo
 * que la empresa bloqueó, y un plan sin el control no frena una venta.
 */
export function resolverNivel(
  entrada: Readonly<{
    disponibleEnElPlan: boolean;
    nivelDeLaEmpresa: NivelDeControl | null;
    nivelDeLaSucursal: NivelDeControl | null;
  }>,
): NivelDeControl {
  if (!entrada.disponibleEnElPlan) return NIVEL_POR_DEFECTO;
  const guardados = [entrada.nivelDeLaEmpresa, entrada.nivelDeLaSucursal];
  if (guardados.includes("BLOQUEAR")) return "BLOQUEAR";
  if (guardados.includes("AVISAR")) return "AVISAR";
  return NIVEL_POR_DEFECTO;
}
