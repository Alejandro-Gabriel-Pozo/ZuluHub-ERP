import { describe, expect, it } from "vitest";
import { adminPlataformaId } from "../../primitivas/identificadores/marca";
import {
  decidirAccesoDelAdministrador,
  decidirSesionDeLaConsola,
  type AdministradorLeido,
  type SesionParaLaConsola,
} from "./acceso-a-la-consola";
import { CODIGOS_DE_PLATAFORMA } from "./codigos-de-plataforma";
import { TOLERANCIA_DE_RELOJ_EN_MS } from "./ventanas-de-segundo-factor";

/**
 * Quién entra a la consola (h5-p8 §2.3): cada falta es uno de los 7 códigos públicos, en un orden fijo, y un email que no
 * es personal habilitado recibe siempre el genérico, aunque además le falte el segundo factor. Sin base ni espera.
 */

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;
const AHORA = new Date("2026-10-20T12:00:00.000Z");
const hace = (ms: number) => new Date(AHORA.getTime() - ms);
const HOST = "consola.example.test";
const ADMIN_ID = adminPlataformaId("aaaaaaaa-0000-4000-8000-000000000009");
const INVALIDA = new Date("no es una fecha");

const sesion = (cambios: Partial<SesionParaLaConsola> = {}): SesionParaLaConsola => ({
  host: HOST,
  emailVerificado: true,
  creadaEn: hace(10 * MINUTO),
  ultimoUso: hace(1 * MINUTO),
  venceEn: new Date(AHORA.getTime() + 29 * MINUTO),
  segundoFactorEn: hace(2 * MINUTO),
  segundoFactorEnrolado: true,
  ...cambios,
});

const admin = (cambios: Partial<AdministradorLeido<"ADMIN" | "SOPORTE">> = {}) =>
  ({ id: ADMIN_ID, rol: "ADMIN", activo: true, ...cambios }) as AdministradorLeido<
    "ADMIN" | "SOPORTE"
  >;

