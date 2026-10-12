import type { Resultado } from "../../primitivas/resultado/resultado";
import { modulosActivosDe } from "../modulos/activos";
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
  const actor = await cargar();
  return evaluarGuard(reglas, accion, {
    rol: actor.rol,
    modulosActivos: modulosActivosDe(reglas.catalogo, actor.modulosActivados),
    capacidadesDeSucursal: null,
  });
}
