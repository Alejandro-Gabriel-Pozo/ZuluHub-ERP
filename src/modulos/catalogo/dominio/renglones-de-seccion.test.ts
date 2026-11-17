import { describe, expect, it } from "vitest";
import {
  renglonesDeSeccion,
  seccionDeLaFamilia,
  validarOrdenPedido,
  type FamiliaParaRenglones,
  type ProductoParaRenglones,
} from "./renglones-de-seccion";

const S1 = "s1";
const S2 = "s2";
const producto = (
  id: string,
  nombre: string,
  seccionId: string | null = S1,
): ProductoParaRenglones => ({ id, nombre, seccionId });
const familia = (
  id: string,
  nombre: string,
  miembros: [string, string | null][],
  extra: Partial<FamiliaParaRenglones> = {},
): FamiliaParaRenglones => ({
  id,
  nombre,
  activa: true,
  agruparEnCarta: true,
  miembros: miembros.map(([productoId, seccionId]) => ({ productoId, seccionId })),
  ...extra,
});

describe("seccionDeLaFamilia", () => {
  it("es de la sección de sus miembros cuando está activa, agrupa en la carta, tiene dos o más y todos coinciden", () => {
    expect(
      seccionDeLaFamilia(
        familia("f", "F", [
          ["a", S1],
          ["b", S1],
        ]),
      ),
    ).toBe(S1);
  });
  it("sin sección, apagada, sin agrupar, con uno solo o con secciones distintas no es renglón", () => {
    expect(
      seccionDeLaFamilia(
        familia("f", "F", [
          ["a", S1],
          ["b", S2],
        ]),
      ),
    ).toBeNull();
    expect(
      seccionDeLaFamilia(
        familia("f", "F", [
          ["a", null],
          ["b", null],
        ]),
      ),
    ).toBeNull();
    expect(seccionDeLaFamilia(familia("f", "F", [["a", S1]]))).toBeNull();
    expect(
      seccionDeLaFamilia(
        familia(
          "f",
          "F",
          [
            ["a", S1],
            ["b", S1],
          ],
          { activa: false },
        ),
      ),
    ).toBeNull();
    expect(
      seccionDeLaFamilia(
        familia(
          "f",
          "F",
          [
            ["a", S1],
            ["b", S1],
          ],
          { agruparEnCarta: false },
        ),
      ),
    ).toBeNull();
    expect(seccionDeLaFamilia(familia("f", "F", []))).toBeNull();
  });
});

describe("renglonesDeSeccion", () => {
  it("una familia agrupada es UN renglón y sus miembros no salen sueltos; el resto, por nombre sin mayúsculas", () => {
    const productos = [
      producto("p1", "Té"),
      producto("c1", "Espresso"),
      producto("c2", "Cortado"),
      producto("p2", "agua"),
      producto("o", "Otro", S2),
    ];
    const r = renglonesDeSeccion(S1, productos, [
      familia("f1", "Café", [
        ["c1", S1],
        ["c2", S1],
      ]),
    ]);
    expect(r.map((x) => `${x.tipo}:${x.nombre}`)).toEqual([
      "PRODUCTO:agua",
      "FAMILIA:Café",
      "PRODUCTO:Té",
    ]);
  });
  it("una familia que no se agrupa deja a sus miembros sueltos, cada uno en su sección", () => {
    const productos = [producto("c1", "Espresso"), producto("c2", "Cortado", S2)];
    const f = familia("f1", "Café", [
      ["c1", S1],
      ["c2", S2],
    ]);
    expect(renglonesDeSeccion(S1, productos, [f]).map((x) => x.id)).toEqual(["c1"]);
    expect(renglonesDeSeccion(S2, productos, [f]).map((x) => x.id)).toEqual(["c2"]);
  });
  it("con el mismo nombre desempata por id; sin nada, vacío", () => {
    const r = renglonesDeSeccion(S1, [producto("b", "X"), producto("a", "X")], []);
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
    expect(renglonesDeSeccion(S1, [], [])).toEqual([]);
  });
});

describe("validarOrdenPedido", () => {
  const actuales = renglonesDeSeccion(S1, [producto("a", "A"), producto("b", "B")], []);
  it("acepta exactamente los renglones, en el orden pedido", () => {
    const r = validarOrdenPedido(actuales, [
      { tipo: "PRODUCTO", id: "b" },
      { tipo: "PRODUCTO", id: "a" },
    ]);
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.valor.map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("rechaza lo repetido, lo que falta, lo que sobra y el tipo equivocado", () => {
    expect(
      validarOrdenPedido(actuales, [
        { tipo: "PRODUCTO", id: "a" },
        { tipo: "PRODUCTO", id: "a" },
      ]),
    ).toEqual({ ok: false, error: "RENGLON_REPETIDO" });
    expect(validarOrdenPedido(actuales, [{ tipo: "PRODUCTO", id: "a" }])).toEqual({
      ok: false,
      error: "LISTA_DE_RENGLONES_INCOMPLETA",
    });
    expect(
      validarOrdenPedido(actuales, [
        { tipo: "PRODUCTO", id: "a" },
        { tipo: "PRODUCTO", id: "z" },
      ]),
    ).toEqual({ ok: false, error: "RENGLON_NO_ENCONTRADO" });
    expect(
      validarOrdenPedido(actuales, [
        { tipo: "FAMILIA", id: "a" },
        { tipo: "PRODUCTO", id: "b" },
      ]),
    ).toEqual({ ok: false, error: "RENGLON_NO_ENCONTRADO" });
    expect(validarOrdenPedido([], [])).toMatchObject({ ok: true });
  });
});
