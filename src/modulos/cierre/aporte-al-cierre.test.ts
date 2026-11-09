import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import {
  claveDelModulo,
  controlesDelAporte,
  formaDeClaveValida,
  formaDeHuellaValida,
  formaDeModuloValida,
  huellaDeControles,
  impideCerrar,
  ordenarControles,
  pideReconocimiento,
  MAXIMO_DE_REFERENCIAS,
  type ControlDelDia,
  type Severidad,
} from "./aporte-al-cierre";

const H = (c: string) => c.repeat(64);

const control = (cambios: Partial<ControlDelDia> = {}): ControlDelDia => ({
  modulo: "caja",
  clave: "caja.diferencia_de_arqueo",
  severidad: "RECONOCIBLE",
  cantidad: 2,
  huellaDelDetalle: H("a"),
  referencias: [],
  ...cambios,
});

const controlAzar = fc.record({
  modulo: fc.constantFrom("caja", "ventas", "stock"),
  control: fc.constantFrom("a", "b", "c", "d"),
  severidad: fc.constantFrom<Severidad>("BLOQUEA", "RECONOCIBLE", "INFORMA"),
  cantidad: fc.integer({ min: 0, max: 20 }),
  detalle: fc.constantFrom("a", "b", "c"),
});
const aControl = (r: {
  modulo: string;
  control: string;
  severidad: Severidad;
  cantidad: number;
  detalle: string;
}): ControlDelDia => ({
  modulo: r.modulo,
  clave: `${r.modulo}.${r.control}`,
  severidad: r.severidad,
  cantidad: r.cantidad,
  huellaDelDetalle: H(r.detalle),
  referencias: [],
});
/** Controles con claves distintas (como los entrega cada aporte). */
const controlesAzar = fc
  .uniqueArray(controlAzar, { selector: (r) => `${r.modulo}.${r.control}`, maxLength: 8 })
  .map((lista) => lista.map(aControl));

describe("la forma de los nombres del punto de enganche", () => {
  it("el módulo es de 1 a 40 letras minúsculas o guion bajo", () => {
    for (const bueno of ["caja", "stock_de_barra", "a", "a".repeat(40)]) {
      expect(formaDeModuloValida(bueno), bueno).toBe(true);
    }
    for (const malo of [
      "",
      "Caja",
      "caja1",
      "caja-x",
      "caja.x",
      "a".repeat(41),
      " caja",
      "caja\n",
    ]) {
      expect(formaDeModuloValida(malo), JSON.stringify(malo)).toBe(false);
    }
  });

  it("la clave es modulo.control en minúsculas y guion bajo, de hasta 81 caracteres", () => {
    for (const buena of [
      "caja.cobrado_contra_ticket",
      "a.b",
      `${"a".repeat(40)}.${"b".repeat(40)}`,
    ]) {
      expect(formaDeClaveValida(buena), buena).toBe(true);
    }
    for (const mala of [
      "caja",
      "caja.",
      ".x",
      "caja.x.y",
      "Caja.x",
      "caja.x1",
      "caja-x.y",
      "a.b\n",
      `${"a".repeat(41)}.${"b".repeat(40)}`,
    ]) {
      expect(formaDeClaveValida(mala), JSON.stringify(mala)).toBe(false);
    }
  });

  it("la clave es del módulo solo si empieza con «modulo.» (no con un prefijo parecido)", () => {
    expect(claveDelModulo("caja", "caja.x")).toBe(true);
    expect(claveDelModulo("caja", "cajas.x")).toBe(false);
    expect(claveDelModulo("caja", "ventas.caja")).toBe(false);
    expect(claveDelModulo("caja", "caja_x.y")).toBe(false);
  });

  it("la huella del detalle son 64 dígitos hexadecimales en minúscula", () => {
    expect(formaDeHuellaValida("0123456789abcdef".repeat(4))).toBe(true);
    for (const mala of ["", "A".repeat(64), "a".repeat(63), "a".repeat(65), `${"a".repeat(63)}g`]) {
      expect(formaDeHuellaValida(mala), mala).toBe(false);
    }
  });
});

