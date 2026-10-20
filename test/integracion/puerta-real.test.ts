import fc from "fast-check";
import pg from "pg";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  armarFuenteDePuertas,
  type FuenteDePuertas,
} from "../../src/capacidades/experiencia/fuente-de-puertas";
import { armarConexiones } from "../../src/composicion/conexiones";
import { armarWeb } from "../../src/composicion/web";
import { crearBarrera, crearBaseAparte } from "./entorno";
import {
  crearDominio,
  crearMarca,
  crearVersionDeMarcaConfirmada,
  marcaPrincipal,
} from "./marcas-apoyo";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La puerta REAL (W4b): la fuente enchufada a la puerta pública con el rol `pedernal_publico` de las
 * pruebas, sobre una base propia con dos marcas sembradas (A y B) y sus dominios ACTIVO, RETIRADO y
 * PENDIENTE en las superficies APP, LANDING, CARTA y CONSOLA, más una marca sin versión confirmada. Se
 * arma EXACTAMENTE como lo hace `apps/web/servidor/fuente-de-puertas.ts` (`armarWeb` sobre `armarConexiones`
 * con la cadena pública como única variable) y se recorre lo que garantiza W4: la página de un host trae
 * su marca y nada de la otra, lo no servible es la neutra 404 sin cookies, la base caída es la neutra 503
 * sin detalle, la caché (≤ 60 s) no mezcla hosts ni guarda fallos y, bajo concurrencia, cada resolución
 * devuelve la marca de SU host.
 */
vi.mock("server-only", () => ({}));
const pedidoActual = vi.hoisted(() => ({
  encabezados: new Headers(),
  fuente: null as null | {
    consultarHost: FuenteDePuertas["consultarHost"];
    leerMarca: FuenteDePuertas["leerMarca"];
  },
}));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(pedidoActual.encabezados) }));
vi.mock("../../apps/web/servidor/fuente-de-puertas", () => ({
  fuenteDePuertas: {
    consultarHost: (...a: Parameters<FuenteDePuertas["consultarHost"]>) =>
      (pedidoActual.fuente as FuenteDePuertas).consultarHost(...a),
    leerMarca: (...a: Parameters<FuenteDePuertas["leerMarca"]>) =>
      (pedidoActual.fuente as FuenteDePuertas).leerMarca(...a),
  },
}));
vi.mock("../../apps/web/servidor/guarda", () => ({ baseAlDia: () => Promise.resolve(true) }));

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const NONCE = "bm9uY2UtZGUtcHJ1ZWJhLTE2Ynl0ZXM=";

type Marca = Readonly<{
  id: string;
  nombre: string;
  tema: Record<string, string>;
  /** Palabras que solo existen en esta marca. */
  senas: readonly string[];
  dominio: string;
  app: string;
  landing: string;
  carta: string;
  consola: string;
  retirado: string;
  pendiente: string;
}>;

const hostsDe = (dominio: string) => ({
  dominio,
  app: `app.${dominio}`,
  landing: dominio,
  carta: `carta.${dominio}`,
  consola: `consola.${dominio}`,
  retirado: `viejo.${dominio}`,
  pendiente: `pendiente.${dominio}`,
});

