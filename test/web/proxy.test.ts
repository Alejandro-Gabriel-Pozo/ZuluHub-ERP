import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "../../apps/web/proxy";
import {
  HOST_APP_A,
  HOST_APP_B,
  HOST_CARTA_A,
  HOST_LANDING_A,
  HOST_LANDING_B,
  MARCA_A,
  MARCA_B,
  type PuertaFalsa,
} from "../utilidades/puertas-falsas";

/**
 * W4: la puerta por host de `apps/web/proxy.ts`, probada sobre la API real de Next (sin levantar el
 * servidor) y contra el falso de la puerta pública con dos marcas (`test/utilidades/puertas-falsas.ts`).
 * La lógica pura tiene sus propias pruebas en `src/capacidades/experiencia`; acá se verifica que
 * `proxy.ts` la use de verdad: P-2 (host desconocido), P-3 (noindex), P-4 (cabeceras) y P-5 (encabezados
 * que no se falsifican). El e2e contra `next start` con `Host` variable es del tramo W5.
 */
vi.mock("server-only", () => ({}));
const compartido = vi.hoisted(() => ({ puerta: null as PuertaFalsa | null }));
vi.mock("../../apps/web/servidor/fuente-de-puertas", async () => {
  const { crearPuertaFalsa } = await import("../utilidades/puertas-falsas");
  const puerta = crearPuertaFalsa();
  compartido.puerta = puerta;
  return { fuenteDePuertas: { consultarHost: puerta.consultarHost, leerMarca: puerta.leerMarca } };
});

// La guarda de migración (W6) tiene sus propias pruebas (`sistema.test.ts`): acá la base está al día.
vi.mock("../../apps/web/servidor/guarda", () => ({ baseAlDia: () => Promise.resolve(true) }));

const falsa = (): PuertaFalsa => compartido.puerta as PuertaFalsa;

const pedido = (host: string, ruta = "/", encabezados: Record<string, string> = {}) =>
  new NextRequest(`https://puerta.test${ruta}`, {
    headers: host === "" ? encabezados : { host, ...encabezados },
  });

/** Los encabezados del pedido que siguen su camino, según el protocolo de Next para el proxy. */
function encabezadosDePedidoQueSiguen(respuesta: Response): Record<string, string> {
  const siguen = (respuesta.headers.get("x-middleware-override-headers") ?? "").split(",");
  return Object.fromEntries(
    siguen
      .filter((nombre) => nombre !== "")
      .map((nombre) => [nombre, respuesta.headers.get(`x-middleware-request-${nombre}`) ?? ""]),
  );
}

const reescritura = (respuesta: Response): string | null => {
  const destino = respuesta.headers.get("x-middleware-rewrite");
  return destino === null ? null : new URL(destino).pathname;
};

