import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL,
  nombreDeSucursalValido,
} from "../../src/modulos/empresas/publico";

/**
 * El CHECK `comprobante_sucursal_nombre_ck` (0020) es el ESPEJO de los tres CHECK que ya tiene `sucursal.nombre` (0001 y 0005) y repite
 * el tope del dominio (`LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL`). Esta prueba lee las definiciones del CATÁLOGO de la base real y las
 * compara. Previene: que el CHECK del comprobante sea más estricto que el de la sucursal (un nombre válido de sucursal haría fallar el
 * alta de todos sus comprobantes: la sucursal no podría emitir) o más laxo (un texto sin regla impreso en la factura), y que el tope
 * de la base y el del dominio se separen. La normalización NFC es del dominio y la base no la exige, ni en la sucursal ni acá.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "el CHECK del nombre congelado es el espejo de los de la sucursal",
  () => {
    let c: pg.Client;
    beforeAll(async () => {
      if (base === null) return;
      c = new pg.Client({ connectionString: base.dueno });
      await c.connect();
    });
    afterAll(async () => {
      await c.end();
    });

    const definicion = async (tabla: string, nombre: string): Promise<string> => {
      const { rows } = await c.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = $1 and conrelid = $2::regclass`,
        [nombre, `public.${tabla}`],
      );
      expect(rows, `falta el CHECK ${nombre}`).toHaveLength(1);
      return rows[0]?.def as string;
    };
    const SUCURSAL = [
      "sucursal_nombre_ck",
      "sucursal_nombre_largo_ck",
      "sucursal_nombre_control_ck",
    ];

    /** La condición del CHECK, sin `CHECK (...)` y con la columna normalizada, para comparar las dos tablas. */
    const condicion = (def: string, columna: string): string =>
      def
        .replace(/^CHECK \(+/, "")
        .replace(/\)+$/, "")
        .replaceAll(columna, "<col>");

    it("el largo: el tope de la sucursal, el del comprobante y el del dominio son el mismo", async () => {
      const tope = (def: string, columna: string) =>
        Number(new RegExp(`char_length\\(${columna}\\) <= (\\d+)`).exec(def)?.[1]);
      const enSucursal = tope(await definicion("sucursal", "sucursal_nombre_largo_ck"), "nombre");
      const enComprobante = tope(
        await definicion("comprobante", "comprobante_sucursal_nombre_ck"),
        "sucursal_nombre",
      );
      expect(enSucursal).toBe(LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL);
      expect(enComprobante).toBe(LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL);
    });

    it("cada condición de los tres CHECK de la sucursal está, igual, en el del comprobante (y no hay ninguna de más)", async () => {
      const del = condicion(
        await definicion("comprobante", "comprobante_sucursal_nombre_ck"),
        "sucursal_nombre",
      );
      const partes: string[] = [];
      for (const nombre of SUCURSAL) {
        partes.push(condicion(await definicion("sucursal", nombre), "nombre"));
      }
      for (const parte of partes) {
        expect(del, `«${parte}» no está en el CHECK del comprobante: «${del}»`).toContain(parte);
      }
      // Nada más que esas tres condiciones unidas por AND (cada una puede venir entre paréntesis).
      const sobrante = partes
        .reduce((resto, parte) => resto.replace(parte, ""), del)
        .replace(/[()\s]|AND/g, "");
      expect(sobrante, "el CHECK del comprobante tiene condiciones que la sucursal no tiene").toBe(
        "",
      );
    });

    it("la base y `nombreDeSucursalValido` coinciden: todo nombre limpio por el dominio pasa los CHECK, y los CHECK rechazan lo que el dominio rechaza", async () => {
      const pasa = async (texto: string): Promise<boolean> => {
        const { rows } = await c.query<{ ok: boolean }>(
          `select (($1::text) !~ '^\\s|\\s$' and ($1::text) <> '' and char_length($1::text) <= ${LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL}
                 and ($1::text) !~ '[\\x01-\\x1F\\x7F-\\x9F]') as ok`,
          [texto],
        );
        return rows[0]?.ok === true;
      };
      const textos = [
        "Centro",
        "a",
        "x".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL),
        "x".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL + 1),
        "😀".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL), // el tope es de caracteres, no de bytes
        "😀".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL + 1),
        "Ñandú — Güemes",
        "",
        " Centro",
        "Centro ",
        "  Centro  ",
        "Centro\nNorte",
        "Centro\tNorte",
        "Centro\u0085Norte",
        "Cafe\u0301",
      ];
      for (const texto of textos) {
        const r = nombreDeSucursalValido(texto);
        // Lo que el dominio acepta (ya limpio) siempre pasa la regla de la base.
        if (r.ok) expect(await pasa(r.valor), JSON.stringify(texto)).toBe(true);
        // Lo que la base rechaza lo rechaza el dominio tal cual llega (nunca queda un texto sin regla).
        if (!(await pasa(texto)) && texto === texto.normalize("NFC").trim()) {
          expect(r.ok, JSON.stringify(texto)).toBe(false);
        }
      }
    });

    it("«sin control»: la clase de la base y `\\p{Cc}` del dominio coinciden en cada carácter hasta U+00FF y en los separadores de línea", async () => {
      const def = await definicion("comprobante", "comprobante_sucursal_nombre_ck");
      const clase = /!~ '(\[[^']*\])'/.exec(def)?.[1];
      expect(clase, `sin la regla de «sin control» en «${def}»`).toBeDefined();
      const puntos = [...Array.from({ length: 0x100 }, (_, i) => i), 0x2028, 0x2029, 0xfeff];
      for (const punto of puntos) {
        if (punto === 0) continue; // Postgres no admite NUL en un texto
        const { rows } = await c.query<{ ok: boolean }>("select (chr($1) !~ $2) as ok", [
          punto,
          clase,
        ]);
        expect(
          rows[0]?.ok,
          `U+${punto.toString(16).padStart(4, "0")} (la base y el dominio no coinciden)`,
        ).toBe(!/\p{Cc}/u.test(String.fromCodePoint(punto)));
      }
    });

    it("no hay otro CHECK sobre el nombre congelado: uno solo en el comprobante", async () => {
      const { rows } = await c.query<{ nombre: string }>(
        `select conname as nombre from pg_constraint
        where contype = 'c' and conrelid = 'public.comprobante'::regclass
          and pg_get_constraintdef(oid) ~ '\\msucursal_nombre\\M'
        order by 1`,
      );
      expect(rows).toEqual([{ nombre: "comprobante_sucursal_nombre_ck" }]);
    });
  },
);
