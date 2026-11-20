import type { ErrorDeEmision, Mensaje } from "../../modulos/fiscal/publico";

/**
 * Qué significa cada código de error de ARCA para la emisión (spec H7 facturación §B.5.4 y §B.3.7). Los
 * códigos son los REALES: 500, 501, 502, 600, 601 y 602 de WSFE v4.8 (l. 291-302) y 10016 (l. 983); los
 * mensajes de ARCA viajan crudos hasta la pantalla, que es quien los traduce.
 *
 *  - 600 y 601: el token no corresponde a la firma o la CUIT representada no está en el token. ARCA no
 *    procesó el pedido: se puede reintentar cuando se arregle la autorización del servicio
 *    (a confirmar contra homologación que no consumen el número);
 *  - 500, 501 y 502: error interno de ARCA (502: «Autorizador CAE, transacción activa»). Pudo haber procesado
 *    el pedido: no se sabe, se consulta antes de reenviar;
 *  - 602: «no existen datos en nuestros registros». Es lo ÚNICO que prueba que un número no existe. El 601,
 *    que un SDK de terceros trata como «no existe», significa otra cosa;
 *  - 10016: la numeración no es la siguiente a la última autorizada. Es un rechazo normal (reenviar un número
 *    ya autorizado devuelve este error, no el CAE) y la serie lo compara con el último autorizado.
 */
export const CODIGOS_DE_TOKEN: readonly number[] = [600, 601];
export const CODIGOS_DE_INFRAESTRUCTURA: readonly number[] = [500, 501, 502];
export const CODIGO_SIN_DATOS = 602;
export const CODIGO_FUERA_DE_SECUENCIA = 10016;

export type CategoriaDeCodigo =
  "TOKEN" | "INFRAESTRUCTURA" | "SIN_DATOS" | "FUERA_DE_SECUENCIA" | "RECHAZO";

/** La categoría de un código de ARCA; todo lo que no es de infraestructura ni de token es un rechazo de negocio. */
export function categoriaDeCodigo(codigo: number): CategoriaDeCodigo {
  if (CODIGOS_DE_TOKEN.includes(codigo)) return "TOKEN";
  if (CODIGOS_DE_INFRAESTRUCTURA.includes(codigo)) return "INFRAESTRUCTURA";
  if (codigo === CODIGO_SIN_DATOS) return "SIN_DATOS";
  if (codigo === CODIGO_FUERA_DE_SECUENCIA) return "FUERA_DE_SECUENCIA";
  return "RECHAZO";
}

/** ¿Alguno de los mensajes es de esa categoría? */
export function hayCategoria(mensajes: readonly Mensaje[], categoria: CategoriaDeCodigo): boolean {
  return mensajes.some((m) => categoriaDeCodigo(m.codigo) === categoria);
}

/** «No existe» solo si HAY errores y TODOS son 602: con cualquier otro código no se sabe. */
export function soloSinDatos(mensajes: readonly Mensaje[]): boolean {
  return mensajes.length > 0 && mensajes.every((m) => categoriaDeCodigo(m.codigo) === "SIN_DATOS");
}

/** Los códigos como texto para un motivo, sin los textos de ARCA: `600, 10016`. */
export function codigosComoTexto(mensajes: readonly Mensaje[]): string {
  return mensajes.map((m) => String(m.codigo)).join(", ");
}

/** El código de una falla SOAP sin el prefijo de espacio de nombres: `ns1:coe.notAuthorized` → `coe.notAuthorized`. */
export function codigoDeFallaDeWsaa(faultcode: string): string {
  return faultcode.slice(faultcode.lastIndexOf(":") + 1);
}

/**
 * El error de emisión de una falla SOAP de WSAA (`loginCms`), por su `faultcode` sin el prefijo de espacio de
 * nombres (`ns1:coe.alreadyAuthenticated`):
 *  - `coe.alreadyAuthenticated`: ya hay un ticket vigente y WSAA no emite otro (no se insiste);
 *  - `coe.notAuthorized`: el certificado no está autorizado para el servicio;
 *  - `cms.*`: el certificado o la firma no sirven (vencido, inválido, no confiable): hay que corregir la
 *    credencial, reintentar no lo arregla;
 *  - cualquier otra (`wsaa.*`, `wsn.*`, `xml.*`, una desconocida): el servicio no está disponible, se reintenta.
 */
