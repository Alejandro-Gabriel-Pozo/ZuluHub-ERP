import { alicuotaQueEntraAlCosto } from "./iva-en-el-costo";
import { porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import { describe, expect, it } from "vitest";
import {
  ALICUOTAS_DE_COMPRA,
  FICHA_DE_TIPO_DE_COMPROBANTE,
  LARGO_MAXIMO_DE_LA_DESCRIPCION_DE_TRIBUTO,
  TIPOS_DE_TRIBUTO,
  TIPOS_DE_COMPROBANTE_DE_PROVEEDOR,
  TOLERANCIA_DEL_TOTAL_EN_CENTAVOS,
  calcularComprobante,
  claseDeTipoDeComprobante,
  esAlicuotaDeCompra,
  esLetraNoEsperada,
  esNumeroDeComprobanteValido,
  esPuntoDeVentaValido,
  CONDICIONES_DE_IVA_DE_LA_EMPRESA,
  discriminaIva,
  esTipoDeComprobanteDeProveedor,
  porcentajeDeAlicuota,
  letraEsperadaDesdeCondicion,
  totalCoincide,
  type EntradaDeComprobante,
} from "./comprobante";

const linea = (cantidadFacturada: string, precioNeto: string, alicuota: string | null) => ({
  cantidadFacturada,
  precioNeto,
  alicuota,
});
const A = (
  lineas: EntradaDeComprobante["lineas"],
  extra: Partial<EntradaDeComprobante> = {},
): EntradaDeComprobante => ({
  tipo: "FACTURA_A",
  lineas,
  totalSegunFactura: "0.00",
  condicionDeLaEmpresa: "RESPONSABLE_INSCRIPTO",
  ...extra,
});
const valor = (e: EntradaDeComprobante) => {
  const r = calcularComprobante(e);
  if (!r.ok) throw new Error(r.error);
  return r.valor;
};
const error = (e: EntradaDeComprobante) => {
  const r = calcularComprobante(e);
  return r.ok ? null : r.error;
};

describe("catálogos", () => {
  it("los nueve tipos con letra, clase y código de ARCA", () => {
    expect(
      TIPOS_DE_COMPROBANTE_DE_PROVEEDOR.map((t) => [t, FICHA_DE_TIPO_DE_COMPROBANTE[t]]),
    ).toEqual([
      ["FACTURA_A", { letra: "A", clase: "FACTURA", codigo: 1 }],
      ["FACTURA_B", { letra: "B", clase: "FACTURA", codigo: 6 }],
      ["FACTURA_C", { letra: "C", clase: "FACTURA", codigo: 11 }],
      ["NOTA_DEBITO_A", { letra: "A", clase: "NOTA_DE_DEBITO", codigo: 2 }],
      ["NOTA_DEBITO_B", { letra: "B", clase: "NOTA_DE_DEBITO", codigo: 7 }],
      ["NOTA_DEBITO_C", { letra: "C", clase: "NOTA_DE_DEBITO", codigo: 12 }],
      ["NOTA_CREDITO_A", { letra: "A", clase: "NOTA_DE_CREDITO", codigo: 3 }],
      ["NOTA_CREDITO_B", { letra: "B", clase: "NOTA_DE_CREDITO", codigo: 8 }],
      ["NOTA_CREDITO_C", { letra: "C", clase: "NOTA_DE_CREDITO", codigo: 13 }],
    ]);
    expect(claseDeTipoDeComprobante("NOTA_CREDITO_B")).toBe("NOTA_DE_CREDITO");
    expect(esTipoDeComprobanteDeProveedor("FACTURA_A")).toBe(true);
    expect(esTipoDeComprobanteDeProveedor("FACTURA_M")).toBe(false);
    expect(esTipoDeComprobanteDeProveedor("")).toBe(false);
  });

  it("las ocho alícuotas", () => {
    expect([...ALICUOTAS_DE_COMPRA]).toEqual([
      "0",
      "2.5",
      "5",
      "10.5",
      "21",
      "27",
      "EXENTO",
      "NO_GRAVADO",
    ]);
    for (const a of ALICUOTAS_DE_COMPRA) expect(esAlicuotaDeCompra(a)).toBe(true);
    for (const a of ["", "12", "21.0", "exento"]) expect(esAlicuotaDeCompra(a)).toBe(false);
  });

  it("los tipos de tributo", () => {
    expect([...TIPOS_DE_TRIBUTO]).toEqual([
      "PERCEPCION_IVA",
      "PERCEPCION_OTROS_NACIONALES",
      "PERCEPCION_INGRESOS_BRUTOS",
      "PERCEPCION_MUNICIPAL",
      "IMPUESTO_INTERNO",
      "OTRO_TRIBUTO",
      "PERCEPCION_SIN_CLASIFICAR",
    ]);
    expect(LARGO_MAXIMO_DE_LA_DESCRIPCION_DE_TRIBUTO).toBe(80);
    expect(TOLERANCIA_DEL_TOTAL_EN_CENTAVOS).toBe(1n);
  });

  it("punto de venta de 1 a 99998 y número de 1 a 99999999, enteros", () => {
    for (const n of [1, 99998]) expect(esPuntoDeVentaValido(n)).toBe(true);
    for (const n of [0, 99999, -1, 1.5, Number.NaN])
      expect(esPuntoDeVentaValido(n), String(n)).toBe(false);
    for (const n of [1, 99999999]) expect(esNumeroDeComprobanteValido(n)).toBe(true);
    for (const n of [0, 100000000, -1, 2.5, Number.NaN])
      expect(esNumeroDeComprobanteValido(n), String(n)).toBe(false);
  });
});

describe("letra esperada (D110, S-15)", () => {
  it("inscripto A, monotributo C, el resto a mano", () => {
    expect(letraEsperadaDesdeCondicion("RESPONSABLE_INSCRIPTO")).toBe("A");
    expect(letraEsperadaDesdeCondicion("MONOTRIBUTO")).toBe("C");
    for (const c of [
      "EXENTO",
      "CONSUMIDOR_FINAL",
      "MONOTRIBUTISTA_SOCIAL",
      "NO_CATEGORIZADO",
      null,
    ] as const) {
      expect(letraEsperadaDesdeCondicion(c), String(c)).toBeNull();
    }
  });
  it("avisa solo si hay una esperada y la letra es otra", () => {
    expect(esLetraNoEsperada("A", "FACTURA_B")).toBe(true);
    expect(esLetraNoEsperada("A", "NOTA_CREDITO_A")).toBe(false);
    expect(esLetraNoEsperada("C", "FACTURA_C")).toBe(false);
    expect(esLetraNoEsperada(null, "FACTURA_B")).toBe(false);
  });
});

describe("totalCoincide: tolerancia de un centavo", () => {
  it("hasta 0,01 de diferencia en cualquier sentido", () => {
    expect(totalCoincide(1000n, 1000n)).toBe(true);
    expect(totalCoincide(1000n, 1001n)).toBe(true);
    expect(totalCoincide(1001n, 1000n)).toBe(true);
    expect(totalCoincide(1000n, 1002n)).toBe(false);
    expect(totalCoincide(1002n, 1000n)).toBe(false);
  });
});

describe("calcularComprobante: Factura A", () => {
  it("neto, IVA por línea, por alícuota, crédito fiscal y total", () => {
    const r = valor(
      A(
        [
          linea("10", "100", "21"),
          linea("2", "50.5", "21"),
          linea("1", "300", "10.5"),
          linea("1", "20", "EXENTO"),
          linea("1", "30", "NO_GRAVADO"),
        ],
        { totalSegunFactura: "1745.71" },
      ),
    );
    expect(r.lineas).toEqual([
      { netoDeLinea: "1000.00", ivaDeLinea: "210.00", alicuota: "21" },
      { netoDeLinea: "101.00", ivaDeLinea: "21.21", alicuota: "21" },
      { netoDeLinea: "300.00", ivaDeLinea: "31.50", alicuota: "10.5" },
      { netoDeLinea: "20.00", ivaDeLinea: "0.00", alicuota: "EXENTO" },
      { netoDeLinea: "30.00", ivaDeLinea: "0.00", alicuota: "NO_GRAVADO" },
    ]);
    expect(r.importesPorAlicuota).toEqual([
      { alicuota: "10.5", neto: "300.00", iva: "31.50" },
      { alicuota: "21", neto: "1101.00", iva: "231.21" },
      { alicuota: "EXENTO", neto: "20.00", iva: "0.00" },
      { alicuota: "NO_GRAVADO", neto: "30.00", iva: "0.00" },
    ]);
    expect(r).toMatchObject({
      tipo: "FACTURA_A",
      netoGravado: "1401.00",
      noGravado: "30.00",
      exento: "20.00",
      iva: "262.71",
      tributosTotal: "0.00",
      creditoFiscalComputable: "262.71",
      totalCalculado: "1713.71",
      totalSegunFactura: "1745.71",
      totalCoincide: false,
    });
  });

  it("alícuota 0: gravada al 0 %, entra al neto gravado sin IVA", () => {
    expect(valor(A([linea("1", "10", "0")]))).toMatchObject({
      netoGravado: "10.00",
      iva: "0.00",
      totalCalculado: "10.00",
    });
  });

  it("el IVA se redondea por línea, la mitad se aleja del cero", () => {
    // 0,05 × 5 % = 0,0025 → 0,00 por línea: dos líneas no suman 0,01 aunque juntas (0,10 × 5 % = 0,005) sí lo harían
    expect(valor(A([linea("1", "0.05", "5"), linea("1", "0.05", "5")])).iva).toBe("0.00");
    expect(valor(A([linea("1", "0.10", "5")])).iva).toBe("0.01");
    expect(valor(A([linea("1", "0.10", "5"), linea("1", "0.10", "5")])).iva).toBe("0.02");
    expect(valor(A([linea("1", "0.09", "5")])).iva).toBe("0.00");
    expect(valor(A([linea("1", "0.05", "10.5")])).iva).toBe("0.01");
  });

  it("el neto de la línea se redondea una vez", () => {
    expect(valor(A([linea("3", "0.335", "21")])).lineas[0]?.netoDeLinea).toBe("1.01");
    expect(valor(A([linea("1", "0.004999", "21")])).lineas[0]?.netoDeLinea).toBe("0.00");
  });

  it("los tributos suman al total y la lista queda ordenada tal cual", () => {
    const con = valor(
      A([linea("1", "100", "21")], {
        tributos: [
          {
            tipo: "PERCEPCION_INGRESOS_BRUTOS",
            importe: "3.00",
            baseImponible: "100.00",
            alicuota: "3",
          },
          { tipo: "OTRO_TRIBUTO", descripcion: "Tasa  municipal", importe: "1.50" },
          { tipo: "PERCEPCION_SIN_CLASIFICAR", importe: "0.25" },
        ],
        totalSegunFactura: "125.75",
      }),
    );
    expect(con.tributosTotal).toBe("4.75");
    expect(con.totalCalculado).toBe("125.75");
    expect(con.totalCoincide).toBe(true);
    expect(con.tributos).toEqual([
      {
        tipo: "PERCEPCION_INGRESOS_BRUTOS",
        descripcion: null,
        baseImponible: "100.00",
        alicuota: "3",
        importe: "3.00",
      },
      {
        tipo: "OTRO_TRIBUTO",
        descripcion: "Tasa municipal",
        baseImponible: null,
        alicuota: null,
        importe: "1.50",
      },
      {
        tipo: "PERCEPCION_SIN_CLASIFICAR",
        descripcion: null,
        baseImponible: null,
        alicuota: null,
        importe: "0.25",
      },
    ]);
    // el crédito fiscal es el IVA, aparte de los tributos
    expect(con.creditoFiscalComputable).toBe("21.00");
  });

  it("los dos totales se devuelven siempre y coincide con tolerancia de un centavo", () => {
    expect(valor(A([linea("1", "100", "21")], { totalSegunFactura: "121.01" })).totalCoincide).toBe(
      true,
    );
    expect(valor(A([linea("1", "100", "21")], { totalSegunFactura: "120.99" })).totalCoincide).toBe(
      true,
    );
    expect(valor(A([linea("1", "100", "21")], { totalSegunFactura: "121.02" })).totalCoincide).toBe(
      false,
    );
    expect(valor(A([linea("1", "100", "21")], { totalSegunFactura: "120.98" })).totalCoincide).toBe(
      false,
    );
  });
});

describe("calcularComprobante: B y C no discriminan IVA", () => {
  it("el importe de la línea es el neto, sin alícuota, sin IVA y sin crédito fiscal", () => {
    for (const tipo of ["FACTURA_B", "FACTURA_C", "NOTA_CREDITO_B", "NOTA_DEBITO_C"]) {
      const r = valor({
        tipo,
        lineas: [linea("2", "50", null)],
        totalSegunFactura: "100.00",
        condicionDeLaEmpresa: "RESPONSABLE_INSCRIPTO",
      });
      expect(r).toMatchObject({
        netoGravado: "100.00",
        iva: "0.00",
        noGravado: "0.00",
        exento: "0.00",
        creditoFiscalComputable: "0.00",
        totalCalculado: "100.00",
        totalCoincide: true,
      });
      expect(r.importesPorAlicuota).toEqual([]);
      expect(r.lineas).toEqual([{ netoDeLinea: "100.00", ivaDeLinea: "0.00", alicuota: null }]);
    }
  });
  it("una alícuota en B o C se rechaza", () => {
    expect(
      error({
        tipo: "FACTURA_B",
        lineas: [linea("1", "1", "21")],
        totalSegunFactura: "1.00",
        condicionDeLaEmpresa: "RESPONSABLE_INSCRIPTO",
      }),
    ).toBe("ALICUOTA_NO_DISCRIMINADA");
  });
});

describe("calcularComprobante: crédito fiscal y notas", () => {
  it("solo la Factura A computa; las notas A no (regla inicial, PC-4)", () => {
    for (const tipo of ["NOTA_CREDITO_A", "NOTA_DEBITO_A"]) {
      const r = valor({
        tipo,
        lineas: [linea("1", "100", "21")],
        totalSegunFactura: "121.00",
        condicionDeLaEmpresa: "RESPONSABLE_INSCRIPTO",
      });
      expect(r.creditoFiscalComputable).toBe("0.00");
      expect(r.iva).toBe("21.00");
    }
  });
});

describe("calcularComprobante: errores, en orden", () => {
  it("tipo", () => {
    expect(
      error({
        tipo: "FACTURA_M",
        lineas: [],
        totalSegunFactura: "x",
        condicionDeLaEmpresa: "RESPONSABLE_INSCRIPTO",
      }),
    ).toBe("TIPO_DE_COMPROBANTE_INVALIDO");
  });
  it("sin líneas", () => {
    expect(error(A([], { totalSegunFactura: "x" }))).toBe("LINEAS_REQUERIDAS");
  });
  it("cantidad y precio de cada línea: mayores que cero", () => {
    for (const c of ["0", "-1", "x", "1.00001"])
      expect(error(A([linea(c, "1", "21")])), c).toBe("CANTIDAD_INVALIDA");
    for (const p of ["0", "-1", "x", "1.1234567"])
      expect(error(A([linea("1", p, "21")])), p).toBe("PRECIO_INVALIDO");
  });
  it("alícuota requerida en A e inválida", () => {
    expect(error(A([linea("1", "1", null)]))).toBe("ALICUOTA_REQUERIDA");
    expect(error(A([linea("1", "1", "12")]))).toBe("ALICUOTA_INVALIDA");
  });
  it("tributo inválido: tipo, importe, descripción, base y alícuota", () => {
    const t = (tributo: object) =>
      error(A([linea("1", "1", "21")], { tributos: [tributo as never] }));
    expect(t({ tipo: "OTRA", importe: "1" })).toBe("TRIBUTO_INVALIDO");
    expect(t({ tipo: "PERCEPCION_IVA", importe: "-1" })).toBe("TRIBUTO_INVALIDO");
    expect(t({ tipo: "PERCEPCION_IVA", importe: "x" })).toBe("TRIBUTO_INVALIDO");
    expect(t({ tipo: "OTRO_TRIBUTO", importe: "1" })).toBe("TRIBUTO_INVALIDO");
    expect(t({ tipo: "OTRO_TRIBUTO", importe: "1", descripcion: "  " })).toBe("TRIBUTO_INVALIDO");
    expect(t({ tipo: "OTRO_TRIBUTO", importe: "1", descripcion: "<x>" })).toBe("TRIBUTO_INVALIDO");
    expect(t({ tipo: "PERCEPCION_IVA", importe: "1", descripcion: "<x>" })).toBe(
      "TRIBUTO_INVALIDO",
    );
    expect(t({ tipo: "OTRO_TRIBUTO", importe: "1", descripcion: "a".repeat(81) })).toBe(
      "TRIBUTO_INVALIDO",
    );
    expect(t({ tipo: "OTRO_TRIBUTO", importe: "1", descripcion: "a".repeat(80) })).toBeNull();
    expect(t({ tipo: "PERCEPCION_IVA", importe: "1", baseImponible: "-1" })).toBe(
      "TRIBUTO_INVALIDO",
    );
    expect(t({ tipo: "PERCEPCION_IVA", importe: "1", baseImponible: "x" })).toBe(
      "TRIBUTO_INVALIDO",
    );
    expect(t({ tipo: "PERCEPCION_IVA", importe: "1", baseImponible: "0" })).toBeNull();
    expect(t({ tipo: "PERCEPCION_IVA", importe: "1", alicuota: "100.01" })).toBe(
      "TRIBUTO_INVALIDO",
    );
    expect(t({ tipo: "PERCEPCION_IVA", importe: "1", alicuota: "100" })).toBeNull();
    expect(t({ tipo: "PERCEPCION_IVA", importe: "1", alicuota: "-0.01" })).toBe("TRIBUTO_INVALIDO");
    expect(t({ tipo: "PERCEPCION_IVA", importe: "1", alicuota: "0" })).toBeNull();
    expect(t({ tipo: "PERCEPCION_IVA", importe: "0" })).toBeNull();
    expect(t({ tipo: "PERCEPCION_IVA", importe: "1", alicuota: "x" })).toBe("TRIBUTO_INVALIDO");
    expect(t({ tipo: "OTRO_TRIBUTO", importe: "1", descripcion: "123" })).toBe("TRIBUTO_INVALIDO");
    expect(t({ tipo: "PERCEPCION_IVA", importe: "1", descripcion: "  " })).toBeNull();
    expect(t({ tipo: "PERCEPCION_IVA", importe: "1", descripcion: null })).toBeNull();
  });
  it("total según la factura inválido o negativo", () => {
    for (const total of ["x", "-1", "", "1.234"])
      expect(error(A([linea("1", "1", "21")], { totalSegunFactura: total })), total).toBe(
        "TOTAL_INVALIDO",
      );
    expect(error(A([linea("1", "1", "21")], { totalSegunFactura: "0" }))).toBeNull();
  });
  it("las líneas se validan antes que los tributos, y los tributos antes que el total", () => {
    expect(
      error(
        A([linea("0", "1", "21")], {
          tributos: [{ tipo: "X", importe: "1" }],
          totalSegunFactura: "x",
        }),
      ),
    ).toBe("CANTIDAD_INVALIDA");
    expect(
      error(
        A([linea("1", "1", "21")], {
          tributos: [{ tipo: "X", importe: "1" }],
          totalSegunFactura: "x",
        }),
      ),
    ).toBe("TRIBUTO_INVALIDO");
  });
  it("el total máximo de numeric(18,2) entra y un centavo más no", () => {
    const tributos = [{ tipo: "PERCEPCION_IVA", importe: "9999999999999999.99" }];
    expect(error(A([linea("1", "0.000001", "21")], { tributos }))).toBeNull();
    expect(error(A([linea("1", "0.005", "21")], { tributos }))).toBe("FUERA_DE_RANGO");
  });
  it("un total que no entra en numeric(18,2) se rechaza", () => {
    expect(
      error(A([linea("99999999999999", "99999999999.999999", "27")], { totalSegunFactura: "1" })),
    ).toBe("FUERA_DE_RANGO");
  });
});

describe("IVA como costo o crédito fiscal según la condición de la empresa (DEC-0322)", () => {
  const TIPOS_A = ["FACTURA_A", "NOTA_DEBITO_A", "NOTA_CREDITO_A"] as const;
  const TIPOS_B_Y_C = [
    "FACTURA_B",
    "FACTURA_C",
    "NOTA_DEBITO_B",
    "NOTA_DEBITO_C",
    "NOTA_CREDITO_B",
    "NOTA_CREDITO_C",
  ] as const;
  const coste = (
    c: (typeof CONDICIONES_DE_IVA_DE_LA_EMPRESA)[number] | null,
    tipo: (typeof TIPOS_A)[number] | (typeof TIPOS_B_Y_C)[number],
    a: Parameters<typeof alicuotaQueEntraAlCosto>[2],
  ) => alicuotaQueEntraAlCosto(c, tipo, a);

  it("las condiciones de la empresa son las tres de sus datos fiscales", () => {
    expect([...CONDICIONES_DE_IVA_DE_LA_EMPRESA]).toEqual([
      "RESPONSABLE_INSCRIPTO",
      "MONOTRIBUTO",
      "EXENTO",
    ]);
  });
  it("solo las A discriminan IVA", () => {
    for (const t of TIPOS_A) expect(discriminaIva(t)).toBe(true);
    for (const t of TIPOS_B_Y_C) expect(discriminaIva(t)).toBe(false);
  });
  it("A + responsable inscripto: el IVA no entra al costo (es crédito fiscal)", () => {
    for (const a of ["0", "2.5", "5", "10.5", "21", "27", "EXENTO", "NO_GRAVADO"] as const) {
      expect(coste("RESPONSABLE_INSCRIPTO", "FACTURA_A", a)).toEqual({ ok: true, valor: null });
    }
  });
  it("A + monotributista o exento: la alícuota de la línea entra al costo; exento y no gravado no llevan IVA", () => {
    for (const c of ["MONOTRIBUTO", "EXENTO"] as const) {
      for (const a of ["0", "2.5", "5", "10.5", "21", "27"] as const) {
        expect(coste(c, "FACTURA_A", a)).toEqual({ ok: true, valor: a });
      }
      expect(coste(c, "FACTURA_A", "EXENTO")).toEqual({ ok: true, valor: null });
      expect(coste(c, "FACTURA_A", "NO_GRAVADO")).toEqual({ ok: true, valor: null });
    }
  });
  it("B o C: el costo es el importe de la línea con cualquier condición, y no hace falta leerla", () => {
    for (const t of TIPOS_B_Y_C) {
      for (const c of [...CONDICIONES_DE_IVA_DE_LA_EMPRESA, null] as const) {
        expect(coste(c, t, null)).toEqual({ ok: true, valor: null });
        expect(coste(c, t, "21")).toEqual({ ok: true, valor: null });
      }
    }
  });
  it("una A sin condición legible no se calcula (cierra, no supone), salvo una línea sin alícuota", () => {
    for (const t of TIPOS_A) {
      expect(coste(null, t, "21")).toEqual({ ok: false, error: "CONDICION_DE_IVA_NO_DISPONIBLE" });
      expect(coste(null, t, "EXENTO")).toEqual({
        ok: false,
        error: "CONDICION_DE_IVA_NO_DISPONIBLE",
      });
    }
    expect(coste(null, "FACTURA_A", null)).toEqual({ ok: true, valor: null });
    expect(coste("MONOTRIBUTO", "FACTURA_A", null)).toEqual({ ok: true, valor: null });
  });
  it("el porcentaje de una alícuota: cero para exento y no gravado", () => {
    expect(porcentajeDeAlicuota("21")).toBe(porcentajeDesdeTexto("21").unidades);
    expect(porcentajeDeAlicuota("10.5")).toBe(porcentajeDesdeTexto("10.5").unidades);
    expect(porcentajeDeAlicuota("0")).toBe(0n);
    expect(porcentajeDeAlicuota("EXENTO")).toBe(0n);
    expect(porcentajeDeAlicuota("NO_GRAVADO")).toBe(0n);
  });
  it("crédito fiscal computable: el IVA solo en una Factura A de una empresa inscripta; cero en el resto", () => {
    const entrada = (
      tipo: string,
      condicion: (typeof CONDICIONES_DE_IVA_DE_LA_EMPRESA)[number] | null,
    ): EntradaDeComprobante => ({
      tipo,
      lineas: [linea("1", "100", discriminaIva(tipo as "FACTURA_A") ? "21" : null)],
      totalSegunFactura: "121.00",
      condicionDeLaEmpresa: condicion,
    });
    expect(valor(entrada("FACTURA_A", "RESPONSABLE_INSCRIPTO")).creditoFiscalComputable).toBe(
      "21.00",
    );
    for (const c of ["MONOTRIBUTO", "EXENTO"] as const) {
      const r = valor(entrada("FACTURA_A", c));
      expect(r.creditoFiscalComputable).toBe("0.00");
      expect(r.iva).toBe("21.00");
    }
    for (const t of [...TIPOS_B_Y_C, "NOTA_CREDITO_A", "NOTA_DEBITO_A"]) {
      for (const c of [...CONDICIONES_DE_IVA_DE_LA_EMPRESA, null] as const) {
        if (discriminaIva(t as "FACTURA_A") && c === null) continue;
        expect(valor(entrada(t, c)).creditoFiscalComputable).toBe("0.00");
      }
    }
  });
  it("una A sin condición legible es CONDICION_DE_IVA_NO_DISPONIBLE; una B o C sin condición se calcula", () => {
    expect(
      error({
        tipo: "FACTURA_A",
        lineas: [linea("1", "100", "21")],
        totalSegunFactura: "121.00",
        condicionDeLaEmpresa: null,
      }),
    ).toBe("CONDICION_DE_IVA_NO_DISPONIBLE");
    expect(
      valor({
        tipo: "FACTURA_B",
        lineas: [linea("1", "100", null)],
        totalSegunFactura: "100.00",
        condicionDeLaEmpresa: null,
      }).totalCalculado,
    ).toBe("100.00");
    // El tipo inválido y las líneas faltantes se rechazan antes que la condición.
    expect(
      error({ tipo: "FACTURA_M", lineas: [], totalSegunFactura: "x", condicionDeLaEmpresa: null }),
    ).toBe("TIPO_DE_COMPROBANTE_INVALIDO");
  });
});
