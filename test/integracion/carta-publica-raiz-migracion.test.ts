import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarCatalogo } from "./catalogo-apoyo";
import { montarEnsayo, type Catalogo, type Ensayo } from "./carta-publica-lectura-apoyo";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";

/**
 * 0096 con las migraciones reales y el rol público REAL (RLS forzada): lo que el rol ve con la variable de la empresa y con la de la carta, que la variable muere con la transacción, que no se
 * abre ninguna columna ni tabla de más, y la reversión (deja la base como antes y borra su fila de `migracion`, y se puede repetir). El listado completo contra el adaptador está en
 * `carta-publica-raiz.test.ts`.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const REVERSION = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0096_revertir_lectura_publica_de_las_cartas_de_la_empresa_del_host.sql",
);
const NOMBRE_DE_LA_MIGRACION = "0096_lectura_publica_de_las_cartas_de_la_empresa_del_host.sql";
const POLITICA_NUEVA = "carta_publica_publico_leer_de_la_empresa_del_host";
const POLITICA_VIEJA = "carta_publica_publico_leer";

describe.skipIf(base === null)(
  "0096: la política de lectura de las cartas de la empresa del host",
  () => {
    let c: Catalogo;
    let a: Ensayo;
    let b: Ensayo;

    beforeAll(async () => {
      c = await montarCatalogo(base as BaseDePruebas);
      a = await montarEnsayo(c);
      b = await montarEnsayo(c);
    });
    afterAll(async () => {
      await c.cerrar();
    });

    const conectar = async (url: string) => {
      const cliente = new pg.Client({ connectionString: url });
      await cliente.connect();
      return cliente;
    };
    const publico = () => c.propia.base.publico;
    const codigosDe = (e: Ensayo) => [e.carta1.codigo, e.carta2.codigo];

    async function leer(ajustes: readonly (readonly [string, string])[]): Promise<string[]> {
      const cliente = await conectar(publico());
      try {
        await cliente.query("begin read only");
        for (const [nombre, valor] of ajustes) {
          await cliente.query("select set_config($1, $2, true)", [nombre, valor]);
        }
        const { rows } = await cliente.query<{ codigo: string }>(
          "select codigo from carta_publica order by codigo",
        );
        await cliente.query("rollback");
        return rows.map((r) => r.codigo);
      } finally {
        await cliente.end();
      }
    }

    it("las dos políticas conviven y nunca se ven filas de una empresa que no se pidió: la empresa de A y el código de A dan solo lo de A", async () => {
      const soloA = [...codigosDe(a)].sort();
      expect(await leer([["app.empresa_del_host", a.e.empresa]])).toEqual(soloA);
      expect(
        await leer([
          ["app.empresa_del_host", a.e.empresa],
          ["app.codigo_de_carta", a.carta1.codigo],
        ]),
      ).toEqual(soloA);
      // La empresa de A sola, o el código de A solo, nunca traen una carta de B.
      for (const ajustes of [
        [["app.empresa_del_host", a.e.empresa]],
        [["app.codigo_de_carta", a.carta1.codigo]],
      ] as const) {
        const vistos = await leer(ajustes);
        for (const codigo of codigosDe(b)) expect(vistos).not.toContain(codigo);
      }
    });

    it("la variable es LOCAL de la transacción: otra transacción de la misma conexión no la ve", async () => {
      const cliente = await conectar(publico());
      try {
        await cliente.query("begin read only");
        await cliente.query("select set_config('app.empresa_del_host', $1, true)", [a.e.empresa]);
        const dentro = await cliente.query("select codigo from carta_publica");
        expect(dentro.rowCount).toBe(2);
        await cliente.query("commit");
        await cliente.query("begin read only");
        const despues = await cliente.query("select codigo from carta_publica");
        expect(despues.rowCount).toBe(0);
        expect(
          (
            await cliente.query<{ v: string | null }>(
              "select current_setting('app.empresa_del_host', true) as v",
            )
          ).rows[0]?.v ?? "",
        ).toBe("");
        await cliente.query("commit");
      } finally {
        await cliente.end();
      }
    });

    it("el rol público no lee más columnas que las otorgadas (quién creó la carta, cuándo, la versión): 42501", async () => {
      const cliente = await conectar(publico());
      try {
        for (const columna of ["creado_por", "creado_en", "actualizado_en", "version"]) {
          await cliente.query("begin read only");
          await cliente.query("select set_config('app.empresa_del_host', $1, true)", [a.e.empresa]);
          await expect(
            cliente.query(`select ${columna} from carta_publica`),
            columna,
          ).rejects.toMatchObject({ code: "42501" });
          await cliente.query("rollback");
        }
      } finally {
        await cliente.end();
      }
    });

    it("no puede escribir: ni insertar, ni actualizar, ni borrar (solo lectura)", async () => {
      const cliente = await conectar(publico());
      try {
        for (const sentencia of [
          "update carta_publica set nombre = 'x'",
          "delete from carta_publica",
          "insert into carta_publica (id) values (gen_random_uuid())",
        ]) {
          await cliente.query("begin");
          await cliente.query("select set_config('app.empresa_del_host', $1, true)", [a.e.empresa]);
          await expect(cliente.query(sentencia), sentencia).rejects.toMatchObject({
            code: "42501",
          });
          await cliente.query("rollback");
        }
      } finally {
        await cliente.end();
      }
    });

    describe("la reversión", () => {
      it("quita la política nueva, deja la vieja y la tabla como estaban, borra la fila de `migracion` y se puede repetir", async () => {
        const aparte = await crearBaseAparte(base as BaseDePruebas);
        const dueno = await conectar(aparte.base.dueno);
        try {
          const politicas = async () =>
            (
              await dueno.query<{ policyname: string }>(
                "select policyname from pg_policies where tablename = 'carta_publica' and 'pedernal_publico' = any(roles) order by 1",
              )
            ).rows.map((r) => r.policyname);
          const filaDeMigracion = async () =>
            (
              await dueno.query("select 1 from migracion where nombre = $1", [
                NOMBRE_DE_LA_MIGRACION,
              ])
            ).rowCount;
          const antes = await politicas();
          expect(antes).toEqual(expect.arrayContaining([POLITICA_VIEJA, POLITICA_NUEVA]));
          const comoAntesDeLaMigracion = antes.filter((p) => p !== POLITICA_NUEVA);
          expect(await filaDeMigracion()).toBe(1);
          const sql = await readFile(REVERSION, "utf8");
          for (const vez of [1, 2]) {
            await dueno.query("begin");
            try {
              await dueno.query(sql);
              await dueno.query("commit");
            } catch (e) {
              await dueno.query("rollback");
              throw e;
            }
            expect(await politicas(), `vuelta ${vez}`).toEqual(comoAntesDeLaMigracion);
            expect(await filaDeMigracion(), `vuelta ${vez}`).toBe(0);
          }
          const rls = await dueno.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
            "select relrowsecurity, relforcerowsecurity from pg_class where relname = 'carta_publica'",
          );
          expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
        } finally {
          await dueno.end();
          await aparte.destruir();
        }
      });
    });
  },
);