describe("controles de un aporte: se comprueban contra el contrato (fail-closed)", () => {
  it("acepta controles bien formados del propio módulo", () => {
    const controles = [control(), control({ clave: "caja.otro", cantidad: 0 })];
    expect(controlesDelAporte("caja", controles)).toEqual({ ok: true, valor: controles });
    expect(controlesDelAporte("caja", [])).toEqual({ ok: true, valor: [] });
  });

  it.each([
    ["de otro módulo", control({ modulo: "ventas", clave: "ventas.x" })],
    ["con la clave de otro módulo", control({ clave: "ventas.x" })],
    ["con clave mal formada", control({ clave: "caja" })],
    ["con severidad desconocida", control({ severidad: "GRAVE" as Severidad })],
    ["con cantidad negativa", control({ cantidad: -1 })],
    ["con cantidad fraccionaria", control({ cantidad: 1.5 })],
    ["con cantidad que no entra en un integer", control({ cantidad: 2_147_483_648 })],
    ["con cantidad no numérica", control({ cantidad: Number.NaN })],
    ["con huella del detalle inválida", control({ huellaDelDetalle: "xyz" })],
    [
      "con más referencias que el máximo",
      control({
        referencias: Array.from({ length: MAXIMO_DE_REFERENCIAS + 1 }, (_, i) => `r${i}`),
      }),
    ],
  ])("rechaza un control %s con APORTE_NO_DISPONIBLE", (_nombre, malo) => {
    expect(controlesDelAporte("caja", [malo])).toEqual({
      ok: false,
      error: "APORTE_NO_DISPONIBLE",
    });
  });

  it("acepta exactamente el máximo de referencias y rechaza una clave repetida", () => {
    const justo = control({
      referencias: Array.from({ length: MAXIMO_DE_REFERENCIAS }, (_, i) => `r${i}`),
    });
    expect(controlesDelAporte("caja", [justo]).ok).toBe(true);
    expect(controlesDelAporte("caja", [control(), control({ cantidad: 5 })])).toEqual({
      ok: false,
      error: "APORTE_NO_DISPONIBLE",
    });
  });
});

describe("severidad: qué frena y qué se reconoce", () => {
  it("solo BLOQUEA con hallazgos impide; solo RECONOCIBLE con hallazgos se reconoce; INFORMA nunca frena", () => {
    for (const severidad of ["BLOQUEA", "RECONOCIBLE", "INFORMA"] as const) {
      for (const cantidad of [0, 1, 7]) {
        expect(impideCerrar({ severidad, cantidad }), `${severidad} ${cantidad}`).toBe(
          severidad === "BLOQUEA" && cantidad > 0,
        );
        expect(pideReconocimiento({ severidad, cantidad }), `${severidad} ${cantidad}`).toBe(
          severidad === "RECONOCIBLE" && cantidad > 0,
        );
      }
    }
  });
});

describe("la huella del día", () => {
  it("es un sha256 en hexadecimal, y la lista vacía tiene la suya", () => {
    expect(huellaDeControles([control()])).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeControles([])).toBe(
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    );
  });

  it("cada dato que entra cambia la huella, y las referencias no", () => {
    const base = huellaDeControles([control()]);
    expect(huellaDeControles([control({ cantidad: 3 })])).not.toBe(base);
    expect(huellaDeControles([control({ severidad: "INFORMA" })])).not.toBe(base);
    expect(huellaDeControles([control({ huellaDelDetalle: H("b") })])).not.toBe(base);
    expect(huellaDeControles([control({ clave: "caja.otra" })])).not.toBe(base);
    expect(
      huellaDeControles([control({ modulo: "stock", clave: "stock.diferencia_de_arqueo" })]),
    ).not.toBe(base);
    expect(huellaDeControles([control({ referencias: ["a", "b"] })])).toBe(base);
  });

  it("(propiedad) no depende del orden en que llegan los controles", () => {
    fc.assert(
      fc.property(controlesAzar, fc.nat(), (controles, giro) => {
        const girados =
          controles.length === 0
            ? controles
            : [
                ...controles.slice(giro % controles.length),
                ...controles.slice(0, giro % controles.length),
              ];
        expect(huellaDeControles(girados)).toBe(huellaDeControles(controles));
        expect(huellaDeControles([...controles].reverse())).toBe(huellaDeControles(controles));
      }),
    );
  });

  it("(propiedad) es determinista y distingue dos listas distintas", () => {
    fc.assert(
      fc.property(controlesAzar, controlesAzar, (a, b) => {
        expect(huellaDeControles(a)).toBe(huellaDeControles(a));
        const iguales = JSON.stringify(ordenarControles(a)) === JSON.stringify(ordenarControles(b));
        // Dos listas con otros datos no pueden colisionar (en la práctica); las iguales, sí coinciden.
        expect(huellaDeControles(a) === huellaDeControles(b)).toBe(iguales);
      }),
    );
  });

  it("ordena por módulo y por clave por unidades de código, sin tocar la lista original", () => {
    const original = [
      control({ modulo: "ventas", clave: "ventas.b" }),
      control({ modulo: "caja", clave: "caja.b" }),
      control({ modulo: "caja", clave: "caja.a" }),
    ];
    const copia = [...original];
    expect(ordenarControles(original).map((c) => c.clave)).toEqual([
      "caja.a",
      "caja.b",
      "ventas.b",
    ]);
    expect(original).toEqual(copia);
  });
});
