/**
 * Un `Set-Cookie` de la librería de ingreso, traducido a lo que entiende `cookies().set` de Next (armazón web
 * §4.4 y W3b: `cookiesDeRespuesta`). Un componente de servidor no puede fijar cookies; una acción del
 * servidor sí, pero no acepta el texto crudo: pide nombre, valor y opciones por separado. Previene: la cookie
 * de sesión que muere a los 15 minutos del ingreso aunque la persona use la aplicación (la renovación
 * quedaba en la base y el navegador no se enteraba), o la que no se borra al cerrar sesión. Chequeo:
 * `set-cookie.test.ts`.
 *
 * El valor llega codificado (`%2F`…) y Next lo vuelve a codificar al escribirlo: se decodifica UNA vez acá,
 * si no, el valor llegaría doble codificado y la librería no reconocería su propia cookie.
 */
export type CookieParaNext = Readonly<{
  nombre: string;
  valor: string;
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: true;
  secure?: true;
  sameSite?: "lax" | "strict" | "none";
}>;

const NOMBRE_VALIDO = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function decodificar(valor: string): string {
  try {
    return decodeURIComponent(valor);
  } catch {
    return valor;
  }
}

/** La cookie del texto crudo, o `null` si no es un `Set-Cookie` con nombre válido. */
export function cookieParaNext(crudo: string): CookieParaNext | null {
  // `split` siempre devuelve al menos un elemento.
  const [par, ...atributos] = crudo.split(";") as [string, ...string[]];
  const igual = par.indexOf("=");
  if (igual < 1) return null;
  const nombre = par.slice(0, igual).trim();
  if (!NOMBRE_VALIDO.test(nombre)) return null;
  let cookie: {
    -readonly [K in keyof CookieParaNext]: CookieParaNext[K];
  } = { nombre, valor: decodificar(par.slice(igual + 1).trim()) };
  for (const atributo of atributos) {
    // «nombre=valor» o solo «nombre»: el patrón siempre coincide (todo es opcional).
    const partes = /([^=]*)=?([\s\S]*)/.exec(atributo) as RegExpExecArray;
    const clave = (partes[1] as string).trim().toLowerCase();
    const valor = (partes[2] as string).trim();
    if (clave === "path" && valor !== "") cookie = { ...cookie, path: valor };
    else if (clave === "domain" && valor !== "") cookie = { ...cookie, domain: valor };
    else if (clave === "max-age" && /^-?\d+$/.test(valor)) {
      cookie = { ...cookie, maxAge: Number(valor) };
    } else if (clave === "expires") {
      const fecha = new Date(valor);
      if (!Number.isNaN(fecha.getTime())) cookie = { ...cookie, expires: fecha };
    } else if (clave === "httponly") cookie = { ...cookie, httpOnly: true };
    else if (clave === "secure") cookie = { ...cookie, secure: true };
    else if (clave === "samesite") {
      const modo = valor.toLowerCase();
      if (modo === "lax" || modo === "strict" || modo === "none") {
        cookie = { ...cookie, sameSite: modo };
      }
    }
  }
  return cookie;
}
