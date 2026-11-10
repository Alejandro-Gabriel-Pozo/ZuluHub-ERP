import { describe, expect, it } from "vitest";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  CANTIDAD_MAXIMA_DE_BILLETES,
  DENOMINACIONES_DE_BILLETES,
  decidirArqueo,
  esperadoPorLinea,
  hayDiferenciaDeArqueo,
  repiteElCierre,
  type ArqueoCalculado,
  type EntradaDeArqueo,
} from "./arqueo";

const valor = (texto: string): Importe => importeDesdeTexto(ARS, texto);
const ars = (monto: string) => ({ moneda: "ARS", monto });
const EF = "efectivo";
const DEB = "debito";
const QR = "qr";
const CIERRE = new Date("2026-11-10T20:00:00Z");

const mov = (medioDePagoId: string, importe: string, cuentaDeCobroId: string | null = null) => ({
  medioDePagoId,
  cuentaDeCobroId,
  importe: valor(importe),
});

const entrada = (e: Partial<EntradaDeArqueo> = {}): EntradaDeArqueo => ({
  efectivoId: EF,
  movimientos: [],
  conteo: { billetes: [{ denominacion: 100, cantidad: 0 }], monedas: ars("0") },
  otros: [],
  conformeGeneral: false,
  observacion: null,
  cierraPor: "persona-1",
  cierraEn: CIERRE,
  ...e,
});

function calcular(e: Partial<EntradaDeArqueo> = {}): ArqueoCalculado {
  const r = decidirArqueo(entrada(e));
  if (!r.ok) throw new Error(`se esperaba un arqueo: ${JSON.stringify(r.error)}`);
  return r.valor;
}
const error = (e: Partial<EntradaDeArqueo> = {}) => {
  const r = decidirArqueo(entrada(e));
  return r.ok ? null : r.error;
};

describe("el esperado por línea", () => {
  it("es la suma exacta de los movimientos de cada (medio, cuenta); el efectivo siempre está", () => {
    expect(esperadoPorLinea([], EF)).toEqual([
      { medioDePagoId: EF, cuentaDeCobroId: null, esperado: valor("0") },
    ]);
    const lineas = esperadoPorLinea(
      [
        mov(DEB, "0.10", "t1"),
        mov(EF, "100.05"),
        mov(DEB, "0.20", "t1"),
        mov(DEB, "5", null),
        mov(EF, "-0.05"),
        mov(DEB, "-0.30", "t1"),
      ],
      EF,
    );
    expect(lineas).toEqual([
      { medioDePagoId: DEB, cuentaDeCobroId: "t1", esperado: valor("0") },
      { medioDePagoId: DEB, cuentaDeCobroId: null, esperado: valor("5") },
      { medioDePagoId: EF, cuentaDeCobroId: null, esperado: valor("100") },
    ]);
  });
  it("una línea con movimientos que suman cero igual existe", () => {
    expect(
      esperadoPorLinea([mov(QR, "10"), mov(QR, "-10")], EF).map((l) => l.medioDePagoId),
    ).toEqual([EF, QR]);
  });
});

