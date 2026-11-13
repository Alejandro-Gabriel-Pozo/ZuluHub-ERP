import { describe, expect, it } from "vitest";
import { entradaDelPdf, nombreDelArchivoPdf } from "../../apps/web/pantallas/pdf-de-la-factura";
import { formatearFecha, formatearImporte } from "../../apps/web/ui/patrones/formato-fiscal";
import { qrDeFacturaComoSvg } from "../../src/adaptadores/qr/qr-de-factura";
import {
  CaracterNoSoportadoEnElPdf,
  generarPdfDeLaFactura,
  type HojaParaElPdf,
} from "../../src/adaptadores/pdf/pdf-de-la-factura";
import { modeloDeImpresion } from "../../src/modulos/fiscal/dominio/modelo-de-impresion";
import { URL_BASE_DEL_QR } from "../../src/modulos/fiscal/dominio/qr-de-arca";
import {
  consumidorFinal,
  contextoDeEmision,
  emisorInstantaneo,
  facturaArmada,
  fecha,
  imprimibleDe,
  receptorInscripto,
  receptorMonotributista,
  renglon,
  type SIN_CONTACTO,
} from "../utilidades/facturacion";
import {
  decodificarElQr,
  decodificarElSvgDelQr,
  fechaDeCreacionDelPdf,
  leerElPdf,
  normalizar,
  type PaginaLeida,
} from "../utilidades/pdf";

/**
 * El PDF contra el modelo de impresión: se lee el PDF generado como lo lee un lector real (pdf.js) y se comprueba que trae cada dato
 * obligatorio del comprobante (RG 1415 y 4291) y que el QR DIBUJADO en el PDF dice lo mismo que el QR de la pantalla. Con mutaciones: si el PDF
 * pierde un dato, la comprobación lo detecta. El modelo es el REAL (`modeloDeImpresion`), no armado a mano.
 */

const MARCA = {
  nombreDeFantasia: "La Panadería de Zulu",
  logoUrl: "https://x.test/logo.png",
  colorPrincipal: "#ff0000",
};
const MM = 72 / 25.4;

type Modelo = Parameters<typeof entradaDelPdf>[0];

function modeloDe(
  c: Parameters<typeof imprimibleDe>[0],
  cambios: Parameters<typeof imprimibleDe>[1] = {},
): Modelo {
  const r = modeloDeImpresion(imprimibleDe(c, cambios), MARCA);
  if (!r.ok) throw new Error(r.error);
  return r.valor;
}

const generar = (m: Modelo, alterar?: (e: ReturnType<typeof entradaDelPdf>) => unknown) => {
  const entrada = entradaDelPdf(m);
  return generarPdfDeLaFactura((alterar?.(entrada) as typeof entrada | undefined) ?? entrada);
};
const entradaCon = (
  m: Modelo,
  cambios: Partial<HojaParaElPdf>,
): Parameters<typeof generarPdfDeLaFactura>[0] => {
  const e = entradaDelPdf(m);
  return { ...e, hoja: { ...e.hoja, ...cambios } };
};

const CONTACTO: typeof SIN_CONTACTO = {
  telefono: "+54 11 4321-0000",
  correo: "hola@zulu.test",
  web: null,
};

const facturaB = facturaArmada(consumidorFinal, [renglon("1210.00", "1", "21", null, "Torta")]);
const facturaA = facturaArmada(receptorInscripto, [renglon("1000.00", "2", "21", null, "Torta")]);
const facturaAMonotributo = facturaArmada(receptorMonotributista, [
  renglon("1000.00", "2", "21", null, "Torta"),
]);
const facturaC = facturaArmada(
  consumidorFinal,
  [renglon("1000.00", "1", null, null, "Café")],
  {},
  contextoDeEmision({ emisor: emisorInstantaneo({ condicionIva: "MONOTRIBUTO" }) }),
);
const facturaEnProduccion = facturaArmada(
  consumidorFinal,
  [renglon("1210.00", "1", "21", null, "Torta")],
  {},
  contextoDeEmision({ ambiente: "PRODUCCION" }),
);

