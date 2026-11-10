import { describe, expect, it } from "vitest";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  cantidadDeLineasPorExplicar,
  conciliarJornada,
  lineaPorExplicar,
  type CierreDeCajaDelPar,
  type EntradaDeConciliacion,
} from "./conciliacion";

const valor = (texto: string): Importe => importeDesdeTexto(ARS, texto);
const EF = "efectivo";
const DEB = "debito";
const CRE = "credito";
const QR = "qr";
const T0 = new Date("2026-11-10T20:00:00Z");
const T1 = new Date("2026-11-10T22:00:00Z");

const mov = (medioDePagoId: string, importe: string, cuentaDeCobroId: string | null = null) => ({
  medioDePagoId,
  cuentaDeCobroId,
  importe: valor(importe),
});
const par = (medioDePagoId: string, cuentaDeCobroId: string | null = null) => ({
  medioDePagoId,
  cuentaDeCobroId,
});
const contado = (
  medioDePagoId: string,
  importe: string,
  cuentaDeCobroId: string | null = null,
): CierreDeCajaDelPar => ({
  medioDePagoId,
  cuentaDeCobroId,
  conforme: false,
  contado: valor(importe),
});
const conformeDe = (
  medioDePagoId: string,
  por: string,
  en: Date,
  cuentaDeCobroId: string | null = null,
): CierreDeCajaDelPar => ({
  medioDePagoId,
  cuentaDeCobroId,
  conforme: true,
  conformePor: por,
  conformeEn: en,
});

const entrada = (e: Partial<EntradaDeConciliacion> = {}): EntradaDeConciliacion => ({
  efectivoId: EF,
  movimientos: [],
  correcciones: [],
  declaraciones: [],
  conformeGeneral: null,
  cierres: [],
  ...e,
});
const linea = (e: Partial<EntradaDeConciliacion>, medio: string, cuenta: string | null = null) => {
  const l = conciliarJornada(entrada(e)).find(
    (x) => x.medioDePagoId === medio && x.cuentaDeCobroId === cuenta,
  );
  if (l === undefined) throw new Error(`no hay línea de ${medio}`);
  return l;
};