/** Todo lo que de una marca podría verse en una respuesta de la puerta: sus cabeceras. */
const textoDeCabeceras = (respuesta: Response): string =>
  [...respuesta.headers.entries()]
    // El eco del `host` que mandó el propio cliente no es un dato de la marca.
    .filter(([nombre]) => nombre !== "x-middleware-request-host")
    .map(([n, v]) => `${n}: ${v}`)
    .join("\n");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("P-2: host desconocido, retirado o inválido = la neutra", () => {
  const HOSTILES: readonly (readonly [string, string])[] = [
    ["no registrado", "otro.ejemplo.com"],
    ["retirado de A", "viejo.hoteldellago.test"],
    ["retirado de B", "vieja.panaderialospinos.test"],
    ["superficie que esta app no sirve (consola)", "consola.hoteldellago.test"],
    ["el despliegue técnico", "pedernal-erp.vercel.app"],
    ["una vista previa", "pedernal-erp-git-rama-alepozod.vercel.app"],
    ["una IPv4", "10.0.0.1"],
    ["una IPv4 con puerto", "127.0.0.1:3000"],
    ["una IPv4 corta", "127.1"],
    ["una IPv4 decimal", "2130706433"],
    ["una IPv6", "[::1]"],
    ["una IPv6 con puerto", "[::1]:3000"],
    ["sufijo engañoso", "app.hoteldellago.test.evil.net"],
    ["prefijo engañoso", "evilapp.hoteldellago.test"],
    ["sin el subdominio", "x.app.hoteldellago.test"],
    ["otro TLD", "app.hoteldellago.com"],
    ["sin www (no se quita)", "www.hoteldellago.test"],
    ["con arroba", "app.hoteldellago.test@evil.net"],
    ["con barra", "app.hoteldellago.test/evil"],
    ["con espacio", "app.hoteldellago.test evil"],
    ["con puerto fuera de rango", "app.hoteldellago.test:99999"],
    ["unicode (acento)", "háp.hoteldellago.test"],
    ["punycode no registrado", "xn--hotel-1ra.test"],
    ["una etiqueta de 64", `${"a".repeat(64)}.test`],
    ["un host larguísimo", `${"a.".repeat(200)}test`],
    ["vacío", ""],
    ["solo un punto", "."],
    ["solo un puerto", ":8080"],
  ];

  it.each(HOSTILES)("%s (%j): 404 neutra, noindex, sin cookies", async (_motivo, host) => {
    for (const ruta of ["/", "/panel?x=1", "/api/auth/signin", "/favicon.ico"]) {
      const respuesta = await proxy(pedido(host, ruta));
      expect(reescritura(respuesta), `${host} ${ruta}`).toBe("/s/neutra");
      expect(respuesta.status).toBe(404);
      expect(respuesta.headers.get("x-robots-tag")).toBe("noindex");
      expect(respuesta.headers.get("set-cookie")).toBeNull();
      expect(respuesta.cookies.getAll()).toEqual([]);
      // La neutra no guarda ni la consulta del pedido.
      expect(new URL(respuesta.headers.get("x-middleware-rewrite") as string).search).toBe("");
    }
  });

  it("la neutra no trae ningún dato de ninguna marca, ni siquiera en las cabeceras", async () => {
    const respuesta = await proxy(pedido("viejo.hoteldellago.test"));
    const cabeceras = textoDeCabeceras(respuesta);
    for (const sena of [...MARCA_A.senas, ...MARCA_B.senas]) expect(cabeceras).not.toContain(sena);
  });

  it("host desconocido nunca cae en una marca: ni con producción", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const respuesta = await proxy(pedido("otro.ejemplo.com"));
    expect(reescritura(respuesta)).toBe("/s/neutra");
    expect(respuesta.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("todo host desconocido responde igual que cualquier otro (sin oráculo)", async () => {
    const referencia = await proxy(pedido("a.nada.test", "/x"));
    for (const host of ["viejo.hoteldellago.test", "consola.hoteldellago.test", "10.0.0.1", ""]) {
      const r = await proxy(pedido(host, "/x"));
      expect(r.status).toBe(referencia.status);
      expect(reescritura(r)).toBe(reescritura(referencia));
      const sinNonce = (x: Response) =>
        textoDeCabeceras(x)
          .replace(/nonce-[A-Za-z0-9+/=]+/g, "nonce-N")
          .replace(/^x-middleware-(request|override)-.*$/gm, "");
      expect(sinNonce(r)).toBe(sinNonce(referencia));
    }
  });

  it("la base caída da 503 neutra (no un 404 que parezca «no existe»), y no se guarda", async () => {
    falsa().baseCaida.valor = true;
    try {
      const respuesta = await proxy(pedido("nuevo.hoteldellago.test"));
      expect(reescritura(respuesta)).toBe("/s/neutra");
      expect(respuesta.status).toBe(503);
      expect(respuesta.headers.get("x-robots-tag")).toBe("noindex");
    } finally {
      falsa().baseCaida.valor = false;
    }
    const despues = await proxy(pedido(HOST_APP_A));
    expect(reescritura(despues)).toBe("/s/app");
  });

  it("/api/** en un host que no es APP también es la neutra; en APP sigue su camino", async () => {
    for (const host of [HOST_LANDING_A, HOST_CARTA_A, HOST_LANDING_B]) {
      for (const ruta of ["/api/auth/signin", "/api/auth/callback/google", "/api/otra", "/api"]) {
        const r = await proxy(pedido(host, ruta));
        expect(reescritura(r), `${host} ${ruta}`).toBe("/s/neutra");
        expect(r.status).toBe(404);
      }
    }
    for (const host of [HOST_APP_A, HOST_APP_B]) {
      const r = await proxy(pedido(host, "/api/auth/signin"));
      expect(r.headers.get("x-middleware-next")).toBe("1");
      expect(reescritura(r)).toBeNull();
      expect(r.status).toBe(200);
    }
  });

  it("nadie entra por una URL interna, ni en un host bueno", async () => {
    for (const host of [HOST_APP_A, HOST_LANDING_A, HOST_CARTA_A]) {
      for (const ruta of ["/s/app", "/s/landing", "/s/carta", "/s/neutra", "/S/app", "/%73/app"]) {
        const r = await proxy(pedido(host, ruta));
        expect(reescritura(r), `${host} ${ruta}`).toBe("/s/neutra");
        expect(r.status).toBe(404);
      }
    }
  });

  it("el nombre de la superficie no filtra la existencia de un host", async () => {
    const a = await proxy(pedido(HOST_APP_A, "/s/app"));
    const b = await proxy(pedido("no-existe.test", "/s/app"));
    expect(reescritura(a)).toBe(reescritura(b));
    expect(a.status).toBe(b.status);
  });
});

describe("la reescritura por superficie", () => {
  it.each([
    [HOST_APP_A, "/", "/s/app"],
    [HOST_APP_A, "/panel/ventas", "/s/app/panel/ventas"],
    [HOST_APP_B, "/invitacion", "/s/app/invitacion"],
    [HOST_LANDING_A, "/", "/s/landing"],
    [HOST_LANDING_B, "/precios", "/s/landing/precios"],
    [HOST_CARTA_A, "/", "/s/carta"],
    [HOST_CARTA_A, "/mesa/3", "/s/carta/mesa/3"],
  ])("%s %s → %s, sin estado propio", async (host, ruta, destino) => {
    const r = await proxy(pedido(host, ruta));
    expect(reescritura(r)).toBe(destino);
    expect(r.status).toBe(200);
  });

  it("conserva la consulta de un host servido (la invitación viaja en ella)", async () => {
    const r = await proxy(pedido(HOST_APP_A, "/invitacion?t=abc"));
    expect(new URL(r.headers.get("x-middleware-rewrite") as string).search).toBe("?t=abc");
  });

  it("el host se normaliza: mayúsculas, puerto y punto final", async () => {
    for (const host of [
      "APP.HotelDelLago.TEST",
      "app.hoteldellago.test:8443",
      "app.hoteldellago.test.",
    ]) {
      const r = await proxy(pedido(host));
      expect(reescritura(r), host).toBe("/s/app");
    }
  });

  it("cada host sirve SOLO su superficie: el host de la landing no sirve la app", async () => {
    // El falso solo conoce `hoteldellago.test` como LANDING: sus rutas de app no existen ahí.
    const r = await proxy(pedido(HOST_LANDING_A, "/panel"));
    expect(reescritura(r)).toBe("/s/landing/panel");
  });
});

describe("P-3: noindex en lo privado", () => {
  it("toda respuesta de APP y de la neutra lleva X-Robots-Tag: noindex, también en producción", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    for (const [host, ruta] of [
      [HOST_APP_A, "/"],
      [HOST_APP_A, "/panel"],
      [HOST_APP_A, "/api/auth/signin"],
      [HOST_APP_A, "/s/app"],
      [HOST_APP_B, "/invitacion?t=1"],
      ["otro.test", "/"],
      [HOST_CARTA_A, "/"],
    ] as const) {
      const r = await proxy(pedido(host, ruta));
      expect(r.headers.get("x-robots-tag"), `${host} ${ruta}`).toBe("noindex");
    }
  });

  it("la landing en producción se puede indexar", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const r = await proxy(pedido(HOST_LANDING_A));
    expect(r.headers.get("x-robots-tag")).toBeNull();
  });

  it.each(["preview", "development", "", "Production"])(
    "la landing con VERCEL_ENV=%j no se indexa",
    async (valor) => {
      vi.stubEnv("VERCEL_ENV", valor);
      const r = await proxy(pedido(HOST_LANDING_A));
      expect(r.headers.get("x-robots-tag")).toBe("noindex");
    },
  );

  it("sin VERCEL_ENV tampoco (falla cerrado)", async () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    const r = await proxy(pedido(HOST_LANDING_A));
    expect(r.headers.get("x-robots-tag")).toBe("noindex");
  });
});

