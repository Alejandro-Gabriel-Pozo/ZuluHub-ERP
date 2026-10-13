import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearResolucionDeHost } from "../../src/adaptadores/postgres/resolucion-de-host";
import { atenderRutaDeIngreso } from "../../src/composicion/ruta-de-ingreso";
import type { Autenticacion } from "../../src/puertos/autenticacion";
import { crearBaseAparte } from "./entorno";
import {
  Navegador,
  armarAutenticacionDePrueba,
  levantarProveedorLocal,
  perfilAlAzar,
  type AutenticacionDePrueba,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";
import {
  crearDominio,
  crearMarca,
  crearVersionDeMarcaConfirmada,
  hostAlAzar,
  marcaPrincipal,
} from "./marcas-apoyo";
import { crearEntornoPublico } from "./resolucion-apoyo";

/**
 * Autenticación (W3b), G8: las rutas de ingreso (`/api/auth/*`) se sirven SOLO en un host de aplicación. La
 * resolución del host es la real (puerta pública sobre el rol `zuluhub_publico`, con dominios de verdad en la
 * base); la autenticación es la real (Better Auth y el proveedor local). En un host de landing, de carta,
 * desconocido o retirado la respuesta es el 404 neutro, igual para todos y sin cookies. Una base que no
 * responde al resolver es 503 con referencia, nunca el 404 ni otra marca. Un fallo no sale con detalle.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "autenticación: la ruta /api/auth solo en hosts de aplicación (G8)",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: ReturnType<typeof crearEntornoPublico>;
    let proveedor: ProveedorLocal;
    let a: AutenticacionDePrueba;
    let registros: string[];
    let hostApp: string;
    let hostLanding: string;
    let hostCarta: string;
    let hostRetirado: string;
    let hostSinVersion: string;

    const dependencias = (autenticacion: Autenticacion = a.autenticacion) => ({
      resolucionDeHost: () => crearResolucionDeHost(entorno),
      autenticacion: () => autenticacion,
      registrar: (d: string) => registros.push(d),
    });
    /** El pedido tal como lo recibe la ruta: el host viaja en la cabecera `host`. */
    const pedido = (
      host: string,
      ruta = "/api/auth/get-session",
      metodo = "GET",
      cookie?: string,
    ) =>
      new Request(`https://servidor.interno.test${ruta}`, {
        method: metodo,
        headers: {
          host,
          origin: `https://${host}`,
          "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 250)}`,
          ...(cookie === undefined ? {} : { cookie }),
          ...(metodo === "POST" ? { "content-type": "application/json" } : {}),
        },
        ...(metodo === "POST"
          ? { body: JSON.stringify({ provider: "google", callbackURL: "/" }) }
          : {}),
      });

    beforeAll(async () => {
      if (base === null) return;
      vi.stubEnv("NODE_ENV", "production");
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      entorno = crearEntornoPublico(propia.base);
      proveedor = await levantarProveedorLocal();
      a = armarAutenticacionDePrueba(propia.base, proveedor);
      registros = [];

      const principal = await marcaPrincipal(dueno);
      await crearVersionDeMarcaConfirmada(dueno, principal, { nombreVisible: "Principal" });
      const marca = await crearMarca(dueno, { padre: principal });
      await crearVersionDeMarcaConfirmada(dueno, marca, { nombreVisible: "Marca de prueba" });
      hostApp = (await crearDominio(dueno, marca, { canonico: true, superficie: "APP" })).host;
      hostLanding = (await crearDominio(dueno, marca, { superficie: "LANDING" })).host;
      hostCarta = (await crearDominio(dueno, marca, { superficie: "CARTA" })).host;
      hostRetirado = (await crearDominio(dueno, marca, { superficie: "APP", estado: "RETIRADO" }))
        .host;
      const sinVersion = await crearMarca(dueno, { padre: principal });
      hostSinVersion = (await crearDominio(dueno, sinVersion, { superficie: "APP" })).host;
    });
    afterAll(async () => {
      expect(proveedor.intentosExternos(), "nada salió a internet").toEqual([]);
      await a.cerrar();
      await entorno.cerrar();
      await dueno.end();
      await proveedor.cerrar();
      await propia.destruir();
      vi.unstubAllEnvs();
    });

    it("en un host de aplicación atiende el ingreso de punta a punta, con la sesión atada a ESE host", async () => {
      const respuesta = await atenderRutaDeIngreso(
        pedido(hostApp, "/api/auth/sign-in/social", "POST"),
        dependencias(),
      );
      expect(respuesta.status).toBe(200);
      const { url } = (await respuesta.json()) as { url: string };
      expect(new URL(url).searchParams.get("redirect_uri")).toBe(
        `https://${hostApp}/api/auth/callback/google`,
      );

      // Y un ingreso completo por la misma ruta deja la sesión con el host de la aplicación.
      const n = new Navegador();
      const camino = await n.empezarIngreso(a.autenticacion, hostApp, proveedor, perfilAlAzar());
      const volvio = await atenderRutaDeIngreso(
        new Request(`https://${hostApp}${camino}`, {
          headers: {
            host: hostApp,
            cookie: n
              .cookiesDe(hostApp)
              .map((c) => `${c.nombre}=${c.valor}`)
              .join("; "),
          },
        }),
        dependencias(),
      );
      expect(volvio.status).toBe(302);
      expect(volvio.headers.get("location")).toBe("/");
      const { rows } = await dueno.query<{ host: string }>(
        'select host from autenticacion.session order by "createdAt" desc limit 1',
      );
      expect(rows[0]?.host).toBe(hostApp);
    });

    it("el host se lee de la cabecera host, nunca de X-Forwarded-Host: un host ajeno no se hace pasar por uno de aplicación", async () => {
      const p = pedido(hostLanding);
      p.headers.set("x-forwarded-host", hostApp);
      const r = await atenderRutaDeIngreso(p, dependencias());
      expect(r.status).toBe(404);
    });

    it.each([
      ["una landing", () => hostLanding],
      ["una carta", () => hostCarta],
      ["un dominio retirado", () => hostRetirado],
      ["un host de una marca sin versión vigente", () => hostSinVersion],
      ["un host desconocido", () => hostAlAzar()],
      ["un host de Vercel", () => "zuluhub-erp-git-rama.vercel.app"],
      ["una IP", () => "203.0.113.5"],
      ["un host con sufijo engañoso", () => `${hostApp}.malo.test`],
      ["un host con otro puerto que no existe", () => `${hostApp}:99999`],
      ["sin host", () => ""],
    ])("%s: 404 neutro, sin cuerpo, sin cookies y sin crear nada", async (_nombre, host) => {
      const antes = Number(
        (await dueno.query<{ n: string }>("select count(*) as n from autenticacion.session"))
          .rows[0]?.n,
      );
      for (const [ruta, metodo] of [
        ["/api/auth/get-session", "GET"],
        ["/api/auth/sign-in/social", "POST"],
        ["/api/auth/callback/google?code=x&state=y", "GET"],
        ["/api/auth/sign-out", "POST"],
      ] as const) {
        const r = await atenderRutaDeIngreso(pedido(host(), ruta, metodo), dependencias());
        expect(r.status, `${metodo} ${ruta}`).toBe(404);
        expect(await r.text(), `${metodo} ${ruta}`).toBe("");
        expect(r.headers.getSetCookie(), `${metodo} ${ruta}`).toEqual([]);
        expect(r.headers.get("x-robots-tag")).toBe("noindex");
        expect(r.headers.get("cache-control")).toBe("private, no-store");
      }
      const despues = Number(
        (await dueno.query<{ n: string }>("select count(*) as n from autenticacion.session"))
          .rows[0]?.n,
      );
      expect(despues).toBe(antes);
    });

    it("la respuesta de un host que no se sirve es idéntica a la de un host desconocido (sin oráculo)", async () => {
      const referencia = await atenderRutaDeIngreso(pedido(hostAlAzar()), dependencias());
      const texto = async (r: Response) => ({
        estado: r.status,
        cuerpo: await r.text(),
        cabeceras: [...r.headers.entries()].sort(),
      });
      const esperado = await texto(referencia);
      for (const host of [hostLanding, hostCarta, hostRetirado, hostSinVersion]) {
        expect(await texto(await atenderRutaDeIngreso(pedido(host), dependencias()))).toEqual(
          esperado,
        );
      }
    });

    it("una cookie de sesión de la aplicación presentada en un host de landing no se mira ni se toca", async () => {
      const n = new Navegador();
      await n.ingresarConGoogle(a.autenticacion, hostApp, proveedor, perfilAlAzar());
      const cookie = n
        .cookiesDe(hostApp)
        .map((c) => `${c.nombre}=${c.valor}`)
        .join("; ");
      const antes = await dueno.query(
        `select "updatedAt", "expiresAt" from autenticacion.session order by "createdAt" desc limit 1`,
      );
      const r = await atenderRutaDeIngreso(
        pedido(hostLanding, "/api/auth/get-session", "GET", cookie),
        dependencias(),
      );
      expect(r.status).toBe(404);
      const despues = await dueno.query(
        `select "updatedAt", "expiresAt" from autenticacion.session order by "createdAt" desc limit 1`,
      );
      expect(despues.rows).toEqual(antes.rows);
    });

    it("si la base no responde al resolver el host: 503 con referencia, nunca el 404 neutro ni otra marca", async () => {
      const url = new URL(propia.base.publico);
      url.password = "clave-equivocada";
      const rota = crearEntornoPublico(propia.base, { url: url.toString() });
      registros.length = 0;
      try {
        const r = await atenderRutaDeIngreso(pedido(hostApp), {
          ...dependencias(),
          resolucionDeHost: () => crearResolucionDeHost(rota),
          azar: () => new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
        });
        expect(r.status).toBe(503);
        expect(await r.json()).toEqual({ codigo: "NO_DISPONIBLE", referencia: "ZH-DEAD-BEEF" });
        expect(r.headers.getSetCookie()).toEqual([]);
        expect(registros.join("\n")).toContain("ZH-DEAD-BEEF");
      } finally {
        await rota.cerrar();
      }
    });

    it("un fallo interno sale con una referencia y SIN detalle; el detalle queda en el registro del servidor", async () => {
      const url = new URL(propia.base.autenticacion);
      url.password = "clave-equivocada";
      const rota = armarAutenticacionDePrueba(propia.base, proveedor, { url: url.toString() });
      registros.length = 0;
      try {
        const r = await atenderRutaDeIngreso(
          pedido(hostApp, "/api/auth/get-session", "GET", "__Secure-zh_emp.session_token=x.y"),
          {
            ...dependencias(rota.autenticacion),
            azar: () => new Uint8Array([0x01, 0x02, 0x03, 0x04]),
          },
        );
        expect(r.status).toBe(500);
        const cuerpo = await r.text();
        expect(JSON.parse(cuerpo)).toEqual({ codigo: "ERROR_INTERNO", referencia: "ZH-0102-0304" });
        expect(cuerpo).not.toMatch(
          /password|authentication|zuluhub_|postgres|clave-equivocada|autenticacion/i,
        );
        expect(r.headers.getSetCookie()).toEqual([]);
        expect(registros.join("\n")).toContain("ZH-0102-0304");
      } finally {
        await rota.cerrar();
      }
    });
  },
);
