import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  armarLaHoja,
  textoDeLaHoja,
  type ComprobanteParaLaHoja,
} from "../../apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja";
import { formatearImporte } from "../../apps/web/ui/plantillas/facturacion/formato-fiscal";
import { paginar } from "../../apps/web/ui/plantillas/facturacion/impresion/paginador";
import {
  modeloDeImpresion,
  type ModeloImpreso,
} from "../../src/modulos/fiscal/dominio/modelo-de-impresion";
import { contactoImpreso } from "../../src/modulos/fiscal/dominio/contacto-impreso";
import { webDesdeTexto } from "../../src/primitivas/contacto/web";
import {
  alicuotaArbitraria,
  consumidorFinal,
  contextoDeEmision,
  emisorInstantaneo,
  facturaArmada,
  facturaOSinTotal,
  imprimibleDe,
  receptorInscripto,
  renglon,
  renglonArbitrario,
  SIN_CONTACTO,
} from "../utilidades/facturacion";
import "../propiedades/configuracion";

/**
 * El modelo de vista de la hoja contra el modelo de impresión REAL de fiscal: lo que dibuja la hoja sale del `ModeloImpreso` sin
 * adaptar nada, los textos son los del catálogo o los del modelo, y los renglones suman el total que informó ARCA (hallazgo del
 * paginador: la hoja muestra el total del modelo; esta prueba comprueba que los parciales terminan en el mismo número).
 */

const MARCA = { nombreDeFantasia: "La Panadería de Zulu", logoUrl: null, colorPrincipal: null };

function modelo(c: Parameters<typeof modeloDeImpresion>[0]): ModeloImpreso {
  const r = modeloDeImpresion(c, MARCA);
  if (!r.ok) throw new Error(r.error);
  return r.valor;
}

/** El modelo de fiscal se pasa tal cual: si dejara de cumplir el tipo de la hoja, esta asignación no compila. */
const paraLaHoja = (m: ModeloImpreso): ComprobanteParaLaHoja => ({
  ...m,
  esDeHomologacion: m.leyendas.length > 0,
});

const facturaB = facturaArmada(consumidorFinal, [
  renglon("1210.00", "1", "21", null, "Torta"),
  renglon("1050.00", "1", "10.5", null, "Medialunas"),
]);
const facturaA = facturaArmada(receptorInscripto, [
  renglon("1000.00", "2", "21", "10", "Torta"),
  renglon("500.00", "1", "10.5"),
  renglon("300.00", "1", "EXENTO"),
]);
const facturaC = facturaArmada(
  consumidorFinal,
  [renglon("1000.00", "2", null, null, "Café")],
  {},
  contextoDeEmision({ emisor: emisorInstantaneo({ condicionIva: "MONOTRIBUTO" }) }),
);

const claves = (filas: readonly { rotulo: string | null }[]) => filas.map((f) => f.rotulo);

describe("armarLaHoja: factura B a consumidor final", () => {
  const m = modelo(imprimibleDe(facturaB, { contacto: SIN_CONTACTO }));
  const a4 = armarLaHoja({}, paraLaHoja(m), "A4");

  it("rótulo, letra, COD. y número salen del modelo", () => {
    expect([a4.rotulo, a4.letra, a4.codigo, a4.numero]).toEqual([
      "FACTURA",
      "B",
      "COD. 006",
      "00001-00000011",
    ]);
  });

  it("el cliente es «A CONSUMIDOR FINAL» del modelo y no lleva documento", () => {
    expect(m.receptor.leyenda).toBe("A CONSUMIDOR FINAL");
    expect(a4.receptor).toEqual([
      { rotulo: "Cliente", valor: "A CONSUMIDOR FINAL" },
      { rotulo: "Condición frente al IVA", valor: "Consumidor Final" },
    ]);
  });

  it("transparencia fiscal con los textos del modelo: un título por formato y una fila de IVA contenido por alícuota", () => {
    const t = m.transparenciaFiscal;
    if (t === undefined) throw new Error("la B a consumidor final lleva transparencia");
    expect(a4.transparencia?.titulo).toBe(t.titulo.a4);
    const ticket = armarLaHoja({}, paraLaHoja(m), "TICKET");
    expect(ticket.transparencia?.titulo).toBe(t.titulo.rollo80mm);
    expect(a4.transparencia?.titulo).not.toBe(ticket.transparencia?.titulo);
    expect(a4.transparencia?.filas.map((f) => f.valor)).toEqual(["$ 99,77", "$ 210,00", "$ 0,00"]);
    expect(a4.transparencia?.filas.at(-1)?.rotulo).toBe(
      t.otrosImpuestosNacionalesIndirectos.rotulo,
    );
    expect(a4.transparencia?.filas.slice(0, 2).map((f) => f.rotulo)).toEqual([
      `${t.ivaContenido.rotulo} 10,5 %`,
      `${t.ivaContenido.rotulo} 21 %`,
    ]);
  });

  it("columnas con IVA, el total del modelo y el CAE con su vencimiento", () => {
    expect(a4.columnas.map((c) => c.titulo)).toEqual([
      "Descripción",
      "Cantidad",
      "Precio con IVA",
      "IVA",
      "Importe",
    ]);
    expect(a4.totales).toEqual([{ rotulo: "Total", valor: "$ 2.260,00", fuerte: true }]);
    expect(a4.cae).toEqual({ rotulo: "CAE", valor: "70417054367476 · vence 23/10/2026" });
    expect(a4.renglones[0]).toMatchObject({ iva: "IVA 21 %", importe: "$ 1.210,00" });
  });
});

