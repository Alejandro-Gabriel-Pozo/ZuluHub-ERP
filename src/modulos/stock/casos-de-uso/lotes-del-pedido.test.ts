import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import {
  leerLotesDelRenglon,
  lotesParaLaHuella,
  MAXIMO_DE_LOTES_POR_RENGLON,
  type LoteLeido,
} from "./lotes-del-pedido";

/** La lectura de los lotes de un renglón de entrada (STK-E2a): lista de permitidos, suma EXACTA, todo o nada, y la forma canónica que entra a la huella. */
const cant = (t: string) => cantidadDesdeTexto(t);
const lote = (cambios: Record<string, unknown> = {}) => ({
  codigo: "L-1",
  fechaDeVencimiento: "2099-06-01",
  cantidad: "3",
  ...cambios,
});
const leer = (lotes: unknown, renglon = "5") => leerLotesDelRenglon(lotes, cant(renglon));
const codigoDe = (r: { ok: boolean; error?: unknown }) => (r.ok ? "OK" : String(r.error));

describe("leerLotesDelRenglon", () => {
  it("lee los lotes con sus fechas y cantidades exactas cuando suman el renglón", () => {
    const r = leer([
      lote(),
      lote({ codigo: "L-2", cantidad: "2", fechaDeElaboracion: "2099-01-01" }),
    ]);
    expect(
      r.ok && r.valor.map((l) => [l.codigo, l.fechaDeVencimiento, l.fechaDeElaboracion]),
    ).toEqual([
      ["L-1", "2099-06-01", null],
      ["L-2", "2099-06-01", "2099-01-01"],
    ]);
  });

  it("la suma tiene que ser EXACTA: de menos, de más, con decimales de sobra o con un resto de 0,0001 se rechaza", () => {
    expect(codigoDe(leer([lote({ cantidad: "4.9999" })]))).toBe("RENGLONES_INVALIDOS");
    expect(codigoDe(leer([lote({ cantidad: "5.0001" })]))).toBe("RENGLONES_INVALIDOS");
    expect(codigoDe(leer([lote({ cantidad: "5" })]))).toBe("OK");
    expect(
      codigoDe(leer([lote({ cantidad: "2.5" }), lote({ codigo: "L-2", cantidad: "2.5" })])),
    ).toBe("OK");
    expect(codigoDe(leer([lote({ cantidad: "0.00001" })], "0.0001"))).toBe("CANTIDAD_INVALIDA");
    expect(
      codigoDe(leer([lote({ cantidad: "0.1" }), lote({ codigo: "L-2", cantidad: "0.2" })], "0.3")),
    ).toBe("OK");
  });

  it("cantidad cero, negativa, con coma o que no es texto: CANTIDAD_INVALIDA", () => {
    for (const cantidad of ["0", "-1", "1,5", 3, null, undefined, ""]) {
      expect(codigoDe(leer([lote({ cantidad })])), String(cantidad)).toBe("CANTIDAD_INVALIDA");
    }
  });

  it("un código que no es de la lista de permitidos es un identificador inválido; repetirlo dentro del renglón, RENGLON_REPETIDO", () => {
    for (const codigo of ["", "L 1", "SIN_ASIGNAR", "L".repeat(41), 7, null, undefined]) {
      expect(codigoDe(leer([lote({ codigo })])), String(codigo)).toBe("IDENTIFICADOR_INVALIDO");
    }
    expect(codigoDe(leer([lote({ cantidad: "2" }), lote({ cantidad: "3" })]))).toBe(
      "RENGLON_REPETIDO",
    );
    expect(codigoDe(leer([lote({ cantidad: "2" }), lote({ codigo: "l-1", cantidad: "3" })]))).toBe(
      "OK",
    );
  });

  it("las fechas tienen que existir en el calendario y en el rango de la base; la de elaboración no pasa de la de vencimiento", () => {
    for (const fechaDeVencimiento of [
      "2026-02-30",
      "26-11-2026",
      "1999-12-31",
      "2201-01-01",
      "2026-13-01",
      20260601,
      "",
    ]) {
      expect(codigoDe(leer([lote({ fechaDeVencimiento })])), String(fechaDeVencimiento)).toBe(
        "VENCIMIENTO_REQUERIDO",
      );
    }
    expect(codigoDe(leer([lote({ fechaDeElaboracion: "2099-06-02" })]))).toBe(
      "IDENTIFICADOR_INVALIDO",
    );
    expect(codigoDe(leer([lote({ fechaDeElaboracion: "2099-06-01", cantidad: "5" })]))).toBe("OK");
    expect(
      codigoDe(leer([lote({ fechaDeVencimiento: null })].map((l) => ({ ...l, cantidad: "5" })))),
    ).toBe("OK");
    expect(codigoDe(leer([{ codigo: "L-1", cantidad: "5" }]))).toBe("OK");
  });

  it("la forma es cerrada: un campo de más (costo, referencia, producto) o algo que no es un objeto se rechaza", () => {
    for (const malo of [
      lote({ costoUnitario: "1" }),
      lote({ referenciaDeOrigen: "x" }),
      lote({ productoId: "p" }),
      "L-1",
      7,
      null,
      [lote()],
    ]) {
      expect(
        codigoDe(
          leer(
            [malo].map((m) =>
              typeof m === "object" && m !== null && !Array.isArray(m)
                ? { ...m, cantidad: "5" }
                : m,
            ),
          ),
        ),
        JSON.stringify(malo),
      ).toBe("RENGLONES_INVALIDOS");
    }
  });

  it("de 1 a 100 lotes: ninguno, o más del tope, o algo que no es una lista, se rechaza", () => {
    expect(codigoDe(leer([]))).toBe("RENGLONES_INVALIDOS");
    expect(codigoDe(leer(undefined))).toBe("RENGLONES_INVALIDOS");
    expect(codigoDe(leer("L-1"))).toBe("RENGLONES_INVALIDOS");
    const exactos = Array.from({ length: MAXIMO_DE_LOTES_POR_RENGLON }, (_, i) =>
      lote({ codigo: `L-${i}`, cantidad: "1" }),
    );
    expect(codigoDe(leer(exactos, String(MAXIMO_DE_LOTES_POR_RENGLON)))).toBe("OK");
    const demasiados = [...exactos, lote({ codigo: "L-x", cantidad: "1" })];
    expect(codigoDe(leer(demasiados, String(MAXIMO_DE_LOTES_POR_RENGLON + 1)))).toBe(
      "RENGLONES_INVALIDOS",
    );
  });
});

