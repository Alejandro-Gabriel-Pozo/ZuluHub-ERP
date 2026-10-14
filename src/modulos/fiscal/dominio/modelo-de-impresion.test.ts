import { describe, expect, it } from "vitest";
import {
  consumidorFinal,
  contextoDeEmision,
  emisorInstantaneo,
  facturaArmada,
  fecha,
  imprimibleDe as imprimible,
  receptorInscripto,
  renglon,
} from "../../../../test/utilidades/facturacion";
import { EMPRESA } from "../../../../test/utilidades/fiscal";
import { TIPOS_DE_COMPROBANTE } from "./comprobante-emitido";
import {
  LEYENDA_DE_HOMOLOGACION,
  modeloDeImpresion,
  numeroImpreso,
  type ComprobanteParaImprimir,
  type MarcaParaImprimir,
  type ModeloImpreso,
} from "./modelo-de-impresion";
import { armarNotaAsociada } from "./nota-asociada";

const MARCA_UNO: MarcaParaImprimir = {
  nombreDeFantasia: "La Panadería de Zulu",
  logoUrl: "https://ejemplo.test/zulu.png",
  colorPrincipal: "#8b4513",
};
const MARCA_DOS: MarcaParaImprimir = {
  nombreDeFantasia: "Café Central",
  logoUrl: null,
  colorPrincipal: null,
};

const modelo = (c: ComprobanteParaImprimir, marca = MARCA_UNO): ModeloImpreso => {
  const r = modeloDeImpresion(c, marca);
  if (!r.ok) throw new Error(r.error);
  return r.valor;
};

const facturaB = facturaArmada(consumidorFinal, [
  renglon("1210.00", "1", "21", null, "Torta"),
  renglon("1050.00", "1", "10.5", null, "Medialunas"),
]);

const monotributo = contextoDeEmision({
  emisor: emisorInstantaneo({ condicionIva: "MONOTRIBUTO" }),
});

describe("modeloDeImpresion: golden", () => {
  it("factura B con dos marcas: solo cambia el bloque marca", async () => {
    const uno = modelo(imprimible(facturaB), MARCA_UNO);
    const dos = modelo(imprimible(facturaB), MARCA_DOS);
    expect(dos.fiscal).toEqual(uno.fiscal);
    expect({ ...dos, marca: uno.marca }).toEqual(uno);
    expect(dos.marca).toEqual(MARCA_DOS);
    await expect(JSON.stringify(uno, null, 2)).toMatchFileSnapshot(
      "./golden/modelo-factura-b-marca-1.golden.txt",
    );
    await expect(JSON.stringify(dos, null, 2)).toMatchFileSnapshot(
      "./golden/modelo-factura-b-marca-2.golden.txt",
    );
  });
});

describe("modeloDeImpresion: golden de una nota de crédito A en producción", () => {
  it("totales discriminados, comprobante asociado y sin leyenda de homologación", async () => {
    const nota = armarNotaAsociada(
      {
        empresaId: EMPRESA,
        emisorId: contextoDeEmision().emisorId,
        ambiente: "PRODUCCION",
        tipo: "FACTURA_A",
        estado: "AUTORIZADO",
        numero: 94n,
        fechaEmision: fecha("2026-10-01"),
        emisor: emisorInstantaneo({ puntoDeVentaNumero: 7 }),
        receptor: receptorInscripto,
      },
      {
        clase: "NOTA_CREDITO",
        motivo: "Devolución parcial",
        modoDePrecio: "IVA_DISCRIMINADO",
        concepto: "PRODUCTOS",
        servicio: null,
        renglones: [renglon("1000.00", "2", "21", "10", "Torta"), renglon("500.00", "1", "10.5")],
      },
      contextoDeEmision({ ambiente: "PRODUCCION" }),
    );
    if (!nota.ok) throw new Error("nota de prueba inválida");
    const m = modelo(imprimible(nota.valor, { numero: 12n }));
    expect(m.leyendas).toEqual([]);
    expect(m.fiscal.rotulo).toBe("NOTA DE CRÉDITO");
    await expect(JSON.stringify(m, null, 2)).toMatchFileSnapshot(
      "./golden/modelo-nota-de-credito-a-produccion.golden.txt",
    );
  });
});

describe("modeloDeImpresion: la marca no cambia los rótulos fiscales", () => {
  it("en los nueve tipos, con y sin comprobante asociado, el bloque fiscal es el mismo con cualquier marca", () => {
    const marcas: MarcaParaImprimir[] = [
      MARCA_UNO,
      MARCA_DOS,
      { nombreDeFantasia: "FACTURA A", logoUrl: null, colorPrincipal: null },
      { nombreDeFantasia: "CAE 00000000000000", logoUrl: "/x.png", colorPrincipal: "#000000" },
    ];
    for (const tipo of TIPOS_DE_COMPROBANTE) {
      const comprobante = imprimible({ ...facturaB, tipo, asociado: null });
      const base = modelo(comprobante, MARCA_UNO);
      for (const marca of marcas) {
        const otro = modelo(comprobante, marca);
        expect(otro.marca, tipo).toEqual(marca);
        expect(otro.fiscal, tipo).toEqual(base.fiscal);
        expect({ ...otro, marca: base.marca }, tipo).toEqual(base);
      }
    }
  });
});

