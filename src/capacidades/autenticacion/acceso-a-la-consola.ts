import type { AdminPlataformaId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { CodigoDePlataforma } from "./codigos-de-plataforma";
import {
  segundoFactorRecienteHastaMs,
  TOLERANCIA_DE_RELOJ_EN_MS,
} from "./ventanas-de-segundo-factor";
import {
  LIMITES_DE_SESION_DE_PLATAFORMA,
  vigenciaDeSesion,
  type LimitesDeSesion,
} from "./vigencia-de-sesion";

/**
 * Quién entra a la consola de plataforma y por qué se lo rechaza (h5-p8 §2.3). Funciones puras: el reloj y lo que se
 * leyó de la base entran como dato, así que se prueban y se mutan sin base ni espera. La puerta
 * (`composicion/sesion-de-plataforma.ts`) hace la lectura del administrador y llama a estas dos decisiones EN ESTE
 * ORDEN; el contexto firmado solo se arma si las dos dan `ok`.
 *
 * Previene: armar `ContextoDePlataforma` con algo menos que TODO junto: una sesión vigente en el host de la consola, el
 * email verificado, un administrador ACTIVO leído de la base y el segundo factor verificado en ESA sesión (G1: el
 * ingreso con Google solo no alcanza). Cada falta es uno de los códigos públicos de la lista cerrada, nunca un contexto
 * parcial ni una excepción; y un email que no es de personal habilitado recibe el mismo `no_habilitado` que en el
 * ingreso (sin oráculo de quién es personal), aunque además le falte el segundo factor.
 */

/** Lo que de la sesión importa para entrar a la consola (lo da el puerto `Autenticacion`). */
export type SesionParaLaConsola = Readonly<{
  /** El host en el que nació la sesión; sin él (o vacío) no se sabe de qué puerta es y no vale. */
  host?: string;
  emailVerificado: boolean;
  creadaEn: Date;
  ultimoUso: Date;
  venceEn: Date;
  /** Cuándo se verificó el segundo factor EN ESTA SESIÓN; `null` o ausente: nunca. */
  segundoFactorEn?: Date | null;
  /** Si el usuario ya tiene su TOTP enrolado y verificado; solo cambia QUÉ código se informa, nunca si entra. */
  segundoFactorEnrolado?: boolean;
}>;

/** El administrador tal como lo leyó la base (el rol no viaja desde el navegador). */
export type AdministradorLeido<R extends string = string> = Readonly<{
  id: AdminPlataformaId;
  rol: R;
  activo: boolean;
}>;

/**
 * Primer paso, sin tocar la base: la sesión tiene que valer en el host de la consola con los límites de plataforma
 * (8 horas absolutas y 30 minutos sin uso: la misma cuenta que `vigenciaDeSesion`, una sola decisión) y traer el email
 * verificado. Una sesión de otro host, vencida o sin host es `sesion_vencida`: de la consola solo se sale por el
 * ingreso. Un email sin verificar es `no_habilitado`, el genérico.
 */
export function decidirSesionDeLaConsola(
  sesion: SesionParaLaConsola,
  hostDeLaConsola: string,
  ahora: Date,
  limites: LimitesDeSesion = LIMITES_DE_SESION_DE_PLATAFORMA,
): Resultado<null, CodigoDePlataforma> {
  const vigencia = vigenciaDeSesion(
    {
      host: sesion.host,
      creadaEn: sesion.creadaEn,
      ultimoUso: sesion.ultimoUso,
      venceEn: sesion.venceEn,
    },
    hostDeLaConsola,
    ahora,
    limites,
  );
  if (vigencia !== "VIGENTE") return err("sesion_vencida");
  if (sesion.emailVerificado !== true) return err("no_habilitado");
  return ok(null);
}

export type AccesoDeLaConsola<R extends string = string> = Readonly<{
  adminId: AdminPlataformaId;
  /** El rol que leyó la base. Informa a la pantalla; autorizar lo hace el guard de cada caso, leyéndolo de nuevo. */
  rol: R;
  /** Cuándo se verificó el segundo factor de esta sesión (para exigirlo reciente en las acciones marcadas). */
  segundoFactorEn: Date;
  /** Lo que le queda a la ventana de 5 minutos del segundo factor, o 0. */
  segundoFactorRecienteHastaMs: number;
}>;

/**
 * Segundo paso, con el administrador ya leído: tiene que existir y estar ACTIVO (`no_habilitado`, el mismo para quien
 * nunca fue personal y para quien se dio de baja), y el segundo factor tiene que estar verificado en esta sesión (G1).
 * Sin él, `segundo_factor_a_enrolar` si todavía no tiene TOTP y `segundo_factor_requerido` si lo tiene. Una marca de
 * segundo factor en el futuro (más allá de la tolerancia del reloj) o inválida no cuenta: falla cerrado.
 */
export function decidirAccesoDelAdministrador<R extends string>(
  sesion: SesionParaLaConsola,
  admin: AdministradorLeido<R> | null,
  ahora: Date,
): Resultado<AccesoDeLaConsola<R>, CodigoDePlataforma> {
  if (admin === null || !admin.activo) return err("no_habilitado");
  const verificadoEn = sesion.segundoFactorEn ?? null;
  // `!(a <= b)` y no `a > b`: con una fecha inválida (NaN) las dos comparaciones dan falso y solo la primera falla cerrado.
  if (
    verificadoEn === null ||
    !(verificadoEn.getTime() <= ahora.getTime() + TOLERANCIA_DE_RELOJ_EN_MS)
  ) {
    return err(
      sesion.segundoFactorEnrolado === true
        ? "segundo_factor_requerido"
        : "segundo_factor_a_enrolar",
    );
  }
  return ok({
    adminId: admin.id,
    rol: admin.rol,
    segundoFactorEn: verificadoEn,
    segundoFactorRecienteHastaMs: segundoFactorRecienteHastaMs(verificadoEn, ahora),
  });
}
