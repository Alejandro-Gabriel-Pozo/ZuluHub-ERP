import { cuitDesdeTexto } from "../../../primitivas/identificacion-fiscal/cuit";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { normalizarAtribucion, type Atribucion } from "./atribucion";
import { CODIGOS_DE_PROVINCIA, RUBROS, type Rubro, type VersionesVigentes } from "./catalogos";

/**
 * Validación del formulario público de la solicitud de alta (alta por solicitud §3.3 paso 1 y §4.4).
 * Dominio puro, FUERA de la transacción. Es la frontera con un desconocido sin sesión: no confía en
 * nada de lo que llega, y la base repite cada forma como CHECK (defensa en profundidad).
 *
 * Qué corrige en silencio y qué rechaza: recorta los bordes, une las secuencias de espacios en uno y
 * normaliza a NFC; pasa el correo a minúsculas. Rechaza lo que no es texto visible (caracteres de
 * control, de formato —como los que invierten el sentido de lectura—, separadores de línea, sustitutos
 * sueltos) porque ese texto termina en la bandeja del dueño y en los registros. La atribución y el
 * identificador de medición nunca bloquean un envío (son datos que cualquiera puede escribir a mano).
 */

/** Lo que llega del formulario, todo texto. Lo que no se contestó llega como cadena vacía. */
export type EntradaDeFormulario = Readonly<{
  nombreContacto: string;
  correo: string;
  nombreNegocio: string;
  rubro: string;
  provincia: string;
  telefono: string;
  cuit: string;
  aceptaTerminosYPrivacidad: boolean;
  versionDeTerminos: string;
  versionDePrivacidad: string;
  medicionConsentida: boolean;
  /** La versión del aviso de medición mostrado; solo cuenta si hay consentimiento. */
  versionDeAvisoDeMedicion: string;
  idDeMedicion: string;
  /** Las claves de campaña de la dirección, tal cual llegaron. */
  atribucion: Readonly<Record<string, string | undefined>>;
}>;

/** Lo que se guarda: ya limpio y con tipos de dominio. `null` = no lo contestó. */
export type SolicitudValidada = Readonly<{
  nombreContacto: string;
  correo: string;
  nombreNegocio: string;
  rubro: Rubro;
  provincia: string | null;
  telefono: string | null;
  cuit: string | null;
  versionDeTerminos: string;
  versionDePrivacidad: string;
  medicionConsentida: boolean;
  versionDeAvisoDeMedicion: string | null;
  idDeMedicion: string | null;
  atribucion: Atribucion;
}>;

export type CampoDeFormulario =
  | "nombreContacto"
  | "correo"
  | "nombreNegocio"
  | "rubro"
  | "provincia"
  | "telefono"
  | "cuit"
  | "aceptaTerminosYPrivacidad";

export type ErrorDeFormulario =
  | Readonly<{ tipo: "PAGINA_VENCIDA" }>
  | Readonly<{ tipo: "FORMA_INVALIDA"; campos: readonly CampoDeFormulario[] }>;

export const LARGO_MAXIMO_DEL_NOMBRE_DE_CONTACTO = 80;
export const LARGO_MAXIMO_DEL_NOMBRE_DEL_NEGOCIO = 100;
export const LARGO_MAXIMO_DEL_CORREO = 254;
const LARGO_MAXIMO_DE_LA_PARTE_LOCAL = 64;

/** Control, formato, sustitutos, uso privado, sin asignar, y los separadores de línea y de párrafo. */
const NO_VISIBLE = /[\p{C}\p{Zl}\p{Zp}]/u;
const ESPACIOS_RAROS = /\p{Zs}+/gu;

/**
 * Texto de una línea para mostrar a una persona. `null` si no sirve. El largo se cuenta en caracteres
 * (puntos de código), como `char_length` de la base: un emoji cuenta uno.
 */
function textoVisible(crudo: string, maximo: number): string | null {
  const recortado = crudo.normalize("NFC").trim();
  if (NO_VISIBLE.test(recortado)) return null;
  const limpio = recortado.replace(ESPACIOS_RAROS, " ");
  const largo = [...limpio].length;
  return largo >= 1 && largo <= maximo ? limpio : null;
}

const FUERA_DE_ASCII_VISIBLE = /[^!-~]/;
const PARTE_LOCAL = /^[a-z0-9_+-]+(\.[a-z0-9_+-]+)*$/;
const ETIQUETA_DE_DOMINIO = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const SOLO_DIGITOS = /^[0-9]+$/;

/**
 * Correo en minúsculas, o `null`. A propósito más estricto que el RFC 5322: ASCII, una sola arroba,
 * partes separadas por puntos sin vacíos, dominio con al menos dos etiquetas y cuya última etiqueta no
 * sea toda numérica (no se aceptan direcciones tipo IP). La dirección viaja en cabeceras de correo y se muestra
 * en la consola; las reales caben todas. Todo correo que sale de acá lo acepta también
 * `emailDesdeTexto` de identidad (una prueba lo comprueba): la invitación del gerente no puede fallar
 * por el correo. La verificación real de que existe es el enlace.
 */
