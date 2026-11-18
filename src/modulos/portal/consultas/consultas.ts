import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { empresaId } from "../../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia, Transacciones } from "../../../puertos/transacciones";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Portal } from "../casos-de-uso/contrato";
import type { RepositorioDePortales } from "../persistencia/repositorio-de-portales";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type TxDeConsultasDePortal = Readonly<{
  autorizacion: CargaDeAutorizacion;
  portales: Pick<RepositorioDePortales, "delaEmpresa">;
}>;

export type DependenciasDeConsultasDePortal = Readonly<{
  transacciones: Transacciones<TxDeConsultasDePortal>;
  reglas: ReglasDeEmpresa;
}>;

/** El portal tal como lo ve quien lo administra. La dirección completa (el host) la arma la pantalla con el de la marca. */
export type PortalParaAdministrar = Readonly<{ portal: Portal; rutaPublica: string }>;

/**
 * Las consultas del portal, de solo lectura: piden `vidrieras.ver` (los tres roles: el operador solo ve; guardar exige `vidrieras.administrar_portal` y alcance total).
 * Lo de otra empresa no se ve nunca: el repositorio filtra por la empresa del contexto y la base por RLS.
 */
export function crearConsultasDePortal(d: DependenciasDeConsultasDePortal) {
  return {
    /** El portal de la empresa del contexto (o `null` si todavía no lo creó). */
    verPortalDeLaEmpresa(
      contexto: ContextoOperativo,
    ): Promise<Resultado<PortalParaAdministrar | null, MotivoDeRechazo | ErrorDePersistencia>> {
      return d.transacciones.ejecutar(
        { contexto, aislamiento: "read committed", soloLectura: true },
        async (tx) => {
          const permiso = await exigirAccion(
            d.reglas,
            DECLARACIONES_DE_CONSULTAS.verPortalDeLaEmpresa.accion,
            () => tx.autorizacion.delActor(contexto),
          );
          if (!permiso.ok) return permiso;
          const portal = await tx.portales.delaEmpresa(empresaId(contexto.empresaId));
          return ok(portal === null ? null : { portal, rutaPublica: `/s/portal/${portal.codigo}` });
        },
      );
    },
  };
}

export type ConsultasDePortal = ReturnType<typeof crearConsultasDePortal>;