describe("modeloDeImpresion: bloque fiscal", () => {
  it("rótulo, letra, código de tipo, número y fechas", () => {
    const m = modelo(imprimible(facturaB));
    expect(m.fiscal).toMatchObject({
      rotulo: "FACTURA",
      letra: "B",
      codigoDelTipo: "006",
      numero: "00001-00000011",
      fecha: "2026-10-13",
      cae: "70417054367476",
      caeVence: "2026-10-23",
    });
    expect(m.versionDeRepresentacion).toBe(1);
  });

  it("los datos del emisor son los congelados, con el CUIT con guiones", () => {
    const m = modelo(imprimible(facturaB));
    expect(m.fiscal.emisor).toEqual({
      cuit: "30-70853393-5",
      razonSocial: "Panadería Zulu SRL",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      domicilioFiscal:
        "Av. Corrientes 1234, Ciudad Autónoma de Buenos Aires, Ciudad Autónoma de Buenos Aires (CP C1043)",
      domicilioDelPuntoDeVenta:
        "Calle Falsa 123, Ciudad Autónoma de Buenos Aires, Ciudad Autónoma de Buenos Aires (CP C1043)",
      iibbNumero: "901-123456-7",
      iibbCondicion: "LOCAL",
      inicioDeActividades: "2019-03-01",
    });
  });

  it("el rótulo, la letra y el código de cada uno de los nueve tipos", () => {
    const esperados: Record<(typeof TIPOS_DE_COMPROBANTE)[number], [string, string, string]> = {
      FACTURA_A: ["FACTURA", "A", "001"],
      NOTA_DEBITO_A: ["NOTA DE DÉBITO", "A", "002"],
      NOTA_CREDITO_A: ["NOTA DE CRÉDITO", "A", "003"],
      FACTURA_B: ["FACTURA", "B", "006"],
      NOTA_DEBITO_B: ["NOTA DE DÉBITO", "B", "007"],
      NOTA_CREDITO_B: ["NOTA DE CRÉDITO", "B", "008"],
      FACTURA_C: ["FACTURA", "C", "011"],
      NOTA_DEBITO_C: ["NOTA DE DÉBITO", "C", "012"],
      NOTA_CREDITO_C: ["NOTA DE CRÉDITO", "C", "013"],
    };
    for (const tipo of TIPOS_DE_COMPROBANTE) {
      const m = modelo(imprimible({ ...facturaB, tipo, asociado: null }));
      expect([m.fiscal.rotulo, m.fiscal.letra, m.fiscal.codigoDelTipo], tipo).toEqual(
        esperados[tipo],
      );
    }
  });

  it("numeroImpreso rellena con ceros: cinco dígitos de punto de venta y ocho de número", () => {
    expect(numeroImpreso(1, 1n)).toBe("00001-00000001");
    expect(numeroImpreso(99999, 99999999n)).toBe("99999-99999999");
    expect(numeroImpreso(12, 3456n)).toBe("00012-00003456");
  });

  it("el número se rellena con ceros a cinco y ocho dígitos", () => {
    expect(modelo(imprimible(facturaB, { numero: 99999999n })).fiscal.numero).toBe(
      "00001-99999999",
    );
    const grande = { ...facturaB, emisor: emisorInstantaneo({ puntoDeVentaNumero: 99999 }) };
    expect(modelo(imprimible(grande, { numero: 1n })).fiscal.numero).toBe("99999-00000001");
  });
});