describe("contar el efectivo por billetes y monedas", () => {
  it("las denominaciones son las del cono monetario y la cantidad llega a 99999", () => {
    expect([...DENOMINACIONES_DE_BILLETES]).toEqual([20000, 10000, 2000, 1000, 500, 200, 100]);
    expect(CANTIDAD_MAXIMA_DE_BILLETES).toBe(99999);
  });

  it("2 × 20.000 + 5 × 2.000 + 1 × 500 + 3 × 100 + monedas 0,50 = 50.800,50 y con esperado 50.900,50 la diferencia es −100,00 (prueba a mano 7)", () => {
    const arqueo = calcular({
      movimientos: [mov(EF, "50900.50")],
      conteo: {
        billetes: [
          { denominacion: 100, cantidad: 3 },
          { denominacion: 500, cantidad: 1 },
          { denominacion: 20000, cantidad: 2 },
          { denominacion: 2000, cantidad: 5 },
        ],
        monedas: ars("0.50"),
      },
    });
    expect(arqueo.lineas).toEqual([
      {
        medioDePagoId: EF,
        cuentaDeCobroId: null,
        esperado: valor("50900.50"),
        contado: valor("50800.50"),
        contadoMonedas: valor("0.50"),
        conforme: false,
        conformePor: null,
        conformeEn: null,
        diferencia: valor("-100"),
      },
    ]);
    // El detalle queda de mayor a menor denominación.
    expect(arqueo.billetes).toEqual([
      { denominacion: 20000, cantidad: 2 },
      { denominacion: 2000, cantidad: 5 },
      { denominacion: 500, cantidad: 1 },
      { denominacion: 100, cantidad: 3 },
    ]);
  });

  it("todas las denominaciones y la cantidad máxima suman exacto, sin pasar por number", () => {
    const todas = DENOMINACIONES_DE_BILLETES.map((denominacion) => ({
      denominacion,
      cantidad: 99999,
    }));
    const arqueo = calcular({ conteo: { billetes: todas, monedas: ars("999999.99") } });
    const total =
      DENOMINACIONES_DE_BILLETES.reduce((s, d) => s + BigInt(d) * 99999n, 0n) * 100n + 99_999_999n;
    expect(arqueo.lineas[0]?.contado?.unidades).toBe(total);
  });

  it("un cero cuenta: contar billetes en cero y monedas en cero da contado cero", () => {
    const arqueo = calcular({ movimientos: [mov(EF, "10")] });
    expect(arqueo.lineas[0]?.contado).toEqual(valor("0"));
    expect(arqueo.lineas[0]?.diferencia).toEqual(valor("-10"));
    expect(arqueo.billetes).toEqual([{ denominacion: 100, cantidad: 0 }]);
  });

  it("sin conteo del efectivo no cierra, aunque haya conforme general", () => {
    expect(error({ conteo: null })).toBe("CONTEO_DE_EFECTIVO_FALTANTE");
    expect(error({ conteo: { billetes: [], monedas: ars("5") } })).toBe(
      "CONTEO_DE_EFECTIVO_FALTANTE",
    );
    expect(error({ conteo: null, conformeGeneral: true, movimientos: [mov(DEB, "5")] })).toBe(
      "CONTEO_DE_EFECTIVO_FALTANTE",
    );
  });

  it("un billete inválido nombra el campo: denominación que no existe, cantidad negativa, decimal o excedida", () => {
    const con = (billetes: { denominacion: number; cantidad: number }[]) => ({
      conteo: { billetes, monedas: ars("0") },
    });
    expect(
      error(
        con([
          { denominacion: 100, cantidad: 1 },
          { denominacion: 50, cantidad: 1 },
        ]),
      ),
    ).toEqual({ codigo: "CONTEO_INVALIDO", campo: "billetes.1.denominacion" });
    expect(error(con([{ denominacion: 20001, cantidad: 1 }]))).toEqual({
      codigo: "CONTEO_INVALIDO",
      campo: "billetes.0.denominacion",
    });
    expect(error(con([{ denominacion: 0, cantidad: 1 }]))).toEqual({
      codigo: "CONTEO_INVALIDO",
      campo: "billetes.0.denominacion",
    });
    for (const cantidad of [
      -1,
      1.5,
      100000,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "3" as unknown as number,
    ]) {
      expect(error(con([{ denominacion: 100, cantidad }]))).toEqual({
        codigo: "CONTEO_INVALIDO",
        campo: "billetes.0.cantidad",
      });
    }
    expect(error(con([{ denominacion: "100" as unknown as number, cantidad: 1 }]))).toEqual({
      codigo: "CONTEO_INVALIDO",
      campo: "billetes.0.denominacion",
    });
    expect(error(con([{ denominacion: 100, cantidad: 99999 }]))).toBeNull();
    expect(error(con([{ denominacion: 100, cantidad: 0 }]))).toBeNull();
  });

  it("una denominación repetida es CONTEO_DUPLICADO (después de validar cada una)", () => {
    expect(
      error({
        conteo: {
          billetes: [
            { denominacion: 100, cantidad: 1 },
            { denominacion: 100, cantidad: 2 },
          ],
          monedas: ars("0"),
        },
      }),
    ).toBe("CONTEO_DUPLICADO");
    expect(
      error({
        conteo: {
          billetes: [
            { denominacion: 100, cantidad: 1 },
            { denominacion: 100, cantidad: -2 },
          ],
          monedas: ars("0"),
        },
      }),
    ).toEqual({ codigo: "CONTEO_INVALIDO", campo: "billetes.1.cantidad" });
  });

  it("las monedas mal escritas, negativas o en otra moneda son CONTEO_INVALIDO de monedas", () => {
    for (const monto of ["-1", "0.001", "1e3", "abc", ""]) {
      expect(
        error({ conteo: { billetes: [{ denominacion: 100, cantidad: 1 }], monedas: ars(monto) } }),
      ).toEqual({ codigo: "CONTEO_INVALIDO", campo: "monedas" });
    }
    expect(
      error({
        conteo: {
          billetes: [{ denominacion: 100, cantidad: 1 }],
          monedas: { moneda: "USD", monto: "1" },
        },
      }),
    ).toEqual({ codigo: "CONTEO_INVALIDO", campo: "monedas" });
  });
});

