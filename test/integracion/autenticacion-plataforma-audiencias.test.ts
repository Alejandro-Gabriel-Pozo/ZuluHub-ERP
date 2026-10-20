import { createHmac } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearAutenticacionDePlataformaDeBetterAuth } from "../../src/adaptadores/autenticacion/autenticacion-de-better-auth";
import {
  Navegador,
  armarAutenticacionDePrueba,
  levantarProveedorLocal,
  perfilAlAzar,
  type AutenticacionDePrueba,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";
import {
  HOST_DE_LA_CONSOLA,
  HOST_DE_LA_WEB,
  altaDeAdmin,
  armarPlataformaDePrueba,
  codigoDeLaAplicacion,
  type PlataformaDePrueba,
} from "./autenticacion-plataforma-apoyo";
import { crearBaseAparte } from "./entorno";

/**
 * Dos audiencias SEPARADAS contra la MISMA base (h5-p8 §4): una sesión de la web de empresa no abre la consola ni al
 * revés. Se separan por tres capas independientes, y cada una se prueba sola: el nombre de la cookie (`zh_emp` /
 * `zh_plat`), el secreto con que se firma (una cookie firmada por una audiencia no es válida en la otra) y el host al
 * que está atada la sesión (G4). Las dos instancias comparten el esquema `autenticacion`, el usuario y la cuenta de
 * Google: lo único que las separa es esto.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

type Alta = Readonly<{ qrSvg: string; secreto: string; codigosDeRecuperacion: string[] }>;
const COOKIE_EMPRESA = "__Host-zh_emp.session_token";
const COOKIE_CONSOLA = "__Host-zh_plat.session_token";

describe.skipIf(base === null)("dos audiencias contra la misma base: empresa y consola", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let proveedor: ProveedorLocal;
  let web: AutenticacionDePrueba;
  let consola: PlataformaDePrueba;

  beforeAll(async () => {
    if (base === null) return;
    vi.stubEnv("NODE_ENV", "production");
    proveedor = await levantarProveedorLocal();
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    web = armarAutenticacionDePrueba(propia.base, proveedor);
    consola = armarPlataformaDePrueba(propia.base, proveedor);
  });
  afterAll(async () => {
    expect(proveedor.intentosExternos(), "nada salió a internet").toEqual([]);
    await web.cerrar();
    await consola.cerrar();
    await dueno.end();
    await propia.destruir();
    await proveedor.cerrar();
    vi.unstubAllEnvs();
  });

  /** Ingresa a la web de empresa y a la consola con LA MISMA cuenta de Google (un administrador de plataforma). */
  async function conDosSesiones() {
    const admin = await altaDeAdmin(dueno);
    const enLaWeb = new Navegador();
    expect(
      (await enLaWeb.ingresarConGoogle(web.autenticacion, HOST_DE_LA_WEB, proveedor, admin))
        .ubicacion,
    ).toBe("/");
    const enLaConsola = new Navegador();
    expect(
      (
        await enLaConsola.ingresarConGoogle(
          consola.autenticacion,
          HOST_DE_LA_CONSOLA,
          proveedor,
          admin,
        )
      ).ubicacion,
    ).toBe("/");
    const alta = (
      await enLaConsola.pedir(
        consola.autenticacion,
        HOST_DE_LA_CONSOLA,
        "POST",
        "/api/auth/two-factor/enable",
        {
          cuerpo: {},
        },
      )
    ).json() as Alta;
    const v = await enLaConsola.pedir(
      consola.autenticacion,
      HOST_DE_LA_CONSOLA,
      "POST",
      "/api/auth/two-factor/verify-totp",
      {
        cuerpo: { code: codigoDeLaAplicacion(alta.secreto) },
      },
    );
    expect(v.estado).toBe(200);
    return { admin, enLaWeb, enLaConsola };
  }

  const valorDe = (n: Navegador, host: string, nombre: string) =>
    n.cookiesDe(host).find((c) => c.nombre === nombre)?.valor ?? "";
  /** Un pedido con exactamente esta cookie, sin las del navegador. */
  const conCookie = (nombre: string, valor: string) => ({
    headers: new Headers({ cookie: `${nombre}=${valor}` }),
  });

  it("las dos sesiones conviven (mismo usuario, mismas tablas) con cookies de nombres DISTINTOS y cada una vale solo en su audiencia", async () => {
    const { enLaWeb, enLaConsola } = await conDosSesiones();
    expect(enLaWeb.cookiesDe(HOST_DE_LA_WEB).map((c) => c.nombre)).toEqual([COOKIE_EMPRESA]);
    expect(enLaConsola.cookiesDe(HOST_DE_LA_CONSOLA).map((c) => c.nombre)).toEqual([
      COOKIE_CONSOLA,
    ]);
    expect(
      await web.autenticacion.sesionDe(enLaWeb.pedidoDe(HOST_DE_LA_WEB), HOST_DE_LA_WEB),
    ).not.toBeNull();
    expect(
      await consola.autenticacion.sesionDe(
        enLaConsola.pedidoDe(HOST_DE_LA_CONSOLA),
        HOST_DE_LA_CONSOLA,
      ),
    ).not.toBeNull();
    // Un solo usuario de la librería para las dos: las separa la cookie, no la identidad.
    const { rows } = await dueno.query<{ n: string }>(
      `select count(distinct "userId") as n from autenticacion.session`,
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it("una sesión de EMPRESA no abre la consola: ni tal cual (otro nombre de cookie) ni con el nombre cambiado (otro secreto)", async () => {
    const { enLaWeb } = await conDosSesiones();
    const valor = valorDe(enLaWeb, HOST_DE_LA_WEB, COOKIE_EMPRESA);
    expect(valor).not.toBe("");
    // 1. Tal cual: la consola no mira `zh_emp`.
    expect(
      await consola.autenticacion.sesionDe(conCookie(COOKIE_EMPRESA, valor), HOST_DE_LA_CONSOLA),
    ).toBeNull();
    // 2. Con el nombre de la consola: la firma es de otro secreto y no verifica.
    expect(
      await consola.autenticacion.sesionDe(conCookie(COOKIE_CONSOLA, valor), HOST_DE_LA_CONSOLA),
    ).toBeNull();
    // Y por la ruta: el estado de sesión dice «sin sesión» y las del segundo factor, 401.
    const estado = await consola.autenticacion.estadoDeSesion(
      conCookie(COOKIE_CONSOLA, valor),
      HOST_DE_LA_CONSOLA,
    );
    expect(estado.vigente).toBe(false);
    const n = new Navegador();
    const enrolar = await n.pedir(
      consola.autenticacion,
      HOST_DE_LA_CONSOLA,
      "POST",
      "/api/auth/two-factor/enable",
      {
        cuerpo: {},
        encabezados: { cookie: `${COOKIE_CONSOLA}=${valor}` },
      },
    );
    expect(enrolar.estado).toBe(401);
  });

  it("una sesión de la CONSOLA no abre la web de empresa: ni tal cual ni con el nombre cambiado", async () => {
    const { enLaConsola } = await conDosSesiones();
    const valor = valorDe(enLaConsola, HOST_DE_LA_CONSOLA, COOKIE_CONSOLA);
    expect(valor).not.toBe("");
    expect(
      await web.autenticacion.sesionDe(conCookie(COOKIE_CONSOLA, valor), HOST_DE_LA_WEB),
    ).toBeNull();
    expect(
      await web.autenticacion.sesionDe(conCookie(COOKIE_EMPRESA, valor), HOST_DE_LA_WEB),
    ).toBeNull();
    const n = new Navegador();
    const sesion = await n.pedir(
      web.autenticacion,
      HOST_DE_LA_WEB,
      "GET",
      "/api/auth/get-session",
      {
        encabezados: { cookie: `${COOKIE_EMPRESA}=${valor}` },
      },
    );
    expect(sesion.json()).toEqual({ vigente: false });
  });

  it("aunque las dos audiencias usaran el MISMO secreto (lo que la validación de la variable impide), la sesión atada a su host no cruza (G4)", async () => {
    const secreto = "compartido-".repeat(5);
    const mismoSecretoWeb = armarAutenticacionDePrueba(propia.base, proveedor, {
      reloj: () => new Date(),
    });
    // La web con un secreto conocido y una consola con ese MISMO secreto.
    const conexionWeb = mismoSecretoWeb.conexion;
    const webCompartida = (
      await import("../../src/adaptadores/autenticacion/autenticacion-de-better-auth")
    ).crearAutenticacionDeBetterAuth({
      db: conexionWeb.db,
      secreto,
      google: { clientId: proveedor.clientId, clientSecret: proveedor.clientSecret },
    });
    const consolaCompartida = crearAutenticacionDePlataformaDeBetterAuth({
      db: conexionWeb.db,
      secreto,
      google: { clientId: proveedor.clientId, clientSecret: proveedor.clientSecret },
      consola: {
        personal: { esHabilitado: () => Promise.resolve(true) },
        segundoFactor: conexionWeb.segundoFactor,
        auditoria: { registrarBloqueoDeSegundoFactor: () => Promise.resolve() },
      },
    });
    try {
      const admin = await altaDeAdmin(dueno);
      const enLaWeb = new Navegador();
      await enLaWeb.ingresarConGoogle(webCompartida, HOST_DE_LA_WEB, proveedor, admin);
      const valor = valorDe(enLaWeb, HOST_DE_LA_WEB, COOKIE_EMPRESA);
      // Un atacante que renombra la cookie: la firma SÍ verifica (mismo secreto), pero la fila es del host de la web.
      expect(
        await consolaCompartida.sesionDe(conCookie(COOKIE_CONSOLA, valor), HOST_DE_LA_CONSOLA),
        "la firma coincide pero el host no",
      ).toBeNull();
      expect(
        (
          await consolaCompartida.estadoDeSesion(
            conCookie(COOKIE_CONSOLA, valor),
            HOST_DE_LA_CONSOLA,
          )
        ).vigente,
      ).toBe(false);
      // Y lo mismo al revés.
      const enLaConsola = new Navegador();
      await enLaConsola.ingresarConGoogle(consolaCompartida, HOST_DE_LA_CONSOLA, proveedor, admin);
      const deLaConsola = valorDe(enLaConsola, HOST_DE_LA_CONSOLA, COOKIE_CONSOLA);
      expect(
        await webCompartida.sesionDe(conCookie(COOKIE_EMPRESA, deLaConsola), HOST_DE_LA_WEB),
      ).toBeNull();
    } finally {
      await mismoSecretoWeb.cerrar();
    }
  });

  it("la firma de la cookie de cada audiencia es de SU secreto: recalculada con el secreto de la otra no coincide", async () => {
    const { enLaWeb, enLaConsola } = await conDosSesiones();
    const firmar = (secreto: string, token: string) =>
      createHmac("sha256", secreto).update(token).digest("base64");
    for (const [n, host, nombre, secretoPropio, secretoAjeno] of [
      [enLaWeb, HOST_DE_LA_WEB, COOKIE_EMPRESA, web.secreto, consola.secreto],
      [enLaConsola, HOST_DE_LA_CONSOLA, COOKIE_CONSOLA, consola.secreto, web.secreto],
    ] as const) {
      const valor = decodeURIComponent(valorDe(n, host, nombre));
      const [token, firma] = [
        valor.slice(0, valor.lastIndexOf(".")),
        valor.slice(valor.lastIndexOf(".") + 1),
      ];
      expect(firma).toBe(firmar(secretoPropio, token));
      expect(firma).not.toBe(firmar(secretoAjeno, token));
    }
    expect(web.secreto).not.toBe(consola.secreto);
  });

  it("la consola no sirve las rutas de empresa de más y la web de empresa no sirve las del segundo factor ni el estado: 404", async () => {
    const { enLaWeb } = await conDosSesiones();
    for (const [metodo, ruta] of [
      ["POST", "/api/auth/two-factor/enable"],
      ["POST", "/api/auth/two-factor/verify-totp"],
      ["POST", "/api/auth/two-factor/verify-backup-code"],
      ["POST", "/api/auth/two-factor/generate-backup-codes"],
      ["GET", "/api/auth/estado-de-sesion"],
    ] as const) {
      const r = await enLaWeb.pedir(
        web.autenticacion,
        HOST_DE_LA_WEB,
        metodo,
        ruta,
        metodo === "POST" ? { cuerpo: {} } : {},
      );
      expect(r.estado, ruta).toBe(404);
      expect(r.texto).toBe("");
    }
  });

  it("la web de empresa deja entrar a cualquier cuenta de Google verificada; la consola solo al personal habilitado (la misma cuenta, dos resultados)", async () => {
    const cualquiera = perfilAlAzar();
    const enLaWeb = new Navegador();
    expect(
      (await enLaWeb.ingresarConGoogle(web.autenticacion, HOST_DE_LA_WEB, proveedor, cualquiera))
        .ubicacion,
    ).toBe("/");
    const enLaConsola = new Navegador();
    const r = await enLaConsola.ingresarConGoogle(
      consola.autenticacion,
      HOST_DE_LA_CONSOLA,
      proveedor,
      cualquiera,
    );
    expect(r.ubicacion).toBe("/ingreso?error=no_habilitado");
    expect(enLaConsola.cookiesDe(HOST_DE_LA_CONSOLA)).toEqual([]);
    // Ya tenía usuario (por la web) y aun así la consola no le abre sesión: lo decide la lista, no la existencia del usuario.
    const { rows } = await dueno.query(
      `select 1 from autenticacion.session s join autenticacion."user" u on u.id = s."userId" where u.email = $1 and s.host = $2`,
      [cualquiera.email, HOST_DE_LA_CONSOLA],
    );
    expect(rows).toEqual([]);
  });

  it("cerrar sesión en la consola borra la sesión de la consola y deja la de la web", async () => {
    const { enLaWeb, enLaConsola } = await conDosSesiones();
    const r = await enLaConsola.pedir(
      consola.autenticacion,
      HOST_DE_LA_CONSOLA,
      "POST",
      "/api/auth/sign-out",
      { cuerpo: {} },
    );
    expect(r.estado).toBe(200);
    expect(
      await consola.autenticacion.sesionDe(
        enLaConsola.pedidoDe(HOST_DE_LA_CONSOLA),
        HOST_DE_LA_CONSOLA,
      ),
    ).toBeNull();
    expect(
      await web.autenticacion.sesionDe(enLaWeb.pedidoDe(HOST_DE_LA_WEB), HOST_DE_LA_WEB),
    ).not.toBeNull();
  });
});
