import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../../apps/web/proxy";
import {
  HOST_APP_A,
  HOST_LANDING_A,
  MARCA_A,
  MARCA_B,
  type PuertaFalsa,
} from "../utilidades/puertas-falsas";

/**
 * W6, el proxy y las rutas de sistema (web-armazon §5.5 y §5.7; P-15):
 *  - `/api/trabajos/cron` y `/api/salud` siguen su camino en CUALQUIER host, sin consultar la base de marcas,
 *    con las garantías de siempre (noindex, sin caché, sin cookies); ninguna otra ruta de `/api/**` fuera de
 *    un host APP se abre.
 *  - Con la base atrasada (la guarda dice que no), todo lo demás responde «En mantenimiento» (503, con
 *    referencia ZH-), en cualquier host y sin consultar la base de marcas; lo de sistema no.
 */
vi.mock("server-only", () => ({}));
const compartido = vi.hoisted(() => ({
  puerta: null as PuertaFalsa | null,
  alDia: { valor: true },
  preguntas: { cantidad: 0 },
}));
vi.mock("../../apps/web/servidor/fuente-de-puertas", async () => {
  const { crearPuertaFalsa } = await import("../utilidades/puertas-falsas");
  const puerta = crearPuertaFalsa();
  compartido.puerta = puerta;
  return { fuenteDePuertas: { consultarHost: puerta.consultarHost, leerMarca: puerta.leerMarca } };
});
vi.mock("../../apps/web/servidor/guarda", () => ({
  baseAlDia: () => {
    compartido.preguntas.cantidad += 1;
    return Promise.resolve(compartido.alDia.valor);
  },
}));

const falsa = (): PuertaFalsa => compartido.puerta as PuertaFalsa;
const pedido = (host: string, ruta: string, encabezados: Record<string, string> = {}) =>
  new NextRequest(`https://puerta.test${ruta}`, {
    headers: host === "" ? encabezados : { host, ...encabezados },
  });
const reescritura = (r: Response): string | null => {
  const destino = r.headers.get("x-middleware-rewrite");
  return destino === null ? null : new URL(destino).pathname;
};

const HOSTS = [
  "zuluhub-erp.vercel.app",
  "zuluhub-erp-git-rama-alepozod.vercel.app",
  "otro.ejemplo.com",
  "10.0.0.1",
  "",
  HOST_APP_A,
  HOST_LANDING_A,
];
const SISTEMA = ["/api/trabajos/cron", "/api/salud"];

beforeEach(() => {
  compartido.alDia.valor = true;
  compartido.preguntas.cantidad = 0;
  falsa().consultas.length = 0;
  falsa().baseCaida.valor = false;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rutas de sistema en el proxy", () => {
  it.each(SISTEMA)(
    "%s sigue su camino en cualquier host, noindex, sin caché ni cookies",
    async (ruta) => {
      for (const produccion of [true, false]) {
        vi.stubEnv("VERCEL_ENV", produccion ? "production" : "preview");
        for (const host of HOSTS) {
          const r = await proxy(pedido(host, ruta));
          expect(r.headers.get("x-middleware-next"), `${host} ${ruta}`).toBe("1");
          expect(reescritura(r)).toBeNull();
          expect(r.status).toBe(200);
          expect(r.headers.get("x-robots-tag")).toBe("noindex");
          expect(r.headers.get("cache-control")).toBe("private, no-store");
          expect(r.headers.get("strict-transport-security")).toContain("max-age=");
          expect(r.headers.get("set-cookie")).toBeNull();
          expect(r.cookies.getAll()).toEqual([]);
        }
      }
    },
  );

  it("no consulta la base de marcas ni la guarda: funciona aunque las dos estén caídas", async () => {
    falsa().baseCaida.valor = true;
    compartido.alDia.valor = false;
    for (const ruta of SISTEMA) {
      const r = await proxy(pedido("zuluhub-erp.vercel.app", ruta));
      expect(r.headers.get("x-middleware-next")).toBe("1");
      expect(r.status).toBe(200);
    }
    expect(falsa().consultas).toEqual([]);
    expect(compartido.preguntas.cantidad).toBe(0);
  });

  it("los encabezados x-zh-* del cliente no pasan, y el de autorización sí (lo necesita el cron)", async () => {
    const r = await proxy(
      pedido("zuluhub-erp.vercel.app", "/api/trabajos/cron", {
        authorization: "Bearer x",
        "x-zh-nonce": "inventado",
        "x-zh-marca": "otra",
        "x-forwarded-host": "app.hoteldellago.test",
      }),
    );
    const siguen = (r.headers.get("x-middleware-override-headers") ?? "").split(",");
    expect(siguen).toContain("authorization");
    expect(r.headers.get("x-middleware-request-authorization")).toBe("Bearer x");
    expect(r.headers.get("x-middleware-request-x-zh-nonce")).not.toBe("inventado");
    expect(r.headers.get("x-middleware-request-x-zh-marca")).toBeNull();
    // El host sigue siendo el técnico: lo reenviado no cambia nada.
    expect(r.headers.get("x-middleware-next")).toBe("1");
  });

  it("la lista es cerrada: lo parecido, en un host que no es APP, es la neutra", async () => {
    const PARECIDAS = [
      "/api/trabajos",
      "/api/trabajos/cron/",
      "/api/trabajos/cron/x",
      "/api/trabajos/cronx",
      "/api/salud/",
      "/api/salud/x",
      "/api/saludx",
      "/api/%73alud",
      "/api//salud",
      "/api/auth/signin",
      "/api",
    ];
    for (const host of ["zuluhub-erp.vercel.app", "otro.ejemplo.com", HOST_LANDING_A]) {
      for (const ruta of PARECIDAS) {
        const r = await proxy(pedido(host, ruta));
        // Next conserva la barra final del pedido en la reescritura.
        expect(reescritura(r), `${host} ${ruta}`).toMatch(/^\/s\/neutra\/?$/);
        expect(r.status).toBe(404);
        expect(r.headers.get("x-robots-tag")).toBe("noindex");
      }
    }
  });
});

