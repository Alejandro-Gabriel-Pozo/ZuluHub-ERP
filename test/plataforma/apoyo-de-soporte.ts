import { decidirConsulta, huellaCanonica } from "../../src/adaptadores/postgres/huella-canonica";
import type { RolDePlataforma } from "../../src/capacidades/permisos/plataforma";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import type { EstadoDeEmpresa, EstadoDeTenant, EstadosDeEmpresa } from "../../src/contexto/estados";
import {
  emailDesdeTexto,
  type Invitacion,
  type Persona,
} from "../../src/modulos/identidad/publico";
import type {
  AjusteDeUnTenant,
  FilaDeAuditoria,
  FilaDeEmpresa,
  FilaDeEmpresaAmpliada,
  FilaDeReferencia,
  FilaDeTenant,
  FilaDeTrabajoFallido,
  LecturaDeSoporte,
  MembresiaVisible,
} from "../../src/plataforma/consultas/contrato";
import {
  adminPlataformaId,
  empresaId,
  marcaComercialId,
  personaId,
  planId,
  tenantId,
  versionDePlanId,
  type EmpresaId,
} from "../../src/primitivas/identificadores/marca";
import type {
  AuditoriaDePlataforma,
  RegistroDeAuditoriaDePlataforma,
} from "../../src/puertos/auditoria-de-plataforma";
import type { CargaDeAutorizacionDePlataforma } from "../../src/puertos/autorizacion-de-plataforma";
import type { FilaDeIdempotencia } from "../../src/adaptadores/postgres/huella-canonica";
import type { IdempotenciaDePlataforma } from "../../src/puertos/idempotencia";
import type { Dato } from "../../src/puertos/sin-secretos";
import type { OpcionesDeTransaccion, Transacciones } from "../../src/puertos/transacciones";

/**
 * Apoyo de las pruebas SIN base de datos de las consultas y los casos de uso de soporte de plataforma
 * (H5 P6): una transacción de mentira que solo registra cómo se la pidió, un administrador de
 * mentira, una lectura de mentira que registra cada pedido, y una auditoría y una idempotencia en
 * memoria con la MISMA decisión que las de Postgres.
 */

const ADMIN_ID = adminPlataformaId("aaaaaaaa-0000-4000-8000-000000000001");
export const AHORA = new Date("2026-10-11T12:00:00Z");

export const comoAdministrador: ContextoDePlataforma = {
  tipo: "PLATAFORMA",
  actor: { tipo: "ADMIN", id: ADMIN_ID },
  ahora: AHORA,
};

export function conRol(rol: RolDePlataforma | null): CargaDeAutorizacionDePlataforma {
  return { delActor: () => Promise.resolve({ rol }) };
}

/** Una transacción que corre el trabajo con `tx` y guarda con qué opciones se la pidió. */
export function transaccionesDe<Tx>(tx: Tx): Transacciones<Tx> & {
  readonly pedidas: OpcionesDeTransaccion[];
} {
  const pedidas: OpcionesDeTransaccion[] = [];
  return {
    pedidas,
    ejecutar: (opciones, trabajo) => {
      pedidas.push(opciones);
      return trabajo(tx);
    },
  };
}

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const emailDePrueba = (texto: string) => {
  const r = emailDesdeTexto(texto);
  if (!r.ok) throw new Error(`email de prueba inválido: ${texto}`);
  return r.valor;
};

export const personaDePrueba = (
  n: number,
  activoGlobal = true,
  email = `p${n}@x.test`,
): Persona => ({
  id: personaId(uuid(n)),
  email: emailDePrueba(email),
  activoGlobal,
});

export const filaDeEmpresa = (
  n: number,
  estado: EstadoDeEmpresa = "ACTIVE",
  estadoDelTenant: EstadoDeTenant = "ACTIVE",
): FilaDeEmpresa => ({
  id: empresaId(uuid(n)),
  tenantId: tenantId(uuid(900 + n)),
  cuit: "20123456786",
  razonSocial: `Empresa ${n}`,
  estado,
  motivoEstado: null,
  estadoDelTenant,
  zonaHoraria: "America/Argentina/Buenos_Aires",
  moneda: "ARS",
  creadoEn: new Date("2026-10-10T00:00:00Z"),
});

/** La marca de los tenants de prueba. */
export const MARCA_DE_PRUEBA = {
  marcaId: marcaComercialId(uuid(7001)),
  marcaCodigo: "marca-de-prueba",
  marcaNombreVisible: "Marca de Prueba" as string | null,
};

/** Un plan vigente de prueba (versión 3 de `plan-pro`, con una asignación programada). */
export const PLAN_DE_PRUEBA = {
  planId: planId(uuid(7002)),
  versionDePlanId: versionDePlanId(uuid(7003)),
  planCodigo: "plan-pro",
  planNombreComercial: "Plan Pro",
  planVersionNumero: 3,
  planProgramado: true,
};

/** Un tenant sin ninguna asignación que haya empezado: todo lo del plan en nulo. */
export const SIN_PLAN_VIGENTE = {
  planId: null,
  versionDePlanId: null,
  planCodigo: null,
  planNombreComercial: null,
  planVersionNumero: null,
  planProgramado: false,
};