/** Cada dato obligatorio del comprobante, tal como sale del MODELO (no de la hoja): lo que el PDF tiene que traer. */
function datosObligatorios(m: Modelo): readonly (readonly [string, string])[] {
  const e = m.fiscal.emisor;
  const datos: (readonly [string, string])[] = [
    ["razón social del emisor", e.razonSocial],
    ["CUIT del emisor", e.cuit],
    ["domicilio fiscal", e.domicilioFiscal],
    ["domicilio del punto de venta", e.domicilioDelPuntoDeVenta],
    ["inicio de actividades", formatearFecha(e.inicioDeActividades)],
    ["tipo de comprobante", m.fiscal.rotulo],
    ["letra", m.fiscal.letra],
    ["punto de venta y número", m.fiscal.numero],
    ["fecha de emisión", formatearFecha(m.fiscal.fecha)],
    ["CAE", m.fiscal.cae],
    ["vencimiento del CAE", formatearFecha(m.fiscal.caeVence)],
    ["receptor", m.receptor.nombre ?? m.receptor.leyenda ?? "Consumidor Final"],
    ["total", `Total ${formatearImporte(m.totales.total)}`],
  ];
  if (e.iibbNumero !== null) datos.push(["ingresos brutos", e.iibbNumero]);
  if (m.sucursal !== undefined) datos.push(["nombre de la sucursal", m.sucursal.nombre]);
  if (m.receptor.leyendaDeCondicion !== undefined) {
    datos.push(["leyenda de la condición del receptor", m.receptor.leyendaDeCondicion]);
  }
  m.renglones.forEach((r, i) => {
    datos.push([`renglón ${i + 1}: descripción`, r.descripcion]);
    datos.push([`renglón ${i + 1}: importe`, formatearImporte(r.importe)]);
  });
  for (const leyenda of m.leyendas) datos.push(["leyenda de homologación", leyenda]);
  for (const leyenda of m.leyendasLegales ?? []) datos.push(["leyenda legal", leyenda]);
  const t = m.transparenciaFiscal;
  if (t !== undefined) {
    datos.push(["transparencia fiscal: título", t.titulo.a4]);
    datos.push(["transparencia fiscal: IVA contenido", t.ivaContenido.rotulo]);
    datos.push([
      "transparencia fiscal: otros impuestos",
      t.otrosImpuestosNacionalesIndirectos.rotulo,
    ]);
  }
  if (m.contacto?.telefono !== undefined && m.contacto.telefono !== null) {
    datos.push(["teléfono de contacto", m.contacto.telefono]);
  }
  if (m.contacto?.correo !== undefined && m.contacto.correo !== null) {
    datos.push(["correo de contacto", m.contacto.correo]);
  }
  return datos;
}

/** Los datos obligatorios que el texto del PDF NO trae (vacío = completo). */
const faltantes = (m: Modelo, pdf: readonly PaginaLeida[]): string[] => {
  const texto = normalizar(pdf.map((p) => p.texto).join(" "));
  return datosObligatorios(m)
    .filter(([, valor]) => !texto.includes(normalizar(valor)))
    .map(([nombre]) => nombre);
};

/** Todos los textos de la hoja armada que el PDF dibuja (la pantalla y el PDF salen de la misma hoja). */
function textosDeLaHoja(h: HojaParaElPdf): string[] {
  const filas = [...h.emisor, ...h.datos, ...h.receptor, h.cae, ...(h.transparencia?.filas ?? [])];
  return [
    ...filas.flatMap((f) => (f.rotulo === null ? [f.valor] : [f.rotulo, f.valor])),
    ...h.leyendas,
    ...h.leyendasLegales,
    ...(h.contacto === null ? [] : [h.contacto]),
    h.letra,
    h.codigo,
    h.rotulo,
    h.numero,
    ...(h.corresponde === null ? [] : [h.corresponde]),
    ...h.columnas.map((c) => c.titulo),
    ...h.renglones.flatMap((r) => [
      r.descripcion,
      r.cantidad,
      r.precio,
      r.importe,
      ...(r.iva === null ? [] : [r.iva]),
    ]),
    ...h.totales.flatMap((t) => [t.rotulo, t.valor]),
    ...(h.transparencia === null ? [] : [h.transparencia.titulo]),
  ];
}

