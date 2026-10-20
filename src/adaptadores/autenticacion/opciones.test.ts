import { describe, expect, it } from "vitest";
import {
  ENCABEZADO_DE_IP,
  configuracionDeHost,
} from "../../capacidades/autenticacion/host-de-autenticacion";
import {
  LIMITES_DE_SESION,
  LIMITES_DE_SESION_DE_PLATAFORMA,
} from "../../capacidades/autenticacion/vigencia-de-sesion";
import { opcionesDeInstancia, type ParametrosComunesDeInstancia } from "./opciones";

/**
 * Lo que la configuración de la librería FIJA para los hallazgos S1, S3 y M1 de la revisión del PR #48. El
 * comportamiento real contra la librería está en `test/integracion/autenticacion-ingreso.test.ts`; acá se
 * fijan las opciones para que quitarlas rompa una prueba sin necesidad de base.
 */
function opciones(extra: Partial<ParametrosComunesDeInstancia> = {}) {
  const c = configuracionDeHost("app.marca-a.test");
  if (!c.ok) throw new Error("host inválido");
  return opcionesDeInstancia({
    configuracion: c.valor,
    db: {} as never,
    secreto: "x".repeat(40),
    google: { clientId: "id", clientSecret: "reservado" },
    limites: LIMITES_DE_SESION,
    reloj: () => new Date(0),
    rutaDeError: "/ingreso",
    registrar: () => undefined,
    ...extra,
  });
}

describe("opcionesDeInstancia", () => {
  it("S1: el proveedor de Google no acepta un idToken mandado por el cliente", () => {
    const google = opciones().socialProviders?.google as { disableIdTokenSignIn?: boolean };
    expect(google.disableIdTokenSignIn).toBe(true);
  });

  it("S3: la IP del límite sale de UN encabezado de confianza, y no de x-forwarded-for", () => {
    const ip = opciones().advanced?.ipAddress;
    expect(ip?.ipAddressHeaders).toEqual([ENCABEZADO_DE_IP]);
    expect(ip?.ipAddressHeaders).not.toContain("x-forwarded-for");
    expect(ip?.disableIpTracking).toBeUndefined();
    expect(ip?.trustedProxies).toBeUndefined();
  });

  it("S3: el nombre del encabezado de confianza es configurable (un nombre, no un secreto)", () => {
    const ip = opciones({ encabezadoDeIp: "x-otro-encabezado" }).advanced?.ipAddress;
    expect(ip?.ipAddressHeaders).toEqual(["x-otro-encabezado"]);
  });

  it("M1: las cookies llevan __Host-: prefijo en el nombre, Secure, Path=/ y sin Domain", () => {
    const avanzado = opciones().advanced;
    expect(avanzado?.cookiePrefix).toBe("__Host-pd_emp");
    // La librería no antepone `__Secure-` (el nombre ya empieza con `__Host-`); `Secure` lo fija el atributo.
    expect(avanzado?.useSecureCookies).toBe(false);
    expect(avanzado?.defaultCookieAttributes).toMatchObject({ secure: true, path: "/" });
    expect(avanzado?.defaultCookieAttributes).not.toHaveProperty("domain");
    expect(avanzado?.crossSubDomainCookies).toBeUndefined();
  });
});

/**
 * La audiencia de PLATAFORMA (h5-p8 §2.1): el mismo archivo con otras cookies, el plugin twoFactor, los límites de la
 * consola y la lista de personal habilitado. El comportamiento contra la librería real está en
 * `test/integracion/autenticacion-plataforma-*.test.ts`; acá se fijan las opciones para que quitarlas rompa una prueba
 * sin necesidad de base.
 */
