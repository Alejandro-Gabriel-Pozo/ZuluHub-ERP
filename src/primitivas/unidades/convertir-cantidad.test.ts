import { describe, expect, it } from "vitest";
import { cantidadATexto, cantidadDesdeTexto } from "../cantidad/cantidad";
import { convertirCantidad } from "./convertir-cantidad";
import type { CodigoDeUnidad } from "./unidades";

function convertir(texto: string, de: CodigoDeUnidad, a: CodigoDeUnidad): string {
  const r = convertirCantidad(cantidadDesdeTexto(texto), de, a);
  return r.ok ? cantidadATexto(r.valor) : r.error;
}

describe("convertirCantidad", () => {
  it("casos de la especificación", () => {
    expect(convertir("1", "KILOGRAMO", "GRAMO")).toBe("1000.0000");
    expect(convertir("1", "GRAMO", "KILOGRAMO")).toBe("0.0010");
    expect(convertir("0.0001", "KILOGRAMO", "GRAMO")).toBe("0.1000");
    expect(convertir("1", "GRAMO", "TONELADA")).toBe("CONVERSION_NO_EXACTA");
  });

  it("la misma unidad es identidad, también con cero", () => {
    expect(convertir("12.3456", "LITRO", "LITRO")).toBe("12.3456");
    expect(convertir("0", "HORA", "MINUTO")).toBe("0.0000");
  });

  it("entre dimensiones distintas: DIMENSION_DISTINTA", () => {
    expect(convertir("1", "KILOGRAMO", "LITRO")).toBe("DIMENSION_DISTINTA");
    expect(convertir("1", "UNIDAD", "GRAMO")).toBe("DIMENSION_DISTINTA");
    expect(convertir("1", "METRO", "METRO_CUADRADO")).toBe("DIMENSION_DISTINTA");
  });

  it("no redondea: un minuto en horas no existe, 60 minutos sí", () => {
    expect(convertir("1", "MINUTO", "HORA")).toBe("CONVERSION_NO_EXACTA");
    expect(convertir("60", "MINUTO", "HORA")).toBe("1.0000");
    expect(convertir("1", "HORA", "MINUTO")).toBe("60.0000");
  });

  it("fuera de numeric(18,4): FUERA_DE_RANGO, y el máximo exacto entra", () => {
    expect(convertir("99999999999999.9999", "KILOGRAMO", "GRAMO")).toBe("FUERA_DE_RANGO");
    expect(convertir("99999999999999.9999", "GRAMO", "GRAMO")).toBe("99999999999999.9999");
    expect(convertir("99999999999.9999", "KILOGRAMO", "GRAMO")).toBe("99999999999999.9000");
  });

  it("la exactitud se controla antes que el rango", () => {
    // 1e14-0.0001 g → t no es exacto: gana CONVERSION_NO_EXACTA aunque el cociente cupiera.
    expect(convertir("99999999999999.9999", "GRAMO", "TONELADA")).toBe("CONVERSION_NO_EXACTA");
  });

  it("el resultado se construye por la primitiva pública (inmutable y en rango)", () => {
    const r = convertirCantidad(cantidadDesdeTexto("2"), "KILOGRAMO", "GRAMO");
    expect(r.ok && Object.isFrozen(r.valor)).toBe(true);
  });
});