describe("P-4: cabeceras de seguridad", () => {
  const SUPERFICIES: readonly (readonly [string, string])[] = [
    [HOST_APP_A, "/"],
    [HOST_LANDING_A, "/"],
    [HOST_CARTA_A, "/"],
    ["otro.test", "/"],
    [HOST_APP_A, "/api/auth/signin"],
  ];

  it.each(SUPERFICIES)("%s %s trae todas las cabeceras", async (host, ruta) => {
    const r = await proxy(pedido(host, ruta));
    const csp = r.headers.get("content-security-policy") as string;
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1] as string;
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22,}={0,2}$/);
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(r.headers.get("strict-transport-security")).toContain("max-age=");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("same-origin");
    const permisos = r.headers.get("permissions-policy") as string;
    for (const p of ["camera=()", "microphone=()", "geolocation=()"]) expect(permisos).toContain(p);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-powered-by")).toBeNull();
    // El mismo nonce llega a la página: por la CSP del pedido (Next marca sus scripts) y por el interno.
    const siguen = encabezadosDePedidoQueSiguen(r);
    expect(siguen["x-pd-nonce"]).toBe(nonce);
    expect(siguen["content-security-policy"]).toBe(csp);
  });

  it("el nonce es nuevo en cada pedido", async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const r = await proxy(pedido(HOST_APP_A));
      nonces.add(
        /'nonce-([^']+)'/.exec(r.headers.get("content-security-policy") as string)?.[1] as string,
      );
    }
    expect(nonces.size).toBe(50);
  });

  it("no setea cookies en ninguna superficie", async () => {
    for (const [host, ruta] of SUPERFICIES) {
      const r = await proxy(pedido(host, ruta, { cookie: "a=1" }));
      expect(r.headers.get("set-cookie")).toBeNull();
      expect(r.cookies.getAll()).toEqual([]);
    }
  });
});

