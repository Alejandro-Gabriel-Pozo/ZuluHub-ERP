import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import type { BaseDePruebas } from "./global";
import {
  cartaDeBase,
  codigoAlAzar,
  comoPublico,
  disponibilidadDeBase,
  empresaDeCarta,
  type EmpresaDeCarta,
} from "./carta-publica-apoyo";
import { productoDeBase } from "./catalogo-apoyo";

/**
 * 0043 (carta pública y botón «Ocultar») contra una base real: la lista de permitidos ampliada (T0), la forma de las dos tablas, lo que impone la base aunque el
 * código se olvide (identidad inmutable, nada se borra), lo que el rol público puede leer (y nada más), y la reversión.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const REVERSION = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0043_revertir_carta_publica.sql",
);

/** Un error de SQL: el código de la falla y la restricción (o el texto, si no hay restricción). */
const falla = async (c: pg.Client, sql: string, p: unknown[] = []) => {
  await c.query("savepoint intento");
  try {
    await c.query(sql, p);
    await c.query("release savepoint intento");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint intento");
    const err = e as { code?: string; constraint?: string };
    return `${err.code ?? "?"}:${err.constraint ?? ""}`;
  }
};

describe.skipIf(base === null)("migración 0043: carta pública y botón «Ocultar»", () => {
  const entorno = crearEntornoDePrueba(base as BaseDePruebas, 6);
  let dueno: pg.Client;
  let a: EmpresaDeCarta;
  let b: EmpresaDeCarta;
  /** Una carta en línea en la primera sucursal de cada empresa (las pruebas de abajo las comparten; ninguna las modifica). */
  let cartaA: { id: string; codigo: string };
  let cartaB: { id: string; codigo: string };
  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
    await dueno.connect();
    a = await empresaDeCarta(entorno, dueno);
    b = await empresaDeCarta(entorno, dueno);
    cartaA = await cartaDeBase(dueno, a.empresa, a.s1);
    cartaB = await cartaDeBase(dueno, b.empresa, b.s1);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
  });

  describe("T0: la lista de permitidos admite `¿ ¡ ? ! % $`", () => {
    const valida = async (t: string, maximo = 120): Promise<boolean> =>
      (
        await dueno.query<{ ok: boolean }>("select texto_de_catalogo_valido($1, $2) as ok", [
          t,
          maximo,
        ])
      ).rows[0]?.ok as boolean;
    it("los nombres reales de una carta entran, también al principio; `+` y `-` siguen sin abrir", async () => {
      for (const t of [
        "¿Querés papas?",
        "¡Promo!",
        "Combo 2x1 50% $500",
        "$500",
        "%",
        "?",
        "!",
        "a$",
      ]) {
        expect(await valida(t), t).toBe(true);
      }
      for (const t of ["+¿?", "-$", "=1", "@x", "a_b", "a*b", "5 €"])
        expect(await valida(t), t).toBe(false);
    });
    it("`CREATE OR REPLACE` conservó los permisos: solo la aplicación ejecuta la función", async () => {
      const { rows } = await dueno.query<{ rol: string; puede: boolean }>(
        `select r as rol, has_function_privilege(r, 'texto_de_catalogo_valido(text, integer)', 'EXECUTE') as puede
           from unnest(array['pedernal_app','pedernal_grupo','pedernal_trabajos','pedernal_plataforma','pedernal_publico']) as r order by 1`,
      );
      expect(rows.filter((r) => r.puede).map((r) => r.rol)).toEqual(["pedernal_app"]);
    });
  });

  describe("lo que impone la base aunque el código se olvide", () => {
    it("el código y la sucursal de una carta no cambian, ni su identidad, aun con el dueño de la base", async () => {
      const carta = cartaA;
      await dueno.query("begin");
      expect(
        await falla(dueno, "update carta_publica set codigo = $2 where id = $1", [
          carta.id,
          codigoAlAzar(),
        ]),
      ).toBe("23514:carta_publica_codigo_inmutable");
      expect(
        await falla(dueno, "update carta_publica set sucursal_id = $2 where id = $1", [
          carta.id,
          a.s2,
        ]),
      ).toBe("23514:carta_publica_sucursal_inmutable");
      expect(
        await falla(dueno, "update carta_publica set empresa_id = $2 where id = $1", [
          carta.id,
          b.empresa,
        ]),
      ).toBe("23514:carta_publica_identidad_inmutable");
      expect(
        await falla(
          dueno,
          "update carta_publica set nombre = 'Otro', estado = 'FUERA_DE_LINEA' where id = $1",
          [carta.id],
        ),
      ).toBeNull();
      await dueno.query("rollback");
    });

    it("la versión de la carta la sube el disparador y nadie la escribe a mano", async () => {
      const { id } = await cartaDeBase(dueno, a.empresa, a.s2);
      await dueno.query("update carta_publica set nombre = 'Uno', version = 99 where id = $1", [
        id,
      ]);
      await dueno.query("update carta_publica set nombre = 'Dos' where id = $1", [id]);
      const { rows } = await dueno.query<{ version: number }>(
        "select version from carta_publica where id = $1",
        [id],
      );
      expect(rows[0]?.version).toBe(3);
    });

    it("nada se borra ni se vacía, ni el dueño de la base: una carta se retira, un producto se vuelve a mostrar", async () => {
      await disponibilidadDeBase(dueno, a.empresa, a.producto, a.s1, true);
      await dueno.query("begin");
      for (const sql of [
        "delete from carta_publica",
        "truncate carta_publica",
        "delete from disponibilidad_de_producto",
        "truncate disponibilidad_de_producto",
      ]) {
        expect(await falla(dueno, sql), sql).toBe("42501:");
      }
      await dueno.query("rollback");
    });

    it("la disponibilidad: el producto y el alcance no cambian; la versión sube sola", async () => {
      await dueno.query("begin");
      expect(
        await falla(
          dueno,
          "update disponibilidad_de_producto set sucursal_id = $2 where producto_id = $1 and sucursal_id = $3",
          [a.producto, a.s2, a.s1],
        ),
      ).toBe("23514:disponibilidad_identidad_inmutable");
      expect(
        await falla(
          dueno,
          "update disponibilidad_de_producto set producto_id = $2 where producto_id = $1",
          [a.producto, b.producto],
        ),
      ).not.toBeNull();
      await dueno.query(
        "update disponibilidad_de_producto set oculto = false, version = 50 where producto_id = $1 and sucursal_id = $2",
        [a.producto, a.s1],
      );
      const { rows } = await dueno.query<{ version: number }>(
        "select version from disponibilidad_de_producto where producto_id = $1 and sucursal_id = $2",
        [a.producto, a.s1],
      );
      expect(rows[0]?.version).toBe(2);
      await dueno.query("rollback");
    });

    it("dos filas para el mismo (producto, alcance) son imposibles, en cada alcance, y no se cruzan con el de otro producto", async () => {
      await disponibilidadDeBase(dueno, a.empresa, a.producto, null, false);
      await dueno.query("begin");
      expect(
        await falla(
          dueno,
          `insert into disponibilidad_de_producto (empresa_id, producto_id, sucursal_id, oculto, actualizado_en) values ($1, $2, null, true, now())`,
          [a.empresa, a.producto],
        ),
      ).toBe("23505:disponibilidad_de_la_empresa_uk");
      expect(
        await falla(
          dueno,
          `insert into disponibilidad_de_producto (empresa_id, producto_id, sucursal_id, oculto, actualizado_en) values ($1, $2, $3, true, now())`,
          [a.empresa, a.producto, a.s1],
        ),
      ).toBe("23505:disponibilidad_del_local_uk");
      const otro = await productoDeBase(dueno, a.empresa);
      expect(
        await falla(
          dueno,
          `insert into disponibilidad_de_producto (empresa_id, producto_id, sucursal_id, oculto, actualizado_en) values ($1, $2, null, true, now())`,
          [a.empresa, otro],
        ),
      ).toBeNull();
      await dueno.query("rollback");
    });

    it("el código: 22 a 64 caracteres base64url, único en TODA la plataforma; una carta por sucursal; los textos con su tope", async () => {
      const c = cartaB;
      // Una sucursal de la empresa A que todavía no tiene carta (la única restricción que debe saltar es la del código).
      const libre = (
        await dueno.query<{ id: string }>(
          "insert into sucursal (empresa_id, nombre) values ($1, 'Sin carta') returning id",
          [a.empresa],
        )
      ).rows[0]?.id as string;
      await dueno.query("begin");
      const alta = (campo: string, valor: string, sucursal = b.s2, codigo = codigoAlAzar()) =>
        falla(
          dueno,
          `insert into carta_publica (empresa_id, sucursal_id, codigo, nombre, ${campo}) values ($1, $2, $3, 'N', $4)`,
          [b.empresa, sucursal, codigo, valor],
        );
      expect(
        await falla(
          dueno,
          "insert into carta_publica (empresa_id, sucursal_id, codigo, nombre) values ($1, $2, $3, 'N')",
          [a.empresa, libre, c.codigo],
        ),
      ).toBe("23505:carta_publica_codigo_uk");
      expect(
        await falla(
          dueno,
          "insert into carta_publica (empresa_id, sucursal_id, codigo, nombre) values ($1, $2, $3, 'N')",
          [b.empresa, b.s1, codigoAlAzar()],
        ),
      ).toBe("23505:carta_publica_sucursal_uk");
      for (const malo of [
        "a".repeat(21),
        "a".repeat(65),
        "Ab3dEf6hIj9lMn2pQr5t+v",
        "Ab3dEf6hIj9lMn2pQr5t=v",
        `${"a".repeat(21)}\n`,
      ]) {
        expect(
          await falla(
            dueno,
            "insert into carta_publica (empresa_id, sucursal_id, codigo, nombre) values ($1, $2, $3, 'N')",
            [b.empresa, b.s2, malo],
          ),
          JSON.stringify(malo),
        ).toBe("23514:carta_publica_codigo_ck");
      }
      expect(
        await falla(
          dueno,
          "insert into carta_publica (empresa_id, sucursal_id, codigo, nombre) values ($1, $2, $3, 'N')",
          [b.empresa, a.s2, codigoAlAzar()],
        ),
      ).toBe("23503:carta_publica_sucursal_fkey");
      expect(await alta("estado", "BORRADOR")).toBe("23514:carta_publica_estado_ck");
      expect(await alta("rubro", "a".repeat(41))).toBe("23514:carta_publica_rubro_ck");
      expect(await alta("lugar", "a".repeat(121))).toBe("23514:carta_publica_lugar_ck");
      expect(await alta("lugar", "<b>")).toBe("23514:carta_publica_lugar_ck");
      await dueno.query("rollback");
    });

    it("una carta de una empresa no apunta a una sucursal ni un producto de otra (claves foráneas compuestas)", async () => {
      await dueno.query("begin");
      expect(
        await falla(
          dueno,
          `insert into disponibilidad_de_producto (empresa_id, producto_id, sucursal_id, oculto, actualizado_en) values ($1, $2, null, true, now())`,
          [a.empresa, b.producto],
        ),
      ).toBe("23503:disponibilidad_producto_fkey");
      expect(
        await falla(
          dueno,
          `insert into disponibilidad_de_producto (empresa_id, producto_id, sucursal_id, oculto, actualizado_en) values ($1, $2, $3, true, now())`,
          [a.empresa, a.producto, b.s1],
        ),
      ).toBe("23503:disponibilidad_sucursal_fkey");
      await dueno.query("rollback");
    });
  });

  describe("el rol público", () => {
    it("sin `app.codigo_de_carta` no ve ninguna fila de ninguna de las dos tablas; con un código inexistente o de una carta retirada, tampoco", async () => {
      const retirada = await cartaDeBase(dueno, b.empresa, b.s2, { estado: "FUERA_DE_LINEA" });
      const publico = (base as BaseDePruebas).publico;
      for (const codigo of [null, codigoAlAzar(), "", retirada.codigo]) {
        expect(
          await comoPublico(publico, codigo, "select id from carta_publica"),
          String(codigo),
        ).toEqual([]);
        expect(
          await comoPublico(publico, codigo, "select producto_id from disponibilidad_de_producto"),
          String(codigo),
        ).toEqual([]);
      }
    });

    it("con el código de una carta en línea ve SOLO esa fila y solo las columnas públicas", async () => {
      const { codigo } = cartaA;
      const publico = (base as BaseDePruebas).publico;
      const filas = await comoPublico<{
        codigo: string;
        empresa_id: string;
        sucursal_id: string;
        estado: string;
      }>(publico, codigo, "select codigo, empresa_id, sucursal_id, estado from carta_publica");
      expect(filas).toEqual([
        { codigo, empresa_id: a.empresa, sucursal_id: a.s1, estado: "EN_LINEA" },
      ]);
      for (const columna of ["creado_por", "creado_en", "actualizado_en", "version"]) {
        await expect(
          comoPublico(publico, codigo, `select ${columna} from carta_publica`),
          columna,
        ).rejects.toMatchObject({ code: "42501" });
      }
    });

    it("de la disponibilidad ve las filas de la empresa de la carta y las de SU sucursal; nunca las de otros locales ni las de otra empresa", async () => {
      const { codigo } = cartaB;
      const otro = await productoDeBase(dueno, b.empresa);
      const mas = await productoDeBase(dueno, b.empresa);
      await disponibilidadDeBase(dueno, b.empresa, b.producto, null, true);
      await disponibilidadDeBase(dueno, b.empresa, otro, b.s1, true);
      await disponibilidadDeBase(dueno, b.empresa, mas, b.s2, true);
      const filas = await comoPublico<{
        producto_id: string;
        sucursal_id: string | null;
        oculto: boolean;
      }>(
        (base as BaseDePruebas).publico,
        codigo,
        "select producto_id, sucursal_id, oculto from disponibilidad_de_producto order by producto_id",
      );
      expect(filas.map((f) => f.producto_id).sort()).toEqual([b.producto, otro].sort());
      expect(filas.every((f) => f.oculto)).toBe(true);
      await expect(
        comoPublico(
          (base as BaseDePruebas).publico,
          codigo,
          "select actualizado_por from disponibilidad_de_producto",
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("no puede escribir ni borrar nada, y ve solo estas dos tablas del catálogo (la lista exacta de lo que puede leer)", async () => {
      const publico = new pg.Client({ connectionString: (base as BaseDePruebas).publico });
      await publico.connect();
      try {
        for (const sql of [
          "update carta_publica set nombre = 'x'",
          "delete from carta_publica",
          "insert into carta_publica (empresa_id, sucursal_id, codigo, nombre) values (gen_random_uuid(), gen_random_uuid(), 'x', 'x')",
          "update disponibilidad_de_producto set oculto = false",
          "delete from disponibilidad_de_producto",
          "select 1 from producto",
          "select 1 from seccion_de_carta",
        ]) {
          await expect(publico.query(sql), sql).rejects.toMatchObject({ code: "42501" });
        }
      } finally {
        await publico.end();
      }
      const { rows } = await dueno.query<{ tabla: string; columna: string; privilegio: string }>(
        `select table_name as tabla, column_name as columna, privilege_type as privilegio from information_schema.column_privileges
          where grantee = 'pedernal_publico' and table_schema = 'public' and table_name in ('carta_publica', 'disponibilidad_de_producto') order by 1, 2, 3`,
      );
      expect(rows.map((r) => `${r.tabla}.${r.columna}:${r.privilegio}`)).toEqual([
        "carta_publica.codigo:SELECT",
        "carta_publica.empresa_id:SELECT",
        "carta_publica.estado:SELECT",
        "carta_publica.id:SELECT",
        "carta_publica.lugar:SELECT",
        "carta_publica.nombre:SELECT",
        "carta_publica.rubro:SELECT",
        "carta_publica.sucursal_id:SELECT",
        "disponibilidad_de_producto.empresa_id:SELECT",
        "disponibilidad_de_producto.oculto:SELECT",
        "disponibilidad_de_producto.producto_id:SELECT",
        "disponibilidad_de_producto.sucursal_id:SELECT",
      ]);
      // Y de TODO el catálogo (`producto`, `seccion_de_carta`, precios…) el rol público no lee ni una columna hasta que T3 lo declare con su prueba.
      const { rows: delCatalogo } = await dueno.query<{ n: string }>(
        `select count(*)::text as n from information_schema.column_privileges
          where grantee = 'pedernal_publico' and table_schema = 'public'
            and table_name in ('producto', 'seccion_de_carta', 'grupo_de_elecciones', 'opcion', 'version_de_opcion', 'consumo_de_opcion', 'precio_de_venta', 'sucursal', 'empresa')`,
      );
      expect(delCatalogo[0]?.n).toBe("0");
    });
  });

  describe("la reversión", () => {
    it("con las tablas vacías borra todo, deja la lista de 0025 y se puede repetir; con filas frena salvo confirmación; con un texto nuevo guardado frena siempre", async () => {
      const otra = await crearBaseAparte(base as BaseDePruebas);
      const c = new pg.Client({ connectionString: otra.base.dueno });
      await c.connect();
      try {
        const sql = await readFile(REVERSION, "utf8");
        const correr = async (confirmar = false) => {
          await c.query("begin");
          try {
            if (confirmar) await c.query("set local pedernal.confirmar_reversion = 'SI'");
            await c.query(sql);
            await c.query("commit");
          } catch (e) {
            await c.query("rollback");
            throw e;
          }
        };
        // Con una carta cargada: frena sin confirmación y no deja nada hecho.
        const entorno2 = crearEntornoDePrueba(otra.base, 3);
        const e2 = await empresaDeCarta(entorno2, c);
        await entorno2.cerrar();
        await cartaDeBase(c, e2.empresa, e2.s1);
        await expect(correr()).rejects.toMatchObject({ code: "55000" });
        expect((await c.query("select 1 from carta_publica")).rowCount).toBe(1);
        // Con un producto de nombre con `¿` frena AUNQUE se confirme: la lista vieja no lo admite.
        await c.query(
          "update producto set nombre = '¿Querés papas?', nombre_clave = '¿querés papas?' where id = $1",
          [e2.producto],
        );
        await expect(correr(true)).rejects.toMatchObject({ code: "55000" });
        await expect(correr(true)).rejects.toThrow(/la lista vieja/);
        expect((await c.query("select 1 from carta_publica")).rowCount).toBe(1);
        // Corregido el texto y confirmada la pérdida: se aplica, y repetirla no cambia nada.
        await c.query(
          "update producto set nombre = 'Papas', nombre_clave = 'papas' where id = $1",
          [e2.producto],
        );
        await correr(true);
        await correr();
        for (const tabla of ["carta_publica", "disponibilidad_de_producto"]) {
          expect(
            (await c.query<{ t: string | null }>("select to_regclass($1)::text as t", [tabla]))
              .rows[0]?.t,
            tabla,
          ).toBeNull();
        }
        expect(
          (
            await c.query<{ ok: boolean }>(
              "select texto_de_catalogo_valido('¿Querés papas?', 50) as ok",
            )
          ).rows[0]?.ok,
        ).toBe(false);
        expect(
          (
            await c.query<{ ok: boolean }>(
              "select texto_de_catalogo_valido('Papas fritas', 50) as ok",
            )
          ).rows[0]?.ok,
        ).toBe(true);
        expect(
          (await c.query("select 1 from migracion where nombre = '0043_carta_publica.sql'"))
            .rowCount,
        ).toBe(0);
        expect(
          (
            await c.query<{ p: boolean }>(
              "select has_function_privilege('pedernal_app', 'texto_de_catalogo_valido(text, integer)', 'EXECUTE') as p",
            )
          ).rows[0]?.p,
        ).toBe(true);
      } finally {
        await c.end();
        await otra.destruir();
      }
    });
  });
});