describe("armarLaHoja: letras A y C", () => {
  it("la A discrimina el neto por alícuota con su IVA, y el exento aparte; el total es el del modelo", () => {
    const m = modelo(imprimibleDe(facturaA, { contacto: SIN_CONTACTO }));
    const a = armarLaHoja({}, paraLaHoja(m), "A4");
    expect(m.transparenciaFiscal).toBeUndefined();
    expect(a.transparencia).toBeNull();
    expect(claves(a.totales)).toEqual([
      "Neto gravado 10,5 %",
      "IVA 10,5 %",
      "Neto gravado 21 %",
      "IVA 21 %",
      "Exento",
      "Total",
    ]);
    expect(a.totales.at(-1)?.valor).toBe(formatearImporte(m.totales.total));
  });

  it("la C no lleva transparencia, ni columna de IVA, y muestra «Precio»", () => {
    const m = modelo(imprimibleDe(facturaC, { contacto: SIN_CONTACTO }));
    const a = armarLaHoja({}, paraLaHoja(m), "A4");
    expect(m.fiscal.letra).toBe("C");
    expect(a.transparencia).toBeNull();
    expect(a.columnas.map((c) => c.titulo)).toEqual([
      "Descripción",
      "Cantidad",
      "Precio",
      "Importe",
    ]);
    expect(a.renglones[0]?.iva).toBeNull();
  });
});