describe.skipIf(base === null)("la puerta real contra la base con el rol público", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let A: Marca;
  let B: Marca;
  let sinVersion: string;
  let urlDeLaPublica: string;
  const cierres: (() => Promise<void>)[] = [];

  /** Una fuente armada igual que la de `apps/web`, con la cadena que se pida (o sin ninguna variable). */
  function fuenteCon(url: string | null, registro: string[] = []): FuenteDePuertas {
    const conexiones = armarConexiones({
      fuente: () => (url === null ? {} : { PEDERNAL_DB_PUBLICO: url }),
      registrar: (detalle) => registro.push(detalle),
    });
    cierres.push(async () => {
      try {
        await conexiones.transaccionesPublicas().cerrar();
      } catch {
        // Sin variable no hubo pool que cerrar.
      }
    });
    const web = armarWeb(conexiones);
    return armarFuenteDePuertas({
      resolucion: () => web.resolucionDeHost(),
      configuracion: () => web.configuracionPublicaDeHost(),
    });
  }
  const urlDeRolInexistente = (): string => {
    const url = new URL(urlDeLaPublica);
    url.username = "pedernal_rol_que_no_existe";
    return url.toString();
  };

  async function sembrarMarca(
    nombre: string,
    tema: Record<string, string>,
    senas: readonly string[],
    dominio: string,
    padre: string,
  ): Promise<Marca> {
    const id = await crearMarca(dueno, { padre });
    await crearVersionDeMarcaConfirmada(dueno, id, { nombreVisible: nombre, tema });
    const h = hostsDe(dominio);
    await crearDominio(dueno, id, { host: h.app, superficie: "APP", canonico: true });
    await crearDominio(dueno, id, { host: h.landing, superficie: "LANDING" });
    await crearDominio(dueno, id, { host: h.carta, superficie: "CARTA" });
    await crearDominio(dueno, id, { host: h.consola, superficie: "CONSOLA" });
    await crearDominio(dueno, id, { host: h.retirado, superficie: "APP", estado: "RETIRADO" });
    await crearDominio(dueno, id, {
      host: h.pendiente,
      superficie: "APP",
      estado: "PENDIENTE_VERIFICACION",
    });
    return { id, nombre, tema, senas, ...h };
  }

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    urlDeLaPublica = propia.base.publico;
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    const principal = await marcaPrincipal(dueno);
    // La principal, servible y con tema: si algún host ajeno cayera en ella, se vería.
    await crearVersionDeMarcaConfirmada(dueno, principal, {
      nombreVisible: "Casa Central",
      tema: {
        primary: "#101010",
        "on-primary": "#ffffff",
        secondary: "#202020",
        accent: "#303030",
      },
    });
    await crearDominio(dueno, principal, { host: "app.casacentral.test", canonico: true });
    A = await sembrarMarca(
      "Hotel del Lago",
      { primary: "#7a1f1f", "on-primary": "#ffffff", secondary: "#444444", accent: "#a15c00" },
      ["Hotel del Lago", "hoteldellago", "#7a1f1f", "#a15c00"],
      "hoteldellago.test",
      principal,
    );
    B = await sembrarMarca(
      "Panadería Los Pinos",
      { primary: "#1f5e3a", "on-primary": "#ffffff", secondary: "#2d2d2d", accent: "#0b6b8a" },
      ["Panadería Los Pinos", "panaderialospinos", "#1f5e3a", "#0b6b8a"],
      "panaderialospinos.test",
      principal,
    );
    // Una marca activa con un dominio activo pero SIN versión confirmada: no se puede nombrar.
    const sin = await crearMarca(dueno, { padre: principal });
    sinVersion = "app.sinversion.test";
    await crearDominio(dueno, sin, { host: sinVersion, superficie: "APP" });
    pedidoActual.fuente = fuenteCon(urlDeLaPublica);
  });
  afterAll(async () => {
    for (const cerrar of cierres) await cerrar();
    await dueno.end();
    await propia.destruir();
  });

  // ---- apoyo para recorrer el servidor --------------------------------------------------------------
  const comoPedido = (host: string): void => {
    pedidoActual.encabezados = new Headers({ host, "x-pd-nonce": NONCE });
  };
  const esNoEncontrada = (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String(error.digest).includes("404");
  async function conNoEncontrada<T>(trabajo: () => Promise<T>): Promise<T | null> {
    try {
      return await trabajo();
    } catch (error) {
      if (esNoEncontrada(error)) return null;
      throw error;
    }
  }
  async function landing(): Promise<string | null> {
    const { default: Layout } = await import("../../apps/web/app/s/landing/layout");
    const { default: Pagina } = await import("../../apps/web/app/s/landing/page");
    return conNoEncontrada(async () =>
      renderToStaticMarkup(await Layout({ children: await Pagina() })),
    );
  }
  async function layoutDeApp(): Promise<string | null> {
    const { default: Layout } = await import("../../apps/web/app/s/app/layout");
    // Desde W5 el layout solo pone el tema; la cabecera de la marca la trae cada pantalla (aquí, el 404 de la app).
    const { default: NoEncontrada } = await import("../../apps/web/app/s/app/not-found");
    return conNoEncontrada(async () =>
      renderToStaticMarkup(await Layout({ children: await NoEncontrada() })),
    );
  }
  const pedido = (host: string, ruta = "/") =>
    new NextRequest(`https://puerta.test${ruta}`, { headers: host === "" ? {} : { host } });
  const reescritura = (r: Response): string | null => {
    const destino = r.headers.get("x-middleware-rewrite");
    return destino === null ? null : new URL(destino).pathname;
  };
  /** Todo lo que de una marca podría verse en una respuesta de la puerta (menos el eco del `host` que mandó el cliente). */
  const textoDeCabeceras = (r: Response): string =>
    [...r.headers.entries()]
      .filter(([nombre]) => nombre !== "x-middleware-request-host")
      .map(([n, v]) => `${n}: ${v}`)
      .join("\n");
  const sinDe = (m: Marca): readonly string[] => (m === A ? B : A).senas;

  // ---- 1. aislamiento entre marcas -------------------------------------------------------------------
  describe("la página de un host trae SU marca y nada de la otra", () => {
    it("landing y app de A y de B", async () => {
      for (const [marca, host, pagina] of [
        [A, A.landing, landing],
        [B, B.landing, landing],
        [A, A.app, layoutDeApp],
        [B, B.app, layoutDeApp],
      ] as const) {
        comoPedido(host);
        const texto = await pagina();
        expect(texto, host).not.toBeNull();
        expect(texto).toContain(marca.nombre);
        expect(texto).toContain(`--brand-primary:${marca.tema["primary"]}`);
        expect(texto).toContain(`--brand-accent:${marca.tema["accent"]}`);
        for (const sena of sinDe(marca)) expect(texto, sena).not.toContain(sena);
        expect(texto).not.toContain("Casa Central");
        expect(texto).not.toContain("#101010");
      }
    });

    it("el «Ingresar» de la landing apunta a la app de la MISMA marca", async () => {
      comoPedido(A.landing);
      expect(await landing()).toContain(`href="https://${A.app}/"`);
      comoPedido(B.landing);
      expect(await landing()).toContain(`href="https://${B.app}/"`);
    });

    it("propiedad: cualquier secuencia de hosts (con mayúsculas y puerto) pinta cada vez la marca de ese host", async () => {
      const casos = [
        [A.landing, A],
        [B.landing, B],
        [A.landing.toUpperCase(), A],
        [`${B.landing}:443`, B],
        [`${A.landing}.`, A],
      ] as const;
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.constantFrom(...casos), { minLength: 2, maxLength: 12 }),
          async (secuencia) => {
            for (const [host, marca] of secuencia) {
              comoPedido(host);
              const texto = (await landing()) as string;
              expect(texto).toContain(marca.nombre);
              for (const sena of sinDe(marca)) expect(texto).not.toContain(sena);
            }
          },
        ),
        { numRuns: 25 },
      );
    });

    it("el tema es solo `:root{--brand-*:#rrggbb}` dentro de un style con el nonce del pedido", async () => {
      comoPedido(A.landing);
      const texto = (await landing()) as string;
      const estilos = [...texto.matchAll(/<style([^>]*)>([^<]*)<\/style>/g)];
      expect(estilos).toHaveLength(1);
      expect(estilos[0]?.[1]).toBe(` nonce="${NONCE}"`);
      expect(estilos[0]?.[2]).toBe(
        ":root{--brand-primary:#7a1f1f;--brand-on-primary:#ffffff;--brand-secondary:#444444;--brand-accent:#a15c00}",
      );
    });

    it("una marca con el tema a medias hereda el resto de su marca padre: nunca queda un valor inválido", async () => {
      const id = await crearMarca(dueno, { padre: A.id });
      await crearVersionDeMarcaConfirmada(dueno, id, {
        nombreVisible: "Hija Parcial",
        tema: { accent: "#123456" },
      });
      await crearDominio(dueno, id, { host: "app.hijaparcial.test", superficie: "LANDING" });
      comoPedido("app.hijaparcial.test");
      const texto = (await landing()) as string;
      expect(texto).toContain("Hija Parcial");
      expect(texto).toContain("--brand-accent:#123456");
      for (const declaracion of texto.matchAll(/--brand-[a-z-]+:([^;}"]+)/g)) {
        expect(declaracion[1]).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
  });

  // ---- 2. lo que no se sirve ---------------------------------------------------------------------
  describe("lo que no se sirve es la neutra 404, sin cookies y sin marca", () => {
    it.each<[string, () => string]>([
      ["dominio retirado de A", () => A.retirado],
      ["dominio retirado de B", () => B.retirado],
      ["dominio pendiente de verificación de A", () => A.pendiente],
      ["dominio de CONSOLA (otra app)", () => A.consola],
      ["marca activa sin versión confirmada", () => sinVersion],
      ["host desconocido", () => "otro.ejemplo.com"],
      ["el despliegue técnico", () => "pedernal-erp.vercel.app"],
      ["una vista previa", () => "pedernal-erp-git-rama-alepozod.vercel.app"],
      ["una IPv4", () => "10.0.0.1"],
      ["una IPv6", () => "[::1]"],
      ["sufijo engañoso", () => `${A.app}.evil.net`],
      ["vacío", () => ""],
    ])("%s", async (_motivo, host) => {
      for (const ruta of ["/", "/panel?x=1", "/api/auth/signin"]) {
        const r = await (await import("../../apps/web/proxy")).proxy(pedido(host(), ruta));
        expect(reescritura(r), `${host()} ${ruta}`).toBe("/s/neutra");
        expect(r.status).toBe(404);
        expect(r.headers.get("set-cookie")).toBeNull();
        expect(r.headers.get("x-robots-tag")).toBe("noindex");
        // Todo lo que podría verse de una marca en la respuesta: sus cabeceras (menos el eco del host que mandó el cliente).
        const rastro = textoDeCabeceras(r);
        for (const sena of [...A.senas, ...B.senas, "Casa Central"]) {
          expect(rastro, sena).not.toContain(sena);
        }
      }
    });

    it("la página de un host no servible es la neutra (no confía en el proxy)", async () => {
      for (const host of [A.retirado, A.pendiente, A.consola, sinVersion, "otro.ejemplo.com"]) {
        comoPedido(host);
        expect(await landing(), host).toBeNull();
        expect(await layoutDeApp(), host).toBeNull();
      }
      comoPedido(A.landing);
      expect(await layoutDeApp()).toBeNull();
    });

    it("los hosts buenos sí se reescriben a su superficie, con la marca resuelta", async () => {
      const { proxy } = await import("../../apps/web/proxy");
      for (const [host, destino] of [
        [A.app, "/s/app"],
        [A.landing, "/s/landing"],
        [A.carta, "/s/carta"],
        [B.app, "/s/app"],
      ] as const) {
        const r = await proxy(pedido(host));
        expect(reescritura(r), host).toBe(destino);
        expect(r.status).toBe(200);
      }
    });
  });

  // ---- 3. la base caída y el entorno sin configurar ------------------------------------------------
  describe("falla cerrado", () => {
    it("con la base caída (rol inexistente): neutra 503 sin detalle, nunca la marca de otro host", async () => {
      const registro: string[] = [];
      pedidoActual.fuente = fuenteCon(urlDeRolInexistente(), registro);
      vi.resetModules();
      const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const { proxy } = await import("../../apps/web/proxy");
        for (const host of [A.app, A.landing, B.app, "otro.ejemplo.com"]) {
          const r = await proxy(pedido(host, "/"));
          expect(reescritura(r), host).toBe("/s/neutra");
          expect(r.status, host).toBe(503);
          expect(r.headers.get("set-cookie")).toBeNull();
          const todo = textoDeCabeceras(r);
          for (const prohibido of [
            "pedernal_rol_que_no_existe",
            "PEDERNAL_DB_PUBLICO",
            ...A.senas,
            ...B.senas,
          ]) {
            expect(todo).not.toContain(prohibido);
          }
        }
        // Las páginas, con la base caída, tampoco muestran nada.
        comoPedido(A.landing);
        expect(await landing()).toBeNull();
        // Lo que sí se registra no lleva el host ni la cadena.
        const registrado = errores.mock.calls.map((c) => String(c[0])).join("\n");
        expect(registrado).not.toContain("pedernal_rol_que_no_existe");
      } finally {
        errores.mockRestore();
        pedidoActual.fuente = fuenteCon(urlDeLaPublica);
        vi.resetModules();
      }
    });

    it("sin PEDERNAL_DB_PUBLICO: neutra 503; el NOMBRE de la variable solo en el registro", async () => {
      const registro: string[] = [];
      pedidoActual.fuente = fuenteCon(null, registro);
      vi.resetModules();
      const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const { proxy } = await import("../../apps/web/proxy");
        const r = await proxy(pedido(A.app));
        expect(reescritura(r)).toBe("/s/neutra");
        expect(r.status).toBe(503);
        expect([...r.headers.entries()].join("\n")).not.toContain("PEDERNAL");
        expect(registro.join("\n")).toContain("PEDERNAL_DB_PUBLICO");
      } finally {
        errores.mockRestore();
        pedidoActual.fuente = fuenteCon(urlDeLaPublica);
        vi.resetModules();
      }
    });
  });

  // ---- 4. la caché ---------------------------------------------------------------------------------
  describe("la caché (≤ 60 s) con la base real", () => {
    async function resolverCon(fuente: FuenteDePuertas, reloj: { ms: number }) {
      const { armarResolverDePuerta } = await import("../../apps/web/servidor/puerta");
      const llamadas = { consultas: 0, lecturas: 0 };
      const contada: FuenteDePuertas = {
        consultarHost: (h, s) => {
          llamadas.consultas += 1;
          return fuente.consultarHost(h, s);
        },
        leerMarca: (m, h, s) => {
          llamadas.lecturas += 1;
          return fuente.leerMarca(m, h, s);
        },
      };
      return { resolver: armarResolverDePuerta(contada, () => reloj.ms), llamadas };
    }
    const nombreDe = (
      e: Awaited<ReturnType<Awaited<ReturnType<typeof resolverCon>>["resolver"]>>,
    ) => (e.tipo === "RESUELTA" ? e.puerta.marca.nombre : e.tipo);

    it("dos hosts, dos marcas, mismo ciclo: no se mezclan, y repetir no vuelve a consultar", async () => {
      const reloj = { ms: 1_000 };
      const { resolver, llamadas } = await resolverCon(fuenteCon(urlDeLaPublica), reloj);
      expect(nombreDe(await resolver(A.landing))).toBe(A.nombre);
      expect(nombreDe(await resolver(B.landing))).toBe(B.nombre);
      const tras = { ...llamadas };
      for (let i = 0; i < 5; i += 1) {
        reloj.ms += 5_000;
        expect(nombreDe(await resolver(B.landing))).toBe(B.nombre);
        expect(nombreDe(await resolver(A.landing))).toBe(A.nombre);
        expect(nombreDe(await resolver(A.landing.toUpperCase()))).toBe(A.nombre);
      }
      expect(llamadas).toEqual(tras);
      // El desconocido también se guarda (y no es la marca de nadie).
      expect(await resolver(A.retirado)).toEqual({ tipo: "DESCONOCIDO" });
      const despues = { ...llamadas };
      expect(await resolver(A.retirado)).toEqual({ tipo: "DESCONOCIDO" });
      expect(llamadas).toEqual(despues);
    });

    it("un dominio que se retira deja de servirse a lo sumo a los 60 s", async () => {
      const dominio = await crearDominio(dueno, A.id, {
        host: "temporal.hoteldellago.test",
        superficie: "LANDING",
      });
      const reloj = { ms: 1_000 };
      const { resolver } = await resolverCon(fuenteCon(urlDeLaPublica), reloj);
      expect(nombreDe(await resolver(dominio.host))).toBe(A.nombre);
      await dueno.query("update dominio set estado = 'RETIRADO', motivo = 'baja' where id = $1", [
        dominio.id,
      ]);
      reloj.ms += 59_999;
      expect(nombreDe(await resolver(dominio.host))).toBe(A.nombre);
      reloj.ms += 1;
      expect(await resolver(dominio.host)).toEqual({ tipo: "DESCONOCIDO" });
    });

    it("no se guarda un fallo: apenas la base vuelve, el mismo host se resuelve", async () => {
      const reloj = { ms: 1_000 };
      const mala = fuenteCon(urlDeRolInexistente());
      const buena = fuenteCon(urlDeLaPublica);
      const actual = { fuente: mala };
      const { resolver } = await resolverCon(
        {
          consultarHost: (h, s) => actual.fuente.consultarHost(h, s),
          leerMarca: (m, h, s) => actual.fuente.leerMarca(m, h, s),
        },
        reloj,
      );
      const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        expect(await resolver(A.landing)).toEqual({ tipo: "NO_DISPONIBLE" });
        actual.fuente = buena;
        reloj.ms += 1;
        expect(nombreDe(await resolver(A.landing))).toBe(A.nombre);
      } finally {
        errores.mockRestore();
      }
    });
  });

  // ---- 5. concurrencia -----------------------------------------------------------------------------
  describe("concurrencia", () => {
    it("muchas resoluciones simultáneas, de los mismos y de distintos hosts: cada una trae la marca de SU host", async () => {
      const { armarResolverDePuerta } = await import("../../apps/web/servidor/puerta");
      const fuente = fuenteCon(urlDeLaPublica);
      const casos: readonly (readonly [string, string])[] = [
        [A.app, A.nombre],
        [A.landing, A.nombre],
        [A.carta, A.nombre],
        [B.app, B.nombre],
        [B.landing, B.nombre],
        [B.carta, B.nombre],
        [A.retirado, "DESCONOCIDO"],
        [B.pendiente, "DESCONOCIDO"],
        [sinVersion, "DESCONOCIDO"],
        ["otro.ejemplo.com", "DESCONOCIDO"],
      ];
      // Dos rondas: con la caché vacía (todas consultan a la vez) y con la caché llena.
      for (const ronda of [1, 2]) {
        const resolver = armarResolverDePuerta(fuente, () => Date.now());
        const llegada = crearBarrera(60);
        const trabajos = Array.from(
          { length: 60 },
          (_, i) => casos[(i * 7) % casos.length] as (typeof casos)[number],
        );
        const resultados = await Promise.all(
          trabajos.map(async ([host, esperado]) => {
            await llegada();
            const estado = await resolver(host);
            return [
              host,
              esperado,
              estado.tipo === "RESUELTA" ? estado.puerta.marca.nombre : estado.tipo,
            ] as const;
          }),
        );
        for (const [host, esperado, obtenido] of resultados) {
          expect(obtenido, `ronda ${ronda}: ${host}`).toBe(esperado);
        }
        // Y las marcas, enteras: ni una seña de la otra en lo que resolvió cada host.
        for (const [host, marca] of [
          [A.landing, A],
          [B.landing, B],
        ] as const) {
          const estado = await resolver(host);
          const texto = JSON.stringify(estado);
          for (const sena of sinDe(marca)) expect(texto).not.toContain(sena);
        }
      }
    });

    it("los pedidos simultáneos al proxy, con la marca de cada host en su reescritura", async () => {
      pedidoActual.fuente = fuenteCon(urlDeLaPublica);
      vi.resetModules();
      const { proxy } = await import("../../apps/web/proxy");
      const llegada = crearBarrera(40);
      const hosts = [A.app, B.app, A.landing, B.landing, A.retirado, "otro.ejemplo.com"];
      const respuestas = await Promise.all(
        Array.from({ length: 40 }, async (_, i) => {
          const host = hosts[i % hosts.length] as string;
          await llegada();
          return [host, await proxy(pedido(host))] as const;
        }),
      );
      const esperado: Record<string, string> = {
        [A.app]: "/s/app",
        [B.app]: "/s/app",
        [A.landing]: "/s/landing",
        [B.landing]: "/s/landing",
        [A.retirado]: "/s/neutra",
        "otro.ejemplo.com": "/s/neutra",
      };
      for (const [host, r] of respuestas) {
        expect(reescritura(r), host).toBe(esperado[host]);
        expect(r.status).toBe(
          host === A.app || host === B.app || host === A.landing || host === B.landing ? 200 : 404,
        );
      }
    });
  });
});
