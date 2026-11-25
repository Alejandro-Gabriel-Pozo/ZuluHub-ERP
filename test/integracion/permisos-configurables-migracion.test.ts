import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { PERMISOS_DE_EMPRESA, tablaDePermisos } from "../../src/capacidades/permisos/empresa";
import {
  bloqueDeLaSemilla,
  bloqueDelArchivo,
  PISOS_DE_TODOS_LOS_ROLES,
} from "../../scripts/semilla-de-plantillas";
import {
  comoEmpresa,
  comoPlataforma,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
} from "./entorno";
import { crearPersonaDeBase } from "./fixtures-identidad";
import type { BaseDePruebas } from "./global";
import { esperarBloqueo, SesionDePrueba } from "./sesiones";

/**
 * 0094 (permisos configurables, T1 de H4b) contra una base real: privilegios y RLS (I11), la semilla igual a la tabla de hoy (I14, parte 1), los pisos que la base
 * impone aunque el código se olvide (I5), versiones inmutables, aislamiento entre empresas, escrituras simultáneas y repetidas (I9, I10) y la reversión.
 * Lo que toca tablas GLOBALES (plantillas, pisos) se prueba siempre dentro de una transacción que se deshace: otras pruebas de la corrida leen esas tablas.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const REVERSION = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0094_revertir_permisos_configurables.sql",
);
const MIGRACION = join(import.meta.dirname, "../../migraciones/0094_permisos_configurables.sql");
const SELLOS = join(import.meta.dirname, "../../migraciones/selladas.json");

const ROLES_DE_BASE = [
  "pedernal_app",
  "pedernal_grupo",
  "pedernal_trabajos",
  "pedernal_plataforma",
  "pedernal_publico",
  "pedernal_captacion",
  "pedernal_autenticacion",
];
const TABLAS = [
  "plantilla_de_rol",
  "version_de_plantilla",
  "piso_de_plataforma",
  "accion_introducida",
  "rol_de_empresa",
  "version_de_rol",
];
const TODAS = Object.keys(PERMISOS_DE_EMPRESA).sort();
const tabla = tablaDePermisos(PERMISOS_DE_EMPRESA);
/** Las acciones que hoy tiene solo el gerente y las 4 que tienen todos: el Anexo A del diseño (H4b), escrito aparte para no depender del generador. Sin `productos.asignar_emisor`: el Anexo A la lista, pero la acción se retiró del sistema (#468, sin caso de uso), así que ya no existe. */
const SOLO_GERENTE_ANEXO_A = [
  "sucursales.desactivar",
  "sucursales.reactivar",
  "gerencia.proponer_traspaso",
  "gerencia.cancelar_traspaso",
  "datos_fiscales.editar",
  "datos_fiscales.confirmar",
  "puntos_de_venta.crear",
  "puntos_de_venta.editar",
  "puntos_de_venta.activar",
  "puntos_de_venta.desactivar",
  "puntos_de_venta.cambiar_ambiente",
  "emisores.confirmar_regla",
  "stock.verificar_saldos",
  "series.resincronizar",
  "certificados.gestionar",
  "cajas.crear",
  "cajas.reactivar",
  "cajas.desactivar",
  "compras.configurar",
].sort();
const TODOS_ANEXO_A = [
  "gerencia.ver_traspaso",
  "gerencia.aceptar_traspaso",
  "gerencia.rechazar_traspaso",
  "permisos.ver_propios",
].sort();
/** Una lista válida que cumple los pisos: los cuatro de todos y dos acciones libres. */
const LISTA_VALIDA = [...TODOS_ANEXO_A, "ventas.ver", "mesas.ver"].sort();

