import { emailDeContactoDesdeTexto } from "../../primitivas/contacto/email";
import {
  textoDeUnaLineaDesdeTexto,
  type MotivoDeTextoInvalido,
} from "../../primitivas/texto/texto-de-una-linea";
import { ErrorDeConfiguracion } from "../postgres/errores";

/**
 * Configuración del envío de correo (ADR-007). Acá solo viven los NOMBRES de las variables de
 * entorno: los valores los carga el dueño en Vercel. Falla cerrado: si falta o es inválida
 * cualquiera de las cuatro, no se arma el adaptador. Los mensajes de error nombran la variable y el
 * motivo, nunca el valor recibido.
 */
export const PEDERNAL_RESEND_API_KEY = "PEDERNAL_RESEND_API_KEY";
export const PEDERNAL_CORREO_REMITENTE = "PEDERNAL_CORREO_REMITENTE";
export const PEDERNAL_URL_BASE = "PEDERNAL_URL_BASE";
export const PEDERNAL_NOMBRE_DE_MARCA = "PEDERNAL_NOMBRE_DE_MARCA";

export type ConfiguracionDeCorreo = Readonly<{
  /** Credencial del proveedor. Es un secreto: no se registra ni se guarda. */
  claveDeApi: string;
  /** Listo para el encabezado `From`: `direccion@dominio` o `"Nombre" <direccion@dominio>` (el nombre va citado, RFC 5322). */
  remitente: string;
  /** Origen público de la aplicación, sin barra final (`https://app.ejemplo.com`). */
  urlBase: string;
  /** Nombre del producto que aparece en los mails. La marca es un dato, nunca código. */
  nombreDeMarca: string;
}>;

type Entorno = Readonly<Record<string, string | undefined>>;

const LARGO_MAXIMO_DE_MARCA = 60;

/**
 * FICHA DEL DATO: REMITENTE Y NOMBRE DE MARCA DEL CORREO. LISTA DE PERMITIDOS (decisión del dueño, 2026-11-06: «hay que reescribirlas
 * AHORA»; marcas y planes usan la MISMA lista que `texto-de-una-linea.ts`, sin símbolos especiales por ahora).
 * - Fuente: las variables `PEDERNAL_CORREO_REMITENTE` y `PEDERNAL_NOMBRE_DE_MARCA`, que carga el dueño en Vercel. Aun así se tratan
 *   como no confiables: el remitente va a un encabezado `From` y la marca al asunto y al cuerpo de cada mail.
 * - Nombre (el de la marca y el que acompaña al remitente): la lista de permitidos de `textoDeUnaLineaDesdeTexto` (letras latinas,
 *   dígitos, espacio y `. , & - ' / ( ) ° + : ; " # º ª ’ “ ” – — « » ® ™`; no empieza con `+` ni `-`; NFC y espacios colapsados),
 *   de 1 a `LARGO_MAXIMO_DE_MARCA` (60) caracteres. El 60 es el de `validarNombreVisible` de las marcas (SUPUESTO: el remitente
 *   no tenía tope y usa el mismo).
 * - Dirección: la estructura y el tope (254, una línea, sin controles) son de la primitiva `emailDeContactoDesdeTexto`; además, y
 *   solo para un encabezado de correo, un conjunto cerrado: antes de la `@` letras ASCII, dígitos y `. _ % + -`; después, etiquetas
 *   de letras ASCII, dígitos y `-` separadas por puntos, al menos dos. Nada de espacios, `<`, `>`, `,`, `;`, `"` ni una segunda `@`.
 * - Rechaza (ejemplos): `dos@@x.test`, `a@b` (sin punto), `uno@x.test, dos@x.test`, `inyección\r\nBcc: x@y.test <a@x.test>`,
 *   `<a@x.test>` (sin nombre), `Nombre <a@x.test> basura`, un nombre con `<`, saltos de línea, emojis o invisibles.
 * - Previene: la inyección de encabezados (un salto de línea en el remitente agrega un `Bcc`) y un nombre con marcado en el asunto.
 *   Fallo real: `[^\s<>@,;"]` y `[\p{Cc}<>]` listaban lo prohibido y dejaban pasar invisibles y marcas de dirección de texto.
 * - Cambia de comportamiento solo si el dueño cargó una dirección con letras no ASCII o con `! # $ & ' * / = ? ^ \` { | } ~` antes de
 *   la `@` (ninguna dirección de remitente real las lleva), un nombre con símbolos fuera de la lista, o más de 60 caracteres.
 * Chequeo: `configuracion.test.ts` y la mutación del archivo.
 */
const DIRECCION = "[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+";
const DIRECCION_PERMITIDA = new RegExp(`^${DIRECCION}$`);
/** El cierre `<direccion>` del final: lo que queda antes es el nombre (lo valida su lista) y lo de adentro, la dirección. */
const DIRECCION_ENTRE_ANGULOS = new RegExp(`<${DIRECCION}>$`);
const REGLAS_DEL_NOMBRE = { maximo: LARGO_MAXIMO_DE_MARCA, exigirUnaLetra: false } as const;

