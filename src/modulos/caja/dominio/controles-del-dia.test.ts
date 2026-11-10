import { describe, expect, it } from "vitest";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { controlesDelAporte, MAXIMO_DE_REFERENCIAS } from "../../cierre/publico";
import type { LineaDeConciliacion } from "./conciliacion";
import { CONTROLES_DE_CAJA } from "./controles";
import { huellaDeCampos } from "./huella";
import {
  controlesDeCaja,
  explicacionDelReconocimiento,
  hayMovimientoDeCaja,
  impedimentosDeCaja,
  referenciaDelPar,
  type AjusteParaControles,
  type CorreccionParaControles,
  type DatosParaLosControles,
  type SesionParaControles,
} from "./controles-del-dia";

const v = (texto: string): Importe => importeDesdeTexto(ARS, texto);
const EF = "ef";
const DEB = "deb";
const CRE = "cre";
const T0 = new Date("2026-11-10T20:00:00Z");

const sesion = (
  id: string,
  estado: SesionParaControles["estado"] = "CERRADA",
  diferencias: (string | null)[] = [],
): SesionParaControles => ({
  id,
  estado,
  arqueo: diferencias.map((d, i) => ({
    medioDePagoId: i === 0 ? EF : DEB,
    cuentaDeCobroId: null,
    diferencia: d === null ? null : v(d),
  })),
});

const linea = (cambios: Partial<LineaDeConciliacion> = {}): LineaDeConciliacion => ({
  medioDePagoId: DEB,
  cuentaDeCobroId: null,
  registrado: v("100.00"),
  correcciones: v("0.00"),
  declarado: v("100.00"),
  estado: "DECLARADO",
  conformePor: null,
  conformeEn: null,
  diferencia: v("0.00"),
  ...cambios,
});

const vacio: DatosParaLosControles = {
  sesiones: [],
  conciliacion: [],
  diferenciasDeTicket: [],
  correcciones: [],
  ajustes: [],
};

const porClave = (datos: DatosParaLosControles, clave: string) => {
  const control = controlesDeCaja(datos).find((c) => c.clave === clave);
  if (control === undefined) throw new Error(`falta ${clave}`);
  return control;
};

const origen = (id: string, cobrado: string, total: string) => ({
  origen: { tipo: "ventas.cobranza_de_ticket", id },
  ticketId: `t-${id}`,
  cobrado: v(cobrado),
  totalDelTicket: v(total),
  diferencia: v((Number(cobrado) - Number(total)).toFixed(2)),
});

const correccion = (id: string, cobroId = `c-${id}`, secuencia = 1): CorreccionParaControles => ({
  id,
  cobroId,
  secuencia,
  importe: v("18400.00"),
  antes: { medioDePagoId: CRE, cuentaDeCobroId: null },
  despues: { medioDePagoId: DEB, cuentaDeCobroId: "t1" },
});

const ajuste = (id: string, corrigeJornada = "2026-11-08"): AjusteParaControles => ({
  id,
  corrigeJornada,
  importe: v("-250.00"),
  medioDePagoId: EF,
  cuentaDeCobroId: null,
});