describe("el PDF trae cada dato obligatorio del modelo", () => {
  it.each([
    ["factura B a consumidor final, homologación, con transparencia fiscal e IIBB", facturaB, {}],
    ["factura B con contacto de la sucursal", facturaB, { contacto: CONTACTO }],
    [
      "factura B con el nombre de la sucursal congelado",
      facturaB,
      { sucursalNombre: "Sucursal Centro" },
    ],
    ["factura A a responsable inscripto", facturaA, {}],
    ["factura A a monotributista (leyenda legal de crédito fiscal)", facturaAMonotributo, {}],
    ["factura C de un emisor monotributista", facturaC, {}],
    ["factura B en producción (sin leyenda de homologación)", facturaEnProduccion, {}],
    [
      "nota de crédito B con el comprobante que corrige",
      facturaB,
      {
        tipo: "NOTA_CREDITO_B",
        asociado: { tipo: "FACTURA_B", puntoDeVenta: 1, numero: 5n, fecha: fecha("2026-10-01") },
      },
    ],
  ] as const)("%s", async (_nombre, comprobante, cambios) => {
    const m = modeloDe(comprobante, cambios);
    const pdf = await leerElPdf(await generar(m));
    expect(pdf).toHaveLength(1);
    expect(faltantes(m, pdf)).toEqual([]);
    // Cada texto de la hoja armada (los mismos de la pantalla) está en el PDF.
    const texto = normalizar(pdf[0]?.texto ?? "");
    for (const t of textosDeLaHoja(entradaDelPdf(m).hoja)) {
      expect(texto, `«${t}»`).toContain(normalizar(t));
    }
  });

  it("la leyenda de la condición del receptor (RG 1415 Anexo II A.II) sale en el PDF, y sin ella la comprobación falla", async () => {
    const mInscripto = modeloDe(facturaA);
    const mMonotributo = modeloDe(facturaAMonotributo);
    expect(mInscripto.receptor.leyendaDeCondicion).toBe("IVA RESPONSABLE INSCRITO");
    expect(mMonotributo.receptor.leyendaDeCondicion).toBe("RESPONSABLE MONOTRIBUTO");
    expect(modeloDe(facturaB).receptor.leyendaDeCondicion).toBe("A CONSUMIDOR FINAL");
    for (const modelo of [mInscripto, mMonotributo]) {
      const pdf = await leerElPdf(await generar(modelo));
      expect(faltantes(modelo, pdf)).toEqual([]);
      const mutado = await leerElPdf(
        await generarPdfDeLaFactura(
          entradaCon(modelo, {
            receptor: entradaDelPdf(modelo).hoja.receptor.filter(
              (f) => f.valor !== modelo.receptor.leyendaDeCondicion,
            ),
          }),
        ),
      );
      expect(faltantes(modelo, mutado)).toEqual(["leyenda de la condición del receptor"]);
    }
  });

  it("las precondiciones de los casos valen: la A a monotributista trae su leyenda legal, la B su transparencia y la de producción ninguna leyenda", () => {
    expect(modeloDe(facturaAMonotributo).leyendasLegales).toHaveLength(1);
    expect(modeloDe(facturaB).transparenciaFiscal).toBeDefined();
    expect(modeloDe(facturaEnProduccion).leyendas).toEqual([]);
    expect(modeloDe(facturaA).transparenciaFiscal).toBeUndefined();
  });

  it("el nombre de la sucursal sale como en la hoja: sin rótulo, arriba de la razón social, y sin nombre no se imprime ni deja un hueco", async () => {
    const con = await leerElPdf(
      await generar(modeloDe(facturaB, { sucursalNombre: "Sucursal Centro" })),
    );
    const trozo = (texto: string) => con[0]?.trozos.find((t) => t.texto === texto);
    const sucursal = trozo("Sucursal Centro");
    const razon = con[0]?.trozos.find((t) => t.texto === "Razón social");
    expect(sucursal).toBeDefined();
    // Misma columna y más arriba (en el PDF `y` crece hacia arriba).
    expect(sucursal?.x).toBeCloseTo(razon?.x ?? -1, 0);
    expect(sucursal?.y ?? 0).toBeGreaterThan(razon?.y ?? 0);
    const sin = await leerElPdf(await generar(modeloDe(facturaB)));
    expect(sin[0]?.texto).not.toContain("Sucursal");
  });

  it("la hoja es A4 y no trae lo que la pantalla tampoco imprime (nombre de fantasía del modelo)", async () => {
    const m = modeloDe(facturaB);
    expect(m.marca.nombreDeFantasia).toBe("La Panadería de Zulu");
    const [pagina] = await leerElPdf(await generar(m));
    expect(pagina?.ancho).toBeCloseTo(210 * MM, 1);
    expect(pagina?.alto).toBeCloseTo(297 * MM, 1);
    expect(pagina?.texto).not.toContain("La Panadería de Zulu");
  });

  it("en producción no hay leyenda de homologación en ninguna parte del PDF", async () => {
    const [pagina] = await leerElPdf(await generar(modeloDe(facturaEnProduccion)));
    expect(pagina?.texto).not.toContain("HOMOLOGACIÓN");
    const [conLeyenda] = await leerElPdf(await generar(modeloDe(facturaB)));
    expect(conLeyenda?.texto).toContain("HOMOLOGACIÓN — SIN VALIDEZ FISCAL");
  });

  it("la misma factura da los mismos bytes, byte a byte (reimprimir da lo mismo), y la fecha de creación es la de emisión, no la de la descarga", async () => {
    const m = modeloDe(facturaB);
    const a = await generar(m);
    const b = await generar(m);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    // Emitida el 2026-10-13: las 00:00 de Argentina (UTC-3) son las 03:00 UTC.
    expect(await fechaDeCreacionDelPdf(a)).toMatch(/^D:20261013030000/);
    // Otra fecha de creación cambia los metadatos y nada de lo que se ve.
    const otra = await generarPdfDeLaFactura({
      ...entradaDelPdf(m),
      creadoEn: new Date("2026-11-06T15:00:00.000Z"),
    });
    expect(Buffer.from(a).equals(Buffer.from(otra))).toBe(false);
    expect((await leerElPdf(otra))[0]?.texto).toBe((await leerElPdf(a))[0]?.texto);
  });
});

