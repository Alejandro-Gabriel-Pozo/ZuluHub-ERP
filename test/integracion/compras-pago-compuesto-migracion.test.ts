import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { cuitUnico } from "./entorno";
import { nuevoId, valorDe } from "./clientes-apoyo";
import { montarCompras, type MontajeDeCompras } from "./compras-casos-apoyo";
import { acepta, intentoDelDueno, sinConfirmar } from "./fiscal-apoyo";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import { numeroUnico } from "./unicos";

/**
 * Migración 0103 (pago compuesto, paso 1): la tabla de medios cierra la suma exacta (a un centavo), un solo medio de cada tipo, importes positivos y solo inserción; la cabecera dice
 * `COMPUESTO` solo con más de un medio; el relleno deja una línea por pago; la guarda de RLS frena sin un rol que la evada; y la reversión frena con pagos compuestos, corre dos veces y restaura el CHECK.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const leer = (archivo: string) => readFile(join(CARPETA_DE_MIGRACIONES, archivo), "utf8");

describe.skipIf(base === null)("0103: medio_de_un_pago", () => {
  let c: MontajeDeCompras;
  let pagoId: string;
  let nuevoPago: (medio: string) => Promise<string>;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    const e = await c.escenario();
    valorDe(
      await c.casos.configurarCompras(e.gerente, { nivel: "CON_COMPROBANTE", versionEsperada: 1 }),
    );
    const deposito = await c.deposito(e);
    const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    const cuit = cuitUnico();
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    /** Una factura de 2420,00 con su pago ya insertado a mano (la cabecera es inmutable: el medio se elige acá). */
    nuevoPago = async (medio) => {
      const compra = valorDe(
        await c.casos.registrarCompraConFactura(e.operador, {
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
          factura: {
            tipo: "FACTURA_A",
            puntoDeVenta: 5,
            numero: numeroUnico(),
            fecha: "2026-10-10",
            lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
            totalSegunFactura: "2420.00",
            cuitDelProveedor: cuit,
          },
        }),
      );
      const huella = "a".repeat(64);
      const filas = await c.filas<{ id: string }>(
        `insert into pago_de_comprobante (empresa_id, comprobante_id, fecha_de_pago, medio, importe, clave_idempotencia, huella, registrado_por)
           select empresa_id, id, date '2026-10-11', $2, 2420.00, $3, $4, registrado_por from comprobante_de_proveedor where id = $1 returning id`,
        [compra.comprobanteId, medio, nuevoId(), huella],
      );
      return filas[0]?.id as string;
    };
    // El disparador de la cabecera es del paso 2 (0109, con su propia prueba): acá la cabecera se inserta sola para probar las líneas de 0103 de a una.
    await c.filas(
      "alter table pago_de_comprobante disable trigger pago_de_comprobante_verificar_medios",
    );
    pagoId = await nuevoPago("TRANSFERENCIA");
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Inserta líneas a mano (el código de P1 todavía no las escribe) y fuerza la verificación diferida al momento. */
  const lineas = async (filas: readonly [string, string][], pago = pagoId) => {
    const intento = await intentoDelDueno(
      c.dueno,
      `insert into medio_de_un_pago (empresa_id, pago_id, numero, medio, importe) select p.empresa_id, p.id, v.n, v.m, v.i::numeric
         from pago_de_comprobante p, unnest($2::text[], $3::text[]) with ordinality as v(m, i, n) where p.id = $1`,
      [pago, filas.map((f) => f[0]), filas.map((f) => f[1])],
    );
    return intento.ok ? intentoDelDueno(c.dueno, "set constraints all immediate") : intento;
  };
  const MIXTO: [string, string][] = [
    ["EFECTIVO", "1000.00"],
    ["TRANSFERENCIA", "1420.00"],
  ];

  it("la suma de los medios es EXACTAMENTE el total (un centavo menos se rechaza) y la cabecera dice COMPUESTO solo con más de un medio", async () => {
    const compuesto = await nuevoPago("COMPUESTO");
    await sinConfirmar(c.dueno, async () => {
      expect(
        await lineas(
          [
            ["EFECTIVO", "1000.00"],
            ["TRANSFERENCIA", "1419.99"],
          ],
          compuesto,
        ),
      ).toMatchObject({ ok: false, restriccion: "medio_de_un_pago_suma_ck" });
    });
    await sinConfirmar(c.dueno, async () => {
      expect(await lineas(MIXTO)).toMatchObject({
        ok: false,
        restriccion: "pago_medio_coherente_ck",
      });
    });
    await sinConfirmar(c.dueno, async () => acepta(await lineas(MIXTO, compuesto)));
    await sinConfirmar(c.dueno, async () => acepta(await lineas([["TRANSFERENCIA", "2420.00"]])));
  });

  it("un solo medio de cada tipo, importes positivos, solo inserción, y la cabecera ensanchada acepta COMPUESTO", async () => {
    await sinConfirmar(c.dueno, async () => {
      expect(
        await lineas([
          ["EFECTIVO", "1000.00"],
          ["EFECTIVO", "1420.00"],
        ]),
      ).toMatchObject({ ok: false, restriccion: "medio_de_un_pago_uno_por_medio_uk" });
    });
    await sinConfirmar(c.dueno, async () => {
      expect(await lineas([["EFECTIVO", "0.00"]])).toMatchObject({
        ok: false,
        restriccion: "medio_de_un_pago_importe_ck",
      });
    });
    await sinConfirmar(c.dueno, async () => {
      acepta(await lineas([["TRANSFERENCIA", "2420.00"]]));
      for (const sql of [
        "update medio_de_un_pago set importe = 1",
        "delete from medio_de_un_pago",
      ]) {
        expect((await intentoDelDueno(c.dueno, sql)).ok).toBe(false);
      }
    });
    const def =
      (
        await c.filas<{ def: string }>(
          "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'pago_medio_ck'",
        )
      )[0]?.def ?? "";
    expect(def).toContain("'COMPUESTO'");
  });

  it("el relleno deja una línea por pago con su medio y su importe, y la migración frena con pagos de importe 0", async () => {
    const migracion = await leer("0103_pago_compuesto.sql");
    const relleno =
      /INSERT INTO medio_de_un_pago[\s\S]*?FROM pago_de_comprobante;/.exec(migracion)?.[0] ?? "";
    expect(relleno).not.toBe("");
    expect(migracion).toContain("WHERE importe = 0");
    await sinConfirmar(c.dueno, async () => {
      // Antes de 0103 ningún pago podía ser COMPUESTO: los de otras pruebas de este archivo se sacan para reproducir ese estado.
      await c.dueno.query("alter table pago_de_comprobante disable trigger user");
      await c.dueno.query("delete from pago_de_comprobante where medio = 'COMPUESTO'");
      await c.dueno.query("alter table pago_de_comprobante enable trigger user");
      acepta(await intentoDelDueno(c.dueno, relleno));
      const filas = await c.dueno.query<{ medio: string; importe: string }>(
        "select medio, importe::text as importe from medio_de_un_pago where pago_id = $1",
        [pagoId],
      );
      expect(filas.rows).toEqual([{ medio: "TRANSFERENCIA", importe: "2420.00" }]);
    });
  });

  it("la guarda de RLS frena (55000) con un rol que no la evade y deja pasar al que sí", async () => {
    const guarda =
      /IF row_security_active\('public\.pago_de_comprobante'\) THEN[\s\S]*?END IF;/.exec(
        await leer("0103_pago_compuesto.sql"),
      )?.[0] ?? "";
    expect(guarda).not.toBe("");
    const bloque = `DO $$ BEGIN ${guarda} END $$`;
    await sinConfirmar(c.dueno, async () => {
      acepta(await intentoDelDueno(c.dueno, bloque));
      await c.dueno.query("set local role pedernal_app");
      const frena = await intentoDelDueno(c.dueno, bloque);
      expect(frena.ok ? "" : frena.codigo).toBe("55000");
    });
  });

  it("la reversión frena con pagos COMPUESTO; sin ellos corre dos veces, borra la tabla y deja el CHECK de antes", async () => {
    const reversion = await leer("reversiones/0103_revertir_pago_compuesto.sql");
    // El paso 2 se revierte antes (su disparador usa la función que 0103 borra).
    const reversionDelPaso2 = await leer(
      "reversiones/0109_revertir_pago_compuesto_exigir_medios.sql",
    );
    const compuesto = await nuevoPago("COMPUESTO");
    await sinConfirmar(c.dueno, async () => {
      acepta(await lineas(MIXTO, compuesto));
      const frena = await intentoDelDueno(c.dueno, reversion);
      expect(frena.ok ? "" : frena.codigo).toBe("55000");
    });
    await sinConfirmar(c.dueno, async () => {
      // Sin el pago compuesto (se descarta con el rollback de la prueba anterior: acá se lo borra a mano) la reversión corre y se repite.
      await c.dueno.query("alter table pago_de_comprobante disable trigger user");
      await c.dueno.query("delete from pago_de_comprobante where medio = 'COMPUESTO'");
      await c.dueno.query("alter table pago_de_comprobante enable trigger user");
      acepta(await intentoDelDueno(c.dueno, reversionDelPaso2));
      acepta(await intentoDelDueno(c.dueno, reversion));
      acepta(await intentoDelDueno(c.dueno, reversion));
      expect(
        (await c.dueno.query("select to_regclass('public.medio_de_un_pago') as t")).rows[0],
      ).toEqual({ t: null });
      const def =
        (
          await c.dueno.query<{ def: string }>(
            "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'pago_medio_ck'",
          )
        ).rows[0]?.def ?? "";
      expect(def).not.toContain("COMPUESTO");
    });
  });
});
