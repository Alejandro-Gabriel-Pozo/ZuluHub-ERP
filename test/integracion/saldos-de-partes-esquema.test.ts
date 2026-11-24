import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  CLASES_DE_ASIENTO,
  COLUMNAS_DE_SALDOS,
  ERRORES_DEL_LIBRO,
  ERRORES_DEL_LIBRO_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DEL_LIBRO,
  detalleDesdeTexto,
} from "../../src/modulos/saldos_de_partes/publico";
import { comoEmpresa, crearBaseAparte } from "./entorno";
import { acepta, crearMundo, type Mundo } from "./fiscal-apoyo";
import { SesionDePrueba } from "./sesiones";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { sufijoUnico } from "./unicos";

/**
 * El esquema del libro de saldos: lo que el TypeScript declara contra lo que dice la base de `0092_libro_de_saldos.sql` (LB-4a). Previene que
 * el esquema de Kysely, la copia en código de las clases, el mapa restricción → error de negocio y la lista de permitidos del detalle se separen
 * de la base sin que nada lo note: una columna que se agrega y no se declara, una restricción sin su traducción (sale como un error genérico), una
 * clase que existe en un lado y no en el otro, o un detalle que el dominio deja pasar y la base rechaza (sale como un error de persistencia en
 * vez de `DETALLE_INVALIDO`).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const TABLAS = Object.keys(COLUMNAS_DE_SALDOS) as Array<keyof typeof COLUMNAS_DE_SALDOS>;

describe.skipIf(base === null)(
  "esquema del libro de saldos (0092) contra su declaración en código",
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

    it("las columnas de las ocho tablas son las que declara el esquema, en el orden de la base", async () => {
      expect(TABLAS).toHaveLength(8);
      for (const tabla of TABLAS) {
        const { rows } = await dueno.query<{ column_name: string }>(
          `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = $1 order by ordinal_position`,
          [tabla],
        );
        expect(
          rows.map((r) => r.column_name),
          tabla,
        ).toEqual([...COLUMNAS_DE_SALDOS[tabla]]);
      }
    });

    it("las clases de asiento del código son EXACTAMENTE las sembradas en la base (sentido, clase, signo, detalle y vencimiento)", async () => {
      const { rows } = await dueno.query<{
        sentido: string;
        clase: string;
        signo: string;
        exige_detalle: boolean;
        admite_vencimiento: boolean;
      }>("select * from clase_de_asiento order by sentido, clase");
      const deLaBase = rows.map((r) => ({
        sentido: r.sentido,
        clase: r.clase,
        signo: r.signo,
        exigeDetalle: r.exige_detalle,
        admiteVencimiento: r.admite_vencimiento,
      }));
      const delCodigo = [...CLASES_DE_ASIENTO]
        .map((c) => ({ ...c }))
        .sort((a, b) => `${a.sentido}/${a.clase}`.localeCompare(`${b.sentido}/${b.clase}`, "en"));
      expect(deLaBase).toEqual(delCodigo);
    });

    it("toda restricción de las ocho tablas tiene su traducción declarada, y no sobra ninguna", async () => {
      const { rows } = await dueno.query<{ nombre: string }>(
        `select conname as nombre from pg_constraint
        where conrelid = any($1::text[]::regclass[]) and contype in ('p', 'u', 'c', 'f', 'x')
       union
       select indexname as nombre from pg_indexes
        where schemaname = 'public' and tablename = any($2::text[])
          and indexdef like 'CREATE UNIQUE INDEX%' and indexname not like '%pkey'`,
        [TABLAS.map((t) => `public.${t}`), [...TABLAS]],
      );
      const existentes = new Set(rows.map((r) => r.nombre));
      const declaradas = new Set(Object.keys(ERRORES_DEL_LIBRO_POR_RESTRICCION));
      expect(
        [...existentes].filter((n) => !declaradas.has(n)).sort(),
        "restricciones sin traducción declarada",
      ).toEqual([]);
      expect(
        [...declaradas]
          .filter((n) => !existentes.has(n) && !RESTRICCIONES_DE_DISPARADORES_DEL_LIBRO.includes(n))
          .sort(),
        "traducciones de restricciones que no existen",
      ).toEqual([]);
    });

    it("los nombres con que los disparadores lanzan sus errores son los que declara el mapa (si cambian en la migración, esta prueba lo dice)", async () => {
      const { rows } = await dueno.query<{ cuerpo: string }>(
        `select pg_get_functiondef(p.oid) as cuerpo from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('libro_saldo_guardia', 'asiento_de_saldo_validar_alta', 'asiento_de_saldo_aplicar',
                            'imputacion_de_saldo_aplicar', 'distribucion_de_asiento_aplicar', 'asiento_de_saldo_verificar_distribucion')`,
      );
      expect(rows).toHaveLength(6);
      const cuerpo = rows.map((r) => r.cuerpo).join("\n");
      for (const nombre of RESTRICCIONES_DE_DISPARADORES_DEL_LIBRO) {
        // La guardia arma su nombre con `TG_TABLE_NAME || '_solo_por_disparadores'`.
        const esDeLaGuardia = nombre.endsWith("_solo_por_disparadores");
        expect(
          esDeLaGuardia
            ? cuerpo.includes("'_solo_por_disparadores'")
            : cuerpo.includes(`'${nombre}'`),
          nombre,
        ).toBe(true);
      }
      // Y al revés: todo `CONSTRAINT = '…'` que lanza una función tiene traducción.
      const lanzados = [...cuerpo.matchAll(/CONSTRAINT = '([a-z_]+)'/g)].map((m) => m[1] as string);
      expect(lanzados.length).toBeGreaterThan(10);
      for (const nombre of lanzados) {
        expect(Object.hasOwn(ERRORES_DEL_LIBRO_POR_RESTRICCION, nombre), nombre).toBe(true);
      }
    });

    it("cada traducción es un error de negocio conocido del libro (o NO_TRADUCIDA)", () => {
      const conocidos = new Set<string>([...ERRORES_DEL_LIBRO, "NO_TRADUCIDA"]);
      for (const [restriccion, codigo] of Object.entries(ERRORES_DEL_LIBRO_POR_RESTRICCION)) {
        expect(conocidos.has(codigo), `${restriccion} → ${codigo}`).toBe(true);
      }
    });

    describe("paridad de la lista de permitidos del detalle con su CHECK en la base", () => {
      let mundo: Mundo;
      let parte: string;
      beforeAll(async () => {
        mundo = await crearMundo(dueno);
        parte = (
          await dueno.query<{ id: string }>(
            `insert into parte (empresa_id, idempotencia_alta, naturaleza, nombre, creado_por)
           values ($1, gen_random_uuid(), 'JURIDICA', $2, $3) returning id`,
            [mundo.empresa, `Proveedor ${sufijoUnico()}`, mundo.persona],
          )
        ).rows[0]?.id as string;
      });

      it("el dominio y la base aceptan y rechazan los mismos textos", async () => {
        const casos = [
          "Ajuste por diferencia de cambio",
          "Ajuste: 3 x 2 (50%) $1.000,00 ¿ok? ¡sí!",
          "Con tilde: ñandú, Ümlaut, ºª",
          "con <etiqueta>",
          "con salto\nde línea",
          "con emoji 😀",
          "con = igual",
          "con @ arroba",
          "con ​ invisible",
          "a".repeat(500),
          "a".repeat(501),
          "dos  espacios",
          " con borde",
        ];
        const s = await SesionDePrueba.abrir(
          propia.base,
          "pedernal_app",
          comoEmpresa(empresaId(mundo.empresa), personaId(mundo.persona)),
        );
        try {
          for (const texto of casos) {
            const dominio = detalleDesdeTexto(texto);
            // La base recibe el texto ya canónico (como lo manda el dominio); para los que el dominio rechaza, el texto tal cual.
            const aMandar = dominio.ok && dominio.valor !== null ? dominio.valor : texto;
            const r = await s.intentar(
              `insert into asiento_de_saldo (empresa_id, parte_id, sentido, clase, importe, origen_tipo, origen_id, clave_idempotencia, huella,
                                           hecho_en, registrado_por, detalle)
             values ($1, $2, 'A_PAGAR', 'AJUSTE_DE_SALDO', 1, 'compras.ajuste', gen_random_uuid(), $3, $4, now(), $5, $6)`,
              [
                mundo.empresa,
                parte,
                `clave-${sufijoUnico()}-${"x".repeat(8)}`,
                "a".repeat(64),
                mundo.persona,
                aMandar,
              ],
            );
            const baseAcepta =
              r.ok || (r.restriccion !== "asiento_de_saldo_detalle_ck" && r.codigo !== "23514");
            expect(
              baseAcepta,
              `${JSON.stringify(texto)} (dominio: ${dominio.ok ? "acepta" : "rechaza"})`,
            ).toBe(dominio.ok);
            if (r.ok) acepta(r);
          }
        } finally {
          await s.cerrar();
        }
      });
    });
  },
);
