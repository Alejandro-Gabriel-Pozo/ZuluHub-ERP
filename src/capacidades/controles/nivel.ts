/**
 * Nivel de un control (ADR-008): qué pasa cuando la condición que vigila se cumple. Los valores son
 * los mismos del CHECK `nivel_de_control_nivel_ck` de la base (0086); una prueba de integración los
 * compara. Empresas y sucursales eligen solo entre permitir y avisar (dueño, 18/11/2026, ADR-008 opción b): ningún
 * nivel guardado bloquea. Un control NO es una invariante: la integridad (idempotencia, aislamiento, trazabilidad,
 * exactitud del dinero, autorización) nunca pasa por acá, y sus bloqueos son fijos del sistema, no se declaran como control.
 * Previene que reaparezca un bloqueo configurable (`test/arquitectura/sin-nivel-bloquear.test.ts`).
 */
export const NIVELES_DE_CONTROL = ["PERMITIR", "AVISAR"] as const;

export type NivelDeControl = (typeof NIVELES_DE_CONTROL)[number];

/** Sin fila guardada, o con el control no disponible en el plan: el negocio no se frena (ADR-008). */
export const NIVEL_POR_DEFECTO: NivelDeControl = "PERMITIR";

export function esNivelDeControl(texto: string): texto is NivelDeControl {
  return (NIVELES_DE_CONTROL as readonly string[]).includes(texto);
}

/**
 * Lee un nivel guardado (DEC-0762): sin valor, `PERMITIR`; un valor que no es ninguno de los dos se lee como `AVISAR` (ante la duda no se habilita
 * en silencio, y tampoco se bloquea). Es la única lectura de un valor guardado: el adaptador y el dominio de stock la usan.
 */
export function leerNivelGuardado(guardado: string | null): NivelDeControl {
  if (guardado === null) return NIVEL_POR_DEFECTO;
  return esNivelDeControl(guardado) ? guardado : "AVISAR";
}

/**
 * El nivel que rige, con lo que ya se leyó (puro y síncrono, como el guard):
 *  - control no disponible en el plan → `PERMITIR`, digan lo que digan los niveles guardados;
 *  - si no, el de la empresa (sin fila: `PERMITIR`), y la sucursal puede ENDURECERLO pero no
 *    aflojarlo (supuesto de ADR-008): rige el más exigente de los dos, `AVISAR` antes que `PERMITIR`.
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
  if (guardados.includes("AVISAR")) return "AVISAR";
  return NIVEL_POR_DEFECTO;
}