export const filaDeEmpresaAmpliada = (
  n: number,
  estado: EstadoDeEmpresa = "ACTIVE",
  estadoDelTenant: EstadoDeTenant = "ACTIVE",
): FilaDeEmpresaAmpliada => ({
  ...filaDeEmpresa(n, estado, estadoDelTenant),
  tenantNombre: `Tenant de la empresa ${n}`,
  ...MARCA_DE_PRUEBA,
  ...PLAN_DE_PRUEBA,
});

/** Cada pedido que recibió la lectura, con sus argumentos. */
export type PedidoALaLectura = Readonly<{ metodo: string; argumentos: readonly unknown[] }>;

export type DatosDeLecturaFalsa = Partial<{
  tenants: FilaDeTenant[];
  empresas: FilaDeEmpresaAmpliada[];
  /** Las empresas de las altas pendientes (sin marca ni plan: esa lista no los pide). */
  altas: Array<{ empresa: FilaDeEmpresa; invitacion: Invitacion | null }>;
  ajustes: AjusteDeUnTenant[];
  invitaciones: Invitacion[];
  trabajos: FilaDeTrabajoFallido[];
  auditoria: FilaDeAuditoria[];
  referencias: FilaDeReferencia[];
  estados: EstadosDeEmpresa;
  personas: Persona[];
  membresias: MembresiaVisible[];
  modulosActivados: string[];
}>;

/** Una lectura en memoria que registra cada pedido. */
export function lecturaFalsa(datos: DatosDeLecturaFalsa = {}): LecturaDeSoporte & {
  readonly pedidos: PedidoALaLectura[];
} {
  const pedidos: PedidoALaLectura[] = [];
  const pedir = <T>(metodo: string, argumentos: unknown[], respuesta: T): Promise<T> => {
    pedidos.push({ metodo, argumentos });
    return Promise.resolve(respuesta);
  };
  return {
    pedidos,
    listarTenants: (...a) => pedir("listarTenants", a, datos.tenants ?? []),
    ajustesDeTenants: (...a) => pedir("ajustesDeTenants", a, datos.ajustes ?? []),
    listarEmpresas: (...a) => pedir("listarEmpresas", a, datos.empresas ?? []),
    listarAltasPendientes: (...a) => pedir("listarAltasPendientes", a, datos.altas ?? []),
    listarInvitaciones: (...a) => pedir("listarInvitaciones", a, datos.invitaciones ?? []),
    listarTrabajosFallidos: (...a) => pedir("listarTrabajosFallidos", a, datos.trabajos ?? []),
    consultarAuditoria: (...a) => pedir("consultarAuditoria", a, datos.auditoria ?? []),
    buscarReferencias: (...a) => pedir("buscarReferencias", a, datos.referencias ?? []),
    estadosDeEmpresas: (...a) => pedir("estadosDeEmpresas", a, datos.estados ?? new Map()),
    personaPorEmail: (email) =>
      pedir("personaPorEmail", [email], datos.personas?.find((p) => p.email === email) ?? null),
    personaPorId: (id) =>
      pedir("personaPorId", [id], datos.personas?.find((p) => p.id === id) ?? null),
    membresiasDe: (persona, empresas) =>
      pedir(
        "membresiasDe",
        [persona, empresas],
        (datos.membresias ?? []).filter(
          (m) => m.personaId === persona && empresas.includes(m.empresaId),
        ),
      ),
    invitacionPorId: (id) =>
      pedir("invitacionPorId", [id], datos.invitaciones?.find((i) => i.id === id) ?? null),
    modulosActivadosDe: (...a) => pedir("modulosActivadosDe", a, datos.modulosActivados ?? []),
  };
}

export const estadosDe = (
  ...empresas: ReadonlyArray<readonly [EmpresaId, EstadoDeEmpresa, EstadoDeTenant]>
): EstadosDeEmpresa =>
  new Map(empresas.map(([id, empresa, tenant]) => [id, { empresa, tenant }] as const));

export function auditoriaFalsa(): AuditoriaDePlataforma & {
  readonly registros: RegistroDeAuditoriaDePlataforma[];
} {
  const registros: RegistroDeAuditoriaDePlataforma[] = [];
  return {
    registros,
    registrar: (registro) => {
      registros.push(registro);
      return Promise.resolve();
    },
  };
}

/** Idempotencia en memoria, con la misma huella y la misma decisión que el adaptador de Postgres. */
export function idempotenciaFalsa(): IdempotenciaDePlataforma & {
  readonly guardadas: Map<string, FilaDeIdempotencia>;
} {
  const guardadas = new Map<string, FilaDeIdempotencia>();
  return {
    guardadas,
    consultar: (operacion, clave, entrada) =>
      Promise.resolve(
        decidirConsulta(guardadas.get(clave) ?? null, operacion, huellaCanonica(entrada)),
      ),
    registrar: (operacion, clave, entrada, resultado: Dato) => {
      if (guardadas.has(clave)) return Promise.reject(new Error("clave repetida"));
      guardadas.set(clave, { operacion, huella: huellaCanonica(entrada), resultado });
      return Promise.resolve();
    },
  };
}