type Mutacion = (h: HojaParaElPdf) => Partial<HojaParaElPdf>;

describe("mutaciones: si el PDF pierde un dato, la comprobación lo detecta", () => {
  const m = modeloDe(facturaB, { contacto: CONTACTO });
  const mA = modeloDe(facturaAMonotributo);
  const mConSucursal = modeloDe(facturaB, { sucursalNombre: "Sucursal Centro" });

  const sin = (valor: string) => (f: { rotulo: string | null; valor: string }) => f.valor !== valor;

  const mutaciones: readonly (readonly [string, Modelo, Mutacion, string])[] = [
    ["CAE", m, (h: HojaParaElPdf) => ({ cae: { ...h.cae, valor: "" } }), "CAE"],
    [
      "vencimiento del CAE",
      m,
      (h: HojaParaElPdf) => ({ cae: { ...h.cae, valor: m.fiscal.cae } }),
      "vencimiento del CAE",
    ],
    [
      "razón social",
      m,
      (h: HojaParaElPdf) => ({ emisor: h.emisor.filter(sin(m.fiscal.emisor.razonSocial)) }),
      "razón social del emisor",
    ],
    [
      "domicilio fiscal",
      m,
      (h: HojaParaElPdf) => ({ emisor: h.emisor.filter(sin(m.fiscal.emisor.domicilioFiscal)) }),
      "domicilio fiscal",
    ],
    [
      "CUIT",
      m,
      (h: HojaParaElPdf) => ({ datos: h.datos.filter(sin(m.fiscal.emisor.cuit)) }),
      "CUIT del emisor",
    ],
    [
      "ingresos brutos",
      m,
      (h: HojaParaElPdf) => ({ datos: h.datos.filter(sin(m.fiscal.emisor.iibbNumero ?? "")) }),
      "ingresos brutos",
    ],
    [
      "inicio de actividades",
      m,
      (h: HojaParaElPdf) => ({
        datos: h.datos.filter(sin(formatearFecha(m.fiscal.emisor.inicioDeActividades))),
      }),
      "inicio de actividades",
    ],
    [
      "fecha de emisión",
      m,
      (h: HojaParaElPdf) => ({ datos: h.datos.filter(sin(formatearFecha(m.fiscal.fecha))) }),
      "fecha de emisión",
    ],
    ["número", m, () => ({ numero: "" }), "punto de venta y número"],
    [
      "receptor",
      m,
      (h: HojaParaElPdf) => ({ receptor: h.receptor.filter(sin("A CONSUMIDOR FINAL")) }),
      "receptor",
    ],
    ["leyenda de homologación", m, () => ({ leyendas: [] }), "leyenda de homologación"],
    ["transparencia fiscal", m, () => ({ transparencia: null }), "transparencia fiscal: título"],
    ["leyenda legal", mA, () => ({ leyendasLegales: [] }), "leyenda legal"],
    ["total", m, (h: HojaParaElPdf) => ({ totales: h.totales.filter((t) => !t.fuerte) }), "total"],
    ["contacto", m, () => ({ contacto: null }), "teléfono de contacto"],
    [
      "nombre de la sucursal",
      mConSucursal,
      () => ({ nombreDeLaSucursal: null }),
      "nombre de la sucursal",
    ],
    [
      "renglón",
      m,
      (h: HojaParaElPdf) => ({ renglones: h.renglones.map((r) => ({ ...r, descripcion: "x" })) }),
      "renglón 1: descripción",
    ],
  ];

  it.each(mutaciones)(
    "sin %s el PDF se detecta incompleto",
    async (_nombre, modelo, mutar, esperado) => {
      // La comprobación cuenta con el comprobante real: si no, la mutación no tendría con qué compararse.
      expect(faltantes(modelo, await leerElPdf(await generar(modelo)))).toEqual([]);
      const mutado = await generarPdfDeLaFactura(
        entradaCon(modelo, mutar(entradaDelPdf(modelo).hoja)),
      );
      expect(faltantes(modelo, await leerElPdf(mutado))).toContain(esperado);
    },
  );
});

