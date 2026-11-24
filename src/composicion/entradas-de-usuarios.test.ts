import { describe, expect, it } from "vitest";
import {
  entradaDeAsignarSucursalesDeUsuario,
  entradaDeFichaDeUsuario,
} from "./entradas-de-usuarios";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";

describe("entradaDeFichaDeUsuario", () => {
  it("toma solo el id de la persona; la empresa y lo demás que mande el navegador se descartan", () => {
    const r = entradaDeFichaDeUsuario({ personaId: ID, empresaId: "otra", rol: "GERENTE" });
    expect(r).toEqual({ ok: true, valor: { personaId: ID } });
  });

  it.each([
    ["sin id", {}],
    ["id que no es un identificador", { personaId: "no-es-un-id" }],
    ["id vacío", { personaId: "" }],
    ["id con espacios", { personaId: ` ${ID} ` }],
    ["id de otro tipo", { personaId: 7 }],
    ["pedido que no es un objeto", "texto"],
    ["pedido nulo", null],
  ])("%s es un dato inválido", (_caso, crudo) => {
    expect(entradaDeFichaDeUsuario(crudo).ok).toBe(false);
  });
});

describe("entradaDeAsignarSucursalesDeUsuario", () => {
  const S1 = "0b0b0b0b-1111-4222-8333-444444444451";
  const S2 = "0b0b0b0b-1111-4222-8333-444444444452";

  it("toma la persona y los ids tildados; la empresa, el rol y lo demás que mande el navegador se descartan", () => {
    const r = entradaDeAsignarSucursalesDeUsuario({
      personaId: ID,
      sucursales: [S1, S2],
      empresaId: "otra",
      rol: "GERENTE",
    });
    expect(r).toEqual({ ok: true, valor: { personaId: ID, sucursales: [S1, S2] } });
  });

  it("el conjunto vacío es válido (el empleado queda sin sucursales)", () => {
    expect(entradaDeAsignarSucursalesDeUsuario({ personaId: ID, sucursales: [] })).toEqual({
      ok: true,
      valor: { personaId: ID, sucursales: [] },
    });
  });

  it.each([
    ["sin sucursales (no es «ninguna»: falta el campo)", { personaId: ID }],
    ["sucursales que no es una lista", { personaId: ID, sucursales: S1 }],
    ["una sucursal que no es un identificador", { personaId: ID, sucursales: [S1, "no-es-un-id"] }],
    ["una sucursal de otro tipo", { personaId: ID, sucursales: [7] }],
    ["sin persona", { sucursales: [S1] }],
    ["persona que no es un identificador", { personaId: "no-es-un-id", sucursales: [] }],
    ["pedido que no es un objeto", "texto"],
    ["pedido nulo", null],
  ])("%s es un dato inválido", (_caso, crudo) => {
    expect(entradaDeAsignarSucursalesDeUsuario(crudo).ok).toBe(false);
  });
});
