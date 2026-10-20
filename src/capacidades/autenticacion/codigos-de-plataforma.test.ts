import { describe, expect, it } from "vitest";
import { sanearUbicacionDeError } from "./codigos-de-ingreso";
import {
  CODIGOS_DE_PLATAFORMA,
  CODIGO_DE_DEMASIADOS_INTENTOS,
  CODIGO_DE_ENROLAMIENTO_VENCIDO,
  CODIGO_DE_PLATAFORMA_GENERICO,
  CODIGO_DE_SEGUNDO_FACTOR_RECIENTE,
  CODIGO_DE_SESION_NO_VIGENTE,
  codigoPublicoDeErrorDePlataforma,
  codigoPublicoDeIngresoDePlataforma,
} from "./codigos-de-plataforma";

describe("CODIGOS_DE_PLATAFORMA (h5-p8 §3, lista cerrada)", () => {
  it("son exactamente los siete del spec, en minúsculas", () => {
    expect([...CODIGOS_DE_PLATAFORMA]).toEqual([
      "no_habilitado",
      "segundo_factor_requerido",
      "segundo_factor_a_enrolar",
      "codigo_invalido",
      "demasiados_intentos",
      "segundo_factor_reciente_requerido",
      "sesion_vencida",
    ]);
    for (const c of CODIGOS_DE_PLATAFORMA) expect(c).toBe(c.toLowerCase());
    expect(CODIGO_DE_PLATAFORMA_GENERICO).toBe("no_habilitado");
  });
});

describe("codigoPublicoDeIngresoDePlataforma (el canal ?error= del retorno de Google)", () => {
  it.each(CODIGOS_DE_PLATAFORMA)("el código de la lista (%s) pasa tal cual", (codigo) => {
    expect(codigoPublicoDeIngresoDePlataforma(codigo)).toBe(codigo);
  });

  it.each([
    "access_denied",
    "state_mismatch",
    "unable_to_create_user",
    "unable_to_create_session",
    "email_no_verificado",
    "account_not_linked",
    "internal_server_error",
    "error_de_ingreso",
    "NO_HABILITADO",
    "no_habilitado ",
    "<script>",
    "constructor",
    "__proto__",
    "",
  ])("cualquier otro (%j) se vuelve el genérico: no_habilitado", (codigo) => {
    expect(codigoPublicoDeIngresoDePlataforma(codigo)).toBe("no_habilitado");
  });

  it("sin código (null) también es el genérico", () => {
    expect(codigoPublicoDeIngresoDePlataforma(null)).toBe("no_habilitado");
  });

  it("sirve para sanear el Location de la librería: solo el código público, sin descripción ni otros parámetros", () => {
    const origen = "https://consola.example.test";
    expect(
      sanearUbicacionDeError(
        `${origen}/ingreso?error=unable_to_create_user&error_description=detalle+interno#x`,
        origen,
        codigoPublicoDeIngresoDePlataforma,
      ),
    ).toBe(`${origen}/ingreso?error=no_habilitado`);
    expect(
      sanearUbicacionDeError(
        "/ingreso?error=access_denied",
        origen,
        codigoPublicoDeIngresoDePlataforma,
      ),
    ).toBe("/ingreso?error=no_habilitado");
    // Sin error, no se toca.
    expect(sanearUbicacionDeError("/panel", origen, codigoPublicoDeIngresoDePlataforma)).toBe(
      "/panel",
    );
  });
});

