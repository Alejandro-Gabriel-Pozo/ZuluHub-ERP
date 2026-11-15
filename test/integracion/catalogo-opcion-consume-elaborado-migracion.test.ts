import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CLASES_DE_USO, seConsumeLaClase } from "../../src/modulos/catalogo/dominio/clases";
import { grupoDeBase, opcionDeBase, productoDeBase } from "./catalogo-apoyo";
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
 * Migración 0057 (D9, dueño 12/11/2026): una opción puede consumir un ELABORADO. Previene: que el código acepte la clase y la base la rechace (o que la lista de la
 * base y la del dominio se desfasen). Prueba: la base acepta exactamente las clases del dominio, la reversión frena si ya hay consumos de elaborados y es repetible.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const REVERSION = () =>
  readFile(
    join(CARPETA_DE_MIGRACIONES, "reversiones", "0057_revertir_opcion_consume_elaborado.sql"),
    "utf8",
  );

describe.skipIf(base === null)("0057: una opción consume un elaborado", () => {
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

  const cargar = (version: string, insumo: string) =>
    intentoDelDueno(
      dueno,
      "insert into consumo_de_opcion (empresa_id, version_de_opcion_id, numero, insumo_id, cantidad, escala_con_tamano) values ($1, $2, 1, $3, 1, false)",
      [m.empresa, version, insumo],
    );

  it("la base admite exactamente las clases que el dominio dice que se consumen", async () => {
    await sinConfirmar(dueno, async () => {
      const p = await productoDeBase(dueno, m.empresa);
      const g = await grupoDeBase(dueno, m.empresa, p, { clase: "ADICIONAL" });
      for (const clase of CLASES_DE_USO) {
        const insumo = await productoDeBase(dueno, m.empresa, { clase });
        const { version } = await opcionDeBase(dueno, m.empresa, p, g);
        const r = await cargar(version, insumo);
        if (seConsumeLaClase(clase)) acepta(r);
        else check(r, "consumo_de_opcion_insumo_no_admitido");
      }
    });
  });

  it("la reversión frena si hay consumos de un elaborado", async () => {
    const reversion = await REVERSION();
    await sinConfirmar(dueno, async () => {
      const p = await productoDeBase(dueno, m.empresa);
      const g = await grupoDeBase(dueno, m.empresa, p, { clase: "ADICIONAL" });
      const elaborado = await productoDeBase(dueno, m.empresa, { clase: "ELABORADO" });
      const { version } = await opcionDeBase(dueno, m.empresa, p, g);
      acepta(await cargar(version, elaborado));
      const r = await intentoDelDueno(dueno, reversion);
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.codigo).toBe("55000");
    });
  });

  it("sin consumos de elaborados la reversión vuelve a la regla anterior y se puede repetir", async () => {
    const reversion = await REVERSION();
    await sinConfirmar(dueno, async () => {
      acepta(await intentoDelDueno(dueno, reversion));
      acepta(await intentoDelDueno(dueno, reversion));
      const p = await productoDeBase(dueno, m.empresa);
      const g = await grupoDeBase(dueno, m.empresa, p, { clase: "ADICIONAL" });
      const elaborado = await productoDeBase(dueno, m.empresa, { clase: "ELABORADO" });
      const { version } = await opcionDeBase(dueno, m.empresa, p, g);
      check(await cargar(version, elaborado), "consumo_de_opcion_insumo_no_admitido");
    });
  });
});
