import { APIError, isAPIError, type createAuthMiddleware } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import type { TwoFactorOptions } from "better-auth/plugins/two-factor";
import {
  CODIGO_DE_DEMASIADOS_INTENTOS,
  CODIGO_DE_ENROLAMIENTO_VENCIDO,
  CODIGO_DE_SEGUNDO_FACTOR_RECIENTE,
  CODIGO_DE_SESION_NO_VIGENTE,
} from "../../../capacidades/autenticacion/codigos-de-plataforma";
import { FORMA_DEL_CODIGO_DE_RECUPERACION } from "../../../capacidades/autenticacion/cuerpos-de-segundo-factor";
import {
  codificarCodigosDeRecuperacion,
  huellaDeCodigoDeRecuperacion,
  huellasGuardadas,
} from "../../../capacidades/autenticacion/codigos-de-recuperacion";
import { pasoDelCodigo } from "../../../capacidades/autenticacion/totp";
import {
  puedeEnrolar,
  segundoFactorReciente,
} from "../../../capacidades/autenticacion/ventanas-de-segundo-factor";
import {
  vigenciaDeSesion,
  type LimitesDeSesion,
} from "../../../capacidades/autenticacion/vigencia-de-sesion";
import type {
  AuditoriaDeIngresoDePlataforma,
  SegundoFactorDeAutenticacion,
} from "../../../puertos/segundo-factor-de-autenticacion";
import { hostGuardado, segundoFactorEnDe } from "../sesion-leida";

/**
 * Los ganchos y las opciones del segundo factor de la consola (h5-p8 §2.4), puestos alrededor del plugin `twoFactor`
 * de Better Auth 1.7.7. El plugin trae las rutas, el esquema, el cifrado del secreto y los códigos de recuperación; lo
 * que NO hace con el ingreso por Google (el ADR-013 lo encontró con el spike) se cierra acá:
 *
 *  - G1: el ingreso con Google no pasa por el gancho del plugin (que solo mira el ingreso por email, usuario o
 *    teléfono). La sesión nace SIN segundo factor y se marca `segundo_factor_en` al verificar el código.
 *  - G2: un código TOTP usado no se acepta de nuevo en su ventana de tiempo (registro del paso con clave única).
 *  - G3: ver el secreto, emitir códigos nuevos y dar de baja el TOTP exigen segundo factor verificado hace 5 minutos
 *    o menos (403). El plugin las deja abiertas a cualquier sesión.
 *  - Límite de intentos: 5 fallidos en 10 minutos bloquean 15 (en la sesión del plugin no hay ninguno).
 *  - Enrolar: solo en los primeros 10 minutos de la sesión y solo si todavía no hay TOTP verificado.
 *  - Los códigos de recuperación se guardan hasheados (la librería ofrece «claro» o «cifrado»).
 *
 * Cada barrera responde con un error cuyo código mapea `codigoPublicoDeErrorDePlataforma`.
 */

export type DependenciasDeSegundoFactor = Readonly<{
  /** El secreto de la audiencia: con él se hashean los códigos de recuperación. */
  secreto: string;
  host: string;
  limites: LimitesDeSesion;
  reloj: () => Date;
  /** El reloj con el que se mide el paso de TOTP: la librería verifica con el real (`Date.now`), y se lo imita. */
  relojDeTotp?: () => Date;
  segundoFactor: SegundoFactorDeAutenticacion;
  auditoria: AuditoriaDeIngresoDePlataforma;
  registrar: (detalle: string) => void;
}>;

/** El nombre con el que la aplicación autenticadora muestra la cuenta. */
export const EMISOR_DEL_TOTP = "Pedernal Plataforma";
export const CANTIDAD_DE_CODIGOS_DE_RECUPERACION = 10;

/** Las opciones del plugin `twoFactor`: TOTP + 10 códigos de recuperación hasheados; sin OTP por mail, sin dispositivo de confianza. */
export function opcionesDelSegundoFactor(secreto: string): TwoFactorOptions {
  return {
    issuer: EMISOR_DEL_TOTP,
    // Todos los usuarios entran por Google: no hay contraseña. Sin esto la librería la exigiría para enrolar.
    allowPasswordless: true,
    backupCodeOptions: {
      amount: CANTIDAD_DE_CODIGOS_DE_RECUPERACION,
      length: 10,
      allowPasswordless: true,
      storeBackupCodes: {
        encrypt: (lista) => Promise.resolve(codificarCodigosDeRecuperacion(secreto, lista)),
        // Lo guardado ya es la lista de huellas: la librería la compara con la huella del código que llegó.
        decrypt: (guardado) => Promise.resolve(guardado),
      },
    },
  };
}

