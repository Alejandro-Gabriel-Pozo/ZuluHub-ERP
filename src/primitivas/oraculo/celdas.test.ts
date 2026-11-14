import { describe, expect, it } from "vitest";
import {
  celdaPor,
  celdasEjecutables,
  celdasPendientes,
  codigosDeLasCeldas,
  defectosDeForma,
  etiquetaDePendiente,
  huellaDeLasCeldas,
  transicionesPermitidas,
  transicionesProhibidas,
  type CeldaDeOraculo,
} from "./celdas";

type Estado = "A" | "B" | "C";
const celda = (
  id: string,
  cambios: Partial<CeldaDeOraculo<string, Estado>> = {},
): CeldaDeOraculo<string, Estado> => ({
  id,
  accion: "hacer",
  partida: "siempre",
  permitido: true,
  errores: [],
  resultado: "pasa",
  regla: "R-1",
  decision: "dueño",
  quien: "codigo",
  hoy: "COINCIDE",
  pendiente: null,
  ...cambios,
});

describe("etiquetaDePendiente", () => {
  it("dice «PENDIENTE (tramo X)» con el tramo, y nada si no está pendiente", () => {
    expect(etiquetaDePendiente({ pendiente: "T0" })).toBe("PENDIENTE (tramo T0)");
    expect(etiquetaDePendiente({ pendiente: null })).toBeNull();
  });
});

describe("celdas ejecutables y pendientes", () => {
  const hoy = celda("a");
  const difiere = celda("b", { hoy: "DIFIERE", pendiente: "T1" });
  const falta = celda("c", { hoy: "NO_EXISTE", pendiente: "T2" });
  it("se ejecutan las que hoy coinciden; esperan su tramo las que difieren o no existen", () => {
    expect(celdasEjecutables([hoy, difiere, falta]).map((c) => c.id)).toEqual(["a"]);
    expect(celdasPendientes([hoy, difiere, falta]).map((c) => c.id)).toEqual(["b", "c"]);
  });
});

describe("celdaPor", () => {
  it("devuelve la celda y falla con el id si no está", () => {
    const a = celda("a");
    expect(celdaPor([a, celda("b")], "a")).toBe(a);
    expect(() => celdaPor([a], "z")).toThrow("el oráculo no tiene la celda z");
  });
});

describe("defectosDeForma", () => {
  it("una tabla bien formada no tiene defectos", () => {
    expect(
      defectosDeForma([
        celda("a"),
        celda("b", { permitido: false, errores: ["X"] }),
        celda("c", { hoy: "DIFIERE", pendiente: "T1" }),
        celda("d", { permitido: false, quien: "base" }),
        celda("e", { permitido: false, quien: "base+codigo" }),
      ]),
    ).toEqual([]);
  });

  it.each([
    ["id repetido", [celda("a"), celda("a")], "a: id repetido"],
    ["regla vacía", [celda("a", { regla: " " })], "a: sin regla"],
    ["decisión vacía", [celda("a", { decision: "" })], "a: sin decisión"],
    ["decisión de solo espacios", [celda("a", { decision: "  " })], "a: sin decisión"],
    ["coincide pero lleva tramo", [celda("a", { pendiente: "T1" })], "a: coincide y tiene tramo"],
    ["difiere sin tramo", [celda("a", { hoy: "DIFIERE" })], "a: no coincide y no dice su tramo"],
    [
      "no existe con tramo vacío",
      [celda("a", { hoy: "NO_EXISTE", pendiente: "  " })],
      "a: no coincide y no dice su tramo",
    ],
    ["permitida con errores", [celda("a", { errores: ["X"] })], "a: permitida con errores"],
    [
      "rechazada por el código sin código",
      [celda("a", { permitido: false })],
      "a: rechazada por el código sin código de error",
    ],
  ])("detecta: %s", (_nombre, celdas, defecto) => {
    expect(defectosDeForma(celdas)).toEqual([defecto]);
  });

  it("una rechazada por código que todavía no coincide (el nombre se define en su tramo) no es defecto", () => {
    expect(
      defectosDeForma([celda("a", { permitido: false, hoy: "NO_EXISTE", pendiente: "T1" })]),
    ).toEqual([]);
  });
});

describe("transiciones derivadas de las celdas", () => {
  const celdas = [
    celda("a", {
      transiciones: [
        { de: "A", a: "B" },
        { de: "A", a: "C" },
      ],
    }),
    celda("b", {
      transiciones: [
        { de: "B", a: "C" },
        { de: "A", a: "B" },
      ],
    }),
    celda("c", { permitido: false, transiciones: [{ de: "C", a: "A" }] }),
    celda("d"),
  ];
  it("solo cuentan las celdas permitidas; cada lista sale ordenada y sin repetidos", () => {
    expect(transicionesPermitidas(celdas, ["A", "B", "C"])).toEqual({
      A: ["B", "C"],
      B: ["C"],
      C: [],
    });
  });
  it("las prohibidas son las de las celdas no permitidas, como pares ordenados", () => {
    expect(
      transicionesProhibidas([
        ...celdas,
        celda("e", {
          permitido: false,
          transiciones: [
            { de: "B", a: "A" },
            { de: "C", a: "A" },
          ],
        }),
      ]),
    ).toEqual(["B>A", "C>A"]);
    expect(transicionesProhibidas([celda("a")])).toEqual([]);
    expect(transicionesProhibidas([celda("a", { permitido: false, errores: ["X"] })])).toEqual([]);
  });
});

describe("codigosDeLasCeldas", () => {
  it("junta los códigos de todas las celdas sin repetir", () => {
    expect(
      [
        ...codigosDeLasCeldas([
          celda("a", { permitido: false, errores: ["X", "Y"] }),
          celda("b", { permitido: false, errores: ["Y"] }),
          celda("c"),
        ]),
      ].sort(),
    ).toEqual(["X", "Y"]);
  });
});

describe("huellaDeLasCeldas", () => {
  it("es el SHA-256 del JSON de las celdas: igual para lo mismo, distinta si cambia cualquier valor", () => {
    const a = celda("a");
    expect(huellaDeLasCeldas([a])).toBe(huellaDeLasCeldas([{ ...a }]));
    expect(huellaDeLasCeldas([a])).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeLasCeldas([a])).not.toBe(huellaDeLasCeldas([{ ...a, permitido: false }]));
    expect(huellaDeLasCeldas([a])).not.toBe(huellaDeLasCeldas([]));
    expect(huellaDeLasCeldas([])).toBe(
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    );
  });
});
