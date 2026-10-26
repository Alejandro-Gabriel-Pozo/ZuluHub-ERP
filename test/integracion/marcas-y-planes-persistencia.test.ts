import fc from "fast-check";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { textoDeAjuste, valorDeAjuste } from "../../src/capacidades/planes/valores";
import { validarCodigoDePlan } from "../../src/capacidades/planes/version-de-plan";
import { validarCodigoDeMarca } from "../../src/modulos/marcas/publico";
import { COLUMNAS_DE_MARCA, COLUMNAS_DE_VERSION_DE_MARCA } from "../../src/modulos/marcas/publico";
import {
  COLUMNAS_DE_AJUSTE_DE_PERILLA,
  COLUMNAS_DE_MODULO_DE_EMPRESA,
  COLUMNAS_DE_PLAN,
  COLUMNAS_DE_PLAN_DE_TENANT,
  COLUMNAS_DE_VERSION_DE_PLAN,
} from "../../src/modulos/planes/publico";
import { claveDeIdempotenciaValida } from "../../src/plataforma/dominio/soporte/consulta";
import {
  claveDeIdempotenciaDelTenantDelLote,
  LIMITE_DE_TENANTS_POR_LOTE,
} from "../../src/plataforma/dominio/lote-de-migracion";
import "../propiedades/configuracion";
import { crearBaseAparte } from "./entorno";
import { crearMundoDeMarca, crearPlanPublicado } from "./marcas-apoyo";
import { PERILLAS_DE_PRUEBA } from "../utilidades/planes";

