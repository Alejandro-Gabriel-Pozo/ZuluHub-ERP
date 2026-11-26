import { describe, expect, it } from "vitest";
import {
  BORRADOR_INICIAL,
  conLaCuentaCompartida,
  conLaCuentaDelPaso,
  conLaCuentaEntera,
  conLaForma,
  conUnaCuentaMas,
  evaluarLaDivision,
  lineasParaDividir,
  puedeAgregarCuenta,
  type Borrador,
} from "../../apps/web/ui/plantillas/salon/modelo-de-dividir";
import { conNumero } from "../../apps/web/ui/plantillas/salon/textos-de-dividir";
import { MAXIMO_DE_CUENTAS_POR_ITEMS } from "../../src/primitivas/cuentas/limites-de-division";

/** «Dividir la cuenta» (SAL-E2, S11): el borrador se evalúa con la regla del servidor y dice qué falta; los totales son los de la prueba del dueño (3 gaseosas y un plato entre 3). */
const ficha = (cantidad: string, precio: string, importe: string, id: string, paso = "1") => ({
  lineaId: id,
  descripcion: id === "g" ? "Gaseosa" : "Plato",
  varianteNombre: null,
  cantidad,
  precioUnitario: precio,
  pasoDeCantidad: paso,
  importe,
});
const lineas = lineasParaDividir([
  ficha("3", "1000", "3000.00", "g"),
  ficha("1", "3001", "3001.00", "p"),
]);
const [gaseosas, plato] = lineas as [(typeof lineas)[0], (typeof lineas)[0]];
const con3: Borrador = { ...BORRADOR_INICIAL, cuentas: 3 };

describe("modelo de «Dividir la cuenta»", () => {
  it("sin repartir nada, cada línea dice «Falta asignar» y no se puede confirmar", () => {
    const e = evaluarLaDivision(BORRADOR_INICIAL, lineas);
    expect([...e.sinAsignar]).toEqual(["g", "p"]);
    expect(e).toMatchObject({ lista: false, totales: null, vacias: [], asignaciones: [] });
  });

  it("3 gaseosas una a cada cuenta y el plato compartido entre las 3: $ 2.000,34, $ 2.000,33 y $ 2.000,33 (suman $ 6.001,00)", () => {
    let b = conLaForma(con3, gaseosas, "POR_UNIDADES");
    for (const [paso, parte] of [1, 2, 3].entries())
      b = conLaCuentaDelPaso(b, gaseosas, paso, parte);
    for (const parte of [1, 2, 3]) b = conLaCuentaCompartida(b, plato, parte);
    const e = evaluarLaDivision(b, lineas);
    expect(e.lista).toBe(true);
    expect(e.totales).toEqual(["$ 2.000,34", "$ 2.000,33", "$ 2.000,33"]);
    expect(e.asignaciones).toEqual([
      { lineaId: "g", forma: "POR_UNIDADES", cantidades: ["1.0000", "1.0000", "1.0000"] },
      { lineaId: "p", forma: "COMPARTIDO", partes: [1, 2, 3] },
    ]);
  });

  it("una cuenta sin nada es «Cuenta vacía» (solo con todo repartido) y no deja confirmar", () => {
    let b = conLaCuentaEntera(BORRADOR_INICIAL, gaseosas, 1);
    expect(evaluarLaDivision(b, lineas).vacias).toEqual([]);
    b = conLaCuentaEntera(b, plato, 1);
    const e = evaluarLaDivision(b, lineas);
    expect(e).toMatchObject({ vacias: [2], lista: false, totales: null });
  });

  it("las unidades a medio repartir dejan la línea sin asignar; compartir con una sola cuenta tampoco alcanza", () => {
    let b = conLaForma(BORRADOR_INICIAL, gaseosas, "POR_UNIDADES");
    b = conLaCuentaDelPaso(b, gaseosas, 0, 1);
    b = conLaCuentaCompartida(b, plato, 2);
    expect([...evaluarLaDivision(b, lineas).sinAsignar]).toEqual(["g", "p"]);
  });

  it("cambiar la forma de una línea descarta lo elegido y una cuenta compartida se saca al tocarla de nuevo", () => {
    let b = conLaCuentaEntera(BORRADOR_INICIAL, plato, 2);
    b = conLaForma(b, plato, "COMPARTIDO");
    expect(b.repartos["p"]).toMatchObject({ forma: "COMPARTIDO", parte: 0, partes: [] });
    b = conLaCuentaCompartida(conLaCuentaCompartida(b, plato, 1), plato, 1);
    expect(b.repartos["p"]?.partes).toEqual([]);
  });

  it("una línea de una sola unidad no se reparte «Por unidades»; hay un máximo de cuentas", () => {
    expect(plato.pasos).toBeNull();
    expect(gaseosas.pasos).toBe(3);
    let b = BORRADOR_INICIAL;
    while (puedeAgregarCuenta(b)) b = conUnaCuentaMas(b);
    expect(b.cuentas).toBe(MAXIMO_DE_CUENTAS_POR_ITEMS);
    expect(conUnaCuentaMas(b)).toBe(b);
  });

  it("la plantilla «Cuenta N» toma el número", () => {
    expect(conNumero("Cuenta N", 3)).toBe("Cuenta 3");
    expect(conNumero("Cuenta", 3)).toBe("Cuenta 3");
  });
});