describe("los demás medios: declarar o conforme general (decisión 164)", () => {
  const movimientos = [
    mov(EF, "1000"),
    mov(DEB, "300", "t1"),
    mov(DEB, "200", "t1"),
    mov(QR, "50"),
  ];

  it("declarar el total de una línea: contado, diferencia contra el esperado y sin conforme", () => {
    const arqueo = calcular({
      movimientos,
      otros: [
        { medioDePagoId: DEB, cuentaDeCobroId: "t1", contado: ars("499.99") },
        { medioDePagoId: QR, cuentaDeCobroId: null, contado: ars("50") },
      ],
    });
    expect(
      arqueo.lineas.map((l) => [
        l.medioDePagoId,
        l.cuentaDeCobroId,
        l.esperado,
        l.contado,
        l.contadoMonedas,
        l.conforme,
        l.diferencia,
      ]),
    ).toEqual([
      [DEB, "t1", valor("500"), valor("499.99"), null, false, valor("-0.01")],
      [EF, null, valor("1000"), valor("0"), valor("0"), false, valor("-1000")],
      [QR, null, valor("50"), valor("50"), null, false, valor("0")],
    ]);
  });

  it("el conforme general acepta lo registrado de todas las líneas no efectivo, con quién y cuándo, sin diferencia", () => {
    const arqueo = calcular({ movimientos, conformeGeneral: true });
    const noEfectivo = arqueo.lineas.filter((l) => l.medioDePagoId !== EF);
    expect(noEfectivo).toHaveLength(2);
    for (const l of noEfectivo) {
      expect(l).toMatchObject({
        contado: null,
        contadoMonedas: null,
        conforme: true,
        conformePor: "persona-1",
        conformeEn: CIERRE,
        diferencia: null,
      });
    }
  });

  it("el efectivo nunca es conforme: el conforme general no lo cubre", () => {
    const arqueo = calcular({ movimientos, conformeGeneral: true });
    expect(arqueo.lineas.find((l) => l.medioDePagoId === EF)).toMatchObject({
      conforme: false,
      conformePor: null,
      conformeEn: null,
    });
  });

  it("un total declarado gana sobre el conforme general", () => {
    const arqueo = calcular({
      movimientos,
      conformeGeneral: true,
      otros: [{ medioDePagoId: QR, cuentaDeCobroId: null, contado: ars("40") }],
    });
    expect(arqueo.lineas.find((l) => l.medioDePagoId === QR)).toMatchObject({
      conforme: false,
      contado: valor("40"),
      diferencia: valor("-10"),
      conformePor: null,
    });
    expect(arqueo.lineas.find((l) => l.medioDePagoId === DEB)).toMatchObject({ conforme: true });
  });

  it("sin declarar ni conforme una línea con movimientos es CONTEO_O_CONFORME_FALTANTE, con la lista de las que faltan", () => {
    expect(error({ movimientos })).toEqual({
      codigo: "CONTEO_O_CONFORME_FALTANTE",
      lineas: [
        { medioDePagoId: DEB, cuentaDeCobroId: "t1" },
        { medioDePagoId: QR, cuentaDeCobroId: null },
      ],
    });
    expect(
      error({
        movimientos,
        otros: [{ medioDePagoId: DEB, cuentaDeCobroId: "t1", contado: ars("500") }],
      }),
    ).toEqual({
      codigo: "CONTEO_O_CONFORME_FALTANTE",
      lineas: [{ medioDePagoId: QR, cuentaDeCobroId: null }],
    });
  });

  it("solo hay línea de un medio no efectivo si tuvo movimientos (el efectivo es la excepción)", () => {
    const arqueo = calcular({ movimientos: [mov(EF, "5")] });
    expect(arqueo.lineas.map((l) => l.medioDePagoId)).toEqual([EF]);
  });

  it("«sin cuenta» es una línea aparte de la misma tarjeta con cuenta", () => {
    const arqueo = calcular({
      movimientos: [mov(DEB, "10", null), mov(DEB, "20", "t1")],
      conformeGeneral: true,
    });
    expect(
      arqueo.lineas
        .filter((l) => l.medioDePagoId === DEB)
        .map((l) => [l.cuentaDeCobroId, l.esperado]),
    ).toEqual([
      ["t1", valor("20")],
      [null, valor("10")],
    ]);
    // Una cuenta con el texto vacío tampoco se confunde con «sin cuenta».
    expect(
      esperadoPorLinea([mov(DEB, "1", ""), mov(DEB, "2", null)], EF).filter(
        (l) => l.medioDePagoId === DEB,
      ),
    ).toHaveLength(2);
  });

  it("un total mal escrito es CONTEO_INVALIDO con su campo y nunca cuenta como conforme", () => {
    for (const monto of ["-5", "10.001", "5400abc", "1e3", ""]) {
      expect(
        error({
          movimientos,
          conformeGeneral: true,
          otros: [{ medioDePagoId: QR, cuentaDeCobroId: null, contado: ars(monto) }],
        }),
      ).toEqual({ codigo: "CONTEO_INVALIDO", campo: "otros.0.contado" });
    }
    expect(
      error({
        movimientos,
        conformeGeneral: true,
        otros: [
          { medioDePagoId: QR, cuentaDeCobroId: null, contado: { moneda: "USD", monto: "1" } },
        ],
      }),
    ).toEqual({ codigo: "CONTEO_INVALIDO", campo: "otros.0.contado" });
    expect(
      error({
        movimientos,
        conformeGeneral: true,
        otros: [
          { medioDePagoId: QR, cuentaDeCobroId: null, contado: ars("1") },
          { medioDePagoId: DEB, cuentaDeCobroId: "t1", contado: ars("x") },
        ],
      }),
    ).toEqual({ codigo: "CONTEO_INVALIDO", campo: "otros.1.contado" });
  });

  it("un total de un medio o cuenta que no es una línea de la sesión es CONTEO_DE_MEDIO_AJENO; el efectivo tampoco se declara", () => {
    expect(
      error({
        movimientos,
        conformeGeneral: true,
        otros: [{ medioDePagoId: "otro", cuentaDeCobroId: null, contado: ars("1") }],
      }),
    ).toBe("CONTEO_DE_MEDIO_AJENO");
    expect(
      error({
        movimientos,
        conformeGeneral: true,
        otros: [{ medioDePagoId: DEB, cuentaDeCobroId: "t2", contado: ars("1") }],
      }),
    ).toBe("CONTEO_DE_MEDIO_AJENO");
    expect(
      error({
        movimientos,
        conformeGeneral: true,
        otros: [{ medioDePagoId: DEB, cuentaDeCobroId: null, contado: ars("1") }],
      }),
    ).toBe("CONTEO_DE_MEDIO_AJENO");
    expect(
      error({
        movimientos,
        conformeGeneral: true,
        otros: [{ medioDePagoId: EF, cuentaDeCobroId: null, contado: ars("1") }],
      }),
    ).toBe("CONTEO_DE_MEDIO_AJENO");
  });

  it("dos totales de la misma línea son CONTEO_DUPLICADO", () => {
    const dos = [
      { medioDePagoId: QR, cuentaDeCobroId: null, contado: ars("1") },
      { medioDePagoId: QR, cuentaDeCobroId: null, contado: ars("2") },
    ];
    expect(error({ movimientos, conformeGeneral: true, otros: dos })).toBe("CONTEO_DUPLICADO");
  });

  it("la observación opcional se canoniza; una fuera de la lista es OBSERVACION_INVALIDA", () => {
    expect(calcular({ observacion: " Faltó  un billete " }).observacion).toBe("Faltó un billete");
    expect(calcular({ observacion: "  " }).observacion).toBeNull();
    expect(error({ observacion: "a\nb" })).toBe("OBSERVACION_INVALIDA");
  });

  it("el orden de los errores: efectivo, billetes, monedas, totales, observación y por último lo que falta", () => {
    const todoMal = {
      movimientos,
      conteo: { billetes: [{ denominacion: 7, cantidad: 1 }], monedas: ars("x") },
      otros: [{ medioDePagoId: "otro", cuentaDeCobroId: null, contado: ars("x") }],
      observacion: "<",
    };
    expect(error(todoMal)).toEqual({ codigo: "CONTEO_INVALIDO", campo: "billetes.0.denominacion" });
    expect(
      error({
        ...todoMal,
        conteo: { billetes: [{ denominacion: 100, cantidad: 1 }], monedas: ars("x") },
      }),
    ).toEqual({ codigo: "CONTEO_INVALIDO", campo: "monedas" });
    expect(error({ ...todoMal, conteo: entrada().conteo })).toEqual({
      codigo: "CONTEO_INVALIDO",
      campo: "otros.0.contado",
    });
    expect(error({ ...todoMal, conteo: entrada().conteo, otros: [] })).toBe("OBSERVACION_INVALIDA");
    expect(
      error({ ...todoMal, conteo: entrada().conteo, otros: [], observacion: null }),
    ).toMatchObject({ codigo: "CONTEO_O_CONFORME_FALTANTE" });
  });

  it("las líneas salen ordenadas por (medio, cuenta) sin importar el orden de los movimientos", () => {
    const a = calcular({
      movimientos: [mov(QR, "1"), mov(DEB, "1", "t2"), mov(DEB, "1", "t1")],
      conformeGeneral: true,
    });
    const b = calcular({
      movimientos: [mov(DEB, "1", "t1"), mov(DEB, "1", "t2"), mov(QR, "1")],
      conformeGeneral: true,
    });
    expect(a).toEqual(b);
    expect(a.lineas.map((l) => [l.medioDePagoId, l.cuentaDeCobroId])).toEqual([
      [DEB, "t1"],
      [DEB, "t2"],
      [EF, null],
      [QR, null],
    ]);
  });
});