describe.skipIf(base === null)("migración 0094: permisos configurables (T1 de H4b)", () => {
  const entorno = crearEntornoDePrueba(base as BaseDePruebas, 6);
  let dueno: pg.Client;
  let empresa: string;
  let otra: string;
  let persona: string;

  const comoApp = (e: string) =>
    SesionDePrueba.abrir(base as BaseDePruebas, "pedernal_app", comoEmpresa(e as never));

  /** Crea un rol propio con el rol de la aplicación (su propia transacción) y devuelve su id. */
  const crearRol = async (
    e: string,
    nombre: string,
    id: string = randomUUID(),
  ): Promise<string> => {
    const s = await comoApp(e);
    try {
      const r = await s.directo(
        "insert into rol_de_empresa (id, empresa_id, nombre, nombre_clave) values ($1, $2, $3, lower($3))",
        [id, e, nombre],
      );
      if (!r.ok) throw new Error(`no se pudo crear ${nombre}: ${r.mensaje}`);
      await s.confirmar();
    } finally {
      await s.cerrar();
    }
    return id;
  };

  const SQL_VERSION =
    "insert into version_de_rol (empresa_id, rol_id, numero, acciones, creado_por, creado_en) values ($1, $2, $3, $4::text[], $5, now())";

  /** Una sentencia con el rol de la aplicación en su propia transacción: la falla como `codigo:restriccion` o `null` si anduvo (y confirmó). */
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

  /** Lo mismo con el dueño de la base, siempre dentro de una transacción que se deshace (las tablas globales no se ensucian). */
  const comoDuenoSinConfirmar = async (sql: string, p: unknown[] = []): Promise<string | null> => {
    await dueno.query("begin");
    try {
      await dueno.query("savepoint s");
      try {
        await dueno.query(sql, p);
        return null;
      } catch (e) {
        const err = e as { code?: string; constraint?: string };
        return `${err.code}:${err.constraint ?? ""}`;
      }
    } finally {
      await dueno.query("rollback");
    }
  };

  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
    await dueno.connect();
    empresa = (await crearEmpresaActiva(entorno)).empresa;
    otra = (await crearEmpresaActiva(entorno)).empresa;
    persona = (await crearPersonaDeBase(dueno)).id;
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
  });

  describe("forma y privilegios (I11)", () => {
    it("RLS activa y forzada en las seis tablas", async () => {
      const { rows } = await dueno.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        "select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1::text[]) order by relname",
        [TABLAS],
      );
      expect(rows.map((r) => r.relname)).toEqual([...TABLAS].sort());
      for (const r of rows) {
        expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([
          r.relname,
          true,
          true,
        ]);
      }
    });

    it("a nivel de tabla solo hay SELECT (la aplicación y la plataforma); nadie tiene DELETE ni TRUNCATE; INSERT y UPDATE son por columna", async () => {
      const { rows } = await dueno.query<{
        tabla: string;
        rol: string;
        privilegio: string;
        tiene: boolean;
      }>(
        `select t as tabla, r as rol, p as privilegio, has_table_privilege(r, t, p) as tiene
           from unnest($1::text[]) t, unnest($2::text[]) r, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p`,
        [TABLAS, ROLES_DE_BASE],
      );
      const con = rows
        .filter((x) => x.tiene)
        .map((x) => `${x.tabla}:${x.rol}:${x.privilegio}`)
        .sort();
      expect(con).toEqual(
        [
          "plantilla_de_rol:pedernal_app:SELECT",
          "version_de_plantilla:pedernal_app:SELECT",
          "piso_de_plataforma:pedernal_app:SELECT",
          "rol_de_empresa:pedernal_app:SELECT",
          "version_de_rol:pedernal_app:SELECT",
          "plantilla_de_rol:pedernal_plataforma:SELECT",
          "version_de_plantilla:pedernal_plataforma:SELECT",
          "piso_de_plataforma:pedernal_plataforma:SELECT",
          "accion_introducida:pedernal_plataforma:SELECT",
        ].sort(),
      );
    });

    it("las columnas con INSERT o UPDATE son exactamente las del diseño (si se suma una, falla)", async () => {
      const { rows } = await dueno.query<{
        tabla: string;
        rol: string;
        privilegio: string;
        columna: string;
      }>(
        `select table_name as tabla, grantee as rol, privilege_type as privilegio, column_name as columna
           from information_schema.column_privileges
          where table_name = any($1::text[]) and grantee = any($2::text[]) and privilege_type in ('INSERT','UPDATE')`,
        [TABLAS, ROLES_DE_BASE],
      );
      const por = (t: string, r: string, p: string) =>
        rows
          .filter((x) => x.tabla === t && x.rol === r && x.privilegio === p)
          .map((x) => x.columna)
          .sort();
      expect(por("rol_de_empresa", "pedernal_app", "INSERT")).toEqual([
        "empresa_id",
        "id",
        "nombre",
        "nombre_clave",
        "plantilla_origen",
      ]);
      expect(por("rol_de_empresa", "pedernal_app", "UPDATE")).toEqual([
        "activo",
        "nombre",
        "nombre_clave",
      ]);
      expect(por("version_de_rol", "pedernal_app", "INSERT")).toEqual([
        "acciones",
        "creado_en",
        "creado_por",
        "empresa_id",
        "numero",
        "rol_id",
      ]);
      expect(por("version_de_plantilla", "pedernal_plataforma", "INSERT")).toEqual([
        "acciones",
        "autor",
        "clave",
        "numero",
      ]);
      expect(por("piso_de_plataforma", "pedernal_plataforma", "INSERT")).toEqual([
        "accion",
        "autor",
        "tipo",
      ]);
      expect(por("piso_de_plataforma", "pedernal_plataforma", "UPDATE")).toEqual(["autor", "tipo"]);
      // Y nada más: ningún otro (tabla, rol, privilegio) de columna.
      const esperados = new Set([
        "rol_de_empresa:pedernal_app:INSERT",
        "rol_de_empresa:pedernal_app:UPDATE",
        "version_de_rol:pedernal_app:INSERT",
        "version_de_plantilla:pedernal_plataforma:INSERT",
        "piso_de_plataforma:pedernal_plataforma:INSERT",
        "piso_de_plataforma:pedernal_plataforma:UPDATE",
      ]);
      const reales = new Set(rows.map((x) => `${x.tabla}:${x.rol}:${x.privilegio}`));
      expect([...reales].sort()).toEqual([...esperados].sort());
    });

    it("la aplicación no puede editar ni borrar una versión, ni una plantilla, ni un piso, ni borrar un rol (42501)", async () => {
      const rol = await crearRol(empresa, "Sin permisos de borrado");
      expect(
        await intentar(empresa, SQL_VERSION, [empresa, rol, 1, LISTA_VALIDA, persona]),
      ).toBeNull();
      for (const sql of [
        "update version_de_rol set acciones = '{}'",
        "delete from version_de_rol",
        "truncate version_de_rol",
        "delete from rol_de_empresa",
        "truncate rol_de_empresa",
        "update rol_de_empresa set empresa_id = empresa_id",
        "update piso_de_plataforma set tipo = 'SOLO_GERENTE'",
        "insert into piso_de_plataforma (accion, tipo, autor) values ('a.b', 'SOLO_GERENTE', 'x')",
        "update version_de_plantilla set acciones = '{}'",
        "insert into version_de_plantilla (clave, numero, acciones, autor) values ('OPERADOR', 99, '{}', 'x')",
        "insert into accion_introducida (accion) values ('a.b')",
      ]) {
        const r = await intentar(empresa, sql);
        expect([sql, r?.split(":")[0]]).toEqual([sql, "42501"]);
      }
    });

    it("ni el dueño de la base borra ni edita lo inmutable: disparadores de solo inserción y sin borrado", async () => {
      const rol = await crearRol(empresa, "Intocable");
      expect(
        await intentar(empresa, SQL_VERSION, [empresa, rol, 1, LISTA_VALIDA, persona]),
      ).toBeNull();
      for (const sql of [
        "update version_de_plantilla set autor = 'otro'",
        "delete from version_de_plantilla",
        "truncate version_de_plantilla",
        "update plantilla_de_rol set clave = clave",
        "delete from plantilla_de_rol",
        "update accion_introducida set accion = accion",
        "delete from accion_introducida",
        "truncate accion_introducida",
        "delete from piso_de_plataforma",
        "truncate piso_de_plataforma",
        "update version_de_rol set acciones = '{}'",
        "delete from version_de_rol",
        "truncate version_de_rol",
        "delete from rol_de_empresa",
        "truncate rol_de_empresa cascade",
        "truncate plantilla_de_rol cascade",
      ]) {
        const r = await comoDuenoSinConfirmar(sql);
        expect([sql, r?.split(":")[0]]).toEqual([sql, "42501"]);
      }
    });

    it("las funciones de forma y de pisos las ejecutan solo la aplicación y la plataforma", async () => {
      const { rows } = await dueno.query<{ f: string; rol: string; puede: boolean }>(
        `select f, r as rol, has_function_privilege(r, f, 'EXECUTE') as puede
           from unnest(array['clave_de_accion_valida(text)','claves_de_accion_validas(text[])','incumplimiento_de_pisos(text[])']) f,
                unnest($1::text[]) r`,
        [ROLES_DE_BASE],
      );
      for (const f of [
        "clave_de_accion_valida(text)",
        "claves_de_accion_validas(text[])",
        "incumplimiento_de_pisos(text[])",
      ]) {
        expect(
          rows
            .filter((x) => x.f === f && x.puede)
            .map((x) => x.rol)
            .sort(),
        ).toEqual(["pedernal_app", "pedernal_plataforma"]);
      }
    });
  });

  describe("la semilla es la tabla de hoy (I14, parte 1)", () => {
    const leerVigente = async (clave: string): Promise<string[]> => {
      const { rows } = await dueno.query<{ acciones: string[] }>(
        "select acciones from version_de_plantilla where clave = $1 order by numero desc limit 1",
        [clave],
      );
      return [...(rows[0]?.acciones ?? [])].sort();
    };

    it("3 roles × todas las acciones: lo que dice la base es idéntico a PERMISOS_DE_EMPRESA", async () => {
      expect(TODAS).toHaveLength(Object.keys(PERMISOS_DE_EMPRESA).length);
      const admin = new Set(await leerVigente("ADMINISTRADOR"));
      const oper = new Set(await leerVigente("OPERADOR"));
      for (const accion of TODAS) {
        const roles: readonly string[] =
          PERMISOS_DE_EMPRESA[accion as keyof typeof PERMISOS_DE_EMPRESA];
        // El gerente no tiene lista: tiene todas las del catálogo (S2). La constante lo dice igual.
        expect([accion, "GERENTE", roles.includes("GERENTE")]).toEqual([accion, "GERENTE", true]);
        expect([accion, "ADMINISTRADOR", admin.has(accion)]).toEqual([
          accion,
          "ADMINISTRADOR",
          roles.includes("ADMINISTRADOR"),
        ]);
        expect([accion, "OPERADOR", oper.has(accion)]).toEqual([
          accion,
          "OPERADOR",
          roles.includes("OPERADOR"),
        ]);
      }
      expect([...admin].sort()).toEqual([...tabla.ADMINISTRADOR]);
      expect([...oper].sort()).toEqual([...tabla.OPERADOR]);
    });

    it("las tres plantillas existen, el gerente no tiene lista y cada otra plantilla tiene la versión 1 de la migración", async () => {
      const p = await dueno.query<{ clave: string }>(
        "select clave from plantilla_de_rol order by clave",
      );
      expect(p.rows.map((r) => r.clave)).toEqual(["ADMINISTRADOR", "GERENTE", "OPERADOR"]);
      const v = await dueno.query<{ clave: string; numero: number; autor: string }>(
        "select clave, numero, autor from version_de_plantilla order by clave, numero",
      );
      expect(v.rows).toEqual([
        { clave: "ADMINISTRADOR", numero: 1, autor: "migracion:0094" },
        { clave: "OPERADOR", numero: 1, autor: "migracion:0094" },
      ]);
    });

    it("los pisos son los del Anexo A: 19 solo-gerente (los que hoy tiene únicamente el gerente) y 4 de todos los roles", async () => {
      const { rows } = await dueno.query<{ accion: string; tipo: string }>(
        "select accion, tipo from piso_de_plataforma order by accion",
      );
      expect(rows.filter((r) => r.tipo === "SOLO_GERENTE").map((r) => r.accion)).toEqual(
        SOLO_GERENTE_ANEXO_A,
      );
      expect(rows.filter((r) => r.tipo === "TODOS_LOS_ROLES").map((r) => r.accion)).toEqual(
        TODOS_ANEXO_A,
      );
      expect(rows).toHaveLength(23);
      // El piso solo-gerente es exactamente «lo que hoy solo tiene el gerente»; los de todos están entre los que hoy tienen los tres.
      expect(SOLO_GERENTE_ANEXO_A).toEqual(
        TODAS.filter(
          (a) => (PERMISOS_DE_EMPRESA as Record<string, readonly string[]>)[a]?.length === 1,
        ),
      );
      for (const a of TODOS_ANEXO_A)
        expect((PERMISOS_DE_EMPRESA as Record<string, readonly string[]>)[a]).toHaveLength(3);
      expect([...PISOS_DE_TODOS_LOS_ROLES].sort()).toEqual(TODOS_ANEXO_A);
    });

    it("el piso jerárquico de las plantillas se cumple en la semilla (I16): lo del operador lo tiene el administrador, y lo de este, el gerente", async () => {
      const admin = new Set(await leerVigente("ADMINISTRADOR"));
      for (const a of await leerVigente("OPERADOR")) expect([a, admin.has(a)]).toEqual([a, true]);
      for (const a of admin) expect([a, TODAS.includes(a)]).toEqual([a, true]);
      // Ninguna plantilla tiene una acción solo-gerente.
      for (const a of SOLO_GERENTE_ANEXO_A) expect([a, admin.has(a)]).toEqual([a, false]);
    });

    it("las acciones introducidas son todas las del catálogo de hoy, ni una más ni una menos", async () => {
      const { rows } = await dueno.query<{ accion: string }>(
        "select accion from accion_introducida order by accion",
      );
      expect(rows.map((r) => r.accion)).toEqual(TODAS);
    });

    it("el bloque de la semilla del archivo de la migración es el que se genera hoy desde la constante (mientras la 0094 no esté sellada)", async () => {
      // Sellada = ya corrió en alguna base: su semilla queda congelada (la protege `test/arquitectura/migraciones-selladas.test.ts`) y una acción
      // nueva llega a las plantillas por la sincronización del ejecutor, no editando este archivo.
      const sellos = JSON.parse(await readFile(SELLOS, "utf8")) as Record<string, unknown>;
      const sellada = "0094_permisos_configurables.sql" in sellos;
      const sql = await readFile(MIGRACION, "utf8");
      expect(sellada || bloqueDelArchivo(sql) === bloqueDeLaSemilla()).toBe(true);
    });
  });

  describe("lo que impone la base aunque el código se olvide (I5)", () => {
    it("un rol propio no puede tener una acción solo-gerente: se rechaza", async () => {
      const rol = await crearRol(empresa, "Con piso solo gerente");
      for (const accion of SOLO_GERENTE_ANEXO_A) {
        const r = await intentar(empresa, SQL_VERSION, [
          empresa,
          rol,
          1,
          [...LISTA_VALIDA, accion],
          persona,
        ]);
        expect([accion, r]).toEqual([accion, "23514:version_de_rol_pisos"]);
      }
    });

    it("un rol propio tiene que tener las 4 acciones de todos los roles: sin una de ellas se rechaza; vacío también", async () => {
      const rol = await crearRol(empresa, "Sin piso de todos");
      for (const quitar of TODOS_ANEXO_A) {
        const r = await intentar(empresa, SQL_VERSION, [
          empresa,
          rol,
          1,
          LISTA_VALIDA.filter((a) => a !== quitar),
          persona,
        ]);
        expect([quitar, r]).toEqual([quitar, "23514:version_de_rol_pisos"]);
      }
      expect(await intentar(empresa, SQL_VERSION, [empresa, rol, 1, [], persona])).toBe(
        "23514:version_de_rol_pisos",
      );
    });

    it("una versión válida se guarda; las siguientes tienen que ser la 2, la 3…; saltear o repetir el número se rechaza", async () => {
      const rol = await crearRol(empresa, "Numeradas");
      expect(await intentar(empresa, SQL_VERSION, [empresa, rol, 2, LISTA_VALIDA, persona])).toBe(
        "23514:version_de_rol_numero_invalido",
      );
      expect(
        await intentar(empresa, SQL_VERSION, [empresa, rol, 1, LISTA_VALIDA, persona]),
      ).toBeNull();
      expect(await intentar(empresa, SQL_VERSION, [empresa, rol, 1, LISTA_VALIDA, persona])).toBe(
        "23514:version_de_rol_numero_invalido",
      );
      expect(await intentar(empresa, SQL_VERSION, [empresa, rol, 3, LISTA_VALIDA, persona])).toBe(
        "23514:version_de_rol_numero_invalido",
      );
      expect(
        await intentar(empresa, SQL_VERSION, [
          empresa,
          rol,
          2,
          [...LISTA_VALIDA, "cajas.ver"],
          persona,
        ]),
      ).toBeNull();
    });

    it("la lista de acciones pasa por la lista de permitidos: forma, repetidas, nulas y tope (el catálogo lo valida el servidor)", async () => {
      const rol = await crearRol(empresa, "Formas");
      const malas: unknown[][] = [
        [...LISTA_VALIDA, "Ventas.ver"],
        [...LISTA_VALIDA, "ventas"],
        [...LISTA_VALIDA, "ventas.ver.mas"],
        [...LISTA_VALIDA, "ventas.ver "],
        [...LISTA_VALIDA, "ventas.<b>"],
        [...LISTA_VALIDA, "1ventas.ver"],
        [...LISTA_VALIDA, `${"a".repeat(41)}.ver`],
        [...LISTA_VALIDA, LISTA_VALIDA[0]],
        [...LISTA_VALIDA, null],
        [...LISTA_VALIDA, ...Array.from({ length: 1001 }, (_, i) => `recurso_${String(i)}.accion`)],
      ];
      for (const lista of malas) {
        const r = await intentar(empresa, SQL_VERSION, [empresa, rol, 1, lista, persona]);
        expect([JSON.stringify(lista).slice(0, 60), r]).toEqual([
          JSON.stringify(lista).slice(0, 60),
          "23514:version_de_rol_acciones_ck",
        ]);
      }
      // Una acción con la forma correcta pero que no está en el catálogo SÍ se guarda: no otorga nada (S10) y el servidor es quien la valida.
      expect(
        await intentar(empresa, SQL_VERSION, [
          empresa,
          rol,
          1,
          [...LISTA_VALIDA, "cosa_nueva.hacer"],
          persona,
        ]),
      ).toBeNull();
    });

    it("si los pisos no se pueden leer, se rechaza (falla cerrado): sin contexto, o con un actor de plataforma que no existe", async () => {
      const sinContexto = await SesionDePrueba.abrir(base as BaseDePruebas, "pedernal_app", null);
      const ajeno = await SesionDePrueba.abrir(
        base as BaseDePruebas,
        "pedernal_plataforma",
        comoPlataforma({ tipo: "ADMIN", id: randomUUID() as never }),
      );
      try {
        for (const s of [sinContexto, ajeno]) {
          const r = await s.intentar("select incumplimiento_de_pisos($1::text[]) as m", [
            LISTA_VALIDA,
          ]);
          expect(r.ok && r.rows[0]).toEqual({ m: "no se pueden leer los pisos de la plataforma" });
        }
      } finally {
        await sinContexto.cerrar();
        await ajeno.cerrar();
      }
    });

    it("una versión nueva de plantilla respeta el número siguiente y los pisos; el gerente no tiene lista (dentro de una transacción que se deshace)", async () => {
      const sql =
        "insert into version_de_plantilla (clave, numero, acciones, autor) values ($1, $2, $3::text[], 'prueba')";
      const oper = [...tabla.OPERADOR];
      expect(await comoDuenoSinConfirmar(sql, ["OPERADOR", 2, oper])).toBeNull();
      expect(await comoDuenoSinConfirmar(sql, ["OPERADOR", 3, oper])).toBe(
        "23514:version_de_plantilla_numero_invalido",
      );
      expect(await comoDuenoSinConfirmar(sql, ["OPERADOR", 1, oper])).toBe(
        "23514:version_de_plantilla_numero_invalido",
      );
      expect(await comoDuenoSinConfirmar(sql, ["OPERADOR", 2, [...oper, "cajas.crear"]])).toBe(
        "23514:version_de_plantilla_pisos",
      );
      expect(
        await comoDuenoSinConfirmar(sql, [
          "OPERADOR",
          2,
          oper.filter((a) => a !== "permisos.ver_propios"),
        ]),
      ).toBe("23514:version_de_plantilla_pisos");
      expect(await comoDuenoSinConfirmar(sql, ["GERENTE", 1, oper])).toBe(
        "23514:version_de_plantilla_sin_gerente_ck",
      );
      expect(await comoDuenoSinConfirmar(sql, ["PROPIO", 1, oper])).toBe(
        "23514:version_de_plantilla_sin_gerente_ck",
      );
    });

    it("la plataforma publica una versión de plantilla solo como administrador con actor vigente y firmándola ella (la base la rechaza si no)", async () => {
      const sql =
        "insert into version_de_plantilla (clave, numero, acciones, autor) values ('OPERADOR', $3, $1::text[], $2)";
      const admin = comoPlataforma();
      const actor = (admin as { actor: { id: string } }).actor.id;
      const abrir = (c: ReturnType<typeof comoPlataforma>) =>
        SesionDePrueba.abrir(base as BaseDePruebas, "pedernal_plataforma", c);
      const s = await abrir(admin);
      try {
        const r = await s.intentar(sql, [[...tabla.OPERADOR], actor, 2]);
        expect(r.ok).toBe(true);
        const ajeno = await s.intentar(sql, [[...tabla.OPERADOR], "otro actor", 3]);
        expect(ajeno).toMatchObject({ ok: false, codigo: "42501" });
      } finally {
        await s.cerrar(); // nunca se confirma: la tabla es global
      }
      const sinActor = await abrir(comoPlataforma({ tipo: "ADMIN", id: randomUUID() as never }));
      try {
        // Sin actor vigente no ve ni las versiones ni los pisos: el disparador cierra (23514) antes de que llegue a la política de fila.
        const r = await sinActor.intentar(sql, [[...tabla.OPERADOR], "x", 2]);
        expect(r.ok).toBe(false);
      } finally {
        await sinActor.cerrar();
      }
    });

    it("un piso cambia de tipo (sube su versión y su autor) pero no de acción, y no se borra (dentro de una transacción que se deshace)", async () => {
      await dueno.query("begin");
      try {
        await dueno.query(
          "update piso_de_plataforma set tipo = 'TODOS_LOS_ROLES', autor = 'prueba' where accion = 'cajas.crear'",
        );
        const { rows } = await dueno.query<{ version: number; tipo: string }>(
          "select version, tipo from piso_de_plataforma where accion = 'cajas.crear'",
        );
        expect(rows[0]).toEqual({ version: 2, tipo: "TODOS_LOS_ROLES" });
        await dueno.query("savepoint s");
        await expect(
          dueno.query(
            "update piso_de_plataforma set accion = 'cajas.otra' where accion = 'cajas.crear'",
          ),
        ).rejects.toMatchObject({
          code: "23514",
          constraint: "piso_de_plataforma_inmutable",
        });
        await dueno.query("rollback to savepoint s");
        await expect(
          dueno.query("update piso_de_plataforma set tipo = 'LIBRE' where accion = 'cajas.crear'"),
        ).rejects.toMatchObject({
          code: "23514",
          constraint: "piso_de_plataforma_tipo_ck",
        });
      } finally {
        await dueno.query("rollback");
      }
    });
  });

  describe("el rol propio", () => {
    it("un nombre no se repite en la empresa (sin distinguir lo que normaliza `nombre_clave`) y otra empresa sí lo puede usar", async () => {
      await crearRol(empresa, "Encargado de salón");
      const repetido = await intentar(
        empresa,
        "insert into rol_de_empresa (empresa_id, nombre, nombre_clave) values ($1, 'Encargado de salón', 'encargado de salón')",
        [empresa],
      );
      expect(repetido).toBe("23505:rol_de_empresa_nombre_uk");
      expect(
        await intentar(
          otra,
          "insert into rol_de_empresa (empresa_id, nombre, nombre_clave) values ($1, 'Encargado de salón', 'encargado de salón')",
          [otra],
        ),
      ).toBeNull();
    });

    it("el nombre pasa por la lista de permitidos y el nombre normalizado por su largo", async () => {
      for (const nombre of ["", "Rol <b>", "x".repeat(81), "con\nsalto"]) {
        const r = await intentar(
          empresa,
          "insert into rol_de_empresa (empresa_id, nombre, nombre_clave) values ($1, $2, 'k')",
          [empresa, nombre],
        );
        expect([nombre, r]).toEqual([nombre, "23514:rol_de_empresa_nombre_ck"]);
      }
      expect(
        await intentar(
          empresa,
          "insert into rol_de_empresa (empresa_id, nombre, nombre_clave) values ($1, 'Ok', '')",
          [empresa],
        ),
      ).toBe("23514:rol_de_empresa_nombre_clave_ck");
    });

    it("nace de una plantilla o vacío; el origen tiene que ser una plantilla que existe", async () => {
      const id = randomUUID();
      expect(
        await intentar(
          empresa,
          "insert into rol_de_empresa (id, empresa_id, nombre, nombre_clave, plantilla_origen) values ($1, $2, 'Copia de operador', 'copia de operador', 'OPERADOR')",
          [id, empresa],
        ),
      ).toBeNull();
      expect(
        await intentar(
          empresa,
          "insert into rol_de_empresa (empresa_id, nombre, nombre_clave, plantilla_origen) values ($1, 'Copia rara', 'copia rara', 'DUENO')",
          [empresa],
        ),
      ).toBe("23503:rol_de_empresa_plantilla_origen_fkey");
    });

    it("cada cambio sube la versión; no cambia de empresa, de id ni de origen; archivar es un cambio de `activo` (no se borra)", async () => {
      const id = await crearRol(empresa, "Cambiante");
      const s = await comoApp(empresa);
      try {
        const r = await s.directo(
          "update rol_de_empresa set nombre = 'Cambiado', nombre_clave = 'cambiado' where id = $1 returning version",
          [id],
        );
        expect(r.ok && r.rows[0]).toEqual({ version: 2 });
        const a = await s.directo(
          "update rol_de_empresa set activo = false where id = $1 returning version, activo",
          [id],
        );
        expect(a.ok && a.rows[0]).toEqual({ version: 3, activo: false });
        await s.confirmar();
      } finally {
        await s.cerrar();
      }
      expect(
        await comoDuenoSinConfirmar("update rol_de_empresa set empresa_id = $2 where id = $1", [
          id,
          otra,
        ]),
      ).toBe("23514:rol_de_empresa_inmutable");
      expect(
        await comoDuenoSinConfirmar(
          "update rol_de_empresa set plantilla_origen = 'OPERADOR' where id = $1",
          [id],
        ),
      ).toBe("23514:rol_de_empresa_inmutable");
      expect(
        await comoDuenoSinConfirmar(
          "update rol_de_empresa set id = gen_random_uuid() where id = $1",
          [id],
        ),
      ).toBe("23514:rol_de_empresa_inmutable");
    });
  });

  describe("aislamiento entre empresas (I11)", () => {
    it("una empresa no ve ni cambia los roles ni las versiones de otra", async () => {
      const rol = await crearRol(empresa, "Solo de la primera");
      expect(
        await intentar(empresa, SQL_VERSION, [empresa, rol, 1, LISTA_VALIDA, persona]),
      ).toBeNull();
      const s = await comoApp(otra);
      try {
        const roles = await s.directo("select id from rol_de_empresa where id = $1", [rol]);
        expect(roles.ok && roles.filas).toBe(0);
        const versiones = await s.directo("select rol_id from version_de_rol where rol_id = $1", [
          rol,
        ]);
        expect(versiones.ok && versiones.filas).toBe(0);
        const cambio = await s.directo(
          "update rol_de_empresa set nombre = 'Robado', nombre_clave = 'robado' where id = $1",
          [rol],
        );
        expect(cambio.ok && cambio.filas).toBe(0);
      } finally {
        await s.cerrar();
      }
      const { rows } = await dueno.query<{ nombre: string }>(
        "select nombre from rol_de_empresa where id = $1",
        [rol],
      );
      expect(rows[0]?.nombre).toBe("Solo de la primera");
    });

    it("no se puede escribir en nombre de otra empresa ni colgar una versión de un rol ajeno", async () => {
      const ajeno = await crearRol(otra, "Rol ajeno");
      expect(
        await intentar(
          empresa,
          "insert into rol_de_empresa (empresa_id, nombre, nombre_clave) values ($1, 'Intruso', 'intruso')",
          [otra],
        ),
      ).toBe("42501:");
      expect(await intentar(empresa, SQL_VERSION, [otra, ajeno, 1, LISTA_VALIDA, persona])).toBe(
        "42501:",
      );
      // Con la empresa propia pero el rol de otra: la clave foránea compuesta lo rechaza.
      expect(await intentar(empresa, SQL_VERSION, [empresa, ajeno, 1, LISTA_VALIDA, persona])).toBe(
        "23503:version_de_rol_rol_fkey",
      );
    });

    it("sin contexto firmado la aplicación no ve ninguna fila (ni las globales)", async () => {
      await crearRol(empresa, "Para el barrido");
      const s = await SesionDePrueba.abrir(base as BaseDePruebas, "pedernal_app", null);
      try {
        for (const t of [
          "rol_de_empresa",
          "version_de_rol",
          "piso_de_plataforma",
          "version_de_plantilla",
          "plantilla_de_rol",
        ]) {
          const r = await s.directo(`select 1 from ${t}`);
          expect([t, r.ok && r.filas]).toEqual([t, 0]);
        }
      } finally {
        await s.cerrar();
      }
    });

    it("con contexto de empresa, la aplicación ve las plantillas y los pisos (son de la plataforma, iguales para todas)", async () => {
      const s = await comoApp(empresa);
      try {
        const p = await s.directo("select count(*)::int as n from piso_de_plataforma");
        expect(p.ok && p.rows[0]).toEqual({ n: 23 });
        const v = await s.directo("select count(*)::int as n from version_de_plantilla");
        expect(v.ok && v.rows[0]).toEqual({ n: 2 });
      } finally {
        await s.cerrar();
      }
    });
  });

  describe("escrituras simultáneas y repetidas (I9, I10)", () => {
    it("el mismo alta de un rol repetida a la vez no duplica: una gana y la otra recibe el choque de la clave", async () => {
      const id = randomUUID();
      const sa = await comoApp(empresa);
      const sb = await comoApp(empresa);
      const insertar = (s: SesionDePrueba) =>
        s.directo(
          "insert into rol_de_empresa (id, empresa_id, nombre, nombre_clave) values ($1, $2, 'Alta doble', 'alta doble')",
          [id, empresa],
        );
      try {
        expect((await insertar(sa)).ok).toBe(true);
        const pendiente = insertar(sb);
        expect(await esperarBloqueo(dueno, sb.pid)).toBe(true);
        await sa.confirmar();
        expect(await pendiente).toMatchObject({ ok: false, codigo: "23505" });
      } finally {
        await sa.cerrar();
        await sb.cerrar();
      }
      const { rows } = await dueno.query("select 1 from rol_de_empresa where id = $1", [id]);
      expect(rows).toHaveLength(1);
    });

    it("dos roles con el mismo nombre creados a la vez (ids distintos): solo entra uno", async () => {
      const sa = await comoApp(empresa);
      const sb = await comoApp(empresa);
      const insertar = (s: SesionDePrueba) =>
        s.directo(
          "insert into rol_de_empresa (id, empresa_id, nombre, nombre_clave) values ($1, $2, 'Gemelo', 'gemelo')",
          [randomUUID(), empresa],
        );
      try {
        expect((await insertar(sa)).ok).toBe(true);
        const pendiente = insertar(sb);
        expect(await esperarBloqueo(dueno, sb.pid)).toBe(true);
        await sa.confirmar();
        expect(await pendiente).toMatchObject({
          ok: false,
          codigo: "23505",
          restriccion: "rol_de_empresa_nombre_uk",
        });
      } finally {
        await sa.cerrar();
        await sb.cerrar();
      }
      const { rows } = await dueno.query(
        "select 1 from rol_de_empresa where empresa_id = $1 and nombre_clave = 'gemelo'",
        [empresa],
      );
      expect(rows).toHaveLength(1);
    });

    it("dos ediciones del mismo rol a la vez (la misma versión siguiente): una gana, la otra choca y relee; no queda ninguna perdida en silencio", async () => {
      const rol = await crearRol(empresa, "Edición doble");
      expect(
        await intentar(empresa, SQL_VERSION, [empresa, rol, 1, LISTA_VALIDA, persona]),
      ).toBeNull();
      const sa = await comoApp(empresa);
      const sb = await comoApp(empresa);
      try {
        expect(
          (
            await sa.directo(SQL_VERSION, [
              empresa,
              rol,
              2,
              [...LISTA_VALIDA, "cajas.ver"],
              persona,
            ])
          ).ok,
        ).toBe(true);
        const pendiente = sb.directo(SQL_VERSION, [
          empresa,
          rol,
          2,
          [...LISTA_VALIDA, "cajas.editar"],
          persona,
        ]);
        expect(await esperarBloqueo(dueno, sb.pid)).toBe(true);
        await sa.confirmar();
        expect(await pendiente).toMatchObject({ ok: false, codigo: "23505" });
      } finally {
        await sa.cerrar();
        await sb.cerrar();
      }
      const { rows } = await dueno.query<{ numero: number; acciones: string[] }>(
        "select numero, acciones from version_de_rol where rol_id = $1 order by numero",
        [rol],
      );
      expect(rows.map((r) => r.numero)).toEqual([1, 2]);
      expect(rows[1]?.acciones).toContain("cajas.ver");
      expect(rows[1]?.acciones).not.toContain("cajas.editar");
    });

    it("el control optimista alcanza: la segunda actualización con la versión que leyó ya no encuentra la fila y no pisa a la primera", async () => {
      const rol = await crearRol(empresa, "Optimista");
      const sa = await comoApp(empresa);
      const sb = await comoApp(empresa);
      const cambiar = (s: SesionDePrueba, nombre: string) =>
        s.directo(
          "update rol_de_empresa set nombre = $2, nombre_clave = lower($2) where id = $1 and version = 1",
          [rol, nombre],
        );
      try {
        const a = await cambiar(sa, "Primero");
        expect(a.ok && a.filas).toBe(1);
        const pendiente = cambiar(sb, "Segundo");
        expect(await esperarBloqueo(dueno, sb.pid)).toBe(true);
        await sa.confirmar();
        const b = await pendiente;
        expect(b.ok && b.filas).toBe(0);
      } finally {
        await sa.cerrar();
        await sb.cerrar();
      }
      const { rows } = await dueno.query<{ nombre: string; version: number }>(
        "select nombre, version from rol_de_empresa where id = $1",
        [rol],
      );
      expect(rows[0]).toEqual({ nombre: "Primero", version: 2 });
    });

    it("repetir la misma versión no duplica: el segundo intento se rechaza y queda una sola fila", async () => {
      const rol = await crearRol(empresa, "Repetida");
      expect(
        await intentar(empresa, SQL_VERSION, [empresa, rol, 1, LISTA_VALIDA, persona]),
      ).toBeNull();
      expect(
        await intentar(empresa, SQL_VERSION, [empresa, rol, 1, LISTA_VALIDA, persona]),
      ).not.toBeNull();
      const { rows } = await dueno.query("select 1 from version_de_rol where rol_id = $1", [rol]);
      expect(rows).toHaveLength(1);
    });
  });

  describe("la migración y su reversión", () => {
    it("la migración no cambia lo que existía: la membresía y las invitaciones siguen con sus tres roles", async () => {
      const { rows } = await dueno.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname in ('membresia_rol_ck', 'invitacion_empresa_rol_ck') order by conname",
      );
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r.def).not.toContain("PROPIO");
      const c = await dueno.query(
        "select 1 from information_schema.columns where table_name in ('membresia', 'invitacion_empresa') and column_name = 'rol_propio_id'",
      );
      expect(c.rowCount).toBe(0);
    });

    it("la reversión frena con roles propios, o con una plantilla o un piso cambiados; con la semilla intacta borra todo; repetirla no cambia nada; volver a migrar la deja como estaba", async () => {
      const aparte = await crearBaseAparte(base as BaseDePruebas);
      const c = new pg.Client({ connectionString: aparte.base.dueno });
      await c.connect();
      try {
        const sql = await readFile(REVERSION, "utf8");
        const correr = async () => {
          await c.query("begin");
          try {
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
        // Con un rol propio (y su versión) frena y no toca nada.
        const rol = randomUUID();
        await c.query(
          "insert into rol_de_empresa (id, empresa_id, nombre, nombre_clave) values ($1, $2, 'Propio', 'propio')",
          [rol, e2.empresa],
        );
        await c.query(
          "insert into version_de_rol (empresa_id, rol_id, numero, acciones, creado_por, creado_en) values ($1, $2, 1, $3::text[], $4, now())",
          [e2.empresa, rol, LISTA_VALIDA, p2],
        );
        await expect(correr()).rejects.toMatchObject({ code: "55000" });
        expect((await c.query("select 1 from version_de_rol")).rowCount).toBe(1);
        expect((await c.query("select 1 from piso_de_plataforma")).rowCount).toBe(23);
        // Sin roles pero con una versión de plantilla de la plataforma: frena.
        await c.query("alter table rol_de_empresa disable trigger rol_de_empresa_sin_borrado");
        await c.query("alter table version_de_rol disable trigger version_de_rol_solo_insercion");
        await c.query("delete from version_de_rol");
        await c.query("delete from rol_de_empresa");
        await c.query("alter table rol_de_empresa enable trigger rol_de_empresa_sin_borrado");
        await c.query("alter table version_de_rol enable trigger version_de_rol_solo_insercion");
        await c.query(
          "insert into version_de_plantilla (clave, numero, acciones, autor) values ('OPERADOR', 2, $1::text[], 'alguien')",
          [[...tabla.OPERADOR]],
        );
        await expect(correr()).rejects.toMatchObject({ code: "55000" });
        await c.query(
          "alter table version_de_plantilla disable trigger version_de_plantilla_solo_insercion",
        );
        await c.query("delete from version_de_plantilla where numero = 2");
        await c.query(
          "alter table version_de_plantilla enable trigger version_de_plantilla_solo_insercion",
        );
        // Con un piso cambiado: frena.
        await c.query(
          "update piso_de_plataforma set tipo = 'TODOS_LOS_ROLES', autor = 'alguien' where accion = 'cajas.crear'",
        );
        await expect(correr()).rejects.toMatchObject({ code: "55000" });
        await c.query(
          "update piso_de_plataforma set tipo = 'SOLO_GERENTE', autor = 'migracion:0094' where accion = 'cajas.crear'",
        );
        // Todavía frena: la versión del piso ya no es 1 (queda el rastro de que se cambió).
        await expect(correr()).rejects.toMatchObject({ code: "55000" });
        await c.query("alter table piso_de_plataforma disable trigger piso_de_plataforma_version");
        await c.query("update piso_de_plataforma set version = 1 where accion = 'cajas.crear'");
        await c.query("alter table piso_de_plataforma enable trigger piso_de_plataforma_version");
        // Con la semilla intacta: borra todo, y repetirla no cambia nada.
        await correr();
        const { rows } = await c.query<{ t: string | null }>(
          `select to_regclass('public.' || x)::text as t from unnest($1::text[]) x`,
          [TABLAS],
        );
        expect(rows.every((r) => r.t === null)).toBe(true);
        const f = await c.query<{ f: string | null }>(
          `select to_regprocedure(x)::text as f from unnest(array['clave_de_accion_valida(text)','claves_de_accion_validas(text[])','incumplimiento_de_pisos(text[])','version_de_rol_validar()','version_de_plantilla_validar()','rol_de_empresa_validar_cambio()','piso_de_plataforma_validar_cambio()']) x`,
        );
        expect(f.rows.every((r) => r.f === null)).toBe(true);
        await correr();
        expect(
          (
            await c.query(
              "select 1 from migracion where nombre = '0094_permisos_configurables.sql'",
            )
          ).rowCount,
        ).toBe(0);
        // Volver a aplicar la migración la deja como estaba (el ejecutor la corre otra vez y la semilla vuelve idéntica).
        await c.query("begin");
        await c.query(await readFile(MIGRACION, "utf8"));
        await c.query("commit");
        expect((await c.query("select 1 from piso_de_plataforma")).rowCount).toBe(23);
        expect((await c.query("select 1 from accion_introducida")).rowCount).toBe(TODAS.length);
      } finally {
        await c.end();
        await aparte.destruir();
      }
    });
  });
});