describe("modeloDeImpresion: receptor, renglones y totales", () => {
  it("receptor y renglones como texto decimal", () => {
    const m = modelo(imprimible(facturaB));
    expect(m.receptor).toEqual({
      nombre: null,
      documento: { tipo: "SIN_IDENTIFICAR" },
      condicionIva: "CONSUMIDOR_FINAL",
      domicilio: null,
    });
    expect(m.renglones).toEqual([
      {
        descripcion: "Torta",
        cantidad: "1.0000",
        precioUnitario: "1210.000000",
        descuento: null,
        alicuota: "21",
        importe: "1210.00",
      },
      {
        descripcion: "Medialunas",
        cantidad: "1.0000",
        precioUnitario: "1050.000000",
        descuento: null,
        alicuota: "10.5",
        importe: "1050.00",
      },
    ]);
    const conDescuento = facturaArmada(consumidorFinal, [renglon("9.95", "3", "21", "10")]);
    expect(modelo(imprimible(conDescuento)).renglones[0]?.descuento).toBe("10.0000");
  });

  it("A discrimina neto e IVA por alícuota", () => {
    const a = facturaArmada(
      receptorInscripto,
      [
        renglon("1000.00", "1", "21"),
        renglon("100.00", "1", "EXENTO"),
        renglon("50.00", "1", "NO_GRAVADO"),
      ],
      { modoDePrecio: "IVA_DISCRIMINADO" },
    );
    expect(modelo(imprimible(a)).totales).toEqual({
      letra: "A",
      netoPorAlicuota: [{ alicuota: "21", neto: "1000.00", iva: "210.00" }],
      exento: "100.00",
      noGravado: "50.00",
      neto: "1000.00",
      iva: "210.00",
      total: "1360.00",
    });
  });

  it("B muestra el total y el IVA contenido por alícuota (decisión 9 del dueño)", () => {
    expect(modelo(imprimible(facturaB)).totales).toEqual({
      letra: "B",
      total: "2260.00",
      ivaContenido: [
        { alicuota: "10.5", iva: "99.77" },
        { alicuota: "21", iva: "210.00" },
      ],
    });
  });

  it("C muestra solo el total", () => {
    const c = facturaArmada(consumidorFinal, [renglon("100.00", "3", null)], {}, monotributo);
    expect(modelo(imprimible(c)).totales).toEqual({ letra: "C", total: "300.00" });
  });
});

describe("modeloDeImpresion: notas, QR y leyendas", () => {
  it("una factura no trae asociado y una nota sí, con el número impreso del original", () => {
    expect(modelo(imprimible(facturaB)).asociado).toBeNull();
    const nota = armarNotaAsociada(
      {
        empresaId: EMPRESA,
        emisorId: contextoDeEmision().emisorId,
        ambiente: "HOMOLOGACION",
        tipo: "FACTURA_B",
        estado: "AUTORIZADO",
        numero: 94n,
        fechaEmision: fecha("2026-10-01"),
        emisor: emisorInstantaneo({ puntoDeVentaNumero: 7 }),
        receptor: consumidorFinal,
      },
      {
        clase: "NOTA_CREDITO",
        motivo: "Devolución",
        modoDePrecio: "IVA_INCLUIDO",
        concepto: "PRODUCTOS",
        servicio: null,
        renglones: [renglon("121.00", "1", "21")],
      },
      contextoDeEmision(),
    );
    if (!nota.ok) throw new Error("nota de prueba inválida");
    const m = modelo(imprimible(nota.valor));
    expect(m.fiscal.rotulo).toBe("NOTA DE CRÉDITO");
    expect(m.asociado).toEqual({
      rotulo: "FACTURA",
      letra: "B",
      numero: "00007-00000094",
      fecha: "2026-10-01",
    });
  });

  it("el QR es la URL de ARCA del comprobante", () => {
    const m = modelo(imprimible(facturaB));
    expect(m.qr.url).toBe(
      "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0xMC0xMyIsImN1aXQiOjMwNzA4NTMzOTM1LCJwdG9WdGEiOjEsInRpcG9DbXAiOjYsIm5yb0NtcCI6MTEsImltcG9ydGUiOjIyNjAsIm1vbmVkYSI6IlBFUyIsImN0eiI6MSwidGlwb0RvY1JlYyI6OTksIm5yb0RvY1JlYyI6MCwidGlwb0NvZEF1dCI6IkUiLCJjb2RBdXQiOjcwNDE3MDU0MzY3NDc2fQ==",
    );
  });

  it("un comprobante de homologación lleva la leyenda sin validez fiscal; uno de producción, no", () => {
    expect(LEYENDA_DE_HOMOLOGACION).toBe("HOMOLOGACIÓN — SIN VALIDEZ FISCAL");
    expect(modelo(imprimible(facturaB)).leyendas).toEqual([LEYENDA_DE_HOMOLOGACION]);
    const produccion = facturaArmada(
      consumidorFinal,
      [renglon("1.00", "1", "21")],
      {},
      contextoDeEmision({ ambiente: "PRODUCCION" }),
    );
    expect(modelo(imprimible(produccion)).leyendas).toEqual([]);
  });
});

describe("modeloDeImpresion: errores", () => {
  it("una versión de representación desconocida no se dibuja", () => {
    for (const versionDeRepresentacion of [0, 2, -1]) {
      expect(
        modeloDeImpresion(imprimible(facturaB, { versionDeRepresentacion }), MARCA_UNO),
      ).toEqual({
        ok: false,
        error: "VERSION_DE_REPRESENTACION_DESCONOCIDA",
      });
    }
  });

  it("un CAE que no es de 14 dígitos no tiene QR", () => {
    expect(modeloDeImpresion(imprimible(facturaB, { cae: "123" }), MARCA_UNO)).toEqual({
      ok: false,
      error: "CAE_INVALIDO",
    });
  });
});
