import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import { calcularTicket, type LineaACalcular } from "./calcular-ticket";

const linea = (id: string, precio: string, cantidad: string): LineaACalcular => ({
  id,
  precioUnitario: precioUnitarioDesdeTexto(precio),
  cantidad: cantidadDesdeTexto(cantidad),
});
const textos = (lineas: readonly LineaACalcular[]) => {
  const r = calcularTicket(lineas);
  return {
    total: importeATexto(r.total),
    renglones: r.renglones.map((x) => importeATexto(x.importe)),
  };
};

describe("calcularTicket (E4 §3.2, P3 y P25)", () => {
  it("sin líneas el total es 0 y no hay renglones", () => {
    expect(textos([])).toEqual({ total: "0.00", renglones: [] });
  });
  it("una línea: el total es el renglón", () => {
    expect(textos([linea("a", "1500", "2")])).toEqual({ total: "3000.00", renglones: ["3000.00"] });
  });
  it("P3: tres líneas que no se pueden redondear una por una → 26,87 / 26,87 / 26,86 y el total es la suma de los renglones", () => {
    // 3 × 8,955 = 26,865 → el total redondea una vez (26,87 × 3 = 80,61 ≠ 80,60): acá el total exacto es 80,595 → 80,60.
    const r = textos([
      linea("a", "8.955", "1"),
      linea("b", "8.955", "1"),
      linea("c", "8.955", "1"),
    ]);
    expect(r.total).toBe("26.87");
    expect(r.renglones).toEqual(["8.96", "8.96", "8.95"]);
  });
  it("decisión 162: dos líneas de 0,5 × 9,95 valen 9,95 (no 9,96 como si se redondeara cada una)", () => {
    const r = textos([linea("a", "9.95", "0.5"), linea("b", "9.95", "0.5")]);
    expect(r.total).toBe("9.95");
    expect(r.renglones).toEqual(["4.98", "4.97"]);
  });
  it("mitad hacia arriba: 4,975 → 4,98 y 4,974999 → 4,97", () => {
    expect(textos([linea("a", "9.95", "0.5")]).total).toBe("4.98");
    expect(textos([linea("a", "9.949998", "0.5")]).total).toBe("4.97");
  });
  it("cantidad decimal exacta: 0,1 + 0,2 unidades no se pierde nada", () => {
    expect(textos([linea("a", "10", "0.1"), linea("b", "10", "0.2")]).total).toBe("3.00");
  });
  it("una línea a cero no cambia el total; todo a cero da total y renglones en cero", () => {
    expect(textos([linea("a", "0", "1"), linea("b", "100", "1")])).toEqual({
      total: "100.00",
      renglones: ["0.00", "100.00"],
    });
    expect(textos([linea("a", "0", "1"), linea("b", "0", "3")])).toEqual({
      total: "0.00",
      renglones: ["0.00", "0.00"],
    });
  });
  it("conserva los ids y el orden de las líneas", () => {
    expect(
      calcularTicket([linea("x", "1", "1"), linea("y", "2", "1")]).renglones.map((r) => r.id),
    ).toEqual(["x", "y"]);
  });
});