describe("los controles de caja con datos ya leídos (e3b §4.2)", () => {
  it("sin nada que revisar son los seis, en el orden de CONTROLES_DE_CAJA, con cantidad 0 y el contrato de `cierre`", () => {
    const controles = controlesDeCaja(vacio);
    expect(controles.map((c) => [c.modulo, c.clave, c.severidad, c.cantidad])).toEqual(
      Object.values(CONTROLES_DE_CAJA).map((d) => ["caja", d.clave, d.severidad, 0]),
    );
    expect(controles.every((c) => c.referencias.length === 0)).toBe(true);
    expect(controlesDelAporte("caja", controles).ok).toBe(true);
    for (const c of controles) expect(c.huellaDelDetalle).toMatch(/^[0-9a-f]{64}$/);
  });

  it("la huella del detalle depende de la clave del control: dos controles vacíos no coinciden", () => {
    const huellas = new Set(controlesDeCaja(vacio).map((c) => c.huellaDelDetalle));
    expect(huellas.size).toBe(6);
  });

  it("sesiones sin cerrar: cuenta las que no están CERRADA (abierta y en cierre) y sus referencias son los ids", () => {
    const datos = {
      ...vacio,
      sesiones: [sesion("s2", "ABIERTA"), sesion("s1", "EN_CIERRE"), sesion("s3", "CERRADA")],
    };
    const control = porClave(datos, "caja.sesiones_sin_cerrar");
    expect(control.cantidad).toBe(2);
    expect(control.referencias).toEqual(["s1", "s2"]);
    expect(control.severidad).toBe("BLOQUEA");
    expect(
      porClave({ ...vacio, sesiones: [sesion("s3")] }, "caja.sesiones_sin_cerrar").cantidad,
    ).toBe(0);
  });

  it("los impedimentos son ese mismo control y nada más", () => {
    const sesiones = [sesion("s1", "ABIERTA"), sesion("s2")];
    const impedimentos = impedimentosDeCaja(sesiones);
    expect(impedimentos).toHaveLength(1);
    expect(impedimentos[0]).toEqual(porClave({ ...vacio, sesiones }, "caja.sesiones_sin_cerrar"));
    expect(impedimentosDeCaja([])[0]?.cantidad).toBe(0);
  });

  it("diferencia de arqueo: cuenta SESIONES (no líneas) con alguna línea de diferencia distinta de cero", () => {
    const datos = {
      ...vacio,
      sesiones: [
        sesion("s1", "CERRADA", ["-5.00", "7.00"]),
        sesion("s2", "CERRADA", ["0.00", null]),
        sesion("s3", "CERRADA", ["0.01"]),
        sesion("s4", "CERRADA", []),
      ],
    };
    const control = porClave(datos, "caja.diferencia_de_arqueo");
    expect(control.cantidad).toBe(2);
    expect(control.referencias).toEqual(["s1", "s3"]);
    expect(control.severidad).toBe("RECONOCIBLE");
  });

  it("la huella del detalle del arqueo cambia con el importe de la diferencia y con la línea", () => {
    const con = (d: string) =>
      porClave({ ...vacio, sesiones: [sesion("s1", "CERRADA", [d])] }, "caja.diferencia_de_arqueo");
    expect(con("-5.00").huellaDelDetalle).not.toBe(con("-6.00").huellaDelDetalle);
    expect(con("-5.00").huellaDelDetalle).toBe(con("-5.00").huellaDelDetalle);
    expect(con("-5.00").huellaDelDetalle).not.toBe(
      porClave(
        { ...vacio, sesiones: [sesion("s9", "CERRADA", ["-5.00"])] },
        "caja.diferencia_de_arqueo",
      ).huellaDelDetalle,
    );
  });

  it("conciliación por medio: cuenta las líneas por explicar (con diferencia o sin dato), no las conformes ni las que cuadran", () => {
    const datos = {
      ...vacio,
      conciliacion: [
        linea({ medioDePagoId: EF, estado: "CONTADO" }),
        linea({ medioDePagoId: DEB, declarado: v("120.00"), diferencia: v("20.00") }),
        linea({ medioDePagoId: CRE, declarado: null, estado: "SIN_DATO", diferencia: null }),
        linea({
          medioDePagoId: "qr",
          declarado: null,
          estado: "CONFORME",
          diferencia: null,
          conformePor: "p1",
          conformeEn: T0,
        }),
      ],
    };
    const control = porClave(datos, "caja.conciliacion_por_medio");
    expect(control.cantidad).toBe(2);
    expect(control.severidad).toBe("RECONOCIBLE");
    expect(control.referencias).toEqual([`${CRE}/sin_cuenta`, `${DEB}/sin_cuenta`]);
  });

  it("el detalle de la conciliación es TODA la conciliación: una línea conforme que cambia cambia la huella, no la cantidad", () => {
    const conforme = (registrado: string) =>
      linea({
        medioDePagoId: "qr",
        registrado: v(registrado),
        declarado: null,
        estado: "CONFORME",
        diferencia: null,
        conformePor: "p1",
        conformeEn: T0,
      });
    const a = porClave(
      { ...vacio, conciliacion: [conforme("10.00")] },
      "caja.conciliacion_por_medio",
    );
    const b = porClave(
      { ...vacio, conciliacion: [conforme("11.00")] },
      "caja.conciliacion_por_medio",
    );
    expect(a.cantidad).toBe(0);
    expect(b.cantidad).toBe(0);
    expect(a.huellaDelDetalle).not.toBe(b.huellaDelDetalle);
  });

  it("cada campo de una línea de la conciliación entra en la huella", () => {
    const base = linea({ conformePor: null, conformeEn: null });
    const huella = (l: LineaDeConciliacion) =>
      porClave({ ...vacio, conciliacion: [l] }, "caja.conciliacion_por_medio").huellaDelDetalle;
    const cambios: Partial<LineaDeConciliacion>[] = [
      { medioDePagoId: CRE },
      { cuentaDeCobroId: "t1" },
      { estado: "CONTADO" },
      { registrado: v("101.00") },
      { correcciones: v("1.00") },
      { declarado: v("99.00") },
      { declarado: null },
      { diferencia: v("1.00") },
      { diferencia: null },
      { conformePor: "p2" },
      { conformeEn: T0 },
    ];
    for (const cambio of cambios) expect(huella({ ...base, ...cambio })).not.toBe(huella(base));
    // La hora del conforme distingue dos conformes.
    expect(huella({ ...base, conformeEn: new Date(T0.getTime() + 1) })).not.toBe(
      huella({ ...base, conformeEn: T0 }),
    );
  });

  it("cobrado contra ticket: una por origen con diferencia, con los ids de los orígenes como referencia", () => {
    const datos = {
      ...vacio,
      diferenciasDeTicket: [origen("o2", "10000.00", "8000.00"), origen("o1", "500.00", "0.00")],
    };
    const control = porClave(datos, "caja.cobrado_contra_ticket");
    expect(control.cantidad).toBe(2);
    expect(control.severidad).toBe("RECONOCIBLE");
    expect(control.referencias).toEqual(["o1", "o2"]);
    const otra = porClave(
      {
        ...vacio,
        diferenciasDeTicket: [origen("o2", "10000.00", "7000.00"), origen("o1", "500.00", "0.00")],
      },
      "caja.cobrado_contra_ticket",
    );
    expect(otra.huellaDelDetalle).not.toBe(control.huellaDelDetalle);
  });

  it("cobros corregidos: una por corrección; informa y la referencia es el cobro", () => {
    const datos = { ...vacio, correcciones: [correccion("k2", "c2"), correccion("k1", "c1")] };
    const control = porClave(datos, "caja.cobros_corregidos");
    expect(control.cantidad).toBe(2);
    expect(control.severidad).toBe("INFORMA");
    expect(control.referencias).toEqual(["c1", "c2"]);
    const huella = (c: CorreccionParaControles) =>
      porClave({ ...vacio, correcciones: [c] }, "caja.cobros_corregidos").huellaDelDetalle;
    const base = correccion("k1");
    const cambios = [
      { ...base, id: "k9" },
      { ...base, cobroId: "otro" },
      { ...base, secuencia: 2 },
      { ...base, importe: v("1.00") },
      { ...base, antes: { medioDePagoId: EF, cuentaDeCobroId: null } },
      { ...base, antes: { medioDePagoId: CRE, cuentaDeCobroId: "t9" } },
      { ...base, despues: { medioDePagoId: EF, cuentaDeCobroId: "t1" } },
      { ...base, despues: { medioDePagoId: DEB, cuentaDeCobroId: null } },
    ];
    for (const c of cambios) expect(huella(c)).not.toBe(huella(base));
  });

  it("ajustes a jornadas cerradas: uno por ajuste; informa y la referencia es el movimiento", () => {
    const datos = { ...vacio, ajustes: [ajuste("a2"), ajuste("a1", "2026-11-07")] };
    const control = porClave(datos, "caja.ajustes_a_jornadas_cerradas");
    expect(control.cantidad).toBe(2);
    expect(control.severidad).toBe("INFORMA");
    expect(control.referencias).toEqual(["a1", "a2"]);
    const huella = (a: AjusteParaControles) =>
      porClave({ ...vacio, ajustes: [a] }, "caja.ajustes_a_jornadas_cerradas").huellaDelDetalle;
    const base = ajuste("a1");
    const cambios = [
      { ...base, id: "a9" },
      { ...base, corrigeJornada: "2026-11-01" },
      { ...base, importe: v("-251.00") },
      { ...base, medioDePagoId: DEB },
      { ...base, cuentaDeCobroId: "t1" },
    ];
    for (const a of cambios) expect(huella(a)).not.toBe(huella(base));
  });

  it("es determinista: con los mismos datos, en cualquier orden de llegada, el mismo resultado", () => {
    const datos: DatosParaLosControles = {
      sesiones: [
        sesion("s1", "ABIERTA"),
        sesion("s2", "CERRADA", ["1.00"]),
        sesion("s3", "EN_CIERRE"),
      ],
      conciliacion: [
        linea({ medioDePagoId: CRE, diferencia: v("3.00"), declarado: v("103.00") }),
        linea({ medioDePagoId: DEB }),
        linea({ medioDePagoId: EF, estado: "CONTADO" }),
      ],
      diferenciasDeTicket: [origen("o1", "10.00", "5.00"), origen("o2", "20.00", "0.00")],
      correcciones: [correccion("k1"), correccion("k2"), correccion("k3")],
      ajustes: [ajuste("a1"), ajuste("a2")],
    };
    const alReves: DatosParaLosControles = {
      sesiones: [...datos.sesiones].reverse(),
      conciliacion: [...datos.conciliacion].reverse(),
      diferenciasDeTicket: [...datos.diferenciasDeTicket].reverse(),
      correcciones: [...datos.correcciones].reverse(),
      ajustes: [...datos.ajustes].reverse(),
    };
    expect(controlesDeCaja(alReves)).toEqual(controlesDeCaja(datos));
    expect(controlesDeCaja(datos)).toEqual(controlesDeCaja(datos));
  });

  it("las referencias se acotan a MAXIMO_DE_REFERENCIAS, ordenadas y sin repetir; la cantidad sigue siendo la real", () => {
    const muchas = Array.from({ length: MAXIMO_DE_REFERENCIAS + 20 }, (_, i) =>
      correccion(`k${i}`, `c${String(i).padStart(3, "0")}`),
    );
    const control = porClave({ ...vacio, correcciones: muchas }, "caja.cobros_corregidos");
    expect(control.cantidad).toBe(MAXIMO_DE_REFERENCIAS + 20);
    expect(control.referencias).toHaveLength(MAXIMO_DE_REFERENCIAS);
    expect(control.referencias).toEqual([...control.referencias].sort());
    // Dos correcciones del mismo cobro: una referencia, dos hallazgos.
    const repetidas = porClave(
      { ...vacio, correcciones: [correccion("k1", "c1", 1), correccion("k2", "c1", 2)] },
      "caja.cobros_corregidos",
    );
    expect(repetidas.cantidad).toBe(2);
    expect(repetidas.referencias).toEqual(["c1"]);
    expect(controlesDelAporte("caja", controlesDeCaja({ ...vacio, correcciones: muchas })).ok).toBe(
      true,
    );
  });

  it("la referencia de un par es el medio y la cuenta, o «sin_cuenta»", () => {
    expect(referenciaDelPar({ medioDePagoId: "m", cuentaDeCobroId: null })).toBe("m/sin_cuenta");
    expect(referenciaDelPar({ medioDePagoId: "m", cuentaDeCobroId: "c" })).toBe("m/c");
  });
});