describe("P-15: la guarda de migración en el proxy", () => {
  const REFERENCIA = /<strong>(ZH-[0-9A-F]{4}-[0-9A-F]{4})<\/strong>/;

  it.each(HOSTS)("base atrasada, host %j: «En mantenimiento» 503 con referencia", async (host) => {
    compartido.alDia.valor = false;
    const registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const ruta of ["/", "/panel", "/api/auth/signin", "/s/app", "/favicon.ico"]) {
      const r = await proxy(pedido(host, ruta));
      expect(r.status, `${host} ${ruta}`).toBe(503);
      expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(r.headers.get("retry-after")).toBe("60");
      expect(r.headers.get("x-robots-tag")).toBe("noindex");
      expect(r.headers.get("cache-control")).toBe("private, no-store");
      expect(r.headers.get("set-cookie")).toBeNull();
      expect(r.headers.get("x-middleware-rewrite")).toBeNull();
      const cuerpo = await r.text();
      expect(cuerpo).toContain("En mantenimiento");
      const referencia = REFERENCIA.exec(cuerpo)?.[1];
      expect(referencia).toBeDefined();
      // La referencia de la pantalla está en el registro del servidor.
      expect(registro.mock.calls.map((c) => String(c[0]))).toContain(
        `${referencia} [mantenimiento] pedido atendido sin la migración requerida`,
      );
    }
    registro.mockRestore();
  });

  it("no muestra nada de ninguna marca ni consulta la base de marcas", async () => {
    compartido.alDia.valor = false;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await proxy(pedido(HOST_APP_A, "/"));
    const todo = `${await r.text()}\n${[...r.headers.entries()].map(([n, v]) => `${n}: ${v}`).join("\n")}`;
    for (const sena of [...MARCA_A.senas, ...MARCA_B.senas]) expect(todo).not.toContain(sena);
    expect(falsa().consultas).toEqual([]);
  });

  it("cada pedido lleva su propia referencia", async () => {
    compartido.alDia.valor = false;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const referencias = new Set<string>();
    for (let i = 0; i < 6; i += 1) {
      const cuerpo = await (await proxy(pedido(HOST_APP_A, "/"))).text();
      referencias.add(REFERENCIA.exec(cuerpo)?.[1] ?? "");
    }
    expect(referencias.size).toBeGreaterThan(1);
  });

  it("con la base al día, todo sigue como antes (la guarda se pregunta una vez por pedido)", async () => {
    const r = await proxy(pedido(HOST_APP_A, "/panel"));
    expect(reescritura(r)).toBe("/s/app/panel");
    expect(r.status).toBe(200);
    expect(compartido.preguntas.cantidad).toBe(1);
  });

  it("apenas se migra, la app vuelve sola (la guarda deja de decir que no)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    compartido.alDia.valor = false;
    expect((await proxy(pedido(HOST_APP_A, "/"))).status).toBe(503);
    compartido.alDia.valor = true;
    const r = await proxy(pedido(HOST_APP_A, "/"));
    expect(reescritura(r)).toBe("/s/app");
  });
});
