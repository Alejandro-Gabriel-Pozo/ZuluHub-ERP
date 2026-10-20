import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * W4b: el módulo REAL `apps/web/servidor/fuente-de-puertas.ts` (sin el falso de las demás pruebas de la web)
 * con el entorno sin configurar. Cargarlo no lee ninguna variable; usarlo sin `PEDERNAL_DB_PUBLICO` falla
 * cerrado: la puerta responde `NO_DISPONIBLE` (la neutra 503), no «desconocido» ni la marca de nadie, y el
 * NOMBRE de la variable queda solo en el registro del servidor. Con la base real se prueba en
 * `test/integracion/puerta-real.test.ts`.
 */
vi.mock("server-only", () => ({}));

const original = process.env;
afterEach(() => {
  process.env = original;
  vi.restoreAllMocks();
  vi.resetModules();
});

const sinVariablesDelProducto = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(original).filter(
      ([nombre]) => !/^(PEDERNAL_|DATABASE_|POSTGRES_|BETTER_AUTH_|AUTH_|GOOGLE_)/.test(nombre),
    ),
  ) as NodeJS.ProcessEnv;

describe("fuenteDePuertas real, sin PEDERNAL_DB_PUBLICO", () => {
  it("cada consulta falla (no devuelve ok(null) ni una marca) y el nombre solo va al registro", async () => {
    process.env = sinVariablesDelProducto();
    const registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.resetModules();
    const { fuenteDePuertas } = await import("../../apps/web/servidor/fuente-de-puertas");
    const error = await fuenteDePuertas
      .consultarHost("app.hoteldellago.test", "APP")
      .catch((e: unknown) => e);
    expect((error as Error).name).toBe("ErrorDeEntorno");
    expect((error as Error).message).not.toContain("PEDERNAL");
    await expect(fuenteDePuertas.leerMarca("m", "app.hoteldellago.test", "APP")).rejects.toThrow();
    expect(registro.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "PEDERNAL_DB_PUBLICO",
    );
  });

  it("la puerta lo resuelve como NO_DISPONIBLE para cualquier host válido, y como desconocido el que no normaliza (sin tocar nada)", async () => {
    process.env = sinVariablesDelProducto();
    const registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.resetModules();
    const { resolverPuerta } = await import("../../apps/web/servidor/puerta");
    for (const host of ["app.hoteldellago.test", "pedernal-erp.vercel.app", "otro.ejemplo.com"]) {
      expect(await resolverPuerta(host), host).toEqual({ tipo: "NO_DISPONIBLE" });
    }
    expect(await resolverPuerta("10.0.0.1")).toEqual({ tipo: "DESCONOCIDO" });
    expect(await resolverPuerta("")).toEqual({ tipo: "DESCONOCIDO" });
    const texto = registro.mock.calls.map((c) => String(c[0])).join("\n");
    expect(texto).toContain("[puerta] no se pudo resolver el host (EXCEPCION)");
    expect(texto).not.toContain("hoteldellago");
  });
});
