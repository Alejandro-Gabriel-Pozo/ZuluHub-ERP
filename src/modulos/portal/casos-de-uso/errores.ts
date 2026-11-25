import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDePortal } from "../dominio/portal";

/** Los errores con nombre de los comandos del portal. Los de la base (restricciones) se traducen con `ERRORES_DE_PORTAL_POR_RESTRICCION`. */
export type ErrorDeGuardarPortal =
  | ErrorDePortal
  | ErrorDeAlcance
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDePersistencia
  | "ID_REUTILIZADO"
  | "VERSION_DESACTUALIZADA"
  | "PORTAL_YA_EXISTE"
  | "CODIGO_DE_PORTAL_INVALIDO"
  | "CODIGO_DE_PORTAL_REPETIDO";