function correoValido(crudo: string): string | null {
  const recortado = crudo.trim();
  if (FUERA_DE_ASCII_VISIBLE.test(recortado)) return null;
  const correo = recortado.toLowerCase();
  if (correo.length > LARGO_MAXIMO_DEL_CORREO) return null;
  const partes = correo.split("@");
  if (partes.length !== 2) return null;
  const [local, dominio] = partes as [string, string];
  if (local.length > LARGO_MAXIMO_DE_LA_PARTE_LOCAL || !PARTE_LOCAL.test(local)) return null;
  const etiquetas = dominio.split(".");
  const ultima = etiquetas.at(-1) as string;
  if (etiquetas.length < 2 || SOLO_DIGITOS.test(ultima)) return null;
  return etiquetas.every((e) => ETIQUETA_DE_DOMINIO.test(e)) ? correo : null;
}

const SEPARADORES_DE_TELEFONO = /[\s().-]/g;
const FORMA_DE_TELEFONO = /^\+?[0-9]{8,15}$/;

/** Un dato opcional: `null` si lo dio mal; `{ valor: null }` si no lo dio; `{ valor }` si lo dio bien. */
type Opcional = Readonly<{ valor: string | null }> | null;

/** Teléfono sin separadores, con la forma de `solicitud_telefono_ck`. `""` = no lo dio. */
function telefonoValido(crudo: string): Opcional {
  const recortado = crudo.trim();
  if (recortado === "") return { valor: null };
  const digitos = recortado.replace(SEPARADORES_DE_TELEFONO, "");
  return FORMA_DE_TELEFONO.test(digitos) ? { valor: digitos } : null;
}

function cuitOpcional(crudo: string): Opcional {
  const recortado = crudo.trim();
  if (recortado === "") return { valor: null };
  const cuit = cuitDesdeTexto(recortado);
  return cuit.ok ? { valor: cuit.valor } : null;
}

function provinciaOpcional(crudo: string): Opcional {
  const recortado = crudo.trim();
  if (recortado === "") return { valor: null };
  return CODIGOS_DE_PROVINCIA.includes(recortado) ? { valor: recortado } : null;
}

/** El valor de un dato opcional que ya se sabe correcto. */
const valorDe = (opcional: Opcional): string | null => (opcional as { valor: string | null }).valor;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** El identificador de medición es un uuid (la cookie propia); si no lo es, se descarta. */
function idDeMedicionONulo(crudo: string): string | null {
  const id = crudo.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

/**
 * Valida el formulario. Dos clases de falla, con precedencia:
 *  1. `PAGINA_VENCIDA`: la versión de términos o de privacidad que mostró la página (o la del aviso de
 *     medición, si dio el consentimiento) ya no está vigente. Gana sobre todo lo demás: aceptar un texto
 *     retirado no es consentimiento válido, así que hay que volver a mostrar el vigente.
 *  2. `FORMA_INVALIDA` con TODOS los campos que fallan, en el orden del formulario.
 * Sin consentimiento de medición no se guarda la versión del aviso, ni el identificador, ni `fbclid`.
 */
export function validarFormulario(
  entrada: EntradaDeFormulario,
  vigentes: VersionesVigentes,
): Resultado<SolicitudValidada, ErrorDeFormulario> {
  const medicion = entrada.medicionConsentida;
  if (
    !vigentes.terminos.includes(entrada.versionDeTerminos) ||
    !vigentes.privacidad.includes(entrada.versionDePrivacidad) ||
    (medicion && !vigentes.avisoDeMedicion.includes(entrada.versionDeAvisoDeMedicion))
  ) {
    return err({ tipo: "PAGINA_VENCIDA" });
  }

  const nombreContacto = textoVisible(entrada.nombreContacto, LARGO_MAXIMO_DEL_NOMBRE_DE_CONTACTO);
  const correo = correoValido(entrada.correo);
  const nombreNegocio = textoVisible(entrada.nombreNegocio, LARGO_MAXIMO_DEL_NOMBRE_DEL_NEGOCIO);
  const rubro = (RUBROS as readonly string[]).includes(entrada.rubro) ? entrada.rubro : null;
  const provincia = provinciaOpcional(entrada.provincia);
  const telefono = telefonoValido(entrada.telefono);
  const cuit = cuitOpcional(entrada.cuit);

  const campos: CampoDeFormulario[] = [];
  if (nombreContacto === null) campos.push("nombreContacto");
  if (correo === null) campos.push("correo");
  if (nombreNegocio === null) campos.push("nombreNegocio");
  if (rubro === null) campos.push("rubro");
  if (provincia === null) campos.push("provincia");
  if (telefono === null) campos.push("telefono");
  if (cuit === null) campos.push("cuit");
  if (!entrada.aceptaTerminosYPrivacidad) campos.push("aceptaTerminosYPrivacidad");
  if (campos.length > 0) return err({ tipo: "FORMA_INVALIDA", campos });

  // Sin campos inválidos, todo lo de arriba tiene valor: los tipos no lo saben, el orden de las
  // comprobaciones sí.
  return ok({
    nombreContacto: nombreContacto as string,
    correo: correo as string,
    nombreNegocio: nombreNegocio as string,
    rubro: rubro as Rubro,
    provincia: valorDe(provincia),
    telefono: valorDe(telefono),
    cuit: valorDe(cuit),
    versionDeTerminos: entrada.versionDeTerminos,
    versionDePrivacidad: entrada.versionDePrivacidad,
    medicionConsentida: medicion,
    versionDeAvisoDeMedicion: medicion ? entrada.versionDeAvisoDeMedicion : null,
    idDeMedicion: medicion ? idDeMedicionONulo(entrada.idDeMedicion) : null,
    atribucion: normalizarAtribucion(entrada.atribucion, medicion),
  });
}