describe("decidirSesionDeLaConsola", () => {
  it("una sesión vigente, del host de la consola y con el email verificado, pasa", () => {
    expect(decidirSesionDeLaConsola(sesion(), HOST, AHORA)).toEqual({ ok: true, valor: null });
  });

  it("una sesión de otro host, o sin host, es sesion_vencida (de la consola solo se sale por el ingreso)", () => {
    for (const host of ["app.example.test", "", "CONSOLA.example.test", " consola.example.test"]) {
      expect(decidirSesionDeLaConsola(sesion({ host }), HOST, AHORA), host).toEqual({
        ok: false,
        error: "sesion_vencida",
      });
    }
    const sinHost: SesionParaLaConsola = { ...sesion(), host: undefined } as never;
    delete (sinHost as { host?: string }).host;
    expect(decidirSesionDeLaConsola(sinHost, HOST, AHORA)).toEqual({
      ok: false,
      error: "sesion_vencida",
    });
    // El host de la consola vacío tampoco deja entrar a una sesión sin host.
    expect(decidirSesionDeLaConsola(sesion({ host: "" }), "", AHORA).ok).toBe(false);
  });

  it("los límites son los de PLATAFORMA: 30 minutos de inactividad (no 15) y 8 horas absolutas", () => {
    // 20 minutos sin uso: vale en la consola (en la web de empresa ya habría vencido).
    const veinte = sesion({
      ultimoUso: hace(20 * MINUTO),
      creadaEn: hace(HORA),
      venceEn: new Date(AHORA.getTime() + 10 * MINUTO),
    });
    expect(decidirSesionDeLaConsola(veinte, HOST, AHORA).ok).toBe(true);
    // 30 minutos exactos sin uso: ya venció; un milisegundo antes, no.
    expect(decidirSesionDeLaConsola(sesion({ ultimoUso: hace(30 * MINUTO) }), HOST, AHORA)).toEqual(
      { ok: false, error: "sesion_vencida" },
    );
    expect(
      decidirSesionDeLaConsola(sesion({ ultimoUso: hace(30 * MINUTO - 1) }), HOST, AHORA).ok,
    ).toBe(true);
    // Tope de 8 horas desde que se creó, aunque se use sin parar.
    expect(decidirSesionDeLaConsola(sesion({ creadaEn: hace(8 * HORA) }), HOST, AHORA)).toEqual({
      ok: false,
      error: "sesion_vencida",
    });
    expect(decidirSesionDeLaConsola(sesion({ creadaEn: hace(8 * HORA - 1) }), HOST, AHORA).ok).toBe(
      true,
    );
  });

  it("el vencimiento guardado en la base también corta (en el instante exacto, ya venció)", () => {
    expect(decidirSesionDeLaConsola(sesion({ venceEn: AHORA }), HOST, AHORA)).toEqual({
      ok: false,
      error: "sesion_vencida",
    });
    expect(
      decidirSesionDeLaConsola(sesion({ venceEn: new Date(AHORA.getTime() + 1) }), HOST, AHORA).ok,
    ).toBe(true);
  });

  it("fechas inválidas no valen (falla cerrado)", () => {
    for (const cambios of [
      { creadaEn: INVALIDA },
      { ultimoUso: INVALIDA },
      { venceEn: INVALIDA },
    ]) {
      expect(decidirSesionDeLaConsola(sesion(cambios), HOST, AHORA)).toEqual({
        ok: false,
        error: "sesion_vencida",
      });
    }
    expect(decidirSesionDeLaConsola(sesion(), HOST, INVALIDA)).toEqual({
      ok: false,
      error: "sesion_vencida",
    });
  });

  it("el email sin verificar es el genérico no_habilitado", () => {
    expect(decidirSesionDeLaConsola(sesion({ emailVerificado: false }), HOST, AHORA)).toEqual({
      ok: false,
      error: "no_habilitado",
    });
  });

  it("si la sesión venció Y el email no está verificado, manda sesion_vencida", () => {
    expect(
      decidirSesionDeLaConsola(
        sesion({ emailVerificado: false, ultimoUso: hace(HORA) }),
        HOST,
        AHORA,
      ),
    ).toEqual({ ok: false, error: "sesion_vencida" });
  });
});

