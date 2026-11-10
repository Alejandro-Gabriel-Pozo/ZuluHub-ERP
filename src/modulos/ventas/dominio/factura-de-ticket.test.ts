import { describe, expect, it } from "vitest";
import {
  comprobanteIdDeLaFactura,
  descripcionDelRenglon,
  documentoIdDeLaFactura,
  origenDeLaFactura,
  type RenglonParaFacturar,
  unidadDelRenglon,
} from "./factura-de-ticket";

const TICKET = "11111111-1111-4111-8111-111111111111";
const EJEMPLAR = "22222222-2222-4222-8222-222222222222";

const renglon = (cambios: Partial<RenglonParaFacturar> = {}): RenglonParaFacturar => ({
  descripcion: "Pan de campo",
  varianteNombre: null,
  opciones: [],
  unidadDeVenta: "UNIDAD",
  unidadSimbolo: "u",
  ...cambios,
});

describe("origenDeLaFactura", () => {
  it("el primer intento se identifica con el ejemplar", () => {
    expect(origenDeLaFactura(TICKET, 1, EJEMPLAR)).toEqual({
      tipo: "EJEMPLAR_DE_TICKET",
      id: EJEMPLAR,
    });
  });

  it("las reemisiones usan un uuid determinístico de (ticket, intento): siempre el mismo y distinto por intento", () => {
    const dos = origenDeLaFactura(TICKET, 2, EJEMPLAR);
    expect(dos.tipo).toBe("REEMISION_DE_TICKET");
    expect(dos.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(origenDeLaFactura(TICKET, 2, "otro-ejemplar")).toEqual(dos);
    expect(origenDeLaFactura(TICKET, 3, EJEMPLAR).id).not.toBe(dos.id);
    expect(origenDeLaFactura("44444444-4444-4444-8444-444444444444", 2, EJEMPLAR).id).not.toBe(
      dos.id,
    );
  });
});

describe("identificadores derivados", () => {
  it("el comprobante y el documento de un intento son siempre los mismos y no se confunden entre sí", () => {
    const c = comprobanteIdDeLaFactura(TICKET, 1);
    const d = documentoIdDeLaFactura(TICKET, 1);
    expect(comprobanteIdDeLaFactura(TICKET, 1)).toBe(c);
    expect(documentoIdDeLaFactura(TICKET, 1)).toBe(d);
    expect(c).not.toBe(d);
    expect(comprobanteIdDeLaFactura(TICKET, 2)).not.toBe(c);
    expect(documentoIdDeLaFactura(TICKET, 2)).not.toBe(d);
  });

  it("no coinciden con el origen de la reemisión del mismo intento", () => {
    expect(comprobanteIdDeLaFactura(TICKET, 2)).not.toBe(origenDeLaFactura(TICKET, 2, EJEMPLAR).id);
    expect(documentoIdDeLaFactura(TICKET, 2)).not.toBe(origenDeLaFactura(TICKET, 2, EJEMPLAR).id);
  });
});

describe("descripcionDelRenglon", () => {
  it("producto, tamaño y opciones separados por « · »", () => {
    expect(
      descripcionDelRenglon(
        renglon({
          varianteNombre: "Grande",
          opciones: [{ nombre: "Queso" }, { nombre: "Jamón" }],
        }),
        200,
      ),
    ).toBe("Pan de campo · Grande · Queso · Jamón");
    expect(descripcionDelRenglon(renglon(), 200)).toBe("Pan de campo");
  });

  it("de hasta 200 caracteres no se toca; de más se recorta a 199 y termina en «…»", () => {
    const justo = "a".repeat(200);
    expect(descripcionDelRenglon(renglon({ descripcion: justo }), 200)).toBe(justo);
    const largo = descripcionDelRenglon(renglon({ descripcion: "a".repeat(201) }), 200);
    expect(largo).toBe(`${"a".repeat(199)}…`);
    expect(largo).toHaveLength(200);
    // El máximo lo manda quien llama: con otro máximo, otro recorte.
    expect(descripcionDelRenglon(renglon({ descripcion: "abcdef" }), 4)).toBe("abc…");
  });
});

describe("unidadDelRenglon", () => {
  it("la unidad implícita no se imprime; cualquier otra lleva su símbolo", () => {
    expect(unidadDelRenglon(renglon())).toBeNull();
    expect(unidadDelRenglon(renglon({ unidadDeVenta: "PESO", unidadSimbolo: "kg" }))).toBe("kg");
  });
});
