import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { huellaDeControles, type ControlDelDia, type Severidad } from "../aporte-al-cierre";
import {
  MAXIMO_DE_RECONOCIMIENTOS,
  decidirCierre,
  reconocimientosValidos,
  repiteElCierre,
  type Reconocimiento,
} from "./cierre";

const H = "a".repeat(64);
const control = (
  clave: string,
  severidad: Severidad,
  cantidad: number,
  detalle = H,
): ControlDelDia => ({
  modulo: clave.split(".")[0] as string,
  clave,
  severidad,
  cantidad,
  huellaDelDetalle: detalle,
  referencias: [],
});
const reconocimiento = (clave: string, texto: string | null = null): Reconocimiento => ({
  modulo: clave.split(".")[0] as string,
  clave,
  texto,
});
const decidir = (
  controles: readonly ControlDelDia[],
  reconocimientos: readonly Reconocimiento[] = [],
  huellaVista: string = huellaDeControles(controles),
) =>
  decidirCierre({
    controles,
    huellaActual: huellaDeControles(controles),
    huellaVista,
    reconocimientos,
  });

describe("reconocimientos pedidos: se validan antes de mirar los controles", () => {
  it("acepta uno bien formado, con o sin texto, y deja el texto en su forma canónica", () => {
    expect(
      reconocimientosValidos([
        { modulo: "caja", clave: "caja.diferencia_de_arqueo", texto: null },
        { modulo: "ventas", clave: "ventas.cortesias", texto: "  Autorizadas  por el gerente " },
        { modulo: "ventas", clave: "ventas.tickets_por_cobrar", texto: "  " },
      ]),
    ).toEqual({
      ok: true,
      valor: [
        { modulo: "caja", clave: "caja.diferencia_de_arqueo", texto: null },
        { modulo: "ventas", clave: "ventas.cortesias", texto: "Autorizadas por el gerente" },
        { modulo: "ventas", clave: "ventas.tickets_por_cobrar", texto: null },
      ],
    });
    expect(reconocimientosValidos([])).toEqual({ ok: true, valor: [] });
  });

  it.each([
    ["módulo mal escrito", { modulo: "Caja", clave: "Caja.x", texto: null }],
    ["clave mal escrita", { modulo: "caja", clave: "caja", texto: null }],
    ["clave de otro módulo", { modulo: "caja", clave: "ventas.x", texto: null }],
    ["texto con salto de línea", { modulo: "caja", clave: "caja.x", texto: "a\nb" }],
    ["texto con signos fuera de la lista", { modulo: "caja", clave: "caja.x", texto: "<b>" }],
    ["texto de más de 500", { modulo: "caja", clave: "caja.x", texto: "x".repeat(501) }],
  ])("rechaza %s", (_nombre, pedido) => {
    expect(reconocimientosValidos([pedido])).toEqual({
      ok: false,
      error: "RECONOCIMIENTO_INVALIDO",
    });
  });

  it("rechaza el mismo control reconocido dos veces y pasarse del tope", () => {
    const uno = { modulo: "caja", clave: "caja.x", texto: null };
    expect(reconocimientosValidos([uno, uno])).toEqual({
      ok: false,
      error: "RECONOCIMIENTO_INVALIDO",
    });
    const muchos = Array.from({ length: MAXIMO_DE_RECONOCIMIENTOS + 1 }, (_, i) => ({
      modulo: "caja",
      clave: `caja.c${"a".repeat(i % 5)}`,
      texto: null,
    }));
    expect(reconocimientosValidos(muchos)).toEqual({ ok: false, error: "RECONOCIMIENTO_INVALIDO" });
    expect(reconocimientosValidos([uno]).ok).toBe(true);
  });
});

