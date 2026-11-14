import { describe, expect, it } from "vitest";
import { accionesDeCaso } from "./declaracion";

describe("accionesDeCaso: lo que el guard exige es lo que la declaración dice", () => {
  it("sin `tambien`, solo la acción propia", () => {
    expect(accionesDeCaso({ accion: "mesas.crear" })).toEqual(["mesas.crear"]);
  });

  it("con `tambien`, la propia primero y las demás en su orden, sin sumar ni sacar ninguna", () => {
    expect(
      accionesDeCaso({
        accion: "mesas.ver",
        tambien: ["cuentas.anular_linea", "cuentas.agregar_linea"],
      }),
    ).toEqual(["mesas.ver", "cuentas.anular_linea", "cuentas.agregar_linea"]);
  });

  it("`tambien` vacío es lo mismo que no tenerlo", () => {
    expect(accionesDeCaso({ accion: "mesas.ver", tambien: [] })).toEqual(["mesas.ver"]);
  });
});
