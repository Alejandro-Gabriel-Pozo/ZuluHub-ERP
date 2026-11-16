import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { acepta, check, intentoDelDueno, sinConfirmar } from "./fiscal-apoyo";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";

/**
 * Migración 0093 (corrección de compra ampliada): las columnas nuevas de `correccion_de_compra` y sus CHECK, el permiso de INSERT por columna (y ninguno de UPDATE o DELETE) y la
 * reversión (frena con datos, repetible). Previene: un «precio por» suelto, un peso real sin su par o una corrección que no cambia nada y la base acepta.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const REVERSION = () =>
  readFile(
    join(CARPETA_DE_MIGRACIONES, "reversiones", "0093_revertir_correccion_de_compra_ampliada.sql"),
    "utf8",
  );

describe.skipIf(base === null)("0093: correccion_de_compra ampliada", () => {
  let c: MontajeDeCompras;
  let e: EscenarioDeCompras;
  let recepcionId: string;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    e = await c.escenario();
    const deposito = await c.deposito(e);
    const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador);
    recepcionId = valorDe(
      await c.casos.registrarCompra(e.operador, {
        clave: nuevoId(),
        sucursalId: e.sucursal,
        proveedorId: proveedor,
        depositoId: deposito,
        renglones: [
          {
            productoId: producto,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "2",
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1000",
          },
        ],
      }),
    ).recepcionId;
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  let numero = 0;
  /** Inserta una corrección de la línea 1 con las columnas dadas (el resto, nulo). */
  const insertar = (columnas: Record<string, unknown>) => {
    numero += 1;
    const valores: Record<string, unknown> = {
      empresa_id: e.empresa,
      recepcion_id: recepcionId,
      linea: 1,
      numero,
      motivo: "Motivo de prueba",
      clave_idempotencia: nuevoId(),
      huella: "a".repeat(64),
      registrado_por: e.gerente.personaId,
      ...columnas,
    };
    const nombres = Object.keys(valores);
    return intentoDelDueno(
      c.dueno,
      `insert into correccion_de_compra (${nombres.join(", ")}) values (${nombres.map((_, i) => `$${i + 1}`).join(", ")})`,
      Object.values(valores),
    );
  };

  it("el «precio por» solo viaja al completar «Sin precio»: con precio anterior no, sin él es obligatorio, por unidad lleva unidad y por presentación no", async () => {
    await sinConfirmar(c.dueno, async () => {
      // Completar: precio anterior nulo y precio nuevo.
      acepta(
        await insertar({
          precio_nuevo: "5",
          precio_por_tipo: "UNIDAD",
          unidad_de_precio_id: "KILOGRAMO",
        }),
      );
      acepta(await insertar({ precio_nuevo: "5", precio_por_tipo: "PRESENTACION" }));
      check(await insertar({ precio_nuevo: "5" }), "correccion_de_compra_precio_por_completa_ck");
      check(
        await insertar({ precio_nuevo: "5", precio_por_tipo: "UNIDAD" }),
        "correccion_de_compra_precio_por_completa_ck",
      );
      check(
        await insertar({
          precio_nuevo: "5",
          precio_por_tipo: "PRESENTACION",
          unidad_de_precio_id: "KILOGRAMO",
        }),
        "correccion_de_compra_precio_por_completa_ck",
      );
      // Corregir un precio que ya había: el «precio por» no viaja.
      acepta(await insertar({ precio_anterior: "4", precio_nuevo: "5" }));
      check(
        await insertar({
          precio_anterior: "4",
          precio_nuevo: "5",
          precio_por_tipo: "UNIDAD",
          unidad_de_precio_id: "KILOGRAMO",
        }),
        "correccion_de_compra_precio_por_completa_ck",
      );
      check(
        await insertar({ precio_nuevo: "5", precio_por_tipo: "OTRO" }),
        "correccion_de_compra_precio_por_ck",
      );
    });
  });

  it("el peso real viaja de a pares, es positivo y cuenta como un cambio; sin precio, cantidad ni peso no hay corrección", async () => {
    await sinConfirmar(c.dueno, async () => {
      acepta(await insertar({ peso_real_anterior: "2", peso_real_nuevo: "1.5" }));
      check(await insertar({ peso_real_nuevo: "1.5" }), "correccion_de_compra_peso_par_ck");
      check(await insertar({ peso_real_anterior: "2" }), "correccion_de_compra_cambia_algo_ck");
      check(
        await insertar({ peso_real_anterior: "0", peso_real_nuevo: "1" }),
        "correccion_de_compra_peso_anterior_ck",
      );
      check(
        await insertar({ peso_real_anterior: "1", peso_real_nuevo: "-1" }),
        "correccion_de_compra_peso_nuevo_ck",
      );
      check(await insertar({}), "correccion_de_compra_cambia_algo_ck");
      acepta(await insertar({ cantidad_anterior: "2", cantidad_nueva: "3" }));
    });
  });

  it("la aplicación puede insertar las columnas nuevas y no actualizar ni borrar ninguna (solo inserción)", async () => {
    const { rows } = await c.dueno.query<{ privilegio: string; columna: string }>(
      "select privilege_type as privilegio, column_name as columna from information_schema.column_privileges where table_schema = 'public' and table_name = 'correccion_de_compra' and grantee = 'pedernal_app' and column_name = any($1)",
      [["precio_por_tipo", "unidad_de_precio_id", "peso_real_anterior", "peso_real_nuevo"]],
    );
    expect(
      rows
        .filter((r) => r.privilegio === "INSERT")
        .map((r) => r.columna)
        .sort(),
    ).toEqual(["peso_real_anterior", "peso_real_nuevo", "precio_por_tipo", "unidad_de_precio_id"]);
    expect(rows.filter((r) => r.privilegio === "UPDATE")).toEqual([]);
  });

  it("la reversión frena con correcciones que usan las columnas nuevas, y sin ellas deja la tabla como antes y se puede repetir", async () => {
    const reversion = await REVERSION();
    await sinConfirmar(c.dueno, async () => {
      acepta(await insertar({ precio_nuevo: "5", precio_por_tipo: "PRESENTACION" }));
      const frena = await intentoDelDueno(c.dueno, reversion);
      expect(frena.ok).toBe(false);
      expect(frena.ok ? "" : frena.codigo).toBe("55000");
    });
    await sinConfirmar(c.dueno, async () => {
      acepta(await insertar({ peso_real_anterior: "2", peso_real_nuevo: "1" }));
      await c.dueno.query("set local pedernal.confirmar_reversion = 'SI'");
      const soloPeso = await intentoDelDueno(c.dueno, reversion);
      expect(soloPeso.ok).toBe(false); // una corrección solo de peso no cumpliría el CHECK anterior: frena aunque se confirme
      expect(soloPeso.ok ? "" : soloPeso.codigo).toBe("55000");
    });
    await sinConfirmar(c.dueno, async () => {
      acepta(await intentoDelDueno(c.dueno, reversion));
      acepta(await intentoDelDueno(c.dueno, reversion));
      const columnas = await c.dueno.query<{ n: string }>(
        "select count(*)::text as n from information_schema.columns where table_name = 'correccion_de_compra' and column_name in ('precio_por_tipo', 'unidad_de_precio_id', 'peso_real_anterior', 'peso_real_nuevo')",
      );
      expect(columnas.rows[0]?.n).toBe("0");
      check(
        await intentoDelDueno(
          c.dueno,
          "insert into correccion_de_compra (empresa_id, recepcion_id, linea, numero, motivo, clave_idempotencia, huella, registrado_por) values ($1, $2, 1, 99, 'Motivo de prueba', $3, $4, $5)",
          [e.empresa, recepcionId, nuevoId(), "a".repeat(64), e.gerente.personaId],
        ),
        "correccion_de_compra_cambia_algo_ck",
      );
    });
  });
});