describe("codigoPublicoDeErrorDePlataforma (las rutas del segundo factor)", () => {
  it("el código que la librería manda y el nuestro se vuelven uno público", () => {
    const casos: [number, string, string][] = [
      [401, "INVALID_CODE", "codigo_invalido"],
      [401, "INVALID_BACKUP_CODE", "codigo_invalido"],
      [400, "TOTP_NOT_ENABLED", "segundo_factor_a_enrolar"],
      [400, "BACKUP_CODES_NOT_ENABLED", "segundo_factor_a_enrolar"],
      [400, "TWO_FACTOR_NOT_ENABLED", "segundo_factor_a_enrolar"],
      [400, "TOTP_ALREADY_ENABLED", "segundo_factor_requerido"],
      [403, CODIGO_DE_SEGUNDO_FACTOR_RECIENTE, "segundo_factor_reciente_requerido"],
      [403, CODIGO_DE_ENROLAMIENTO_VENCIDO, "sesion_vencida"],
      [401, CODIGO_DE_SESION_NO_VIGENTE, "sesion_vencida"],
      [401, "UNAUTHORIZED", "sesion_vencida"],
      [401, "INVALID_TWO_FACTOR_COOKIE", "sesion_vencida"],
      [429, CODIGO_DE_DEMASIADOS_INTENTOS, "demasiados_intentos"],
    ];
    for (const [estado, codigo, esperado] of casos) {
      expect(codigoPublicoDeErrorDePlataforma(estado, codigo), `${estado} ${codigo}`).toBe(
        esperado,
      );
    }
  });

  it("los códigos propios tienen el texto que viaja por la librería", () => {
    expect(CODIGO_DE_SEGUNDO_FACTOR_RECIENTE).toBe("SEGUNDO_FACTOR_RECIENTE_REQUERIDO");
    expect(CODIGO_DE_ENROLAMIENTO_VENCIDO).toBe("ENROLAMIENTO_VENCIDO");
    expect(CODIGO_DE_DEMASIADOS_INTENTOS).toBe("DEMASIADOS_INTENTOS");
    expect(CODIGO_DE_SESION_NO_VIGENTE).toBe("SESION_NO_VIGENTE");
  });

  it("el estado 429 siempre es demasiados_intentos (también el límite de pedidos de la librería) y el 409 es código inválido", () => {
    expect(codigoPublicoDeErrorDePlataforma(429, "RATE_LIMITED")).toBe("demasiados_intentos");
    expect(codigoPublicoDeErrorDePlataforma(429, "SOLICITUD_INVALIDA")).toBe("demasiados_intentos");
    expect(codigoPublicoDeErrorDePlataforma(409, "CONFLICT")).toBe("codigo_invalido");
    expect(codigoPublicoDeErrorDePlataforma(409, "")).toBe("codigo_invalido");
  });

  it.each([
    [400, "VALIDATION_ERROR"],
    [400, "SOLICITUD_INVALIDA"],
    [403, "INVALID_ORIGIN"],
    [403, "MISSING_OR_NULL_ORIGIN"],
    [500, "FAILED_TO_GET_SESSION"],
    [401, "ALGO_NUEVO_DE_UNA_VERSION_FUTURA"],
    [400, "constructor"],
    [400, "__proto__"],
    [400, "toString"],
    [400, "hasOwnProperty"],
    [418, ""],
  ])(
    "lo que no se conoce (%i %j) es el genérico: nunca se reenvía texto de la librería",
    (estado, codigo) => {
      expect(codigoPublicoDeErrorDePlataforma(estado, codigo)).toBe("no_habilitado");
    },
  );

  it("todo lo que devuelve está en la lista cerrada", () => {
    const entradas: [number, string][] = [
      [400, "TOTP_NOT_ENABLED"],
      [401, "INVALID_CODE"],
      [403, "x"],
      [429, "x"],
      [409, "x"],
      [500, "x"],
    ];
    for (const [estado, codigo] of entradas) {
      expect(CODIGOS_DE_PLATAFORMA as readonly string[]).toContain(
        codigoPublicoDeErrorDePlataforma(estado, codigo),
      );
    }
  });
});

describe("el código propio de demasiados intentos", () => {
  it("vale como demasiados_intentos con cualquier estado (no solo el 429)", () => {
    for (const estado of [400, 401, 403]) {
      expect(codigoPublicoDeErrorDePlataforma(estado, CODIGO_DE_DEMASIADOS_INTENTOS)).toBe(
        "demasiados_intentos",
      );
    }
    expect(CODIGO_DE_DEMASIADOS_INTENTOS).toBe("DEMASIADOS_INTENTOS");
  });
});
