import { describe, expect, it } from "vitest";
import { entradaDeCierreDeOrden } from "./entradas-de-cierre-de-orden";

const ORDEN = "11111111-1111-4111-8111-111111111111";
const CLAVE = "22222222-2222-4222-8222-222222222222";
const BASE = { ordenId: ORDEN, clave: CLAVE, obtenido: "15", consumos: ["12", "4"] };

describe("la entrada de cerrar una orden", () => {
  it("la forma completa pasa; sin vencimiento ni confirmación, ni uno ni otra", () => {
    expect(entradaDeCierreDeOrden(BASE)).toEqual({
      ok: true,
      valor: {
        ordenId: ORDEN,
        clave: CLAVE,
        obtenido: "15",
        vence: null,
        consumos: ["12", "4"],
        confirmar: false,
      },
    });
  });

  it("un consumo en blanco es «no se usó»: cero", () => {
    expect(entradaDeCierreDeOrden({ ...BASE, consumos: ["", "4", ""] })).toMatchObject({
      ok: true,
      valor: { consumos: ["0", "4", "0"] },
    });
  });

  it("el vencimiento es una fecha AAAA-MM-DD; en blanco es ausente", () => {
    expect(entradaDeCierreDeOrden({ ...BASE, vence: "2026-12-31" })).toMatchObject({
      ok: true,
      valor: { vence: "2026-12-31" },
    });
    expect(entradaDeCierreDeOrden({ ...BASE, vence: "" })).toMatchObject({
      ok: true,
      valor: { vence: null },
    });
    for (const vence of ["31/12/2026", "2026-1-1", "2026-12-31 ", "mañana", 20261231]) {
      expect(entradaDeCierreDeOrden({ ...BASE, vence }).ok).toBe(false);
    }
  });

  it("«Producir igual» es solo confirmar = «1»", () => {
    expect(entradaDeCierreDeOrden({ ...BASE, confirmar: "1" })).toMatchObject({
      ok: true,
      valor: { confirmar: true },
    });
    expect(entradaDeCierreDeOrden({ ...BASE, confirmar: "" })).toMatchObject({
      ok: true,
      valor: { confirmar: false },
    });
    for (const confirmar of ["true", "si", "0", 1, true]) {
      expect(entradaDeCierreDeOrden({ ...BASE, confirmar }).ok).toBe(false);
    }
  });

  it("hasta 500 renglones; más, no tiene la forma", () => {
    expect(entradaDeCierreDeOrden({ ...BASE, consumos: Array(500).fill("1") }).ok).toBe(true);
    expect(entradaDeCierreDeOrden({ ...BASE, consumos: Array(501).fill("1") }).ok).toBe(false);
  });

  it("no lee la empresa, la persona, la sucursal, la unidad ni productos del pedido: se descartan", () => {
    const r = entradaDeCierreDeOrden({
      ...BASE,
      empresaId: "otra",
      personaId: "otra",
      sucursalId: "otra",
      unidadId: "GRAMO",
      productoId: "otro",
    });
    expect(r).toEqual({
      ok: true,
      valor: {
        ordenId: ORDEN,
        clave: CLAVE,
        obtenido: "15",
        vence: null,
        consumos: ["12", "4"],
        confirmar: false,
      },
    });
  });

  it.each([
    {},
    null,
    "x",
    { ...BASE, ordenId: "" },
    { ...BASE, ordenId: "no-es-un-id" },
    { ...BASE, clave: "no" },
    { ...BASE, obtenido: 15 },
    { ...BASE, obtenido: "1".repeat(41) },
    { ...BASE, consumos: "12" },
    { ...BASE, consumos: [12] },
    { ...BASE, consumos: ["1".repeat(41)] },
    { ordenId: ORDEN, clave: CLAVE, obtenido: "1" },
  ])("%j no tiene la forma: dato inválido", (crudo) => {
    expect(entradaDeCierreDeOrden(crudo).ok).toBe(false);
  });
});
