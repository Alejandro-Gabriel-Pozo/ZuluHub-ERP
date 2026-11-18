/**
 * Un punto de venta tal como lo informa ARCA en `FEParamGetPtosVenta` (manual WSFE v4.8, l. 3000-3114): su número (`Nro`), si está
 * bloqueado (`Bloqueado`, `S` o `N`), si tiene fecha de baja (`FchBaja`, opcional) y para qué emite (`EmisionTipo`, CAE o CAEA).
 * SIN VERIFICAR contra ARCA real qué literales manda en `EmisionTipo` y en `FchBaja`: no hay una grabación de esta operación.
 */
export type PuntoDeVentaDeArca = Readonly<{
  numero: number;
  bloqueado: boolean;
  dadoDeBaja: boolean;
  emision: "CAE" | "CAEA";
}>;

/** Por qué ARCA no habilita un número para pasar a producción; el orden de la unión es el orden en que se decide. */
export type MotivoDeNoHabilitacion =
  "SIN_PUNTOS_DE_VENTA" | "NO_FIGURA" | "REPETIDO" | "DADO_DE_BAJA" | "BLOQUEADO" | "SOLO_CAEA";

/**
 * Por qué un punto de venta NO puede pasar a producción, o `null` si puede. Reglas: D-77 (dueño, 2026-10-29: ARCA lo tiene en su lista, no
 * está bloqueado ni dado de baja) y la del dueño del 18/11/2026 (decisión DEC-0742, `decisiones-del-dueno-2026-11.md`, fila 305): uno que
 * ARCA informa solo para CAEA tampoco pasa, porque la emisión de este sistema es por CAE. Fail closed: si el número aparece más de una vez
 * no se sabe cuál vale y no pasa (ni hace falta mirar los demás).
 * Previene: pasar a producción un número que ARCA rechazaría en cada emisión (validación 10005, «el punto de venta informado debe estar dado
 * de alta», manual l. 960), que quedaría a la vista recién con la primera factura real.
 * Chequeo: `habilitacion-en-arca.test.ts` (cada motivo por separado, el orden y la equivalencia con `habilitadoEnArca`) y la prueba del caso de uso.
 */
export function motivoDeNoHabilitacion(
  informados: readonly PuntoDeVentaDeArca[],
  numero: number,
): MotivoDeNoHabilitacion | null {
  if (informados.length === 0) return "SIN_PUNTOS_DE_VENTA";
  const [unico, ...otros] = informados.filter((p) => p.numero === numero);
  if (unico === undefined) return "NO_FIGURA";
  if (otros.length > 0) return "REPETIDO";
  if (unico.dadoDeBaja) return "DADO_DE_BAJA";
  if (unico.bloqueado) return "BLOQUEADO";
  if (unico.emision === "CAEA") return "SOLO_CAEA";
  return null;
}

/** ¿Puede pasar? Es `motivoDeNoHabilitacion(...) === null`: una regla, un lugar. */
export function habilitadoEnArca(
  informados: readonly PuntoDeVentaDeArca[],
  numero: number,
): boolean {
  return motivoDeNoHabilitacion(informados, numero) === null;
}
