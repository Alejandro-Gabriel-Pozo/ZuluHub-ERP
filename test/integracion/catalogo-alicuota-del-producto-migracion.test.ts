import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ALICUOTAS_DEL_PRODUCTO, CODIGOS_DE_ALICUOTA } from "../../src/modulos/fiscal/publico";
import { productoDeBase } from "./catalogo-apoyo";
import { crearBaseAparte } from "./entorno";
import {
  acepta,
  check,
  crearMundo,
  intentoDelDueno,
  sinConfirmar,
  type Mundo,
} from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";

/**
 * Migración 0075 (A2e, dueño 12/11/2026): un producto solo guarda una de las seis alícuotas con IVA. Previene: que el código rechace «Exento» y la base lo acepte (o que la
 * lista de la base y la del dominio se desfasen). Prueba: la base acepta exactamente `ALICUOTAS_DEL_PRODUCTO`, la migración frena (55000) si ya hay productos con una alícuota
 * que no se guarda y se puede repetir, y la reversión vuelve a las ocho de 0025.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const leer = (carpeta: string[]) => readFile(join(CARPETA_DE_MIGRACIONES, ...carpeta), "utf8");
const MIGRACION = () => leer(["0075_alicuota_del_producto.sql"]);
const REVERSION = () => leer(["reversiones", "0075_revertir_alicuota_del_producto.sql"]);

describe.skipIf(base === null)("0075: la alícuota del producto", () => {
  const b = () => base as BaseDePruebas;
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let m: Mundo;

  beforeAll(async () => {
    aparte = await crearBaseAparte(b());
    dueno = new pg.Client({ connectionString: aparte.base.dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await aparte.destruir();
  });

  const guardar = (alicuota: string | null) =>
    intentoDelDueno(
      dueno,
      `insert into producto (empresa_id, nombre, nombre_clave, tipo, clase_de_uso, unidad_base_id, dimension, unidad_de_venta_id, alicuota_iva)
       values ($1, 'Alícuota', $2, 'BIEN', 'VENDIBLE', 'UNIDAD', 'CONTEO', 'UNIDAD', $3)`,
      [m.empresa, randomUUID(), alicuota],
    );

  it("la base acepta exactamente las alícuotas que el dominio dice que un producto guarda", async () => {
    await sinConfirmar(dueno, async () => {
      for (const codigo of CODIGOS_DE_ALICUOTA) {
        const r = await guardar(codigo);
        if ((ALICUOTAS_DEL_PRODUCTO as readonly string[]).includes(codigo)) acepta(r);
        else check(r, "producto_alicuota_ck");
      }
      for (const raro of ["20", "21.0", "10,5", "", "iva"]) {
        check(await guardar(raro), "producto_alicuota_ck");
      }
      acepta(await guardar(null));
    });
  });

  it("la migración frena si ya hay productos con EXENTO o NO_GRAVADO, y con el dato corregido se aplica y se puede repetir", async () => {
    const reversion = await REVERSION();
    const migracion = await MIGRACION();
    await sinConfirmar(dueno, async () => {
      acepta(await intentoDelDueno(dueno, reversion));
      for (const codigo of ["EXENTO", "NO_GRAVADO"]) {
        const id = await productoDeBase(dueno, m.empresa, { alicuota: codigo });
        const r = await intentoDelDueno(dueno, migracion);
        expect(r.ok).toBe(false);
        expect(r.ok ? "" : r.codigo).toBe("55000");
        await dueno.query("update producto set alicuota_iva = '21' where id = $1", [id]);
      }
      acepta(await intentoDelDueno(dueno, migracion));
      acepta(await intentoDelDueno(dueno, migracion));
      check(await guardar("EXENTO"), "producto_alicuota_ck");
    });
  });

  it("la reversión vuelve a admitir las ocho de 0025 y se puede repetir", async () => {
    const reversion = await REVERSION();
    await sinConfirmar(dueno, async () => {
      acepta(await intentoDelDueno(dueno, reversion));
      acepta(await intentoDelDueno(dueno, reversion));
      for (const codigo of CODIGOS_DE_ALICUOTA) acepta(await guardar(codigo));
      check(await guardar("20"), "producto_alicuota_ck");
    });
  });

  it("la reversión borra de verdad su fila del registro `migracion` (con «.sql»), para poder volver a aplicarla", async () => {
    const reversion = await REVERSION();
    const registradas = async () =>
      Number(
        (
          await dueno.query(
            "select count(*) as n from migracion where nombre = '0075_alicuota_del_producto.sql'",
          )
        ).rows[0]?.n,
      );
    await sinConfirmar(dueno, async () => {
      expect(await registradas()).toBe(1);
      acepta(await intentoDelDueno(dueno, reversion));
      expect(await registradas()).toBe(0);
    });
  });
});
