import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins/two-factor";
import {
  ENCABEZADO_DE_IP,
  PREFIJO_DE_COOKIE,
  PREFIJO_DE_COOKIE_DE_PLATAFORMA,
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
import type { PersonalHabilitado } from "../../puertos/autenticacion";
import type {
  AuditoriaDeIngresoDePlataforma,
  SegundoFactorDeAutenticacion,
} from "../../puertos/segundo-factor-de-autenticacion";
import type { ConexionDeAutenticacion } from "../postgres/conexion-de-autenticacion";
import { pluginDeEstadoDeSesion } from "./plataforma/estado-de-sesion";
import { crearGanchosDeSegundoFactor, opcionesDelSegundoFactor } from "./plataforma/segundo-factor";
import { RUTAS_BLOQUEADAS, RUTAS_BLOQUEADAS_DE_PLATAFORMA } from "./rutas-bloqueadas";
import { hostGuardado } from "./sesion-leida";

/**
 * Las opciones de UNA instancia de Better Auth, la de un host de una audiencia (web-armazon §4.1 y §4.3; h5-p8 §2.1).
 * Todo lo que cambia entre hosts viene de `ConfiguracionDeHost`; lo que cambia entre audiencias (la web de empresa y
 * la consola de plataforma) está acá, en UN solo archivo y sin copiarlo: el prefijo de las cookies, el plugin
 * `twoFactor`, los límites de sesión y quién puede entrar. Cada opción responde a un riesgo que el ADR-013 o el spike
 * encontraron: el comentario dice cuál.
 */

/**
 * La conexión de la librería a su esquema: el Kysely del rol de autenticación, que arma
 * `adaptadores/postgres/conexion-de-autenticacion.ts`. Se toma de ahí (solo el tipo) y no del tipo de la
 * librería: ese pasa por un módulo de Bun que no existe acá y TypeScript lo vuelve irresoluble.
 */
export type BaseDeDatosDeLaLibreria = ConexionDeAutenticacion["db"];

export type AudienciaDeIngreso = "EMPRESA" | "PLATAFORMA";

/** Lo que solo la consola necesita, y que le inyecta su composición. */
export type DatosDeLaConsola = Readonly<{
  /** Quién es personal habilitado (`admin_plataforma`): la librería no ve esa tabla. */
  personal: PersonalHabilitado;
  /** Intentos, pasos de TOTP usados y marca de segundo factor (esquema `autenticacion`). */
  segundoFactor: SegundoFactorDeAutenticacion;
  /** Dónde se asienta el bloqueo del segundo factor. */
  auditoria: AuditoriaDeIngresoDePlataforma;
  /** Solo para las pruebas: el reloj con que se mide el paso de TOTP (la librería verifica con el real). */
  relojDeTotp?: () => Date;
}>;

export type ParametrosComunesDeInstancia = Readonly<{
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

export type ParametrosDeInstancia = ParametrosComunesDeInstancia &
  (
    | Readonly<{ audiencia?: "EMPRESA" }>
    | Readonly<{ audiencia: "PLATAFORMA"; consola: DatosDeLaConsola }>
  );

/** Código estable de la respuesta 401 de `/get-session` cuando la sesión no vale. */
const CODIGO_SESION_NO_VIGENTE = "SESION_NO_VIGENTE";

export function opcionesDeInstancia(p: ParametrosDeInstancia): BetterAuthOptions {
  const { host, baseURL, origenesConfiables } = p.configuracion;
  const consola = p.audiencia === "PLATAFORMA" ? p.consola : null;
  const ganchosDeSegundoFactor =
    consola === null
      ? null
      : crearGanchosDeSegundoFactor({
          secreto: p.secreto,
          host,
          limites: p.limites,
          reloj: p.reloj,
          ...(consola.relojDeTotp === undefined ? {} : { relojDeTotp: consola.relojDeTotp }),
          segundoFactor: consola.segundoFactor,
          auditoria: consola.auditoria,
          registrar: p.registrar,
        });
  const plugins: BetterAuthPlugin[] =
    consola === null
      ? []
      : [
          twoFactor(opcionesDelSegundoFactor(p.secreto)),
          pluginDeEstadoDeSesion({ host, limites: p.limites, reloj: p.reloj }),
        ];
  /** Fallar al decidir es «no habilitado»: un error de la base no puede dejar entrar a nadie. */
  const habilitado = async (email: string): Promise<boolean> => {
    if (consola === null) return true;
    try {
      return await consola.personal.esHabilitado(email);
    } catch (error) {
      p.registrar(
        `[ingreso] no se pudo consultar al personal habilitado: ${error instanceof Error ? error.name : "error"}`,
      );
      return false;
    }
  };
  return {
    appName: "Pedernal",
    // Origen FIJO de la instancia (nunca `allowedHosts` con `fallback`: un fallback haría caer un host en otra marca).
    baseURL,
    basePath: RUTA_BASE_DE_INGRESO,
    trustedOrigins: [...origenesConfiables],
    // Secreto propio de la audiencia (empresa y consola nunca comparten); nunca el de `BETTER_AUTH_SECRET` (prohibido en el entorno).
    secret: p.secreto,
    // Solo la consola tiene segundo factor (TOTP + códigos de recuperación) y estado de sesión; la web de empresa, ninguno.
    plugins,
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
      additionalFields: {
        // G4: la sesión recuerda en qué host nació. `input: false`: no se puede mandar desde afuera.
        host: { type: "string", required: true, input: false },
        // G1 (solo la consola): cuándo se verificó el segundo factor en ESTA sesión. Nace vacío; lo marca el gancho
        // posterior a verificar el código, nunca el cliente (`input: false`).
        ...(consola === null
          ? {}
          : {
              segundoFactorEn: {
                type: "date",
                required: false,
                input: false,
                fieldName: "segundo_factor_en",
              },
            }),
      },
    },
    advanced: {
      // M1: `__Host-pd_emp.<cookie>` en la web y `__Host-pd_plat.<cookie>` en la consola. La librería solo antepone
      // `__Secure-` por su cuenta, así que se apaga eso (`useSecureCookies: false`) y el prefijo `__Host-` va en el
      // nombre; el atributo `Secure` no depende de esa opción y lo fija `defaultCookieAttributes` (una prueba lo
      // comprueba). Sin `crossSubDomainCookies`: sin `Domain`. Prefijos distintos: una cookie de una audiencia no es la de la otra.
      cookiePrefix: `${PREFIJO_DE_NAVEGADOR}${consola === null ? PREFIJO_DE_COOKIE : PREFIJO_DE_COOKIE_DE_PLATAFORMA}`,
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
    disabledPaths: [...(consola === null ? RUTAS_BLOQUEADAS : RUTAS_BLOQUEADAS_DE_PLATAFORMA)],
    databaseHooks: {
      // La lista de personal habilitado, punto 1 (h5-p8 §2.2): un email que no es de personal activo no crea usuario.
      ...(consola === null
        ? {}
        : {
            user: {
              create: {
                before: async (usuario) =>
                  (await habilitado(usuario.email)) ? { data: usuario } : false,
              },
            },
          }),
      session: {
        create: {
          // G4: se guarda el host de la instancia (el que resolvió el servidor), nunca uno que mande el cliente.
          before:
            consola === null
              ? (sesion) => Promise.resolve({ data: { ...sesion, host } })
              : async (sesion, contexto) => {
                  // La lista de personal habilitado, punto 2: una baja posterior corta el ingreso siguiente. Se mira el
                  // email ACTUAL del usuario (el ingreso lo refresca con el de Google).
                  const usuario = await contexto?.context.internalAdapter.findUserById(
                    sesion.userId,
                  );
                  if (usuario === undefined || usuario === null) return false;
                  if (!(await habilitado(usuario.email))) return false;
                  // G1: una sesión nueva NO hereda el segundo factor de otra. Al verificar el primer código, la
                  // librería abre una sesión nueva en lugar de la actual: conserva cuándo nació (el tope de 8 horas
                  // se cuenta desde el ingreso, no se reinicia) y el gancho posterior la marca.
                  const previa = contexto?.context.session?.session;
                  const rotada =
                    previa !== undefined && previa !== null && previa.userId === sesion.userId;
                  const nacio = rotada ? previa.createdAt : sesion.createdAt;
                  return {
                    data: {
                      ...sesion,
                      host,
                      segundoFactorEn: null,
                      createdAt: nacio,
                      expiresAt: rotada
                        ? vencimientoRenovado(nacio, p.reloj(), p.limites)
                        : sesion.expiresAt,
                    },
                  };
                },
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
      // una sesión de otro host, vencida o pasada del tope de 8 horas no se lee ni se renueva. En la consola, además,
      // las barreras del segundo factor (G2, G3, intentos, enrolar) en las rutas del plugin.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/get-session") return ganchosDeSegundoFactor?.antes(ctx);
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
      ...(ganchosDeSegundoFactor === null
        ? {}
        : { after: createAuthMiddleware(async (ctx) => ganchosDeSegundoFactor.despues(ctx)) }),
    },
  };
}
