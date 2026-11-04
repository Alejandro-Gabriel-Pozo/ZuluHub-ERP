import { describe, expect, it } from "vitest";
import {
  consumidorFinal,
  receptorMonotributista,
  contextoDeEmision,
  emisorInstantaneo,
  facturaArmada,
  fecha,
  imprimibleDe as imprimible,
  receptorInscripto,
  renglon,
  SIN_CONTACTO,
} from "../../../../test/utilidades/facturacion";
import { EMPRESA } from "../../../../test/utilidades/fiscal";
import { webDesdeTexto, type SitioWeb } from "../../../primitivas/contacto/web";
import { TIPOS_DE_COMPROBANTE } from "./comprobante-emitido";
import type { ContactoCongelado } from "./contacto-impreso";
import {
  LEYENDA_DE_HOMOLOGACION,
  modeloDeImpresion,
  numeroImpreso,
  VERSION_DE_REPRESENTACION_ACTUAL,
  type ComprobanteParaImprimir,
  type MarcaParaImprimir,
  type ModeloImpreso,
} from "./modelo-de-impresion";
import { armarNotaAsociada } from "./nota-asociada";
import { CONDICIONES_DE_IVA_DEL_RECEPTOR } from "./condicion-iva-receptor";
import type { Receptor } from "./receptor";

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

/**
 * Los golden de la versión 1 son los de antes de los textos legales de la RG 5614 y NO se regeneran: un comprobante
 * sellado con la versión 1 reimprime idéntico. Por eso piden la versión 1 de forma explícita y no la «actual».
 */
const V1 = { versionDeRepresentacion: 1 } as const;

