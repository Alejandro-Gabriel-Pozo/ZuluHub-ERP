import { describe, expect, it } from "vitest";
import { entradaDeFichaDeUsuario } from "./entradas-de-usuarios";

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
