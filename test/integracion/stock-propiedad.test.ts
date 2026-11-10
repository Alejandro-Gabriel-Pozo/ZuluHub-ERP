import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  montarStock,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E5-T5 y T6, P17 (propiedad): para historias aleatorias de entradas, salidas, transferencias, ajustes, anulaciones y conteos (abiertos, recontados
 * y aplicados o cancelados), con cualquiera de los tres niveles del control, en cada depósito el saldo es la suma de los renglones del libro,
 * coincide con lo que predice un modelo calculado aparte con enteros, y `verificarSaldos()` da vacío. Pocas corridas por defecto (el CI tiene un
 * tope de tiempo ajustado); se suben con `PEDERNAL_CORRIDAS`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

const CORRIDAS = (() => {
  const crudo = process.env["PEDERNAL_CORRIDAS"];
  const n = crudo === undefined ? 8 : Number(crudo);
  return Number.isInteger(n) && n >= 1 ? n : 8;
})();

const NEGATIVA = "stock.existencia_negativa";

type Orden =
  | Readonly<{ t: "entrada"; dep: number; art: number; q: number }>
  | Readonly<{ t: "salida"; dep: number; art: number; q: number; confirma: boolean }>
  | Readonly<{ t: "transferir"; de: number; a: number; art: number; q: number; confirma: boolean }>
  | Readonly<{ t: "ajustar"; dep: number; art: number; q: number; suma: boolean }>
  | Readonly<{ t: "anular"; cual: number }>
  /** Abre un conteo, cuenta cada artículo (puede recontar) y lo aplica o lo cancela. */
  | Readonly<{
      t: "conteo";
      dep: number;
      cuentas: readonly { art: number; q: number }[];
      aplica: boolean;
    }>;

const cantidad = fc.integer({ min: 1, max: 20 });
const deposito = fc.integer({ min: 0, max: 2 });
const articulo = fc.integer({ min: 0, max: 1 });
const orden: fc.Arbitrary<Orden> = fc.oneof(
  fc.record({ t: fc.constant("entrada" as const), dep: deposito, art: articulo, q: cantidad }),
  fc.record({
    t: fc.constant("salida" as const),
    dep: deposito,
    art: articulo,
    q: cantidad,
    confirma: fc.boolean(),
  }),
  fc.record({
    t: fc.constant("transferir" as const),
    de: deposito,
    a: deposito,
    art: articulo,
    q: cantidad,
    confirma: fc.boolean(),
  }),
  fc.record({
    t: fc.constant("ajustar" as const),
    dep: deposito,
    art: articulo,
    q: cantidad,
    suma: fc.boolean(),
  }),
  fc.record({ t: fc.constant("anular" as const), cual: fc.nat({ max: 50 }) }),
  fc.record({
    t: fc.constant("conteo" as const),
    dep: deposito,
    cuentas: fc.array(fc.record({ art: articulo, q: fc.integer({ min: 0, max: 20 }) }), {
      minLength: 1,
      maxLength: 3,
    }),
    aplica: fc.boolean(),
  }),
);

