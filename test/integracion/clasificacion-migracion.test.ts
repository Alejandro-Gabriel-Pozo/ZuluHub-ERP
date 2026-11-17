import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { MAXIMO_DE_NIVELES_DE_CLASIFICACION } from "../../src/primitivas/clasificacion/arbol";
import { comoEmpresa, crearBaseAparte, crearEmpresaActiva, crearEntornoDePrueba } from "./entorno";
import { productoDeBase } from "./catalogo-apoyo";
import { crearPersonaDeBase } from "./fixtures-identidad";
import type { BaseDePruebas } from "./global";
import { esperarBloqueo, SesionDePrueba } from "./sesiones";

/**
 * 0045 (clasificación comercial, T-A de A2b) contra una base real: el tope copiado de la primitiva, la forma de la tabla, lo que impone la base aunque el código se
 * olvide (ciclo, tope, departamento que no se mueve, activo e inactivo, nada se borra), el aislamiento entre empresas, dos movimientos a la vez y la reversión.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const REVERSION = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0045_revertir_clasificacion_comercial.sql",
);
const REVERSION_DEL_CAMINO = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0047_revertir_camino_en_el_renglon.sql",
);
const REVERSION_DEL_DEPARTAMENTO = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0048_revertir_departamento_en_la_cuenta.sql",
);
const REVERSION_DEL_VINCULO = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0046_revertir_clasificacion_de_producto.sql",
);

describe.skipIf(base === null)("migración 0045: clasificación comercial", () => {
  const entorno = crearEntornoDePrueba(base as BaseDePruebas, 6);
  let dueno: pg.Client;
  let empresa: string;
  let otra: string;

  const comoApp = (e: string) =>
    SesionDePrueba.abrir(base as BaseDePruebas, "pedernal_app", comoEmpresa(e as never));

  /** Crea un nodo con el rol de la aplicación (en su propia transacción) y devuelve su id. */
  const crear = async (
    e: string,
    nombre: string,
    padre: string | null = null,
    id: string = randomUUID(),
  ): Promise<string> => {
    const s = await comoApp(e);
    try {
      const r = await s.directo(
        "insert into nodo_de_clasificacion (id, empresa_id, padre_id, nombre, nombre_clave) values ($1, $2, $3, $4, lower($4))",
        [id, e, padre, nombre],
      );
      if (!r.ok) throw new Error(`no se pudo crear ${nombre}: ${r.mensaje}`);
      await s.confirmar();
    } finally {
      await s.cerrar();
    }
    return id;
  };

  /** Una sentencia con el rol de la aplicación, en su propia transacción: devuelve la falla como `codigo:restriccion` o `null`. */
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

  describe("el tope de niveles", () => {
    it("el de la base es el de la primitiva: una sola cifra, copiada y comparada", async () => {
      const { rows } = await dueno.query<{ n: number }>(
        "select tope_de_niveles_de_clasificacion() as n",
      );
      expect(rows[0]?.n).toBe(MAXIMO_DE_NIVELES_DE_CLASIFICACION);
    });
  });

  describe("forma y permisos", () => {
    it("RLS activa y forzada; sin DELETE ni TRUNCATE para nadie; solo la aplicación recibe algo, y por columna", async () => {
      const { rows } = await dueno.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "select relrowsecurity, relforcerowsecurity from pg_class where relname = 'nodo_de_clasificacion'",
      );
      expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const roles = [
        "pedernal_app",
        "pedernal_grupo",
        "pedernal_trabajos",
        "pedernal_plataforma",
        "pedernal_publico",
        "pedernal_captacion",
        "pedernal_autenticacion",
      ];
      const privilegios = await dueno.query<{ rol: string; privilegio: string; tiene: boolean }>(
        `select r as rol, p as privilegio, has_table_privilege(r, 'nodo_de_clasificacion', p) as tiene
           from unnest($1::text[]) r, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p`,
        [roles],
      );
      const con = privilegios.rows.filter((x) => x.tiene).map((x) => `${x.rol}:${x.privilegio}`);
      // INSERT y UPDATE se dan por columna: a nivel de tabla no hay ninguno.
      expect(con).toEqual(["pedernal_app:SELECT"]);
      const columnas = await dueno.query<{ privilegio: string; columna: string }>(
        `select privilege_type as privilegio, column_name as columna from information_schema.column_privileges
          where table_name = 'nodo_de_clasificacion' and grantee = 'pedernal_app' and privilege_type in ('INSERT','UPDATE') order by 1, 2`,
      );
      expect(columnas.rows).toEqual([
        ...["empresa_id", "id", "nombre", "nombre_clave", "padre_id"].map((c) => ({
          privilegio: "INSERT",
          columna: c,
        })),
        ...["activo", "nombre", "nombre_clave", "padre_id"].map((c) => ({
          privilegio: "UPDATE",
          columna: c,
        })),
      ]);
    });

    it("solo la aplicación ejecuta la función del tope", async () => {
      const { rows } = await dueno.query<{ rol: string; puede: boolean }>(
        `select r as rol, has_function_privilege(r, 'tope_de_niveles_de_clasificacion()', 'EXECUTE') as puede
           from unnest(array['pedernal_app','pedernal_grupo','pedernal_trabajos','pedernal_plataforma','pedernal_publico']) as r order by 1`,
      );
      expect(rows.filter((r) => r.puede).map((r) => r.rol)).toEqual(["pedernal_app"]);
    });
  });

  describe("lo que impone la base aunque el código se olvide", () => {
    it("un nombre no se repite entre hermanos (ni entre departamentos); bajo otro padre sí", async () => {
      const rest = await crear(empresa, "Restaurante");
      const aloj = await crear(empresa, "Alojamiento");
      expect(
        await intentar(
          empresa,
          "insert into nodo_de_clasificacion (empresa_id, nombre, nombre_clave) values ($1, 'Restaurante', 'restaurante')",
          [empresa],
        ),
      ).toBe("23505:nodo_de_clasificacion_nombre_uk");
      await crear(empresa, "Bebidas", rest);
      expect(
        await intentar(
          empresa,
          "insert into nodo_de_clasificacion (empresa_id, padre_id, nombre, nombre_clave) values ($1, $2, 'Bebidas', 'bebidas')",
          [empresa, rest],
        ),
      ).toBe("23505:nodo_de_clasificacion_nombre_uk");
      await crear(empresa, "Bebidas", aloj); // el mismo nombre bajo otro padre
    });

    it("un nodo no puede ser su propio padre ni tener un padre de otra empresa", async () => {
      const id = randomUUID();
      expect(
        await intentar(
          empresa,
          "insert into nodo_de_clasificacion (id, empresa_id, padre_id, nombre, nombre_clave) values ($1, $2, $1, 'Yo', 'yo')",
          [id, empresa],
        ),
      ).toBe("23503:nodo_de_clasificacion_padre_fkey");
      const ajeno = await crear(otra, "Ajeno");
      expect(
        await intentar(
          empresa,
          "insert into nodo_de_clasificacion (empresa_id, padre_id, nombre, nombre_clave) values ($1, $2, 'Colado', 'colado')",
          [empresa, ajeno],
        ),
      ).toBe("23503:nodo_de_clasificacion_padre_fkey");
    });

    it("el árbol no pasa del tope: el quinto nivel se rechaza", async () => {
      let padre: string | null = null;
      for (let nivel = 1; nivel <= MAXIMO_DE_NIVELES_DE_CLASIFICACION; nivel += 1) {
        padre = await crear(empresa, `Tope ${nivel}`, padre);
      }
      expect(
        await intentar(
          empresa,
          "insert into nodo_de_clasificacion (empresa_id, padre_id, nombre, nombre_clave) values ($1, $2, 'Tope 5', 'tope 5')",
          [empresa, padre],
        ),
      ).toBe("23514:nodo_de_clasificacion_tope");
    });

    it("un departamento no se mueve y ningún nodo pasa a primer nivel", async () => {
      const dep = await crear(empresa, "Fijo");
      const otroDep = await crear(empresa, "Otro fijo");
      const cat = await crear(empresa, "Categoría fija", dep);
      expect(
        await intentar(empresa, "update nodo_de_clasificacion set padre_id = $2 where id = $1", [
          dep,
          otroDep,
        ]),
      ).toBe("23514:nodo_de_clasificacion_raiz_fija");
      expect(
        await intentar(empresa, "update nodo_de_clasificacion set padre_id = null where id = $1", [
          cat,
        ]),
      ).toBe("23514:nodo_de_clasificacion_raiz_fija");
    });

    it("un nodo no queda debajo de sí mismo ni de uno de sus descendientes", async () => {
      const dep = await crear(empresa, "Ciclo dep");
      const a = await crear(empresa, "Ciclo a", dep);
      const b = await crear(empresa, "Ciclo b", a);
      expect(
        await intentar(empresa, "update nodo_de_clasificacion set padre_id = $2 where id = $1", [
          a,
          b,
        ]),
      ).toBe("23514:nodo_de_clasificacion_ciclo");
      expect(
        await intentar(empresa, "update nodo_de_clasificacion set padre_id = $1 where id = $1", [
          a,
        ]),
      ).toBe("23514:nodo_de_clasificacion_ciclo");
    });

    it("al mover, todo el subárbol cuenta contra el tope", async () => {
      const dep1 = await crear(empresa, "Mover dep 1");
      const hoja = await crear(empresa, "Mover hoja", dep1);
      const dep2 = await crear(empresa, "Mover dep 2");
      const c2 = await crear(empresa, "Mover c2", dep2);
      const c3 = await crear(empresa, "Mover c3", c2);
      // `hoja` con dos niveles más (altura 3) bajo c2 (nivel 2) llegaría al nivel 5.
      const h2 = await crear(empresa, "Mover h2", hoja);
      await crear(empresa, "Mover h3", h2);
      expect(
        await intentar(empresa, "update nodo_de_clasificacion set padre_id = $2 where id = $1", [
          hoja,
          c2,
        ]),
      ).toBe("23514:nodo_de_clasificacion_tope");
      // `hoja` bajo dep2 (nivel 1): llega al nivel 4, justo el tope.
      expect(
        await intentar(empresa, "update nodo_de_clasificacion set padre_id = $2 where id = $1", [
          hoja,
          dep2,
        ]),
      ).toBeNull();
      expect(c3).toBeTruthy();
    });

    it("no se desactiva un nodo con hijos activos, ni se pone un nodo bajo uno desactivado, ni se reactiva uno cuyo padre está desactivado", async () => {
      const dep = await crear(empresa, "Activo dep");
      const cat = await crear(empresa, "Activo cat", dep);
      expect(
        await intentar(empresa, "update nodo_de_clasificacion set activo = false where id = $1", [
          dep,
        ]),
      ).toBe("23514:nodo_de_clasificacion_hijos_activos");
      expect(
        await intentar(empresa, "update nodo_de_clasificacion set activo = false where id = $1", [
          cat,
        ]),
      ).toBeNull();
      expect(
        await intentar(empresa, "update nodo_de_clasificacion set activo = false where id = $1", [
          dep,
        ]),
      ).toBeNull();
      expect(
        await intentar(
          empresa,
          "insert into nodo_de_clasificacion (empresa_id, padre_id, nombre, nombre_clave) values ($1, $2, 'Hijo de inactivo', 'hijo de inactivo')",
          [empresa, dep],
        ),
      ).toBe("23514:nodo_de_clasificacion_padre_desactivado");
      expect(
        await intentar(empresa, "update nodo_de_clasificacion set activo = true where id = $1", [
          cat,
        ]),
      ).toBe("23514:nodo_de_clasificacion_padre_desactivado");
      expect(
        await intentar(empresa, "update nodo_de_clasificacion set activo = true where id = $1", [
          dep,
        ]),
      ).toBeNull();
      expect(
        await intentar(empresa, "update nodo_de_clasificacion set activo = true where id = $1", [
          cat,
        ]),
      ).toBeNull();
    });

    it("cada cambio sube la versión y un nodo no cambia de empresa", async () => {
      const id = await crear(empresa, "Versión");
      const s = await comoApp(empresa);
      try {
        await s.directo(
          "update nodo_de_clasificacion set nombre = 'Versión 2', nombre_clave = 'versión 2' where id = $1",
          [id],
        );
        const r = await s.directo("select version from nodo_de_clasificacion where id = $1", [id]);
        expect(r.ok && r.rows[0]?.["version"]).toBe(2);
      } finally {
        await s.cerrar();
      }
      // Con el dueño de la base (evade RLS): la empresa es inmutable.
      await dueno.query("begin");
      await expect(
        dueno.query("update nodo_de_clasificacion set empresa_id = $2 where id = $1", [id, otra]),
      ).rejects.toMatchObject({ code: "23514", constraint: "nodo_de_clasificacion_inmutable" });
      await dueno.query("rollback");
    });

    it("el nombre pasa por la lista de permitidos de la base", async () => {
      for (const malo of ["", "a<b", " con borde ", "+a"]) {
        expect(
          await intentar(
            empresa,
            "insert into nodo_de_clasificacion (empresa_id, nombre, nombre_clave) values ($1, $2, 'x')",
            [empresa, malo],
          ),
          malo,
        ).toBe("23514:nodo_de_clasificacion_nombre_ck");
      }
    });

    it("nada se borra ni se vacía: sin permiso para la aplicación y con disparador para el dueño de la base", async () => {
      const id = await crear(empresa, "Sin borrar");
      expect(await intentar(empresa, "delete from nodo_de_clasificacion where id = $1", [id])).toBe(
        "42501:",
      );
      expect(await intentar(empresa, "truncate nodo_de_clasificacion")).toBe("42501:");
      await dueno.query("begin");
      await expect(
        dueno.query("delete from nodo_de_clasificacion where id = $1", [id]),
      ).rejects.toMatchObject({ code: "42501" });
      await dueno.query("rollback");
      // Con 0046 aplicada, el `TRUNCATE` ya lo frena antes la clave foránea del vínculo del producto (0A000); sin ella lo frena el disparador (42501). Ninguno vacía la tabla.
      await dueno.query("begin");
      let codigo = "sin falla";
      try {
        await dueno.query("truncate nodo_de_clasificacion");
      } catch (e) {
        codigo = (e as { code?: string }).code ?? "?";
      }
      expect(["42501", "0A000"]).toContain(codigo);
      await dueno.query("rollback");
    });
  });

  describe("aislamiento entre empresas", () => {
    it("una empresa no ve ni cambia los nodos de otra", async () => {
      const mio = await crear(empresa, "Aislado mío");
      const ajeno = await crear(otra, "Aislado ajeno");
      const s = await comoApp(empresa);
      try {
        const r = await s.directo(
          "select id from nodo_de_clasificacion where id = any($1::uuid[])",
          [[mio, ajeno]],
        );
        expect(r.ok && r.rows.map((x) => x["id"])).toEqual([mio]);
        const c = await s.directo(
          "update nodo_de_clasificacion set nombre = 'Hackeado', nombre_clave = 'hackeado' where id = $1",
          [ajeno],
        );
        expect(c.ok && c.filas).toBe(0);
        const sinContexto = await SesionDePrueba.abrir(base as BaseDePruebas, "pedernal_app", null);
        try {
          const v = await sinContexto.directo("select id from nodo_de_clasificacion");
          expect(v.ok && v.filas).toBe(0);
        } finally {
          await sinContexto.cerrar();
        }
      } finally {
        await s.cerrar();
      }
    });
  });

  describe("dos movimientos a la vez", () => {
    it("dos movimientos cruzados, cada uno válido por separado, no dejan un ciclo: el segundo espera y se rechaza", async () => {
      const dep = await crear(empresa, "Carrera dep");
      const a = await crear(empresa, "Carrera a", dep);
      const b = await crear(empresa, "Carrera b", dep);
      const sa = await comoApp(empresa);
      const sb = await comoApp(empresa);
      try {
        // A bajo B (la primera transacción lo hace y todavía no confirma)…
        const r1 = await sa.directo(
          "update nodo_de_clasificacion set padre_id = $2 where id = $1",
          [a, b],
        );
        expect(r1.ok).toBe(true);
        // …y B bajo A queda esperando el candado de la empresa.
        const pendiente = sb.directo(
          "update nodo_de_clasificacion set padre_id = $2 where id = $1",
          [b, a],
        );
        expect(await esperarBloqueo(dueno, sb.pid)).toBe(true);
        await sa.confirmar();
        const r2 = await pendiente;
        expect(r2).toMatchObject({
          ok: false,
          codigo: "23514",
          restriccion: "nodo_de_clasificacion_ciclo",
        });
      } finally {
        await sa.cerrar();
        await sb.cerrar();
      }
      const { rows } = await dueno.query<{ id: string; padre_id: string }>(
        "select id, padre_id from nodo_de_clasificacion where id = any($1::uuid[]) order by nombre",
        [[a, b]],
      );
      expect(rows).toEqual([
        { id: a, padre_id: b },
        { id: b, padre_id: dep },
      ]);
    });

    it("la misma alta repetida a la vez no duplica: una gana y la otra recibe el choque de la clave", async () => {
      const id = randomUUID();
      const sa = await comoApp(empresa);
      const sb = await comoApp(empresa);
      const insertar = (s: SesionDePrueba) =>
        s.directo(
          "insert into nodo_de_clasificacion (id, empresa_id, nombre, nombre_clave) values ($1, $2, 'Alta doble', 'alta doble')",
          [id, empresa],
        );
      try {
        const r1 = await insertar(sa); // la primera toma el candado de la empresa y todavía no confirma
        expect(r1.ok).toBe(true);
        const pendiente = insertar(sb); // la segunda espera el candado
        expect(await esperarBloqueo(dueno, sb.pid)).toBe(true);
        await sa.confirmar();
        expect(await pendiente).toMatchObject({ ok: false, codigo: "23505" });
      } finally {
        await sa.cerrar();
        await sb.cerrar();
      }
      const { rows } = await dueno.query("select 1 from nodo_de_clasificacion where id = $1", [id]);
      expect(rows).toHaveLength(1);
    });
  });

  describe("0046: el vínculo del producto con vigencia", () => {
    let persona: string;
    let producto: string;
    let productoAjeno: string;
    let nodoActivo: string;
    let nodoAjeno: string;
    beforeAll(async () => {
      persona = (await crearPersonaDeBase(dueno)).id;
      producto = await productoDeBase(dueno, empresa);
      productoAjeno = await productoDeBase(dueno, otra);
      nodoActivo = await crear(empresa, "Vinculo activo");
      nodoAjeno = await crear(otra, "Vinculo ajeno");
    });

    const comoAppConPersona = (e: string, p: string | null = persona) =>
      SesionDePrueba.abrir(
        base as BaseDePruebas,
        "pedernal_app",
        comoEmpresa(e as never, p as never),
      );
    /** Una sentencia con el rol de la aplicación y la persona del contexto, en su propia transacción: `codigo:restriccion` o `null`. */
    const intentarVinculo = async (
      sql: string,
      p: unknown[] = [],
      quien: string | null = persona,
    ) => {
      const s = await comoAppConPersona(empresa, quien);
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
    const alta = (nodo: string | null, desde: string, productoId = producto, id = randomUUID()) =>
      intentarVinculo(
        "insert into clasificacion_de_producto (id, empresa_id, producto_id, nodo_id, vigente_desde, cargado_por) values ($1, $2, $3, $4, $5, $6)",
        [id, empresa, productoId, nodo, desde, persona],
      );

    it("RLS activa y forzada; solo la aplicación recibe algo: SELECT y un INSERT por columna (sin UPDATE, DELETE ni TRUNCATE)", async () => {
      const { rows } = await dueno.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "select relrowsecurity, relforcerowsecurity from pg_class where relname = 'clasificacion_de_producto'",
      );
      expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const roles = [
        "pedernal_app",
        "pedernal_grupo",
        "pedernal_trabajos",
        "pedernal_plataforma",
        "pedernal_publico",
        "pedernal_captacion",
        "pedernal_autenticacion",
      ];
      const privilegios = await dueno.query<{ rol: string; privilegio: string; tiene: boolean }>(
        `select r as rol, p as privilegio, has_table_privilege(r, 'clasificacion_de_producto', p) as tiene
           from unnest($1::text[]) r, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p`,
        [roles],
      );
      expect(
        privilegios.rows.filter((x) => x.tiene).map((x) => `${x.rol}:${x.privilegio}`),
      ).toEqual(["pedernal_app:SELECT"]);
      const columnas = await dueno.query<{ columna: string }>(
        `select column_name as columna from information_schema.column_privileges
          where table_name = 'clasificacion_de_producto' and grantee = 'pedernal_app' and privilege_type = 'INSERT' order by 1`,
      );
      expect(columnas.rows.map((r) => r.columna)).toEqual([
        "cargado_por",
        "empresa_id",
        "id",
        "nodo_id",
        "producto_id",
        "vigente_desde",
      ]);
      const update = await dueno.query(
        `select 1 from information_schema.column_privileges where table_name = 'clasificacion_de_producto' and grantee = 'pedernal_app' and privilege_type = 'UPDATE'`,
      );
      expect(update.rowCount).toBe(0);
    });

    it("agrega vínculos; uno por instante y producto; «Sin elegir» (nodo nulo) también es un vínculo", async () => {
      expect(await alta(nodoActivo, "2026-11-01T03:00:00Z")).toBeNull();
      expect(await alta(nodoActivo, "2026-11-01T03:00:00Z")).toBe(
        "23505:clasificacion_de_producto_vigencia_uk",
      );
      expect(await alta(null, "2026-11-02T03:00:00Z")).toBeNull();
      expect(await alta(nodoActivo, "2026-11-02T03:00:00Z", productoAjeno)).toBe(
        "23503:clasificacion_de_producto_producto_fkey",
      );
    });

    it("el producto y el nodo son de la misma empresa que la fila", async () => {
      expect(await alta(nodoAjeno, "2026-11-03T03:00:00Z")).toBe(
        "23503:clasificacion_de_producto_nodo_fkey",
      );
      expect(
        await intentarVinculo(
          "insert into clasificacion_de_producto (empresa_id, producto_id, vigente_desde, cargado_por) values ($1, $2, '2026-11-04T03:00:00Z', $3)",
          [empresa, productoAjeno, persona],
        ),
      ).toBe("23503:clasificacion_de_producto_producto_fkey");
    });

    it("no se asigna un nodo desactivado, pero uno desactivado después no altera lo ya vinculado", async () => {
      const hoja = await crear(empresa, "Vinculo hoja");
      expect(await alta(hoja, "2026-11-05T03:00:00Z")).toBeNull();
      expect(
        await intentar(empresa, "update nodo_de_clasificacion set activo = false where id = $1", [
          hoja,
        ]),
      ).toBeNull();
      expect(await alta(hoja, "2026-11-06T03:00:00Z")).toBe(
        "23514:clasificacion_de_producto_nodo_desactivado",
      );
      const { rows } = await dueno.query(
        "select 1 from clasificacion_de_producto where nodo_id = $1",
        [hoja],
      );
      expect(rows).toHaveLength(1);
    });

    it("la persona que carga es la del contexto: otra persona, o ninguna, no pasa la política", async () => {
      const otraPersona = (await crearPersonaDeBase(dueno)).id;
      const sql =
        "insert into clasificacion_de_producto (empresa_id, producto_id, vigente_desde, cargado_por) values ($1, $2, '2026-11-07T03:00:00Z', $3)";
      expect(await intentarVinculo(sql, [empresa, producto, otraPersona])).toBe("42501:");
      expect(await intentarVinculo(sql, [empresa, producto, persona], null)).toBe("42501:");
      expect(await intentarVinculo(sql, [otra, producto, persona])).toBe("42501:");
    });

    it("solo inserción: nadie cambia ni borra un vínculo, ni el dueño de la base", async () => {
      expect(
        await intentarVinculo(
          "update clasificacion_de_producto set nodo_id = null where producto_id = $1",
          [producto],
        ),
      ).toBe("42501:");
      expect(
        await intentarVinculo("delete from clasificacion_de_producto where producto_id = $1", [
          producto,
        ]),
      ).toBe("42501:");
      expect(await intentarVinculo("truncate clasificacion_de_producto")).toBe("42501:");
      await dueno.query("begin");
      await expect(
        dueno.query("update clasificacion_de_producto set nodo_id = null where producto_id = $1", [
          producto,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await dueno.query("rollback");
      await dueno.query("begin");
      await expect(
        dueno.query("delete from clasificacion_de_producto where producto_id = $1", [producto]),
      ).rejects.toMatchObject({ code: "42501" });
      await dueno.query("rollback");
      await dueno.query("begin");
      await expect(dueno.query("truncate clasificacion_de_producto")).rejects.toMatchObject({
        code: "42501",
      });
      await dueno.query("rollback");
    });

    it("una empresa no ve los vínculos de otra", async () => {
      const s = await comoAppConPersona(otra);
      try {
        const r = await s.directo(
          "select id from clasificacion_de_producto where producto_id = $1",
          [producto],
        );
        expect(r.ok && r.filas).toBe(0);
      } finally {
        await s.cerrar();
      }
    });

    it("reversión: frena con vínculos sin confirmación; con ella borra la tabla y la función; repetirla no cambia nada; 0045 no se revierte antes", async () => {
      const aparte = await crearBaseAparte(base as BaseDePruebas);
      const c = new pg.Client({ connectionString: aparte.base.dueno });
      await c.connect();
      try {
        const correr = async (archivo: string, confirmar = false) => {
          const sql = await readFile(archivo, "utf8");
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
        const entorno2 = crearEntornoDePrueba(aparte.base, 3);
        const e2 = await crearEmpresaActiva(entorno2);
        await entorno2.cerrar();
        const p2 = (await crearPersonaDeBase(c)).id;
        const prod2 = await productoDeBase(c, e2.empresa);
        await c.query(
          "insert into clasificacion_de_producto (empresa_id, producto_id, vigente_desde, cargado_por) values ($1, $2, now(), $3)",
          [e2.empresa, prod2, p2],
        );
        // Con el vínculo cargado, revertir 0045 antes falla por dependencia (la clave foránea) y no cambia nada.
        await expect(correr(REVERSION, true)).rejects.toMatchObject({ code: "2BP01" });
        await expect(correr(REVERSION_DEL_VINCULO)).rejects.toMatchObject({ code: "55000" });
        expect((await c.query("select 1 from clasificacion_de_producto")).rowCount).toBe(1);
        await correr(REVERSION_DEL_VINCULO, true);
        const { rows } = await c.query<{ t: string | null; f: string | null }>(
          `select to_regclass('public.clasificacion_de_producto')::text as t, to_regprocedure('public.clasificacion_de_producto_validar()')::text as f`,
        );
        expect(rows[0]).toEqual({ t: null, f: null });
        await correr(REVERSION_DEL_VINCULO); // repetirla no cambia nada
        const registro = await c.query(
          "select 1 from migracion where nombre = '0046_clasificacion_de_producto.sql'",
        );
        expect(registro.rowCount).toBe(0);
        // 0047 (el camino en el renglón) también depende de los nodos: se revierte antes (sin renglones en esta base). Con las dos revertidas, 0045 ya se puede revertir.
        await correr(REVERSION_DEL_DEPARTAMENTO); // 0048 (el departamento en la cuenta) también apunta a los nodos
        await correr(REVERSION_DEL_CAMINO);
        await correr(REVERSION);
      } finally {
        await c.end();
        await aparte.destruir();
      }
    });
  });

  describe("reversión", () => {
    it("con filas frena salvo confirmación; con ella borra la tabla y las funciones; repetirla no cambia nada", async () => {
      const aparte = await crearBaseAparte(base as BaseDePruebas);
      const c = new pg.Client({ connectionString: aparte.base.dueno });
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
        // 0046 y 0047 dependen de esta tabla: se revierten antes (vacías en esta base).
        await c.query("begin");
        await c.query(await readFile(REVERSION_DEL_DEPARTAMENTO, "utf8"));
        await c.query("commit");
        await c.query("begin");
        await c.query(await readFile(REVERSION_DEL_CAMINO, "utf8"));
        await c.query("commit");
        await c.query("begin");
        await c.query(await readFile(REVERSION_DEL_VINCULO, "utf8"));
        await c.query("commit");
        const entorno2 = crearEntornoDePrueba(aparte.base, 3);
        const e2 = await crearEmpresaActiva(entorno2);
        await entorno2.cerrar();
        await c.query(
          "insert into nodo_de_clasificacion (empresa_id, nombre, nombre_clave) values ($1, 'Depto', 'depto')",
          [e2.empresa],
        );
        await expect(correr()).rejects.toMatchObject({ code: "55000" });
        expect((await c.query("select 1 from nodo_de_clasificacion")).rowCount).toBe(1);
        await correr(true);
        const { rows } = await c.query<{ t: string | null; f: string | null; g: string | null }>(
          `select to_regclass('public.nodo_de_clasificacion')::text as t,
                  to_regprocedure('public.tope_de_niveles_de_clasificacion()')::text as f,
                  to_regprocedure('public.nodo_de_clasificacion_validar()')::text as g`,
        );
        expect(rows[0]).toEqual({ t: null, f: null, g: null });
        await correr(); // repetirla no cambia nada
        // Sin la fila del registro, el ejecutor volvería a aplicar la migración.
        const registro = await c.query(
          "select 1 from migracion where nombre = '0045_clasificacion_comercial.sql'",
        );
        expect(registro.rowCount).toBe(0);
      } finally {
        await c.end();
        await aparte.destruir();
      }
    });
  });
});