const leidos = (
  filas: readonly (readonly [string, string | null, string | null, string])[],
): LoteLeido[] =>
  filas.map(([codigo, vence, elabora, cantidad]) => ({
    codigo,
    fechaDeVencimiento: vence,
    fechaDeElaboracion: elabora,
    cantidad: cant(cantidad),
  }));

describe("lotesParaLaHuella", () => {
  it("es un texto JSON canónico: [código, vencimiento, elaboración, cantidad en texto fijo], ordenado", () => {
    expect(
      lotesParaLaHuella(
        leidos([
          ["B", "2099-02-01", null, "2"],
          ["A", "2099-01-01", "2098-01-01", "3.5"],
        ]),
      ),
    ).toBe('[["A","2099-01-01","2098-01-01","3.5000"],["B","2099-02-01",null,"2.0000"]]');
  });

  it("el mismo conjunto en OTRO ORDEN da el mismo texto (propiedad)", () => {
    const lote = fc.record({
      codigo: fc.stringMatching(/^[A-Za-z0-9.-]{1,8}$/),
      vence: fc.option(fc.constantFrom("2099-01-01", "2099-06-01", "2100-01-01"), { nil: null }),
      elabora: fc.option(fc.constantFrom("2090-01-01", "2098-06-01"), { nil: null }),
      cantidad: fc.constantFrom("1", "2.5", "0.0001", "100"),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(lote, { selector: (l) => l.codigo, minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 1000 }),
        (lotes, giro) => {
          const base = leidos(
            lotes.map((l) => [l.codigo, l.vence, l.elabora, l.cantidad] as const),
          );
          const k = giro % base.length;
          const otro = [...base.slice(k), ...base.slice(0, k)].reverse();
          expect(lotesParaLaHuella(otro)).toBe(lotesParaLaHuella(base));
        },
      ),
    );
  });

  it("cualquier código, fecha o cantidad distinto da OTRO texto (propiedad)", () => {
    const base = leidos([
      ["A", "2099-01-01", "2098-01-01", "3"],
      ["B", "2099-02-01", null, "2"],
    ]);
    const referencia = lotesParaLaHuella(base);
    const variantes: LoteLeido[][] = [
      leidos([
        ["A2", "2099-01-01", "2098-01-01", "3"],
        ["B", "2099-02-01", null, "2"],
      ]),
      leidos([
        ["a", "2099-01-01", "2098-01-01", "3"],
        ["B", "2099-02-01", null, "2"],
      ]),
      leidos([
        ["A", "2099-01-02", "2098-01-01", "3"],
        ["B", "2099-02-01", null, "2"],
      ]),
      leidos([
        ["A", "2099-01-01", null, "3"],
        ["B", "2099-02-01", null, "2"],
      ]),
      leidos([
        ["A", "2099-01-01", "2098-01-01", "3.0001"],
        ["B", "2099-02-01", null, "2"],
      ]),
      leidos([
        ["A", "2099-01-01", "2098-01-01", "3"],
        ["B", null, null, "2"],
      ]),
      leidos([["A", "2099-01-01", "2098-01-01", "3"]]),
      leidos([
        ["A", "2099-01-01", "2098-01-01", "3"],
        ["B", "2099-02-01", "2099-01-01", "2"],
      ]),
    ];
    for (const v of variantes) expect(lotesParaLaHuella(v)).not.toBe(referencia);
    // Mover una fecha de un lote a otro (cruzar el vencimiento) también cambia el pedido.
    const cruzado = leidos([
      ["A", "2099-02-01", "2098-01-01", "3"],
      ["B", "2099-01-01", null, "2"],
    ]);
    expect(lotesParaLaHuella(cruzado)).not.toBe(referencia);
  });

  it("una cantidad escrita de otra forma pero igual (2, 2.0, 2.0000) da el mismo texto", () => {
    expect(lotesParaLaHuella(leidos([["A", null, null, "2"]]))).toBe(
      lotesParaLaHuella(leidos([["A", null, null, "2.0000"]])),
    );
  });
});
