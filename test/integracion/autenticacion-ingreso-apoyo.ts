import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crearConexionDeAutenticacion } from "../../src/adaptadores/postgres/conexion-de-autenticacion";
import { crearAutenticacionDeBetterAuth } from "../../src/adaptadores/autenticacion/autenticacion-de-better-auth";
import type { Autenticacion } from "../../src/puertos/autenticacion";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas del ingreso (W3b): un proveedor OIDC LOCAL que hace de Google, un bloqueo de la red
 * externa y un «navegador» con cookies por host. Nada sale a internet: la librería llama a los puntos de
 * Google con `fetch`, y ese `fetch` se reemplaza por uno que reenvía los de Google al servidor local y
 * falla (y lo anota) ante cualquier otro destino externo. Los secretos, las claves y los códigos son al
 * azar de cada corrida; no hay ningún valor real.
 */

export type PerfilDePrueba = Readonly<{
  sub: string;
  email: string;
  /** `undefined` = el proveedor no manda el dato. */
  emailVerificado: boolean | undefined;
  nombre?: string;
}>;

export const perfilAlAzar = (opciones: Partial<PerfilDePrueba> = {}): PerfilDePrueba => ({
  sub: `sub-${randomUUID()}`,
  email: `ingreso-${randomUUID().slice(0, 8)}@ejemplo.test`,
  emailVerificado: true,
  nombre: "Persona de prueba",
  ...opciones,
});

type CodigoEmitido = {
  perfil: PerfilDePrueba;
  desafio: string;
  redirigirA: string;
  usado: boolean;
};

export type ProveedorLocal = Readonly<{
  /** Los puntos de Google que la librería usa, apuntados acá. */
  url: string;
  clientId: string;
  clientSecret: string;
  /**
   * El paso del navegador por «Google»: valida la URL de autorización que armó la librería (PKCE,
   * alcances, `prompt`, cliente, retorno) y devuelve la dirección de retorno con `code` y `state`.
   */
  autorizar(urlDeAutorizacion: string, perfil: PerfilDePrueba): string;
  /** Cuántos pedidos al punto del token se recibieron. */
  pedidosDeToken(): number;
  /** Hasta que lleguen `n` pedidos al token, los retiene a todos y los suelta juntos (barrera de concurrencia). */
  retenerTokenHasta(n: number): void;
  /** Destinos externos que algo intentó alcanzar (tiene que quedar vacío). */
  intentosExternos(): readonly string[];
  cerrar(): Promise<void>;
}>;

const REDIRECCION_DE_GOOGLE = "oauth2.googleapis.com";
const AUTORIZACION_DE_GOOGLE = "accounts.google.com";

function jwtSinFirma(carga: Record<string, unknown>): string {
  const parte = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  // La librería decodifica el id_token sin verificar su firma (lo anota el spike): alcanza con la forma.
  return `${parte({ alg: "RS256", typ: "JWT", kid: "local" })}.${parte(carga)}.${randomBytes(32).toString("base64url")}`;
}

