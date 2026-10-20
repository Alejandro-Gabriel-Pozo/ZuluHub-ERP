import { betterAuth } from "better-auth";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { opcionesDeInstancia } from "../../src/adaptadores/autenticacion/opciones";
import { ErrorInternoDeIngreso } from "../../src/adaptadores/autenticacion/autenticacion-de-better-auth";
import {
  ENCABEZADO_DE_IP,
  configuracionDeHost,
} from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { RUTAS_PERMITIDAS } from "../../src/capacidades/autenticacion/rutas-permitidas";
import { LIMITES_DE_SESION } from "../../src/capacidades/autenticacion/vigencia-de-sesion";
import { RUTAS_BLOQUEADAS } from "../../src/adaptadores/autenticacion/rutas-bloqueadas";
import { crearBaseAparte } from "./entorno";
import {
  Navegador,
  armarAutenticacionDePrueba,
  levantarProveedorLocal,
  perfilAlAzar,
  type AutenticacionDePrueba,
  type PerfilDePrueba,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";

/**
 * Autenticación (W3b): el ingreso con Google de punta a punta contra Better Auth 1.7.7 y una base real, con un
 * proveedor OIDC LOCAL en lugar de Google (nada sale a internet). Son las pruebas del spike del ADR-013 que no
 * son de TOTP, más las de la configuración por host del spec §4.1 a §4.7: ingreso feliz, email no verificado,
 * vinculación por email apagada, cookies, rutas cerradas, vencimiento de 15 minutos y de 8 horas, sesión atada
 * al host (P-6) y cierre de sesión.
 *
 * `NODE_ENV=production` durante el archivo: por omisión la librería apaga la comprobación de origen y toma
 * la IP de `127.0.0.1` cuando vale `test`; acá se prueba el comportamiento de producción.
 */

const base = inject("baseDePruebas");

const HOST_A = "app.marca-a.test";
const HOST_B = "app.marca-b.test";

describe.skipIf(base === null)("autenticación: ingreso con Google (proveedor local)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let proveedor: ProveedorLocal;
  let a: AutenticacionDePrueba;
  let dueno: pg.Client;

  const cuenta = async (tabla: string): Promise<number> =>
    Number(
      (await dueno.query<{ n: string }>(`select count(*) as n from autenticacion."${tabla}"`))
        .rows[0]?.n,
    );

  /** Un navegador ya ingresado en `host`. */
  async function ingresado(host = HOST_A, perfil: PerfilDePrueba = perfilAlAzar()) {
    const n = new Navegador();
    const r = await n.ingresarConGoogle(a.autenticacion, host, proveedor, perfil);
    expect(r.estado).toBe(302);
    expect(r.ubicacion).toBe("/");
    return { n, perfil };
  }
  /** La fila de sesión de ese navegador (por el token de su cookie). */
  async function filaDe(n: Navegador, host = HOST_A) {
    const cookie = n.cookiesDe(host).find((c) => c.nombre.endsWith("session_token"));
    const token = decodeURIComponent(cookie?.valor ?? "").split(".")[0];
    const { rows } = await dueno.query<{
      id: string;
      createdAt: Date;
      updatedAt: Date;
      expiresAt: Date;
      host: string;
      token: string;
    }>(`select * from autenticacion.session where token = $1`, [token]);
    return rows[0];
  }

  beforeAll(async () => {
    if (base === null) return;
    vi.stubEnv("NODE_ENV", "production");
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    proveedor = await levantarProveedorLocal();
    a = armarAutenticacionDePrueba(propia.base, proveedor);
  });
  afterAll(async () => {
    expect(proveedor.intentosExternos(), "nada salió a internet").toEqual([]);
    await a.cerrar();
    await dueno.end();
    await proveedor.cerrar();
    await propia.destruir();
    vi.unstubAllEnvs();
  });

  describe("ingreso feliz", () => {
    it("crea el usuario, la cuenta de Google y una sesión atada al host; y la sesión se lee", async () => {
      const perfil = perfilAlAzar();
      const { n } = await ingresado(HOST_A, perfil);

      const { rows: usuarios } = await dueno.query<{
        id: string;
        email: string;
        emailVerified: boolean;
      }>(`select id, email, "emailVerified" from autenticacion."user" where email = $1`, [
        perfil.email,
      ]);
      expect(usuarios).toHaveLength(1);
      expect(usuarios[0]).toMatchObject({ email: perfil.email, emailVerified: true });
      const { rows: cuentas } = await dueno.query<{
        providerId: string;
        accountId: string;
        userId: string;
      }>(
        `select "providerId", "accountId", "userId" from autenticacion.account where "accountId" = $1`,
        [perfil.sub],
      );
      expect(cuentas).toEqual([
        { providerId: "google", accountId: perfil.sub, userId: usuarios[0]?.id },
      ]);

      const fila = await filaDe(n);
      expect(fila?.host).toBe(HOST_A);
      // Vence a los 15 minutos de inactividad (decisión del dueño), no a los 30 del spec viejo.
      const dura = (fila?.expiresAt.getTime() ?? 0) - (fila?.createdAt.getTime() ?? 0);
      expect(dura).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
      expect(dura).toBeLessThanOrEqual(15 * 60_000 + 1000);

      const sesion = await a.autenticacion.sesionDe(n.pedidoDe(HOST_A), HOST_A);
      expect(sesion).toMatchObject({
        usuarioAuth: usuarios[0]?.id,
        email: perfil.email,
        emailVerificado: true,
      });
    });

    it("guarda los tokens de Google cifrados y el idToken no se guarda", async () => {
      const perfil = perfilAlAzar();
      await ingresado(HOST_A, perfil);
      const { rows } = await dueno.query<{
        accessToken: string | null;
        refreshToken: string | null;
        idToken: string | null;
      }>(
        `select "accessToken", "refreshToken", "idToken" from autenticacion.account where "accountId" = $1`,
        [perfil.sub],
      );
      const guardados = [rows[0]?.accessToken, rows[0]?.refreshToken].filter(
        (x): x is string => typeof x === "string",
      );
      expect(guardados.length).toBeGreaterThan(0);
      for (const entregado of proveedor.tokensEntregados()) {
        for (const g of guardados) expect(g).not.toContain(entregado);
      }
      expect(rows[0]?.idToken).toBeNull();
    });

    it("la cookie: solo del host (sin Domain), HttpOnly, Secure, SameSite=Lax, prefijo __Host-, 15 minutos", async () => {
      const { n } = await ingresado();
      const cookies = n.cookiesDe(HOST_A);
      // Una sola: la de sesión. Sin caché de sesión en cookie (`session_data`).
      expect(cookies.map((c) => c.nombre)).toEqual(["__Host-pd_emp.session_token"]);
      const crudo = cookies[0]?.crudo ?? "";
      expect(crudo).toMatch(/;\s*HttpOnly/i);
      expect(crudo).toMatch(/;\s*Secure/i);
      expect(crudo).toMatch(/;\s*SameSite=Lax/i);
      expect(crudo).toMatch(/;\s*Path=\//i);
      expect(crudo).toMatch(/;\s*Max-Age=900(;|$)/i);
      expect(crudo).not.toMatch(/Domain=/i);
    });

    it("el inicio del ingreso pide a Google que elija cuenta, con PKCE, y vuelve a la dirección fija del host", async () => {
      const n = new Navegador();
      const inicio = await n.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-in/social", {
        cuerpo: { provider: "google", callbackURL: "/" },
      });
      expect(inicio.estado).toBe(200);
      const url = new URL((inicio.json() as { url: string }).url);
      expect(url.hostname).toBe("accounts.google.com");
      expect(url.searchParams.get("prompt")).toBe("select_account");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("redirect_uri")).toBe(
        `https://${HOST_A}/api/auth/callback/google`,
      );
    });
  });

  describe("email no verificado (G6)", () => {
    it.each([
      ["falso", false],
      ["ausente", undefined],
    ])(
      "%s: se rechaza el alta, sin usuario, cuenta, sesión ni cookie",
      async (_nombre, verificado) => {
        const antes = [await cuenta("user"), await cuenta("account"), await cuenta("session")];
        const n = new Navegador();
        const r = await n.ingresarConGoogle(
          a.autenticacion,
          HOST_A,
          proveedor,
          perfilAlAzar({ emailVerificado: verificado }),
        );
        expect(r.estado).toBe(302);
        expect(r.ubicacion).toBe("/ingreso?error=email_no_verificado");
        expect(n.cookiesDe(HOST_A)).toEqual([]);
        expect([await cuenta("user"), await cuenta("account"), await cuenta("session")]).toEqual(
          antes,
        );
      },
    );

    it("también en cada ingreso siguiente: si Google deja de verificar el email, no se abre sesión", async () => {
      const perfil = perfilAlAzar();
      await ingresado(HOST_A, perfil);
      const sesionesAntes = await cuenta("session");
      const n = new Navegador();
      const r = await n.ingresarConGoogle(
        a.autenticacion,
        HOST_A,
        proveedor,
        perfilAlAzar({ sub: perfil.sub, email: perfil.email, emailVerificado: false }),
      );
      expect(r.ubicacion).toBe("/ingreso?error=email_no_verificado");
      expect(n.cookiesDe(HOST_A)).toEqual([]);
      expect(await cuenta("session")).toBe(sesionesAntes);
    });
  });

  describe("sin vincular cuentas por email", () => {
    it("otra cuenta de Google (otro sub) con el mismo email: account_not_linked, sin usuario ni sesión nuevos", async () => {
      const perfil = perfilAlAzar();
      await ingresado(HOST_A, perfil);
      const antes = [await cuenta("user"), await cuenta("account"), await cuenta("session")];
      const n = new Navegador();
      const r = await n.ingresarConGoogle(
        a.autenticacion,
        HOST_A,
        proveedor,
        perfilAlAzar({ email: perfil.email }),
      );
      expect(r.ubicacion).toBe("/ingreso?error=account_not_linked");
      expect(n.cookiesDe(HOST_A)).toEqual([]);
      expect([await cuenta("user"), await cuenta("account"), await cuenta("session")]).toEqual(
        antes,
      );
    });

    it("el mismo sub con un email nuevo es la misma cuenta: un solo usuario, email al día", async () => {
      const perfil = perfilAlAzar();
      await ingresado(HOST_A, perfil);
      const usuariosAntes = await cuenta("user");
      const cuentasAntes = await cuenta("account");
      const nuevo = perfilAlAzar({ sub: perfil.sub });
      const n = new Navegador();
      const r = await n.ingresarConGoogle(a.autenticacion, HOST_A, proveedor, nuevo);
      expect(r.ubicacion).toBe("/");
      expect(await cuenta("user")).toBe(usuariosAntes);
      expect(await cuenta("account")).toBe(cuentasAntes);
      const { rows } = await dueno.query(
        `select u.email from autenticacion."user" u join autenticacion.account a on a."userId" = u.id where a."accountId" = $1`,
        [perfil.sub],
      );
      expect(rows).toEqual([{ email: nuevo.email }]);
    });
  });

  describe("el retorno de Google", () => {
    it("repetir el retorno con el mismo código no crea otra sesión ni otro usuario (state_mismatch)", async () => {
      const perfil = perfilAlAzar();
      const n = new Navegador();
      const ruta = await n.empezarIngreso(a.autenticacion, HOST_A, proveedor, perfil);
      const primero = await n.pedir(a.autenticacion, HOST_A, "GET", ruta);
      expect(primero.ubicacion).toBe("/");
      const antes = [await cuenta("user"), await cuenta("account"), await cuenta("session")];
      const repetido = await n.pedir(a.autenticacion, HOST_A, "GET", ruta);
      expect(repetido.ubicacion).toBe("/ingreso?error=state_mismatch");
      expect([await cuenta("user"), await cuenta("account"), await cuenta("session")]).toEqual(
        antes,
      );
    });

    it("un error del proveedor vuelve con su código y sin la descripción que mandó el navegador", async () => {
      const n = new Navegador();
      const inicio = await n.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-in/social", {
        cuerpo: { provider: "google", callbackURL: "/" },
      });
      const state = new URL((inicio.json() as { url: string }).url).searchParams.get("state");
      const r = await n.pedir(
        a.autenticacion,
        HOST_A,
        "GET",
        `/api/auth/callback/google?error=access_denied&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E&state=${state}`,
      );
      expect(r.estado).toBe(302);
      expect(r.ubicacion).toBe("/ingreso?error=access_denied");
    });

    it("un código de error que no es de la lista vuelve como el genérico", async () => {
      const n = new Navegador();
      const inicio = await n.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-in/social", {
        cuerpo: { provider: "google", callbackURL: "/" },
      });
      const state = new URL((inicio.json() as { url: string }).url).searchParams.get("state");
      const r = await n.pedir(
        a.autenticacion,
        HOST_A,
        "GET",
        `/api/auth/callback/google?error=algo_que_inventé&state=${state}`,
      );
      expect(r.ubicacion).toBe("/ingreso?error=error_de_ingreso");
    });

    it("sin estado o con un estado inventado vuelve a la pantalla de ingreso, sin crear nada", async () => {
      const antes = [await cuenta("user"), await cuenta("session")];
      const n = new Navegador();
      const sinEstado = await n.pedir(
        a.autenticacion,
        HOST_A,
        "GET",
        "/api/auth/callback/google?code=x",
      );
      expect(sinEstado.ubicacion).toBe("/ingreso?error=state_not_found");
      const inventado = await n.pedir(
        a.autenticacion,
        HOST_A,
        "GET",
        "/api/auth/callback/google?code=x&state=inventado",
      );
      expect(inventado.ubicacion).toBe("/ingreso?error=state_mismatch");
      expect([await cuenta("user"), await cuenta("session")]).toEqual(antes);
    });

    it("un retorno iniciado en un navegador no sirve en otro (el estado va atado a su cookie)", async () => {
      const victima = new Navegador();
      const ruta = await victima.empezarIngreso(a.autenticacion, HOST_A, proveedor, perfilAlAzar());
      const atacante = new Navegador();
      const r = await atacante.pedir(a.autenticacion, HOST_A, "GET", ruta);
      expect(r.ubicacion).toMatch(/^\/ingreso\?error=/);
      expect(atacante.cookiesDe(HOST_A).some((c) => c.nombre.endsWith("session_token"))).toBe(
        false,
      );
    });
  });

  describe("redirecciones y origen", () => {
    it.each([
      ["callbackURL", { callbackURL: "https://malo.test/x" }, "INVALID_CALLBACK_URL"],
      [
        "errorCallbackURL",
        { callbackURL: "/", errorCallbackURL: "https://malo.test/e" },
        "INVALID_ERROR_CALLBACK_URL",
      ],
      [
        "newUserCallbackURL",
        { callbackURL: "/", newUserCallbackURL: "https://malo.test/n" },
        "INVALID_NEW_USER_CALLBACK_URL",
      ],
    ])(
      "%s a otro sitio: se rechaza (no hay redirección abierta) y la respuesta lleva solo el código",
      async (_n, extra, codigo) => {
        const r = await new Navegador().pedir(
          a.autenticacion,
          HOST_A,
          "POST",
          "/api/auth/sign-in/social",
          {
            cuerpo: { provider: "google", ...extra },
          },
        );
        expect(r.estado).toBe(403);
        expect(r.json()).toEqual({ codigo });
      },
    );

    it("con cookies, un pedido de otro origen se rechaza (CSRF): al cerrar sesión y al empezar un ingreso", async () => {
      const { n } = await ingresado();
      for (const ruta of ["/api/auth/sign-out", "/api/auth/sign-in/social"]) {
        const r = await n.pedir(a.autenticacion, HOST_A, "POST", ruta, {
          cuerpo: { provider: "google", callbackURL: "/" },
          origen: "https://malo.test",
        });
        expect(r.estado, ruta).toBe(403);
        expect(r.json(), ruta).toEqual({ codigo: "INVALID_ORIGIN" });
      }
      const sinOrigen = await n.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-out", {
        origen: null,
      });
      expect(sinOrigen.estado).toBe(403);
      expect(sinOrigen.json()).toEqual({ codigo: "MISSING_OR_NULL_ORIGIN" });
      // Ninguno de los rechazados borró la sesión.
      expect(await a.autenticacion.sesionDe(n.pedidoDe(HOST_A), HOST_A)).not.toBeNull();
    });

    it("el origen es el del host de la instancia: ni Host ni X-Forwarded-Host de otro host lo cambian", async () => {
      const n = new Navegador();
      const r = await n.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-in/social", {
        cuerpo: { provider: "google", callbackURL: "/" },
        encabezados: { "x-forwarded-host": HOST_B, "x-forwarded-proto": "http", host: HOST_B },
      });
      const retorno = new URL(
        new URL((r.json() as { url: string }).url).searchParams.get("redirect_uri") ?? "",
      );
      expect(retorno.origin).toBe(`https://${HOST_A}`);
    });

    it("aunque el servidor arme mal la URL del pedido, la librería ve el origen fijo del host", async () => {
      const pedido = new Request(`http://interno.local:3000/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: `https://${HOST_A}`,
          "x-forwarded-for": "198.51.100.77",
        },
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
      });
      const r = await a.autenticacion.manejar(pedido, HOST_A);
      expect(r.status).toBe(200);
      const { url } = (await r.json()) as { url: string };
      expect(new URL(url).searchParams.get("redirect_uri")).toBe(
        `https://${HOST_A}/api/auth/callback/google`,
      );
    });
  });

  describe("rutas: lista cerrada", () => {
    it("las rutas permitidas más las bloqueadas son exactamente las que declara la librería (si sube una nueva, falla)", () => {
      const c = configuracionDeHost(HOST_A);
      if (!c.ok) throw new Error("host inválido");
      const auth = betterAuth(
        opcionesDeInstancia({
          configuracion: c.valor,
          db: a.conexion.db,
          secreto: "s".repeat(40),
          google: { clientId: "x", clientSecret: "y" },
          limites: LIMITES_DE_SESION,
          reloj: () => new Date(),
          rutaDeError: "/ingreso",
          registrar: () => undefined,
        }),
      );
      const declaradas = Object.values(auth.api)
        .map((e) => (e as { path?: string }).path)
        .filter((p): p is string => typeof p === "string")
        .sort();
      const usadas = ["/sign-in/social", "/callback/:id", "/get-session", "/sign-out"];
      expect([...usadas, ...RUTAS_BLOQUEADAS].sort()).toEqual(declaradas);
      // Lo que la aplicación deja pasar es una parte de lo usado.
      expect(RUTAS_PERMITIDAS.map((r) => r.ruta.replace("/api/auth", "")).sort()).toEqual(
        ["/callback/google", "/get-session", "/sign-in/social", "/sign-out"].sort(),
      );
    });

    it("lo que no está en la lista responde 404 sin cuerpo ni cookies, aunque la librería lo tenga", async () => {
      const { n } = await ingresado();
      const casos: ["GET" | "POST", string][] = [
        ["POST", "/api/auth/sign-in/email"],
        ["POST", "/api/auth/sign-up/email"],
        ["POST", "/api/auth/update-user"],
        ["POST", "/api/auth/delete-user"],
        ["POST", "/api/auth/change-email"],
        ["POST", "/api/auth/change-password"],
        ["POST", "/api/auth/link-social"],
        ["POST", "/api/auth/unlink-account"],
        ["POST", "/api/auth/revoke-session"],
        ["POST", "/api/auth/revoke-sessions"],
        ["POST", "/api/auth/revoke-other-sessions"],
        ["POST", "/api/auth/get-access-token"],
        ["POST", "/api/auth/refresh-token"],
        ["GET", "/api/auth/list-sessions"],
        ["GET", "/api/auth/list-accounts"],
        ["GET", "/api/auth/account-info"],
        ["GET", "/api/auth/reset-password/un-token"],
        ["GET", "/api/auth/verify-email"],
        ["GET", "/api/auth/ok"],
        ["GET", "/api/auth/error"],
        ["GET", "/api/auth/callback/otro-proveedor"],
        ["POST", "/api/auth/two-factor/enable"],
        ["POST", "/api/auth/two-factor/verify-totp"],
        ["GET", "/api/auth/sign-in/social"],
        ["POST", "/api/auth/get-session"],
        ["GET", "/api/auth/sign-out"],
        ["POST", "/api/auth/callback/google"],
        ["GET", "/api/auth/get-session/"],
        ["GET", "/api/auth/Get-Session"],
        ["GET", "/api/auth/get-session%2F"],
        ["GET", "/api/auth//get-session"],
        ["GET", "/api/auth"],
        ["GET", "/api/auth/"],
        ["POST", "/api/auth/sign-in/social/"],
      ];
      for (const [metodo, ruta] of casos) {
        const r = await n.pedir(a.autenticacion, HOST_A, metodo, ruta);
        expect(r.estado, `${metodo} ${ruta}`).toBe(404);
        expect(r.texto, `${metodo} ${ruta}`).toBe("");
        expect(r.cabeceras.getSetCookie(), `${metodo} ${ruta}`).toEqual([]);
        expect(r.cabeceras.get("cache-control")).toBe("private, no-store");
      }
      // La sesión sigue intacta.
      expect(await a.autenticacion.sesionDe(n.pedidoDe(HOST_A), HOST_A)).not.toBeNull();
    });

    it("las rutas bloqueadas también están cerradas dentro de la librería (disabledPaths), por si el filtro fallara", async () => {
      const c = configuracionDeHost(HOST_A);
      if (!c.ok) throw new Error("host inválido");
      const auth = betterAuth(
        opcionesDeInstancia({
          configuracion: c.valor,
          db: a.conexion.db,
          secreto: "s".repeat(40),
          google: { clientId: "x", clientSecret: "y" },
          limites: LIMITES_DE_SESION,
          reloj: () => new Date(),
          rutaDeError: "/ingreso",
          registrar: () => undefined,
        }),
      );
      for (const ruta of [
        "/sign-in/email",
        "/sign-up/email",
        "/update-user",
        "/list-accounts",
        "/link-social",
      ]) {
        const r = await auth.handler(
          new Request(`https://${HOST_A}/api/auth${ruta}`, {
            method: ruta === "/list-accounts" ? "GET" : "POST",
            headers: { "content-type": "application/json", origin: `https://${HOST_A}` },
            ...(ruta === "/list-accounts" ? {} : { body: "{}" }),
          }),
        );
        expect(r.status, ruta).toBe(404);
      }
    });

    it("el plugin twoFactor NO está montado en la web de empresa: sin ruta, sin API y sin tabla ni columna declaradas", async () => {
      const c = configuracionDeHost(HOST_A);
      if (!c.ok) throw new Error("host inválido");
      const opciones = opcionesDeInstancia({
        configuracion: c.valor,
        db: a.conexion.db,
        secreto: "s".repeat(40),
        google: { clientId: "x", clientSecret: "y" },
        limites: LIMITES_DE_SESION,
        reloj: () => new Date(),
        rutaDeError: "/ingreso",
        registrar: () => undefined,
      });
      expect(opciones.plugins).toEqual([]);
      const auth = betterAuth(opciones);
      expect(
        Object.keys(auth.api).filter((k) => /two.?factor|totp|backup|estado/i.test(k)),
      ).toEqual([]);
      // La migración 0015 es aditiva y deja en la base las tablas y columnas del segundo factor (las usa la consola);
      // la instancia de EMPRESA no declara ninguna: no las lee ni las escribe.
      const contexto = await auth.$context;
      expect(Object.keys(contexto.tables).sort()).toEqual([
        "account",
        "rateLimit",
        "session",
        "user",
        "verification",
      ]);
      expect(Object.keys(contexto.tables["user"]?.fields ?? {})).not.toContain("twoFactorEnabled");
      expect(Object.keys(contexto.tables["session"]?.fields ?? {})).not.toContain(
        "segundoFactorEn",
      );
    });
  });

  describe("lo que la respuesta cuenta", () => {
    it("get-session devuelve solo si hay sesión y cuándo vence: ni el token ni el usuario", async () => {
      const { n, perfil } = await ingresado();
      const fila = await filaDe(n);
      const r = await n.pedir(a.autenticacion, HOST_A, "GET", "/api/auth/get-session");
      expect(r.estado).toBe(200);
      expect(Object.keys(r.json() as object).sort()).toEqual(["ultimoUso", "venceEn", "vigente"]);
      expect(r.texto).not.toContain(fila?.token ?? "no-hay-token");
      expect(r.texto).not.toContain(perfil.email);
      expect(r.cabeceras.get("cache-control")).toContain("no-store");
      // Y renueva la cookie: el navegador se entera de la renovación.
      expect(r.cabeceras.getSetCookie().join("\n")).toContain("session_token=");
    });

    it("sin cookie, get-session dice que no hay sesión", async () => {
      const r = await new Navegador().pedir(
        a.autenticacion,
        HOST_A,
        "GET",
        "/api/auth/get-session",
      );
      expect(r.estado).toBe(200);
      expect(r.json()).toEqual({ vigente: false });
    });

    it("un fallo interno (la base no responde) no sale con detalle: el error es genérico y el detalle queda en el registro", async () => {
      const url = new URL(propia.base.autenticacion);
      url.username = "pedernal_rol_que_no_existe"; // falla con cualquier método de autenticación (el CI usa trust: una clave equivocada no falla)
      const rota = armarAutenticacionDePrueba(propia.base, proveedor, { url: url.toString() });
      try {
        const pedidos: Promise<unknown>[] = [
          new Navegador().pedir(rota.autenticacion, HOST_A, "POST", "/api/auth/sign-in/social", {
            cuerpo: { provider: "google", callbackURL: "/" },
          }),
          new Navegador().pedir(rota.autenticacion, HOST_A, "GET", "/api/auth/get-session"),
          rota.autenticacion.sesionDe(
            { headers: new Headers({ cookie: "__Host-pd_emp.session_token=x.y" }) },
            HOST_A,
          ),
        ];
        for (const pedido of pedidos) {
          const falla = await pedido.then(
            () => null,
            (e: unknown) => e,
          );
          expect(falla).toBeInstanceOf(ErrorInternoDeIngreso);
          const visible = `${(falla as Error).message} ${JSON.stringify(falla)} ${String(falla)}`;
          expect(visible).not.toMatch(
            /password|authentication|pedernal_|postgres|clave-equivocada/i,
          );
          expect((falla as Error).cause).toBeUndefined();
        }
        // El detalle SÍ quedó en el registro del servidor (de ahí lo lee soporte).
        expect(rota.registros.join("\n")).toMatch(/fallo interno/);
      } finally {
        await rota.cerrar();
      }
    });
  });

  describe("S1: sin ingreso con un idToken mandado directo", () => {
    const ataque = {
      provider: "google",
      callbackURL: "/",
      idToken: { token: "a".repeat(20), nonce: "b".repeat(8) },
    };

    it("la librería lo rechaza (404 ID_TOKEN_NOT_SUPPORTED): sin sesión, sin usuario, sin cookie y sin token en el cuerpo", async () => {
      const antes = [await cuenta("user"), await cuenta("account"), await cuenta("session")];
      const n = new Navegador();
      const r = await n.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-in/social", {
        cuerpo: ataque,
      });
      expect(r.estado).toBe(404);
      expect(r.json()).toEqual({ codigo: "ID_TOKEN_NOT_SUPPORTED" });
      expect(r.texto).not.toMatch(/token"\s*:\s*"[^"]/i);
      expect(n.cookiesDe(HOST_A)).toEqual([]);
      expect([await cuenta("user"), await cuenta("account"), await cuenta("session")]).toEqual(
        antes,
      );
    });

    it("el inicio normal devuelve solo la dirección de Google: sin token de sesión ni usuario en el cuerpo", async () => {
      const r = await new Navegador().pedir(
        a.autenticacion,
        HOST_A,
        "POST",
        "/api/auth/sign-in/social",
        {
          cuerpo: { provider: "google", callbackURL: "/" },
        },
      );
      expect(r.estado).toBe(200);
      expect(Object.keys(r.json() as object).sort()).toEqual(["redirect", "url"]);
    });

    it("DEBILITAMIENTO propio: sin `disableIdTokenSignIn` el mismo pedido abre sesión y devuelve su token; la sonda de arriba lo detecta", async () => {
      const c = configuracionDeHost(HOST_A);
      if (!c.ok) throw new Error("host inválido");
      const opciones = opcionesDeInstancia({
        configuracion: c.valor,
        db: a.conexion.db,
        secreto: "s".repeat(40),
        google: { clientId: proveedor.clientId, clientSecret: proveedor.clientSecret },
        limites: LIMITES_DE_SESION,
        reloj: () => new Date(),
        rutaDeError: "/ingreso",
        registrar: () => undefined,
      });
      const google = (opciones.socialProviders ?? {})["google"];
      expect((google as { disableIdTokenSignIn?: boolean }).disableIdTokenSignIn).toBe(true);
      const perfil = perfilAlAzar();
      const debil = betterAuth({
        ...opciones,
        socialProviders: {
          google: {
            ...(google as object),
            clientId: proveedor.clientId,
            clientSecret: proveedor.clientSecret,
            disableIdTokenSignIn: false,
            // El proveedor «verifica» cualquier token: lo que haría Google con uno válido pero ajeno.
            verifyIdToken: () => Promise.resolve(true),
            getUserInfo: (() =>
              Promise.resolve({
                user: { id: perfil.sub, email: perfil.email, emailVerified: true, name: "x" },
                data: { sub: perfil.sub },
              })) as never,
          },
        },
      });
      const r = await debil.handler(
        new Request(`https://${HOST_A}/api/auth/sign-in/social`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: `https://${HOST_A}`,
            [ENCABEZADO_DE_IP]: "198.51.100.230",
          },
          body: JSON.stringify(ataque),
        }),
      );
      const cuerpo = (await r.json()) as { token?: string };
      // El ataque FUNCIONA sin la opción: 200, token de sesión en el cuerpo y cookie de sesión.
      expect(r.status).toBe(200);
      expect(typeof cuerpo.token).toBe("string");
      expect(r.headers.getSetCookie().join(";")).toContain("session_token");
      // Y por lo tanto la sonda de la prueba 1 (404 + código) no se cumpliría: la prueba muerde.
      expect(r.status).not.toBe(404);
    });
  });

  describe("M1: todas las cookies de ingreso llevan __Host-", () => {
    it("las del inicio del ingreso (estado, PKCE): prefijo __Host-, Secure, Path=/ y sin Domain", async () => {
      const n = new Navegador();
      await n.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-in/social", {
        cuerpo: { provider: "google", callbackURL: "/" },
      });
      const cookies = n.cookiesDe(HOST_A);
      expect(cookies.length).toBeGreaterThan(0);
      for (const c of cookies) {
        expect(c.nombre.startsWith("__Host-pd_emp."), c.nombre).toBe(true);
        expect(c.crudo, c.nombre).toMatch(/;\s*Secure/i);
        expect(c.crudo, c.nombre).toMatch(/;\s*Path=\/(;|$)/i);
        expect(c.crudo, c.nombre).not.toMatch(/Domain=/i);
      }
    });

    it("la cookie vieja con __Secure- ya no se toma por la sesión", async () => {
      const { n } = await ingresado();
      const cookie = n.cookiesDe(HOST_A)[0];
      const vieja = {
        headers: new Headers({ cookie: `__Secure-pd_emp.session_token=${cookie?.valor}` }),
      };
      expect(await a.autenticacion.sesionDe(vieja, HOST_A)).toBeNull();
    });
  });

  describe("límite de pedidos en la base", () => {
    it("el cuarto pedido seguido de empezar un ingreso desde la misma IP se frena (429) y deja su contador en la base", async () => {
      const n = new Navegador("198.51.100.201");
      const estados: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await n.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-in/social", {
          cuerpo: { provider: "google", callbackURL: "/" },
        });
        estados.push(r.estado);
      }
      expect(estados.slice(0, 3)).toEqual([200, 200, 200]);
      expect(estados.slice(3)).toEqual([429, 429]);
      const { rows } = await dueno.query<{ key: string; count: number }>(
        `select key, count from autenticacion."rateLimit" where key like '198.51.100.201%'`,
      );
      expect(rows.length).toBeGreaterThan(0);
      // Otra IP no queda afectada.
      const otro = await new Navegador("198.51.100.202").pedir(
        a.autenticacion,
        HOST_A,
        "POST",
        "/api/auth/sign-in/social",
        { cuerpo: { provider: "google", callbackURL: "/" } },
      );
      expect(otro.estado).toBe(200);
    });

    it("S3: un x-forwarded-for falseado NO cambia la clave del límite: se cuenta por el encabezado de confianza", async () => {
      const ipReal = "198.51.100.211";
      const n = new Navegador(ipReal);
      const estados: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await n.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-in/social", {
          cuerpo: { provider: "google", callbackURL: "/" },
          // Cada pedido jura venir de una IP distinta: si la librería le creyera, nunca se frenaría.
          encabezados: { "x-forwarded-for": `203.0.113.${100 + i}` },
        });
        estados.push(r.estado);
      }
      expect(estados).toEqual([200, 200, 200, 429, 429]);
      const { rows } = await dueno.query<{ key: string }>(
        `select key from autenticacion."rateLimit" where key like '203.0.113.%' or key like '${ipReal}%'`,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const { key } of rows) expect(key.startsWith(`${ipReal}|`), key).toBe(true);
    });

    it("S3: sin el encabezado de confianza, un x-forwarded-for falseado tampoco da una IP: balde compartido, que frena igual", async () => {
      const n = new Navegador(null);
      const estados: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await n.pedir(a.autenticacion, HOST_A, "POST", "/api/auth/sign-in/social", {
          cuerpo: { provider: "google", callbackURL: "/" },
          encabezados: { "x-forwarded-for": `203.0.113.${150 + i}` },
        });
        estados.push(r.estado);
      }
      expect(estados.slice(3)).toEqual([429, 429]);
      const { rows } = await dueno.query<{ key: string }>(
        `select key from autenticacion."rateLimit" where key like '203.0.113.%'`,
      );
      expect(rows).toEqual([]);
    });

    it("S3: el encabezado de confianza es el fijado (y x-forwarded-for no está entre los que lee la librería)", () => {
      expect(ENCABEZADO_DE_IP).toBe("x-vercel-forwarded-for");
    });
  });

  describe("hosts inválidos y caché de instancias", () => {
    it.each([
      "",
      " ",
      "app marca.test",
      "https://app.marca.test",
      "app.marca.test/x",
      "127.0.0.1",
      "[::1]",
      "app..test",
      "-a.test",
      "a".repeat(64) + ".test",
      "app.marca.test:0",
      "app.marca.test:99999",
      "user@app.test",
    ])("el host %j no arma ninguna instancia: sin sesión y ruta neutra", async (host) => {
      const n = new Navegador();
      expect(
        await a.autenticacion.sesionDe({ headers: new Headers({ cookie: "x=y" }) }, host),
      ).toBeNull();
      const r = await a.autenticacion.manejar(
        new Request("https://app.marca.test/api/auth/get-session"),
        host,
      );
      expect(r.status).toBe(404);
      expect(r.headers.getSetCookie()).toEqual([]);
      expect(n.cookiesDe(host)).toEqual([]);
    });

    it("con más hosts que lugares en la caché sigue andando: sale el menos usado y se vuelve a armar", async () => {
      const chica = armarAutenticacionDePrueba(propia.base, proveedor, { capacidadDeLaCache: 2 });
      try {
        const hosts = ["h1.marca.test", "h2.marca.test", "h3.marca.test", "h1.marca.test"];
        for (const h of hosts) {
          const n = new Navegador();
          const r = await n.ingresarConGoogle(chica.autenticacion, h, proveedor, perfilAlAzar());
          expect(r.ubicacion, h).toBe("/");
          expect(await chica.autenticacion.sesionDe(n.pedidoDe(h), h), h).not.toBeNull();
        }
      } finally {
        await chica.cerrar();
      }
    });
  });
});
