import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { abrirConteoDe, conStock, contarEn, hace, movimientoEn } from "./stock-conteo-hora-apoyo";
import {
  montarStock,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E5, conteo con hora, CT2 (propiedad): para historias aleatorias de movimientos con su hora (antes y después de la hora del conteo), con lo contado
 * y con marcas elegidas al azar, después de aplicar el saldo de cada artículo contado es `contada + Σ(movimientos posteriores a la hora que NO se
 * marcaron)`, el ajuste es exactamente la diferencia que queda, y `verificarSaldos()` da vacío. El modelo se calcula aparte con enteros. Pocas
 * corridas por defecto (el CI tiene un tope de tiempo ajustado); se suben con `PEDERNAL_CORRIDAS`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

const CORRIDAS = (() => {
  const crudo = process.env["PEDERNAL_CORRIDAS"];
  const n = crudo === undefined ? 10 : Number(crudo);
  return Number.isInteger(n) && n >= 1 ? n : 10;
})();

/** Un movimiento de la historia: minutos respecto de la hora del conteo (negativo = antes; positivo = después), con signo, y si se marca. */
type Mov = Readonly<{ minutos: number; q: number; marca: boolean }>;

const mov = fc.record({
  // 0 queda afuera a propósito: un movimiento a la misma hora del conteo está incluido en lo que el sistema creía (hecho_en <= hora).
  minutos: fc.oneof(fc.integer({ min: -90, max: -1 }), fc.integer({ min: 1, max: 90 })),
  q: fc.oneof(fc.integer({ min: -5, max: -1 }), fc.integer({ min: 1, max: 5 })),
  marca: fc.boolean(),
});

describe.skipIf(base === null)("stock: propiedad del conteo con hora (CT2)", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  it("CT2: tras aplicar, saldo = contada + Σ(posteriores no marcados) y el ajuste es la diferencia que queda; verificarSaldos da vacío", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 60 }),
        fc.array(mov, { minLength: 0, maxLength: 6 }),
        async (contada, movimientos: Mov[]) => {
          const INICIAL = 100; // alcanza para que ninguna historia deje el saldo en negativo (−30 como mucho)
          const HORA = hace(-100);
          const s = await conStock(c, e, String(INICIAL), {}, hace(-300));
          const ids: string[] = [];
          for (const m of movimientos) {
            ids.push(
              await movimientoEn(c, e, {
                dep: s.dep,
                articulo: s.articulo,
                cantidad: String(m.q),
                hechoEn: new Date(HORA.getTime() + m.minutos * 60_000),
              }),
            );
          }
          const id = await abrirConteoDe(c, e, s.dep);
          valorDe(
            await contarEn(c, e.gerente, id, s.producto, String(contada), { contadoEn: HORA }),
          );

          // El modelo, aparte y con enteros.
          const E = INICIAL + movimientos.filter((m) => m.minutos < 0).reduce((t, m) => t + m.q, 0);
          const bruta = contada - E;
          let marcado = 0;
          const elegidos: number[] = [];
          movimientos.forEach((m, i) => {
            const posterior = m.minutos > 0;
            const mismoSentido = Math.sign(m.q) === Math.sign(bruta);
            if (
              m.marca &&
              posterior &&
              mismoSentido &&
              Math.abs(marcado + m.q) <= Math.abs(bruta)
            ) {
              marcado += m.q;
              elegidos.push(i);
            }
          });
          const final = bruta - marcado;
          const posterioresNoMarcados = movimientos.reduce(
            (t, m, i) => (m.minutos > 0 && !elegidos.includes(i) ? t + m.q : t),
            0,
          );

          const r = valorDe(
            await c.aplicarConteo(e.gerente, id, [
              {
                productoId: s.producto,
                ...(final === 0 ? {} : { motivo: final < 0 ? "MERMA" : "DEVOLUCION_DE_CLIENTE" }),
                marcas: elegidos.map((i) => ({ movimientoId: ids[i] as string, numero: 1 })),
              },
            ]),
          );
          // Sin diferencia no hay ajuste; con ella, el ajuste es exactamente la que queda.
          expect(r.movimientoId === null).toBe(final === 0);
          if (final !== 0) {
            expect(
              await c.filas<{ cantidad: string }>(
                "select cantidad::text from renglon_de_movimiento where movimiento_id = $1",
                [r.movimientoId],
              ),
            ).toEqual([{ cantidad: `${final}.0000` }]);
          }
          expect(await c.existencia(s.dep, s.articulo)).toBe(
            `${contada + posterioresNoMarcados}.0000`,
          );
          expect(valorDe(await c.consultas.verificarSaldos(e.gerente))).toEqual([]);
        },
      ),
      { numRuns: CORRIDAS },
    );
  });
});
