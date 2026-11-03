import type { CodigoFiscal } from "../capacidades/experiencia/respuesta-fiscal";
import type { MotivoDeRechazo } from "../capacidades/permisos/guard";
import type { EmpresaNoOpera } from "../contexto/estados";
import type {
  ErrorAlCargarCertificadoDeUso,
  ErrorAlGenerarPedido,
} from "../modulos/fiscal/publico";
import type { ErrorDePersistencia } from "../puertos/transacciones";

/**
 * Un error de negocio de la configuración fiscal que NO tiene todavía un texto aprobado por el dueño (la regla del repositorio:
 * sin fuente verificable no se agrega un texto). Hasta que lo tenga sale como un error inesperado, con su referencia `PD-…`, y el
 * código queda en el registro del servidor (soporte lo ve ahí). Sumarle su código público es: una línea acá, su clave en
 * `respuesta-fiscal.ts` y su texto en el catálogo. Previene: inventar el cartel que ve el cliente por un error que no se decidió.
 */
export const SIN_TEXTO_APROBADO = "SIN_TEXTO_APROBADO";

/** Los errores de negocio de generar el pedido de un certificado y de cargar el que devolvió ARCA (sin los del guard ni la base). */
export type ErrorDeCertificado = Exclude<
  ErrorAlGenerarPedido | ErrorAlCargarCertificadoDeUso,
  MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia
>;

/** Los que ya tienen su traducción en `errores-fiscales.ts` (se reusa lo aprobado): acá no se repiten. */
type YaTraducido = "ID_INVALIDO" | "EMISOR_NO_ENCONTRADO" | "EMISOR_INACTIVO" | "CLAVE_REUTILIZADA";

/**
 * El certificado de ARCA (`certificados.gestionar`), tercer tema de la pantalla de Configuración fiscal. Reusa lo ya aprobado
 * (`YaTraducido`; ojo: el texto de `FISCAL_PEDIDO_REPETIDO` habla de «comprobante»: pregunta pendiente al dueño). El resto NO tiene
 * texto aprobado y no se inventa: sale como error inesperado con su referencia `PD-…` y el código en el registro del servidor. Son
 * los que la persona SÍ puede provocar (un alias o un CUIT mal escritos, un certificado que no es el del pedido, que venció o cuya
 * cadena no cierra, o un pedido que ya tiene su certificado): hay que preguntarlos al dueño antes de abrir la pantalla.
 * Exhaustiva por tipo: un error nuevo de estos casos de uso que nadie tradujo NO COMPILA.
 */
export const ERRORES_DE_CERTIFICADO: Readonly<
  Record<
    Exclude<Extract<ErrorDeCertificado, string>, YaTraducido>,
    CodigoFiscal | typeof SIN_TEXTO_APROBADO | null
  >
> = {
  ALIAS_INVALIDO: SIN_TEXTO_APROBADO,
  CUIT_INVALIDO: SIN_TEXTO_APROBADO,
  ORGANIZACION_INVALIDA: SIN_TEXTO_APROBADO,
  CERTIFICADO_ILEGIBLE: SIN_TEXTO_APROBADO,
  NO_CORRESPONDE_A_LA_CLAVE: SIN_TEXTO_APROBADO,
  NO_CORRESPONDE_AL_TITULAR: SIN_TEXTO_APROBADO,
  CADENA_NO_CONFIABLE: SIN_TEXTO_APROBADO,
  CERTIFICADO_VENCIDO: SIN_TEXTO_APROBADO,
  PEDIDO_NO_PENDIENTE: SIN_TEXTO_APROBADO,
  CERTIFICADO_YA_CARGADO: SIN_TEXTO_APROBADO,
  // Como `EMISOR_NO_ENCONTRADO`: la pantalla solo ofrece pedidos que existen y son de la empresa (uno de otra empresa se dice igual).
  CERTIFICADO_NO_ENCONTRADO: SIN_TEXTO_APROBADO,
  // La clave guardada no se descifra (clave maestra equivocada o fila alterada): no es culpa de lo pegado y la persona no puede
  // corregirlo, es un defecto del servidor.
  CLAVE_ILEGIBLE: null,
};