describe("el QR del PDF dice lo mismo que el QR de la pantalla (RG 4291)", () => {
  const m = modeloDe(facturaB);

  it("la URL del QR es la oficial de ARCA y el SVG de la pantalla la decodifica", () => {
    expect(m.qr.url.startsWith(`${URL_BASE_DEL_QR}?p=`)).toBe(true);
    expect(decodificarElSvgDelQr(qrDeFacturaComoSvg(m.qr.url))).toBe(m.qr.url);
  });

  it("el QR dibujado en la hoja del PDF se lee y da la misma URL que el de la pantalla", async () => {
    const pdf = await generar(m);
    const delPdf = await decodificarElQr(pdf, 1);
    const dePantalla = decodificarElSvgDelQr(qrDeFacturaComoSvg(m.qr.url));
    expect(delPdf).toBe(m.qr.url);
    expect(delPdf).toBe(dePantalla);
  });

  it("también se lee con menos resolución (escala 3)", async () => {
    expect(await decodificarElQr(await generar(m), 1, 3)).toBe(m.qr.url);
  });

  it("mutación: un PDF con otra URL en el QR se detecta (la comprobación no es trivial)", async () => {
    const pdf = await generar(m, (e) => ({ ...e, qrUrl: `${URL_BASE_DEL_QR}?p=otro` }));
    expect(await decodificarElQr(pdf, 1)).not.toBe(m.qr.url);
  });

  it("cada hoja de un comprobante largo lleva su QR legible", async () => {
    const larga = modeloDe(
      facturaArmada(
        consumidorFinal,
        Array.from({ length: 40 }, (_, i) =>
          renglon("100.00", "1", "21", null, `Producto ${i + 1}`),
        ),
      ),
    );
    const pdf = await generar(larga);
    const paginas = await leerElPdf(pdf);
    expect(paginas.length).toBeGreaterThan(1);
    for (let k = 1; k <= paginas.length; k += 1) {
      expect(await decodificarElQr(pdf, k)).toBe(larga.qr.url);
    }
  }, 60000);
});

