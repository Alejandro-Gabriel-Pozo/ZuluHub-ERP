import { describe, expect, it } from "vitest";
import { entradaDeFichaDeCompra, entradaDeListarCompras } from "./entradas-de-compras";

const UUID = "0b0b0b0b-1111-4222-8333-444444444444";
const valor = (crudo: unknown) => {
  const r = entradaDeListarCompras(crudo);
  if (!r.ok) throw new Error("se esperaba una entrada válida");
  return r.valor;
};

describe("entradaDeListarCompras", () => {
  it("sin dirección: todas, sin fechas, primera página", () => {
    expect(valor({})).toEqual({ estado: "TODAS", desde: null, hasta: null, despuesDe: null });
    expect(valor(undefined)).toEqual({
      estado: "TODAS",
      desde: null,
      hasta: null,
      despuesDe: null,
    });
  });

  it("toma el estado de la lista cerrada y las fechas civiles válidas", () => {
    expect(
      valor({
        estado: "SIN_FACTURAR",
        desde: "2026-11-01",
        hasta: "2026-11-30",
        despues: "2026-11-20|57",
      }),
    ).toEqual({
      estado: "SIN_FACTURAR",
      desde: "2026-11-01",
      hasta: "2026-11-30",
      despuesDe: "2026-11-20|57",
    });
  });

  it("un estado fuera de la lista cae a «Todas» (también uno que existe en el servidor)", () => {
    expect(valor({ estado: "ANULADA" }).estado).toBe("TODAS");
    expect(valor({ estado: "sin_facturar" }).estado).toBe("TODAS");
    expect(valor({ estado: ["SIN_FACTURAR"] }).estado).toBe("TODAS");
    expect(valor({ estado: "__proto__" }).estado).toBe("TODAS");
  });

  it("una fecha inválida cae a «sin límite»", () => {
    expect(valor({ desde: "2026-02-30", hasta: "mañana" })).toMatchObject({
      desde: null,
      hasta: null,
    });
    expect(valor({ desde: "", hasta: ["2026-11-01"] })).toMatchObject({ desde: null, hasta: null });
  });

  it("una clave que no declara no llega: ni la empresa, ni la sucursal, ni el proveedor", () => {
    const entrada = valor({
      empresaId: UUID,
      sucursalId: UUID,
      proveedorId: UUID,
      estado: "SIN_FACTURAR",
    });
    expect(Object.keys(entrada).sort()).toEqual(["desde", "despuesDe", "estado", "hasta"]);
  });

  it("un cursor mal formado rechaza el pedido; uno vacío es la primera página", () => {
    for (const malo of [
      "x",
      "2026-11-20|",
      "2026-11-20|0",
      "2026-11-20|5|6",
      `2026-11-20|${UUID}`,
      "|5",
    ]) {
      expect(entradaDeListarCompras({ despues: malo }).ok).toBe(false);
    }
    expect(entradaDeListarCompras({ despues: ["2026-11-20|5"] }).ok).toBe(true);
    expect(valor({ despues: ["2026-11-20|5"] }).despuesDe).toBeNull();
    expect(valor({ despues: "" }).despuesDe).toBeNull();
  });
});

describe("entradaDeFichaDeCompra", () => {
  it("acepta solo un UUID y no deja pasar otras claves", () => {
    expect(entradaDeFichaDeCompra({ recepcionId: UUID })).toEqual({
      ok: true,
      valor: { recepcionId: UUID },
    });
    expect(entradaDeFichaDeCompra({ recepcionId: "no-es-uuid" }).ok).toBe(false);
    expect(entradaDeFichaDeCompra({ recepcionId: UUID, empresaId: UUID }).ok).toBe(false);
    expect(entradaDeFichaDeCompra({}).ok).toBe(false);
  });
});