describe("armarLaHoja: nota con comprobante asociado, homologación, contacto e ingresos brutos", () => {
  const nota = { ...facturaB, tipo: "NOTA_CREDITO_B" as const };
  it("«Corresponde a …» con el comprobante y la fecha del asociado", () => {
    const asociado = {
      tipo: "FACTURA_B" as const,
      puntoDeVenta: 1,
      numero: 7n,
      cuit: facturaB.emisor.cuit,
      fecha: facturaB.asociado?.fecha ?? imprimibleDe(facturaB).fechaEmision,
    };
    const m = modelo(imprimibleDe({ ...nota, asociado }, { contacto: SIN_CONTACTO }));
    const a = armarLaHoja({}, paraLaHoja(m), "A4");
    expect(a.rotulo).toBe("NOTA DE CRÉDITO");
    expect(a.corresponde).toBe("Corresponde a FACTURA B 00001-00000007 del 13/10/2026");
  });

  it("la leyenda de homologación sale del catálogo solo en un comprobante de pruebas", () => {
    const pruebas = modelo(imprimibleDe({ ...facturaB, ambiente: "HOMOLOGACION" }));
    const produccion = modelo(imprimibleDe({ ...facturaB, ambiente: "PRODUCCION" }));
    expect(armarLaHoja({}, paraLaHoja(pruebas), "A4").homologacion).toBe(pruebas.leyendas[0]);
    expect(armarLaHoja({}, paraLaHoja(produccion), "A4").homologacion).toBeNull();
  });

  it("el contacto son los datos que existen, sueltos y separados por « · » (la web, sin esquema)", () => {
    const web = webDesdeTexto("www.zulu.example");
    if (!web.ok) throw new Error("web de prueba inválida");
    const completo = modelo(
      imprimibleDe(facturaB, {
        contacto: { telefono: "011 5555-0100", correo: "hola@zulu.example", web: web.valor },
      }),
    );
    expect(armarLaHoja({}, paraLaHoja(completo), "A4").contacto).toBe(
      "011 5555-0100 · hola@zulu.example · www.zulu.example",
    );
    const parcial = modelo(
      imprimibleDe(facturaB, { contacto: { ...SIN_CONTACTO, correo: "hola@zulu.example" } }),
    );
    expect(armarLaHoja({}, paraLaHoja(parcial), "A4").contacto).toBe("hola@zulu.example");
    const ninguno = modelo(imprimibleDe(facturaB, { contacto: SIN_CONTACTO }));
    expect(ninguno.contacto).toBeUndefined();
    expect(contactoImpreso(SIN_CONTACTO)).toBeNull();
    expect(armarLaHoja({}, paraLaHoja(ninguno), "A4").contacto).toBeNull();
  });

  it("Ingresos Brutos solo si el emisor tiene número", () => {
    const con = armarLaHoja({}, paraLaHoja(modelo(imprimibleDe(facturaB))), "A4");
    expect(con.datos.map((f) => f.rotulo)).toEqual([
      "Fecha",
      "CUIT",
      "Ingresos Brutos",
      "Inicio de actividades",
    ]);
    const base = imprimibleDe(facturaB);
    const sin = armarLaHoja(
      {},
      paraLaHoja(modelo({ ...base, emisor: { ...base.emisor, iibbNumero: null } })),
      "A4",
    );
    expect(sin.datos.map((f) => f.rotulo)).toEqual(["Fecha", "CUIT", "Inicio de actividades"]);
  });

  it("un reemplazo de la marca en el vocabulario llega a la hoja; «Hoja k de n» usa el n que se le pasa", () => {
    expect(textoDeLaHoja({}, 2, 3)).toBe("Hoja 2 de 3");
    expect(textoDeLaHoja({ "fiscal.pantalla.imprimir_hoja": "Pág. {k}/{n}" }, 2, 3)).toBe(
      "Pág. 2/3",
    );
  });
});

describe("los renglones suman el total del comprobante (A, B y C)", () => {
  const sumaYTotal = (m: ModeloImpreso): [string, string] => {
    const importes = m.renglones.map((r) => r.importe);
    const p = paginar({
      altosDeLosRenglones: importes.map(() => 1),
      importes,
      altoUtilDeLaHoja: 10_000,
      altoDelPie: 0,
      altoDelEncabezadoDeLaTabla: 0,
      altoDeLaFilaDeTransporte: 0,
    });
    return [p.sumaDeLosRenglones, m.totales.total];
  };

  it.each([
    ["B", facturaB],
    ["A", facturaA],
    ["C", facturaC],
  ])("la %s del ejemplo", (_letra, factura) => {
    const [suma, total] = sumaYTotal(modelo(imprimibleDe(factura)));
    expect(suma).toBe(total);
  });

  it.each([
    ["A", receptorInscripto, contextoDeEmision(), alicuotaArbitraria],
    ["B", consumidorFinal, contextoDeEmision(), alicuotaArbitraria],
  ] as const)(
    "propiedad con renglones al azar, letra %s, precio con IVA incluido y discriminado",
    (_letra, receptor, contexto, alicuotas) => {
      fc.assert(
        fc.property(
          fc.array(renglonArbitrario(alicuotas), { minLength: 1, maxLength: 8 }),
          fc.constantFrom("IVA_INCLUIDO", "IVA_DISCRIMINADO"),
          (renglones, modoDePrecio) => {
            const factura = facturaOSinTotal(receptor, renglones, { modoDePrecio }, contexto);
            if (factura === null) return;
            const [suma, total] = sumaYTotal(modelo(imprimibleDe(factura)));
            expect(suma).toBe(total);
          },
        ),
      );
    },
  );

  it("propiedad para la letra C (renglones sin alícuota)", () => {
    const monotributo = contextoDeEmision({
      emisor: emisorInstantaneo({ condicionIva: "MONOTRIBUTO" }),
    });
    fc.assert(
      fc.property(
        fc.array(renglonArbitrario(fc.constant(null)), { minLength: 1, maxLength: 8 }),
        (renglones) => {
          const factura = facturaOSinTotal(consumidorFinal, renglones, {}, monotributo);
          if (factura === null) return;
          const m = modelo(imprimibleDe(factura));
          expect(m.fiscal.letra).toBe("C");
          const [suma, total] = sumaYTotal(m);
          expect(suma).toBe(total);
        },
      ),
    );
  });
});