describe("conciliación por medio: de dónde sale cada línea (e3b §4.4)", () => {
  it("sin nada no hay líneas", () => {
    expect(conciliarJornada(entrada())).toEqual([]);
  });

  it("el efectivo es siempre CONTADO: la suma de lo contado en cada caja, con diferencia contra lo registrado", () => {
    const l = linea(
      {
        movimientos: [mov(EF, "1000"), mov(EF, "-50.50")],
        cierres: [contado(EF, "600"), contado(EF, "349.50")],
      },
      EF,
    );
    expect(l).toEqual({
      medioDePagoId: EF,
      cuentaDeCobroId: null,
      registrado: valor("949.50"),
      correcciones: valor("0"),
      declarado: valor("949.50"),
      estado: "CONTADO",
      conformePor: null,
      conformeEn: null,
      diferencia: valor("0"),
    });
    expect(
      linea({ movimientos: [mov(EF, "1000")], cierres: [contado(EF, "999")] }, EF).diferencia,
    ).toEqual(valor("-1"));
  });

  it("el efectivo ignora una declaración y un conforme general, y suma solo lo contado", () => {
    const l = linea(
      {
        movimientos: [mov(EF, "10")],
        declaraciones: [{ ...par(EF), secuencia: 1, importe: valor("999") }],
        conformeGeneral: { por: "p", en: T0 },
        cierres: [contado(EF, "7"), conformeDe(EF, "p", T0)],
      },
      EF,
    );
    expect(l).toMatchObject({
      estado: "CONTADO",
      declarado: valor("7"),
      conformePor: null,
      conformeEn: null,
      diferencia: valor("-3"),
    });
  });

  it("(1) la declaración vigente del par gana: DECLARADO con su diferencia; rige la de mayor secuencia", () => {
    const declaraciones = [
      { ...par(DEB, "t1"), secuencia: 2, importe: valor("490") },
      { ...par(DEB, "t1"), secuencia: 1, importe: valor("999") },
      { ...par(DEB, "t2"), secuencia: 1, importe: valor("1") },
    ];
    expect(linea({ movimientos: [mov(DEB, "500", "t1")], declaraciones }, DEB, "t1")).toEqual({
      medioDePagoId: DEB,
      cuentaDeCobroId: "t1",
      registrado: valor("500"),
      correcciones: valor("0"),
      declarado: valor("490"),
      estado: "DECLARADO",
      conformePor: null,
      conformeEn: null,
      diferencia: valor("-10"),
    });
  });

  it("la declaración gana sobre el conforme general y sobre lo derivado de los cierres", () => {
    const l = linea(
      {
        movimientos: [mov(QR, "50")],
        declaraciones: [{ ...par(QR), secuencia: 1, importe: valor("50") }],
        conformeGeneral: { por: "p", en: T0 },
        cierres: [conformeDe(QR, "p", T0)],
      },
      QR,
    );
    expect(l).toMatchObject({
      estado: "DECLARADO",
      declarado: valor("50"),
      conformePor: null,
      diferencia: valor("0"),
    });
  });

  it("una declaración sola (sin movimientos) hace nacer la línea", () => {
    const l = conciliarJornada(
      entrada({ declaraciones: [{ ...par(QR), secuencia: 1, importe: valor("30") }] }),
    );
    expect(l).toEqual([
      expect.objectContaining({
        medioDePagoId: QR,
        registrado: valor("0"),
        correcciones: valor("0"),
        declarado: valor("30"),
        diferencia: valor("30"),
      }),
    ]);
  });

  it("(2) sin declaración, el conforme general de la jornada: CONFORME con quién y cuándo, sin diferencia", () => {
    const l = linea(
      {
        movimientos: [mov(QR, "50")],
        conformeGeneral: { por: "p-general", en: T1 },
        cierres: [contado(QR, "49")],
      },
      QR,
    );
    expect(l).toEqual({
      medioDePagoId: QR,
      cuentaDeCobroId: null,
      registrado: valor("50"),
      correcciones: valor("0"),
      declarado: null,
      estado: "CONFORME",
      conformePor: "p-general",
      conformeEn: T1,
      diferencia: null,
    });
  });

  it("(3) derivado de los cierres: todas las cajas contaron → DECLARADO con la suma", () => {
    const l = linea(
      {
        movimientos: [mov(DEB, "300", "t1"), mov(DEB, "200", "t1")],
        cierres: [contado(DEB, "300", "t1"), contado(DEB, "199", "t1")],
      },
      DEB,
      "t1",
    );
    expect(l).toMatchObject({
      estado: "DECLARADO",
      declarado: valor("499"),
      diferencia: valor("-1"),
    });
  });

  it("(3) derivado de los cierres: todas conformes → CONFORME con quién y cuándo del ÚLTIMO", () => {
    const cierres = [
      conformeDe(DEB, "p-a", T0),
      conformeDe(DEB, "p-c", T1),
      conformeDe(DEB, "p-b", T0),
    ];
    expect(linea({ movimientos: [mov(DEB, "10")], cierres }, DEB)).toMatchObject({
      estado: "CONFORME",
      declarado: null,
      conformePor: "p-c",
      conformeEn: T1,
      diferencia: null,
    });
    expect(
      linea(
        {
          movimientos: [mov(DEB, "10")],
          cierres: [conformeDe(DEB, "p-a", T1), conformeDe(DEB, "p-b", T1)],
        },
        DEB,
      ),
    ).toMatchObject({ conformePor: "p-a", conformeEn: T1 });
    expect(
      linea({ movimientos: [mov(DEB, "10")], cierres: [conformeDe(DEB, "p-a", T0)] }, DEB),
    ).toMatchObject({ estado: "CONFORME", conformePor: "p-a" });
  });

  it("(3) mezcla de contadas y conformes → SIN_DATO, sin declarado ni conforme", () => {
    const l = linea(
      { movimientos: [mov(DEB, "10")], cierres: [contado(DEB, "10"), conformeDe(DEB, "p", T0)] },
      DEB,
    );
    expect(l).toEqual({
      ...l,
      estado: "SIN_DATO",
      declarado: null,
      conformePor: null,
      conformeEn: null,
      diferencia: null,
    });
  });

  it("(4) sin nada: SIN_DATO", () => {
    expect(linea({ movimientos: [mov(DEB, "10")] }, DEB)).toMatchObject({
      estado: "SIN_DATO",
      declarado: null,
      diferencia: null,
    });
  });

  it("los cierres de otro par no cuentan", () => {
    expect(
      linea(
        {
          movimientos: [mov(DEB, "10", "t1")],
          cierres: [contado(DEB, "10", "t2"), contado(QR, "10")],
        },
        DEB,
        "t1",
      ).estado,
    ).toBe("SIN_DATO");
  });

  it("las correcciones: +importe en el destino y −importe en el origen, y las dos diferencias dan 0 (crédito → débito)", () => {
    const entradaDelEjemplo = {
      movimientos: [mov(CRE, "18400", "t1"), mov(EF, "100")],
      correcciones: [{ importe: valor("18400"), antes: par(CRE, "t1"), despues: par(DEB, "t1") }],
      declaraciones: [
        { ...par(DEB, "t1"), secuencia: 1, importe: valor("18400") },
        { ...par(CRE, "t1"), secuencia: 1, importe: valor("0") },
      ],
      cierres: [contado(EF, "100")],
    };
    expect(linea(entradaDelEjemplo, CRE, "t1")).toMatchObject({
      registrado: valor("18400"),
      correcciones: valor("-18400"),
      declarado: valor("0"),
      diferencia: valor("0"),
    });
    expect(linea(entradaDelEjemplo, DEB, "t1")).toMatchObject({
      registrado: valor("0"),
      correcciones: valor("18400"),
      declarado: valor("18400"),
      diferencia: valor("0"),
    });
    expect(linea(entradaDelEjemplo, EF)).toMatchObject({ diferencia: valor("0") });
  });

  it("con efectivo: un cobro de 5.000 cargado con débito que era efectivo deja el efectivo sobrando 5.000 y el débito 5.000 por debajo; se corrige igual", () => {
    const base = {
      movimientos: [mov(DEB, "5000"), mov(EF, "100")],
      cierres: [contado(EF, "5100"), contado(DEB, "0")],
    };
    expect(linea(base, EF).diferencia).toEqual(valor("5000"));
    expect(linea(base, DEB).diferencia).toEqual(valor("-5000"));
    const corregida = {
      ...base,
      correcciones: [{ importe: valor("5000"), antes: par(DEB), despues: par(EF) }],
    };
    expect(linea(corregida, EF)).toMatchObject({
      registrado: valor("100"),
      correcciones: valor("5000"),
      diferencia: valor("0"),
    });
    expect(linea(corregida, DEB)).toMatchObject({
      registrado: valor("5000"),
      correcciones: valor("-5000"),
      diferencia: valor("0"),
    });
  });

  it("varias correcciones encadenadas del mismo cobro suman cero en total; un par que solo recibe correcciones nace con registrado 0", () => {
    const lineas = conciliarJornada(
      entrada({
        movimientos: [mov(CRE, "100")],
        correcciones: [
          { importe: valor("100"), antes: par(CRE), despues: par(DEB) },
          { importe: valor("100"), antes: par(DEB), despues: par(QR) },
        ],
      }),
    );
    expect(lineas.map((l) => [l.medioDePagoId, l.registrado, l.correcciones])).toEqual([
      [CRE, valor("100"), valor("-100")],
      [DEB, valor("0"), valor("0")],
      [QR, valor("0"), valor("100")],
    ]);
    expect(lineas.reduce((s, l) => s + l.correcciones.unidades, 0n)).toBe(0n);
  });

  it("con CONFORME la línea muestra «conforme» y no una diferencia, aunque haya correcciones", () => {
    const l = linea(
      {
        movimientos: [mov(DEB, "10")],
        correcciones: [{ importe: valor("10"), antes: par(DEB), despues: par(QR) }],
        conformeGeneral: { por: "p", en: T0 },
      },
      DEB,
    );
    expect(l).toMatchObject({ estado: "CONFORME", correcciones: valor("-10"), diferencia: null });
  });

  it("el cuenta y el «sin cuenta» de un mismo medio son líneas distintas, ordenadas por (medio, cuenta)", () => {
    const lineas = conciliarJornada(
      entrada({
        movimientos: [mov(QR, "1"), mov(DEB, "1", "t2"), mov(DEB, "1"), mov(DEB, "1", "t1")],
      }),
    );
    expect(lineas.map((l) => [l.medioDePagoId, l.cuentaDeCobroId])).toEqual([
      [DEB, "t1"],
      [DEB, "t2"],
      [DEB, null],
      [QR, null],
    ]);
    // Una cuenta con el texto vacío tampoco se confunde con «sin cuenta».
    expect(
      conciliarJornada(entrada({ movimientos: [mov(DEB, "1", ""), mov(DEB, "2", null)] })),
    ).toHaveLength(2);
  });

  it("la Σ en bigint es exacta con centavos", () => {
    const l = linea(
      {
        movimientos: [mov(QR, "0.10"), mov(QR, "0.20")],
        declaraciones: [{ ...par(QR), secuencia: 1, importe: valor("0.30") }],
      },
      QR,
    );
    expect(l).toMatchObject({ registrado: valor("0.30"), diferencia: valor("0") });
  });
});

