import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../../../capacidades/vocabulario/catalogo";
import {
  buscarMotivo,
  MOTIVO_DE_VENCIMIENTO,
  MOTIVO_DE_VENTA,
  MOTIVOS_DE_MOVIMIENTO,
  motivoExigeAjustar,
  motivoManualPermitido,
  origenCoherenteConElMotivo,
} from "./motivos";
import { CLASES_DE_MOVIMIENTO, type ClaseDeMovimiento } from "./movimiento";

const codigos = (clase: ClaseDeMovimiento): string[] =>
  MOTIVOS_DE_MOVIMIENTO.filter((m) => m.clase === clase).map((m) => m.codigo);

describe("los motivos sembrados (E5 §3.1)", () => {
  it("son los de la spec, por clase", () => {
    expect(codigos("ENTRADA")).toEqual([
      "COMPRA",
      "CARGA_INICIAL",
      "DEVOLUCION_DE_CLIENTE",
      "OTRA_ENTRADA",
      "PRODUCTO_DE_TRANSFORMACION",
    ]);
    expect(codigos("SALIDA")).toEqual([
      "VENTA",
      "CONSUMO_INTERNO",
      "MERMA",
      "ROTURA",
      "VENCIMIENTO",
      "OTRA_SALIDA",
      "CONSUMO_DE_TRANSFORMACION",
    ]);
    expect(codigos("TRANSFERENCIA")).toEqual(["TRANSFERENCIA"]);
    expect(codigos("AJUSTE")).toEqual(["CORRECCION"]);
    expect(codigos("AJUSTE_POR_CONTEO")).toEqual(["CONTEO"]);
    expect(codigos("ANULACION")).toEqual(["ANULACION"]);
    expect(MOTIVOS_DE_MOVIMIENTO).toHaveLength(16);
  });

  it("(clase, código) no se repite y toda clase es conocida", () => {
    const llaves = MOTIVOS_DE_MOVIMIENTO.map((m) => `${m.clase}/${m.codigo}`);
    expect(new Set(llaves).size).toBe(llaves.length);
    for (const m of MOTIVOS_DE_MOVIMIENTO) expect(CLASES_DE_MOVIMIENTO).toContain(m.clase);
  });

  it("el código tiene la forma que exige la base (`^[A-Z][A-Z_]{1,39}$`)", () => {
    for (const m of MOTIVOS_DE_MOVIMIENTO) expect(m.codigo).toMatch(/^[A-Z][A-Z_]{1,39}$/);
  });

  it("solo compra y carga inicial entran con costo; solo venta y consumo interno entregan mercadería", () => {
    expect(MOTIVOS_DE_MOVIMIENTO.filter((m) => m.entraConCosto).map((m) => m.codigo)).toEqual([
      "COMPRA",
      "CARGA_INICIAL",
      "PRODUCTO_DE_TRANSFORMACION",
    ]);
    expect(MOTIVOS_DE_MOVIMIENTO.filter((m) => m.entregaMercaderia).map((m) => m.codigo)).toEqual([
      "VENTA",
      "CONSUMO_INTERNO",
      "CONSUMO_DE_TRANSFORMACION",
    ]);
  });

  it("las banderas cumplen los CHECK de la base: costo solo en entradas, entrega solo en salidas", () => {
    for (const m of MOTIVOS_DE_MOVIMIENTO) {
      if (m.entraConCosto) expect(m.clase).toBe("ENTRADA");
      if (m.entregaMercaderia) expect(m.clase).toBe("SALIDA");
    }
  });
});

describe("buscarMotivo", () => {
  it("encuentra por clase y código, y solo si coinciden los dos", () => {
    expect(buscarMotivo("SALIDA", "MERMA")).toEqual({
      clase: "SALIDA",
      codigo: "MERMA",
      entraConCosto: false,
      entregaMercaderia: false,
    });
    expect(buscarMotivo("ENTRADA", "MERMA")).toBeNull();
    expect(buscarMotivo("SALIDA", "COMPRA")).toBeNull();
    expect(buscarMotivo("SALIDA", "merma")).toBeNull();
    expect(buscarMotivo("RESERVA", "RESERVA")).toBeNull();
  });
});

describe("motivoManualPermitido: lo que una persona puede elegir", () => {
  it("todas las entradas y salidas sembradas menos VENTA", () => {
    for (const m of MOTIVOS_DE_MOVIMIENTO) {
      const esperado =
        (m.clase === "ENTRADA" || m.clase === "SALIDA") &&
        m.codigo !== "VENTA" &&
        !m.codigo.endsWith("_DE_TRANSFORMACION");
      expect(motivoManualPermitido(m.clase, m.codigo)).toBe(esperado);
    }
  });

  it("lo que no está sembrado no pasa", () => {
    expect(motivoManualPermitido("ENTRADA", "INVENTADO")).toBe(false);
    expect(motivoManualPermitido("ENTRADA", "MERMA")).toBe(false);
    expect(motivoManualPermitido("SALIDA", "COMPRA")).toBe(false);
  });

  it("VENTA entra solo por el puerto de ventas", () => {
    expect(MOTIVO_DE_VENTA).toBe("VENTA");
    expect(motivoManualPermitido("SALIDA", MOTIVO_DE_VENTA)).toBe(false);
  });
});

