import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import {
  ENCABEZADO_DE_IP,
  PREFIJO_DE_COOKIE,
  PREFIJO_DE_NAVEGADOR,
  RUTA_BASE_DE_INGRESO,
  type ConfiguracionDeHost,
} from "../../capacidades/autenticacion/host-de-autenticacion";
import {
  segundosDeInactividad,
  vencimientoRenovado,
  vigenciaDeSesion,
  type LimitesDeSesion,
} from "../../capacidades/autenticacion/vigencia-de-sesion";
import type { ConexionDeAutenticacion } from "../postgres/conexion-de-autenticacion";
import { RUTAS_BLOQUEADAS } from "./rutas-bloqueadas";

/**
 * Las opciones de UNA instancia de Better Auth, la de un host de aplicación (web-armazon §4.1 y §4.3).
 * Todo lo que cambia entre hosts viene de `ConfiguracionDeHost`; lo demás es igual para todos. Cada
 * opción responde a un riesgo que el ADR-013 o el spike encontraron: el comentario dice cuál.
 */

/**
 * La conexión de la librería a su esquema: el Kysely del rol de autenticación, que arma
 * `adaptadores/postgres/conexion-de-autenticacion.ts`. Se toma de ahí (solo el tipo) y no del tipo de la
 * librería: ese pasa por un módulo de Bun que no existe acá y TypeScript lo vuelve irresoluble.
 */
export type BaseDeDatosDeLaLibreria = ConexionDeAutenticacion["db"];

export type ParametrosDeInstancia = Readonly<{
  configuracion: ConfiguracionDeHost;
  db: BaseDeDatosDeLaLibreria;
  secreto: string;
  google: Readonly<{ clientId: string; clientSecret: string }>;
  limites: LimitesDeSesion;
  reloj: () => Date;
  /** Encabezado del que sale la IP del cliente para el límite de intentos; por omisión `ENCABEZADO_DE_IP` (S3). */
  encabezadoDeIp?: string;
  /** A dónde vuelve la persona si el ingreso falla (`?error=<código>`): la pantalla de ingreso (W5). */
  rutaDeError: string;
  /** Registro del servidor: lo que la librería cuenta de un fallo. Nunca sale en una respuesta. */
  registrar: (detalle: string) => void;
}>;

/** Código estable de la respuesta 401 de `/get-session` cuando la sesión no vale. */
const CODIGO_SESION_NO_VIGENTE = "SESION_NO_VIGENTE";

/** El host guardado en una sesión (la columna propia `host`); vacío si no se puede leer: no coincide con ninguno. */
export function hostGuardado(sesion: object): string {
  const host = (sesion as Record<string, unknown>)["host"];
  return typeof host === "string" ? host : "";
}

