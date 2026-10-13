import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "../../apps/web/proxy";

/**
 * W0: la puerta mínima de `apps/web/proxy.ts`, probada sobre la API real de Next (sin levantar el
 * servidor). La lógica pura tiene sus propias pruebas en `src/capacidades/experiencia`; acá se
 * verifica que `proxy.ts` la use de verdad: P-2/P-3/P-5 en su versión de este tramo.
 */

const pedido = (url: string, encabezados: Record<string, string> = {}) =>
  new NextRequest(url, { headers: encabezados });

/** Los encabezados del pedido que siguen su camino, según el protocolo de Next para el proxy. */
function encabezadosDePedidoQueSiguen(respuesta: Response): Record<string, string> {
  const siguen = (respuesta.headers.get("x-middleware-override-headers") ?? "").split(",");
  return Object.fromEntries(
    siguen
      .filter((nombre) => nombre !== "")
      .map((nombre) => [nombre, respuesta.headers.get(`x-middleware-request-${nombre}`) ?? ""]),
  );
}

describe("apps/web/proxy.ts (W0: todo a la neutra)", () => {
  it.each([
    "https://ejemplo.com/",
    "https://app.hotel-del-lago.com.ar/panel?x=1",
    "https://zuluhub-erp.vercel.app/api/auth/callback/google",
    "http://10.0.0.1/favicon.ico",
    "https://ejemplo.com/s/app/inicio",
  ])("%s se reescribe a la neutra con 404 y noindex", (url) => {
    const respuesta = proxy(pedido(url));
    expect(respuesta.headers.get("x-middleware-rewrite")).toBe(`${new URL(url).origin}/s/neutra`);
    expect(respuesta.status).toBe(404);
    expect(respuesta.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("no setea cookies", () => {
    const respuesta = proxy(pedido("https://ejemplo.com/", { cookie: "a=1" }));
    expect(respuesta.headers.get("set-cookie")).toBeNull();
    expect(respuesta.cookies.getAll()).toEqual([]);
  });

  it("borra todo x-zh-* que mande el cliente y conserva el resto", () => {
    const respuesta = proxy(
      pedido("https://ejemplo.com/", {
        host: "ejemplo.com",
        "x-zh-marca": "otra",
        "X-ZH-Superficie": "app",
        "x-zh-host": "otra.com",
        accept: "text/html",
      }),
    );
    const siguen = encabezadosDePedidoQueSiguen(respuesta);
    expect(Object.keys(siguen).filter((n) => n.startsWith("x-zh-"))).toEqual([]);
    expect(siguen["accept"]).toBe("text/html");
  });

  it("X-Forwarded-Host de otra marca no cambia el destino", () => {
    const a = proxy(pedido("https://ejemplo.com/", { "x-forwarded-host": "otra.com" }));
    const b = proxy(pedido("https://ejemplo.com/"));
    expect(a.headers.get("x-middleware-rewrite")).toBe(b.headers.get("x-middleware-rewrite"));
  });

  it("el matcher deja afuera solo los estáticos de la compilación", () => {
    expect(config.matcher).toEqual(["/((?!_next/static|_next/image).*)"]);
    const regex = new RegExp(`^${config.matcher[0]}$`);
    expect(regex.test("/favicon.ico")).toBe(true);
    expect(regex.test("/robots.txt")).toBe(true);
    expect(regex.test("/api/auth/signin")).toBe(true);
    expect(regex.test("/_next/static/chunks/a.js")).toBe(false);
  });
});
