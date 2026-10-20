import { describe, expect, it } from "vitest";
import { LIMITES_DE_SESION } from "../../../capacidades/autenticacion/vigencia-de-sesion";
import { RUTA, politicaDePlataforma } from "./respuestas";

const AHORA = new Date("2026-10-20T12:00:00.000Z");
const MINUTO = 60_000;
const politica = politicaDePlataforma({ reloj: () => AHORA });
const SECRETO = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const DIRECCION = `otpauth://totp/Pedernal%20Plataforma:ana%40ejemplo.test?secret=${SECRETO}&issuer=Pedernal%20Plataforma&digits=6&period=30`;
const CODIGOS = Array.from({ length: 10 }, (_, i) => `abcd${i}-EFGH${i}`);

const respuesta = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "content-type": "application/json" },
  });
const cabecerasDe = (r: Response) => new Headers(r.headers);

describe("RUTA", () => {
  it("las rutas de plataforma, con su base /api/auth", () => {
    expect(RUTA).toEqual({
      ingresoSocial: "/api/auth/sign-in/social",
      sesion: "/api/auth/get-session",
      enrolar: "/api/auth/two-factor/enable",
      totp: "/api/auth/two-factor/verify-totp",
      recuperacion: "/api/auth/two-factor/verify-backup-code",
      regenerar: "/api/auth/two-factor/generate-backup-codes",
    });
  });
});

describe("rechazarCuerpo: cuerpos cerrados antes de tocar la librería", () => {
  const rechazo = (metodo: string, ruta: string, cuerpo: string) =>
    politica.rechazarCuerpo(metodo, ruta, cuerpo);

  it("un cuerpo válido pasa (null) en cada ruta", () => {
    expect(
      rechazo("POST", RUTA.ingresoSocial, '{"provider":"google","callbackURL":"/"}'),
    ).toBeNull();
    expect(rechazo("POST", RUTA.totp, '{"code":"123456"}')).toBeNull();
    expect(rechazo("POST", RUTA.recuperacion, '{"code":"abcde-12345"}')).toBeNull();
    expect(rechazo("POST", RUTA.enrolar, "{}")).toBeNull();
    expect(rechazo("POST", RUTA.regenerar, "{}")).toBeNull();
  });

  it("las demás rutas y los GET no se revisan (cerrar sesión puede traer cualquier cuerpo)", () => {
    expect(rechazo("POST", "/api/auth/sign-out", "cualquier cosa")).toBeNull();
    expect(rechazo("GET", RUTA.totp, "cualquier cosa")).toBeNull();
    expect(rechazo("GET", RUTA.enrolar, "x")).toBeNull();
    expect(rechazo("GET", RUTA.ingresoSocial, "x")).toBeNull();
  });

  it.each([
    [
      "ingreso con idToken",
      RUTA.ingresoSocial,
      '{"provider":"google","idToken":{"token":"x"}}',
      "no_habilitado",
    ],
    ["ingreso con otro proveedor", RUTA.ingresoSocial, '{"provider":"github"}', "no_habilitado"],
    ["enrolar con un campo", RUTA.enrolar, '{"method":"otp"}', "no_habilitado"],
    ["regenerar con contraseña", RUTA.regenerar, '{"password":"x"}', "no_habilitado"],
    ["TOTP con trustDevice", RUTA.totp, '{"code":"123456","trustDevice":true}', "codigo_invalido"],
    ["TOTP con código corto", RUTA.totp, '{"code":"123"}', "codigo_invalido"],
    ["recuperación sin guion", RUTA.recuperacion, '{"code":"abcde12345"}', "codigo_invalido"],
  ])("rechaza con 400 %s y el código %s", async (_c, ruta, cuerpo, codigo) => {
    const r = rechazo("POST", ruta, cuerpo);
    expect(r?.status).toBe(400);
    expect(await r?.json()).toEqual({ codigo });
    expect(r?.headers.get("cache-control")).toBe("private, no-store");
    expect(r?.headers.get("content-type")).toBe("application/json");
    expect(r?.headers.get("x-robots-tag")).toBe("noindex");
    expect(r?.headers.getSetCookie()).toEqual([]);
  });
});