function direccionValida(texto: string): boolean {
  return DIRECCION_PERMITIDA.test(texto) && emailDeContactoDesdeTexto(texto).ok;
}

/**
 * El nombre del remitente como `quoted-string` de RFC 5322 (display-name entre comillas, con `\` y `"` escapados). Sin comillas, un
 * lector estándar de `From` lee `,` como dos remitentes, `:` como un grupo y `"` como una comilla sin cierre; citado, el nombre es
 * UN solo texto. Pura: no valida (eso lo hace `armarFrom`, que es la única que la llama).
 */
export function citarNombreDeRemitente(nombre: string): string {
  return `"${nombre.replace(/["\\]/g, "\\$&")}"`;
}

/**
 * LA regla que arma el `From` con nombre (`"Nombre" <direccion>`): todo remitente que sale al encabezado pasa por acá. Falla cerrado
 * (`null`) si el nombre no está en la lista de permitidos (un salto de línea, `<`, `>` o `@` no entran, ni se escapan: se rechazan),
 * si está vacío o si la dirección no sirve. El nombre se normaliza (NFC, espacios): misma entrada, misma salida, y la salida de
 * una entrada ya canónica es ella misma.
 */
export function armarFrom(nombre: string, direccion: string): string | null {
  const limpio = textoDeUnaLineaDesdeTexto(nombre, REGLAS_DEL_NOMBRE);
  if (!limpio.ok || !direccionValida(direccion)) return null;
  return `${citarNombreDeRemitente(limpio.valor)} <${direccion}>`;
}

/** El remitente listo para el encabezado `From` (`direccion` o `"Nombre" <direccion>`), o `null` si no sirve. `texto` ya viene sin blancos en los extremos. */
function remitenteCanonico(texto: string): string | null {
  const cierre = DIRECCION_ENTRE_ANGULOS.exec(texto);
  if (cierre === null) return direccionValida(texto) ? texto : null;
  return armarFrom(texto.slice(0, cierre.index), cierre[0].slice(1, -1));
}

function motivoDelNombre(motivo: MotivoDeTextoInvalido): string {
  return motivo === "DEMASIADO_LARGO"
    ? `no puede pasar de ${LARGO_MAXIMO_DE_MARCA} caracteres`
    : "tiene caracteres no admitidos";
}

const ES_LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Devuelve el origen normalizado, o el motivo por el que no sirve. */
function origenValido(texto: string): { origen: string } | { motivo: string } {
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return { motivo: "no es una URL absoluta" };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ES_LOCAL.has(url.hostname))) {
    return { motivo: "tiene que ser https (http solo para localhost)" };
  }
  if (url.username !== "" || url.password !== "") return { motivo: "no puede llevar usuario" };
  if (url.search !== "" || url.hash !== "") {
    return { motivo: "no puede llevar parámetros ni fragmento" };
  }
  return { origen: `${url.origin}${url.pathname.replace(/\/+$/, "")}` };
}

export function leerConfiguracionDeCorreo(entorno: Entorno): ConfiguracionDeCorreo {
  const problemas: string[] = [];
  /** El valor ya validado, o `""` si falta o no sirve (y entonces queda el problema anotado). */
  const leer = (
    nombre: string,
    validar: (texto: string) => string | { motivo: string },
  ): string => {
    const texto = entorno[nombre]?.trim() ?? "";
    if (texto === "") {
      problemas.push(`${nombre} falta`);
      // Stryker disable next-line StringLiteral: con un problema anotado la función lanza antes de devolver este valor; solo importa que sea un texto.
      return "";
    }
    const validado = validar(texto);
    if (typeof validado === "string") return validado;
    problemas.push(`${nombre} inválida: ${validado.motivo}`);
    // Stryker disable next-line StringLiteral: con un problema anotado la función lanza antes de devolver este valor; solo importa que sea un texto.
    return "";
  };

  const claveDeApi = leer(PEDERNAL_RESEND_API_KEY, (t) =>
    /\s/.test(t) ? { motivo: "no puede tener espacios" } : t,
  );
  const remitente = leer(
    PEDERNAL_CORREO_REMITENTE,
    (t) =>
      remitenteCanonico(t) ?? {
        motivo: "se espera direccion@dominio o Nombre <direccion@dominio>",
      },
  );
  const urlBase = leer(PEDERNAL_URL_BASE, (t) => {
    const origen = origenValido(t);
    return "motivo" in origen ? origen : origen.origen;
  });

  const nombreDeMarca = leer(PEDERNAL_NOMBRE_DE_MARCA, (t) => {
    const nombre = textoDeUnaLineaDesdeTexto(t, REGLAS_DEL_NOMBRE);
    return nombre.ok ? nombre.valor : { motivo: motivoDelNombre(nombre.error) };
  });

  if (problemas.length > 0) {
    throw new ErrorDeConfiguracion(`configuración de correo incompleta: ${problemas.join("; ")}`);
  }
  return { claveDeApi, remitente, urlBase, nombreDeMarca };
}