export function errorDeFallaDeWsaa(faultcode: string): ErrorDeEmision["codigo"] {
  const codigo = codigoDeFallaDeWsaa(faultcode);
  if (codigo === "coe.alreadyAuthenticated") return "ACCESO_YA_EMITIDO";
  if (codigo === "coe.notAuthorized") return "AUTORIZACION_DEL_SERVICIO_FALTANTE";
  if (codigo.startsWith("cms.")) return "SIN_CREDENCIAL";
  return "SERVICIO_NO_DISPONIBLE";
}

/**
 * Por qué falló un acceso o una lectura, cuando se sabe con certeza: elige el TEXTO que se muestra y nada más. El `codigo` del error sigue
 * decidiendo qué se reintenta y qué es definitivo. Se deriva del tipo del puerto (`publico.ts` de fiscal no puede crecer).
 */
export type Causa = NonNullable<ErrorDeEmision["causa"]>;

/** El error con su causa; sin causa es el mismo objeto (`exactOptionalPropertyTypes`: el campo se omite, nunca es `undefined`). */
export function conCausa(error: ErrorDeEmision, causa: Causa | null): ErrorDeEmision {
  return causa === null ? error : { ...error, causa };
}

/**
 * Lista de permitidos (igualdad exacta, nunca prefijo) de las fallas SOAP de WSAA con causa conocida; el resto es `null` y sale el texto de
 * hoy. `cms.cert.untrusted` se clasifica pero su texto no está conectado: su código viene de memoria del manual de WSAA, sin grabación.
 * Previene: que una falla propia del sistema (la firma, el reloj, el pedido mal armado) se le muestre al cliente como «ARCA no está disponible».
 */
const CAUSA_DE_FALLA_DE_WSAA: ReadonlyMap<string, Causa> = new Map<string, Causa>([
  ["cms.cert.expired", "CERTIFICADO_VENCIDO"],
  ["cms.cert.untrusted", "CERTIFICADO_NO_RECONOCIDO"],
  ["xml.generationTime.invalid", "PROBLEMA_DEL_SISTEMA"],
  ["xml.expirationTime.invalid", "PROBLEMA_DEL_SISTEMA"],
  ["xml.expirationTime.expired", "PROBLEMA_DEL_SISTEMA"],
  ["xml.bad", "PROBLEMA_DEL_SISTEMA"],
  ["xml.source.invalid", "PROBLEMA_DEL_SISTEMA"],
  ["xml.destination.invalid", "PROBLEMA_DEL_SISTEMA"],
  ["xml.version.notSupported", "PROBLEMA_DEL_SISTEMA"],
  ["wsn.notFound", "PROBLEMA_DEL_SISTEMA"],
]);

/** La causa de una falla SOAP de WSAA por su `faultcode` (con o sin prefijo de espacio de nombres); `null` si no está en la lista. */
export function causaDeFallaDeWsaa(faultcode: string): Causa | null {
  return CAUSA_DE_FALLA_DE_WSAA.get(codigoDeFallaDeWsaa(faultcode)) ?? null;
}

/** Los códigos de WSFE con causa conocida (manual WSFE v4.8, l. 296-301 y 3538-3540). */
const CAUSA_DE_CODIGO_DE_WSFE: ReadonlyMap<number, Causa> = new Map<number, Causa>([
  [601, "CUIT_NO_REPRESENTADA"],
  [11002, "PUNTO_DE_VENTA_NO_HABILITADO"],
  [11000, "PROBLEMA_DEL_SISTEMA"],
  [11001, "PROBLEMA_DEL_SISTEMA"],
]);

/** La causa de los errores de una respuesta de WSFE, SOLO si todos son el mismo código; con dos códigos distintos o uno desconocido, `null`. */
export function causaDeErroresDeWsfe(mensajes: readonly Mensaje[]): Causa | null {
  const [primero, ...resto] = mensajes;
  if (primero === undefined || resto.some((m) => m.codigo !== primero.codigo)) return null;
  return CAUSA_DE_CODIGO_DE_WSFE.get(primero.codigo) ?? null;
}