describe("hojas de un comprobante largo", () => {
  const renglones = Array.from({ length: 60 }, (_, i) =>
    renglon(
      `${100 + i}.50`,
      "1",
      "21",
      null,
      `Producto número ${i + 1} con una descripción lo bastante larga como para ocupar más de una línea de la tabla`,
    ),
  );
  const m = modeloDe(facturaArmada(consumidorFinal, renglones));

  it("reparte los renglones sin perder ni repetir ninguno, con «Hoja k de n», «Transporte» y «A transportar» encadenados", async () => {
    const paginas = await leerElPdf(await generar(m));
    const n = paginas.length;
    expect(n).toBeGreaterThan(2);
    paginas.forEach((p, i) => {
      expect(p.texto).toContain(`Hoja ${i + 1} de ${n}`);
      // La primera hoja no abre con «Transporte»; la última no cierra con «A transportar».
      expect(p.texto.includes("Transporte")).toBe(i > 0);
      expect(p.texto.includes("A transportar")).toBe(i < n - 1);
      // Cada hoja repite el encabezado completo y el CAE.
      expect(p.texto).toContain(m.fiscal.emisor.razonSocial);
      expect(p.texto).toContain(m.fiscal.cae);
    });
    // Los parciales encadenan Y son la SUMA de los renglones que ya salieron, con el formato de la pantalla: lo que cierra la hoja k es lo que
    // abre la hoja k+1, y es la suma (en centavos enteros, sin `number`) de los importes de los renglones de las hojas 1 a k.
    const centavos = (importe: string): bigint => {
      expect(importe).toMatch(/^\d+\.\d{2}$/);
      return BigInt(importe.replace(".", ""));
    };
    const comoImporte = (c: bigint): string =>
      `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;
    const importeDespues = (texto: string, rotulo: string): string | undefined =>
      new RegExp(`${rotulo} (\\$ [\\d.,]+)`).exec(texto)?.[1];
    let acumulado = 0n;
    for (let i = 0; i < n; i += 1) {
      const texto = paginas[i]?.texto ?? "";
      for (const r of m.renglones.keys()) {
        const numero = r + 1;
        if (new RegExp(`Producto número ${numero} con`).test(texto)) {
          acumulado += centavos(m.renglones[r]?.importe ?? "");
        }
      }
      if (i < n - 1) {
        const esperado = formatearImporte(comoImporte(acumulado));
        expect(importeDespues(texto, "A transportar")).toBe(esperado);
        expect(importeDespues(paginas[i + 1]?.texto ?? "", "Transporte")).toBe(esperado);
      }
    }
    // Al final, la suma de todos los renglones es el total que informó ARCA (y es el que muestra la última hoja).
    expect(comoImporte(acumulado)).toBe(m.totales.total);
    // Cada renglón sale exactamente una vez, y el total solo en la última hoja.
    const todo = paginas.map((p) => p.texto).join(" ");
    for (let i = 1; i <= 60; i += 1) {
      expect(todo.match(new RegExp(`Producto número ${i} con`, "g"))).toHaveLength(1);
    }
    expect(
      paginas.slice(0, -1).every((p) => !p.texto.includes(formatearImporte(m.totales.total))),
    ).toBe(true);
    expect(paginas[n - 1]?.texto).toContain(formatearImporte(m.totales.total));
  }, 60000);

  it("ningún renglón pisa el pie ni se sale del margen en ninguna hoja", async () => {
    const paginas = await leerElPdf(await generar(m));
    for (const p of paginas) {
      const margen = 10 * MM;
      for (const t of p.trozos) {
        expect(t.x).toBeGreaterThanOrEqual(margen - 1);
        expect(t.x + t.ancho).toBeLessThanOrEqual(p.ancho - margen + 1);
        expect(t.y).toBeGreaterThanOrEqual(margen - 1);
        expect(t.y + t.alto).toBeLessThanOrEqual(p.alto - margen + 1);
      }
      const renglonesDeLaHoja = p.trozos.filter((t) => t.texto.startsWith("Producto número"));
      const pie = p.trozos.filter((t) => t.texto === "A transportar" || t.texto === "Total");
      expect(renglonesDeLaHoja.length).toBeGreaterThan(0);
      expect(pie).toHaveLength(1);
      const abajoDelUltimo = Math.min(...renglonesDeLaHoja.map((t) => t.y));
      expect(abajoDelUltimo).toBeGreaterThan((pie[0]?.y ?? 0) + (pie[0]?.alto ?? 0));
    }
  }, 60000);
});

describe("las guardas: fallan cerrado, sin dibujar un PDF a medias", () => {
  const m = modeloDe(facturaB);

  it("un renglón que no entra ni solo en una hoja vacía corta con RangeError (no se dibuja encima del pie)", async () => {
    const e = entradaDelPdf(m);
    const r = e.hoja.renglones[0];
    if (r === undefined) throw new Error("la factura de prueba no tiene renglones");
    const desmedido = {
      ...e,
      hoja: { ...e.hoja, renglones: [{ ...r, descripcion: "W".repeat(30000) }] },
    };
    const error = await generarPdfDeLaFactura(desmedido).then(
      () => null,
      (x: unknown) => x,
    );
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toBe("un renglón no entra en una hoja del PDF");
    // El mismo comprobante con una descripción normal sí se genera: lo que corta es el tamaño, no el comprobante.
    await expect(generar(m)).resolves.toBeInstanceOf(Uint8Array);
  }, 60000);

  it.each([
    ["ninguno", [] as string[]],
    ["uno de menos en un comprobante de dos renglones", ["1.00"]],
    ["uno de más", ["1210.00", "1.00"]],
  ])(
    "importes que no coinciden con los renglones (%s) cortan con RangeError: el reparto no puede sumar lo que no es de los renglones",
    async (_n, importes) => {
      const dosRenglones = modeloDe(
        facturaArmada(consumidorFinal, [
          renglon("1210.00", "1", "21", null, "Torta"),
          renglon("100.00", "1", "21", null, "Pan"),
        ]),
      );
      const base = entradaDelPdf(importes.length === 1 ? dosRenglones : m);
      const error = await generarPdfDeLaFactura({ ...base, importes }).then(
        () => null,
        (x: unknown) => x,
      );
      expect(error).toBeInstanceOf(RangeError);
      expect((error as Error).message).toBe("tiene que haber un importe por cada renglón");
    },
  );
});

describe("texto del cliente: raro, largo, hostil", () => {
  // La primitiva de nombre (`nombre-o-razon-social.ts`) ya rechaza estos caracteres al armar el comprobante. El PDF NO confía en eso: se
  // arma el modelo con un nombre válido y se pisa después, como un comprobante viejo guardado antes de la primitiva (defensa en profundidad).
  const conReceptor = (nombre: string): Modelo => {
    const base = modeloDe(
      facturaArmada({ ...receptorInscripto, nombre: "Cliente de prueba" }, [
        renglon("1000.00", "1", "21", null, "Torta"),
      ]),
    );
    return { ...base, receptor: { ...base.receptor, nombre } };
  };
  const conDescripcion = (descripcion: string) =>
    modeloDe(facturaArmada(consumidorFinal, [renglon("1000.00", "1", "21", null, descripcion)]));

  it("un nombre con tildes, ñ, paréntesis, barras y comillas se dibuja tal cual y no abre nada en el PDF", async () => {
    const nombre = String.raw`Ñandú (Peña) \ ) Tj /JavaScript (app.alert) / <</S/JavaScript>> “comillas” ¿qué? ¡hola! € 100%`;
    const pdf = await generar(conReceptor(nombre));
    const [pagina] = await leerElPdf(pdf);
    // El texto parte la línea donde puede (después de una barra, por ejemplo): se compara sin blancos.
    expect(pagina?.texto.replace(/\s/g, "")).toContain(nombre.replace(/\s/g, ""));
    const crudo = Buffer.from(pdf).toString("latin1");
    for (const peligro of [
      "/JavaScript",
      "/JS",
      "/OpenAction",
      "/Launch",
      "/URI",
      "/EmbeddedFile",
      "/AA",
    ]) {
      expect(crudo, peligro).not.toContain(peligro);
    }
  });

  it("un nombre de 190 caracteres con espacios y una descripción y un domicilio de 200 sin cortes (los máximos) no se desbordan ni se pierden", async () => {
    const conEspacios = "Distribuidora Mayorista del Sur ".repeat(6).trim();
    const sinCortes = "W".repeat(200);
    const m = modeloDe(
      facturaArmada({ ...receptorInscripto, nombre: conEspacios, domicilio: sinCortes }, [
        renglon("1000.00", "1", "21", null, sinCortes),
      ]),
    );
    const paginas = await leerElPdf(await generar(m));
    const margen = 10 * MM;
    for (const p of paginas) {
      for (const t of p.trozos) {
        expect(t.x).toBeGreaterThanOrEqual(margen - 1);
        expect(t.x + t.ancho).toBeLessThanOrEqual(p.ancho - margen + 1);
      }
    }
    const sinBlancos = paginas
      .map((p) => p.texto)
      .join("")
      .replace(/\s/g, "");
    expect(sinBlancos).toContain(sinCortes);
    expect(sinBlancos).toContain(conEspacios.replace(/\s/g, ""));
  });

  it("el máximo de renglones (200) con descripciones del máximo (200 caracteres) se genera completo y a tiempo", async () => {
    const descripcion = "Descripción larga de un producto con mucho texto ".repeat(4).slice(0, 200);
    const m = modeloDe(
      facturaArmada(
        consumidorFinal,
        Array.from({ length: 200 }, () => renglon("10.00", "1", "21", null, descripcion)),
      ),
    );
    const inicio = Date.now();
    const paginas = await leerElPdf(await generar(m));
    expect(Date.now() - inicio).toBeLessThan(15000);
    expect(paginas.length).toBeGreaterThan(5);
    expect(
      paginas
        .map((p) => p.texto)
        .join(" ")
        .match(/Descripción larga/g),
    ).toHaveLength(200 * 4);
    expect(paginas.at(-1)?.texto).toContain(`Hoja ${paginas.length} de ${paginas.length}`);
  }, 60000);

  it.each([
    ["un emoji", "Café 😀", 0x1f600],
    ["escritura de derecha a izquierda (hebreo)", "שלום", 0x5e9],
    ["escritura de derecha a izquierda (árabe)", "مرحبا", 0x645],
    ["el marcador de dirección del texto", "Zulu‮SRL", 0x202e],
    ["un salto de línea", "línea 1\nlínea 2", 0x0a],
    ["un ideograma", "日本", 0x65e5],
  ] as const)(
    "%s en el nombre del cliente corta la generación (falla cerrado), sin dibujar a medias",
    async (_n, nombre, punto) => {
      const error = await generar(conReceptor(nombre)).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(CaracterNoSoportadoEnElPdf);
      expect((error as CaracterNoSoportadoEnElPdf).puntoDeCodigo).toBe(punto);
      expect((error as Error).message).not.toContain("Zulu");
    },
  );

  it("lo mismo vale para una descripción de renglón", async () => {
    await expect(generar(conDescripcion("Torta 🎂"))).rejects.toBeInstanceOf(
      CaracterNoSoportadoEnElPdf,
    );
  });
});

describe("el nombre del archivo", () => {
  it.each([
    [facturaB, {}, "Factura-B-00001-00000011.pdf"],
    [facturaA, {}, "Factura-A-00001-00000011.pdf"],
    [facturaC, {}, "Factura-C-00001-00000011.pdf"],
    [
      facturaB,
      {
        tipo: "NOTA_CREDITO_B",
        asociado: { tipo: "FACTURA_B", puntoDeVenta: 1, numero: 5n, fecha: fecha("2026-10-01") },
      },
      "Nota-de-credito-B-00001-00000011.pdf",
    ],
    [
      facturaB,
      {
        tipo: "NOTA_DEBITO_B",
        asociado: { tipo: "FACTURA_B", puntoDeVenta: 1, numero: 5n, fecha: fecha("2026-10-01") },
      },
      "Nota-de-debito-B-00001-00000011.pdf",
    ],
  ] as const)(
    "sale del tipo, la letra y el número, sin datos del cliente (%#)",
    (c, cambios, esperado) => {
      const nombre = nombreDelArchivoPdf(modeloDe(c, cambios));
      expect(nombre).toBe(esperado);
      expect(nombre).toMatch(/^[A-Za-z]+(-[a-z]+)*-[ABC]-\d{5}-\d{8}\.pdf$/);
    },
  );
});
