import { describe, expect, it } from "vitest";
import { huellaDelDetalle, ordenarDetalle, referenciasDelDetalle } from "./detalle-del-control";

const f = (numero: number | null, id: string, datos?: string) =>
  datos === undefined ? { numero, id } : { numero, id, datos };

describe("detalle del control del cierre (§3.15)", () => {
  it("ordena por número de ticket y luego por id; los que no son de ticket, al final y por id", () => {
    const orden = ordenarDetalle([
      f(10, "b"),
      f(null, "z"),
      f(2, "b"),
      f(2, "a"),
      f(null, "a"),
      f(10, "a"),
    ]);
    expect(orden.map((x) => `${x.numero}:${x.id}`)).toEqual([
      "2:a",
      "2:b",
      "10:a",
      "10:b",
      "null:a",
      "null:z",
    ]);
  });
  it("el orden numérico no es el de texto (9 antes que 10)", () => {
    expect(ordenarDetalle([f(10, "a"), f(9, "a")]).map((x) => x.numero)).toEqual([9, 10]);
  });
  it("un ticket de número 0 va antes que una fila sin ticket", () => {
    expect(ordenarDetalle([f(null, "a"), f(0, "z")]).map((x) => x.id)).toEqual(["z", "a"]);
  });
  it("también con el número más grande que cabe en la base (`integer`): sigue antes que lo que no es de un ticket", () => {
    expect(ordenarDetalle([f(null, "a"), f(2_147_483_647, "z")]).map((x) => x.id)).toEqual([
      "z",
      "a",
    ]);
  });
  it("conserva dos filas idénticas", () => {
    expect(ordenarDetalle([f(1, "a", "x"), f(1, "a", "y")])).toHaveLength(2);
  });
  it("la huella no depende del orden en que llegan las filas y es un sha256 en hexadecimal", () => {
    const a = huellaDelDetalle([f(1, "a"), f(2, "b")]);
    expect(huellaDelDetalle([f(2, "b"), f(1, "a")])).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("cualquier cambio del detalle cambia la huella: un id, un número, un dato o una fila de más", () => {
    const base = huellaDelDetalle([f(1, "a", "x")]);
    expect(huellaDelDetalle([f(1, "b", "x")])).not.toBe(base);
    expect(huellaDelDetalle([f(2, "a", "x")])).not.toBe(base);
    expect(huellaDelDetalle([f(1, "a", "y")])).not.toBe(base);
    expect(huellaDelDetalle([f(1, "a", "x"), f(2, "b")])).not.toBe(base);
    expect(huellaDelDetalle([f(1, "a")])).not.toBe(huellaDelDetalle([f(1, "a", "x")]));
    // Sin dato y con dato vacío es lo mismo.
    expect(huellaDelDetalle([f(1, "a")])).toBe(huellaDelDetalle([f(1, "a", "")]));
    expect(huellaDelDetalle([])).not.toBe(base);
  });
  it("las referencias salen en orden, con el tipo, y se cortan en el máximo", () => {
    expect(referenciasDelDetalle("ventas.ticket", [f(2, "b"), f(1, "a")], 50)).toEqual([
      "ventas.ticket:a",
      "ventas.ticket:b",
    ]);
    expect(
      referenciasDelDetalle("ventas.cuenta", [f(null, "c"), f(null, "a"), f(null, "b")], 2),
    ).toEqual(["ventas.cuenta:a", "ventas.cuenta:b"]);
    expect(referenciasDelDetalle("ventas.cuenta", [], 5)).toEqual([]);
  });
});
