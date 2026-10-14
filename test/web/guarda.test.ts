import { describe, expect, it, vi } from "vitest";

/**
 * La guarda de migración FALLA CERRADO también en su costura con la web: si armar la guarda o preguntarle lanza
 * (entorno sin armar, conexión caída, el rol `zuluhub_app` sin permiso de lectura sobre `migracion` porque la
 * migración que se lo da todavía no se aplicó), la respuesta es «no al día» (→ «En mantenimiento», 503) y nunca
 * «sí». La parte de la lógica y la base real están en `guarda-de-migracion.test.ts` y `rutas-de-sistema.test.ts`.
 */
vi.mock("server-only", () => ({}));
const comportamiento = vi.hoisted(() => ({
  guardaDeMigracion: (): (() => Promise<boolean>) => () => Promise.resolve(true),
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  sistema: { guardaDeMigracion: () => comportamiento.guardaDeMigracion() },
}));

describe("baseAlDia (costura de la guarda con el proxy)", () => {
  it("con la guarda que dice que sí, es sí", async () => {
    const { baseAlDia } = await import("../../apps/web/servidor/guarda");
    comportamiento.guardaDeMigracion = () => () => Promise.resolve(true);
    expect(await baseAlDia()).toBe(true);
  });

  it("con la guarda que dice que no, es no", async () => {
    const { baseAlDia } = await import("../../apps/web/servidor/guarda");
    comportamiento.guardaDeMigracion = () => () => Promise.resolve(false);
    expect(await baseAlDia()).toBe(false);
  });

  it("si armar la guarda lanza (el entorno no está bien), es no: no se propaga el error", async () => {
    const { baseAlDia } = await import("../../apps/web/servidor/guarda");
    comportamiento.guardaDeMigracion = () => {
      throw new Error("falta una variable de entorno");
    };
    expect(await baseAlDia()).toBe(false);
  });

  it("si preguntarle a la guarda rechaza (sin permiso de lectura, conexión caída), es no", async () => {
    const { baseAlDia } = await import("../../apps/web/servidor/guarda");
    comportamiento.guardaDeMigracion = () => () =>
      Promise.reject(
        Object.assign(new Error("permission denied for table migracion"), { code: "42501" }),
      );
    expect(await baseAlDia()).toBe(false);
  });
});
