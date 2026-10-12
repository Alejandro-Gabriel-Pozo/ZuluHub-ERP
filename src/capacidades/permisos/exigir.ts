import type { Resultado } from "../../primitivas/resultado/resultado";
import { modulosActivosDe } from "../modulos/activos";
import { evaluarGuard, type MotivoDeRechazo, type ReglasDelGuard } from "./guard";
import type { RolDeEmpresa } from "./roles";

/**
 * Lo que el guard necesita del actor, con la forma de `DatosDelActor` (puertos/autorizacion) pero
 * escrito acá a propósito: `capacidades` no importa `puertos/` (ADR-001), así que la carga se tipa
 * estructuralmente y cualquier módulo le pasa la suya.
 */
export type ActorCargado = Readonly<{
  /** `null`: sin persona, sin membresía activa o persona suspendida globalmente. */
  rol: RolDeEmpresa | null;
  /** Módulos activables que la empresa activó (los obligatorios no se guardan). */
  modulosActivados: readonly string[];
}>;

/** Carga del actor, leída dentro de la transacción en curso y sin caché. */
export type CargaDelActor = () => Promise<ActorCargado>;

/**
 * El guard de permisos como primer paso de cada caso de uso y de cada consulta (ADR-003): el actor
 * tiene que poder hacer la `accion` declarada. La base NO conoce el rol del actor: lo verifica el
 * servidor, y `cargar` lo lee dentro de la misma transacción serializable (así una membresía apagada
 * un instante antes ya no pasa y un reintento lo vuelve a leer). Nada se guarda en sesión ni en caché.
 *
 * Es genérico como `evaluarGuard`: una acción que el catálogo no declara no compila. `cargar` se
 * invoca exactamente una vez por llamada.
 */
export async function exigirAccion<M extends string, A extends string, C extends string>(
  reglas: ReglasDelGuard<M, A, C>,
  accion: A,
  cargar: CargaDelActor,
): Promise<Resultado<null, MotivoDeRechazo>> {
  const actor = await cargar();
  return evaluarGuard(reglas, accion, {
    rol: actor.rol,
    modulosActivos: modulosActivosDe(reglas.catalogo, actor.modulosActivados),
    capacidadesDeSucursal: null,
  });
}
