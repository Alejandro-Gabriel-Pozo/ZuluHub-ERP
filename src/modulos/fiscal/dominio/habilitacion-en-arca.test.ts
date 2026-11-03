import { describe, expect, it } from "vitest";
import { habilitadoEnArca, type PuntoDeVentaDeArca } from "./habilitacion-en-arca";

const punto = (cambios: Partial<PuntoDeVentaDeArca> = {}): PuntoDeVentaDeArca => ({
  numero: 3,
  bloqueado: false,
  dadoDeBaja: false,
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
});
