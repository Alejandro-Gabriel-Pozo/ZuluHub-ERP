import type { RolDeEmpresa } from "../capacidades/permisos/roles";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../contexto/estados";
import type {
  EmpresaId,
  MarcaComercialId,
  PersonaId,
  UsuarioAuthId,
} from "../primitivas/identificadores/marca";

/**
 * Una empresa a la que la persona de la sesión puede entrar, tal como la lee la pantalla «elegir
 * empresa»: lo mínimo (sin datos fiscales) y con el estado de la empresa y el de su tenant, que juntos
 * dicen si opera.
 */
export type EmpresaDeLaSesion = Readonly<{
  empresaId: EmpresaId;
  nombre: string;
  rol: RolDeEmpresa;
  estado: EstadoDeEmpresa;
  estadoDelTenant: EstadoDeTenant;
}>;

/**
 * Puerto de lectura de la sesión (web-armazon §3.3). Lee con la MISMA conexión de la transacción de un
 * contexto `SESION`: lo que la base deja ver con el claim `s` es la persona del usuario, sus membresías
 * activas, sus empresas y los tenants de estas, y nada más. Cruza tablas de tres módulos (persona y
 * membresía de identidad, empresa, tenant), por eso es un puerto con adaptador y no un repositorio de un
 * módulo (mismo molde que `CargaDeAutorizacion`).
 */
export interface LecturasDeSesion {
  /** La persona ACTIVA vinculada con el usuario; `null` si no hay vínculo o está suspendida. */
  personaDelUsuario(usuario: UsuarioAuthId): Promise<PersonaId | null>;
  /**
   * Las empresas donde esa persona tiene una membresía ACTIVA, de los tenants de la marca indicada (la
   * que resolvió el servidor desde el host: nunca las de otra marca). Sin orden garantizado.
   */
  empresasDelUsuario(
    usuario: UsuarioAuthId,
    marca: MarcaComercialId,
  ): Promise<readonly EmpresaDeLaSesion[]>;
}
