import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import { estadoDeModulos } from "../modulos/activos";
import { evaluarGuard, type MotivoDeRechazo, type ReglasDelGuard } from "./guard";
import type { RolDeEmpresa } from "./roles";

/**
 * Lo que el guard necesita del actor, con la forma de `DatosDelActor` (puertos/autorizacion) pero
 * escrito acá a propósito: `capacidades` no importa `puertos/` (ADR-001), así que la carga se tipa
 * estructuralmente y cualquier módulo le pasa la suya.
 */
export type ActorCargado<R extends string = RolDeEmpresa> = Readonly<{
  /**
   * `null`: sin persona, sin membresía activa o persona suspendida globalmente (en la plataforma:
   * administrador inexistente o inactivo).
   */
  rol: R | null;
  /** Módulos activables que la empresa activó (los obligatorios no se guardan). */
  modulosActivados: readonly string[];
  /**
   * Módulos que su plan incluye (el techo): se leen en la misma lectura que el rol. Un módulo
   * activado que no figura acá queda en solo lectura (`estadoDeModulos`). Obligatorio a propósito:
   * una carga que se olvida del plan no compila.
   */
  modulosHabilitados: readonly string[];
}>;

/** Carga del actor, leída dentro de la transacción en curso y sin caché. */
export type CargaDelActor<R extends string = RolDeEmpresa> = () => Promise<ActorCargado<R>>;

/**
 * El guard de permisos como primer paso de cada caso de uso y de cada consulta (ADR-003): el actor
 * tiene que poder hacer la `accion` declarada. La base NO conoce el rol del actor: lo verifica el
 * servidor, y `cargar` lo lee dentro de la misma transacción serializable (así una membresía apagada
 * un instante antes ya no pasa y un reintento lo vuelve a leer). Nada se guarda en sesión ni en caché.
 *
 * Es genérico como `evaluarGuard` (también en el tipo de rol: el de empresa es el valor por defecto
 * y la plataforma pasa el suyo): una acción que el catálogo no declara, o un rol de otro catálogo,
 * no compila. `cargar` se invoca exactamente una vez por llamada.
 */
export async function exigirAccion<
  M extends string,
  A extends string,
  C extends string,
  R extends string = RolDeEmpresa,
>(
  reglas: ReglasDelGuard<M, A, C, R>,
  accion: A,
  cargar: CargaDelActor<NoInfer<R>>,
): Promise<Resultado<null, MotivoDeRechazo>> {
  return exigirAcciones(reglas, [accion], cargar);
}

/**
 * Lo mismo para una operación que cruza varias transiciones y por eso exige VARIAS acciones (cobrar
 * un ticket exige además emitir el comprobante: conciliación §3.6). El actor se carga UNA sola vez y
 * se evalúa el guard con cada acción, en el orden dado: el primer rechazo es el que vuelve (los
 * demás no se evalúan), así que quien llama pone primero la acción cuyo rechazo quiere ver. Pasan
 * solo si pasan todas. Una lista vacía es un defecto del llamador (autorizaría por omisión) y lanza
 * `RangeError`, como una acción sin definir en el guard.
 *
 * Previene que cada caso orquestador repita `exigirAccion` en cadena: cada llamada vuelve a leer al
 * actor (varias consultas por cada operación de venta) y el orden de las acciones queda disperso en
 * llamadas sueltas en lugar de en una lista que se lee de un vistazo.
 */
export async function exigirAcciones<
  M extends string,
  A extends string,
  C extends string,
  R extends string = RolDeEmpresa,
>(
  reglas: ReglasDelGuard<M, A, C, R>,
  acciones: readonly [A, ...A[]],
  cargar: CargaDelActor<NoInfer<R>>,
): Promise<Resultado<null, MotivoDeRechazo>> {
  // El tipo ya lo impide; esto cubre una lista vacía que llegue por un `as` o por datos.
  if (acciones.length === 0) throw new RangeError("exigirAcciones sin ninguna acción");
  const actor = await cargar();
  const datos = {
    rol: actor.rol,
    ...estadoDeModulos(reglas.catalogo, actor.modulosActivados, actor.modulosHabilitados),
    capacidadesDeSucursal: null,
  };
  for (const accion of acciones) {
    const permiso = evaluarGuard(reglas, accion, datos);
    if (!permiso.ok) return permiso;
  }
  return ok(null);
}
