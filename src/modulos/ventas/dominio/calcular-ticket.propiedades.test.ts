import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { importeATexto, sumar, importeCero } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import { calcularTicket } from "./calcular-ticket";

/** P20: Σ líneas = total del grupo = total del ticket, al centavo, para cualquier cuenta; el oráculo es aritmética `bigint` escrita aparte. */
const lineas = fc.array(
  fc.record({
    precio: fc.bigInt({ min: 0n, max: 10n ** 9n }),
    cantidad: fc.bigInt({ min: 1n, max: 99_990_000n }),
  }),
  { minLength: 1, maxLength: 12 },
);
const aTexto = (unidades: bigint, escala: number): string => {
  const s = unidades.toString().padStart(escala + 1, "0");
  return `${s.slice(0, s.length - escala)}.${s.slice(s.length - escala)}`;
};

describe("calcularTicket: propiedades (P20)", () => {
  it("la suma de los renglones es el total y el total es el redondeo, una vez, de la suma exacta", () => {
    fc.assert(
      fc.property(lineas, (datos) => {
        const entrada = datos.map((d, i) => ({
          id: `l${i}`,
          precioUnitario: precioUnitarioDesdeTexto(aTexto(d.precio, 6)),
          cantidad: cantidadDesdeTexto(aTexto(d.cantidad, 4)),
        }));
        const r = calcularTicket(entrada);
        const suma = r.renglones.reduce((a, x) => sumar(a, x.importe), importeCero(ARS));
        expect(importeATexto(suma)).toBe(importeATexto(r.total));
        // Oráculo: Σ (precio × cantidad) está en escala 10; centavos = round-half-up(Σ / 10^8).
        const exacto = datos.reduce((a, d) => a + d.precio * d.cantidad, 0n);
        const centavos = (exacto + 5n * 10n ** 7n) / 10n ** 8n;
        expect(r.total.unidades).toBe(centavos);
        for (const x of r.renglones) expect(x.importe.unidades >= 0n).toBe(true);
      }),
    );
  });
});
