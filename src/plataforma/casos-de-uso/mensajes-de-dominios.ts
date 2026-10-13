import type { ErrorAlAgregarDominio } from "./agregar-dominio";
import type { ErrorAlCambiarDominio } from "./cambiar-estado-de-dominio";

/**
 * El texto para la persona de cada error de los casos de dominios (M4a), en castellano rioplatense. Dice
 * QUÉ pasó y QUÉ hacer, sin nombres de tablas, restricciones ni datos de otros clientes: lo técnico queda
 * en el código del error y en la referencia de error que soporte busca. Los textos no llevan el host ni
 * ningún dato del pedido (así tampoco filtran de quién es un host ocupado). Un mapa total por tipo: un
 * error nuevo sin texto no compila.
 */

export type ErrorDeDominiosParaMostrar = ErrorAlAgregarDominio | ErrorAlCambiarDominio;

const NO_SE_PUDO =
  "No se pudo completar la operación. Probá de nuevo y, si sigue pasando, avisá a soporte con el código de referencia.";
const SIN_PERMISO = "No tenés permiso para hacer esto.";

/** Los errores de negocio, uno por uno. */
export const MENSAJES_DE_ERROR_DE_DOMINIOS = {
  SIN_PERMISO,
  MODULO_EN_DESARROLLO: "Esta función todavía no está disponible.",
  MODULO_NO_ACTIVO: "Esta función todavía no está disponible.",
  MODULO_EN_SOLO_LECTURA: "Esta función todavía no está disponible.",
  SIN_CAPACIDAD: "Esta función todavía no está disponible.",
  CLAVE_DE_IDEMPOTENCIA_INVALIDA:
    "No se pudo identificar el pedido. Volvé a intentarlo desde la pantalla.",
  CLAVE_REUTILIZADA:
    "Este pedido ya se usó con otros datos. Volvé a abrir la pantalla e intentá de nuevo.",
  ID_INVALIDO: "No se encontró el elemento indicado. Revisá que el dato esté completo.",
  DOMINIO_NO_ENCONTRADO: "No se encontró ese dominio. Puede que ya no exista: actualizá la lista.",
  HOST_INVALIDO:
    "El nombre del sitio no es válido. Escribilo completo, sin http://, sin barras y sin puerto (por ejemplo: carta.minegocio.com.ar).",
  SUPERFICIE_INVALIDA: "Elegí qué se muestra en el sitio: aplicación, carta, landing o consola.",
  TITULAR_INVALIDO: "Elegí quién es el titular del dominio: el cliente o el operador.",
  SUPERFICIE_NO_ADMITIDA_PARA_EMPRESA:
    "Un sitio propio de una empresa solo puede mostrar su aplicación o su carta.",
  CANONICO_SOLO_DE_MARCA: "Solo el sitio de una marca puede ser el principal para sus enlaces.",
  HOST_DUPLICADO:
    "Ese nombre de sitio ya está registrado. Si es de un cliente que se fue, primero hay que retirar el dominio anterior.",
  YA_TIENE_CANONICO:
    "Esa marca ya tiene un sitio principal para esa superficie. El principal no se cambia desde acá.",
  MARCA_NO_ENCONTRADA: "No se encontró la marca indicada.",
  MARCA_RETIRADA: "La marca está retirada y no admite dominios nuevos.",
  EMPRESA_NO_ENCONTRADA: "No se encontró la empresa indicada.",
  FECHA_DE_VERIFICACION_INVALIDA:
    "La fecha de la verificación no es válida: no puede ser futura ni estar vacía.",
  FECHA_DE_VERIFICACION_INMUTABLE:
    "El dominio ya fue verificado y la fecha no se puede cambiar. Actualizá la pantalla.",
  MOTIVO_OBLIGATORIO: "Para retirar un dominio hay que escribir el motivo.",
  MOTIVO_DEMASIADO_LARGO: "El motivo es demasiado largo. Resumilo en pocas líneas.",
  DOMINIO_RETIRADO:
    "Ese dominio ya está retirado y no se puede modificar. Si hace falta, registrá el nombre de nuevo.",
  DOMINIO_SIN_VERIFICAR: "Primero hay que verificar el dominio para poder activarlo.",
  DOMINIO_CANONICO:
    "Ese es el sitio principal de la marca y no se puede retirar. Desactivalo o consultá con soporte.",
  TRANSICION_DE_DOMINIO_INVALIDA:
    "El dominio cambió mientras lo editabas y esa acción ya no corresponde. Actualizá la pantalla.",
} as const satisfies Readonly<
  Record<Exclude<ErrorDeDominiosParaMostrar, { tipo: string }>, string>
>;

/** El texto de cualquier error de un caso de dominios, incluidos los de la base, sin filtrar nada técnico. */
export function mensajeDeErrorDeDominios(error: ErrorDeDominiosParaMostrar): string {
  if (typeof error === "string") return MENSAJES_DE_ERROR_DE_DOMINIOS[error];
  switch (error.tipo) {
    case "AccesoDenegado":
      return SIN_PERMISO;
    case "ConcurrenciaAgotada":
      return "Había mucha actividad al mismo tiempo y no se pudo completar. Probá de nuevo en unos segundos.";
    case "Unicidad":
    case "Superposicion":
    case "Referencia":
    case "Check":
    case "Inesperado":
      return NO_SE_PUDO;
  }
}
