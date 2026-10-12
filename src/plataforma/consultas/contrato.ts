import type { CatalogoComercial } from "../../capacidades/modulos/catalogo";
import type { ReglasDePlataforma } from "../../capacidades/permisos/plataforma";
import type { RolDeEmpresa } from "../../capacidades/permisos/roles";
import type { EstadoDeEmpresa, EstadoDeTenant, EstadosDeEmpresa } from "../../contexto/estados";
import type { EstadoGuardado, Invitacion, Persona } from "../../modulos/identidad/publico";
import type {
  EmpresaId,
  InvitacionId,
  PersonaId,
  TenantId,
} from "../../primitivas/identificadores/marca";
import type { CargaDeAutorizacionDePlataforma } from "../../puertos/autorizacion-de-plataforma";
import type { Dato } from "../../puertos/sin-secretos";
import type { Transacciones } from "../../puertos/transacciones";
import type { Pagina } from "../dominio/soporte/consulta";

/**
 * Lo que la plataforma LEE para el soporte (H5 §B.5.9): una interfaz de solo lectura, con tipos de
 * lectura y nada más. La implementa `adaptadores/postgres/soporte-de-plataforma.ts` con el rol de
 * plataforma, que NO tiene permiso sobre las tablas operativas: `sucursal`, `asignacion_sucursal`,
 * `invitacion_sucursal`, `auditoria_empresa`. Ninguna de estas lecturas las toca, ni devuelve el hash
 * de ningún token.
 *
 * Todas las listas se devuelven ordenadas por id, de a `limite` renglones desde `despuesDeId`
 * (exclusivo): una página estable, aunque lleguen renglones nuevos.
 */

export type FilaDeTenant = Readonly<{
  id: TenantId;
  nombre: string;
  estado: EstadoDeTenant;
  motivoEstado: string | null;
  creadoEn: Date;
}>;

export type FilaDeEmpresa = Readonly<{
  id: EmpresaId;
  tenantId: TenantId;
  cuit: string;
  razonSocial: string;
  estado: EstadoDeEmpresa;
  motivoEstado: string | null;
  /** El estado del tenant dueño: junto con el de la empresa da el estado efectivo. */
  estadoDelTenant: EstadoDeTenant;
  zonaHoraria: string;
  moneda: string;
  creadoEn: Date;
}>;

export type FiltroDeEmpresas = Readonly<{
  tenantId: TenantId | null;
  estado: EstadoDeEmpresa | null;
}>;

export type FiltroDeInvitaciones = Readonly<{
  tenantId: TenantId | null;
  empresaId: EmpresaId | null;
  estado: EstadoGuardado | null;
}>;

/** Un trabajo fallido, tal como lo ve soporte: sin la clave de idempotencia ni nada de la cola interna. */
export type FilaDeTrabajoFallido = Readonly<{
  id: string;
  tipo: string;
  /** `null`: trabajo del ámbito plataforma. */
  empresaId: EmpresaId | null;
  intentos: number;
  ultimoError: string | null;
  datos: Dato;
  creadoEn: Date;
  actualizadoEn: Date;
}>;

export type FiltroDeAuditoria = Readonly<{
  entidad: string | null;
  entidadId: string | null;
  /** Inclusivo. */
  desde: Date | null;
  /** Inclusivo. */
  hasta: Date | null;
}>;

/** Un renglón de la auditoría de plataforma. `id` es un entero de la base, como texto. */
export type FilaDeAuditoria = Readonly<{
  id: string;
  actor: string;
  accion: string;
  entidad: string;
  entidadId: string;
  antes: Dato;
  despues: Dato;
  creadoEn: Date;
}>;

/** Una referencia de error registrada: el motivo tipado, sin ningún dato de negocio. */
export type FilaDeReferencia = Readonly<{
  referencia: string;
  accion: string;
  motivo: string;
  empresaId: EmpresaId | null;
  personaId: PersonaId | null;
  creadoEn: Date;
}>;

