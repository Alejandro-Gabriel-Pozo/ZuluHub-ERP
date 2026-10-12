import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { clavesDe, esClaveDe } from "../modulos/activos";
import type { DefinicionDeAccion, DefinicionDeModulo } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

/**
 * Guard de permisos (ADR-003, ADR-008). Es INTEGRIDAD, no un control configurable: la autorización
 * se decide siempre en el servidor, con datos leídos dentro de la transacción del caso de uso.
 *
 * Es genérico a propósito: el catálogo y la matriz rol → acciones llegan como PARÁMETRO (`reglas`).
 * Hoy son los fijos de `empresa.ts` (roles fijos para todas las empresas, decisión 18); el día que
 * los roles sean datos de cada empresa, cambia quien arma las `reglas`, no este archivo.
 */

/** Por qué se rechaza una acción, en este orden de precedencia (el primero que falle). */
export type MotivoDeRechazo =
  "MODULO_EN_DESARROLLO" | "MODULO_NO_ACTIVO" | "SIN_CAPACIDAD" | "SIN_PERMISO";

/** Lo que el guard necesita saber de quien actúa y de su empresa (cargado en la misma transacción). */
export type DatosDelGuard<M extends string, C extends string> = Readonly<{
  /** `null`: sin persona, sin membresía activa o persona suspendida globalmente. */
  rol: RolDeEmpresa | null;
  modulosActivos: ReadonlySet<M>;
  /** `null`: la operación no es de una sucursal. */
  capacidadesDeSucursal: ReadonlySet<C> | null;
}>;

/** Del módulo, el guard mira su estado y sus acciones; `obligatorio` sirve para armar los activos. */
export type ModuloDelGuard<C extends string> = Pick<DefinicionDeModulo, "estado" | "obligatorio"> &
  Readonly<{ acciones: Readonly<Record<string, DefinicionDeAccion<C>>> }>;

export type ReglasDelGuard<M extends string, A extends string, C extends string> = Readonly<{
  catalogo: Readonly<Record<M, ModuloDelGuard<C>>>;
  permisos: Readonly<Record<A, readonly RolDeEmpresa[]>>;
}>;

/** El módulo dueño de la acción y la capacidad que exige; `null` si ningún módulo la declara. */
function dondeEstaLaAccion<M extends string, A extends string, C extends string>(
  catalogo: ReglasDelGuard<M, A, C>["catalogo"],
  accion: A,
): { modulo: M; capacidad: C | null } | null {
  for (const modulo of clavesDe(catalogo)) {
    const { acciones } = catalogo[modulo];
    const definicion = esClaveDe(acciones, accion) ? acciones[accion] : undefined;
    if (definicion !== undefined) return { modulo, capacidad: definicion.capacidad };
  }
  return null;
}

/**
 * Puro y síncrono. Orden fijo: módulo en desarrollo → módulo no activo → capacidad → rol. Una acción
 * que ningún módulo declara, o sin permisos definidos, es un defecto (por tipos no puede pasar) y
 * lanza `RangeError`: nunca se autoriza por omisión.
 */
export function evaluarGuard<M extends string, A extends string, C extends string>(
  reglas: ReglasDelGuard<M, A, C>,
  accion: A,
  datos: DatosDelGuard<M, C>,
): Resultado<null, MotivoDeRechazo> {
  const nombre: string = accion;
  const donde = dondeEstaLaAccion(reglas.catalogo, accion);
  if (donde === null) throw new RangeError(`la acción ${nombre} no la declara ningún módulo`);
  if (!esClaveDe(reglas.permisos, accion)) {
    throw new RangeError(`la acción ${nombre} no tiene permisos definidos`);
  }
  if (reglas.catalogo[donde.modulo].estado === "en_desarrollo") {
    return err("MODULO_EN_DESARROLLO");
  }
  if (!datos.modulosActivos.has(donde.modulo)) return err("MODULO_NO_ACTIVO");
  if (
    donde.capacidad !== null &&
    (datos.capacidadesDeSucursal === null || !datos.capacidadesDeSucursal.has(donde.capacidad))
  ) {
    return err("SIN_CAPACIDAD");
  }
  // Sin rol (`null`) ningún rol de la matriz coincide: no hay un caso aparte.
  if (!reglas.permisos[accion].some((permitido) => permitido === datos.rol)) {
    return err("SIN_PERMISO");
  }
  return ok(null);
}