describe("decidir el cierre: resueltos o reconocidos", () => {
  it("sin controles se cierra", () => {
    expect(decidir([])).toEqual({ ok: true, valor: [] });
  });

  it("con la huella que no es la de ahora, CONTROLES_CAMBIARON con los controles actuales (y antes que cualquier otra cosa)", () => {
    const controles = [control("caja.sesiones_sin_cerrar", "BLOQUEA", 2)];
    expect(decidir(controles, [], "b".repeat(64))).toEqual({
      ok: false,
      error: { codigo: "CONTROLES_CAMBIARON", controles },
    });
    expect(decidir(controles, [reconocimiento("x.y")], "")).toEqual({
      ok: false,
      error: { codigo: "CONTROLES_CAMBIARON", controles },
    });
  });

  it("un BLOQUEA con hallazgos frena y se informan todos, sin importar si hay reconocimientos", () => {
    const controles = [
      control("caja.sesiones_sin_cerrar", "BLOQUEA", 1),
      control("ventas.cuentas_abiertas", "BLOQUEA", 4),
      control("caja.otro", "BLOQUEA", 0),
    ];
    expect(decidir(controles)).toEqual({
      ok: false,
      error: {
        codigo: "CONTROLES_QUE_BLOQUEAN",
        claves: ["caja.sesiones_sin_cerrar", "ventas.cuentas_abiertas"],
      },
    });
  });

  it("un BLOQUEA en 0 no frena", () => {
    expect(decidir([control("caja.sesiones_sin_cerrar", "BLOQUEA", 0)]).ok).toBe(true);
  });

  it("un RECONOCIBLE con hallazgos sin reconocer es CONTROLES_SIN_RECONOCER; reconocido, aun sin texto, cierra", () => {
    const controles = [
      control("caja.diferencia_de_arqueo", "RECONOCIBLE", 2),
      control("ventas.cortesias", "RECONOCIBLE", 1),
      control("caja.conciliacion_por_medio", "RECONOCIBLE", 0),
    ];
    expect(decidir(controles, [reconocimiento("caja.diferencia_de_arqueo")])).toEqual({
      ok: false,
      error: { codigo: "CONTROLES_SIN_RECONOCER", claves: ["ventas.cortesias"] },
    });
    expect(
      decidir(controles, [
        reconocimiento("caja.diferencia_de_arqueo"),
        reconocimiento("ventas.cortesias", "Autorizadas por el gerente"),
      ]),
    ).toEqual({
      ok: true,
      valor: [
        { ...controles[0], reconocido: true, texto: null },
        { ...controles[1], reconocido: true, texto: "Autorizadas por el gerente" },
        { ...controles[2], reconocido: false, texto: null },
      ],
    });
  });

  it("INFORMA nunca frena y queda guardado sin reconocimiento", () => {
    const controles = [control("ventas.anulaciones", "INFORMA", 9)];
    expect(decidir(controles)).toEqual({
      ok: true,
      valor: [{ ...controles[0], reconocido: false, texto: null }],
    });
  });

  it("reconocer algo que no se puede reconocer es RECONOCIMIENTO_INVALIDO: un INFORMA, un BLOQUEA, un RECONOCIBLE en 0 o uno que no existe", () => {
    const controles = [
      control("ventas.anulaciones", "INFORMA", 3),
      control("caja.sesiones_sin_cerrar", "BLOQUEA", 0),
      control("caja.diferencia_de_arqueo", "RECONOCIBLE", 0),
    ];
    for (const clave of [
      "ventas.anulaciones",
      "caja.sesiones_sin_cerrar",
      "caja.diferencia_de_arqueo",
      "stock.no_existe",
    ]) {
      expect(decidir(controles, [reconocimiento(clave)]), clave).toEqual({
        ok: false,
        error: "RECONOCIMIENTO_INVALIDO",
      });
    }
  });

  it("(propiedad) se cierra si y solo si no hay BLOQUEA con hallazgos y todo RECONOCIBLE con hallazgos está reconocido", () => {
    const registro = fc.uniqueArray(
      fc.record({
        n: fc.integer({ min: 0, max: 5 }),
        severidad: fc.constantFrom<Severidad>("BLOQUEA", "RECONOCIBLE", "INFORMA"),
        cantidad: fc.integer({ min: 0, max: 3 }),
        reconocer: fc.boolean(),
      }),
      { selector: (r) => r.n, maxLength: 6 },
    );
    fc.assert(
      fc.property(registro, (filas) => {
        const controles = filas.map((f) =>
          control(`caja.c${"a".repeat(f.n)}`, f.severidad, f.cantidad),
        );
        const reconocimientos = filas
          .filter((f) => f.reconocer && f.severidad === "RECONOCIBLE" && f.cantidad > 0)
          .map((f) => reconocimiento(`caja.c${"a".repeat(f.n)}`));
        const debeCerrar = filas.every(
          (f) =>
            !(f.severidad === "BLOQUEA" && f.cantidad > 0) &&
            !(f.severidad === "RECONOCIBLE" && f.cantidad > 0 && !f.reconocer),
        );
        expect(decidir(controles, reconocimientos).ok).toBe(debeCerrar);
      }),
    );
  });
});

describe("repetir el cierre", () => {
  const cerrado = {
    huellaDeCierre: H,
    observacion: "Todo en orden",
    reconocidos: [
      { clave: "caja.diferencia_de_arqueo", texto: null },
      { clave: "ventas.cortesias", texto: "Autorizadas" },
    ],
  };
  const igual = {
    huellaVista: H,
    observacion: "Todo en orden",
    reconocimientos: [
      reconocimiento("ventas.cortesias", "Autorizadas"),
      reconocimiento("caja.diferencia_de_arqueo"),
    ],
  };

  it("es el mismo pedido si trae la misma huella, observación y reconocimientos (sin importar el orden)", () => {
    expect(repiteElCierre(cerrado, igual)).toBe(true);
  });

  it.each([
    ["otra huella", { ...igual, huellaVista: "b".repeat(64) }],
    ["otra observación", { ...igual, observacion: null }],
    [
      "otro texto de un reconocimiento",
      {
        ...igual,
        reconocimientos: [
          reconocimiento("ventas.cortesias", "Otra"),
          reconocimiento("caja.diferencia_de_arqueo"),
        ],
      },
    ],
    [
      "un reconocimiento de menos",
      { ...igual, reconocimientos: [reconocimiento("ventas.cortesias", "Autorizadas")] },
    ],
    [
      "un reconocimiento de más",
      { ...igual, reconocimientos: [...igual.reconocimientos, reconocimiento("stock.x")] },
    ],
    [
      "otro control reconocido",
      {
        ...igual,
        reconocimientos: [
          reconocimiento("ventas.cortesias", "Autorizadas"),
          reconocimiento("caja.otro"),
        ],
      },
    ],
  ])("no es el mismo pedido con %s", (_nombre, pedido) => {
    expect(repiteElCierre(cerrado, pedido)).toBe(false);
  });

  it("una jornada sin huella guardada no repite nada", () => {
    expect(repiteElCierre({ ...cerrado, huellaDeCierre: null }, igual)).toBe(false);
  });
});