/** El código que mandó la persona (un texto; cualquier otra cosa es «sin código»). */
const codigoDeEntrada = (cuerpo: unknown): string => {
  const codigo = (cuerpo as { code?: unknown } | undefined)?.code;
  return typeof codigo === "string" ? codigo : "";
};

const RUTA = {
  enrolar: "/two-factor/enable",
  totp: "/two-factor/verify-totp",
  recuperacion: "/two-factor/verify-backup-code",
  regenerar: "/two-factor/generate-backup-codes",
  verSecreto: "/two-factor/get-totp-uri",
  darDeBaja: "/two-factor/disable",
} as const;

/** Las rutas que exigen segundo factor reciente (G3). */
const RUTAS_DE_GESTION: readonly string[] = [RUTA.regenerar, RUTA.verSecreto, RUTA.darDeBaja];

const sesionNoVigente = () =>
  new APIError("UNAUTHORIZED", {
    code: CODIGO_DE_SESION_NO_VIGENTE,
    message: "La sesión no está vigente",
  });

export function crearGanchosDeSegundoFactor(d: DependenciasDeSegundoFactor) {
  const relojDeTotp = d.relojDeTotp ?? (() => new Date());

  type Ctx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

  /** La sesión del pedido si vale en este host (G4, G5); `null` si no. Sin renovarla. */
  async function sesionVigenteDelPedido(ctx: Ctx) {
    const token = await ctx.getSignedCookie(
      ctx.context.authCookies.sessionToken.name,
      ctx.context.secret,
    );
    if (typeof token !== "string" || token === "") return null;
    const encontrada = await ctx.context.internalAdapter.findSession(token);
    if (encontrada === null) return null;
    const s = encontrada.session;
    const vigencia = vigenciaDeSesion(
      {
        host: hostGuardado(s),
        creadaEn: s.createdAt,
        ultimoUso: s.updatedAt,
        venceEn: s.expiresAt,
      },
      d.host,
      d.reloj(),
      d.limites,
    );
    return vigencia === "VIGENTE" ? encontrada : null;
  }

  async function filaDelSegundoFactor(ctx: Ctx, usuario: string) {
    return ctx.context.adapter.findOne<{
      secret: string;
      backupCodes: string;
      verified: boolean | null;
    }>({
      model: "twoFactor",
      where: [{ field: "userId", value: usuario }],
    });
  }

  function demasiadosIntentos(hasta: Date): APIError {
    return new APIError("TOO_MANY_REQUESTS", {
      code: CODIGO_DE_DEMASIADOS_INTENTOS,
      message: "Demasiados intentos",
      reintentarEnMs: Math.max(0, hasta.getTime() - d.reloj().getTime()),
    });
  }

  /** El bloqueo se asienta en la auditoría de plataforma; si eso falla, el bloqueo igual rige y se registra el fallo. */
  async function asentarElBloqueo(email: string, hasta: Date, fallos: number): Promise<void> {
    try {
      await d.auditoria.registrarBloqueoDeSegundoFactor({ email, hasta, fallos });
    } catch (error) {
      d.registrar(
        `[ingreso] no se pudo auditar el bloqueo del segundo factor: ${error instanceof Error ? error.name : "error"}`,
      );
    }
  }

  /** Un código del TOTP: bloqueo, paso usado (G2) y verificación, en un solo intento serializado. */
  async function verificarTotp(ctx: Ctx, usuario: string, email: string): Promise<void> {
    const fila = await filaDelSegundoFactor(ctx, usuario);
    if (fila === null)
      throw new APIError("BAD_REQUEST", { code: "TOTP_NOT_ENABLED", message: "TOTP not enabled" });
    const secreto = await symmetricDecrypt({ key: ctx.context.secretConfig, data: fila.secret });
    const codigo = codigoDeEntrada(ctx.body);
    const ahora = d.reloj();
    const r = await d.segundoFactor.intentarCodigo(usuario, ahora, async (tx) => {
      const paso = pasoDelCodigo(secreto, codigo, relojDeTotp());
      return paso !== null && (await tx.registrarPasoUsado(paso));
    });
    if (r.tipo === "BLOQUEADO") throw demasiadosIntentos(r.hasta);
    if (r.tipo === "INVALIDO") {
      if (r.bloqueoNuevo !== null)
        await asentarElBloqueo(email, r.bloqueoNuevo.hasta, r.bloqueoNuevo.fallos);
      // El mismo error para un código equivocado y para uno repetido: no se le dice cuál fue.
      throw new APIError("UNAUTHORIZED", { code: "INVALID_CODE", message: "Invalid code" });
    }
  }

  /** Un código de recuperación: bloqueo y comparación de su huella; devuelve la huella con la que la librería lo gasta. */
  async function verificarRecuperacion(ctx: Ctx, usuario: string, email: string): Promise<string> {
    const fila = await filaDelSegundoFactor(ctx, usuario);
    const guardadas = fila === null ? null : huellasGuardadas(fila.backupCodes);
    if (guardadas === null) {
      throw new APIError("BAD_REQUEST", {
        code: "BACKUP_CODES_NOT_ENABLED",
        message: "Backup codes aren't enabled",
      });
    }
    const codigo = codigoDeEntrada(ctx.body);
    const huella = FORMA_DEL_CODIGO_DE_RECUPERACION.test(codigo)
      ? huellaDeCodigoDeRecuperacion(d.secreto, codigo)
      : null;
    const r = await d.segundoFactor.intentarCodigo(usuario, d.reloj(), async () =>
      Promise.resolve(huella !== null && guardadas.includes(huella)),
    );
    if (r.tipo === "BLOQUEADO") throw demasiadosIntentos(r.hasta);
    if (r.tipo === "INVALIDO" || huella === null) {
      if (r.tipo === "INVALIDO" && r.bloqueoNuevo !== null) {
        await asentarElBloqueo(email, r.bloqueoNuevo.hasta, r.bloqueoNuevo.fallos);
      }
      throw new APIError("UNAUTHORIZED", {
        code: "INVALID_BACKUP_CODE",
        message: "Invalid backup code",
      });
    }
    return huella;
  }

  const antes = async (ctx: Ctx) => {
    const ruta = ctx.path;
    const esDelSegundoFactor = Object.values<string>(RUTA).includes(ruta);
    if (!esDelSegundoFactor) return undefined;
    const encontrada = await sesionVigenteDelPedido(ctx);
    if (encontrada === null) throw sesionNoVigente();
    const { session, user } = encontrada;
    const ahora = d.reloj();

    if (
      RUTAS_DE_GESTION.includes(ruta) &&
      !segundoFactorReciente(segundoFactorEnDe(session), ahora)
    ) {
      throw new APIError("FORBIDDEN", {
        code: CODIGO_DE_SEGUNDO_FACTOR_RECIENTE,
        message: "Hace falta verificar el segundo factor de nuevo",
      });
    }
    if (ruta === RUTA.enrolar) {
      if (user.twoFactorEnabled === true) {
        throw new APIError("BAD_REQUEST", {
          code: "TOTP_ALREADY_ENABLED",
          message: "TOTP is already enabled",
        });
      }
      if (!puedeEnrolar(session.createdAt, ahora)) {
        throw new APIError("FORBIDDEN", {
          code: CODIGO_DE_ENROLAMIENTO_VENCIDO,
          message: "La sesión es demasiado vieja para enrolar el segundo factor",
        });
      }
    }
    if (ruta === RUTA.totp) {
      await verificarTotp(ctx, user.id, user.email);
    }
    if (ruta === RUTA.recuperacion) {
      // Con el TOTP todavía sin verificar no hay segundo factor que reemplazar: un código de recuperación no lo prueba.
      if (user.twoFactorEnabled !== true) {
        throw new APIError("BAD_REQUEST", {
          code: "TWO_FACTOR_NOT_ENABLED",
          message: "Two factor isn't enabled",
        });
      }
      const huella = await verificarRecuperacion(ctx, user.id, user.email);
      // La librería busca el código en la lista guardada (de huellas): se le da la huella.
      return { context: { body: { code: huella } } };
    }
    return undefined;
  };

  const despues = async (ctx: Ctx) => {
    if (ctx.path !== RUTA.totp && ctx.path !== RUTA.recuperacion) return;
    const devuelto: unknown = ctx.context.returned;
    if (
      devuelto === undefined ||
      devuelto === null ||
      isAPIError(devuelto) ||
      devuelto instanceof Error
    )
      return;
    // Al verificar el PRIMER código la librería abre una sesión nueva y borra la anterior: la marca va en la nueva.
    const token = ctx.context.newSession?.session.token ?? ctx.context.session?.session.token;
    const marcada =
      token === undefined ? false : await d.segundoFactor.marcarSegundoFactor(token, d.reloj());
    if (!marcada) {
      d.registrar("[ingreso] el segundo factor se verificó pero no se pudo marcar la sesión");
      throw new APIError("INTERNAL_SERVER_ERROR", { message: "No se pudo marcar la sesión" });
    }
  };

  return { antes, despues };
}