describe("el detalle que entra en la huella de cada control (la fórmula, fijada fila por fila)", () => {
  /** La huella esperada: la clave y las filas del detalle, cada una como texto y ordenadas por ese texto. */
  const esperada = (clave: string, filas: readonly unknown[][]) =>
    huellaDeCampos([clave, JSON.stringify(filas.map((fila) => JSON.stringify(fila)).sort())]);

  it("sesiones sin cerrar: [id, estado] de las que no están cerradas, ordenadas", () => {
    const control = porClave(
      { ...vacio, sesiones: [sesion("s2", "ABIERTA"), sesion("s3"), sesion("s1", "EN_CIERRE")] },
      "caja.sesiones_sin_cerrar",
    );
    expect(control.huellaDelDetalle).toBe(
      esperada("caja.sesiones_sin_cerrar", [
        ["s1", "EN_CIERRE"],
        ["s2", "ABIERTA"],
      ]),
    );
  });

  it("diferencia de arqueo: [sesión, medio, cuenta, diferencia] solo de las líneas con diferencia distinta de cero", () => {
    const control = porClave(
      {
        ...vacio,
        sesiones: [
          sesion("s2", "CERRADA", ["0.00", "3.00"]),
          sesion("s1", "CERRADA", ["-5.00", "7.00"]),
          sesion("s3", "CERRADA", [null, "0.00"]),
          // Una línea sin diferencia (conforme) al lado de otra con diferencia: la conforme no entra al detalle.
          sesion("s4", "CERRADA", [null, "2.00"]),
        ],
      },
      "caja.diferencia_de_arqueo",
    );
    expect(control.huellaDelDetalle).toBe(
      esperada("caja.diferencia_de_arqueo", [
        ["s1", EF, null, "-5.00"],
        ["s1", DEB, null, "7.00"],
        ["s2", DEB, null, "3.00"],
        ["s4", DEB, null, "2.00"],
      ]),
    );
    expect(control.cantidad).toBe(3);
  });

  it("conciliación: toda línea, con sus importes y el conforme con quién y cuándo (ISO)", () => {
    const control = porClave(
      {
        ...vacio,
        conciliacion: [
          linea({ medioDePagoId: EF, cuentaDeCobroId: null, estado: "CONTADO" }),
          linea({
            medioDePagoId: DEB,
            cuentaDeCobroId: "t1",
            registrado: v("5.00"),
            correcciones: v("-1.00"),
            declarado: null,
            estado: "CONFORME",
            diferencia: null,
            conformePor: "p1",
            conformeEn: T0,
          }),
        ],
      },
      "caja.conciliacion_por_medio",
    );
    expect(control.huellaDelDetalle).toBe(
      esperada("caja.conciliacion_por_medio", [
        [EF, null, "CONTADO", "100.00", "0.00", "100.00", "0.00", null, null],
        [DEB, "t1", "CONFORME", "5.00", "-1.00", null, null, "p1", "2026-11-10T20:00:00.000Z"],
      ]),
    );
    expect(control.cantidad).toBe(0);
  });

  it("cobrado contra ticket, cobros corregidos y ajustes: cada fila con sus campos", () => {
    const datos: DatosParaLosControles = {
      ...vacio,
      diferenciasDeTicket: [origen("o1", "10.00", "4.00")],
      correcciones: [correccion("k1", "c1", 2)],
      ajustes: [ajuste("a1", "2026-11-07")],
    };
    expect(porClave(datos, "caja.cobrado_contra_ticket").huellaDelDetalle).toBe(
      esperada("caja.cobrado_contra_ticket", [
        ["ventas.cobranza_de_ticket", "o1", "t-o1", "10.00", "4.00", "6.00"],
      ]),
    );
    expect(porClave(datos, "caja.cobros_corregidos").huellaDelDetalle).toBe(
      esperada("caja.cobros_corregidos", [["k1", "c1", 2, "18400.00", CRE, null, DEB, "t1"]]),
    );
    expect(porClave(datos, "caja.ajustes_a_jornadas_cerradas").huellaDelDetalle).toBe(
      esperada("caja.ajustes_a_jornadas_cerradas", [["a1", "2026-11-07", "-250.00", EF, null]]),
    );
  });
});

