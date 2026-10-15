import type { AlcanceDeSucursales } from "../capacidades/permisos/alcance";
import type { RolDeEmpresa } from "../capacidades/permisos/roles";
import type { ContextoOperativo } from "../contexto/contexto";

/**
 * Lo que el guard necesita saber de quien actúa. Los permisos NO se guardan en la sesión ni en
 * ninguna caché: se leen dentro de la transacción de cada caso de uso, así que una baja o una
 * suspensión corta el acceso en la operación siguiente.
 */
export type DatosDelActor = Readonly<{
  /** `null`: sin persona, sin membresía activa en la empresa del contexto o persona suspendida. */
  rol: RolDeEmpresa | null;
  /** Módulos activables que la empresa activó (los obligatorios no se guardan). */
  modulosActivados: readonly string[];
  /**
   * Módulos que el plan de su tenant incluye (el techo), leídos en la misma lectura que el rol.
   * Obligatorio a propósito: una carga que se olvida del plan no compila. Un módulo activado que no
   * figura acá queda en solo lectura (corrección 16).
   */
  modulosHabilitados: readonly string[];
}>;

/**
 * Puerto de carga de datos de autorización. Solo el contexto OPERATIVO tiene actor y empresa: pasarle
 * uno de plataforma, de grupo, de trabajos o de invitación no compila.
 */
export interface CargaDeAutorizacion {
  /**
   * Dentro de la transacción en curso: el rol de la membresía ACTIVA del actor en la empresa del
   * contexto, con la persona activa globalmente (una suspensión de plataforma quita todos los
   * permisos). La membresía de otra empresa no cuenta. Tampoco cuenta si la persona entró por la
   * puerta de otra marca: `marcaDeEntrada` tiene que ser la marca del tenant de la empresa (una
   * marca de entrada `null` con persona tampoco autoriza); si no, `rol: null` y todo da `SIN_PERMISO`.
   */
  delActor(contexto: ContextoOperativo): Promise<DatosDelActor>;
  /**
   * Dentro de la transacción en curso: las sucursales donde el actor puede operar (K5, conciliación
   * §3.4). `"TODAS"` para el gerente y el administrador activos; para el operador, las sucursales
   * ACTIVAS donde tiene asignación ACTIVA (ordenadas, sin repetir; vacía si no tiene ninguna). Sin
   * membresía activa, con la persona suspendida globalmente o sin persona: vacía (falla cerrado). Se
   * lee en cada llamada, sin caché: una asignación apagada un instante antes ya no cuenta. Con la
   * puerta de otra marca (o sin ella, con persona): vacía, como si no tuviera rol. El caso
   * de uso lo usa con `exigirSucursal`; este puerto no autoriza por sí mismo.
   */
  sucursalesDelActor(contexto: ContextoOperativo): Promise<AlcanceDeSucursales>;
}