describe.skipIf(base === null)("stock: propiedad del saldo (P17)", () => {
  let c: MontajeDeStock;
  const empresas: EscenarioDeStock[] = [];
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    for (const nivel of ["PERMITIR", "AVISAR", "BLOQUEAR"] as const) {
      const e = await c.escenario();
      await c.fijarNivel(e.empresa, nivel);
      empresas.push(e);
    }
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  it("P17: para historias aleatorias el saldo es la suma de los renglones en cada depósito, coincide con el modelo y verificarSaldos da vacío", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 2 }),
        fc.array(orden, { minLength: 1, maxLength: 12 }),
        async (cualEmpresa, historia) => {
          const e = empresas[cualEmpresa] as EscenarioDeStock;
          const depositos = [await c.deposito(e), await c.deposito(e), await c.deposito(e)];
          const articulos = [await c.articulo(e), await c.articulo(e)];
          const pedido = (art: number, q: number) => ({
            productoId: (articulos[art] as { producto: string }).producto,
            cantidad: String(q),
            unidadId: "UNIDAD",
          });
          const llave = (dep: number, art: number) => `${dep}|${art}`;
          /** El modelo: lo que tiene que haber en cada (depósito, artículo), con enteros. */
          const modelo = new Map<string, number>();
          const sumar = (dep: number, art: number, delta: number) =>
            modelo.set(llave(dep, art), (modelo.get(llave(dep, art)) ?? 0) + delta);
          /** Cada movimiento que salió bien, con lo que movió y si ya se anuló. */
          const hechos: { id: string; efecto: [number, number, number][]; anulado: boolean }[] = [];

          for (const o of historia) {
            if (o.t === "entrada") {
              const r = await c.casos.registrarEntrada(e.gerente, {
                clave: nuevoId(),
                depositoId: depositos[o.dep] as string,
                motivo: "COMPRA",
                renglones: [pedido(o.art, o.q)],
              });
              const v = valorDe(r);
              sumar(o.dep, o.art, o.q);
              hechos.push({ id: v.movimientoId, efecto: [[o.dep, o.art, o.q]], anulado: false });
            } else if (o.t === "salida") {
              const r = await c.casos.registrarSalida(e.gerente, {
                clave: nuevoId(),
                depositoId: depositos[o.dep] as string,
                motivo: "MERMA",
                confirmaciones: o.confirma ? [NEGATIVA] : undefined,
                renglones: [pedido(o.art, o.q)],
              });
              if (r.ok) {
                sumar(o.dep, o.art, -o.q);
                hechos.push({
                  id: r.valor.movimientoId,
                  efecto: [[o.dep, o.art, -o.q]],
                  anulado: false,
                });
              } else {
                expect(["CONTROL_BLOQUEA", "CONTROL_REQUIERE_CONFIRMACION"]).toContain(
                  (r.error as { error: string }).error,
                );
              }
            } else if (o.t === "transferir") {
              const r = await c.casos.transferir(e.gerente, {
                clave: nuevoId(),
                origenId: depositos[o.de] as string,
                destinoId: depositos[o.a] as string,
                confirmaciones: o.confirma ? [NEGATIVA] : undefined,
                renglones: [pedido(o.art, o.q)],
              });
              if (o.de === o.a) {
                expect(r).toEqual({ ok: false, error: "TRANSFERENCIA_AL_MISMO_DEPOSITO" });
              } else if (r.ok) {
                sumar(o.de, o.art, -o.q);
                sumar(o.a, o.art, o.q);
                hechos.push({
                  id: r.valor.movimientoId,
                  efecto: [
                    [o.de, o.art, -o.q],
                    [o.a, o.art, o.q],
                  ],
                  anulado: false,
                });
              } else {
                expect(["CONTROL_BLOQUEA", "CONTROL_REQUIERE_CONFIRMACION"]).toContain(
                  (r.error as { error: string }).error,
                );
              }
            } else if (o.t === "ajustar") {
              const v = valorDe(
                await c.casos.ajustar(e.gerente, {
                  clave: nuevoId(),
                  depositoId: depositos[o.dep] as string,
                  detalle: "Corrección",
                  renglones: [{ ...pedido(o.art, o.q), sentido: o.suma ? "SUMA" : "RESTA" }],
                }),
              );
              const delta = o.suma ? o.q : -o.q;
              sumar(o.dep, o.art, delta);
              hechos.push({ id: v.movimientoId, efecto: [[o.dep, o.art, delta]], anulado: false });
            } else if (o.t === "conteo") {
              const depositoId = depositos[o.dep] as string;
              const conteoId = valorDe(
                await c.casos.abrirConteo(e.gerente, { id: nuevoId(), depositoId }),
              ).conteoId;
              const contado = new Map<number, number>();
              for (const cuenta of o.cuentas) {
                valorDe(
                  await c.casos.registrarConteo(e.gerente, {
                    id: nuevoId(),
                    conteoId,
                    productoId: (articulos[cuenta.art] as { producto: string }).producto,
                    cantidadContada: String(cuenta.q),
                    unidadId: "UNIDAD",
                  }),
                );
                contado.set(cuenta.art, cuenta.q); // vale el último
              }
              if (o.aplica) {
                // Nada se movió entre contar y aplicar: cada artículo contado queda en lo contado, y un ajuste (nunca bloqueado) lo lleva ahí.
                valorDe(await c.casos.aplicarConteo(e.gerente, { conteoId }));
                for (const [art, q] of contado)
                  sumar(o.dep, art, q - (modelo.get(llave(o.dep, art)) ?? 0));
              } else {
                valorDe(
                  await c.casos.cancelarConteo(e.gerente, { conteoId, motivo: "No se aplica" }),
                );
              }
            } else {
              const candidatos = hechos.filter((h) => !h.anulado);
              const elegido = candidatos[o.cual % Math.max(candidatos.length, 1)];
              if (elegido === undefined) continue;
              valorDe(
                await c.casos.anularMovimiento(e.gerente, {
                  clave: nuevoId(),
                  movimientoId: elegido.id,
                  detalle: "Error de carga",
                }),
              );
              elegido.anulado = true;
              for (const [dep, art, delta] of elegido.efecto) sumar(dep, art, -delta);
            }
          }

          for (const [dep, deposito] of depositos.entries()) {
            for (const [art, a] of articulos.entries()) {
              const guardado = await c.filas<{ saldo: string | null; suma: string | null }>(
                `select (select existencia::text from saldo_de_stock where deposito_id = $1 and articulo_id = $2) as saldo,
                        (select sum(cantidad)::text from renglon_de_movimiento where deposito_id = $1 and articulo_id = $2) as suma`,
                [deposito, a.articulo],
              );
              // Lo que nunca se movió no tiene saldo ni renglones.
              const saldo = Number(guardado[0]?.saldo ?? 0);
              expect(saldo, `saldo de (${dep}, ${art}) contra la suma de sus renglones`).toBe(
                Number(guardado[0]?.suma ?? 0),
              );
              expect(saldo, `saldo de (${dep}, ${art}) contra el modelo`).toBe(
                modelo.get(llave(dep, art)) ?? 0,
              );
            }
          }
          expect(valorDe(await c.consultas.verificarSaldos(e.gerente))).toEqual([]);
        },
      ),
      { numRuns: CORRIDAS },
    );
  });
});