describe("la explicación opcional de un reconocimiento (decisión 160)", () => {
  const reconocidos = [
    { clave: "caja.conciliacion_por_medio", texto: "Se descontó la propina" },
    { clave: "caja.cobrado_contra_ticket", texto: null },
  ];
  it("es el texto del control reconocido; sin texto o sin reconocer, null", () => {
    expect(
      explicacionDelReconocimiento(reconocidos, CONTROLES_DE_CAJA.CONCILIACION_POR_MEDIO),
    ).toBe("Se descontó la propina");
    expect(
      explicacionDelReconocimiento(reconocidos, CONTROLES_DE_CAJA.COBRADO_CONTRA_TICKET),
    ).toBeNull();
    expect(
      explicacionDelReconocimiento(reconocidos, CONTROLES_DE_CAJA.DIFERENCIA_DE_ARQUEO),
    ).toBeNull();
    expect(explicacionDelReconocimiento([], CONTROLES_DE_CAJA.CONCILIACION_POR_MEDIO)).toBeNull();
  });
});

describe("¿caja tiene movimiento en la jornada? (decisión 178)", () => {
  it("sin sesiones no hay movimiento; con una sesión, del estado que sea, sí", () => {
    expect(hayMovimientoDeCaja([])).toBe(false);
    expect(hayMovimientoDeCaja([sesion("s1", "ABIERTA")])).toBe(true);
    expect(hayMovimientoDeCaja([sesion("s1", "CERRADA"), sesion("s2", "CERRADA")])).toBe(true);
  });
});
