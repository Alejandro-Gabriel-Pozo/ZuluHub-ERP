import { esClaveDe } from "../../capacidades/modulos/activos";
import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  TRANSICIONES_DE_INVITACION,
  estadoDeInvitacion,
  type EstadoDeInvitacion,
  type EstadoGuardado,
  type Invitacion,
} from "../../modulos/identidad/publico";
import {
  empresaId,
  tenantId,
  type EmpresaId,
  type TenantId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import {
  paginaValida,
  resultadoDePagina,
  uuidDesdeTexto,
  type EntradaDePagina,
  type ErrorDePagina,
  type ResultadoDePagina,
} from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type { DependenciasDeConsultasDePlataforma } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA as D } from "./declaraciones";

export type EntradaDeListarInvitaciones = EntradaDePagina &
  Readonly<{
    tenantId?: string | undefined;
    empresaId?: string | undefined;
    /** El estado guardado: `PENDIENTE`, `ACEPTADA` o `REVOCADA` (`VENCIDA` se calcula, no se guarda). */
    estado?: string | undefined;
  }>;

/**
 * Una invitación como la ve soporte: sin el hash del token (que ni se lee) y sin sucursales. `estado` es
 * el que se guarda y `estadoEfectivo` el que resulta con la hora del contexto (`VENCIDA` si ya pasó).
 */
export type VistaDeInvitacion = Readonly<{
  id: Invitacion["id"];
  tenantId: TenantId;
  tipo: Invitacion["tipo"];
  email: string;
  estado: EstadoGuardado;
  estadoEfectivo: EstadoDeInvitacion;
  emitidaEn: Date;
  venceEn: Date;
  empresas: readonly Readonly<{ empresaId: EmpresaId; rol: string }>[];
  aceptadaPor: Invitacion["aceptadaPor"];
  reemplazadaPor: Invitacion["reemplazadaPor"];
}>;

export type ErrorAlListarInvitaciones =
  MotivoDeRechazo | ErrorDePagina | "ID_INVALIDO" | "ESTADO_INVALIDO" | ErrorDePersistencia;

/** Las invitaciones, con filtros opcionales por tenant, empresa y estado (§B.5.9, nivel 1). `invitaciones.ver`. */
export function armarListarInvitaciones({
  transacciones,
  reglas,
}: DependenciasDeConsultasDePlataforma) {
  return async function listarInvitaciones(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeListarInvitaciones,
  ): Promise<Resultado<ResultadoDePagina<VistaDeInvitacion>, ErrorAlListarInvitaciones>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<
          ResultadoDePagina<VistaDeInvitacion>,
          Exclude<ErrorAlListarInvitaciones, ErrorDePersistencia>
        >
      > => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.listarInvitaciones.accion,
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
        let empresa: EmpresaId | null = null;
        if (entrada.empresaId !== undefined) {
          const id = uuidDesdeTexto(entrada.empresaId);
          if (!id.ok) return id;
          empresa = empresaId(id.valor);
        }
        let estado: EstadoGuardado | null = null;
        if (entrada.estado !== undefined) {
          if (!esClaveDe(TRANSICIONES_DE_INVITACION, entrada.estado)) return err("ESTADO_INVALIDO");
          estado = entrada.estado;
        }
        const invitaciones = await tx.soporte.listarInvitaciones(
          { tenantId: tenant, empresaId: empresa, estado },
          pagina.valor,
        );
        const vistas = invitaciones.map((i): VistaDeInvitacion => ({
          id: i.id,
          tenantId: i.tenantId,
          tipo: i.tipo,
          email: i.email,
          estado: i.estado,
          estadoEfectivo: estadoDeInvitacion(i, contexto.ahora),
          emitidaEn: i.emitidaEn,
          venceEn: i.venceEn,
          empresas: i.empresas.map((e) => ({ empresaId: e.empresaId, rol: e.rol })),
          aceptadaPor: i.aceptadaPor,
          reemplazadaPor: i.reemplazadaPor,
        }));
        return ok(resultadoDePagina(vistas, pagina.valor, (v) => v.id));
      },
    );
  };
}