describe("decidirAccesoDelAdministrador", () => {
  it("un administrador activo con el segundo factor verificado en la sesión entra, con su id y el rol de la base", () => {
    expect(decidirAccesoDelAdministrador(sesion(), admin({ rol: "SOPORTE" }), AHORA)).toEqual({
      ok: true,
      valor: {
        adminId: ADMIN_ID,
        rol: "SOPORTE",
        segundoFactorEn: hace(2 * MINUTO),
        segundoFactorRecienteHastaMs: 3 * MINUTO,
      },
    });
  });

  it("informa cuánto le queda a la ventana de 5 minutos (0 si ya no es reciente, sin que eso lo saque)", () => {
    const vieja = decidirAccesoDelAdministrador(
      sesion({ segundoFactorEn: hace(HORA) }),
      admin(),
      AHORA,
    );
    expect(vieja).toEqual({
      ok: true,
      valor: {
        adminId: ADMIN_ID,
        rol: "ADMIN",
        segundoFactorEn: hace(HORA),
        segundoFactorRecienteHastaMs: 0,
      },
    });
  });

  it("sin administrador, o dado de baja, es el genérico no_habilitado (el mismo que ve quien nunca fue personal)", () => {
    expect(decidirAccesoDelAdministrador(sesion(), null, AHORA)).toEqual({
      ok: false,
      error: "no_habilitado",
    });
    expect(decidirAccesoDelAdministrador(sesion(), admin({ activo: false }), AHORA)).toEqual({
      ok: false,
      error: "no_habilitado",
    });
  });

  it("un no habilitado recibe no_habilitado AUNQUE le falte el segundo factor (no se le dice si tiene TOTP)", () => {
    for (const enrolado of [true, false]) {
      expect(
        decidirAccesoDelAdministrador(
          sesion({ segundoFactorEn: null, segundoFactorEnrolado: enrolado }),
          null,
          AHORA,
        ),
      ).toEqual({ ok: false, error: "no_habilitado" });
      expect(
        decidirAccesoDelAdministrador(
          sesion({ segundoFactorEn: null, segundoFactorEnrolado: enrolado }),
          admin({ activo: false }),
          AHORA,
        ),
      ).toEqual({ ok: false, error: "no_habilitado" });
    }
  });

  it("sin segundo factor en la sesión: a verificar si ya tiene TOTP, a enrolar si no", () => {
    expect(
      decidirAccesoDelAdministrador(
        sesion({ segundoFactorEn: null, segundoFactorEnrolado: true }),
        admin(),
        AHORA,
      ),
    ).toEqual({ ok: false, error: "segundo_factor_requerido" });
    for (const enrolado of [false, undefined]) {
      const s: SesionParaLaConsola = sesion({ segundoFactorEn: null });
      if (enrolado === undefined) {
        delete (s as { segundoFactorEnrolado?: boolean }).segundoFactorEnrolado;
      } else {
        (s as { segundoFactorEnrolado?: boolean }).segundoFactorEnrolado = enrolado;
      }
      expect(decidirAccesoDelAdministrador(s, admin(), AHORA)).toEqual({
        ok: false,
        error: "segundo_factor_a_enrolar",
      });
    }
  });

  it("el segundo factor ausente (campo omitido) es lo mismo que nulo", () => {
    const sin: SesionParaLaConsola = sesion();
    delete (sin as { segundoFactorEn?: Date | null }).segundoFactorEn;
    expect(decidirAccesoDelAdministrador(sin, admin(), AHORA)).toEqual({
      ok: false,
      error: "segundo_factor_requerido",
    });
  });

  it("una marca de segundo factor VIEJA igual cuenta como verificada (la edad la exige cada acción marcada, no la entrada)", () => {
    expect(
      decidirAccesoDelAdministrador(sesion({ segundoFactorEn: hace(7 * HORA) }), admin(), AHORA).ok,
    ).toBe(true);
  });

  it("una marca en el futuro más allá de la tolerancia del reloj, o inválida, no cuenta (falla cerrado)", () => {
    const enElFuturo = (ms: number) => new Date(AHORA.getTime() + ms);
    expect(
      decidirAccesoDelAdministrador(
        sesion({ segundoFactorEn: enElFuturo(TOLERANCIA_DE_RELOJ_EN_MS) }),
        admin(),
        AHORA,
      ).ok,
    ).toBe(true);
    for (const marca of [
      enElFuturo(TOLERANCIA_DE_RELOJ_EN_MS + 1),
      enElFuturo(24 * HORA),
      INVALIDA,
    ]) {
      expect(
        decidirAccesoDelAdministrador(sesion({ segundoFactorEn: marca }), admin(), AHORA),
        String(marca),
      ).toEqual({ ok: false, error: "segundo_factor_requerido" });
    }
  });

  it("todo error es uno de los 7 códigos públicos de la consola", () => {
    const errores = [
      decidirSesionDeLaConsola(sesion({ host: "otro" }), HOST, AHORA),
      decidirSesionDeLaConsola(sesion({ emailVerificado: false }), HOST, AHORA),
      decidirAccesoDelAdministrador(sesion(), null, AHORA),
      decidirAccesoDelAdministrador(sesion({ segundoFactorEn: null }), admin(), AHORA),
      decidirAccesoDelAdministrador(
        sesion({ segundoFactorEn: null, segundoFactorEnrolado: false }),
        admin(),
        AHORA,
      ),
    ].map((r) => (r.ok ? null : r.error));
    for (const error of errores) expect(CODIGOS_DE_PLATAFORMA).toContain(error);
  });
});
