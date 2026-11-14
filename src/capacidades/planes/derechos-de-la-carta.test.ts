import { describe, expect, it } from "vitest";
import { elPlanDejaServirLaCarta } from "./derechos-de-la-carta";
import type { ValorEfectivo } from "./valores";

/**
 * T6 de la carta real: el plan deja servir la carta solo con el módulo ACTIVO (activado por la empresa Y dentro del techo de su plan, y `disponible`) y la perilla
 * encendida. Cada condición se prueba sola, para que cambiar un `y` por un `o` o quitar una falle.
 */
type Modulo = "catalogo" | "vidriera" | "nucleo";
type Perilla = "vidriera_por_qr" | "otra";

const CATALOGO = {
  nucleo: { estado: "disponible", obligatorio: true },
  catalogo: { estado: "disponible", obligatorio: false },
  vidriera: { estado: "disponible", obligatorio: false },
} as const;

const encendida = (valor: boolean): ValorEfectivo => ({
  tipo: "INTERRUPTOR",
  encendida: valor,
  origen: "PLAN",
});

const caso = (
  cambios: Partial<{
    catalogo: Record<Modulo, { estado: "disponible" | "en_desarrollo"; obligatorio: boolean }>;
    habilitados: readonly Modulo[];
    activados: readonly string[];
    perilla: ValorEfectivo;
  }> = {},
) =>
  elPlanDejaServirLaCarta<Modulo, Perilla>({
    catalogoDeModulos: cambios.catalogo ?? CATALOGO,
    modulo: "vidriera",
    perilla: "vidriera_por_qr",
    derechos: {
      modulosHabilitados: new Set(cambios.habilitados ?? ["nucleo", "catalogo", "vidriera"]),
      perillas: new Map<Perilla, ValorEfectivo>([
        ["vidriera_por_qr", cambios.perilla ?? encendida(true)],
        ["otra", encendida(true)],
      ]),
    },
    modulosActivados: cambios.activados ?? ["vidriera"],
  });

describe("elPlanDejaServirLaCarta", () => {
  it("con el módulo activado dentro del plan y la perilla encendida, la carta se sirve", () => {
    expect(caso()).toBe(true);
  });

  it("si el plan ya no incluye el módulo (baja de plan), no se sirve aunque la empresa lo haya activado", () => {
    expect(caso({ habilitados: ["nucleo", "catalogo"] })).toBe(false);
  });

  it("si la empresa no activó el módulo, no se sirve aunque el plan lo incluya", () => {
    expect(caso({ activados: [] })).toBe(false);
    expect(caso({ activados: ["catalogo"] })).toBe(false);
  });

  it("con la perilla apagada no se sirve, aunque el módulo esté activo", () => {
    expect(caso({ perilla: encendida(false) })).toBe(false);
  });

  it("la perilla de la carta es la que se mira: otra encendida no la suple", () => {
    expect(
      elPlanDejaServirLaCarta<Modulo, Perilla>({
        catalogoDeModulos: CATALOGO,
        modulo: "vidriera",
        perilla: "vidriera_por_qr",
        derechos: {
          modulosHabilitados: new Set<Modulo>(["vidriera"]),
          perillas: new Map<Perilla, ValorEfectivo>([
            ["vidriera_por_qr", encendida(false)],
            ["otra", encendida(true)],
          ]),
        },
        modulosActivados: ["vidriera"],
      }),
    ).toBe(false);
  });

  it("un módulo en desarrollo nunca se sirve (todo nace cerrado), aunque todo lo demás esté encendido", () => {
    expect(
      caso({
        catalogo: { ...CATALOGO, vidriera: { estado: "en_desarrollo", obligatorio: false } },
      }),
    ).toBe(false);
  });

  it("un límite de perilla en 0 no deja servir, uno mayor que 0 sí", () => {
    const limite = (n: number): ValorEfectivo => ({ tipo: "LIMITE", limite: n, origen: "AJUSTE" });
    expect(caso({ perilla: limite(0) })).toBe(false);
    expect(caso({ perilla: limite(1) })).toBe(true);
  });

  it("una clave de módulo que el catálogo no conoce en lo activado no habilita nada", () => {
    expect(caso({ activados: ["vidriera_inventada", "constructor"] })).toBe(false);
  });
});
