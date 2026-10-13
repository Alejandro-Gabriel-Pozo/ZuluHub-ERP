import { describe, expect, it } from "vitest";
import {
  consumidorFinal,
  contextoDeEmision,
  emisorInstantaneo,
  entradaDeFactura,
  facturaArmada,
  fecha,
  receptorInscripto,
  receptorMonotributista,
  renglon,
} from "../../../../test/utilidades/facturacion";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { origenId } from "./identificadores";
import {
  AMBIENTES,
  CONCEPTOS,
  LIMITES_DE_COMPROBANTE,
  armarComprobanteNuevo,
  type EntradaDeComprobante,
} from "./comprobante-nuevo";

const armar = (entrada: EntradaDeComprobante, contexto = contextoDeEmision()) =>
  armarComprobanteNuevo(entrada, contexto);

const error = (entrada: EntradaDeComprobante, contexto = contextoDeEmision()) => {
  const r = armar(entrada, contexto);
  return r.ok ? null : r.error;
};

describe("catálogos", () => {
  it("ambientes y conceptos", () => {
    expect(AMBIENTES).toEqual(["HOMOLOGACION", "PRODUCCION"]);
    expect(CONCEPTOS).toEqual(["PRODUCTOS", "SERVICIOS", "PRODUCTOS_Y_SERVICIOS"]);
    expect(LIMITES_DE_COMPROBANTE).toEqual({ renglones: 200, descripcion: 200, motivo: 200 });
  });
});

describe("armarComprobanteNuevo: facturas", () => {
  it("B a consumidor final con IVA incluido: contenido completo y calculado", () => {
    const contexto = contextoDeEmision({ ambiente: "PRODUCCION" });
    const c = facturaArmada(
      consumidorFinal,
      [renglon("121.00", "2", "21", null, "  Torta  "), renglon("50.00", "1", "10.5")],
      {},
      contexto,
    );
    expect(c.tipo).toBe("FACTURA_B");
    expect(c.empresaId).toBe(contexto.empresaId);
    expect(c.emisorId).toBe(contexto.emisorId);
    expect(c.puntoDeVentaId).toBe(contexto.puntoDeVentaId);
    expect(c.ambiente).toBe("PRODUCCION");
    expect(c.origen).toEqual(contexto.origen);
    expect(c.emisor).toEqual(contexto.emisor);
    expect(c.receptor).toEqual(consumidorFinal);
    expect(c.modoDePrecio).toBe("IVA_INCLUIDO");
    expect(c.concepto).toBe("PRODUCTOS");
    expect(c.servicio).toBeNull();
    expect(c.asociado).toBeNull();
    expect(c.motivo).toBeNull();
    expect(c.renglones.map((r) => [r.descripcion, importeATexto(r.importe)])).toEqual([
      ["Torta", "242.00"],
      ["Pan", "50.00"],
    ]);
    expect(importeATexto(c.total)).toBe("292.00");
    expect(importeATexto(c.neto)).toBe("245.25");
    expect(importeATexto(c.iva)).toBe("46.75");
    expect(c.desglose.map((d) => d.alicuota)).toEqual(["10.5", "21"]);
  });

  it("A entre inscriptos con IVA discriminado", () => {
    const c = facturaArmada(receptorInscripto, [renglon("1000.00", "1", "21")], {
      modoDePrecio: "IVA_DISCRIMINADO",
    });
    expect(c.tipo).toBe("FACTURA_A");
    expect(c.modoDePrecio).toBe("IVA_DISCRIMINADO");
    expect(importeATexto(c.total)).toBe("1210.00");
    expect(importeATexto(c.neto)).toBe("1000.00");
    expect(importeATexto(c.iva)).toBe("210.00");
  });

  it("C de un monotributista: sin alícuotas, neto = total, IVA 0 y sin desglose", () => {
    const contexto = contextoDeEmision({
      emisor: emisorInstantaneo({ condicionIva: "MONOTRIBUTO" }),
    });
    const c = facturaArmada(consumidorFinal, [renglon("100.00", "3", null)], {}, contexto);
    expect(c.tipo).toBe("FACTURA_C");
    expect(importeATexto(c.total)).toBe("300.00");
    expect(importeATexto(c.neto)).toBe("300.00");
    expect(importeATexto(c.iva)).toBe("0.00");
    expect(c.desglose).toEqual([]);
    expect(c.renglones[0]?.alicuota).toBeNull();
  });

  it("la letra sale del emisor del contexto y del receptor", () => {
    const monotributo = contextoDeEmision({
      emisor: emisorInstantaneo({ condicionIva: "MONOTRIBUTO" }),
    });
    const exento = contextoDeEmision({ emisor: emisorInstantaneo({ condicionIva: "EXENTO" }) });
    expect(
      facturaArmada(receptorMonotributista, [renglon("1", "1", null)], {}, monotributo).tipo,
    ).toBe("FACTURA_C");
    expect(facturaArmada(receptorMonotributista, [renglon("1", "1", null)], {}, exento).tipo).toBe(
      "FACTURA_C",
    );
    expect(facturaArmada(receptorMonotributista, [renglon("1", "1", "21")]).tipo).toBe("FACTURA_A");
    expect(facturaArmada(consumidorFinal, [renglon("1", "1", "21")]).tipo).toBe("FACTURA_B");
  });

  it("el origen y el ambiente vienen del contexto", () => {
    const origen = { tipo: "SUSCRIPCION", id: origenId("sus-9") } as const;
    const c = facturaArmada(
      consumidorFinal,
      [renglon("1", "1", "21")],
      {},
      contextoDeEmision({ origen }),
    );
    expect(c.origen).toBe(origen);
    expect(c.ambiente).toBe("HOMOLOGACION");
  });

  it("normaliza el receptor y las descripciones", () => {
    const c = facturaArmada({ ...receptorInscripto, nombre: "  Distribuidora Sur SA " }, [
      renglon("1", "1", "21", null, "  Café  "),
    ]);
    expect(c.receptor.nombre).toBe("Distribuidora Sur SA");
    expect(c.renglones[0]?.descripcion).toBe("Café");
  });

  it("servicios con sus fechas, y productos y servicios", () => {
    const servicio = {
      desde: fecha("2026-10-01"),
      hasta: fecha("2026-10-31"),
      vencimientoDePago: fecha("2026-11-10"),
    };
    for (const concepto of ["SERVICIOS", "PRODUCTOS_Y_SERVICIOS"] as const) {
      const c = facturaArmada(consumidorFinal, [renglon("1", "1", "21")], { concepto, servicio });
      expect(c.concepto).toBe(concepto);
      expect(c.servicio).toEqual(servicio);
    }
    // desde = hasta es un solo día: válido
    const un_dia = { ...servicio, hasta: servicio.desde };
    expect(
      armar(
        entradaDeFactura(consumidorFinal, [renglon("1", "1", "21")], {
          concepto: "SERVICIOS",
          servicio: un_dia,
        }),
      ).ok,
    ).toBe(true);
  });
});

