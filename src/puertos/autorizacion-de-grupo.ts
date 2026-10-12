import type { RolDeGrupo } from "../capacidades/permisos/grupo";
import type { ContextoDeGrupo } from "../contexto/contexto";

/** Lo que el guard de grupo necesita saber de quien actúa. */
export type DatosDelPropietario = Readonly<{
  /**
   * `null`: la persona no es propietaria ACTIVA del tenant del contexto (no tiene membresía de
   * tenant, está apagada, es de otro tenant o la persona está suspendida globalmente). El guard lo
   * traduce a `SIN_PERMISO`.
   */
  rol: RolDeGrupo | null;
}>;

/**
 * Puerto de carga de datos de autorización de grupo. Igual que el de empresa, NO se guarda nada entre
 * llamadas: el rol se lee dentro de la transacción de cada consulta, así que apagar a un propietario
 * corta su acceso en la operación siguiente. Solo el contexto de GRUPO tiene propietario: pasarle otro
 * no compila.
 */
export interface CargaDeAutorizacionDeGrupo {
  delPropietario(contexto: ContextoDeGrupo): Promise<DatosDelPropietario>;
}