describe("codigoDeRedireccion", () => {
  it("es el mapeo cerrado de la consola: lo desconocido es no_habilitado", () => {
    expect(politica.codigoDeRedireccion("access_denied")).toBe("no_habilitado");
    expect(politica.codigoDeRedireccion("codigo_invalido")).toBe("codigo_invalido");
    expect(politica.codigoDeRedireccion(null)).toBe("no_habilitado");
  });
});

describe("cuerpoDeError", () => {
  const cuerpo = (code: string, extra: object = {}) =>
    JSON.stringify({ code, message: "texto interno de la librería", ...extra });

  it("sale solo el código público: ni el mensaje de la librería ni ningún otro campo", () => {
    const c = new Headers();
    expect(politica.cuerpoDeError(401, cuerpo("INVALID_CODE"), c)).toEqual({
      codigo: "codigo_invalido",
    });
    expect(politica.cuerpoDeError(403, cuerpo("SEGUNDO_FACTOR_RECIENTE_REQUERIDO"), c)).toEqual({
      codigo: "segundo_factor_reciente_requerido",
    });
    expect(politica.cuerpoDeError(400, cuerpo("TOTP_NOT_ENABLED"), c)).toEqual({
      codigo: "segundo_factor_a_enrolar",
    });
    expect(politica.cuerpoDeError(401, cuerpo("SESION_NO_VIGENTE"), c)).toEqual({
      codigo: "sesion_vencida",
    });
    expect(politica.cuerpoDeError(403, cuerpo("INVALID_ORIGIN"), c)).toEqual({
      codigo: "no_habilitado",
    });
    expect(c.has("retry-after")).toBe(false);
  });

  it("un cuerpo que no es JSON o sin código es el genérico", () => {
    expect(politica.cuerpoDeError(400, "no es json", new Headers())).toEqual({
      codigo: "no_habilitado",
    });
    expect(politica.cuerpoDeError(401, "{}", new Headers())).toEqual({
      codigo: "no_habilitado",
    });
  });

  it("demasiados_intentos lleva cuánto esperar (lo que dice el bloqueo propio) y el encabezado Retry-After en segundos", () => {
    const c = new Headers();
    expect(
      politica.cuerpoDeError(429, cuerpo("DEMASIADOS_INTENTOS", { reintentarEnMs: 899_001 }), c),
    ).toEqual({ codigo: "demasiados_intentos", reintentarEnMs: 899_001 });
    expect(c.get("retry-after")).toBe("900");
    const d = new Headers();
    expect(
      politica.cuerpoDeError(429, cuerpo("DEMASIADOS_INTENTOS", { reintentarEnMs: 0 }), d),
    ).toEqual({
      codigo: "demasiados_intentos",
      reintentarEnMs: 0,
    });
    expect(d.get("retry-after")).toBe("0");
    const e = new Headers();
    expect(
      politica.cuerpoDeError(429, cuerpo("DEMASIADOS_INTENTOS", { reintentarEnMs: 1500.2 }), e),
    ).toEqual({
      codigo: "demasiados_intentos",
      reintentarEnMs: 1501,
    });
    expect(e.get("retry-after")).toBe("2");
  });

  it("solo demasiados_intentos lleva tiempo de espera: en cualquier otro error se ignora el del cuerpo y el del encabezado", () => {
    const c = new Headers({ "x-retry-after": "7" });
    expect(
      politica.cuerpoDeError(401, cuerpo("INVALID_CODE", { reintentarEnMs: 5000 }), c),
    ).toEqual({
      codigo: "codigo_invalido",
    });
    expect(
      politica.cuerpoDeError(403, cuerpo("INVALID_ORIGIN", { reintentarEnMs: 5000 }), c),
    ).toEqual({
      codigo: "no_habilitado",
    });
    expect(c.has("retry-after")).toBe(false);
  });

  it("un 429 cuyo cuerpo no es un objeto JSON (texto, null, número, lista) no rompe: usa el encabezado o queda solo el código", () => {
    for (const texto of ["Too many requests", "null", "5", '"texto"', "[1]", ""]) {
      const sin = new Headers();
      expect(politica.cuerpoDeError(429, texto, sin)).toEqual({ codigo: "demasiados_intentos" });
      expect(sin.has("retry-after")).toBe(false);
      const con = new Headers({ "x-retry-after": "3" });
      expect(politica.cuerpoDeError(429, texto, con)).toEqual({
        codigo: "demasiados_intentos",
        reintentarEnMs: 3000,
      });
      expect(con.get("retry-after")).toBe("3");
    }
  });

  it("el límite de pedidos de la librería (429 con X-Retry-After en segundos) también dice cuándo", () => {
    const c = new Headers({ "x-retry-after": "7" });
    expect(politica.cuerpoDeError(429, cuerpo("RATE_LIMITED"), c)).toEqual({
      codigo: "demasiados_intentos",
      reintentarEnMs: 7000,
    });
    expect(c.get("retry-after")).toBe("7");
  });

  it("un tiempo que no sirve (negativo, texto, infinito, cero en el encabezado) se ignora: queda solo el código", () => {
    for (const reintentarEnMs of [-5, "mucho", null]) {
      const c = new Headers();
      expect(
        politica.cuerpoDeError(429, cuerpo("DEMASIADOS_INTENTOS", { reintentarEnMs }), c),
      ).toEqual({
        codigo: "demasiados_intentos",
      });
      expect(c.has("retry-after")).toBe(false);
    }
    for (const x of ["0", "-3", "abc", ""]) {
      const c = new Headers({ "x-retry-after": x });
      expect(politica.cuerpoDeError(429, cuerpo("RATE_LIMITED"), c)).toEqual({
        codigo: "demasiados_intentos",
      });
    }
    const sin = new Headers();
    expect(politica.cuerpoDeError(429, "{}", sin)).toEqual({ codigo: "demasiados_intentos" });
  });
});

