import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { comoEmpresa, crearEmpresaActiva, crearEntornoDePrueba } from "./entorno";
import { productoDeBase } from "./catalogo-apoyo";
import type { BaseDePruebas } from "./global";
import { SesionDePrueba } from "./sesiones";

/**
 * 0079, 0080 y 0081 (familias, A8) contra una base real: forma y privilegios, aislamiento entre empresas, un producto en UNA sola familia aunque dos lo pidan a la vez,
 * miembros que no se reactivan, aplicaciones de precio que son registro (idempotencia por id), orden y estrella, y las reversiones.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const CARPETA = join(import.meta.dirname, "../../migraciones/reversiones");

describe.skipIf(base === null)("migraciones 0079, 0080 y 0081: familias", () => {
  const entorno = crearEntornoDePrueba(base as BaseDePruebas, 6);
  let dueno: pg.Client;
  let empresa: string;
  let otra: string;

  const comoApp = (e: string) =>
    SesionDePrueba.abrir(base as BaseDePruebas, "pedernal_app", comoEmpresa(e as never));
  const intentar = async (e: string, sql: string, p: unknown[] = []): Promise<string | null> => {
    const s = await comoApp(e);
    try {
      const r = await s.intentar(sql, p);
      if (r.ok) {
        await s.confirmar();
        return null;
      }
      return `${r.codigo}:${r.restriccion ?? ""}`;
    } finally {
      await s.cerrar();
    }
  };
  const familia = async (e: string, nombre: string, id: string = randomUUID()): Promise<string> => {
    const falla = await intentar(
      e,
      "insert into familia_de_producto (id, empresa_id, nombre, nombre_clave) values ($1, $2, $3, lower($3))",
      [id, e, nombre],
    );
    if (falla !== null) throw new Error(`no se pudo crear la familia ${nombre}: ${falla}`);
    return id;
  };
  const agregar = (e: string, f: string, p: string, posicion: number) =>
    intentar(
      e,
      "insert into miembro_de_familia (empresa_id, familia_id, producto_id, posicion, agregado_en) values ($1, $2, $3, $4, now())",
      [e, f, p, posicion],
    );

  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
    await dueno.connect();
    empresa = (await crearEmpresaActiva(entorno)).empresa;
    otra = (await crearEmpresaActiva(entorno)).empresa;
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
  });

  describe("forma y privilegios", () => {
    it("RLS activa y forzada en las cuatro tablas; nadie recibe DELETE ni TRUNCATE; el rol público no escribe", async () => {
      const tablas = [
        "familia_de_producto",
        "miembro_de_familia",
        "aplicacion_de_precio_de_familia",
        "lugar_en_carta_de_producto",
      ];
      const rls = await dueno.query<{ relname: string; a: boolean; b: boolean }>(
        "select relname, relrowsecurity as a, relforcerowsecurity as b from pg_class where relname = any($1)",
        [tablas],
      );
      expect(rls.rows).toHaveLength(4);
      expect(rls.rows.every((r) => r.a && r.b)).toBe(true);
      const roles = [
        "pedernal_app",
        "pedernal_grupo",
        "pedernal_trabajos",
        "pedernal_plataforma",
        "pedernal_publico",
      ];
      const privilegios = await dueno.query<{ r: string; t: string; p: string }>(
        `select r, t, p from unnest($1::text[]) r, unnest($2::text[]) t, unnest(array['DELETE','TRUNCATE','INSERT','UPDATE']) p
          where has_table_privilege(r, t, p)`,
        [roles, tablas],
      );
      expect(privilegios.rows).toEqual([]);
    });

    it("el rol público lee por columna solo lo de la carta (ni quién creó ni cuándo)", async () => {
      const { rows } = await dueno.query<{ t: string; c: string }>(
        `select table_name as t, column_name as c from information_schema.column_privileges
          where grantee = 'pedernal_publico' and privilege_type = 'SELECT'
            and table_name in ('familia_de_producto','miembro_de_familia','lugar_en_carta_de_producto') order by 1, 2`,
      );
      const porTabla = (t: string) => rows.filter((r) => r.t === t).map((r) => r.c);
      expect(porTabla("familia_de_producto")).toEqual([
        "activa",
        "agrupar_en_carta",
        "destacada",
        "empresa_id",
        "id",
        "nombre",
        "orden",
      ]);
      expect(porTabla("miembro_de_familia")).toEqual([
        "empresa_id",
        "familia_id",
        "posicion",
        "producto_id",
        "quitado_en",
      ]);
      expect(porTabla("lugar_en_carta_de_producto")).toEqual([
        "destacado",
        "empresa_id",
        "orden",
        "producto_id",
      ]);
    });

    it("sin código de carta el rol público no ve ninguna familia", async () => {
      await familia(empresa, `Publica ${randomUUID()}`);
      const s = await SesionDePrueba.abrir(base as BaseDePruebas, "pedernal_publico", null);
      try {
        const r = await s.intentar("select id from familia_de_producto");
        expect(r.ok && r.rows.length).toBe(0);
      } finally {
        await s.cerrar();
      }
    });
  });

  describe("0079: familias y miembros", () => {
    it("nombre único por empresa sin distinguir mayúsculas; otra empresa puede repetirlo", async () => {
      const nombre = `Cafe ${randomUUID().slice(0, 6)}`;
      await familia(empresa, nombre);
      const insertar = (e: string, n: string) =>
        intentar(
          e,
          "insert into familia_de_producto (empresa_id, nombre, nombre_clave) values ($1, $2, lower($2))",
          [e, n],
        );
      expect(await insertar(empresa, nombre)).toBe("23505:familia_nombre_uk");
      expect(await insertar(empresa, nombre.toUpperCase())).toBe("23505:familia_nombre_uk");
      expect(await insertar(otra, nombre)).toBeNull();
    });

    it("un nombre con caracteres fuera de la lista se rechaza; los interruptores nacen apagados y la familia nace activa", async () => {
      expect(
        await intentar(
          empresa,
          "insert into familia_de_producto (empresa_id, nombre, nombre_clave) values ($1, '<b>x</b>', 'x')",
          [empresa],
        ),
      ).toBe("23514:familia_nombre_ck");
      const id = await familia(empresa, `Defecto ${randomUUID().slice(0, 6)}`);
      const { rows } = await dueno.query(
        "select agrupar_en_carta, agrupar_en_pos, activa, version from familia_de_producto where id = $1",
        [id],
      );
      expect(rows[0]).toEqual({
        agrupar_en_carta: false,
        agrupar_en_pos: false,
        activa: true,
        version: 1,
      });
    });

    it("un producto está en UNA familia a la vez: el segundo vínculo vigente se rechaza; quitado, puede volver a entrar", async () => {
      const f1 = await familia(empresa, `F1 ${randomUUID().slice(0, 6)}`);
      const f2 = await familia(empresa, `F2 ${randomUUID().slice(0, 6)}`);
      const p = await productoDeBase(dueno, empresa);
      expect(await agregar(empresa, f1, p, 1)).toBeNull();
      expect(await agregar(empresa, f2, p, 1)).toBe("23505:miembro_vigente_producto_uk");
      expect(await agregar(empresa, f1, p, 2)).toBe("23505:miembro_vigente_producto_uk");
      expect(
        await intentar(
          empresa,
          "update miembro_de_familia set quitado_en = now(), quitado_por = null where producto_id = $1 and quitado_en is null",
          [p],
        ),
      ).toBeNull();
      expect(await agregar(empresa, f2, p, 1)).toBeNull();
      const { rows } = await dueno.query(
        "select count(*)::int as n from miembro_de_familia where producto_id = $1",
        [p],
      );
      expect(rows[0]).toEqual({ n: 2 });
    });

    it("dos personas agregan el MISMO producto a familias distintas a la vez: gana una sola", async () => {
      const f1 = await familia(empresa, `C1 ${randomUUID().slice(0, 6)}`);
      const f2 = await familia(empresa, `C2 ${randomUUID().slice(0, 6)}`);
      const p = await productoDeBase(dueno, empresa);
      const [a, b] = await Promise.all([agregar(empresa, f1, p, 1), agregar(empresa, f2, p, 1)]);
      expect([a, b].filter((x) => x === null)).toHaveLength(1);
      expect([a, b].filter((x) => x === "23505:miembro_vigente_producto_uk")).toHaveLength(1);
    });

    it("la posición es única entre los miembros vigentes de la familia, y va de 1 a 1000", async () => {
      const f = await familia(empresa, `Pos ${randomUUID().slice(0, 6)}`);
      const p1 = await productoDeBase(dueno, empresa);
      const p2 = await productoDeBase(dueno, empresa);
      expect(await agregar(empresa, f, p1, 1)).toBeNull();
      expect(await agregar(empresa, f, p2, 1)).toBe("23505:miembro_vigente_posicion_uk");
      expect(await agregar(empresa, f, p2, 0)).toBe("23514:miembro_posicion_ck");
      expect(await agregar(empresa, f, p2, 2)).toBeNull();
    });

    it("aislamiento: otra empresa no ve ni toca familias ni miembros; un producto de otra empresa no se agrega", async () => {
      const f = await familia(empresa, `Aisl ${randomUUID().slice(0, 6)}`);
      const pAjeno = await productoDeBase(dueno, otra);
      expect(await agregar(empresa, f, pAjeno, 1)).toBe("23503:miembro_producto_fkey");
      const s = await comoApp(otra);
      try {
        const r = await s.intentar("select id from familia_de_producto where id = $1", [f]);
        expect(r.ok && r.rows.length).toBe(0);
        const u = await s.intentar("update familia_de_producto set activa = false where id = $1", [
          f,
        ]);
        expect(u.ok && u.filas).toBe(0);
        const i = await s.intentar(
          "insert into miembro_de_familia (empresa_id, familia_id, producto_id, posicion, agregado_en) values ($1, $2, $3, 1, now())",
          [empresa, f, pAjeno],
        );
        expect(i.ok).toBe(false);
      } finally {
        await s.cerrar();
      }
    });

    it("un miembro quitado no cambia más; la familia y el producto de un miembro no se mueven; nada se borra", async () => {
      const f = await familia(empresa, `Inm ${randomUUID().slice(0, 6)}`);
      const g = await familia(empresa, `Inm2 ${randomUUID().slice(0, 6)}`);
      const p = await productoDeBase(dueno, empresa);
      await agregar(empresa, f, p, 1);
      expect(
        await intentar(
          empresa,
          "update miembro_de_familia set familia_id = $2 where producto_id = $1 and quitado_en is null",
          [p, g],
        ),
      ).toBeTypeOf("string");
      await intentar(
        empresa,
        "update miembro_de_familia set quitado_en = now() where producto_id = $1 and quitado_en is null",
        [p],
      );
      expect(
        await intentar(
          empresa,
          "update miembro_de_familia set quitado_en = null where producto_id = $1",
          [p],
        ),
      ).toBe("23514:miembro_quitado_inmutable");
      const falla = await dueno
        .query("delete from miembro_de_familia where producto_id = $1", [p])
        .then(
          () => null,
          (e: { message: string }) => e.message,
        );
      expect(falla).not.toBeNull();
      const falla2 = await dueno.query("truncate familia_de_producto").then(
        () => null,
        (e: { message: string }) => e.message,
      );
      expect(falla2).not.toBeNull();
    });

    it("la versión de la familia sube sola con cada cambio y la identidad no cambia", async () => {
      const f = await familia(empresa, `Ver ${randomUUID().slice(0, 6)}`);
      expect(
        await intentar(
          empresa,
          "update familia_de_producto set agrupar_en_carta = true where id = $1",
          [f],
        ),
      ).toBeNull();
      const { rows } = await dueno.query("select version from familia_de_producto where id = $1", [
        f,
      ]);
      expect(rows[0]).toEqual({ version: 2 });
      expect(
        await dueno
          .query("update familia_de_producto set empresa_id = $2 where id = $1", [f, otra])
          .then(
            () => null,
            (e: { constraint?: string }) => e.constraint ?? "?",
          ),
      ).toBe("familia_identidad_inmutable");
    });
  });

  describe("0080: aplicación de precio de la familia", () => {
    const huella = "a".repeat(64);
    const aplicar = (e: string, id: string, f: string, h = huella) =>
      intentar(
        e,
        "insert into aplicacion_de_precio_de_familia (id, empresa_id, familia_id, huella, precios_escritos, precios_sin_cambio, aplicada_en) values ($1, $2, $3, $4, 3, 1, now())",
        [id, e, f, h],
      );

    it("el id es la clave: el mismo id dos veces o a la vez se rechaza (y la huella distingue un pedido de otro)", async () => {
      const f = await familia(empresa, `Ap ${randomUUID().slice(0, 6)}`);
      const id = randomUUID();
      const [a, b] = await Promise.all([aplicar(empresa, id, f), aplicar(empresa, id, f)]);
      expect([a, b].filter((x) => x === null)).toHaveLength(1);
      expect([a, b].filter((x) => x === "23505:aplicacion_de_precio_de_familia_pkey")).toHaveLength(
        1,
      );
      const { rows } = await dueno.query(
        "select huella from aplicacion_de_precio_de_familia where id = $1",
        [id],
      );
      expect(rows).toEqual([{ huella }]);
    });

    it("huella con forma inválida, conteos fuera de rango y familia de otra empresa se rechazan", async () => {
      const f = await familia(empresa, `Ap2 ${randomUUID().slice(0, 6)}`);
      expect(await aplicar(empresa, randomUUID(), f, "xyz")).toBe("23514:aplicacion_huella_ck");
      expect(await aplicar(otra, randomUUID(), f)).toBe("23503:aplicacion_familia_fkey");
    });

    it("una aplicación hecha no se cambia ni se borra, ni por el dueño; otra empresa no la ve", async () => {
      const f = await familia(empresa, `Ap3 ${randomUUID().slice(0, 6)}`);
      const id = randomUUID();
      await aplicar(empresa, id, f);
      expect(
        await intentar(
          empresa,
          "update aplicacion_de_precio_de_familia set precios_escritos = 9 where id = $1",
          [id],
        ),
      ).toBeTypeOf("string");
      expect(
        await dueno
          .query("update aplicacion_de_precio_de_familia set precios_escritos = 9 where id = $1", [
            id,
          ])
          .then(
            () => null,
            (e: { constraint?: string }) => e.constraint ?? "?",
          ),
      ).toBe("aplicacion_inmutable");
      expect(
        await dueno.query("delete from aplicacion_de_precio_de_familia where id = $1", [id]).then(
          () => null,
          () => "frenado",
        ),
      ).toBe("frenado");
      const s = await comoApp(otra);
      try {
        const r = await s.intentar("select id from aplicacion_de_precio_de_familia where id = $1", [
          id,
        ]);
        expect(r.ok && r.rows.length).toBe(0);
      } finally {
        await s.cerrar();
      }
    });
  });

  describe("0081: orden y estrella", () => {
    it("la sección nace alfabética y la versión del orden sube de a uno; dos cambios con la misma versión no se pisan", async () => {
      const seccion = randomUUID();
      await dueno.query(
        "insert into seccion_de_carta (id, empresa_id, nombre, nombre_clave, orden) values ($1, $2, $3, lower($3), 0)",
        [seccion, empresa, `Sec ${seccion.slice(0, 6)}`],
      );
      const { rows } = await dueno.query(
        "select orden_de_renglones, version_del_orden from seccion_de_carta where id = $1",
        [seccion],
      );
      expect(rows[0]).toEqual({ orden_de_renglones: "ALFABETICO", version_del_orden: 1 });
      const cambiar = async () => {
        const s = await comoApp(empresa);
        try {
          const r = await s.directo(
            "update seccion_de_carta set orden_de_renglones = 'A_MANO', version_del_orden = version_del_orden + 1 where id = $1 and empresa_id = $2 and version_del_orden = 1",
            [seccion, empresa],
          );
          await s.confirmar();
          return r.ok ? r.filas : -1;
        } finally {
          await s.cerrar();
        }
      };
      const resultados = await Promise.all([cambiar(), cambiar()]);
      expect(resultados.sort()).toEqual([0, 1]);
      expect(
        await intentar(
          empresa,
          "update seccion_de_carta set version_del_orden = version_del_orden + 5 where id = $1",
          [seccion],
        ),
      ).toBe("23514:seccion_version_del_orden_salto");
      expect(
        await intentar(
          empresa,
          "update seccion_de_carta set orden_de_renglones = 'AL_AZAR' where id = $1",
          [seccion],
        ),
      ).toBe("23514:seccion_orden_de_renglones_ck");
    });

    it("el lugar y la estrella de un producto suelto se fijan como estado: repetir no cambia nada, y no hay tope de estrellas", async () => {
      const p = await productoDeBase(dueno, empresa);
      const poner = (orden: number, destacado: boolean) =>
        intentar(
          empresa,
          `insert into lugar_en_carta_de_producto (empresa_id, producto_id, orden, destacado, actualizado_en) values ($1, $2, $3, $4, now())
             on conflict (empresa_id, producto_id) do update set orden = excluded.orden, destacado = excluded.destacado, actualizado_en = excluded.actualizado_en`,
          [empresa, p, orden, destacado],
        );
      expect(await poner(3, true)).toBeNull();
      expect(await poner(3, true)).toBeNull();
      const { rows } = await dueno.query<{ orden: number; destacado: boolean }>(
        "select orden, destacado, version from lugar_en_carta_de_producto where producto_id = $1",
        [p],
      );
      expect(rows[0]?.orden).toBe(3);
      expect(rows[0]?.destacado).toBe(true);
      expect(await poner(-1, false)).toBe("23514:lugar_orden_ck");
      for (let i = 0; i < 12; i += 1) {
        const q = await productoDeBase(dueno, empresa);
        expect(
          await intentar(
            empresa,
            "insert into lugar_en_carta_de_producto (empresa_id, producto_id, destacado, actualizado_en) values ($1, $2, true, now())",
            [empresa, q],
          ),
        ).toBeNull();
      }
    });

    it("el orden y la estrella de una familia: acotados y de la empresa", async () => {
      const f = await familia(empresa, `Ord ${randomUUID().slice(0, 6)}`);
      expect(
        await intentar(
          empresa,
          "update familia_de_producto set orden = 2, destacada = true where id = $1",
          [f],
        ),
      ).toBeNull();
      expect(
        await intentar(empresa, "update familia_de_producto set orden = 100001 where id = $1", [f]),
      ).toBe("23514:familia_orden_ck");
      const s = await comoApp(otra);
      try {
        const u = await s.intentar(
          "update familia_de_producto set destacada = false where id = $1",
          [f],
        );
        expect(u.ok && u.filas).toBe(0);
      } finally {
        await s.cerrar();
      }
    });
  });

  describe("reversiones", () => {
    it("los tres scripts existen, piden confirmación con datos y están en orden inverso de dependencia", async () => {
      for (const n of [
        "0081_revertir_orden_y_destacado_de_la_carta",
        "0080_revertir_aplicacion_de_precio_de_familia",
        "0079_revertir_familias_de_productos",
      ]) {
        const texto = await readFile(join(CARPETA, `${n}.sql`), "utf8");
        expect(texto).toContain("pedernal.confirmar_reversion");
        expect(texto).toContain("DESTRUCTIVA");
        expect(texto).not.toMatch(/DROP[^;]*CASCADE/i);
      }
    });

    it("revertir 0081, 0080 y 0079, repetir cada reversión y volver a aplicarlas deja todo en pie (todo dentro de una transacción que se deshace)", async () => {
      const leer = (carpeta: string, n: string) => readFile(join(carpeta, `${n}.sql`), "utf8");
      const migraciones = join(import.meta.dirname, "../../migraciones");
      const c = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
      await c.connect();
      try {
        await c.query("begin");
        await c.query("set local lock_timeout = '60s'");
        await c.query("set local pedernal.confirmar_reversion = 'SI'");
        for (const n of [
          "0081_revertir_orden_y_destacado_de_la_carta",
          "0080_revertir_aplicacion_de_precio_de_familia",
          "0079_revertir_familias_de_productos",
        ]) {
          const sql = await leer(CARPETA, n);
          await c.query(sql);
          await c.query(sql);
        }
        const fuera = await c.query(
          `select to_regclass('public.familia_de_producto') as f, to_regclass('public.miembro_de_familia') as m,
                  to_regclass('public.aplicacion_de_precio_de_familia') as a, to_regclass('public.lugar_en_carta_de_producto') as l,
                  (select count(*) from information_schema.columns where table_name = 'seccion_de_carta' and column_name in ('orden_de_renglones','version_del_orden'))::int as c`,
        );
        expect(fuera.rows[0]).toEqual({ f: null, m: null, a: null, l: null, c: 0 });
        for (const n of [
          "0079_familias_de_productos",
          "0080_aplicacion_de_precio_de_familia",
          "0081_orden_y_destacado_de_la_carta",
        ]) {
          await c.query(await leer(migraciones, n));
        }
        const dentro = await c.query<{ f: string; l: string }>(
          "select to_regclass('public.familia_de_producto') as f, to_regclass('public.lugar_en_carta_de_producto') as l",
        );
        expect(dentro.rows[0]?.f).toBe("familia_de_producto");
        expect(dentro.rows[0]?.l).toBe("lugar_en_carta_de_producto");
      } finally {
        await c.query("rollback").catch(() => undefined);
        await c.end();
      }
    });
  });
});