/** Levanta el proveedor y reemplaza `fetch` global; `cerrar()` restaura todo. */
export async function levantarProveedorLocal(): Promise<ProveedorLocal> {
  const clientId = `cliente-${randomUUID()}`;
  const clientSecret = randomBytes(24).toString("hex");
  const codigos = new Map<string, CodigoEmitido>();
  let pedidos = 0;
  let esperar = 0;
  let llegaron = 0;
  let soltar: () => void = () => undefined;
  let compuerta: Promise<void> = Promise.resolve();
  const externos: string[] = [];

  const servidor: Server = createServer((pedido, respuesta) => {
    const trozos: Buffer[] = [];
    pedido.on("data", (t: Buffer) => trozos.push(t));
    pedido.on("end", () => {
      void (async () => {
        const fallar = (estado: number, error: string) => {
          respuesta.writeHead(estado, { "content-type": "application/json" });
          respuesta.end(JSON.stringify({ error }));
        };
        if (pedido.method !== "POST" || pedido.url !== "/token") return fallar(404, "no_existe");
        pedidos += 1;
        if (esperar > 0) {
          llegaron += 1;
          if (llegaron >= esperar) soltar();
          await compuerta;
        }
        const datos = new URLSearchParams(Buffer.concat(trozos).toString("utf8"));
        const basic = /^Basic (.+)$/.exec(pedido.headers.authorization ?? "")?.[1];
        const [idBasic, secretoBasic] = basic
          ? Buffer.from(basic, "base64").toString("utf8").split(":")
          : [undefined, undefined];
        const id = datos.get("client_id") ?? idBasic;
        const secreto = datos.get("client_secret") ?? secretoBasic;
        if (id !== clientId || secreto !== clientSecret) return fallar(401, "invalid_client");
        const emitido = codigos.get(datos.get("code") ?? "");
        if (emitido === undefined || emitido.usado) return fallar(400, "invalid_grant");
        emitido.usado = true;
        const verificador = datos.get("code_verifier") ?? "";
        const desafio = createHash("sha256").update(verificador).digest("base64url");
        if (desafio !== emitido.desafio) return fallar(400, "invalid_grant");
        if (datos.get("redirect_uri") !== emitido.redirigirA) return fallar(400, "invalid_grant");
        const ahora = Math.floor(Date.now() / 1000);
        const p = emitido.perfil;
        const idToken = jwtSinFirma({
          iss: "https://accounts.google.com",
          aud: clientId,
          sub: p.sub,
          email: p.email,
          ...(p.emailVerificado === undefined ? {} : { email_verified: p.emailVerificado }),
          name: p.nombre ?? "",
          iat: ahora,
          exp: ahora + 3600,
        });
        respuesta.writeHead(200, { "content-type": "application/json" });
        respuesta.end(
          JSON.stringify({
            access_token: randomBytes(24).toString("hex"),
            refresh_token: randomBytes(24).toString("hex"),
            token_type: "Bearer",
            expires_in: 3600,
            scope: "openid email profile",
            id_token: idToken,
          }),
        );
      })();
    });
  });
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const destino = new URL(
      typeof entrada === "string" || entrada instanceof URL ? entrada : entrada.url,
    );
    if (destino.hostname === REDIRECCION_DE_GOOGLE) {
      return fetchOriginal(`${url}${destino.pathname}`, init);
    }
    if (destino.hostname === "127.0.0.1" && destino.origin === url)
      return fetchOriginal(entrada, init);
    externos.push(destino.origin);
    throw new Error(`red externa bloqueada en las pruebas: ${destino.origin}`);
  }) as typeof fetch;

  return {
    url,
    clientId,
    clientSecret,
    autorizar(urlDeAutorizacion, perfil) {
      const u = new URL(urlDeAutorizacion);
      if (u.hostname !== AUTORIZACION_DE_GOOGLE)
        throw new Error(`autoriza en otro lado: ${u.origin}`);
      const q = u.searchParams;
      const problemas: string[] = [];
      if (q.get("client_id") !== clientId) problemas.push("client_id");
      if (q.get("response_type") !== "code") problemas.push("response_type");
      if (q.get("code_challenge_method") !== "S256") problemas.push("code_challenge_method");
      if (q.get("prompt") !== "select_account") problemas.push("prompt");
      if (!(q.get("scope") ?? "").split(/[ ,]/).includes("openid")) problemas.push("scope");
      const desafio = q.get("code_challenge") ?? "";
      const estado = q.get("state") ?? "";
      const retorno = q.get("redirect_uri") ?? "";
      if (desafio === "" || estado === "" || retorno === "") problemas.push("faltan parámetros");
      if (problemas.length > 0) throw new Error(`autorización mal armada: ${problemas.join(", ")}`);
      const codigo = randomBytes(24).toString("hex");
      codigos.set(codigo, { perfil, desafio, redirigirA: retorno, usado: false });
      const vuelta = new URL(retorno);
      vuelta.searchParams.set("code", codigo);
      vuelta.searchParams.set("state", estado);
      return vuelta.toString();
    },
    pedidosDeToken: () => pedidos,
    retenerTokenHasta(n) {
      esperar = n;
      llegaron = 0;
      compuerta = new Promise<void>((resolver) => {
        soltar = resolver;
      });
    },
    intentosExternos: () => externos,
    async cerrar() {
      globalThis.fetch = fetchOriginal;
      await new Promise<void>((resolver) => servidor.close(() => resolver()));
    },
  };
}

// ---- el navegador ----------------------------------------------------------------------------------------------

export type CookieGuardada = {
  nombre: string;
  valor: string;
  atributos: string;
  /** El `Set-Cookie` tal como llegó. */
  crudo: string;
};

type Respuesta = Readonly<{
  estado: number;
  ubicacion: string | null;
  texto: string;
  cabeceras: Headers;
  json: () => unknown;
}>;

/** Un navegador mínimo: cookies por host (solo del host, como una cookie sin `Domain`). */
export class Navegador {
  readonly #porHost = new Map<string, Map<string, CookieGuardada>>();
  readonly #ip: string;

  /** Cada navegador tiene su IP (la librería limita los pedidos por IP y ruta). */
  constructor(ip: string = `203.0.113.${1 + Math.floor(Math.random() * 250)}`) {
    this.#ip = ip;
  }

