import { describe, expect, it } from "vitest";
import {
  entradaDeAsignarSucursalesDeUsuario,
  entradaDeDesactivarUsuario,
  entradaDeFichaDeUsuario,
  entradaDeReactivarUsuario,
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

describe("entradaDeDesactivarUsuario (U3)", () => {
  it("toma SOLO el id de la persona: el rol, el email, la empresa o quien actúa que mande el navegador se descartan", () => {
    expect(
      entradaDeDesactivarUsuario({
        personaId: ID,
        empresaId: "otra",
        rol: "GERENTE",
        email: "x@x.test",
        actor: "otro",
      }),
    ).toEqual({ ok: true, valor: { personaId: ID } });
  });

  it.each([{}, { personaId: "no-es-un-id" }, { personaId: 7 }, null, "texto"])(
    "un pedido sin un id válido (%j) es un dato inválido",
    (crudo) => {
      expect(entradaDeDesactivarUsuario(crudo).ok).toBe(false);
    },
  );
});

describe("entradaDeReactivarUsuario (U3, parte B)", () => {
  const S1 = "0b0b0b0b-1111-4222-8333-444444444451";
  const S2 = "0b0b0b0b-1111-4222-8333-444444444452";

  it("toma la persona y las sucursales tildadas; el email, el rol y lo demás que mande el navegador se descartan", () => {
    expect(
      entradaDeReactivarUsuario({
        personaId: ID,
        sucursales: [S1, S2],
        email: "otro@x.test",
        rol: "ADMINISTRADOR",
        empresaId: "otra",
      }),
    ).toEqual({ ok: true, valor: { personaId: ID, sucursales: [S1, S2] } });
  });

  it("sin sucursales (o ninguna tildada) es el conjunto vacío, y las repetidas se juntan", () => {
    expect(entradaDeReactivarUsuario({ personaId: ID })).toEqual({
      ok: true,
      valor: { personaId: ID, sucursales: [] },
    });
    expect(entradaDeReactivarUsuario({ personaId: ID, sucursales: [S1, S1, S2, S1] })).toEqual({
      ok: true,
      valor: { personaId: ID, sucursales: [S1, S2] },
    });
  });

  it.each([
    ["sin persona", { sucursales: [] }],
    ["persona que no es un identificador", { personaId: "no-es-un-id" }],
    ["una sucursal que no es un identificador", { personaId: ID, sucursales: ["no-es-un-id"] }],
    ["sucursales que no son una lista", { personaId: ID, sucursales: S1 }],
    ["pedido nulo", null],
  ])("%s es un dato inválido", (_caso, crudo) => {
    expect(entradaDeReactivarUsuario(crudo).ok).toBe(false);
  });

  it("tiene un tope de sucursales por pedido (defensivo)", () => {
    const muchas = Array.from(
      { length: 201 },
      (_, n) => `0b0b0b0b-1111-4222-8333-${String(n).padStart(12, "0")}`,
    );
    expect(entradaDeReactivarUsuario({ personaId: ID, sucursales: muchas }).ok).toBe(false);
  });
});
