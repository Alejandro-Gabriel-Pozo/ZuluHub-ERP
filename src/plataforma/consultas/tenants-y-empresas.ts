import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import { estadoEfectivo, type EstadoDeEmpresa, type EstadoEfectivo } from "../../contexto/estados";
import { TRANSICIONES_DE_EMPRESA } from "../../modulos/empresas/publico";
import { esClaveDe } from "../../capacidades/modulos/activos";
import { tenantId, type TenantId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import { vistaDeAlta, type VistaDeAlta } from "../dominio/soporte/altas";
import {
  paginaValida,
  resultadoDePagina,
  uuidDesdeTexto,
  type EntradaDePagina,
  type ErrorDePagina,
  type ResultadoDePagina,
} from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type { DependenciasDeConsultasDePlataforma, FilaDeEmpresa, FilaDeTenant } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA as D } from "./declaraciones";

const LECTURA = { aislamiento: "read committed", soloLectura: true } as const;

export type ErrorAlListarTenants = MotivoDeRechazo | ErrorDePagina | ErrorDePersistencia;

/** Los tenants con su estado (§B.5.9, nivel 1). `tenants.ver`, solo lectura, página por id. */
export function armarListarTenants({ transacciones, reglas }: DependenciasDeConsultasDePlataforma) {
  return async function listarTenants(
    contexto: ContextoDePlataforma,
    entrada: EntradaDePagina,
  ): Promise<Resultado<ResultadoDePagina<FilaDeTenant>, ErrorAlListarTenants>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (
        tx,
      ): Promise<Resultado<ResultadoDePagina<FilaDeTenant>, MotivoDeRechazo | ErrorDePagina>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.listarTenants.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const pagina = paginaValida(entrada, "UUID");
        if (!pagina.ok) return pagina;
        const filas = await tx.soporte.listarTenants(pagina.valor);
        return ok(resultadoDePagina(filas, pagina.valor, (f) => f.id));
      },
    );
  };
}

export type EntradaDeListarEmpresas = EntradaDePagina &
  Readonly<{
    /** Solo las empresas de ese tenant. */
    tenantId?: string | undefined;
    /** Solo las empresas en ese estado. */
    estado?: string | undefined;
  }>;

/** Una empresa con su estado efectivo (el que combina el suyo con el de su tenant). */
export type VistaDeEmpresa = FilaDeEmpresa & Readonly<{ estadoEfectivo: EstadoEfectivo }>;

export type ErrorAlListarEmpresas =
  MotivoDeRechazo | ErrorDePagina | "ID_INVALIDO" | "ESTADO_INVALIDO" | ErrorDePersistencia;

const conEstadoEfectivo = (fila: FilaDeEmpresa): VistaDeEmpresa => ({
  ...fila,
  estadoEfectivo: estadoEfectivo(fila.estadoDelTenant, fila.estado),
});

/** Las empresas con su estado y su estado efectivo (§B.5.9, nivel 1). `empresas.ver`. */
export function armarListarEmpresas({
  transacciones,
  reglas,
}: DependenciasDeConsultasDePlataforma) {
  return async function listarEmpresas(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeListarEmpresas,
  ): Promise<Resultado<ResultadoDePagina<VistaDeEmpresa>, ErrorAlListarEmpresas>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (
        tx,
      ): Promise<
        Resultado<
          ResultadoDePagina<VistaDeEmpresa>,
          Exclude<ErrorAlListarEmpresas, ErrorDePersistencia>
        >
      > => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.listarEmpresas.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const pagina = paginaValida(entrada, "UUID");
        if (!pagina.ok) return pagina;
        let tenant: TenantId | null = null;
        if (entrada.tenantId !== undefined) {
          const id = uuidDesdeTexto(entrada.tenantId);
          if (!id.ok) return id;
          tenant = tenantId(id.valor);
        }
        let estado: EstadoDeEmpresa | null = null;
        if (entrada.estado !== undefined) {
          if (!esClaveDe(TRANSICIONES_DE_EMPRESA, entrada.estado)) return err("ESTADO_INVALIDO");
          estado = entrada.estado;
        }
        const filas = await tx.soporte.listarEmpresas({ tenantId: tenant, estado }, pagina.valor);
        return ok(resultadoDePagina(filas.map(conEstadoEfectivo), pagina.valor, (f) => f.id));
      },
    );
  };
}

export type ErrorAlListarAltasPendientes = MotivoDeRechazo | ErrorDePagina | ErrorDePersistencia;

/**
 * Las altas que siguen pendientes (empresas en `PROVISIONING`): cómo está la invitación del gerente
 * (vigente, vencida, sin invitación…) y cuántas horas faltan para que venza el alta (§B.5.9, nivel 1).
 * `empresas.ver`. La hora sale del contexto.
 */
export function armarListarAltasPendientes({
  transacciones,
  reglas,
}: DependenciasDeConsultasDePlataforma) {
  return async function listarAltasPendientes(
    contexto: ContextoDePlataforma,
    entrada: EntradaDePagina,
  ): Promise<Resultado<ResultadoDePagina<VistaDeAlta>, ErrorAlListarAltasPendientes>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (
        tx,
      ): Promise<Resultado<ResultadoDePagina<VistaDeAlta>, MotivoDeRechazo | ErrorDePagina>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.listarAltasPendientes.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const pagina = paginaValida(entrada, "UUID");
        if (!pagina.ok) return pagina;
        const altas = await tx.soporte.listarAltasPendientes(pagina.valor);
        const vistas = altas.map(({ empresa, invitacion }) =>
          vistaDeAlta(empresa, invitacion, contexto.ahora),
        );
        return ok(resultadoDePagina(vistas, pagina.valor, (v) => v.empresaId));
      },
    );
  };
}