describe("modeloDeImpresion: golden de la versión 1 (intactos)", () => {
  it("factura B con dos marcas: solo cambia el bloque marca", async () => {
    const uno = modelo(imprimible(facturaB, V1), MARCA_UNO);
    const dos = modelo(imprimible(facturaB, V1), MARCA_DOS);
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

describe("modeloDeImpresion: golden de una nota de crédito A en producción (versión 1)", () => {
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
    const m = modelo(imprimible(nota.valor, { numero: 12n, ...V1 }));
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
    expect(m.versionDeRepresentacion).toBe(VERSION_DE_REPRESENTACION_ACTUAL);
    expect(VERSION_DE_REPRESENTACION_ACTUAL).toBe(2);
    expect(modelo(imprimible(facturaB, V1)).versionDeRepresentacion).toBe(1);
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

describe("modeloDeImpresion: referencias de los renglones (reservadas para F12)", () => {
  it("cada renglón lleva `referencias` y hoy siempre vacío, sea cual sea el tipo, la marca o la nota", () => {
    for (const tipo of TIPOS_DE_COMPROBANTE) {
      const m = modelo(imprimible({ ...facturaB, tipo, asociado: null }));
      expect(m.renglones).toHaveLength(2);
      for (const r of m.renglones) expect(r.referencias, tipo).toEqual([]);
    }
    for (const marca of [MARCA_UNO, MARCA_DOS]) {
      for (const r of modelo(imprimible(facturaB), marca).renglones) {
        expect(r.referencias).toEqual([]);
      }
    }
  });

  it("agregarlas no mueve nada de lo que ya se imprimía: sin ellas el modelo es el de siempre y reimprimir da lo mismo", () => {
    const una = modelo(imprimible(facturaB));
    const otra = modelo(imprimible(facturaB));
    expect(otra).toEqual(una);
    expect(JSON.stringify(otra)).toBe(JSON.stringify(una));
    // lo de siempre del renglón no cambió; solo se suma la línea reservada
    expect(una.renglones[0]).toEqual({
      descripcion: "Torta",
      cantidad: "1.0000",
      precioUnitario: "1210.000000",
      descuento: null,
      alicuota: "21",
      importe: "1210.00",
      referencias: [],
    });
    expect(Object.keys(una.renglones[0] ?? {})).toEqual([
      "descripcion",
      "cantidad",
      "precioUnitario",
      "descuento",
      "alicuota",
      "importe",
      "referencias",
    ]);
    // el QR, los totales y el bloque fiscal no dependen de las referencias
    expect(una.qr.url).toBe(modelo(imprimible(facturaB), MARCA_DOS).qr.url);
    expect(una.totales).toEqual(modelo(imprimible(facturaB), MARCA_DOS).totales);
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
      leyenda: "A CONSUMIDOR FINAL",
    });
    expect(modelo(imprimible(facturaB, V1)).receptor).toEqual({
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
        referencias: [],
      },
      {
        descripcion: "Medialunas",
        cantidad: "1.0000",
        precioUnitario: "1050.000000",
        descuento: null,
        alicuota: "10.5",
        importe: "1050.00",
        referencias: [],
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
    for (const versionDeRepresentacion of [0, 3, -1, 1.5, Number.NaN]) {
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

/**
 * Versión 2: los textos legales de la norma de comprobantes. Las cadenas de abajo se copiaron LETRA POR LETRA de la
 * norma (no de la constante del modelo), para que un cambio del modelo no las arrastre:
 * - Título, «IVA Contenido» y «Otros Impuestos Nacionales Indirectos»: RG 5614/2024 art. 2 punto 7 (Anexo II,
 *   Apartado B, inciso g) 1.), `12-referencias-externas/arca-normas-de-comprobantes/norma_5614_2024.html` del
 *   repositorio de docs.
 * - «A CONSUMIDOR FINAL»: RG 5866/2026 art. 1 f) (Anexo II, Apartado A, Título II, d) 1.), `rg5866.html`.
 * - Título del rollo de 80 mm (el «ticket» de D-108): D-108 (`11-especificaciones/facturador-contratos-de-pantalla.md` del repositorio de docs; dueño,
 *   2026-11-04).
 */
const TITULO_DE_LA_NORMA = "Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)";
const TITULO_DEL_ROLLO_D108 = "TRANSPARENCIA FISCAL";
const IVA_CONTENIDO_DE_LA_NORMA = "IVA Contenido";
const OTROS_DE_LA_NORMA = "Otros Impuestos Nacionales Indirectos";
const LEYENDA_DE_LA_NORMA = "A CONSUMIDOR FINAL";

const IVA_CONTENIDO_DE_FACTURA_B = [
  { alicuota: "10.5", iva: "99.77" },
  { alicuota: "21", iva: "210.00" },
];

const BLOQUE_DE_FACTURA_B = {
  titulo: { a4: TITULO_DE_LA_NORMA, rollo80mm: TITULO_DEL_ROLLO_D108 },
  ivaContenido: { rotulo: IVA_CONTENIDO_DE_LA_NORMA, porAlicuota: IVA_CONTENIDO_DE_FACTURA_B },
  otrosImpuestosNacionalesIndirectos: { rotulo: OTROS_DE_LA_NORMA, valor: "0.00" },
};

const consumidorFinalConDni: Receptor = {
  nombre: "Juan Gómez",
  documento: { tipo: "DNI", numero: "30123456" },
  condicionIva: "CONSUMIDOR_FINAL",
  domicilio: null,
};
const receptorExento: Receptor = { ...receptorInscripto, condicionIva: "EXENTO" };

const facturaBConsumidorFinalIdentificado = facturaArmada(consumidorFinalConDni, [
  renglon("1210.00", "1", "21", null, "Torta"),
]);
const facturaBAExento = facturaArmada(receptorExento, [
  renglon("1210.00", "1", "21", null, "Torta"),
]);
const facturaAInscripto = facturaArmada(
  receptorInscripto,
  [renglon("1000.00", "1", "21"), renglon("100.00", "1", "EXENTO")],
  { modoDePrecio: "IVA_DISCRIMINADO" },
);
const facturaCConsumidorFinal = facturaArmada(
  consumidorFinal,
  [renglon("100.00", "3", null)],
  {},
  monotributo,
);

/** Una nota sobre una factura B a consumidor final (la factura B de los golden, número 94, punto de venta 7). */
function notaSobreFacturaB(clase: "NOTA_CREDITO" | "NOTA_DEBITO"): ComprobanteParaImprimir {
  const nota = armarNotaAsociada(
    {
      empresaId: EMPRESA,
      emisorId: contextoDeEmision().emisorId,
      ambiente: "PRODUCCION",
      tipo: "FACTURA_B",
      estado: "AUTORIZADO",
      numero: 94n,
      fechaEmision: fecha("2026-10-01"),
      emisor: emisorInstantaneo({ puntoDeVentaNumero: 7 }),
      receptor: consumidorFinal,
    },
    {
      clase,
      motivo: "Devolución parcial",
      modoDePrecio: "IVA_INCLUIDO",
      concepto: "PRODUCTOS",
      servicio: null,
      renglones: [renglon("605.00", "1", "21", null, "Torta"), renglon("105.00", "1", "10.5")],
    },
    contextoDeEmision({ ambiente: "PRODUCCION" }),
  );
  if (!nota.ok) throw new Error("nota de prueba inválida");
  return imprimible(nota.valor, { numero: 12n });
}

describe("modeloDeImpresion: golden de la versión 2 (textos legales)", () => {
  const casos: readonly (readonly [string, ComprobanteParaImprimir])[] = [
    ["factura-b-consumidor-final", imprimible(facturaB)],
    ["factura-b-consumidor-final-identificado", imprimible(facturaBConsumidorFinalIdentificado)],
    ["factura-b-a-exento", imprimible(facturaBAExento)],
    ["nota-de-credito-b-consumidor-final", notaSobreFacturaB("NOTA_CREDITO")],
    ["nota-de-debito-b-consumidor-final", notaSobreFacturaB("NOTA_DEBITO")],
    ["factura-c-consumidor-final", imprimible(facturaCConsumidorFinal)],
    ["factura-a-inscripto", imprimible(facturaAInscripto)],
  ];
  for (const [nombre, comprobante] of casos) {
    it(`golden ${nombre}`, async () => {
      const m = modelo(comprobante);
      expect(m.versionDeRepresentacion).toBe(2);
      await expect(JSON.stringify(m, null, 2)).toMatchFileSnapshot(
        `./golden/modelo-v2-${nombre}.golden.txt`,
      );
    });
  }
});

describe("modeloDeImpresion: bloque de transparencia fiscal (RG 5614)", () => {
  it("la factura B a consumidor final lleva el título, «IVA Contenido» y «Otros Impuestos Nacionales Indirectos» con su valor", () => {
    const m = modelo(imprimible(facturaB));
    expect(m.transparenciaFiscal).toEqual(BLOQUE_DE_FACTURA_B);
    expect(m.transparenciaFiscal?.titulo.a4).toBe(
      "Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)",
    );
    expect(m.transparenciaFiscal?.ivaContenido.rotulo).toBe("IVA Contenido");
    expect(m.transparenciaFiscal?.otrosImpuestosNacionalesIndirectos.rotulo).toBe(
      "Otros Impuestos Nacionales Indirectos",
    );
  });

  it("D-108: el título depende del formato: A4 el de la norma, rollo de 80 mm «TRANSPARENCIA FISCAL»; la nota de crédito y la de débito B traen los mismos dos", () => {
    for (const comprobante of [
      imprimible(facturaB),
      notaSobreFacturaB("NOTA_CREDITO"),
      notaSobreFacturaB("NOTA_DEBITO"),
    ]) {
      expect(modelo(comprobante).transparenciaFiscal?.titulo).toEqual({
        a4: "Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)",
        rollo80mm: "TRANSPARENCIA FISCAL",
      });
    }
  });

  it("D-106: «IVA Contenido» es el mismo valor, una cifra por alícuota, que ya mostraban los totales (decisión 9)", () => {
    const m = modelo(imprimible(facturaB));
    expect(m.totales).toEqual({
      letra: "B",
      total: "2260.00",
      ivaContenido: IVA_CONTENIDO_DE_FACTURA_B,
    });
    expect(m.transparenciaFiscal?.ivaContenido.porAlicuota).toEqual(
      m.totales.letra === "B" ? m.totales.ivaContenido : null,
    );
  });

  it("D-107: «Otros Impuestos Nacionales Indirectos» se imprime siempre y vale 0.00 cuando no hay impuestos", () => {
    const exenta = facturaArmada(consumidorFinal, [renglon("500.00", "1", "EXENTO")]);
    for (const comprobante of [
      imprimible(facturaB),
      notaSobreFacturaB("NOTA_CREDITO"),
      imprimible(exenta),
    ]) {
      const otros = modelo(comprobante).transparenciaFiscal?.otrosImpuestosNacionalesIndirectos;
      expect(otros).toEqual({ rotulo: OTROS_DE_LA_NORMA, valor: "0.00" });
    }
  });

  it("un consumidor final identificado con DNI sigue siendo consumidor final: lleva el bloque", () => {
    const m = modelo(imprimible(facturaBConsumidorFinalIdentificado));
    expect(m.receptor.documento).toEqual({ tipo: "DNI", numero: "30123456" });
    expect(m.transparenciaFiscal).toEqual({
      ...BLOQUE_DE_FACTURA_B,
      ivaContenido: {
        rotulo: IVA_CONTENIDO_DE_LA_NORMA,
        porAlicuota: [{ alicuota: "21", iva: "210.00" }],
      },
    });
  });

  it("la nota de crédito y la de débito B heredan el bloque del original (Anexo IV A.2)", () => {
    for (const clase of ["NOTA_CREDITO", "NOTA_DEBITO"] as const) {
      const m = modelo(notaSobreFacturaB(clase));
      expect(m.fiscal.letra, clase).toBe("B");
      expect(m.fiscal.rotulo, clase).toBe(
        clase === "NOTA_CREDITO" ? "NOTA DE CRÉDITO" : "NOTA DE DÉBITO",
      );
      expect(m.transparenciaFiscal, clase).toEqual({
        ...BLOQUE_DE_FACTURA_B,
        ivaContenido: {
          rotulo: IVA_CONTENIDO_DE_LA_NORMA,
          porAlicuota: [
            { alicuota: "10.5", iva: "9.98" },
            { alicuota: "21", iva: "105.00" },
          ],
        },
      });
      expect(m.receptor.leyenda, clase).toBe(LEYENDA_DE_LA_NORMA);
    }
  });

  it("sin renglones gravados el bloque no inventa un valor: la lista queda vacía (pregunta pendiente al contador)", () => {
    const exenta = facturaArmada(consumidorFinal, [renglon("500.00", "1", "EXENTO")]);
    expect(modelo(imprimible(exenta)).transparenciaFiscal?.ivaContenido.porAlicuota).toEqual([]);
  });

  it("D-101: la C no lleva el bloque; tampoco la A (el contador decide, C23) ni la B a un receptor que no es consumidor final", () => {
    for (const comprobante of [facturaCConsumidorFinal, facturaAInscripto, facturaBAExento]) {
      const m = modelo(imprimible(comprobante));
      expect(m.transparenciaFiscal, m.fiscal.letra).toBeUndefined();
      expect("transparenciaFiscal" in m, m.fiscal.letra).toBe(false);
    }
  });

  it("con cualquier condición del receptor, solo el consumidor final lleva el bloque y la leyenda (en la B)", () => {
    for (const condicionIva of CONDICIONES_DE_IVA_DEL_RECEPTOR) {
      const m = modelo(imprimible(facturaB, { receptor: { ...consumidorFinal, condicionIva } }));
      const esConsumidorFinal = condicionIva === "CONSUMIDOR_FINAL";
      expect("transparenciaFiscal" in m, condicionIva).toBe(esConsumidorFinal);
      expect(m.receptor.leyenda, condicionIva).toBe(
        esConsumidorFinal ? LEYENDA_DE_LA_NORMA : undefined,
      );
    }
  });
});

describe("modeloDeImpresion: leyenda «A CONSUMIDOR FINAL» (RG 5866)", () => {
  it("el receptor consumidor final la lleva, identificado o no", () => {
    expect(modelo(imprimible(facturaB)).receptor.leyenda).toBe("A CONSUMIDOR FINAL");
    expect(modelo(imprimible(facturaBConsumidorFinalIdentificado)).receptor.leyenda).toBe(
      "A CONSUMIDOR FINAL",
    );
  });

  it("la norma la pide a todo consumidor final de las clases A, B, C y E: la C a consumidor final la lleva, sin el bloque", () => {
    const m = modelo(imprimible(facturaCConsumidorFinal));
    expect(m.fiscal.letra).toBe("C");
    expect(m.receptor.leyenda).toBe("A CONSUMIDOR FINAL");
    expect(m.transparenciaFiscal).toBeUndefined();
  });

  it("un receptor que no es consumidor final no la lleva: ni exento ni inscripto", () => {
    expect("leyenda" in modelo(imprimible(facturaBAExento)).receptor).toBe(false);
    expect("leyenda" in modelo(imprimible(facturaAInscripto)).receptor).toBe(false);
    expect(
      "leyenda" in
        modelo(imprimible({ ...facturaAInscripto, receptor: receptorMonotributista })).receptor,
    ).toBe(false);
  });

  it("no toca las leyendas del comprobante: la de homologación sigue sola", () => {
    expect(modelo(imprimible(facturaB)).leyendas).toEqual([LEYENDA_DE_HOMOLOGACION]);
  });
});

describe("modeloDeImpresion: la versión 1 sigue imprimiendo lo de antes", () => {
  it("la versión 1 no lleva ni el bloque ni la leyenda, sea cual sea el tipo y el receptor", () => {
    for (const tipo of TIPOS_DE_COMPROBANTE) {
      const m = modelo(imprimible({ ...facturaB, tipo, asociado: null }, V1));
      expect("transparenciaFiscal" in m, tipo).toBe(false);
      expect("leyenda" in m.receptor, tipo).toBe(false);
      expect(m.versionDeRepresentacion, tipo).toBe(1);
    }
    for (const comprobante of [facturaBConsumidorFinalIdentificado, facturaCConsumidorFinal]) {
      const m = modelo(imprimible(comprobante, V1));
      expect("transparenciaFiscal" in m).toBe(false);
      expect("leyenda" in m.receptor).toBe(false);
    }
  });

  it("la versión 2 es la 1 más los textos legales y nada más: se sella la versión y se suman las dos claves", () => {
    for (const comprobante of [
      imprimible(facturaB),
      notaSobreFacturaB("NOTA_CREDITO"),
      imprimible(facturaCConsumidorFinal),
      imprimible(facturaAInscripto),
      imprimible(facturaBAExento),
    ]) {
      const v1 = modelo({ ...comprobante, versionDeRepresentacion: 1 });
      const v2 = modelo(comprobante);
      const sinLosTextosLegales = {
        ...Object.fromEntries(
          Object.entries(v2).filter(([clave]) => clave !== "transparenciaFiscal"),
        ),
        receptor: Object.fromEntries(
          Object.entries(v2.receptor).filter(([clave]) => clave !== "leyenda"),
        ),
        versionDeRepresentacion: 1,
      };
      expect(sinLosTextosLegales).toEqual(v1);
    }
  });

  it("solo existen la versión 1 y la 2: la siguiente a la actual no se dibuja", () => {
    for (const versionDeRepresentacion of [1, VERSION_DE_REPRESENTACION_ACTUAL]) {
      expect(
        modeloDeImpresion(imprimible(facturaB, { versionDeRepresentacion }), MARCA_UNO).ok,
      ).toBe(true);
    }
    expect(
      modeloDeImpresion(
        imprimible(facturaB, { versionDeRepresentacion: VERSION_DE_REPRESENTACION_ACTUAL + 1 }),
        MARCA_UNO,
      ),
    ).toEqual({ ok: false, error: "VERSION_DE_REPRESENTACION_DESCONOCIDA" });
  });
});

/**
 * Contacto de la sucursal (D-98 y D-99; dueño, 2026-11-04; `11-especificaciones/facturador-contratos-de-pantalla.md` del
 * repositorio de docs). Los valores de abajo son lo que congeló el comprobante: la web ya viene canónica, sin esquema.
 */
const web = (texto: string): SitioWeb => {
  const r = webDesdeTexto(texto);
  if (!r.ok) throw new Error(`web de prueba inválida: ${texto}`);
  return r.valor;
};
const CONTACTO_COMPLETO: ContactoCongelado = {
  telefono: "011 4555-1234",
  correo: "reservas@hotelcentro.com",
  web: web("www.hotelcentro.com"),
};
const SOLO_TELEFONO_Y_WEB: ContactoCongelado = {
  telefono: "011 4555-1234",
  correo: null,
  web: web("www.hotelcentro.com"),
};

describe("modeloDeImpresion: contacto congelado de la sucursal (D-98, D-99)", () => {
  const casos: readonly (readonly [string, ContactoCongelado])[] = [
    ["factura-b-con-contacto-completo", CONTACTO_COMPLETO],
    ["factura-b-con-telefono-y-web", SOLO_TELEFONO_Y_WEB],
  ];
  for (const [nombre, contacto] of casos) {
    it(`golden ${nombre}`, async () => {
      const m = modelo(imprimible(facturaB, { contacto }));
      expect(m.versionDeRepresentacion).toBe(2);
      await expect(JSON.stringify(m, null, 2)).toMatchFileSnapshot(
        `./golden/modelo-v2-${nombre}.golden.txt`,
      );
    });
  }

  it("con los tres datos: cada uno tal cual se congeló y la web como texto para el papel y enlace https", () => {
    expect(modelo(imprimible(facturaB, { contacto: CONTACTO_COMPLETO })).contacto).toEqual({
      telefono: "011 4555-1234",
      correo: "reservas@hotelcentro.com",
      web: { texto: "www.hotelcentro.com", enlace: "https://www.hotelcentro.com" },
    });
  });

  it("cada dato va solo si existe: lo que falta es null y la web no inventa un enlace", () => {
    expect(modelo(imprimible(facturaB, { contacto: SOLO_TELEFONO_Y_WEB })).contacto).toEqual({
      telefono: "011 4555-1234",
      correo: null,
      web: { texto: "www.hotelcentro.com", enlace: "https://www.hotelcentro.com" },
    });
    expect(
      modelo(imprimible(facturaB, { contacto: { ...SIN_CONTACTO, correo: "a@hotel.com" } }))
        .contacto,
    ).toEqual({ telefono: null, correo: "a@hotel.com", web: null });
    expect(
      modelo(imprimible(facturaB, { contacto: { ...SIN_CONTACTO, telefono: "4555-1234" } }))
        .contacto,
    ).toEqual({ telefono: "4555-1234", correo: null, web: null });
  });

  it("la web con ruta y consulta conserva todo en el texto y el enlace sale de anteponerle https://", () => {
    const m = modelo(
      imprimible(facturaB, {
        contacto: { ...SIN_CONTACTO, web: web("Hotel.com:8080/Centro?x=1") },
      }),
    );
    expect(m.contacto?.web).toEqual({
      texto: "hotel.com:8080/Centro?x=1",
      enlace: "https://hotel.com:8080/Centro?x=1",
    });
  });

  it("sin ningún dato no hay bloque: la clave ni existe (es el caso de los golden v2 anteriores)", () => {
    const m = modelo(imprimible(facturaB, { contacto: SIN_CONTACTO }));
    expect(m.contacto).toBeUndefined();
    expect("contacto" in m).toBe(false);
  });

  it("sin rótulos: su texto no está decidido, el bloque trae solo los tres datos", () => {
    const m = modelo(imprimible(facturaB, { contacto: CONTACTO_COMPLETO }));
    expect(Object.keys(m.contacto ?? {}).sort()).toEqual(["correo", "telefono", "web"]);
    expect(Object.keys(m.contacto?.web ?? {}).sort()).toEqual(["enlace", "texto"]);
  });

  it("lo lleva todo tipo de comprobante: las notas y las letras A y C llevan el contacto que congelaron", () => {
    for (const comprobante of [
      notaSobreFacturaB("NOTA_CREDITO"),
      notaSobreFacturaB("NOTA_DEBITO"),
      imprimible(facturaCConsumidorFinal),
      imprimible(facturaAInscripto),
    ]) {
      const m = modelo({ ...comprobante, contacto: CONTACTO_COMPLETO });
      expect(m.contacto, m.fiscal.rotulo + m.fiscal.letra).toEqual({
        telefono: "011 4555-1234",
        correo: "reservas@hotelcentro.com",
        web: { texto: "www.hotelcentro.com", enlace: "https://www.hotelcentro.com" },
      });
    }
  });

  it("la versión 1 no lo lleva aunque el comprobante lo tenga congelado: reimprime idéntica", () => {
    for (const comprobante of [
      facturaB,
      facturaCConsumidorFinal,
      facturaAInscripto,
      facturaBAExento,
    ]) {
      const sinContacto = modelo(imprimible(comprobante, V1));
      const conContacto = modelo(imprimible(comprobante, { ...V1, contacto: CONTACTO_COMPLETO }));
      expect("contacto" in conContacto).toBe(false);
      expect(JSON.stringify(conContacto)).toBe(JSON.stringify(sinContacto));
    }
  });

  it("la versión 2 con contacto es la 1 más los textos legales y el contacto, y nada más", () => {
    const comprobante = imprimible(facturaB, { contacto: CONTACTO_COMPLETO });
    const v1 = modelo({ ...comprobante, versionDeRepresentacion: 1 });
    const v2 = modelo(comprobante);
    const sinLoNuevo = {
      ...Object.fromEntries(
        Object.entries(v2).filter(([c]) => c !== "transparenciaFiscal" && c !== "contacto"),
      ),
      receptor: Object.fromEntries(Object.entries(v2.receptor).filter(([c]) => c !== "leyenda")),
      versionDeRepresentacion: 1,
    };
    expect(sinLoNuevo).toEqual(v1);
  });
});
