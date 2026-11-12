import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import { compararVersiones, costearReceta, type ComponenteParaCosto } from "./costo-de-receta";

const comp = (
  clave: string,
  neto: string,
  costo: string | null,
  over: Partial<ComponenteParaCosto> = {},
): ComponenteParaCosto => ({
  clave,
  noEntraAlCosto: false,
  neto: cantidadDesdeTexto(neto),
  merma: null,
  costoUnitario: costo === null ? null : BigInt(Math.round(Number(costo) * 1_000_000)),
  ...over,
});
const rinde = cantidadDesdeTexto;

describe("costo de una receta (D74, D77, D91, D125)", () => {
  it("suma costo × neto ÷ rinde con un solo redondeo (D3 de la especificación)", () => {
    // harina 6 kg a $1.000 + manteca 2 kg a $9.000 = $24.000 para 9,5 kg: $2.526,315789 por kg
    const r = costearReceta(rinde("9.5"), [
      comp("harina", "6", "1000"),
      comp("manteca", "2", "9000"),
    ]);
    expect(r.costoTotal).toBe(24_000_000_000n);
    expect(r.costoPorUnidad).toBe(2_526_315_789n);
    expect(r.incompleto).toBe(false);
    expect(r.lineas.map((l) => l.costo)).toEqual([6_000_000_000n, 18_000_000_000n]);
  });
  it("la merma se suma al neto: 1 kg a $100 con 20 % cuesta $120", () => {
    const r = costearReceta(rinde("1"), [
      comp("a", "1", "100", { merma: porcentajeDesdeTexto("20") }),
    ]);
    expect(r.costoTotal).toBe(120_000_000n);
    expect(r.costoPorUnidad).toBe(120_000_000n);
  });
  it("sin costo no es cero: queda incompleto y se lista", () => {
    const r = costearReceta(rinde("2"), [comp("a", "1", "10"), comp("b", "1", null)]);
    expect(r.incompleto).toBe(true);
    expect(r.sinCosto).toEqual(["b"]);
    expect(r.lineas[1]?.costo).toBeNull();
    expect(r.costoTotal).toBe(10_000_000n);
    expect(r.costoPorUnidad).toBe(5_000_000n);
  });
  it("los insumos operativos no suman, se muestran aparte y aunque no tengan costo no dejan incompleto", () => {
    const r = costearReceta(rinde("1"), [
      comp("a", "1", "10"),
      comp("bolsa", "1", "5", { noEntraAlCosto: true }),
      comp("detergente", "1", null, { noEntraAlCosto: true }),
    ]);
    expect(r.costoTotal).toBe(10_000_000n);
    expect(r.incompleto).toBe(false);
    expect(r.lineas.find((l) => l.clave === "bolsa")).toEqual({
      clave: "bolsa",
      noEntraAlCosto: true,
      costo: 5_000_000n,
    });
    expect(r.lineas.find((l) => l.clave === "detergente")?.costo).toBeNull();
  });
  it("una receta sin componentes cuesta cero y un rinde que no es positivo es un defecto", () => {
    expect(costearReceta(rinde("1"), [])).toMatchObject({
      costoTotal: 0n,
      costoPorUnidad: 0n,
      incompleto: false,
    });
    expect(() => costearReceta(rinde("0"), [])).toThrow("el rinde es mayor que cero");
  });
});

describe("comparar versiones", () => {
  const base = (clave: string, neto: string, merma: string | null = null) => ({
    clave,
    neto: cantidadDesdeTexto(neto),
    merma: merma === null ? null : porcentajeDesdeTexto(merma),
  });
  it("lista lo agregado, lo quitado y lo cambiado, ordenado", () => {
    const cambios = compararVersiones(
      [base("harina", "6"), base("sal", "0.1"), base("agua", "1", "10")],
      [base("harina", "7"), base("manteca", "2"), base("agua", "1", "20")],
    );
    expect(cambios).toEqual([
      { clave: "agua", tipo: "CAMBIADO" },
      { clave: "harina", tipo: "CAMBIADO" },
      { clave: "manteca", tipo: "AGREGADO" },
      { clave: "sal", tipo: "QUITADO" },
    ]);
  });
  it("dos versiones iguales no cambian, y merma cero es lo mismo que sin merma", () => {
    expect(compararVersiones([base("a", "1")], [base("a", "1", "0")])).toEqual([]);
    expect(compararVersiones([base("a", "1", "0")], [base("a", "1")])).toEqual([]);
    expect(compararVersiones([base("a", "1")], [base("a", "1")])).toEqual([]);
  });
  it("agregar o sacar la merma es un cambio, en los dos sentidos", () => {
    expect(compararVersiones([base("a", "1", "10")], [base("a", "1")])).toEqual([
      { clave: "a", tipo: "CAMBIADO" },
    ]);
    expect(compararVersiones([base("a", "1")], [base("a", "1", "10")])).toEqual([
      { clave: "a", tipo: "CAMBIADO" },
    ]);
  });
  it("ordena por clave, con letras, mayúsculas y claves repetidas en prefijo", () => {
    const cambios = compararVersiones(
      [],
      [base("b", "1"), base("a", "1"), base("ab", "1"), base("B", "1")],
    );
    expect(cambios.map((c) => c.clave)).toEqual(["B", "a", "ab", "b"]);
  });
});
