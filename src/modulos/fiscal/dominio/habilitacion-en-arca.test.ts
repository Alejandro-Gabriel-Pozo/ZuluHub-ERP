import { describe, expect, it } from "vitest";
import {
  habilitadoEnArca,
  motivoDeNoHabilitacion,
  type MotivoDeNoHabilitacion,
  type PuntoDeVentaDeArca,
} from "./habilitacion-en-arca";

const punto = (cambios: Partial<PuntoDeVentaDeArca> = {}): PuntoDeVentaDeArca => ({
  numero: 3,
  bloqueado: false,
  dadoDeBaja: false,
  emision: "CAE",
  ...cambios,
});

describe("un punto de venta está habilitado en ARCA para pasar a producción (D-77)", () => {
  it("existe, no está bloqueado y no está dado de baja: habilitado", () => {
    expect(habilitadoEnArca([punto()], 3)).toBe(true);
    expect(habilitadoEnArca([punto({ numero: 1 }), punto(), punto({ numero: 9 })], 3)).toBe(true);
  });

  it("ARCA no tiene ese número (lista vacía o solo otros): no", () => {
    expect(habilitadoEnArca([], 3)).toBe(false);
    expect(habilitadoEnArca([punto({ numero: 1 }), punto({ numero: 2 })], 3)).toBe(false);
  });

  it("bloqueado: no", () => {
    expect(habilitadoEnArca([punto({ bloqueado: true })], 3)).toBe(false);
  });

  it("dado de baja: no", () => {
    expect(habilitadoEnArca([punto({ dadoDeBaja: true })], 3)).toBe(false);
  });

  it("bloqueado Y dado de baja: no", () => {
    expect(habilitadoEnArca([punto({ bloqueado: true, dadoDeBaja: true })], 3)).toBe(false);
  });

  it("el número repetido en la lista no se sabe cuál vale: no, aunque una de las filas esté bien", () => {
    expect(habilitadoEnArca([punto(), punto({ bloqueado: true })], 3)).toBe(false);
    expect(habilitadoEnArca([punto(), punto()], 3)).toBe(false);
  });

  it("el bloqueo de otro punto de venta no afecta a este", () => {
    expect(habilitadoEnArca([punto({ numero: 1, bloqueado: true }), punto()], 3)).toBe(true);
  });

  it("solo CAEA (DEC-0742): no", () => {
    expect(habilitadoEnArca([punto({ emision: "CAEA" })], 3)).toBe(false);
  });

  it("el CAEA de otro punto de venta no afecta a este", () => {
    expect(habilitadoEnArca([punto({ numero: 1, emision: "CAEA" }), punto()], 3)).toBe(true);
  });
});

describe("por qué un punto de venta no pasa a producción", () => {
  it.each<[string, readonly PuntoDeVentaDeArca[], MotivoDeNoHabilitacion | null]>([
    ["lista vacía", [], "SIN_PUNTOS_DE_VENTA"],
    ["solo otros números", [punto({ numero: 1 }), punto({ numero: 2 })], "NO_FIGURA"],
    ["repetido, aunque uno esté bien", [punto(), punto({ bloqueado: true })], "REPETIDO"],
    ["dado de baja", [punto({ dadoDeBaja: true })], "DADO_DE_BAJA"],
    ["bloqueado", [punto({ bloqueado: true })], "BLOQUEADO"],
    ["solo CAEA", [punto({ emision: "CAEA" })], "SOLO_CAEA"],
    ["habilitado", [punto()], null],
  ])("%s", (_nombre, informados, esperado) => {
    expect(motivoDeNoHabilitacion(informados, 3)).toBe(esperado);
  });

  it("el orden: baja antes que bloqueo, bloqueo antes que solo CAEA, y repetido antes que todos", () => {
    expect(motivoDeNoHabilitacion([punto({ bloqueado: true, dadoDeBaja: true })], 3)).toBe(
      "DADO_DE_BAJA",
    );
    expect(motivoDeNoHabilitacion([punto({ bloqueado: true, emision: "CAEA" })], 3)).toBe(
      "BLOQUEADO",
    );
    expect(motivoDeNoHabilitacion([punto({ dadoDeBaja: true, emision: "CAEA" })], 3)).toBe(
      "DADO_DE_BAJA",
    );
    expect(motivoDeNoHabilitacion([punto(), punto({ dadoDeBaja: true })], 3)).toBe("REPETIDO");
  });

  it("habilitadoEnArca es exactamente «sin motivo» para toda combinación", () => {
    const booleanos = [false, true];
    const emisiones = ["CAE", "CAEA"] as const;
    for (const bloqueado of booleanos) {
      for (const dadoDeBaja of booleanos) {
        for (const emision of emisiones) {
          for (const repetido of booleanos) {
            for (const numero of [3, 4]) {
              const base = punto({ bloqueado, dadoDeBaja, emision });
              const lista = repetido ? [base, base] : [base];
              for (const informados of [[], lista]) {
                expect(habilitadoEnArca(informados, numero)).toBe(
                  motivoDeNoHabilitacion(informados, numero) === null,
                );
              }
            }
          }
        }
      }
    }
  });
});