/**
 * Que lo que el código declara de las marcas y los planes (columnas, formas de los códigos, el texto de los
 * ajustes, la clave de cada tenant del lote) es lo que la base impone (M5). Si una migración cambia algo, o
 * el código se desvía, estas pruebas lo dicen. Base propia.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "marcas y planes: lo que declara el código es lo que impone la base",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
    });
    afterAll(async () => {
      await dueno.end();
      await propia.destruir();
    });

    describe("columnas", () => {
      const columnasDe = async (tabla: string) =>
        (
          await dueno.query<{ column_name: string }>(
            `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = $1 order by ordinal_position`,
            [tabla],
          )
        ).rows.map((c) => c.column_name);

      it.each([
        ["marca", COLUMNAS_DE_MARCA],
        ["version_de_marca", COLUMNAS_DE_VERSION_DE_MARCA],
        ["plan", COLUMNAS_DE_PLAN],
        ["version_de_plan", COLUMNAS_DE_VERSION_DE_PLAN],
        ["plan_de_tenant", COLUMNAS_DE_PLAN_DE_TENANT],
        ["ajuste_de_perilla", COLUMNAS_DE_AJUSTE_DE_PERILLA],
        ["modulo_de_empresa", COLUMNAS_DE_MODULO_DE_EMPRESA],
      ] as const)(
        "las columnas de `%s` coinciden con la lista del código, en orden",
        async (tabla, lista) => {
          expect(await columnasDe(tabla)).toEqual([...lista]);
        },
      );
    });

    describe("el código de una marca y el de un plan", () => {
      /** ¿La base acepta este código? Se prueba insertando en una transacción que se deshace. */
      async function labaseAcepta(tabla: "marca" | "plan", codigo: string): Promise<boolean> {
        await dueno.query("begin");
        try {
          await dueno.query(`insert into ${tabla} (codigo) values ($1)`, [codigo]);
          return true;
        } catch (e) {
          if ((e as { constraint?: string }).constraint === `${tabla}_codigo_ck`) return false;
          throw e;
        } finally {
          await dueno.query("rollback");
        }
      }
      const MUESTRAS = [
        "",
        "a",
        "ab",
        "a1",
        "a-b",
        "a".repeat(40),
        "a".repeat(41),
        "1a",
        "-a",
        "A",
        "aB",
        "a_b",
        "a.b",
        "a b",
        "ñ",
        "añ",
        "a\n",
        "\na",
        "ab\n",
        "a/b",
        "plan-pro",
        "pedernal2",
        "mi-calendario",
      ];

      it("`validarCodigoDeMarca` y `validarCodigoDePlan` aceptan exactamente lo que acepta la base (muestras)", async () => {
        for (const codigo of MUESTRAS) {
          const marca = await labaseAcepta("marca", codigo);
          const plan = await labaseAcepta("plan", codigo);
          expect(validarCodigoDeMarca(codigo).ok, `marca ${JSON.stringify(codigo)}`).toBe(marca);
          expect(validarCodigoDePlan(codigo).ok, `plan ${JSON.stringify(codigo)}`).toBe(plan);
        }
      });

      it("lo mismo con códigos al azar", async () => {
        const alfabeto = [..."abcxyz019-_. ÑA\n"];
        const codigos = fc.sample(
          fc
            .array(fc.constantFrom(...alfabeto), { minLength: 0, maxLength: 45 })
            .map((cs) => cs.join("")),
          { numRuns: 120 },
        );
        for (const codigo of codigos) {
          expect(validarCodigoDePlan(codigo).ok, JSON.stringify(codigo)).toBe(
            await labaseAcepta("plan", codigo),
          );
        }
      });
    });

    describe("el texto de un ajuste de perilla", () => {
      it("lo que escribe `textoDeAjuste` lo acepta la base y `valorDeAjuste` lo lee igual", async () => {
        const m = await crearMundoDeMarca(dueno);
        const valores = [
          "DEL_PLAN" as const,
          { tipo: "INTERRUPTOR" as const, encendida: true },
          { tipo: "INTERRUPTOR" as const, encendida: false },
          { tipo: "LIMITE" as const, limite: 0 },
          { tipo: "LIMITE" as const, limite: 7 },
          { tipo: "LIMITE" as const, limite: 999_999_999 },
          { tipo: "LIMITE" as const, limite: "ILIMITADO" as const },
        ];
        let numero = 0;
        for (const valor of valores) {
          numero += 1;
          const texto = textoDeAjuste(valor);
          await dueno.query(
            `insert into ajuste_de_perilla (tenant_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
           values ($1, 'cajas_por_sucursal', $2, $3, now(), 'prueba', 'x')`,
            [m.tenant, numero, texto],
          );
          const { rows } = await dueno.query<{ valor: string }>(
            "select valor from ajuste_de_perilla where tenant_id = $1 and numero = $2",
            [m.tenant, numero],
          );
          const leido = valorDeAjuste(
            valor !== "DEL_PLAN" && valor.tipo === "INTERRUPTOR"
              ? PERILLAS_DE_PRUEBA.vidriera_por_qr
              : PERILLAS_DE_PRUEBA.cajas_por_sucursal,
            rows[0]?.valor as string,
          );
          expect(leido).toEqual(valor);
        }
      });
    });

    describe("la clave de idempotencia de cada tenant del lote", () => {
      it("la más corta y la más larga posibles son claves válidas y la tabla real las acepta", async () => {
        const m = await crearMundoDeMarca(dueno);
        for (const lote of ["a", "L".repeat(64)]) {
          const clave = claveDeIdempotenciaDelTenantDelLote(lote, m.tenant);
          expect(claveDeIdempotenciaValida(clave)).toBe(true);
          await dueno.query(
            `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado)
           values ('aaaaaaaa-0000-4000-8000-000000000001', $1, 'planes.migrar_tenant_de_version', $2, '{}')`,
            [clave, "0".repeat(64)],
          );
        }
      });

      it("una clave de 129 caracteres la rechaza la base (el tope de la clave de lote es el que cierra el rango)", async () => {
        const m = await crearMundoDeMarca(dueno);
        const demasiadoLarga = claveDeIdempotenciaDelTenantDelLote("L".repeat(87), m.tenant);
        expect(demasiadoLarga).toHaveLength(129);
        expect(claveDeIdempotenciaValida(demasiadoLarga)).toBe(false);
        await expect(
          dueno.query(
            `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado)
           values ('aaaaaaaa-0000-4000-8000-000000000001', $1, 'planes.migrar_tenant_de_version', $2, '{}')`,
            [demasiadoLarga, "0".repeat(64)],
          ),
        ).rejects.toMatchObject({ constraint: "idempotencia_plataforma_clave_ck" });
      });

      it("el límite de tenants por lote es el que dice el spec", () => {
        expect(LIMITE_DE_TENANTS_POR_LOTE).toBe(200);
      });
    });

    describe("lo que el rol de plataforma puede escribir alcanza para los casos", () => {
      it("el escenario de las pruebas de planes (una versión publicada por el dueño) es legible por los casos", async () => {
        const { version } = await crearPlanPublicado(dueno, { modulos: ["caja"] });
        expect(version).toMatch(/^[0-9a-f-]{36}$/);
      });
    });
  },
);
