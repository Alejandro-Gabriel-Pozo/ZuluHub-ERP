import { afterEach, describe, expect, it, vi } from "vitest";
import { armarResolverDePuerta } from "../../apps/web/servidor/puerta";
import {
  crearPuertaFalsa,
  HOST_APP_A,
  HOST_APP_B,
  HOST_VIDRIERA_A,
  HOST_LANDING_A,
} from "../utilidades/puertas-falsas";

/**
 * W4: `apps/web/servidor/puerta.ts`, el resolutor de la web armado sobre el falso de la puerta pública.
 * Cubre lo que la unidad pura no ve: que el host se normaliza con la definición de `modulos/marcas`
 * (IP, sufijos, unicode, mayúsculas, puerto, punto final) y que la caché no mezcla marcas.
 */
vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
});

function armar() {
  const falsa = crearPuertaFalsa();
  const reloj = { ms: 0 };
  const resolver = armarResolverDePuerta(
    { consultarHost: falsa.consultarHost, leerMarca: falsa.leerMarca },
    () => reloj.ms,
  );
  return { falsa, resolver, reloj };
}

describe("armarResolverDePuerta", () => {
  it("resuelve cada host a su superficie y su marca", async () => {
    const { resolver } = armar();
    const a = await resolver(HOST_APP_A);
    expect(a.tipo === "RESUELTA" && [a.puerta.superficie, a.puerta.marca.nombre]).toEqual([
      "APP",
      "Hotel del Lago",
    ]);
    const l = await resolver(HOST_LANDING_A);
    expect(l.tipo === "RESUELTA" && l.puerta.superficie).toBe("LANDING");
    const c = await resolver(HOST_VIDRIERA_A);
    expect(c.tipo === "RESUELTA" && c.puerta.superficie).toBe("CARTA");
    const b = await resolver(HOST_APP_B);
    expect(b.tipo === "RESUELTA" && b.puerta.marca.nombre).toBe("Panadería Los Pinos");
  });

  it.each([
    "APP.HotelDelLago.TEST",
    "app.hoteldellago.test:443",
    "app.hoteldellago.test.",
    "app.hoteldellago.test.:8443",
  ])("%j normaliza al host registrado", async (crudo) => {
    const { resolver } = armar();
    const r = await resolver(crudo);
    expect(r.tipo === "RESUELTA" && r.puerta.host).toBe("app.hoteldellago.test");
  });

  it.each([
    "",
    " ",
    "10.0.0.1",
    "127.1",
    "2130706433",
    "[::1]",
    "app.hoteldellago.test.evil.net",
    "evilapp.hoteldellago.test",
    "app.hoteldellago.test:99999",
    "app.hoteldellago.tesK",
    "háp.hoteldellago.test",
    "xn--hotel-1ra.test",
    "app.hoteldellago.test/",
    "app.hoteldellago.test evil",
    "pedernal-erp.vercel.app",
    "viejo.hoteldellago.test",
    "consola.hoteldellago.test",
  ])("%j es desconocido", async (crudo) => {
    const { resolver } = armar();
    expect(await resolver(crudo)).toEqual({ tipo: "DESCONOCIDO" });
  });

  it("un host inválido no toca la base", async () => {
    const { resolver, falsa } = armar();
    for (const h of ["", "10.0.0.1", "[::1]", "a b", "é.test"]) await resolver(h);
    expect(falsa.consultas).toEqual([]);
  });

  it("un host es de UNA marca y la caché no la cruza", async () => {
    const { resolver, falsa } = armar();
    for (let i = 0; i < 3; i += 1) {
      const a = await resolver(HOST_APP_A);
      const b = await resolver(HOST_APP_B);
      expect(a.tipo === "RESUELTA" && a.puerta.marcaId).toBe(falsa.lecturasDeMarca[0]);
      expect(b.tipo === "RESUELTA" && b.puerta.marca.nombre).toBe("Panadería Los Pinos");
    }
    expect(falsa.lecturasDeMarca).toHaveLength(2);
  });

  it("un dominio retirado deja de servirse en a lo sumo un minuto", async () => {
    const { resolver, falsa, reloj } = armar();
    expect((await resolver("nuevo.hoteldellago.test")).tipo).toBe("DESCONOCIDO");
    falsa.baseCaida.valor = true;
    reloj.ms = 59_000;
    expect((await resolver("nuevo.hoteldellago.test")).tipo).toBe("DESCONOCIDO");
    reloj.ms = 60_000;
    expect((await resolver("nuevo.hoteldellago.test")).tipo).toBe("NO_DISPONIBLE");
  });
});

// La fuente real (sin falso) y su falla cerrado sin variables: `test/web/fuente-real.test.ts` y
// `test/integracion/puerta-real.test.ts`.
describe("la puerta del servidor", () => {
  it("despliegueEsProduccion lee VERCEL_ENV por la composición", async () => {
    const { despliegueEsProduccion } = await import("../../apps/web/servidor/puerta");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(despliegueEsProduccion()).toBe(true);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(despliegueEsProduccion()).toBe(false);
  });
});
