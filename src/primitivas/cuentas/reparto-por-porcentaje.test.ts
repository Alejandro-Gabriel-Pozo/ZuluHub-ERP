import { describe, expect, it } from "vitest";
import { importeDesdeTexto } from "../dinero/importe";
import { ARS } from "../dinero/moneda";
import { MAXIMO_DE_PARTES_POR_PORCENTAJE } from "./limites-de-division";
import {
  agregarParte,
  escribirPorcentaje,
  importesParaElCobro,
  quitarParte,
  repartoInicial,
  vistaDelReparto,
  type RepartoEnEdicion,
} from "./reparto-por-porcentaje";

const centavos = (importes: readonly string[]): bigint =>
  importes.reduce((suma, i) => suma + importeDesdeTexto(ARS, i).unidades, 0n);

const conPartes = (cuantas: number): RepartoEnEdicion => {
  let reparto = repartoInicial;
  for (let i = 1; i < cuantas; i++) reparto = agregarParte(reparto);
  return reparto;
};

describe("reparto por porcentaje de la hoja de cobro (SAL-E3)", () => {
  it("empieza con una sola parte (el 100 %) y no se puede usar hasta agregar otra", () => {
    const vista = vistaDelReparto("1000.00", repartoInicial);
    expect(vista.partes).toEqual([{ parte: 1, porcentaje: "100.00", importe: null }]);
    expect(vista.utilizable).toBe(false);
    expect(vista.puedeAgregar).toBe(true);
    expect(importesParaElCobro("1000.00", repartoInicial)).toBeNull();
  });

  it("dos partes iguales: 50 % y 50 %, la suma da el total", () => {
    const reparto = agregarParte(repartoInicial);
    expect(reparto.porcentajes).toEqual(["50.00"]);
    expect(importesParaElCobro("1000.00", reparto)).toEqual(["500.00", "500.00"]);
  });

  it("tres partes iguales de $ 100,00: el centavo que sobra va a la parte 1 y la suma es exacta", () => {
    const importes = importesParaElCobro("100.00", conPartes(3));
    expect(importes).toEqual(["33.34", "33.33", "33.33"]);
    expect(centavos(importes as readonly string[])).toBe(10000n);
  });

  it("tres partes iguales con un centavo suelto ($ 100,01): reparte de a un centavo desde la parte 1 y suma exacto", () => {
    const importes = importesParaElCobro("100.01", conPartes(3));
    expect(importes).toEqual(["33.34", "33.34", "33.33"]);
    expect(centavos(importes as readonly string[])).toBe(10001n);
  });

  it("la suma es exacta al centavo con varios totales y cantidades de partes (iguales)", () => {
    for (const total of ["0.99", "1.00", "10.01", "999.99", "1234.57", "100000.01"]) {
      for (let partes = 2; partes < MAXIMO_DE_PARTES_POR_PORCENTAJE; partes++) {
        const importes = importesParaElCobro(total, conPartes(partes));
        // Un total chico no alcanza para que todas las partes cobren algo: ahí la hoja no se puede usar.
        if (importes === null) continue;
        expect(centavos(importes)).toBe(importeDesdeTexto(ARS, total).unidades);
      }
    }
  });

  it("por porcentaje escrito: 33,33 % y 33,33 % dejan el 33,34 % a la parte 1 y la suma es exacta con un centavo suelto", () => {
    let reparto = conPartes(3);
    reparto = escribirPorcentaje(reparto, 0, "33.33");
    reparto = escribirPorcentaje(reparto, 1, "33.33");
    expect(reparto.iguales).toBe(false);
    const vista = vistaDelReparto("100.01", reparto);
    expect(vista.partes[0]?.porcentaje).toBe("33.34");
    const importes = importesParaElCobro("100.01", reparto) as readonly string[];
    expect(importes).toHaveLength(3);
    expect(centavos(importes)).toBe(10001n);
  });

  it("0,01 % y 99,99 % de un total chico: la parte que queda a $ 0 no se puede usar; con un total grande sí y suma exacto", () => {
    const reparto = escribirPorcentaje(agregarParte(repartoInicial), 0, "0.01");
    expect(vistaDelReparto("10.00", reparto).utilizable).toBe(false);
    expect(importesParaElCobro("10.00", reparto)).toBeNull();
    const grande = importesParaElCobro("100000.00", reparto) as readonly string[];
    expect(grande).toEqual(["99990.00", "10.00"]);
  });

  it("un porcentaje que deja la parte 1 en cero, vacío, negativo, con más decimales o pasado de 100 no se puede usar", () => {
    const base = agregarParte(repartoInicial);
    for (const malo of ["100", "100.00", "", "-5", "5.123", "abc", "05", "101", "1e2"]) {
      const reparto = escribirPorcentaje(base, 0, malo);
      expect(vistaDelReparto("100.00", reparto).utilizable).toBe(false);
      expect(importesParaElCobro("100.00", reparto)).toBeNull();
    }
  });

  it("dos partes que suman 100 o más entre sí no se pueden usar (la parte 1 no puede quedar en cero)", () => {
    let reparto = conPartes(3);
    reparto = escribirPorcentaje(reparto, 0, "60");
    reparto = escribirPorcentaje(reparto, 1, "40");
    expect(vistaDelReparto("100.00", reparto).utilizable).toBe(false);
    expect(vistaDelReparto("100.00", reparto).partes[0]?.porcentaje).toBeNull();
  });

  it("agregar parte llega hasta el máximo y ni una más (el número viene de la primitiva de límites)", () => {
    const lleno = conPartes(MAXIMO_DE_PARTES_POR_PORCENTAJE);
    expect(lleno.porcentajes).toHaveLength(MAXIMO_DE_PARTES_POR_PORCENTAJE - 1);
    expect(vistaDelReparto("1000.00", lleno).puedeAgregar).toBe(false);
    expect(agregarParte(lleno)).toBe(lleno);
    const importes = importesParaElCobro("1000.00", lleno) as readonly string[];
    expect(importes).toHaveLength(MAXIMO_DE_PARTES_POR_PORCENTAJE);
    expect(centavos(importes)).toBe(100000n);
  });

  it("agregar parte con porcentajes escritos: la nueva toma lo que le toca sin dejar la parte 1 en cero, y se frena cuando solo queda una centésima", () => {
    let reparto = escribirPorcentaje(agregarParte(repartoInicial), 0, "99.98");
    expect(vistaDelReparto("100.00", reparto).partes[0]?.porcentaje).toBe("0.02");
    expect(vistaDelReparto("100.00", reparto).puedeAgregar).toBe(true);
    reparto = agregarParte(reparto);
    expect(reparto.porcentajes).toEqual(["99.98", "0.01"]);
    expect(vistaDelReparto("100.00", reparto).partes[0]?.porcentaje).toBe("0.01");
    expect(vistaDelReparto("100.00", reparto).puedeAgregar).toBe(false);
    expect(agregarParte(reparto)).toBe(reparto);
  });

  it("quitar una parte: en partes iguales las que quedan vuelven a valer lo mismo; con porcentajes escritos se quita solo esa", () => {
    expect(quitarParte(conPartes(4), 1).porcentajes).toEqual(["33.33", "33.33"]);
    expect(quitarParte(conPartes(2), 0).porcentajes).toEqual([]);
    const escrito = escribirPorcentaje(escribirPorcentaje(conPartes(3), 0, "10"), 1, "20");
    expect(quitarParte(escrito, 0).porcentajes).toEqual(["20"]);
    expect(quitarParte(escrito, 5)).toBe(escrito);
    expect(quitarParte(escrito, -1)).toBe(escrito);
  });

  it("escribir en una parte que no existe no cambia nada", () => {
    const reparto = conPartes(2);
    expect(escribirPorcentaje(reparto, 7, "10")).toBe(reparto);
    expect(escribirPorcentaje(reparto, -1, "10")).toBe(reparto);
  });
});