describe("estadoDeError", () => {
  it("el 409 de la librería (el segundo pedido con el mismo código de recuperación) sale como 401; los demás estados, igual", () => {
    expect(politica.estadoDeError(409)).toBe(401);
    for (const estado of [400, 401, 403, 404, 408, 410, 429, 500]) {
      expect(politica.estadoDeError(estado), `estado ${estado}`).toBe(estado);
    }
  });
});

describe("moldearExito", () => {
  const moldear = (ruta: string, r: Response, politicaElegida = politica) => {
    const cabeceras = cabecerasDe(r);
    return politicaElegida.moldearExito(ruta, r, cabeceras);
  };

  it("las rutas que no se moldean salen como vienen (null) y NO se lee el cuerpo", async () => {
    for (const ruta of [
      "/api/auth/sign-out",
      "/api/auth/estado-de-sesion",
      RUTA.ingresoSocial,
      "/api/auth/callback/google",
    ]) {
      const r = respuesta({ ok: true });
      expect(await moldear(ruta, r), ruta).toBeNull();
      expect(r.bodyUsed, ruta).toBe(false);
    }
  });

  it("get-session: solo el estado (sin token ni usuario), calculado con el reloj y los límites de la consola", async () => {
    const m = await moldear(
      RUTA.sesion,
      respuesta({
        session: {
          token: "token-secreto",
          createdAt: new Date(AHORA.getTime() - 5 * MINUTO).toISOString(),
          updatedAt: new Date(AHORA.getTime() - MINUTO).toISOString(),
          expiresAt: new Date(AHORA.getTime() + 29 * MINUTO).toISOString(),
          segundoFactorEn: new Date(AHORA.getTime() - MINUTO).toISOString(),
        },
        user: { email: "ana@ejemplo.test" },
      }),
    );
    expect(m?.status).toBe(200);
    expect(await m?.json()).toEqual({
      vigente: true,
      venceEnMs: 29 * MINUTO,
      motivo: "INACTIVIDAD",
      segundoFactorRecienteHastaMs: 4 * MINUTO,
    });
  });

  it("get-session con límites propios usa los suyos", async () => {
    const propia = politicaDePlataforma({ reloj: () => AHORA, limites: LIMITES_DE_SESION });
    const m = await moldear(
      RUTA.sesion,
      respuesta({
        session: {
          createdAt: new Date(AHORA.getTime() - 5 * MINUTO).toISOString(),
          updatedAt: new Date(AHORA.getTime() - 20 * MINUTO).toISOString(),
          expiresAt: new Date(AHORA.getTime() + 10 * MINUTO).toISOString(),
        },
      }),
      propia,
    );
    expect((await m?.json()) as { vigente: boolean }).toMatchObject({ vigente: false });
  });

  it("enrolar: el QR dibujado, el secreto en texto y los códigos, con no-store y SIN la dirección ni el token", async () => {
    const m = await moldear(
      RUTA.enrolar,
      respuesta({
        method: "totp",
        totpURI: DIRECCION,
        backupCodes: CODIGOS,
        token: "token-secreto",
      }),
    );
    expect(m?.status).toBe(200);
    expect(m?.headers.get("cache-control")).toBe("no-store");
    expect(m?.headers.get("pragma")).toBe("no-cache");
    expect(m?.headers.get("content-type")).toBe("application/json");
    const texto = (await m?.text()) ?? "";
    const cuerpo = JSON.parse(texto) as {
      qrSvg: string;
      secreto: string;
      codigosDeRecuperacion: string[];
    };
    expect(Object.keys(cuerpo).sort()).toEqual(["codigosDeRecuperacion", "qrSvg", "secreto"]);
    expect(cuerpo.secreto).toBe(SECRETO);
    expect(cuerpo.codigosDeRecuperacion).toEqual(CODIGOS);
    expect(cuerpo.qrSvg.startsWith("<svg ")).toBe(true);
    expect(texto).not.toContain("otpauth");
    expect(texto).not.toContain("token-secreto");
    expect(texto).not.toContain("ana");
  });

  it("enrolar con una respuesta que no tiene la forma esperada LANZA (nunca deja pasar lo que no entiende)", async () => {
    await expect(
      moldear(RUTA.enrolar, respuesta({ method: "totp", backupCodes: CODIGOS })),
    ).rejects.toThrow("el alta del segundo factor no tiene la forma esperada");
    await expect(
      moldear(RUTA.enrolar, respuesta({ totpURI: DIRECCION, backupCodes: ["mal"] })),
    ).rejects.toThrow();
    await expect(
      moldear(RUTA.enrolar, new Response("no es json", { status: 200 })),
    ).rejects.toThrow();
  });

  it("regenerar: solo los códigos nuevos, con no-store", async () => {
    const m = await moldear(
      RUTA.regenerar,
      respuesta({ status: true, backupCodes: CODIGOS, token: "t" }),
    );
    expect(await m?.json()).toEqual({ codigosDeRecuperacion: CODIGOS });
    expect(m?.headers.get("cache-control")).toBe("no-store");
    expect(m?.headers.get("pragma")).toBe("no-cache");
    await expect(moldear(RUTA.regenerar, respuesta({ status: true }))).rejects.toThrow(
      "los códigos nuevos no tienen la forma esperada",
    );
  });

  it("verificar (TOTP o recuperación): { verificado, segundoFactorRecienteHastaMs } con los 5 minutos enteros, sin token ni usuario", async () => {
    for (const ruta of [RUTA.totp, RUTA.recuperacion]) {
      const m = await moldear(
        ruta,
        respuesta({ token: "token-secreto", user: { email: "ana@ejemplo.test" } }),
      );
      expect(m?.status).toBe(200);
      expect(await m?.json()).toEqual({
        verificado: true,
        segundoFactorRecienteHastaMs: 5 * MINUTO,
      });
      expect(m?.headers.get("cache-control")).toBeNull();
    }
  });

  it("conserva las cookies y el estado de la respuesta de la librería (la sesión rotada del primer código)", async () => {
    const r = new Response(JSON.stringify({ token: "x" }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "__Host-pd_plat.session_token=abc; Path=/; Secure; HttpOnly",
      },
    });
    const m = await moldear(RUTA.totp, r);
    expect(m?.headers.getSetCookie()).toEqual([
      "__Host-pd_plat.session_token=abc; Path=/; Secure; HttpOnly",
    ]);
    expect(m?.headers.has("content-length")).toBe(false);
  });
});
