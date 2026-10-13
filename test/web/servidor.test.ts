import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * W1: `apps/web/servidor/composicion.ts` usa `server-only` de forma legítima y, al cargarse, no lee
 * ninguna variable (P-12). `server-only` lanza fuera de un servidor de React, así que acá se
 * reemplaza por un módulo vacío. Que sea la primera línea de cada archivo lo exige la prueba de convenciones de apps en
 * `test/arquitectura/reglas.test.ts`.
 */
vi.mock("server-only", () => ({}));

describe("apps/web/servidor/composicion.ts", () => {
  const original = process.env;
  afterEach(() => {
    process.env = original;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("cargarlo no lee ninguna variable del producto", async () => {
    const leidas: string[] = [];
    process.env = new Proxy(
      { ...original },
      {
        get(destino, clave, receptor) {
          if (
            typeof clave === "string" &&
            /^(ZULUHUB_|DATABASE_|POSTGRES_|BETTER_AUTH_)/.test(clave)
          ) {
            leidas.push(clave);
          }
          return Reflect.get(destino, clave, receptor) as unknown;
        },
      },
    );
    vi.resetModules();
    const { web } = await import("../../apps/web/servidor/composicion");
    expect(Object.keys(web).sort()).toEqual([
      "casosDeUsoDeEmpresas",
      "casosDeUsoDeIdentidad",
      "consultasDeEmpresas",
      "consultasDeIdentidad",
    ]);
    expect(leidas).toEqual([]);
  });

  it("con el entorno vacío, el pedido falla cerrado: el nombre va al registro y no al error", async () => {
    const entornoVacio = Object.fromEntries(
      Object.entries(original).filter(
        ([nombre]) => !/^(ZULUHUB_|DATABASE_|POSTGRES_|BETTER_AUTH_)/.test(nombre),
      ),
    );
    process.env = entornoVacio;
    const registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.resetModules();
    const { web } = await import("../../apps/web/servidor/composicion");
    let error: unknown;
    try {
      web.casosDeUsoDeIdentidad();
    } catch (e) {
      error = e;
    }
    expect((error as Error).name).toBe("ErrorDeEntorno");
    expect((error as Error).message).not.toContain("ZULUHUB");
    expect(registro).toHaveBeenCalledTimes(1);
    expect(String(registro.mock.calls[0]?.[0])).toContain("ZULUHUB_DB_APP");
  });
});