describe("líneas por explicar (control caja.conciliacion_por_medio)", () => {
  const l = (
    estado: "CONTADO" | "DECLARADO" | "CONFORME" | "SIN_DATO",
    diferencia: string | null,
  ) => ({ estado, diferencia: diferencia === null ? null : valor(diferencia) });
  it("cuentan la diferencia distinta de cero y el SIN_DATO; las conformes y las que cuadran no", () => {
    expect(cantidadDeLineasPorExplicar([])).toBe(0);
    expect(
      cantidadDeLineasPorExplicar([l("CONFORME", null), l("DECLARADO", "0"), l("CONTADO", "0")]),
    ).toBe(0);
    expect(cantidadDeLineasPorExplicar([l("SIN_DATO", null)])).toBe(1);
    expect(cantidadDeLineasPorExplicar([l("CONTADO", "-0.01")])).toBe(1);
    expect(
      cantidadDeLineasPorExplicar([
        l("DECLARADO", "5"),
        l("SIN_DATO", null),
        l("CONFORME", null),
        l("DECLARADO", "0"),
      ]),
    ).toBe(2);
  });
});

describe("lineaPorExplicar: qué línea cuenta y a cuál se le copia la explicación", () => {
  const cero = valor("0.00");
  it("SIN_DATO siempre; contada o declarada solo con diferencia distinta de cero; CONFORME nunca", () => {
    expect(lineaPorExplicar({ estado: "SIN_DATO", diferencia: null })).toBe(true);
    expect(lineaPorExplicar({ estado: "DECLARADO", diferencia: valor("0.01") })).toBe(true);
    expect(lineaPorExplicar({ estado: "CONTADO", diferencia: valor("-0.01") })).toBe(true);
    expect(lineaPorExplicar({ estado: "DECLARADO", diferencia: cero })).toBe(false);
    expect(lineaPorExplicar({ estado: "CONTADO", diferencia: cero })).toBe(false);
    expect(lineaPorExplicar({ estado: "CONFORME", diferencia: null })).toBe(false);
  });
  it("la cantidad es cuántas líneas cumplen", () => {
    expect(
      cantidadDeLineasPorExplicar([
        { estado: "SIN_DATO", diferencia: null },
        { estado: "CONFORME", diferencia: null },
        { estado: "CONTADO", diferencia: valor("5.00") },
        { estado: "DECLARADO", diferencia: cero },
      ]),
    ).toBe(2);
    expect(cantidadDeLineasPorExplicar([])).toBe(0);
  });
});