describe("motivoExigeAjustar (S-7)", () => {
  it("solo el vencimiento", () => {
    expect(MOTIVO_DE_VENCIMIENTO).toBe("VENCIMIENTO");
    expect(
      MOTIVOS_DE_MOVIMIENTO.filter((m) => motivoExigeAjustar(m.codigo)).map((m) => m.codigo),
    ).toEqual(["VENCIMIENTO"]);
    expect(motivoExigeAjustar("vencimiento")).toBe(false);
  });
});

describe("origenCoherenteConElMotivo: motivo VENTA ⇔ salida de un ejemplar de ticket", () => {
  it("la venta lleva el ejemplar y el ejemplar solo en la venta", () => {
    expect(origenCoherenteConElMotivo("SALIDA", "VENTA", "EJEMPLAR_DE_TICKET")).toBe(true);
    expect(origenCoherenteConElMotivo("SALIDA", "VENTA", "MANUAL")).toBe(false);
    expect(origenCoherenteConElMotivo("SALIDA", "MERMA", "EJEMPLAR_DE_TICKET")).toBe(false);
    expect(origenCoherenteConElMotivo("SALIDA", "MERMA", "MANUAL")).toBe(true);
  });

  it("el CHECK solo ata la venta: una anulación puede llevar el origen del ejemplar que revierte y una entrada no es salida", () => {
    expect(origenCoherenteConElMotivo("ANULACION", "ANULACION", "EJEMPLAR_DE_TICKET")).toBe(true);
    expect(origenCoherenteConElMotivo("ENTRADA", "COMPRA", "RECEPCION")).toBe(true);
    expect(origenCoherenteConElMotivo("ENTRADA", "COMPRA", "EJEMPLAR_DE_TICKET")).toBe(true);
    // una clase que no es SALIDA con el motivo VENTA no existe, pero si llegara cierra
    expect(origenCoherenteConElMotivo("ENTRADA", "VENTA", "EJEMPLAR_DE_TICKET")).toBe(false);
  });
});

describe("origenCoherenteConElMotivo: los motivos de la producción ⇔ el origen de la orden (E6)", () => {
  it("consumir y producir llevan el origen TRANSFORMACION y ese origen solo va con ellos", () => {
    expect(
      origenCoherenteConElMotivo("SALIDA", "CONSUMO_DE_TRANSFORMACION", "TRANSFORMACION"),
    ).toBe(true);
    expect(
      origenCoherenteConElMotivo("ENTRADA", "PRODUCTO_DE_TRANSFORMACION", "TRANSFORMACION"),
    ).toBe(true);
    expect(origenCoherenteConElMotivo("SALIDA", "CONSUMO_DE_TRANSFORMACION", "MANUAL")).toBe(false);
    expect(origenCoherenteConElMotivo("ENTRADA", "PRODUCTO_DE_TRANSFORMACION", "RECEPCION")).toBe(
      false,
    );
    expect(origenCoherenteConElMotivo("SALIDA", "MERMA", "TRANSFORMACION")).toBe(false);
    expect(origenCoherenteConElMotivo("ENTRADA", "COMPRA", "TRANSFORMACION")).toBe(false);
  });
  it("una anulación puede llevar el origen de la orden que revierte", () => {
    expect(origenCoherenteConElMotivo("ANULACION", "ANULACION", "TRANSFORMACION")).toBe(true);
  });
  it("una persona no elige los motivos de la producción", () => {
    expect(motivoManualPermitido("SALIDA", "CONSUMO_DE_TRANSFORMACION")).toBe(false);
    expect(motivoManualPermitido("ENTRADA", "PRODUCTO_DE_TRANSFORMACION")).toBe(false);
  });
});

describe("los textos de los motivos", () => {
  it("todo motivo que una persona puede elegir tiene su texto aprobado en el vocabulario (stock.motivo.<código>)", () => {
    for (const m of MOTIVOS_DE_MOVIMIENTO) {
      if (!motivoManualPermitido(m.clase, m.codigo)) continue;
      expect(Object.keys(CATALOGO_DE_TEXTOS), m.codigo).toContain(
        `stock.motivo.${m.codigo.toLowerCase()}`,
      );
    }
  });
});
