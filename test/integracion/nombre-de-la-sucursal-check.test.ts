import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL,
  nombreDeSucursalValido,
} from "../../src/modulos/empresas/publico";

/**
 * El CHECK `comprobante_sucursal_nombre_ck` (0022) es el ESPEJO del CHECK de `sucursal.nombre` (desde 0062 los dos llaman a `texto_de_una_linea_valido`) y repite
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
    /** La condición del CHECK, sin `CHECK (...)` y con la columna normalizada, para comparar las dos tablas. */
    const condicion = (def: string, columna: string): string =>
      def
        .replace(/^CHECK \(+/, "")
        .replace(/\)+$/, "")
        .replaceAll(columna, "<col>");
    // Sin el paréntesis de cierre: `condicion` se lo saca al final de la definición.
    const LLAMADA = `texto_de_una_linea_valido(<col>, ${LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL}`;

    it("el largo y la lista: la sucursal y el comprobante llaman a la MISMA función con el tope del dominio", async () => {
      const enSucursal = condicion(
        await definicion("sucursal", "sucursal_nombre_control_ck"),
        "nombre",
      );
      const enComprobante = condicion(
        await definicion("comprobante", "comprobante_sucursal_nombre_ck"),
        "sucursal_nombre",
      );
      expect(enSucursal).toContain(LLAMADA);
      expect(enComprobante).toContain(LLAMADA);
      // El comprobante solo agrega que el nombre congelado puede faltar (los comprobantes anteriores a 0022 no lo tienen).
      expect(enComprobante.replace(LLAMADA, "").replace(/[()\s]|OR|<col> IS NULL/g, "")).toBe("");
      // El tope de la sucursal sigue además en su CHECK de largo (0005).
      expect(await definicion("sucursal", "sucursal_nombre_largo_ck")).toContain(
        `char_length(nombre) <= ${LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL}`,
      );
    });

    it("la base y `nombreDeSucursalValido` coinciden: todo nombre limpio por el dominio pasa la función de la base, y la función rechaza lo que el dominio rechaza", async () => {
      const pasa = async (texto: string): Promise<boolean> => {
        const { rows } = await c.query<{ ok: boolean }>(
          `select texto_de_una_linea_valido($1::text, ${LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL}) as ok`,
          [texto],
        );
        return rows[0]?.ok === true;
      };
      const textos = [
        "Centro",
        "a",
        "x".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL),
        "x".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL + 1),
        "é".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL), // el tope es de caracteres, no de bytes
        "é".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_SUCURSAL + 1),
        "Ñandú — Güemes",
        "😀",
        "小林商事",
        "<b>x</b>",
        "",
        " Centro",
        "Centro ",
        "  Centro  ",
        "Centro\nNorte",
        "Centro\tNorte",
        "Centro\u0085Norte",
        "Centro\u200BNorte",
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
