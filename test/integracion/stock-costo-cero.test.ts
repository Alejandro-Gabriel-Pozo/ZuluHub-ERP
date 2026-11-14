import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import { escribirMovimiento } from "./stock-apoyo";
import { leerCostoDeclarado } from "../../src/modulos/stock/casos-de-uso/costos";
import {
  montarStock,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * D7 (auditoría de reglas, INTEGRACION §5): «una entrada sin precio queda "sin costo", nunca cero» (CYN 125). TypeScript ya rechazaba el costo cero
 * (`leerCostoDeclarado`); la base lo admitía (`costo >= 0`). La base es la red: un costo cero escrito por otro camino diluiría el promedio
 * y haría parecer gratis lo que no se sabe. Previene: el costo cero guardado en el promedio o congelado en un renglón.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("stock: el costo cero no entra (D7)", () => {
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

  const nuevo = async () => ({ dep: await c.deposito(e), ...(await c.articulo(e)) });
  const entrada = (dep: string, producto: string, costo?: string) =>
    c.casos.registrarEntrada(e.gerente, {
      clave: nuevoId(),
      depositoId: dep,
      motivo: "COMPRA",
      renglones: [
        {
          productoId: producto,
          cantidad: "10",
          unidadId: "UNIDAD",
          ...(costo === undefined ? {} : { costoUnitario: costo }),
        },
      ],
    });

  it("el costo cero declarado se rechaza en el caso de uso y no deja nada escrito", async () => {
    const n = await nuevo();
    const r = await entrada(n.dep, n.producto, "0");
    expect(r.ok).toBe(false);
    const filas = await c.filas(
      "select 1 from costo_de_articulo where deposito_id = $1 and articulo_id = $2",
      [n.dep, n.articulo],
    );
    expect(filas).toHaveLength(0);
  });

  it("la base rechaza un promedio en cero", async () => {
    const n = await nuevo();
    valorDe(await entrada(n.dep, n.producto, "4"));
    await expect(
      c.dueno.query(
        "update costo_de_articulo set costo_unitario = 0 where deposito_id = $1 and articulo_id = $2",
        [n.dep, n.articulo],
      ),
    ).rejects.toMatchObject({ constraint: "costo_de_articulo_costo_ck" });
  });

  it("la base rechaza un costo congelado en cero (la entrada sin precio queda SIN_COSTO con costo nulo)", async () => {
    const n = await nuevo();
    const persona = await c.dueno.query<{ persona: string }>(
      "select registrado_por as persona from movimiento_de_stock where empresa_id = $1 limit 1",
      [e.empresa],
    );
    await c.dueno.query("begin");
    try {
      const movimiento = await escribirMovimiento(
        async (texto, parametros) => {
          const r = await c.dueno.query(texto, parametros);
          return { ok: true, filas: r.rowCount ?? 0, rows: r.rows as Record<string, unknown>[] };
        },
        e.empresa,
        {
          clase: "ENTRADA",
          motivo: "COMPRA",
          deposito: n.dep,
          persona: persona.rows[0]?.persona as string,
          renglones: [{ articulo: n.articulo, cantidad: "1" }],
        },
      );
      await expect(
        c.dueno.query(
          "insert into costo_de_renglon (empresa_id, movimiento_id, numero, estado, costo_unitario) values ($1, $2, 1, 'DEFINITIVO', 0)",
          [e.empresa, movimiento.id],
        ),
      ).rejects.toMatchObject({ constraint: "costo_de_renglon_costo_ck" });
    } finally {
      await c.dueno.query("rollback");
    }
  });

  it("una entrada repetida sin costo no escribe cero (idempotencia)", async () => {
    const n = await nuevo();
    const clave = nuevoId();
    const pedido = {
      clave,
      depositoId: n.dep,
      motivo: "COMPRA",
      renglones: [{ productoId: n.producto, cantidad: "3", unidadId: "UNIDAD" }],
    };
    await Promise.all([
      c.casos.registrarEntrada(e.gerente, pedido),
      c.casos.registrarEntrada(e.gerente, pedido),
    ]);
    const filas = await c.filas<{ n: string }>(
      `select count(*)::text as n from costo_de_renglon cr
         join renglon_de_movimiento r on r.empresa_id = cr.empresa_id and r.movimiento_id = cr.movimiento_id and r.numero = cr.numero
        where r.articulo_id = $1 and (cr.costo_unitario = 0 or cr.estado <> 'SIN_COSTO')`,
      [n.articulo],
    );
    expect(filas[0]?.n).toBe("0");
  });

  // ---- la migración 0053: freno, reversión y espejo con el código ----------------------------------------------------------------------

  describe("la migración 0053", () => {
    const leer = (carpeta: string, archivo: string) =>
      readFile(join(CARPETA_DE_MIGRACIONES, carpeta, archivo), "utf8");
    const ARCHIVO = "0053_costo_nunca_cero.sql";
    const REVERSION = "0053_revertir_costo_nunca_cero.sql";

    /** Un renglón en la misma transacción que su movimiento, para poder cargarle un costo congelado. */
    const movimientoNuevo = async (dep: string, articulo: string) => {
      const persona = await c.dueno.query<{ persona: string }>(
        "select registrado_por as persona from movimiento_de_stock where empresa_id = $1 limit 1",
        [e.empresa],
      );
      return escribirMovimiento(
        async (texto, parametros) => {
          const r = await c.dueno.query(texto, parametros);
          return { ok: true, filas: r.rowCount ?? 0, rows: r.rows as Record<string, unknown>[] };
        },
        e.empresa,
        {
          clase: "ENTRADA",
          motivo: "COMPRA",
          deposito: dep,
          persona: persona.rows[0]?.persona as string,
          renglones: [{ articulo, cantidad: "1" }],
        },
      );
    };

    it("espejo: el mínimo que el código acepta (0,000001) entra en la base y el cero no entra en ninguno de los dos", async () => {
      expect(leerCostoDeclarado("0.000001").ok).toBe(true);
      expect(leerCostoDeclarado("0").ok).toBe(false);
      expect(leerCostoDeclarado("0.000000").ok).toBe(false);
      const n = await nuevo();
      valorDe(await entrada(n.dep, n.producto, "0.000001"));
      const minimo = await c.filas<{ costo_unitario: string }>(
        "select costo_unitario::text as costo_unitario from costo_de_articulo where deposito_id = $1 and articulo_id = $2",
        [n.dep, n.articulo],
      );
      expect(minimo[0]?.costo_unitario).toBe("0.000001");
    });

    it("con filas en cero (base anterior a 0053) frena sin cambiar nada; corregidas, aplica; repetir la reversión no cambia nada", async () => {
      const migracion = await leer(".", ARCHIVO);
      const reversion = await leer("reversiones", REVERSION);
      const n = await nuevo();
      valorDe(await entrada(n.dep, n.producto, "4"));
      await c.dueno.query("begin");
      try {
        await c.dueno.query(reversion);
        await c.dueno.query(reversion);
        // Ya con la base anterior: se cuela un cero en el promedio y en un costo congelado.
        await c.dueno.query(
          "update costo_de_articulo set costo_unitario = 0 where deposito_id = $1 and articulo_id = $2",
          [n.dep, n.articulo],
        );
        const mov = await movimientoNuevo(n.dep, n.articulo);
        await c.dueno.query(
          "insert into costo_de_renglon (empresa_id, movimiento_id, numero, estado, costo_unitario) values ($1, $2, 1, 'DEFINITIVO', 0)",
          [e.empresa, mov.id],
        );
        await c.dueno.query("savepoint freno");
        await expect(c.dueno.query(migracion)).rejects.toMatchObject({ code: "55000" });
        await c.dueno.query("rollback to savepoint freno");
      } finally {
        await c.dueno.query("rollback");
      }
    });

    it("sin filas en cero aplica y la base vuelve a rechazar el cero", async () => {
      const migracion = await leer(".", ARCHIVO);
      const reversion = await leer("reversiones", REVERSION);
      const n = await nuevo();
      valorDe(await entrada(n.dep, n.producto, "4"));
      await c.dueno.query("begin");
      try {
        await c.dueno.query(reversion);
        await c.dueno.query(migracion);
        await c.dueno.query("savepoint intento");
        await expect(
          c.dueno.query(
            "update costo_de_articulo set costo_unitario = 0 where deposito_id = $1 and articulo_id = $2",
            [n.dep, n.articulo],
          ),
        ).rejects.toMatchObject({ constraint: "costo_de_articulo_costo_ck" });
      } finally {
        await c.dueno.query("rollback");
      }
    });
  });
});
