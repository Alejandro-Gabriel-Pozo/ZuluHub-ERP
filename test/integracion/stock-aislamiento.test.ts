import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  montarStock,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E5-T5, aislamiento entre empresas (P15): la empresa B no ve ni toca depósitos, artículos, movimientos ni saldos de la empresa A, ni por los
 * casos de uso ni con SQL con el rol de la aplicación, y la misma clave de idempotencia en dos empresas son dos movimientos. El aislamiento de
 * depósitos y artículos tiene además sus pruebas en `stock-depositos.test.ts`; los conteos, en `stock-conteos.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("stock: aislamiento entre empresas", () => {
  let c: MontajeDeStock;
  let a: EscenarioDeStock;
  let b: EscenarioDeStock;
  let deA: {
    dep: string;
    destino: string;
    producto: string;
    articulo: string;
    movimiento: string;
    transferencia: string;
  };
  let deB: { dep: string; producto: string; articulo: string };
  const renglon = (producto: string, cantidad: string) => ({
    productoId: producto,
    cantidad,
    unidadId: "UNIDAD",
  });

  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    a = await c.escenario();
    b = await c.escenario();
    const dep = await c.deposito(a);
    const destino = await c.deposito(a);
    const articulo = await c.articulo(a);
    const entrada = valorDe(
      await c.casos.registrarEntrada(a.gerente, {
        clave: nuevoId(),
        depositoId: dep,
        motivo: "COMPRA",
        renglones: [renglon(articulo.producto, "10")],
      }),
    );
    const transferencia = valorDe(
      await c.casos.transferir(a.gerente, {
        clave: nuevoId(),
        origenId: dep,
        destinoId: destino,
        renglones: [renglon(articulo.producto, "2")],
      }),
    );
    deA = {
      dep,
      destino,
      producto: articulo.producto,
      articulo: articulo.articulo,
      movimiento: entrada.movimientoId,
      transferencia: transferencia.movimientoId,
    };
    deB = { dep: await c.deposito(b), ...(await c.articulo(b)) };
    valorDe(
      await c.casos.registrarEntrada(b.gerente, {
        clave: nuevoId(),
        depositoId: deB.dep,
        motivo: "COMPRA",
        renglones: [renglon(deB.producto, "3")],
      }),
    );
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const movimientosDeA = () =>
    c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [a.empresa]);

  it("P15: B no ve lo de A por las consultas: existencias, libro, ficha, origen y verificación", async () => {
    const existencias = valorDe(await c.consultas.existencias(b.gerente));
    expect(existencias.existencias.map((f) => f.depositoId)).toEqual([deB.dep]);
    expect(
      valorDe(await c.consultas.existencias(b.gerente, { depositoId: deA.dep })).existencias,
    ).toEqual([]);
    expect(
      valorDe(
        await c.consultas.libroDeArticulo(b.gerente, {
          articuloId: deA.articulo,
          depositoId: deA.dep,
          desde: "2026-10-01",
          hasta: "2026-10-31",
        }),
      ).renglones,
    ).toEqual([]);
    expect(
      valorDe(await c.consultas.fichaDeMovimiento(b.gerente, { movimientoId: deA.movimiento })),
    ).toBeNull();
    expect(
      valorDe(await c.consultas.fichaDeMovimiento(a.gerente, { movimientoId: deA.movimiento })),
    ).not.toBeNull();
    expect(valorDe(await c.consultas.listarDepositos(b.gerente)).map((d) => d.id)).toEqual([
      deB.dep,
    ]);
    expect(valorDe(await c.consultas.verificarSaldos(b.gerente))).toEqual([]);
  });

  it("P15: B no puede mover, ajustar ni anular lo de A por los casos de uso: nada existe para B, y A queda igual", async () => {
    const antes = await movimientosDeA();
    const saldoAntes = await c.existencia(deA.dep, deA.articulo);
    expect(
      await c.casos.registrarEntrada(b.gerente, {
        clave: nuevoId(),
        depositoId: deA.dep,
        motivo: "COMPRA",
        renglones: [renglon(deB.producto, "1")],
      }),
    ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
    expect(
      await c.casos.registrarSalida(b.gerente, {
        clave: nuevoId(),
        depositoId: deA.dep,
        motivo: "MERMA",
        renglones: [renglon(deB.producto, "1")],
      }),
    ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
    // Un artículo de A en un depósito de B tampoco existe para B.
    expect(
      await c.casos.registrarEntrada(b.gerente, {
        clave: nuevoId(),
        depositoId: deB.dep,
        motivo: "COMPRA",
        renglones: [renglon(deA.producto, "1")],
      }),
    ).toEqual({ ok: false, error: "ARTICULO_NO_CONTROLADO" });
    expect(
      await c.casos.transferir(b.gerente, {
        clave: nuevoId(),
        origenId: deA.dep,
        destinoId: deB.dep,
        renglones: [renglon(deB.producto, "1")],
      }),
    ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
    expect(
      await c.casos.transferir(b.gerente, {
        clave: nuevoId(),
        origenId: deB.dep,
        destinoId: deA.dep,
        renglones: [renglon(deB.producto, "1")],
      }),
    ).toEqual({ ok: false, error: "DEPOSITO_DE_DESTINO_NO_ENCONTRADO" });
    expect(
      await c.casos.ajustar(b.gerente, {
        clave: nuevoId(),
        depositoId: deA.dep,
        detalle: "Intento ajeno",
        renglones: [{ ...renglon(deB.producto, "1"), sentido: "SUMA" }],
      }),
    ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
    for (const movimientoId of [deA.movimiento, deA.transferencia]) {
      expect(
        await c.casos.anularMovimiento(b.gerente, {
          clave: nuevoId(),
          movimientoId,
          detalle: "Intento ajeno",
        }),
      ).toEqual({
        ok: false,
        error: "MOVIMIENTO_NO_ENCONTRADO",
      });
    }
    expect(await movimientosDeA()).toBe(antes);
    expect(await c.existencia(deA.dep, deA.articulo)).toBe(saldoAntes);
  });

  it("P15: con SQL y el rol de la aplicación, B no lee ni escribe filas de A (la RLS)", async () => {
    const contar = (tabla: string) =>
      c.entorno.ejecutar({ contexto: b.gerente }, async (tx) => {
        const { rows } = await sql<{
          n: string;
        }>`select count(*)::text as n from ${sql.table(tabla)} where empresa_id = ${a.empresa}`.execute(
          tx.db,
        );
        return ok(Number(rows[0]?.n));
      });
    for (const tabla of [
      "deposito",
      "articulo_de_stock",
      "movimiento_de_stock",
      "renglon_de_movimiento",
      "saldo_de_stock",
      "conteo_fisico",
      "conteo_registro",
      "composicion",
      "componente_de_composicion",
    ]) {
      expect(await contar(tabla), tabla).toEqual({ ok: true, valor: 0 });
    }
    const intrusion = await c.entorno.ejecutar({ contexto: b.gerente }, async (tx) => {
      await sql`insert into movimiento_de_stock (empresa_id, clase, motivo, deposito_id, accion, clave_idempotencia, huella, hecho_en, registrado_por)
                values (${a.empresa}, 'ENTRADA', 'COMPRA', ${deA.dep}, 'stock.registrar_entrada', ${`clave-${nuevoId()}`}, ${"a".repeat(64)}, now(), ${b.personaDelGerente})`.execute(
        tx.db,
      );
      return ok(null);
    });
    expect(intrusion.ok).toBe(false);
    expect(await movimientosDeA()).toBe(2);
  });

  it("P15: la misma clave de idempotencia en dos empresas son dos movimientos", async () => {
    const clave = nuevoId();
    const enA = valorDe(
      await c.casos.registrarEntrada(a.gerente, {
        clave,
        depositoId: deA.dep,
        motivo: "COMPRA",
        renglones: [renglon(deA.producto, "1")],
      }),
    );
    const enB = valorDe(
      await c.casos.registrarEntrada(b.gerente, {
        clave,
        depositoId: deB.dep,
        motivo: "COMPRA",
        renglones: [renglon(deB.producto, "1")],
      }),
    );
    expect([enA.yaExistia, enB.yaExistia]).toEqual([false, false]);
    expect(enA.movimientoId).not.toBe(enB.movimientoId);
    expect(
      await c.contar(
        "select count(*) as n from movimiento_de_stock where clave_idempotencia = $1",
        [clave],
      ),
    ).toBe(2);
    // Y cada una repite lo suyo.
    expect(
      valorDe(
        await c.casos.registrarEntrada(b.gerente, {
          clave,
          depositoId: deB.dep,
          motivo: "COMPRA",
          renglones: [renglon(deB.producto, "1")],
        }),
      ),
    ).toEqual({ movimientoId: enB.movimientoId, yaExistia: true });
  });

  it("P15: el control de existencia negativa de una empresa no rige en la otra", async () => {
    const bloqueada = await c.escenario();
    const libre = await c.escenario();
    await c.fijarNivel(bloqueada.empresa, "BLOQUEAR");
    const salida = async (m: EscenarioDeStock) => {
      const dep = await c.deposito(m);
      const art = await c.articulo(m);
      return c.casos.registrarSalida(m.gerente, {
        clave: nuevoId(),
        depositoId: dep,
        motivo: "MERMA",
        renglones: [renglon(art.producto, "1")],
      });
    };
    expect(await salida(bloqueada)).toMatchObject({
      ok: false,
      error: { error: "CONTROL_BLOQUEA" },
    });
    expect(valorDe(await salida(libre)).excepciones).toHaveLength(1);
  });
});
