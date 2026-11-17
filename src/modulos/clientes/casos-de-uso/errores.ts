import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeCampoDeParte } from "../dominio/datos-de-parte";

/**
 * Los errores con nombre de los comandos del directorio (E9 §3.1): lista cerrada de TODO el módulo; cada comando devuelve un subconjunto y su
 * contrato público es el que documenta su caso de uso. Los de la base (restricciones) se traducen con `ERRORES_DE_CLIENTES_POR_RESTRICCION`.
 */
export type ErrorDeClientes =
  | ErrorDeAlcance
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDePersistencia
  | "IDENTIFICADOR_INVALIDO"
  | "CLAVE_REUTILIZADA"
  | "PARTE_NO_ENCONTRADA"
  | "VERSION_DESACTUALIZADA"
  | "ROL_DE_PARTE_INVALIDO"
  | "TIPO_DE_VINCULO_INVALIDO"
  | "VINCULO_CONSIGO_MISMA"
  | "CONTACTO_DEBE_SER_HUMANA"
  | "VINCULO_DEBE_SER_CON_EMPRESA"
  | "CARGO_INVALIDO"
  | "PARTE_CON_VINCULOS"
  | "CURSOR_INVALIDO"
  /** El documento ya es de otra parte activa de la empresa. `parteId` es `null` solo si lo dijo la base (la red de seguridad), que no sabe con quién choca. */
  | Readonly<{ error: "DOCUMENTO_YA_REGISTRADO"; parteId: string | null }>
  /** El documento es de una parte desactivada: se reactiva, no se duplica. */
  | Readonly<{ error: "PARTE_INACTIVA_CON_ESE_DOCUMENTO"; parteId: string }>
  /** Datos inválidos: un código por campo, todos juntos. */
  | Readonly<{ error: "DATOS_INVALIDOS"; campos: readonly ErrorDeCampoDeParte[] }>;