export function opcionesDeInstancia(p: ParametrosDeInstancia): BetterAuthOptions {
  const { host, baseURL, origenesConfiables } = p.configuracion;
  return {
    appName: "ZuluHub",
    // Origen FIJO de la instancia (nunca `allowedHosts` con `fallback`: un fallback haría caer un host en otra marca).
    baseURL,
    basePath: RUTA_BASE_DE_INGRESO,
    trustedOrigins: [...origenesConfiables],
    // Secreto propio de la app de empresa; nunca el de `BETTER_AUTH_SECRET` (prohibido en el entorno).
    secret: p.secreto,
    plugins: [], // Sin `twoFactor`: el segundo factor es de la consola, no de la web de empresa (P8).
    telemetry: { enabled: false },
    logger: {
      level: "warn",
      log: (nivel, mensaje, ...resto) => {
        const detalle = resto.map((x) => (x instanceof Error ? x.message : String(x))).join(" ");
        p.registrar(`[ingreso] ${nivel} ${mensaje}${detalle === "" ? "" : ` ${detalle}`}`);
      },
    },
    onAPIError: { throw: false, errorURL: p.rutaDeError },
    database: { db: p.db, type: "postgres", schemaName: "autenticacion", transaction: true },
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: p.google.clientId,
        clientSecret: p.google.clientSecret,
        // Siempre se elige la cuenta: en un mostrador compartido no se entra con la última que quedó abierta.
        prompt: "select_account",
        // Cada ingreso refresca el email y el estado verificado (si no, el email del usuario queda viejo).
        overrideUserInfoOnSignIn: true,
        // S1: sin ingreso con un `idToken` mandado por el cliente. El único camino es la pantalla de Google y
        // el retorno con su estado: con el atajo, un token ajeno abriría sesión sin pasar por ninguno de los dos.
        disableIdTokenSignIn: true,
      },
    },
    account: {
      // Sin vincular por email: la identidad es el `sub` de Google (ADR-013, punto 2).
      accountLinking: { enabled: false, disableImplicitLinking: true },
      encryptOAuthTokens: true,
    },
    user: {
      // G6: email verificado en el alta, en el vínculo y en CADA ingreso.
      validateUserInfo: ({ user }) =>
        user.emailVerified === true ? undefined : { error: "email_no_verificado" },
    },
    session: {
      expiresIn: segundosDeInactividad(p.limites),
      // 0: cada uso renueva el vencimiento (la inactividad cuenta desde el último uso).
      updateAge: 0,
      // Apagada: con caché la revocación no sería inmediata (y fue un aviso crítico de la librería).
      cookieCache: { enabled: false },
      // G4: la sesión recuerda en qué host nació. `input: false`: no se puede mandar desde afuera.
      additionalFields: { host: { type: "string", required: true, input: false } },
    },
    advanced: {
      // M1: `__Host-zh_emp.<cookie>`. La librería solo antepone `__Secure-` por su cuenta, así que se apaga
      // eso (`useSecureCookies: false`) y el prefijo `__Host-` va en el nombre; el atributo `Secure` no depende
      // de esa opción y lo fija `defaultCookieAttributes` (una prueba lo comprueba). Sin `crossSubDomainCookies`: sin `Domain`.
      cookiePrefix: `${PREFIJO_DE_NAVEGADOR}${PREFIJO_DE_COOKIE}`,
      useSecureCookies: false,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: true, path: "/" },
      // S3: la IP del límite de intentos sale de UN encabezado de confianza, nunca de `x-forwarded-for` (que
      // un cliente puede falsear para repartir los intentos en infinitas «IP»). `disableIpTracking` queda
      // apagado: sin IP el límite cae a un balde compartido, que es más estricto y no se puede esquivar.
      ipAddress: { ipAddressHeaders: [p.encabezadoDeIp ?? ENCABEZADO_DE_IP] },
      database: { generateId: "uuid" },
      // Comprobación de origen y de CSRF SIEMPRE encendidas: por omisión la librería las apaga cuando
      // `NODE_ENV` vale `test`, y un servidor que arranque con otro valor no debe cambiar la defensa.
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    rateLimit: { enabled: true, storage: "database" },
    disabledPaths: [...RUTAS_BLOQUEADAS],
    databaseHooks: {
      session: {
        create: {
          // G4: se guarda el host de la instancia (el que resolvió el servidor), nunca uno que mande el cliente.
          before: (sesion) => Promise.resolve({ data: { ...sesion, host } }),
        },
        update: {
          // G5: ninguna renovación pasa de las 8 horas de creada la sesión. Sin la sesión a la vista, no se renueva.
          before: (cambios, contexto) => {
            const actual = contexto?.context.session?.session;
            if (actual === undefined || actual === null) return Promise.resolve(false);
            const expiresAt = vencimientoRenovado(actual.createdAt, p.reloj(), p.limites);
            return Promise.resolve({ data: { ...cambios, expiresAt } });
          },
        },
      },
      account: {
        // El `idToken` de Google no se usa y se guardaría en claro: no se guarda.
        create: { before: (cuenta) => Promise.resolve({ data: { ...cuenta, idToken: null } }) },
        update: { before: (cuenta) => Promise.resolve({ data: { ...cuenta, idToken: null } }) },
      },
    },
    hooks: {
      // G4 en la ruta de la propia librería que lee la sesión (`/get-session`, el «Seguir» de la pantalla):
      // una sesión de otro host, vencida o pasada del tope de 8 horas no se lee ni se renueva.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/get-session") return;
        const token = await ctx.getSignedCookie(
          ctx.context.authCookies.sessionToken.name,
          ctx.context.secret,
        );
        if (typeof token !== "string" || token === "") return;
        const encontrada = await ctx.context.internalAdapter.findSession(token);
        if (encontrada === null) return;
        const s = encontrada.session;
        const vigencia = vigenciaDeSesion(
          {
            host: hostGuardado(s),
            creadaEn: s.createdAt,
            ultimoUso: s.updatedAt,
            venceEn: s.expiresAt,
          },
          host,
          p.reloj(),
          p.limites,
        );
        if (vigencia === "VIGENTE") return;
        // Vencida: se borra la fila (el barrido haría lo mismo). De otro host: no se toca, no es de este host.
        if (vigencia === "VENCIDA") await ctx.context.internalAdapter.deleteSession(token);
        throw new APIError("UNAUTHORIZED", {
          code: CODIGO_SESION_NO_VIGENTE,
          message: "La sesión no está vigente",
        });
      }),
    },
  };
}