describe("armarComprobanteNuevo: errores", () => {
  const uno = [renglon("10.00", "1", "21")];

  it("los del receptor llegan tal cual, y se validan antes que los renglones", () => {
    expect(error(entradaDeFactura({ ...receptorInscripto, nombre: null }, []))).toEqual({
      codigo: "RECEPTOR_INVALIDO",
      campo: "nombre",
    });
    const dniEnA = {
      ...receptorInscripto,
      documento: { tipo: "DNI", numero: "12345678" },
    } as const;
    expect(error(entradaDeFactura(dniEnA, uno))).toEqual({ codigo: "RECEPTOR_INVALIDO_PARA_A" });
    const mismoCuit = {
      ...receptorInscripto,
      documento: { tipo: "CUIT", numero: "30708533935" },
    } as const;
    expect(error(entradaDeFactura(mismoCuit, uno))).toEqual({ codigo: "RECEPTOR_IGUAL_AL_EMISOR" });
    const noCategorizado = { ...consumidorFinal, condicionIva: "NO_CATEGORIZADO" } as const;
    expect(error(entradaDeFactura(noCategorizado, uno))).toEqual({
      codigo: "RECEPTOR_NO_CATEGORIZADO_NO_SOPORTADO",
    });
  });

  it("sin renglones", () => {
    expect(error(entradaDeFactura(consumidorFinal, []))).toEqual({ codigo: "SIN_RENGLONES" });
  });

  it("hasta 200 renglones; con 201 hay demasiados", () => {
    const n = (cantidad: number) =>
      entradaDeFactura(
        consumidorFinal,
        Array.from({ length: cantidad }, () => renglon("1.00", "1", "21")),
      );
    expect(armar(n(LIMITES_DE_COMPROBANTE.renglones)).ok).toBe(true);
    expect(error(n(LIMITES_DE_COMPROBANTE.renglones + 1))).toEqual({
      codigo: "DEMASIADOS_RENGLONES",
    });
  });

  it("descripción vacía o larga, con la posición del renglón", () => {
    const largo = "x".repeat(LIMITES_DE_COMPROBANTE.descripcion);
    expect(
      armar(entradaDeFactura(consumidorFinal, [renglon("1", "1", "21", null, largo)])).ok,
    ).toBe(true);
    for (const descripcion of ["", "   ", `${largo}x`]) {
      expect(
        error(
          entradaDeFactura(consumidorFinal, [...uno, renglon("1", "1", "21", null, descripcion)]),
        ),
      ).toEqual({ codigo: "RENGLON_INVALIDO", posicion: 1, campo: "descripcion" });
    }
  });

  it("cantidad cero", () => {
    expect(error(entradaDeFactura(consumidorFinal, [renglon("1", "0", "21")]))).toEqual({
      codigo: "RENGLON_INVALIDO",
      posicion: 0,
      campo: "cantidad",
    });
    // la cantidad mínima (0,0001) sí entra
    expect(armar(entradaDeFactura(consumidorFinal, [renglon("100000", "0.0001", "21")])).ok).toBe(
      true,
    );
  });

  it("en una letra con IVA todo renglón lleva alícuota", () => {
    expect(error(entradaDeFactura(consumidorFinal, [...uno, renglon("1", "1", null)]))).toEqual({
      codigo: "FALTA_ALICUOTA",
      posicion: 1,
    });
  });

  it("en la letra C ningún renglón lleva alícuota", () => {
    const contexto = contextoDeEmision({
      emisor: emisorInstantaneo({ condicionIva: "MONOTRIBUTO" }),
    });
    expect(
      error(
        entradaDeFactura(consumidorFinal, [renglon("1", "1", null), renglon("1", "1", "21")]),
        contexto,
      ),
    ).toEqual({ codigo: "ALICUOTA_EN_LETRA_C", posicion: 1 });
    // un renglón sin alícuota en C es lo normal
    expect(armar(entradaDeFactura(consumidorFinal, [renglon("1", "1", null)]), contexto).ok).toBe(
      true,
    );
  });

  it("revisa los renglones en orden y para cada uno descripción, cantidad y alícuota", () => {
    expect(
      error(
        entradaDeFactura(consumidorFinal, [
          renglon("1", "0", null, null, ""),
          renglon("1", "0", "21"),
        ]),
      ),
    ).toEqual({ codigo: "RENGLON_INVALIDO", posicion: 0, campo: "descripcion" });
    expect(
      error(
        entradaDeFactura(consumidorFinal, [
          renglon("1", "0", null),
          renglon("1", "1", null, null, ""),
        ]),
      ),
    ).toEqual({ codigo: "RENGLON_INVALIDO", posicion: 0, campo: "cantidad" });
  });

  it("la letra C solo admite IVA incluido", () => {
    const contexto = contextoDeEmision({
      emisor: emisorInstantaneo({ condicionIva: "MONOTRIBUTO" }),
    });
    expect(
      error(
        entradaDeFactura(consumidorFinal, [renglon("1", "1", null)], {
          modoDePrecio: "IVA_DISCRIMINADO",
        }),
        contexto,
      ),
    ).toEqual({ codigo: "MODO_DE_PRECIO_INVALIDO_PARA_C" });
    // en A y en B se admiten los dos
    for (const modoDePrecio of ["IVA_INCLUIDO", "IVA_DISCRIMINADO"] as const) {
      expect(armar(entradaDeFactura(receptorInscripto, uno, { modoDePrecio })).ok).toBe(true);
      expect(armar(entradaDeFactura(consumidorFinal, uno, { modoDePrecio })).ok).toBe(true);
    }
  });

  it("las fechas del servicio: productos sin fechas; servicios con fechas coherentes", () => {
    const servicio = {
      desde: fecha("2026-10-31"),
      hasta: fecha("2026-10-01"),
      vencimientoDePago: fecha("2026-11-10"),
    };
    const invalida = { codigo: "FECHAS_DE_SERVICIO_INVALIDAS" };
    expect(
      error(entradaDeFactura(consumidorFinal, uno, { concepto: "PRODUCTOS", servicio })),
    ).toEqual(invalida);
    expect(
      error(entradaDeFactura(consumidorFinal, uno, { concepto: "SERVICIOS", servicio: null })),
    ).toEqual(invalida);
    expect(
      error(
        entradaDeFactura(consumidorFinal, uno, {
          concepto: "PRODUCTOS_Y_SERVICIOS",
          servicio: null,
        }),
      ),
    ).toEqual(invalida);
    // desde posterior a hasta
    expect(
      error(entradaDeFactura(consumidorFinal, uno, { concepto: "SERVICIOS", servicio })),
    ).toEqual(invalida);
  });

  it("el orden: renglones, modo de precio, fechas y total", () => {
    const contexto = contextoDeEmision({
      emisor: emisorInstantaneo({ condicionIva: "MONOTRIBUTO" }),
    });
    const conTodoMal = entradaDeFactura(consumidorFinal, [renglon("0", "1", null)], {
      modoDePrecio: "IVA_DISCRIMINADO",
      concepto: "SERVICIOS",
      servicio: null,
    });
    expect(error(conTodoMal, contexto)).toEqual({ codigo: "MODO_DE_PRECIO_INVALIDO_PARA_C" });
    expect(error({ ...conTodoMal, modoDePrecio: "IVA_INCLUIDO" }, contexto)).toEqual({
      codigo: "FECHAS_DE_SERVICIO_INVALIDAS",
    });
    expect(
      error({ ...conTodoMal, modoDePrecio: "IVA_INCLUIDO", concepto: "PRODUCTOS" }, contexto),
    ).toEqual({
      codigo: "TOTAL_FUERA_DE_RANGO",
    });
  });

  it("un total de cero o sobre el tope", () => {
    expect(error(entradaDeFactura(consumidorFinal, [renglon("0", "1", "21")]))).toEqual({
      codigo: "TOTAL_FUERA_DE_RANGO",
    });
    expect(
      error(entradaDeFactura(consumidorFinal, [renglon("999999999999.999999", "11", "21")])),
    ).toEqual({
      codigo: "TOTAL_FUERA_DE_RANGO",
    });
  });
});
