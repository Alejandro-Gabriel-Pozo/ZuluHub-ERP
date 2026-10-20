import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import {
  SIN_SESION_DE_PLATAFORMA,
  estadoDeSesionDePlataforma,
} from "../../../capacidades/autenticacion/estado-de-sesion-de-plataforma";
import {
  vigenciaDeSesion,
  type LimitesDeSesion,
} from "../../../capacidades/autenticacion/vigencia-de-sesion";
import { hostGuardado, segundoFactorEnDe } from "../sesion-leida";

/**
 * `GET /api/auth/estado-de-sesion` (h5-p8 §3): el estado de la sesión de la consola SIN renovarla. Lo mira la pantalla
 * para avisar antes del vencimiento y para pedir el código cuando el segundo factor ya es viejo; si mirar renovara la
 * sesión, el aviso de inactividad no llegaría nunca. No borra ni cambia nada: es solo lectura. Responde siempre 200:
 * sin sesión, con una de otro host o con el email sin verificar es `vigente: false`.
 */
export function pluginDeEstadoDeSesion(d: {
  host: string;
  limites: LimitesDeSesion;
  reloj: () => Date;
}): BetterAuthPlugin {
  return {
    id: "estado-de-sesion-de-plataforma",
    endpoints: {
      estadoDeSesionDePlataforma: createAuthEndpoint(
        "/estado-de-sesion",
        { method: "GET", requireHeaders: true },
        async (ctx) => {
          ctx.setHeader("cache-control", "no-store");
          const token = await ctx.getSignedCookie(
            ctx.context.authCookies.sessionToken.name,
            ctx.context.secret,
          );
          if (typeof token !== "string" || token === "") return ctx.json(SIN_SESION_DE_PLATAFORMA);
          const encontrada = await ctx.context.internalAdapter.findSession(token);
          if (encontrada === null || encontrada.user.emailVerified !== true) {
            return ctx.json(SIN_SESION_DE_PLATAFORMA);
          }
          const s = encontrada.session;
          const ahora = d.reloj();
          const sesion = {
            creadaEn: s.createdAt,
            ultimoUso: s.updatedAt,
            venceEn: s.expiresAt,
            segundoFactorEn: segundoFactorEnDe(s),
          };
          const delHost = vigenciaDeSesion(
            { host: hostGuardado(s), ...sesion },
            d.host,
            ahora,
            d.limites,
          );
          return ctx.json(
            delHost === "OTRO_HOST"
              ? SIN_SESION_DE_PLATAFORMA
              : estadoDeSesionDePlataforma(sesion, ahora, d.limites),
          );
        },
      ),
    },
  };
}
