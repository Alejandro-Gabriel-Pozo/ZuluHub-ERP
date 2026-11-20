import { describe, expect, it } from "vitest";
import { problemasDeIntegracion, type EntradaDeProblemas } from "./problemas";
import type { OperacionContextual, TipoDeContexto } from "./tipos";

const CTX = {
  modulo: "ventas",
  proposito: "p",
  loEntregan: ["a.tsx"],
} as unknown as TipoDeContexto;
const OP = {
  id: "caja.cobrar",
  modulo: "caja",
  contexto: "ventas.cuenta",
  accion: "caja.cobrar",
  perilla: null,
  etiqueta: "t",
  orden: 1,
  seAbreEn: "/caja/cobrar",
  alTerminar: "VUELVE",
} as unknown as OperacionContextual<string>;
const BIEN: EntradaDeProblemas = {
  contextos: { "ventas.cuenta": CTX },
  operaciones: [OP],
  catalogo: {
    ventas: { requiere: ["catalogo"], acciones: { "ventas.ver": 1 } },
    caja: { requiere: ["ventas"], acciones: { "caja.cobrar": 1 } },
    catalogo: { requiere: [], acciones: { "catalogo.ver": 1 } },
  },
  perillas: { salon: { modulo: "caja" }, otra: { modulo: "ventas" } },
  textos: new Set(["t"]),
  rutasDeLaApp: ["/caja/[id]"],
  leerArchivo: (r) => (r === "a.tsx" ? "usa ventas.cuenta" : null),
};
const con = (c: Partial<EntradaDeProblemas>): readonly string[] =>
  problemasDeIntegracion({ ...BIEN, ...c });
const op = (c: Record<string, unknown>) => [{ ...OP, ...c } as OperacionContextual<string>];

describe("problemasDeIntegracion", () => {
  it("registros bien armados y registros vacíos: sin problemas", () => {
    expect(con({})).toEqual([]);
    expect(con({ contextos: {}, operaciones: [] })).toEqual([]);
  });
  const casos: [string, Partial<EntradaDeProblemas>, RegExp][] = [
    ["clave de contexto con otro módulo", { contextos: { "caja.cuenta": CTX } }, /primera parte/],
    ["clave de contexto mal formada", { contextos: { cuenta: CTX } }, /modulo\.cosa/],
    ["archivo que no nombra su contexto", { leerArchivo: () => "nada" }, /no nombra/],
    ["archivo que no existe", { leerArchivo: () => null }, /no existe/],
    ["id repetido", { operaciones: [OP, { ...OP, orden: 2 }] }, /repetido/],
    [
      "contexto inexistente",
      { operaciones: op({ contexto: "ventas.otro" }) },
      /contexto ventas\.otro no existe/,
    ],
    ["módulo inexistente", { operaciones: op({ modulo: "nada" }) }, /módulo nada no existe/],
    ["acción de otro módulo", { operaciones: op({ accion: "ventas.ver" }) }, /no es del módulo/],
    ["perilla de otro módulo", { operaciones: op({ perilla: "otra" }) }, /perilla/],
    ["texto inexistente", { textos: new Set() }, /vocabulario/],
    ["orden repetido", { operaciones: [OP, { ...OP, id: "caja.otra" }] }, /orden 1 está repetido/],
    ["orden que no es entero", { operaciones: op({ orden: 1.5 }) }, /entero/],
    [
      "ruta inexistente",
      { operaciones: op({ seAbreEn: "/caja/x/y" }) },
      /no existe en apps\/web\/app/,
    ],
    ["ruta ajena", { operaciones: op({ seAbreEn: "//evil.com" }) }, /ruta propia/],
    [
      "módulo de abajo operando sobre uno de arriba",
      { operaciones: op({ modulo: "catalogo", accion: "catalogo.ver", id: "catalogo.x" }) },
      /es de abajo/,
    ],
  ];
  for (const [nombre, cambio, esperado] of casos)
    it(`detecta: ${nombre}`, () => {
      expect(con(cambio).join("\n")).toMatch(esperado);
    });
  it("la dependencia indirecta también cuenta", () => {
    const catalogo = {
      ...BIEN.catalogo,
      ventas: { requiere: ["caja2"], acciones: {} },
      caja2: { requiere: ["catalogo"], acciones: { "c.v": 1 } },
    };
    expect(
      con({
        catalogo,
        operaciones: op({ modulo: "catalogo", accion: "catalogo.ver", id: "catalogo.x" }),
      }).join(),
    ).toMatch(/es de abajo/);
  });
});
