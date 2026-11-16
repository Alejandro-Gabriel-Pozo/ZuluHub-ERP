import { describe, expect, it } from "vitest";
import {
  MAXIMO_DE_MEDIDAS_POR_PEDIDO,
  revisarLosCambiosDePrecios,
} from "./pedido-de-precios-por-medida";

const cambio = (n: number) => ({ precioId: `p${String(n)}`, opcionId: `o${String(n)}` });
const varios = (n: number) => Array.from({ length: n }, (_, i) => cambio(i));

describe("revisarLosCambiosDePrecios", () => {
  it("un pedido sin cambios o con medidas e ids distintos está bien", () => {
    expect(revisarLosCambiosDePrecios([])).toBeNull();
    expect(revisarLosCambiosDePrecios(varios(2))).toBeNull();
  });

  it("el tope es inclusivo: justo el máximo pasa, uno más no", () => {
    expect(revisarLosCambiosDePrecios(varios(MAXIMO_DE_MEDIDAS_POR_PEDIDO))).toBeNull();
    expect(revisarLosCambiosDePrecios(varios(MAXIMO_DE_MEDIDAS_POR_PEDIDO + 1))).toBe(
      "OPCION_INVALIDA",
    );
  });

  it("una medida repetida es OPCION_INVALIDA, aunque los precioId sean distintos", () => {
    expect(revisarLosCambiosDePrecios([cambio(1), { precioId: "otro", opcionId: "o1" }])).toBe(
      "OPCION_INVALIDA",
    );
  });

  it("un precioId repetido en medidas distintas es ID_REUTILIZADO", () => {
    expect(revisarLosCambiosDePrecios([cambio(1), { precioId: "p1", opcionId: "o2" }])).toBe(
      "ID_REUTILIZADO",
    );
  });

  it("con las dos repeticiones, la medida repetida se dice primero", () => {
    expect(revisarLosCambiosDePrecios([cambio(1), cambio(1)])).toBe("OPCION_INVALIDA");
  });

  it("el tope se dice antes que las repeticiones", () => {
    const repetidos = Array.from({ length: MAXIMO_DE_MEDIDAS_POR_PEDIDO + 1 }, () => cambio(1));
    expect(revisarLosCambiosDePrecios(repetidos)).toBe("OPCION_INVALIDA");
  });
});
