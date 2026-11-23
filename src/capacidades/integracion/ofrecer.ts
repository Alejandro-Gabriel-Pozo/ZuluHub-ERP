import type { OperacionContextual } from "./tipos";

/**
 * LA REGLA ÚNICA DE «SE OFRECE» (escalabilidad X-1). Decide si algo se muestra a la persona; la comparten el menú
 * (`armarElMenu`) y las operaciones contextuales. Previene dos reglas distintas de «qué se ve» (una regla, un lugar).
 *
 * Ofrecer NO autoriza: lo que se ofrece lo vuelve a decidir el servidor con el guard cuando la persona lo hace. Ante la duda
 * (permisos sin leer, función de pago sin leer) NO se ofrece (todo nace cerrado). Chequeo: `ofrecer.test.ts`, que compara con la
 * expresión vieja del menú como oráculo.
 */

export type PermisosParaOfrecer = Readonly<{
  acciones: readonly string[];
  modulos: Readonly<{ activos: readonly string[]; enSoloLectura: readonly string[] }>;
  /** Las funciones de pago interruptor ENCENDIDAS; `undefined` = no se leyeron. */
  funcionesEncendidas?: readonly string[];
}>;

type CatalogoParaOfrecer = Readonly<Record<string, Readonly<{ estado: string }>>>;

/**
 * Todas tienen que cumplirse: hay permisos; el módulo existe y está disponible; la persona tiene la acción y el módulo está
 * activo o en solo lectura (en solo lectura, lo que crea no figura en `acciones`: esa lista sale del mismo cálculo que el guard);
 * y, con función de pago, está encendida y se leyó.
 */
export function seOfrece(
  catalogo: CatalogoParaOfrecer,
  permisos: PermisosParaOfrecer | null,
  pedido: Readonly<{ modulo: string; accion: string; perilla?: string | null }>,
): boolean {
  if (permisos === null) return false;
  if (!Object.hasOwn(catalogo, pedido.modulo)) return false;
  if (catalogo[pedido.modulo]?.estado !== "disponible") return false;
  if (!permisos.acciones.includes(pedido.accion)) return false;
  if (
    !permisos.modulos.activos.includes(pedido.modulo) &&
    !permisos.modulos.enSoloLectura.includes(pedido.modulo)
  )
    return false;
  const perilla = pedido.perilla ?? null;
  if (perilla !== null) {
    if (permisos.funcionesEncendidas === undefined) return false;
    if (!permisos.funcionesEncendidas.includes(perilla)) return false;
  }
  return true;
}

/** Las operaciones de un contexto que se ofrecen hoy, por `orden` (menor primero). */
export function operacionesOfrecidas(
  catalogo: CatalogoParaOfrecer,
  operaciones: readonly OperacionContextual<string>[],
  permisos: PermisosParaOfrecer | null,
  contexto: string,
): readonly OperacionContextual<string>[] {
  return operaciones
    .filter((o) => o.contexto === contexto)
    .filter((o) =>
      seOfrece(catalogo, permisos, { modulo: o.modulo, accion: o.accion, perilla: o.perilla }),
    )
    .toSorted((a, b) => a.orden - b.orden);
}
