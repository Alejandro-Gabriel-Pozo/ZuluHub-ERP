import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { clavesDe, esClaveDe } from "../modulos/activos";
import type { DefinicionDeAccion, DefinicionDeModulo } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

/**
 * Guard de permisos (ADR-003, ADR-008). Es INTEGRIDAD, no un control configurable: la autorización
 * se decide siempre en el servidor, con datos leídos dentro de la transacción del caso de uso.
 *
 * Es genérico a propósito: el catálogo y la matriz rol → acciones llegan como PARÁMETRO (`reglas`),
 * y el TIPO DE ROL también (`R`). Para la empresa son los fijos de `empresa.ts` (roles fijos para
 * todas las empresas, decisión 18; es el valor por defecto de `R`, así que las llamadas de empresa
 * no cambian); para la plataforma, los de `plataforma.ts` (`ADMIN`, `SOPORTE`). El día que los roles
 * sean datos de cada empresa, cambia quien arma las `reglas`, no este archivo. Ninguno de los
 * catálogos se importa acá: el guard no conoce ninguna matriz concreta.
 */

/** Por qué se rechaza una acción, en este orden de precedencia (el primero que falle). */
export type MotivoDeRechazo =
  "MODULO_EN_DESARROLLO" | "MODULO_NO_ACTIVO" | "SIN_CAPACIDAD" | "SIN_PERMISO";

/** Lo que el guard necesita saber de quien actúa y de su empresa (cargado en la misma transacción). */
export type DatosDelGuard<
  M extends string,
  C extends string,
  R extends string = RolDeEmpresa,
> = Readonly<{
  /**
   * `null`: sin actor, sin rol vigente (para la empresa: sin membresía activa o persona suspendida
   * globalmente; para la plataforma: administrador inexistente o inactivo).
   */
  rol: R | null;
  modulosActivos: ReadonlySet<M>;
  /** `null`: la operación no es de una sucursal. */
  capacidadesDeSucursal: ReadonlySet<C> | null;
}>;

/** Del módulo, el guard mira su estado y sus acciones; `obligatorio` sirve para armar los activos. */
export type ModuloDelGuard<C extends string> = Pick<DefinicionDeModulo, "estado" | "obligatorio"> &
  Readonly<{ acciones: Readonly<Record<string, DefinicionDeAccion<C>>> }>;

export type ReglasDelGuard<
  M extends string,
  A extends string,
  C extends string,
  R extends string = RolDeEmpresa,
> = Readonly<{
  catalogo: Readonly<Record<M, ModuloDelGuard<C>>>;
  permisos: Readonly<Record<A, readonly R[]>>;
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
export function evaluarGuard<
  M extends string,
  A extends string,
  C extends string,
  R extends string = RolDeEmpresa,
>(
  reglas: ReglasDelGuard<M, A, C, R>,
  accion: A,
  // `NoInfer`: el tipo de rol lo fija la matriz; un rol de otro catálogo en `datos` no compila.
  datos: DatosDelGuard<M, C, NoInfer<R>>,
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