describe("opcionesDeInstancia: audiencia de plataforma", () => {
  const MINUTO = 60_000;
  const AHORA = new Date("2026-10-20T12:00:00.000Z");
  const SECRETO_DE_LA_CONSOLA = "c".repeat(40);

  type Habilitar = (email: string) => Promise<boolean>;
  function consola(habilitar: Habilitar = () => Promise.resolve(true), registros: string[] = []) {
    const c = configuracionDeHost("consola.example.test");
    if (!c.ok) throw new Error("host inválido");
    return opcionesDeInstancia({
      audiencia: "PLATAFORMA",
      consola: {
        personal: { esHabilitado: habilitar },
        segundoFactor: {} as never,
        auditoria: {} as never,
      },
      configuracion: c.valor,
      db: {} as never,
      secreto: SECRETO_DE_LA_CONSOLA,
      google: { clientId: "id", clientSecret: "reservado" },
      limites: LIMITES_DE_SESION_DE_PLATAFORMA,
      reloj: () => AHORA,
      rutaDeError: "/ingreso",
      registrar: (d) => registros.push(d),
    });
  }

  it("cookies propias: __Host-pd_plat (la web de empresa sigue con __Host-pd_emp), Secure, sin Domain", () => {
    const avanzado = consola().advanced;
    expect(avanzado?.cookiePrefix).toBe("__Host-pd_plat");
    expect(opciones().advanced?.cookiePrefix).toBe("__Host-pd_emp");
    expect(avanzado?.useSecureCookies).toBe(false);
    expect(avanzado?.defaultCookieAttributes).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
    expect(avanzado?.crossSubDomainCookies).toBeUndefined();
  });

  it("el secreto es el que se le da (propio de la consola) y los límites son 30 minutos / 8 horas", () => {
    const o = consola();
    expect(o.secret).toBe(SECRETO_DE_LA_CONSOLA);
    expect(o.session?.expiresIn).toBe(1800);
    expect(o.session?.updateAge).toBe(0);
    expect(o.session?.cookieCache).toEqual({ enabled: false });
  });

  it("tiene el plugin twoFactor y el estado de sesión; la web de empresa, ninguno", () => {
    expect(consola().plugins?.map((p) => p.id)).toEqual([
      "two-factor",
      "estado-de-sesion-de-plataforma",
    ]);
    expect(opciones().plugins).toEqual([]);
  });

  it("twoFactor: TOTP con emisor propio, diez códigos de recuperación guardados hasheados y sin contraseña (todo ingreso es por Google)", async () => {
    const plugin = consola().plugins?.[0] as unknown as {
      options: {
        issuer: string;
        allowPasswordless: boolean;
        backupCodeOptions: {
          amount: number;
          length: number;
          allowPasswordless: boolean;
          storeBackupCodes: {
            encrypt: (x: string) => Promise<string>;
            decrypt: (x: string) => Promise<string>;
          };
        };
      };
    };
    const o = plugin.options;
    expect(o.issuer).toBe("Pedernal Plataforma");
    expect(o.allowPasswordless).toBe(true);
    expect(o.backupCodeOptions.amount).toBe(10);
    expect(o.backupCodeOptions.length).toBe(10);
    expect(o.backupCodeOptions.allowPasswordless).toBe(true);
    // Lo que la librería guarda: huellas, nunca los códigos; y lo que lee es lo guardado tal cual.
    const guardado = await o.backupCodeOptions.storeBackupCodes.encrypt(
      JSON.stringify(["abcde-12345"]),
    );
    expect(guardado).not.toContain("abcde-12345");
    expect(guardado).toMatch(/^\["h1:[0-9a-f]{64}"\]$/);
    expect(await o.backupCodeOptions.storeBackupCodes.decrypt(guardado)).toBe(guardado);
  });

  it("sesión: la consola guarda `segundoFactorEn` (input: false, columna segundo_factor_en); la web de empresa, solo el host", () => {
    const campos = consola().session?.additionalFields;
    expect(Object.keys(campos ?? {}).sort()).toEqual(["host", "segundoFactorEn"]);
    expect(campos?.["segundoFactorEn"]).toEqual({
      type: "date",
      required: false,
      input: false,
      fieldName: "segundo_factor_en",
    });
    expect(campos?.["host"]).toEqual({ type: "string", required: true, input: false });
    expect(Object.keys(opciones().session?.additionalFields ?? {})).toEqual(["host"]);
  });

  it("rutas bloqueadas: las de empresa más ver el secreto, dar de baja y el código por mail", () => {
    const bloqueadas = consola().disabledPaths ?? [];
    for (const r of [
      "/two-factor/get-totp-uri",
      "/two-factor/disable",
      "/two-factor/send-otp",
      "/two-factor/verify-otp",
      "/sign-in/email",
    ]) {
      expect(bloqueadas).toContain(r);
    }
    expect(opciones().disabledPaths).not.toContain("/two-factor/disable");
    // Las que la consola usa NO están bloqueadas.
    for (const r of [
      "/two-factor/enable",
      "/two-factor/verify-totp",
      "/two-factor/verify-backup-code",
      "/two-factor/generate-backup-codes",
    ]) {
      expect(bloqueadas).not.toContain(r);
    }
  });

  it("conserva las defensas de empresa: Google sin idToken, un solo encabezado de IP, sin vincular por email, origen y CSRF encendidos", () => {
    const o = consola();
    expect(
      (o.socialProviders?.google as { disableIdTokenSignIn?: boolean }).disableIdTokenSignIn,
    ).toBe(true);
    expect(o.advanced?.ipAddress?.ipAddressHeaders).toEqual([ENCABEZADO_DE_IP]);
    expect(o.account?.accountLinking).toEqual({ enabled: false, disableImplicitLinking: true });
    expect(o.advanced?.disableOriginCheck).toBe(false);
    expect(o.advanced?.disableCSRFCheck).toBe(false);
    expect(o.telemetry).toEqual({ enabled: false });
    expect(o.emailAndPassword).toEqual({ enabled: false });
  });

  it("tiene gancho posterior (marca el segundo factor) y la web de empresa no", () => {
    expect(consola().hooks?.after).toBeTypeOf("function");
    expect(consola().hooks?.before).toBeTypeOf("function");
    expect(opciones().hooks?.after).toBeUndefined();
  });

  describe("la lista de personal habilitado, punto 1: databaseHooks.user.create.before", () => {
    const crear = async (o: ReturnType<typeof consola>, email: string) => {
      const antes = o.databaseHooks?.user?.create?.before;
      return antes?.({ email, name: "N", emailVerified: true } as never, null);
    };

    it("el email habilitado crea el usuario tal cual (con los mismos datos)", async () => {
      const o = consola((e) => Promise.resolve(e === "ana@ejemplo.test"));
      const usuario = { email: "ana@ejemplo.test", name: "Ana", emailVerified: true };
      expect(await o.databaseHooks?.user?.create?.before?.(usuario as never, null)).toEqual({
        data: usuario,
      });
    });

    it("el que no es personal NO crea el usuario (false)", async () => {
      expect(
        await crear(
          consola((e) => Promise.resolve(e === "ana@ejemplo.test")),
          "otro@ejemplo.test",
        ),
      ).toBe(false);
    });

    it("si la consulta falla, no entra nadie (false) y el motivo queda en el registro, sin el email", async () => {
      const registros: string[] = [];
      const o = consola(() => Promise.reject(new TypeError("la base no responde")), registros);
      expect(await crear(o, "ana@ejemplo.test")).toBe(false);
      expect(registros).toEqual([
        "[ingreso] no se pudo consultar al personal habilitado: TypeError",
      ]);
    });

    it("la web de empresa no tiene este gancho (deja entrar a cualquier cuenta verificada)", () => {
      expect(opciones().databaseHooks?.user).toBeUndefined();
    });
  });

  describe("la lista de personal habilitado, punto 2, y G1: databaseHooks.session.create.before", () => {
    const sesion = (extra: object = {}) => ({
      userId: "u1",
      token: "t",
      createdAt: AHORA,
      expiresAt: new Date(AHORA.getTime() + 30 * MINUTO),
      ...extra,
    });
    const contexto = (
      usuario: { email: string } | null,
      previa?: { userId: string; createdAt: Date },
    ) =>
      ({
        context: {
          internalAdapter: { findUserById: () => Promise.resolve(usuario) },
          session: previa === undefined ? null : { session: previa },
        },
      }) as never;
    const antes = (o: ReturnType<typeof consola>) => o.databaseHooks?.session?.create?.before;

    it("un ingreso nuevo de personal habilitado: guarda el host de la consola, SIN segundo factor, y deja las fechas como vienen", async () => {
      const o = consola();
      const s = sesion();
      expect(await antes(o)?.(s as never, contexto({ email: "ana@ejemplo.test" }))).toEqual({
        data: {
          ...s,
          host: "consola.example.test",
          segundoFactorEn: null,
          createdAt: AHORA,
          expiresAt: s.expiresAt,
        },
      });
    });

    it("sin el usuario a la vista, o de alguien que no es personal, no hay sesión (false)", async () => {
      const o = consola((e) => Promise.resolve(e === "ana@ejemplo.test"));
      expect(await antes(o)?.(sesion() as never, contexto(null))).toBe(false);
      expect(await antes(o)?.(sesion() as never, null)).toBe(false);
      expect(await antes(o)?.(sesion() as never, contexto({ email: "otro@ejemplo.test" }))).toBe(
        false,
      );
    });

    it("una sesión nueva NUNCA hereda el segundo factor que traiga el dato", async () => {
      const o = consola();
      const r = (await antes(o)?.(
        sesion({ segundoFactorEn: AHORA }) as never,
        contexto({ email: "a@e.test" }),
      )) as {
        data: { segundoFactorEn: unknown };
      };
      expect(r.data.segundoFactorEn).toBeNull();
    });

    it("al verificar el primer código la librería ROTA la sesión: conserva cuándo nació (tope de 8 horas) y recorta el vencimiento a ese tope", async () => {
      const o = consola();
      const nacio = new Date(AHORA.getTime() - 7 * 60 * MINUTO - 50 * MINUTO); // 7 h 50 m atrás
      const r = (await antes(o)?.(
        sesion({ createdAt: AHORA }) as never,
        contexto({ email: "a@e.test" }, { userId: "u1", createdAt: nacio }),
      )) as { data: { createdAt: Date; expiresAt: Date } };
      expect(r.data.createdAt).toEqual(nacio);
      expect(r.data.expiresAt).toEqual(new Date(nacio.getTime() + 8 * 60 * MINUTO));
      // Con la sesión joven, el vencimiento es el de la inactividad.
      const joven = new Date(AHORA.getTime() - 2 * MINUTO);
      const j = (await antes(o)?.(
        sesion({ createdAt: AHORA }) as never,
        contexto({ email: "a@e.test" }, { userId: "u1", createdAt: joven }),
      )) as { data: { createdAt: Date; expiresAt: Date } };
      expect(j.data.createdAt).toEqual(joven);
      expect(j.data.expiresAt).toEqual(new Date(AHORA.getTime() + 30 * MINUTO));
    });

    it("la sesión que estaba a la vista es de OTRO usuario: no es una rotación (nace con sus propias fechas)", async () => {
      const o = consola();
      const s = sesion();
      const r = (await antes(o)?.(
        s as never,
        contexto({ email: "a@e.test" }, { userId: "otro", createdAt: new Date(0) }),
      )) as { data: { createdAt: Date; expiresAt: Date } };
      expect(r.data.createdAt).toEqual(AHORA);
      expect(r.data.expiresAt).toEqual(s.expiresAt);
    });

    it("la web de empresa solo agrega el host, sin mirar a nadie", async () => {
      const s = sesion();
      expect(await opciones().databaseHooks?.session?.create?.before?.(s as never, null)).toEqual({
        data: { ...s, host: "app.marca-a.test" },
      });
    });
  });
});