  cookiesDe(host: string): CookieGuardada[] {
    return [...(this.#porHost.get(host)?.values() ?? [])];
  }

  /** Copia al navegador de otro host la cookie de sesión de este (lo que haría quien la roba). */
  copiarCookiesA(otro: Navegador, desde: string, hacia: string): void {
    for (const c of this.cookiesDe(desde)) otro.#guardar(hacia, c.crudo);
  }

  #guardar(host: string, crudo: string): void {
    const [par = "", ...resto] = crudo.split(";");
    const igual = par.indexOf("=");
    const nombre = par.slice(0, igual).trim();
    const valor = par.slice(igual + 1).trim();
    const atributos = resto.map((a) => a.trim()).join("; ");
    const mapa = this.#porHost.get(host) ?? new Map<string, CookieGuardada>();
    this.#porHost.set(host, mapa);
    const maxAge = /max-age=(-?\d+)/i.exec(atributos)?.[1];
    if (valor === "" || (maxAge !== undefined && Number(maxAge) <= 0)) mapa.delete(nombre);
    else mapa.set(nombre, { nombre, valor, atributos, crudo });
  }

  async pedir(
    autenticacion: Autenticacion,
    host: string,
    metodo: "GET" | "POST",
    ruta: string,
    opciones: {
      cuerpo?: unknown;
      origen?: string | null;
      encabezados?: Record<string, string>;
    } = {},
  ): Promise<Respuesta> {
    const cabeceras = new Headers({ "x-forwarded-for": this.#ip, ...opciones.encabezados });
    const cookies = this.cookiesDe(host)
      .map((c) => `${c.nombre}=${c.valor}`)
      .join("; ");
    if (cookies !== "") cabeceras.set("cookie", cookies);
    if (metodo === "POST") {
      cabeceras.set("content-type", "application/json");
      if (opciones.origen !== null) cabeceras.set("origin", opciones.origen ?? `https://${host}`);
    }
    const pedido = new Request(`https://${host}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      ...(metodo === "POST" ? { body: JSON.stringify(opciones.cuerpo ?? {}) } : {}),
    });
    const respuesta = await autenticacion.manejar(pedido, host);
    for (const crudo of respuesta.headers.getSetCookie()) this.#guardar(host, crudo);
    const texto = await respuesta.text();
    return {
      estado: respuesta.status,
      ubicacion: respuesta.headers.get("location"),
      texto,
      cabeceras: respuesta.headers,
      json: () => JSON.parse(texto) as unknown,
    };
  }

  /** Un pedido con las cookies de este navegador, para `sesionDe`. */
  pedidoDe(host: string): { headers: Headers } {
    const cookies = this.cookiesDe(host)
      .map((c) => `${c.nombre}=${c.valor}`)
      .join("; ");
    return { headers: new Headers(cookies === "" ? {} : { cookie: cookies }) };
  }

  /**
   * El ingreso completo con Google en `host`: empieza, pasa por el proveedor y vuelve al retorno. Devuelve
   * la respuesta del retorno (la redirección de éxito o de error).
   */
  async ingresarConGoogle(
    autenticacion: Autenticacion,
    host: string,
    proveedor: ProveedorLocal,
    perfil: PerfilDePrueba,
    opciones: { callbackURL?: string } = {},
  ): Promise<Respuesta> {
    const inicio = await this.pedir(autenticacion, host, "POST", "/api/auth/sign-in/social", {
      cuerpo: { provider: "google", callbackURL: opciones.callbackURL ?? "/" },
    });
    if (inicio.estado !== 200)
      throw new Error(`el inicio de ingreso dio ${inicio.estado}: ${inicio.texto}`);
    const { url } = inicio.json() as { url: string };
    const retorno = new URL(proveedor.autorizar(url, perfil));
    return this.pedir(autenticacion, host, "GET", `${retorno.pathname}${retorno.search}`);
  }

  /** Igual, pero devuelve el retorno SIN haberlo seguido (para repetirlo o reordenarlo). */
  async empezarIngreso(
    autenticacion: Autenticacion,
    host: string,
    proveedor: ProveedorLocal,
    perfil: PerfilDePrueba,
  ): Promise<string> {
    const inicio = await this.pedir(autenticacion, host, "POST", "/api/auth/sign-in/social", {
      cuerpo: { provider: "google", callbackURL: "/" },
    });
    if (inicio.estado !== 200)
      throw new Error(`el inicio de ingreso dio ${inicio.estado}: ${inicio.texto}`);
    const retorno = new URL(proveedor.autorizar((inicio.json() as { url: string }).url, perfil));
    return `${retorno.pathname}${retorno.search}`;
  }
}

// ---- la autenticación armada sobre la base de la prueba --------------------------------------------------------

export type AutenticacionDePrueba = Readonly<{
  autenticacion: Autenticacion;
  secreto: string;
  conexion: ReturnType<typeof crearConexionDeAutenticacion>;
  registros: string[];
  cerrar(): Promise<void>;
}>;

export function armarAutenticacionDePrueba(
  base: BaseDePruebas,
  proveedor: ProveedorLocal,
  opciones: { reloj?: () => Date; capacidadDeLaCache?: number } = {},
): AutenticacionDePrueba {
  const conexion = crearConexionDeAutenticacion({ url: base.autenticacion, maximoDeConexiones: 8 });
  const secreto = randomBytes(32).toString("hex");
  const registros: string[] = [];
  const autenticacion = crearAutenticacionDeBetterAuth({
    db: conexion.db,
    secreto,
    google: { clientId: proveedor.clientId, clientSecret: proveedor.clientSecret },
    registrar: (d) => registros.push(d),
    ...(opciones.reloj === undefined ? {} : { reloj: opciones.reloj }),
    ...(opciones.capacidadDeLaCache === undefined
      ? {}
      : { capacidadDeLaCache: opciones.capacidadDeLaCache }),
  });
  return { autenticacion, secreto, conexion, registros, cerrar: () => conexion.cerrar() };
}