/**
 * La membresía de una persona en una empresa tal como la ve la plataforma: SOLO las cuatro columnas
 * que el rol de plataforma puede leer (decisión F1). Sin versión, sin fechas, sin invitación.
 */
export type MembresiaVisible = Readonly<{
  empresaId: EmpresaId;
  personaId: PersonaId;
  rol: RolDeEmpresa;
  activo: boolean;
}>;

/** Las listas de nivel 1 y la búsqueda de referencias. */
export interface LecturaDeNivel1 {
  listarTenants(pagina: Pagina): Promise<FilaDeTenant[]>;
  listarEmpresas(filtro: FiltroDeEmpresas, pagina: Pagina): Promise<FilaDeEmpresa[]>;
  /** Las empresas que siguen en `PROVISIONING`, con la ÚLTIMA invitación de su alta (`null`: ninguna). */
  listarAltasPendientes(
    pagina: Pagina,
  ): Promise<Array<Readonly<{ empresa: FilaDeEmpresa; invitacion: Invitacion | null }>>>;
  /** Cabeceras y empresas de las invitaciones, sin sucursales y sin el hash del token. */
  listarInvitaciones(filtro: FiltroDeInvitaciones, pagina: Pagina): Promise<Invitacion[]>;
  listarTrabajosFallidos(pagina: Pagina): Promise<FilaDeTrabajoFallido[]>;
  consultarAuditoria(filtro: FiltroDeAuditoria, pagina: Pagina): Promise<FilaDeAuditoria[]>;
  /** Todas las referencias con ese código (normalmente una; dos o más si colisionaron), de la más vieja a la nueva. */
  buscarReferencias(referencia: string): Promise<FilaDeReferencia[]>;
}

/** Los hechos que lee «explicar por qué»: identidad y estados, nunca datos operativos. */
export interface LecturaParaExplicar {
  /** El estado de cada empresa pedida y el de su tenant; las que no existen no aparecen. */
  estadosDeEmpresas(empresas: readonly EmpresaId[]): Promise<EstadosDeEmpresa>;
  personaPorEmail(email: string): Promise<Persona | null>;
  personaPorId(id: PersonaId): Promise<Persona | null>;
  /** Las membresías de la persona (activas o apagadas) en esas empresas. */
  membresiasDe(persona: PersonaId, empresas: readonly EmpresaId[]): Promise<MembresiaVisible[]>;
  /** Una invitación con sus empresas, sin sucursales y sin el hash del token; `null` si no existe. */
  invitacionPorId(id: InvitacionId): Promise<Invitacion | null>;
  /** Módulos activables que la empresa activó. Hoy ninguno: no existe la tabla (como en `autorizacion`). */
  modulosActivadosDe(empresa: EmpresaId): Promise<readonly string[]>;
}

/** Todo lo que el adaptador de lectura de soporte ofrece. */
export type LecturaDeSoporte = LecturaDeNivel1 & LecturaParaExplicar;

/**
 * Lo que recibe el trabajo de una consulta de soporte: la lectura y la carga del administrador.
 * No hay auditoría, ni trabajos, ni idempotencia: por tipos, una consulta no escribe.
 */
export type TxDeConsultasDePlataforma = Readonly<{
  soporte: LecturaDeNivel1;
  autorizacionDePlataforma: CargaDeAutorizacionDePlataforma;
}>;

export type DependenciasDeConsultasDePlataforma = Readonly<{
  transacciones: Transacciones<TxDeConsultasDePlataforma>;
  /** El catálogo y la matriz de plataforma con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDePlataforma;
  /**
   * El catálogo comercial de módulos de las empresas (`capacidades/modulos/catalogo.ts`): es lo que
   * muestra «configuración», porque todavía no hay planes ni módulos activables por empresa (decisión
   * 19). Lo inyecta la composición; la matriz de roles de empresa NO se importa desde plataforma.
   */
  catalogoDeEmpresa: CatalogoComercial;
}>;
