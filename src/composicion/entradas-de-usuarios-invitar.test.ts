import { describe, expect, it } from "vitest";
import { entradaDeInvitacion, entradaDeInvitar } from "./entradas-de-usuarios";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";
const S1 = "0b0b0b0b-1111-4222-8333-444444444441";
const S2 = "0b0b0b0b-1111-4222-8333-444444444442";

describe("entradaDeInvitar", () => {
  it("toma email, rol y sucursales; todo lo demás (empresa, quién actúa, estado) se descarta", () => {
    const r = entradaDeInvitar({
      email: "julia@x.test",
      rol: "OPERADOR",
      sucursales: [S1, S2],
      empresaId: "otra",
      personaId: "otra",
      estado: "ACEPTADA",
      emitidaPor: "otra",
    });
    expect(r).toEqual({
      ok: true,
      valor: { email: "julia@x.test", rol: "OPERADOR", sucursales: [S1, S2] },
    });
  });

  it("los ids repetidos de sucursal se cuentan una sola vez", () => {
    const r = entradaDeInvitar({ email: "a@x.test", rol: "OPERADOR", sucursales: [S1, S1, S2] });
    expect(r).toEqual({
      ok: true,
      valor: { email: "a@x.test", rol: "OPERADOR", sucursales: [S1, S2] },
    });
  });

  it("el Administrador trabaja en todas las sucursales: las que lleguen se descartan", () => {
    const r = entradaDeInvitar({ email: "a@x.test", rol: "ADMINISTRADOR", sucursales: [S1] });
    expect(r).toEqual({
      ok: true,
      valor: { email: "a@x.test", rol: "ADMINISTRADOR", sucursales: [] },
    });
  });

  it("sin sucursales (el Empleado puede quedar sin ninguna) es válido", () => {
    expect(entradaDeInvitar({ email: "a@x.test", rol: "OPERADOR" })).toEqual({
      ok: true,
      valor: { email: "a@x.test", rol: "OPERADOR", sucursales: [] },
    });
  });

  it.each([
    ["el Gerente no se invita", { email: "a@x.test", rol: "GERENTE", sucursales: [] }],
    ["un rol inexistente", { email: "a@x.test", rol: "DUENO" }],
    ["un rol en minúsculas", { email: "a@x.test", rol: "operador" }],
    ["sin rol", { email: "a@x.test" }],
    ["sin email", { rol: "OPERADOR" }],
    ["email que no es texto", { email: 7, rol: "OPERADOR" }],
    ["email enorme", { email: "a".repeat(1001), rol: "OPERADOR" }],
    [
      "sucursal que no es un identificador",
      { email: "a@x.test", rol: "OPERADOR", sucursales: ["x"] },
    ],
    ["sucursales que no es una lista", { email: "a@x.test", rol: "OPERADOR", sucursales: S1 }],
    [
      "demasiadas sucursales",
      { email: "a@x.test", rol: "OPERADOR", sucursales: Array.from({ length: 201 }, () => S1) },
    ],
    ["pedido que no es un objeto", "texto"],
    ["pedido nulo", null],
  ])("%s es un dato inválido", (_caso, crudo) => {
    expect(entradaDeInvitar(crudo).ok).toBe(false);
  });
});

describe("entradaDeInvitacion", () => {
  it("toma solo el id de la invitación", () => {
    expect(entradaDeInvitacion({ invitacionId: ID, empresaId: "otra", rol: "GERENTE" })).toEqual({
      ok: true,
      valor: { invitacionId: ID },
    });
  });

  it.each([
    ["sin id", {}],
    ["id que no es un identificador", { invitacionId: "no-es-un-id" }],
    ["id con espacios", { invitacionId: ` ${ID} ` }],
    ["id de otro tipo", { invitacionId: 7 }],
    ["pedido nulo", null],
  ])("%s es un dato inválido", (_caso, crudo) => {
    expect(entradaDeInvitacion(crudo).ok).toBe(false);
  });
});