describe("P-5: encabezados que no se falsifican", () => {
  it("borra todo x-pd-* que mande el cliente y conserva el resto", async () => {
    const r = await proxy(
      pedido(HOST_APP_A, "/", {
        "x-pd-marca": "otra",
        "X-PD-Superficie": "app",
        "x-pd-host": "otra.com",
        "x-pd-nonce": "inventado",
        accept: "text/html",
      }),
    );
    const siguen = encabezadosDePedidoQueSiguen(r);
    expect(Object.keys(siguen).filter((n) => n.startsWith("x-pd-"))).toEqual(["x-pd-nonce"]);
    expect(siguen["x-pd-nonce"]).not.toBe("inventado");
    expect(siguen["accept"]).toBe("text/html");
  });

  it("también en el camino de las APIs y de la neutra", async () => {
    for (const [host, ruta] of [
      [HOST_APP_A, "/api/auth/signin"],
      ["otro.test", "/"],
    ] as const) {
      const r = await proxy(pedido(host, ruta, { "x-pd-marca": "otra", "x-pd-nonce": "x" }));
      const siguen = encabezadosDePedidoQueSiguen(r);
      expect(siguen["x-pd-marca"]).toBeUndefined();
      expect(siguen["x-pd-nonce"]).not.toBe("x");
    }
  });

  it.each([
    [HOST_APP_A, HOST_APP_B],
    [HOST_APP_A, "otro.test"],
    [HOST_LANDING_A, HOST_APP_B],
    ["otro.test", HOST_APP_A],
  ])("el host %s con X-Forwarded-Host %s se resuelve por el host", async (host, falso) => {
    const con = await proxy(
      pedido(host, "/panel", {
        "x-forwarded-host": falso,
        forwarded: `host=${falso}`,
        "x-original-host": falso,
        "x-pd-host": falso,
      }),
    );
    const sin = await proxy(pedido(host, "/panel"));
    expect(reescritura(con)).toBe(reescritura(sin));
    expect(con.status).toBe(sin.status);
    expect(con.headers.get("x-robots-tag")).toBe(sin.headers.get("x-robots-tag"));
  });

  it("sin host, un X-Forwarded-Host bueno no abre nada", async () => {
    const r = await proxy(pedido("", "/", { "x-forwarded-host": HOST_APP_A }));
    expect(reescritura(r)).toBe("/s/neutra");
  });
});

describe("el matcher", () => {
  it("deja afuera solo los estáticos de la compilación", () => {
    expect(config.matcher).toEqual(["/((?!_next/static|_next/image).*)"]);
    const regex = new RegExp(`^${config.matcher[0]}$`);
    expect(regex.test("/favicon.ico")).toBe(true);
    expect(regex.test("/robots.txt")).toBe(true);
    expect(regex.test("/api/auth/signin")).toBe(true);
    expect(regex.test("/s/app")).toBe(true);
    expect(regex.test("/_next/static/chunks/a.js")).toBe(false);
  });
});
