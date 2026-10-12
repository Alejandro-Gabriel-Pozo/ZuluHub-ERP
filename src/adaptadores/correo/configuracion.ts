import { ErrorDeConfiguracion } from "../postgres/errores";

/**
 * Configuración del envío de correo (ADR-007). Acá solo viven los NOMBRES de las variables de
 * entorno: los valores los carga el dueño en Vercel. Falla cerrado: si falta o es inválida
 * cualquiera de las tres, no se arma el adaptador. Los mensajes de error nombran la variable y el
 * motivo, nunca el valor recibido.
 */
export const ZULUHUB_RESEND_API_KEY = "ZULUHUB_RESEND_API_KEY";
export const ZULUHUB_CORREO_REMITENTE = "ZULUHUB_CORREO_REMITENTE";
export const ZULUHUB_URL_BASE = "ZULUHUB_URL_BASE";

export type ConfiguracionDeCorreo = Readonly<{
  /** Credencial del proveedor. Es un secreto: no se registra ni se guarda. */
  claveDeApi: string;
  /** `direccion@dominio` o `Nombre <direccion@dominio>`. */
  remitente: string;
  /** Origen público de la aplicación, sin barra final (`https://app.ejemplo.com`). */
  urlBase: string;
}>;

type Entorno = Readonly<Record<string, string | undefined>>;

const DIRECCION = /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/;
const CON_NOMBRE = /^[^<>\r\n]+<([^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+)>$/;

function remitenteValido(texto: string): boolean {
  // `texto` ya viene sin blancos en los extremos: el nombre, si lo hay, tiene al menos un carácter.
  return DIRECCION.test(texto) || CON_NOMBRE.test(texto);
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

  const claveDeApi = leer(ZULUHUB_RESEND_API_KEY, (t) =>
    /\s/.test(t) ? { motivo: "no puede tener espacios" } : t,
  );
  const remitente = leer(ZULUHUB_CORREO_REMITENTE, (t) =>
    remitenteValido(t) ? t : { motivo: "se espera direccion@dominio o Nombre <direccion@dominio>" },
  );
  const urlBase = leer(ZULUHUB_URL_BASE, (t) => {
    const origen = origenValido(t);
    return "motivo" in origen ? origen : origen.origen;
  });

  if (problemas.length > 0) {
    throw new ErrorDeConfiguracion(`configuración de correo incompleta: ${problemas.join("; ")}`);
  }
  return { claveDeApi, remitente, urlBase };
}
