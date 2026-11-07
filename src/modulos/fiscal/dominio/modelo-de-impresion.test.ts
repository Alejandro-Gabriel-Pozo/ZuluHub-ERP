import fc from "fast-check";
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
import type { CondicionIibb } from "./datos-fiscales";
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
import {
  LEYENDA_DE_CREDITO_FISCAL_A_MONOTRIBUTISTA,
  leyendaDeCreditoFiscal,
} from "./leyenda-de-credito-fiscal";
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

/**
 * Los golden de la versión 2 NO se regeneran (reimprimen idéntico lo sellado con la 2), así que piden la 2 de forma explícita y no la
 * «actual», que ahora es la 3.
 */
const con2 = (c: ComprobanteParaImprimir): ComprobanteParaImprimir => ({
  ...c,
  versionDeRepresentacion: 2,
});

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
    expect(VERSION_DE_REPRESENTACION_ACTUAL).toBe(3);
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
      iibbCondicion: null,
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
      leyendaDeCondicion: "A CONSUMIDOR FINAL",
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

  it("un pasaporte con letras sale TAL CUAL en el modelo en todas las versiones (v1, v2 y la vigente); lo impreso no es lo que va a ARCA", () => {
    const turista = facturaArmada(
      {
        nombre: "Jane Doe",
        documento: { tipo: "PASAPORTE", numero: "ABC123456" },
        condicionIva: "CONSUMIDOR_FINAL",
        domicilio: "5th Avenue 1",
      },
      [renglon("121.00", "1", "21")],
    );
    for (const version of [1, 2, VERSION_DE_REPRESENTACION_ACTUAL] as const) {
      const m = modelo(imprimible(turista, { versionDeRepresentacion: version }));
      expect(m.receptor.documento, `v${String(version)}`).toEqual({
        tipo: "PASAPORTE",
        numero: "ABC123456",
      });
    }
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
    for (const versionDeRepresentacion of [0, 4, -1, 1.5, Number.NaN]) {
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

const facturaAMonotributista = facturaArmada(
  receptorMonotributista,
  [renglon("1000.00", "1", "21"), renglon("100.00", "1", "EXENTO")],
  { modoDePrecio: "IVA_DISCRIMINADO" },
);

/** Una nota de crédito sobre una factura A a un monotributista (número 94, punto de venta 7): el receptor es el del original. */
function notaSobreFacturaAMonotributista(): ComprobanteParaImprimir {
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
      receptor: receptorMonotributista,
    },
    {
      clase: "NOTA_CREDITO",
      motivo: "Devolución parcial",
      modoDePrecio: "IVA_DISCRIMINADO",
      concepto: "PRODUCTOS",
      servicio: null,
      renglones: [renglon("1000.00", "1", "21", null, "Torta")],
    },
    contextoDeEmision({ ambiente: "PRODUCCION" }),
  );
  if (!nota.ok) throw new Error("nota de prueba inválida");
  return imprimible(nota.valor, { numero: 12n });
}

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
    ["factura-b-consumidor-final", con2(imprimible(facturaB))],
    [
      "factura-b-consumidor-final-identificado",
      con2(imprimible(facturaBConsumidorFinalIdentificado)),
    ],
    ["factura-b-a-exento", con2(imprimible(facturaBAExento))],
    ["nota-de-credito-b-consumidor-final", con2(notaSobreFacturaB("NOTA_CREDITO"))],
    ["nota-de-debito-b-consumidor-final", con2(notaSobreFacturaB("NOTA_DEBITO"))],
    ["factura-c-consumidor-final", con2(imprimible(facturaCConsumidorFinal))],
    ["factura-a-inscripto", con2(imprimible(facturaAInscripto))],
    ["factura-a-monotributista", con2(imprimible(facturaAMonotributista))],
    ["nota-de-credito-a-monotributista", con2(notaSobreFacturaAMonotributista())],
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

/**
 * Sin la condición de IIBB anterior del fixture (LOCAL): la versión 2 la entrega como `null` (D-115/D-116) y la 1 tal cual, así que
 * las pruebas «la 2 es la 1 más lo nuevo» comparan sin ese campo; su diferencia se prueba aparte, más abajo.
 */
const sinCondicionDeIibb = (c: ComprobanteParaImprimir): ComprobanteParaImprimir => ({
  ...c,
  emisor: { ...c.emisor, iibbCondicion: null },
});

/** El emisor con Ingresos Brutos como lo guarda hoy la base: el número, o «No contribuyente» sin número (D-115/D-116). */
const conIibb = (iibbNumero: string | null, iibbCondicion: CondicionIibb | null) => {
  const base = imprimible(facturaB);
  return imprimible(facturaB, { emisor: { ...base.emisor, iibbNumero, iibbCondicion } });
};

describe("modeloDeImpresion: Ingresos Brutos, número o «No contribuyente» (D-115/D-116)", () => {
  const casos: readonly (readonly [string, ComprobanteParaImprimir])[] = [
    ["factura-b-iibb-numero", con2(conIibb("901-123456-7", null))],
    ["factura-b-iibb-no-contribuyente", con2(conIibb(null, "NO_CONTRIBUYENTE"))],
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

  it("la versión 2 trae el número o «No contribuyente», y las tres condiciones anteriores llegan como null", () => {
    expect(modelo(conIibb("55", null)).fiscal.emisor).toMatchObject({
      iibbNumero: "55",
      iibbCondicion: null,
    });
    expect(modelo(conIibb(null, "NO_CONTRIBUYENTE")).fiscal.emisor).toMatchObject({
      iibbNumero: null,
      iibbCondicion: "NO_CONTRIBUYENTE",
    });
    for (const vieja of ["LOCAL", "CONVENIO_MULTILATERAL", "EXENTO"] as const) {
      expect(modelo(conIibb("55", vieja)).fiscal.emisor.iibbCondicion).toBeNull();
      expect(modelo(conIibb(null, vieja)).fiscal.emisor.iibbCondicion).toBeNull();
    }
  });

  it("la versión 1 no cambia: trae lo guardado tal cual, incluso las condiciones anteriores", () => {
    const base = imprimible(facturaB, V1);
    const m = modelo({
      ...base,
      emisor: { ...base.emisor, iibbCondicion: "CONVENIO_MULTILATERAL" },
    });
    expect(m.versionDeRepresentacion).toBe(1);
    expect(m.fiscal.emisor.iibbCondicion).toBe("CONVENIO_MULTILATERAL");
    expect(m.fiscal.emisor.iibbNumero).toBe("901-123456-7");
  });
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

describe("modeloDeImpresion: leyenda de crédito fiscal de la A a monotributista (RG 1415 art. 15 a)", () => {
  it("el texto es el de la norma, sin parafrasear", () => {
    expect(LEYENDA_DE_CREDITO_FISCAL_A_MONOTRIBUTISTA).toBe(
      "El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley Nº 27.618",
    );
  });

  it("la factura A a un monotributista la lleva; a un inscripto, no", () => {
    const conLeyenda = modelo(imprimible(facturaAMonotributista));
    expect(conLeyenda.leyendasLegales).toEqual([LEYENDA_DE_CREDITO_FISCAL_A_MONOTRIBUTISTA]);
    expect(conLeyenda.leyendas).toEqual([LEYENDA_DE_HOMOLOGACION]);
    const inscripto = modelo(imprimible(facturaAInscripto));
    expect("leyendasLegales" in inscripto).toBe(false);
    expect(inscripto.leyendas).toEqual([LEYENDA_DE_HOMOLOGACION]);
  });

  it("la nota de crédito A a un monotributista la lleva, también en producción (sin la de homologación)", () => {
    const m = modelo(notaSobreFacturaAMonotributista());
    expect(m.fiscal.letra).toBe("A");
    expect(m.fiscal.rotulo).toBe("NOTA DE CRÉDITO");
    expect(m.leyendasLegales).toEqual([LEYENDA_DE_CREDITO_FISCAL_A_MONOTRIBUTISTA]);
    expect(m.leyendas).toEqual([]);
  });

  it("la B y la C a un monotributista no la llevan", () => {
    for (const base of [facturaB, facturaCConsumidorFinal]) {
      const m = modelo(imprimible({ ...base, receptor: receptorMonotributista }));
      expect(m.fiscal.letra).not.toBe("A");
      expect(m.leyendas).toEqual([LEYENDA_DE_HOMOLOGACION]);
      expect("leyendasLegales" in m).toBe(false);
    }
  });

  it("propiedad: sale si y solo si la versión es 2 o más, la letra es A y el receptor es monotributo", () => {
    const bases = [facturaAInscripto, facturaB, facturaCConsumidorFinal];
    fc.assert(
      fc.property(
        fc.constantFrom(...bases),
        fc.constantFrom(...CONDICIONES_DE_IVA_DEL_RECEPTOR),
        fc.constantFrom(1, 2),
        (base, condicionIva, versionDeRepresentacion) => {
          const m = modelo(
            imprimible(
              { ...base, receptor: { ...base.receptor, condicionIva } },
              { versionDeRepresentacion },
            ),
          );
          const esperada =
            versionDeRepresentacion >= 2 &&
            m.fiscal.letra === "A" &&
            condicionIva === "MONOTRIBUTO";
          expect(
            (m.leyendasLegales ?? []).includes(LEYENDA_DE_CREDITO_FISCAL_A_MONOTRIBUTISTA),
          ).toBe(esperada);
          // Nunca se mezclan: el texto legal no va en `leyendas` y el aviso de homologación no va en `leyendasLegales`.
          expect(m.leyendas).not.toContain(LEYENDA_DE_CREDITO_FISCAL_A_MONOTRIBUTISTA);
          expect(m.leyendasLegales ?? []).not.toContain(LEYENDA_DE_HOMOLOGACION);
          expect(m.leyendas).toEqual(
            imprimible(base, { versionDeRepresentacion }).ambiente === "HOMOLOGACION"
              ? [LEYENDA_DE_HOMOLOGACION]
              : [],
          );
        },
      ),
    );
  });

  it("la regla pura: solo la letra A con MONOTRIBUTO", () => {
    for (const letra of ["A", "B", "C"] as const) {
      for (const c of CONDICIONES_DE_IVA_DEL_RECEPTOR) {
        expect(leyendaDeCreditoFiscal(letra, c) !== null).toBe(
          letra === "A" && c === "MONOTRIBUTO",
        );
      }
    }
  });

  it("la versión 1 no la lleva aunque la letra sea A y el receptor monotributista", () => {
    const m = modelo(imprimible(facturaAMonotributista, V1));
    expect(m.leyendas).toEqual([LEYENDA_DE_HOMOLOGACION]);
    expect("leyendasLegales" in m).toBe(false);
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

  it("la versión 2 es la 1 más los textos legales y el modo de precio, y nada más: se sella la versión y se suman las claves", () => {
    for (const comprobante of [
      imprimible(facturaB),
      notaSobreFacturaB("NOTA_CREDITO"),
      imprimible(facturaCConsumidorFinal),
      imprimible(facturaAInscripto),
      imprimible(facturaBAExento),
    ].map((c) => sinCondicionDeIibb(con2(c)))) {
      const v1 = modelo({ ...comprobante, versionDeRepresentacion: 1 });
      const v2 = modelo(comprobante);
      const sinLosTextosLegales = {
        ...Object.fromEntries(
          Object.entries(v2).filter(
            ([clave]) => clave !== "transparenciaFiscal" && clave !== "modoDePrecio",
          ),
        ),
        receptor: Object.fromEntries(
          Object.entries(v2.receptor).filter(([clave]) => clave !== "leyenda"),
        ),
        versionDeRepresentacion: 1,
      };
      expect(sinLosTextosLegales).toEqual(v1);
    }
  });

  it("solo existen las versiones 1, 2 y 3: la siguiente a la actual no se dibuja", () => {
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
      const m = modelo(con2(imprimible(facturaB, { contacto })));
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

  it("la versión 2 con contacto es la 1 más los textos legales, el modo de precio y el contacto, y nada más", () => {
    const comprobante = sinCondicionDeIibb(
      con2(imprimible(facturaB, { contacto: CONTACTO_COMPLETO })),
    );
    const v1 = modelo({ ...comprobante, versionDeRepresentacion: 1 });
    const v2 = modelo(comprobante);
    const sinLoNuevo = {
      ...Object.fromEntries(
        Object.entries(v2).filter(
          ([c]) => c !== "transparenciaFiscal" && c !== "contacto" && c !== "modoDePrecio",
        ),
      ),
      receptor: Object.fromEntries(Object.entries(v2.receptor).filter(([c]) => c !== "leyenda")),
      versionDeRepresentacion: 1,
    };
    expect(sinLoNuevo).toEqual(v1);
  });
});

describe("modeloDeImpresion: modo de precio (versión 2 en adelante)", () => {
  it("expone el modo que guardó el comprobante, en las dos modalidades de la A", () => {
    const incluido = facturaArmada(receptorInscripto, [renglon("1210.00", "1", "21")], {
      modoDePrecio: "IVA_INCLUIDO",
    });
    expect(modelo(imprimible(incluido)).modoDePrecio).toBe("IVA_INCLUIDO");
    expect(modelo(imprimible(facturaAInscripto)).modoDePrecio).toBe("IVA_DISCRIMINADO");
  });

  it("la B a consumidor final con precios sin IVA lo expone tal cual se guardó", () => {
    const sinIva = facturaArmada(consumidorFinal, [renglon("1000.00", "1", "21")], {
      modoDePrecio: "IVA_DISCRIMINADO",
    });
    expect(modelo(imprimible(sinIva)).modoDePrecio).toBe("IVA_DISCRIMINADO");
    expect(modelo(imprimible(facturaB)).modoDePrecio).toBe("IVA_INCLUIDO");
  });

  it("la C siempre es IVA_INCLUIDO", () => {
    expect(modelo(imprimible(facturaCConsumidorFinal)).modoDePrecio).toBe("IVA_INCLUIDO");
  });

  it("lo llevan también las notas, que copian el modo de lo que corrigen", () => {
    expect(modelo(notaSobreFacturaB("NOTA_CREDITO")).modoDePrecio).toBe("IVA_INCLUIDO");
  });

  it("la versión 1 no lo trae aunque el comprobante lo tenga guardado: reimprime idéntica", () => {
    for (const comprobante of [facturaB, facturaCConsumidorFinal, facturaAInscripto]) {
      const m = modelo(imprimible(comprobante, V1));
      expect("modoDePrecio" in m).toBe(false);
      expect(JSON.stringify(m)).not.toContain("modoDePrecio");
    }
  });
});

/**
 * Nombre de la sucursal (D-114; dueño, 2026-11-05; `11-especificaciones/facturador-contratos-de-pantalla.md` del repositorio de
 * docs): lo que congeló el comprobante al emitirse, solo de la versión 2 en adelante, sin rótulo. «Con una sola sucursal, solo la
 * razón social» NO se decide acá (pregunta pendiente): el modelo expone el nombre si hay y la vista decidirá.
 */
describe("modeloDeImpresion: nombre de la sucursal congelado (D-114)", () => {
  it("golden: la factura B con el nombre congelado", async () => {
    const m = modelo(con2(imprimible(facturaB, { sucursalNombre: "Hotel Centro" })));
    expect(m.versionDeRepresentacion).toBe(2);
    await expect(JSON.stringify(m, null, 2)).toMatchFileSnapshot(
      "./golden/modelo-v2-factura-b-con-nombre-de-sucursal.golden.txt",
    );
  });

  it("golden: el nombre convive con el contacto (cada bloque en su clave, sin mezclarse)", async () => {
    const m = modelo(
      con2(imprimible(facturaB, { sucursalNombre: "Hotel Centro", contacto: CONTACTO_COMPLETO })),
    );
    await expect(JSON.stringify(m, null, 2)).toMatchFileSnapshot(
      "./golden/modelo-v2-factura-b-con-nombre-y-contacto.golden.txt",
    );
  });

  it("expone solo el nombre, tal cual se congeló, y sin rótulos", () => {
    const m = modelo(imprimible(facturaB, { sucursalNombre: "Sucursal Ñandú — Güemes" }));
    expect(m.sucursal).toEqual({ nombre: "Sucursal Ñandú — Güemes" });
    expect(Object.keys(m.sucursal ?? {})).toEqual(["nombre"]);
  });

  it("sin nombre congelado (comprobante anterior a 0022) no hay bloque: la clave ni existe", () => {
    const m = modelo(imprimible(facturaB, { sucursalNombre: null }));
    expect(m.sucursal).toBeUndefined();
    expect("sucursal" in m).toBe(false);
  });

  it("un texto vacío no se imprime: no sale un renglón en blanco", () => {
    expect("sucursal" in modelo(imprimible(facturaB, { sucursalNombre: "" }))).toBe(false);
  });

  it("lo lleva todo tipo de comprobante: las notas y las letras A y C llevan el nombre que congelaron", () => {
    for (const comprobante of [
      notaSobreFacturaB("NOTA_CREDITO"),
      notaSobreFacturaB("NOTA_DEBITO"),
      imprimible(facturaCConsumidorFinal),
      imprimible(facturaAInscripto),
    ]) {
      const m = modelo({ ...comprobante, sucursalNombre: "Hotel Centro" });
      expect(m.sucursal, m.fiscal.rotulo + m.fiscal.letra).toEqual({ nombre: "Hotel Centro" });
    }
  });

  it("la versión 1 no lo lleva aunque el comprobante lo tenga congelado: reimprime idéntica", () => {
    for (const comprobante of [
      facturaB,
      facturaCConsumidorFinal,
      facturaAInscripto,
      facturaBAExento,
    ]) {
      const sin = modelo(imprimible(comprobante, V1));
      const con = modelo(imprimible(comprobante, { ...V1, sucursalNombre: "Hotel Centro" }));
      expect("sucursal" in con).toBe(false);
      expect(JSON.stringify(con)).toBe(JSON.stringify(sin));
    }
  });

  it("la versión 2 con nombre es la misma sin nombre más la clave `sucursal`, y nada más", () => {
    const sin = modelo(imprimible(facturaB));
    const con = modelo(imprimible(facturaB, { sucursalNombre: "Hotel Centro" }));
    const { sucursal, ...resto } = con;
    expect(sucursal).toEqual({ nombre: "Hotel Centro" });
    expect(resto).toEqual(sin);
  });

  it("es del comprobante congelado: renombrar la sucursal después no entra en el modelo (el modelo no recibe la sucursal vigente)", () => {
    const congelado = imprimible(facturaB, { sucursalNombre: "Hotel Centro" });
    expect(JSON.stringify(modelo(congelado))).toBe(JSON.stringify(modelo({ ...congelado })));
    expect(modelo(congelado).sucursal?.nombre).toBe("Hotel Centro");
  });
});