describe("hay diferencia de arqueo", () => {
  it("solo cuenta una línea contada con diferencia distinta de cero; una conforme no", () => {
    expect(hayDiferenciaDeArqueo([])).toBe(false);
    expect(hayDiferenciaDeArqueo([{ diferencia: null }])).toBe(false);
    expect(hayDiferenciaDeArqueo([{ diferencia: valor("0") }, { diferencia: null }])).toBe(false);
    expect(
      hayDiferenciaDeArqueo([{ diferencia: valor("0") }, { diferencia: valor("-0.01") }]),
    ).toBe(true);
    expect(hayDiferenciaDeArqueo([{ diferencia: valor("0.01") }])).toBe(true);
  });
});

describe("repetir el cierre", () => {
  const base = calcular({
    movimientos: [mov(EF, "100"), mov(DEB, "50")],
    conformeGeneral: true,
    conteo: { billetes: [{ denominacion: 100, cantidad: 1 }], monedas: ars("0.50") },
  });

  it("el mismo conteo y el mismo conforme es el mismo cierre, aunque cambien quién, cuándo y la observación", () => {
    const otro = calcular({
      movimientos: [mov(EF, "100"), mov(DEB, "50")],
      conformeGeneral: true,
      conteo: { billetes: [{ denominacion: 100, cantidad: 1 }], monedas: ars("0.50") },
      cierraPor: "persona-2",
      cierraEn: new Date("2027-01-01T00:00:00Z"),
      observacion: "reintento",
    });
    expect(repiteElCierre(base, otro)).toBe(true);
  });

  it("no depende del orden de las líneas ni de si una denominación en cero se mandó o se omitió", () => {
    const mismo = {
      lineas: [...base.lineas].reverse(),
      billetes: [...base.billetes, { denominacion: 500, cantidad: 0 }],
    };
    expect(repiteElCierre(base, mismo)).toBe(true);
    expect(repiteElCierre(mismo, base)).toBe(true);
  });

  it("otro conteo es otro cierre: un billete, las monedas, una línea declarada o el conforme", () => {
    const distinto = (e: Partial<EntradaDeArqueo>) =>
      calcular({
        movimientos: [mov(EF, "100"), mov(DEB, "50")],
        conformeGeneral: true,
        conteo: { billetes: [{ denominacion: 100, cantidad: 1 }], monedas: ars("0.50") },
        ...e,
      });
    expect(
      repiteElCierre(
        base,
        distinto({
          conteo: { billetes: [{ denominacion: 100, cantidad: 2 }], monedas: ars("0.50") },
        }),
      ),
    ).toBe(false);
    expect(
      repiteElCierre(
        base,
        distinto({
          conteo: { billetes: [{ denominacion: 200, cantidad: 1 }], monedas: ars("0.50") },
        }),
      ),
    ).toBe(false);
    expect(
      repiteElCierre(
        base,
        distinto({
          conteo: { billetes: [{ denominacion: 100, cantidad: 1 }], monedas: ars("0.51") },
        }),
      ),
    ).toBe(false);
    expect(
      repiteElCierre(
        base,
        distinto({ otros: [{ medioDePagoId: DEB, cuentaDeCobroId: null, contado: ars("50") }] }),
      ),
    ).toBe(false);
    expect(
      repiteElCierre(
        base,
        distinto({
          otros: [{ medioDePagoId: DEB, cuentaDeCobroId: null, contado: ars("49") }],
          conformeGeneral: false,
        }),
      ),
    ).toBe(false);
    expect(repiteElCierre(base, distinto({ movimientos: [mov(EF, "100"), mov(QR, "50")] }))).toBe(
      false,
    );
    expect(
      repiteElCierre(base, distinto({ movimientos: [mov(EF, "100"), mov(DEB, "50", "t1")] })),
    ).toBe(false);
  });

  it("cada campo de una línea cuenta por separado: el contado y las monedas", () => {
    const linea = {
      medioDePagoId: DEB,
      cuentaDeCobroId: null,
      contado: valor("200") as Importe | null,
      contadoMonedas: valor("100") as Importe | null,
      conforme: false,
    };
    const comparable = (l: Partial<typeof linea>) => ({
      lineas: [{ ...linea, ...l }],
      billetes: [],
    });
    expect(repiteElCierre(comparable({}), comparable({}))).toBe(true);
    expect(repiteElCierre(comparable({}), comparable({ contadoMonedas: valor("0") }))).toBe(false);
    expect(repiteElCierre(comparable({}), comparable({ contado: valor("199.99") }))).toBe(false);
    expect(repiteElCierre(comparable({}), comparable({ contadoMonedas: null }))).toBe(false);
    expect(repiteElCierre(comparable({}), comparable({ contado: null }))).toBe(false);
    expect(
      repiteElCierre(comparable({ contadoMonedas: null }), comparable({ contadoMonedas: null })),
    ).toBe(true);
    expect(repiteElCierre(comparable({ contado: null }), comparable({ contado: null }))).toBe(true);
    expect(repiteElCierre(comparable({}), comparable({ conforme: true }))).toBe(false);
  });

  it("dos líneas declaradas que solo difieren en el contado no son el mismo cierre", () => {
    const declarada = (contado: string) =>
      calcular({
        movimientos: [mov(EF, "100"), mov(DEB, "50")],
        otros: [{ medioDePagoId: DEB, cuentaDeCobroId: null, contado: ars(contado) }],
        conteo: { billetes: [{ denominacion: 100, cantidad: 1 }], monedas: ars("0.50") },
      });
    expect(repiteElCierre(declarada("50"), declarada("50"))).toBe(true);
    expect(repiteElCierre(declarada("50"), declarada("49"))).toBe(false);
  });

  it("una línea declarada con el mismo total que lo esperado NO es un cierre «conforme»: es otro contenido", () => {
    const declarada = calcular({
      movimientos: [mov(EF, "100"), mov(DEB, "50")],
      otros: [{ medioDePagoId: DEB, cuentaDeCobroId: null, contado: ars("50") }],
      conteo: { billetes: [{ denominacion: 100, cantidad: 1 }], monedas: ars("0.50") },
    });
    expect(repiteElCierre(base, declarada)).toBe(false);
    expect(repiteElCierre(declarada, base)).toBe(false);
  });

  it("compara la forma de la cantidad por denominación, no solo la lista", () => {
    const a = {
      lineas: [],
      billetes: [
        { denominacion: 100, cantidad: 2 },
        { denominacion: 200, cantidad: 1 },
      ],
    };
    const b = {
      lineas: [],
      billetes: [
        { denominacion: 100, cantidad: 1 },
        { denominacion: 200, cantidad: 2 },
      ],
    };
    expect(repiteElCierre(a, b)).toBe(false);
    expect(repiteElCierre(a, { lineas: [], billetes: [...a.billetes].reverse() })).toBe(true);
  });
});
