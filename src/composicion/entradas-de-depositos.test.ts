import { describe, expect, it } from "vitest";
import { entradaDeAltaDeDeposito } from "./entradas-de-depositos";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";

describe("entradaDeAltaDeDeposito", () => {
  it("toma solo el identificador, el nombre, el uso y «de venta»; sin «de venta» es que no", () => {
    expect(entradaDeAltaDeDeposito({ id: ID, nombre: "Cocina", uso: "CUARENTENA" })).toEqual({
      ok: true,
      valor: { id: ID, nombre: "Cocina", uso: "CUARENTENA", deVenta: false },
    });
    expect(
      entradaDeAltaDeDeposito({ id: ID, nombre: "Salón", uso: "NORMAL", deVenta: true }),
    ).toEqual({ ok: true, valor: { id: ID, nombre: "Salón", uso: "NORMAL", deVenta: true } });
  });

  it("lo que el esquema no declara no pasa (ni la empresa, ni la sucursal, ni el estado)", () => {
    const r = entradaDeAltaDeDeposito({
      id: ID,
      nombre: "Cocina",
      uso: "NORMAL",
      sucursalId: ID,
      empresaId: ID,
      activo: false,
    });
    expect(r).toEqual({
      ok: true,
      valor: { id: ID, nombre: "Cocina", uso: "NORMAL", deVenta: false },
    });
  });

  it.each([
    ["sin identificador", { nombre: "a", uso: "NORMAL" }],
    ["identificador que no es un UUID", { id: "x", nombre: "a", uso: "NORMAL" }],
    ["sin nombre", { id: ID, uso: "NORMAL" }],
    ["nombre que no es texto", { id: ID, nombre: 3, uso: "NORMAL" }],
    ["nombre de más de 1000 caracteres", { id: ID, nombre: "a".repeat(1001), uso: "NORMAL" }],
    ["sin uso", { id: ID, nombre: "a" }],
    ["un uso que no existe", { id: ID, nombre: "a", uso: "VENTA" }],
    ["el uso en minúsculas", { id: ID, nombre: "a", uso: "normal" }],
    ["«de venta» que no es un sí o no", { id: ID, nombre: "a", uso: "NORMAL", deVenta: "true" }],
    ["un pedido que no es un objeto", "hola"],
    ["nada", undefined],
  ])("%s es una entrada inválida", (_caso, crudo) => {
    expect(entradaDeAltaDeDeposito(crudo).ok).toBe(false);
  });
});
