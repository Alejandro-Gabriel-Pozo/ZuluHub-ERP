import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { MOTIVOS_DE_MOVIMIENTO } from "../../src/modulos/stock/dominio/motivos";
import { CLASES_DE_MOVIMIENTO } from "../../src/modulos/stock/dominio/movimiento";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { fechaDeNegocio } from "../../src/primitivas/tiempo/fecha-de-negocio";
import { productoDeBase } from "./catalogo-apoyo";
import { comoEmpresa } from "./entorno";
import {
  acepta,
  check,
  clave,
  conAppDe,
  crearMundo,
  denegado,
  intentoDelDueno,
  referencia,
  sinConfirmar,
  type Mundo,
} from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import {
  baseConMigraciones,
  carpetaCon,
  CARPETA_DE_MIGRACIONES,
  huellaDeCatalogo,
} from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";
import { SesionDePrueba, esperarBloqueo, type Intento } from "./sesiones";
import {
  articuloDeBase,
  claveNueva,
  depositoDeBase,
  entrada,
  escribirMovimiento,
  espejoDe,
  existenciaDe,
  nivelDeBase,
  salida,
  sucursalDeBase,
  transferencia,
  type Ejecutor,
  type MovimientoDePrueba,
} from "./stock-apoyo";

/**
 * La migración 0030 (E5 stock) contra una base real, con el rol de la aplicación y el dueño: RLS forzada y una política por comando en cada
 * tabla nueva, nada se borra ni se vacía, los únicos de origen e idempotencia (una salida por ejemplar, una entrada por recepción, una
 * anulación por movimiento, un ajuste por conteo), el saldo que solo escribe el libro y que siempre es la suma de los renglones, la solo
 * inserción, la fecha de negocio (con la misma fórmula que `fechaDeNegocio`), la salida por venta con la fecha del ticket, cuarentena y
 * rechazo, el depósito de venta único, la transferencia que suma cero, la anulación espejo, el control de existencia negativa
 * (PERMITIR, AVISAR y BLOQUEAR por `nivel_de_control`), el conteo, las composiciones, el aislamiento entre empresas, la concurrencia sobre
 * el saldo y la reversión.
 *
 * Los datos se arman con SQL del dueño (depósitos, artículos, niveles) y con el rol real de la aplicación (el libro). Cada prueba usa su
 * propia empresa: no comparten filas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const TABLAS = [
  "deposito",
  "articulo_de_stock",
  "motivo_de_movimiento",
  "movimiento_de_stock",
  "renglon_de_movimiento",
  "saldo_de_stock",
  "conteo_fisico",
  "conteo_registro",
  "composicion",
  "componente_de_composicion",
] as const;
/** Las políticas que cada tabla tiene que tener: un comando cada una, y solo los que la aplicación puede ejecutar. */
const COMANDOS_POR_TABLA: Readonly<Record<(typeof TABLAS)[number], readonly string[]>> = {
  deposito: ["SELECT", "INSERT", "UPDATE"],
  articulo_de_stock: ["SELECT", "INSERT", "UPDATE"],
  motivo_de_movimiento: ["SELECT"],
  movimiento_de_stock: ["SELECT", "INSERT"],
  renglon_de_movimiento: ["SELECT", "INSERT"],
  saldo_de_stock: ["SELECT", "INSERT", "UPDATE"],
  conteo_fisico: ["SELECT", "INSERT", "UPDATE"],
  conteo_registro: ["SELECT", "INSERT"],
  composicion: ["SELECT", "INSERT"],
  componente_de_composicion: ["SELECT", "INSERT"],
};
/** De solo inserción: ni el dueño las modifica ni las borra. */
const SOLO_INSERCION = [
  "motivo_de_movimiento",
  "movimiento_de_stock",
  "renglon_de_movimiento",
  "conteo_registro",
  "composicion",
  "componente_de_composicion",
] as const;
const FUNCIONES = [
  "deposito_validar",
  "articulo_de_stock_validar",
  "composicion_validar",
  "componente_de_composicion_validar",
  "conteo_fisico_validar",
  "conteo_registro_preparar",
  "movimiento_de_stock_preparar",
  "renglon_de_movimiento_validar",
  "renglon_de_movimiento_aplicar",
  "saldo_de_stock_solo_por_movimientos",
  "movimiento_de_stock_coherente",
] as const;

const ARCHIVO = "0030_stock.sql";
const textoDeLaMigracion = () => readFile(join(CARPETA_DE_MIGRACIONES, ARCHIVO), "utf8");
const textoDeLaReversion = () =>
  readFile(join(CARPETA_DE_MIGRACIONES, "reversiones", "0030_revertir_stock.sql"), "utf8");
const migracionesPrevias = async () =>
  (await readdir(CARPETA_DE_MIGRACIONES))
    .filter((n) => /^\d{4}_.*\.sql$/.test(n) && n < ARCHIVO)
    .sort();
const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

type Escenario = Readonly<{
  m: Mundo;
  /** Dos depósitos normales de la sucursal (el primero es el de venta) y un artículo. */
  d1: string;
  d2: string;
  articulo: string;
  producto: string;
}>;

describe.skipIf(base === null)("0030 stock: la migración contra una base real", () => {
  let dueno: pg.Client;

  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: b().dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
  });

  // ---- armado --------------------------------------------------------------------------------------------------------------

  const escenario = async (): Promise<Escenario> => {
    const m = await crearMundo(dueno);
    const d1 = await depositoDeBase(dueno, m, { deVenta: true });
    const d2 = await depositoDeBase(dueno, m);
    const a = await articuloDeBase(dueno, m);
    return { m, d1, d2, articulo: a.articulo, producto: a.producto };
  };
  const enApp = <T>(
    m: Pick<Mundo, "empresa" | "persona">,
    trabajo: (s: SesionDePrueba, e: Ejecutor) => Promise<T>,
  ): Promise<T> => conAppDe(b(), m, (s) => trabajo(s, (t, p) => s.intentar(t, p)));
  /** Escribe un movimiento con el rol de la aplicación y lo confirma (todo tiene que pasar). Devuelve su id. */
  const cargar = (m: Mundo, mov: MovimientoDePrueba): Promise<string> =>
    enApp(m, async (s, e) => {
      const r = await escribirMovimiento(e, m.empresa, mov);
      acepta(r.resultado);
      acepta(await s.confirmar());
      return r.id;
    });
  /** Escribe un movimiento SIN confirmar y devuelve la sentencia que la base rechazó (o la última si pasaron todas). */
  const intentar = (m: Mundo, mov: MovimientoDePrueba): Promise<Intento> =>
    enApp(m, async (_s, e) => (await escribirMovimiento(e, m.empresa, mov)).resultado);
  /** Escribe un movimiento y trata de confirmarlo: devuelve el resultado de la confirmación (el cuadre diferido) o el rechazo anterior. */
  const confirmando = (m: Mundo, mov: MovimientoDePrueba): Promise<Intento> =>
    enApp(m, async (s, e) => {
      const r = await escribirMovimiento(e, m.empresa, mov);
      return r.resultado.ok ? await s.confirmar() : r.resultado;
    });
  const un = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
    (await dueno.query<T>(texto, p)).rows[0] ?? ({} as T);
  const existencia = (e: Escenario, deposito: string = e.d1) =>
    existenciaDe(dueno, deposito, e.articulo);
  const noSeVacia = (r: Intento): void => {
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["42501", "0A000"]).toContain(r.codigo);
  };

  // ---- el esquema ----------------------------------------------------------------------------------------------------------

  describe("el esquema", () => {
    it("crea las diez tablas con RLS forzada, una política por comando que la aplicación puede ejecutar, ninguna FOR ALL y sin DELETE ni TRUNCATE para nadie", async () => {
      const tablas = (
        await dueno.query<{
          relname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
        }>(
          `select relname, relrowsecurity, relforcerowsecurity from pg_class
            where relnamespace = 'public'::regnamespace and relkind = 'r' and relname = any($1)`,
          [[...TABLAS]],
        )
      ).rows;
      expect(tablas.map((t) => t.relname).sort()).toEqual([...TABLAS].sort());
      for (const t of tablas) {
        expect(t.relrowsecurity, t.relname).toBe(true);
        expect(t.relforcerowsecurity, t.relname).toBe(true);
      }
      const politicas = (
        await dueno.query<{ tablename: string; cmd: string; roles: string[] }>(
          `select tablename, cmd, roles::text[] as roles from pg_policies where schemaname = 'public' and tablename = any($1)`,
          [[...TABLAS]],
        )
      ).rows;
      for (const tabla of TABLAS) {
        const delaTabla = politicas.filter((p) => p.tablename === tabla);
        expect(delaTabla.map((p) => p.cmd).sort(), tabla).toEqual(
          [...COMANDOS_POR_TABLA[tabla]].sort(),
        );
        for (const p of delaTabla) expect(p.roles, `${tabla} ${p.cmd}`).toEqual(["pedernal_app"]);
      }
      // Cada política existe porque la aplicación puede ejecutar ese comando (y al revés): sin privilegio huérfano ni política de más.
      for (const tabla of TABLAS) {
        const { rows } = await dueno.query<{
          sel: boolean;
          ins: boolean;
          upd: boolean;
          del: boolean;
          tru: boolean;
        }>(
          `select has_any_column_privilege('pedernal_app', $1, 'SELECT') as sel,
                  has_any_column_privilege('pedernal_app', $1, 'INSERT') as ins,
                  has_any_column_privilege('pedernal_app', $1, 'UPDATE') as upd,
                  has_table_privilege('pedernal_app', $1, 'DELETE') as del,
                  has_table_privilege('pedernal_app', $1, 'TRUNCATE') as tru`,
          [`public.${tabla}`],
        );
        const f = rows[0];
        const comandos = COMANDOS_POR_TABLA[tabla];
        expect(f?.sel, `${tabla} SELECT`).toBe(comandos.includes("SELECT"));
        expect(f?.ins, `${tabla} INSERT`).toBe(comandos.includes("INSERT"));
        expect(f?.upd, `${tabla} UPDATE`).toBe(comandos.includes("UPDATE"));
        expect(f?.del, `${tabla} DELETE`).toBe(false);
        expect(f?.tru, `${tabla} TRUNCATE`).toBe(false);
      }
      const privilegios = (
        await dueno.query<{ grantee: string; table_name: string; privilege_type: string }>(
          `select grantee, table_name, privilege_type from information_schema.role_table_grants
            where table_schema = 'public' and table_name = any($1)
              and grantee <> (select rolname from pg_roles where oid = (select relowner from pg_class where oid = 'public.producto'::regclass))`,
          [[...TABLAS]],
        )
      ).rows;
      expect(
        privilegios.filter((p) =>
          ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"].includes(p.privilege_type),
        ),
      ).toEqual([]);
      // Solo la aplicación recibe algo; el rol de respaldo (0012) lee todo por sus privilegios por defecto, y solo leer.
      for (const p of privilegios) {
        expect(["pedernal_app", "pedernal_respaldo"], `${p.table_name} ${p.grantee}`).toContain(
          p.grantee,
        );
      }
      expect([
        ...new Set(
          privilegios.filter((p) => p.grantee === "pedernal_respaldo").map((p) => p.privilege_type),
        ),
      ]).toEqual(["SELECT"]);
    });

    it("la base fija lo que la aplicación no manda: no hay privilegio de escritura sobre las columnas que llenan los disparadores", async () => {
      const sinPrivilegio: Array<[string, string, "INSERT" | "UPDATE"]> = [
        ["movimiento_de_stock", "registrado_en", "INSERT"],
        ["movimiento_de_stock", "detalle", "UPDATE"],
        ["renglon_de_movimiento", "hecho_en", "INSERT"],
        ["renglon_de_movimiento", "fecha_negocio", "INSERT"],
        ["renglon_de_movimiento", "cantidad", "UPDATE"],
        ["conteo_registro", "existencia_al_registrar", "INSERT"],
        ["conteo_registro", "orden", "INSERT"],
        ["composicion", "registrada_en", "INSERT"],
        ["componente_de_composicion", "compuesto_id", "INSERT"],
        ["deposito", "uso", "UPDATE"],
        ["deposito", "sucursal_id", "UPDATE"],
        ["deposito", "activo", "INSERT"],
        ["articulo_de_stock", "producto_id", "UPDATE"],
        ["conteo_fisico", "deposito_id", "UPDATE"],
      ];
      for (const [tabla, columna, privilegio] of sinPrivilegio) {
        const { rows } = await dueno.query<{ ok: boolean }>(
          "select has_column_privilege('pedernal_app', $1, $2, $3) as ok",
          [`public.${tabla}`, columna, privilegio],
        );
        expect(rows[0]?.ok, `${tabla}.${columna} ${privilegio}`).toBe(false);
      }
    });

    it("toda función nueva fija su search_path, ninguna es SECURITY DEFINER y ninguna se otorga a la aplicación ni a PUBLIC", async () => {
      const funciones = (
        await dueno.query<{
          proname: string;
          prosecdef: boolean;
          proconfig: string[] | null;
          proacl: string | null;
        }>(
          `select proname, prosecdef, proconfig, proacl::text from pg_proc
            where pronamespace = 'public'::regnamespace and proname = any($1)`,
          [[...FUNCIONES]],
        )
      ).rows;
      expect(funciones.map((f) => f.proname).sort()).toEqual([...FUNCIONES].sort());
      for (const f of funciones) {
        expect(f.prosecdef, f.proname).toBe(false);
        expect(f.proconfig?.join(","), f.proname).toContain(
          "search_path=pg_catalog, public, pg_temp",
        );
        expect(f.proacl ?? "", f.proname).not.toContain("pedernal_app=");
        expect(f.proacl ?? "", f.proname).not.toMatch(/(^\{|,)=X/);
      }
    });

    it("suma a `producto` solo dos únicas (las claves foráneas del artículo y de los componentes) y las dos son aditivas", async () => {
      const { rows } = await dueno.query<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where conrelid = 'public.producto'::regclass and conname in ('producto_id_unidad_base_empresa_uk', 'producto_id_dimension_empresa_uk')
          order by conname`,
      );
      expect(rows).toEqual([
        {
          conname: "producto_id_dimension_empresa_uk",
          def: "UNIQUE (id, dimension, empresa_id)",
        },
        {
          conname: "producto_id_unidad_base_empresa_uk",
          def: "UNIQUE (id, unidad_base_id, empresa_id)",
        },
      ]);
    });

    it("los motivos sembrados son los de `MOTIVOS_DE_MOVIMIENTO` del dominio (clase, código y las dos banderas) y las clases son las del dominio", async () => {
      const { rows } = await dueno.query<{
        clase: string;
        codigo: string;
        entra_con_costo: boolean;
        entrega_mercaderia: boolean;
      }>("select clase, codigo, entra_con_costo, entrega_mercaderia from motivo_de_movimiento");
      const enBase = rows
        .map((r) => ({
          clase: r.clase,
          codigo: r.codigo,
          entraConCosto: r.entra_con_costo,
          entregaMercaderia: r.entrega_mercaderia,
        }))
        .sort((x, y) => `${x.clase}/${x.codigo}`.localeCompare(`${y.clase}/${y.codigo}`));
      const delDominio = MOTIVOS_DE_MOVIMIENTO.map((x) => ({ ...x })).sort((x, y) =>
        `${x.clase}/${x.codigo}`.localeCompare(`${y.clase}/${y.codigo}`),
      );
      expect(enBase).toEqual(delDominio);
      const { rows: restriccion } = await dueno.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'motivo_clase_ck'`,
      );
      for (const clase of CLASES_DE_MOVIMIENTO) {
        expect(restriccion[0]?.def, clase).toContain(`'${clase}'`);
      }
      expect((restriccion[0]?.def.match(/'[A-Z_]+'/g) ?? []).length).toBe(
        CLASES_DE_MOVIMIENTO.length,
      );
    });

    it("el código de la migración no usa SECURITY DEFINER, DELETE, TRUNCATE ni listas de prohibidos, y el motivo de cada restricción es legible", async () => {
      const codigo = (await textoDeLaMigracion()).replace(/--.*$/gm, "");
      expect(codigo).not.toMatch(/SECURITY DEFINER/i);
      expect(codigo).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE\s+TABLE|CASCADE)\b/i);
      expect(codigo).not.toMatch(/GRANT\s+(DELETE|TRUNCATE|ALL)\b/i);
      expect(codigo).not.toMatch(/!~/);
      // Toda restricción con nombre estable: la capa de persistencia las traduce a errores de negocio.
      const { rows } = await dueno.query<{ conname: string }>(
        `select conname from pg_constraint where conrelid = any($1::regclass[]) and contype in ('c', 'u', 'f', 'p')
            and conname !~ '^[a-z][a-z0-9_]+_(ck|uk|fkey|pkey)$'`,
        [TABLAS.map((t) => `public.${t}`)],
      );
      expect(rows).toEqual([]);
    });
  });

  // ---- el aislamiento entre empresas ---------------------------------------------------------------------------------------

  describe("aislamiento entre empresas", () => {
    it("la empresa B no ve ni toca depósitos, artículos, movimientos, saldos ni conteos de la A; la misma clave en dos empresas son dos movimientos", async () => {
      const a = await escenario();
      const bb = await escenario();
      const clavePropia = claveNueva();
      await cargar(a.m, entrada(a.m, a.d1, a.articulo, "5", { clave: clavePropia }));
      const conteoA = randomUUID();
      await dueno.query(
        `insert into conteo_fisico (id, empresa_id, deposito_id, abierto_por, abierto_en) values ($1, $2, $3, $4, now())`,
        [conteoA, a.m.empresa, a.d2, a.m.persona],
      );
      // La misma clave en la otra empresa: otro movimiento, sin choque.
      await cargar(bb.m, entrada(bb.m, bb.d1, bb.articulo, "7", { clave: clavePropia }));
      await enApp(bb.m, async (s) => {
        for (const tabla of [
          "deposito",
          "articulo_de_stock",
          "movimiento_de_stock",
          "renglon_de_movimiento",
          "saldo_de_stock",
          "conteo_fisico",
        ]) {
          const r = await s.intentar(
            `select count(*)::int as n from ${tabla} where empresa_id = $1`,
            [a.m.empresa],
          );
          expect(r.ok && r.rows[0], tabla).toEqual({ n: 0 });
        }
        // Escribir en la empresa A con el contexto de B: la política lo rechaza (y el disparador del libro, que lee el depósito con la RLS de
        // B, no lo encuentra: falla cerrado con la misma restricción que la clave foránea).
        denegado(
          await s.intentar(
            `insert into deposito (id, empresa_id, sucursal_id, nombre, nombre_clave, uso) values ($1, $2, $3, 'Intruso', 'intruso', 'NORMAL')`,
            [randomUUID(), a.m.empresa, a.m.sucursal],
          ),
        );
        referencia(
          await s.intentar(
            `insert into movimiento_de_stock (id, empresa_id, clase, motivo, deposito_id, accion, clave_idempotencia, huella, hecho_en, registrado_por)
             values ($1, $2, 'ENTRADA', 'COMPRA', $3, 'stock.registrar_entrada', $4, $5, now(), $6)`,
            [randomUUID(), a.m.empresa, a.d1, claveNueva(), "a".repeat(64), bb.m.persona],
          ),
          "movimiento_de_stock_deposito_fkey",
        );
        // Un depósito de la A con empresa B: ni la clave foránea compuesta lo admite.
        referencia(
          await s.intentar(
            `insert into movimiento_de_stock (id, empresa_id, clase, motivo, deposito_id, accion, clave_idempotencia, huella, hecho_en, registrado_por)
             values ($1, $2, 'ENTRADA', 'COMPRA', $3, 'stock.registrar_entrada', $4, $5, now(), $6)`,
            [randomUUID(), bb.m.empresa, a.d1, claveNueva(), "a".repeat(64), bb.m.persona],
          ),
          "movimiento_de_stock_deposito_fkey",
        );
        const modificado = await s.intentar(
          "update deposito set nombre = 'Otro', nombre_clave = 'otro' where id = $1",
          [a.d1],
        );
        expect(modificado.ok && modificado.filas).toBe(0);
      });
      expect(await existenciaDe(dueno, a.d1, a.articulo)).toBe("5.0000");
      expect(await existenciaDe(dueno, bb.d1, bb.articulo)).toBe("7.0000");
    });

    it("un renglón, un artículo o un conteo de otra empresa no se acepta ni con SQL directo del dueño (claves foráneas compuestas)", async () => {
      const a = await escenario();
      const bb = await escenario();
      await sinConfirmar(dueno, async () => {
        const cab = randomUUID();
        acepta(
          await intentoDelDueno(
            dueno,
            `insert into movimiento_de_stock (id, empresa_id, clase, motivo, deposito_id, accion, clave_idempotencia, huella, hecho_en, registrado_por)
             values ($1, $2, 'ENTRADA', 'COMPRA', $3, 'stock.registrar_entrada', $4, $5, now(), $6)`,
            [cab, a.m.empresa, a.d1, claveNueva(), "a".repeat(64), a.m.persona],
          ),
        );
        // Artículo de la empresa B en un renglón de la A.
        referencia(
          await intentoDelDueno(
            dueno,
            `insert into renglon_de_movimiento (empresa_id, movimiento_id, numero, deposito_id, articulo_id, cantidad) values ($1, $2, 1, $3, $4, 1)`,
            [a.m.empresa, cab, a.d1, bb.articulo],
          ),
          "renglon_de_movimiento_articulo_fkey",
        );
        // Depósito de la empresa B en el conteo de la A.
        referencia(
          await intentoDelDueno(
            dueno,
            `insert into conteo_fisico (id, empresa_id, deposito_id, abierto_por, abierto_en) values ($1, $2, $3, $4, now())`,
            [randomUUID(), a.m.empresa, bb.d1, a.m.persona],
          ),
          "conteo_fisico_deposito_fkey",
        );
        // Producto de la empresa B para un artículo de la A.
        referencia(
          await intentoDelDueno(
            dueno,
            `insert into articulo_de_stock (id, empresa_id, producto_id, unidad_de_stock_id, dimension) values ($1, $2, $3, 'UNIDAD', 'CONTEO')`,
            [randomUUID(), a.m.empresa, bb.producto],
          ),
          "articulo_de_stock_producto_unidad_fkey",
        );
      });
    });
  });

  // ---- los únicos: identidad por origen e idempotencia ---------------------------------------------------------------------

  describe("únicos de origen e idempotencia", () => {
    it("la misma clave de idempotencia en la misma empresa choca (`movimiento_de_stock_clave_uk`)", async () => {
      const e = await escenario();
      const k = claveNueva();
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "1", { clave: k }));
      clave(
        await intentar(e.m, entrada(e.m, e.d1, e.articulo, "1", { clave: k })),
        "movimiento_de_stock_clave_uk",
      );
      expect(await existencia(e)).toBe("1.0000");
    });

    it("una salida por ejemplar aunque cambie la clave, y una entrada por recepción (`movimiento_de_stock_origen_uk`)", async () => {
      const e = await escenario();
      const ejemplar = randomUUID();
      const porVenta = (extra: Partial<MovimientoDePrueba> = {}): MovimientoDePrueba =>
        salida(e.m, e.d1, e.articulo, "1", {
          motivo: "VENTA",
          origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar },
          fechaDeNegocio: "2026-11-09",
          accion: "ventas.cerrar_cuenta",
          ...extra,
        });
      await cargar(e.m, porVenta());
      clave(await intentar(e.m, porVenta()), "movimiento_de_stock_origen_uk");
      // Otro ejemplar sí entra.
      await cargar(e.m, porVenta({ origen: { tipo: "EJEMPLAR_DE_TICKET", id: randomUUID() } }));
      expect(await existencia(e)).toBe("-2.0000");

      const recepcion = randomUUID();
      const deRecepcion = (extra: Partial<MovimientoDePrueba> = {}): MovimientoDePrueba =>
        entrada(e.m, e.d1, e.articulo, "4", {
          origen: { tipo: "RECEPCION", id: recepcion },
          accion: "compras.recibir",
          ...extra,
        });
      await cargar(e.m, deRecepcion());
      clave(await intentar(e.m, deRecepcion()), "movimiento_de_stock_origen_uk");
      // Lo manual no tiene origen: dos entradas manuales iguales (con claves distintas) son válidas.
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "1"));
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "1"));
      expect(await existencia(e)).toBe("4.0000");
    });

    it("`VENTA` es la salida con el ejemplar del ticket como origen y solo ella; lo manual no lleva identificador de origen", async () => {
      const e = await escenario();
      // Motivo VENTA sin origen de ticket.
      check(
        await intentar(
          e.m,
          salida(e.m, e.d1, e.articulo, "1", { motivo: "VENTA", fechaDeNegocio: "2026-11-09" }),
        ),
        "movimiento_de_stock_venta_ck",
      );
      // Origen de ticket con otro motivo.
      check(
        await intentar(
          e.m,
          salida(e.m, e.d1, e.articulo, "1", {
            motivo: "MERMA",
            origen: { tipo: "EJEMPLAR_DE_TICKET", id: randomUUID() },
          }),
        ),
        "movimiento_de_stock_venta_ck",
      );
      // Una entrada con motivo VENTA: la regla de la venta la rechaza (y la clave foránea del motivo también, porque `VENTA` es de la salida).
      check(
        await intentar(e.m, entrada(e.m, e.d1, e.articulo, "1", { motivo: "VENTA" })),
        "movimiento_de_stock_venta_ck",
      );
      referencia(
        await intentar(e.m, entrada(e.m, e.d1, e.articulo, "1", { motivo: "MERMA" })),
        "movimiento_de_stock_motivo_fkey",
      );
      // Origen manual con identificador y origen de otro módulo sin identificador.
      await enApp(e.m, async (s) => {
        check(
          await s.intentar(
            `insert into movimiento_de_stock (id, empresa_id, clase, motivo, deposito_id, accion, clave_idempotencia, huella, hecho_en, registrado_por, origen_tipo, origen_id)
             values ($1, $2, 'ENTRADA', 'COMPRA', $3, 'stock.registrar_entrada', $4, $5, now(), $6, 'MANUAL', $7)`,
            [
              randomUUID(),
              e.m.empresa,
              e.d1,
              claveNueva(),
              "a".repeat(64),
              e.m.persona,
              randomUUID(),
            ],
          ),
          "movimiento_de_stock_origen_ck",
        );
        check(
          await s.intentar(
            `insert into movimiento_de_stock (id, empresa_id, clase, motivo, deposito_id, accion, clave_idempotencia, huella, hecho_en, registrado_por, origen_tipo)
             values ($1, $2, 'ENTRADA', 'COMPRA', $3, 'stock.registrar_entrada', $4, $5, now(), $6, 'RECEPCION')`,
            [randomUUID(), e.m.empresa, e.d1, claveNueva(), "a".repeat(64), e.m.persona],
          ),
          "movimiento_de_stock_origen_ck",
        );
      });
    });

    it("una anulación por movimiento, y una anulación (o un ajuste por conteo) no se anula", async () => {
      const e = await escenario();
      const original = entrada(e.m, e.d1, e.articulo, "5", { id: randomUUID() });
      const id = await cargar(e.m, original);
      const espejo = espejoDe(e.m, { ...original, id });
      const anulacion = await cargar(e.m, espejo);
      expect(await existencia(e)).toBe("0.0000");
      // Anular dos veces el mismo movimiento (otra clave): el único `anula_a`.
      clave(await intentar(e.m, espejo), "movimiento_de_stock_anula_a_uk");
      // La anulación de una anulación.
      check(
        await intentar(
          e.m,
          espejoDe(e.m, {
            id: anulacion,
            deposito: e.d1,
            renglones: [{ articulo: e.articulo, cantidad: "-5" }],
          }),
        ),
        "movimiento_de_stock_no_anulable",
      );
      // Corregir y anular exigen el detalle.
      const otro = await cargar(e.m, entrada(e.m, e.d1, e.articulo, "2"));
      check(
        await intentar(
          e.m,
          espejoDe(
            e.m,
            { id: otro, deposito: e.d1, renglones: [{ articulo: e.articulo, cantidad: "2" }] },
            { detalle: null },
          ),
        ),
        "movimiento_de_stock_detalle_requerido_ck",
      );
      check(
        await intentar(e.m, {
          clase: "AJUSTE",
          motivo: "CORRECCION",
          deposito: e.d1,
          persona: e.m.persona,
          accion: "stock.ajustar",
          renglones: [{ articulo: e.articulo, cantidad: "1" }],
        }),
        "movimiento_de_stock_detalle_requerido_ck",
      );
      // Una anulación sin `anula_a` y un `anula_a` que no es de una anulación.
      check(
        await intentar(e.m, {
          clase: "ANULACION",
          motivo: "ANULACION",
          deposito: e.d1,
          persona: e.m.persona,
          detalle: "Sin original",
          renglones: [{ articulo: e.articulo, cantidad: "1" }],
        }),
        "movimiento_de_stock_anulacion_ck",
      );
      check(
        await intentar(e.m, entrada(e.m, e.d1, e.articulo, "1", { anulaA: otro })),
        "movimiento_de_stock_anulacion_ck",
      );
    });

    it("un ajuste por conteo por conteo (`movimiento_de_stock_conteo_uk`) y solo de un conteo aplicado del mismo depósito", async () => {
      const e = await escenario();
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "10"));
      const conteo = randomUUID();
      await enApp(e.m, async (s, ex) => {
        acepta(
          await ex(
            `insert into conteo_fisico (id, empresa_id, deposito_id, abierto_por, abierto_en) values ($1, $2, $3, $4, now())`,
            [conteo, e.m.empresa, e.d1, e.m.persona],
          ),
        );
        acepta(
          await ex(
            `insert into conteo_registro (id, empresa_id, conteo_id, articulo_id, cantidad_contada, registrado_por, registrado_en)
           values ($1, $2, $3, $4, 8, $5, now())`,
            [randomUUID(), e.m.empresa, conteo, e.articulo, e.m.persona],
          ),
        );
        acepta(await s.confirmar());
      });
      const delConteo = (extra: Partial<MovimientoDePrueba> = {}): MovimientoDePrueba => ({
        clase: "AJUSTE_POR_CONTEO",
        motivo: "CONTEO",
        deposito: e.d1,
        persona: e.m.persona,
        accion: "conteos.aplicar",
        conteo,
        renglones: [{ articulo: e.articulo, cantidad: "-2" }],
        ...extra,
      });
      // Sin aplicar el conteo (sigue abierto) el cuadre diferido lo rechaza.
      check(await confirmando(e.m, delConteo()), "movimiento_de_stock_conteo_no_aplicado");
      // Aplicado en la misma transacción: pasa; el saldo baja con la diferencia.
      await enApp(e.m, async (s, ex) => {
        acepta(
          await ex(
            `update conteo_fisico set estado = 'APLICADO', resuelto_por = $2, resuelto_en = now() where id = $1 and estado = 'ABIERTO'`,
            [conteo, e.m.persona],
          ),
        );
        acepta((await escribirMovimiento(ex, e.m.empresa, delConteo())).resultado);
        acepta(await s.confirmar());
      });
      expect(await existencia(e)).toBe("8.0000");
      // Otro ajuste del mismo conteo: el único.
      clave(await intentar(e.m, delConteo()), "movimiento_de_stock_conteo_uk");
      // Lo que no es ajuste por conteo no lleva `conteo_id`, y el de otro depósito no se acepta.
      check(
        await intentar(e.m, entrada(e.m, e.d1, e.articulo, "1", { conteo })),
        "movimiento_de_stock_ajuste_por_conteo_ck",
      );
      check(
        await intentar(
          e.m,
          delConteo({
            clave: claveNueva(),
            deposito: e.d2,
            renglones: [{ articulo: e.articulo, cantidad: "-2", deposito: e.d2 }],
          }),
        ),
        "movimiento_de_stock_conteo_de_otro_deposito",
      );
    });
  });

  // ---- el saldo ------------------------------------------------------------------------------------------------------------

  describe("el saldo es la suma de los renglones y solo lo escribe el libro", () => {
    it("lo calcula el disparador de los renglones: entradas, salidas y ajustes, por depósito y artículo, con 4 decimales exactos", async () => {
      const e = await escenario();
      expect(await existencia(e)).toBe("0");
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "10.5000"));
      await cargar(e.m, salida(e.m, e.d1, e.articulo, "3.2500"));
      await cargar(e.m, {
        clase: "AJUSTE",
        motivo: "CORRECCION",
        deposito: e.d1,
        persona: e.m.persona,
        accion: "stock.ajustar",
        detalle: "Conteo de la mañana",
        renglones: [{ articulo: e.articulo, cantidad: "0.0001" }],
      });
      expect(await existencia(e)).toBe("7.2501");
      expect(await existencia(e, e.d2)).toBe("0");
      const { rows } = await dueno.query<{ n: number }>(
        "select count(*)::int as n from saldo_de_stock where empresa_id = $1",
        [e.m.empresa],
      );
      expect(rows[0]?.n).toBe(1);
    });

    it("la aplicación no puede escribir un saldo (ni insertar ni cambiar ni borrar ni vaciar), y el dueño tampoco directo", async () => {
      const e = await escenario();
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "5"));
      await enApp(e.m, async (s) => {
        const insertar = await s.intentar(
          `insert into saldo_de_stock (empresa_id, deposito_id, articulo_id, existencia) values ($1, $2, $3, 99)`,
          [e.m.empresa, e.d2, e.articulo],
        );
        denegado(insertar);
        expect(!insertar.ok && insertar.mensaje).toMatch(/solo el libro de movimientos/);
        const cambiar = await s.intentar(
          `update saldo_de_stock set existencia = 99 where deposito_id = $1 and articulo_id = $2`,
          [e.d1, e.articulo],
        );
        denegado(cambiar);
        expect(!cambiar.ok && cambiar.mensaje).toMatch(/solo el libro de movimientos/);
        denegado(await s.intentar("delete from saldo_de_stock where deposito_id = $1", [e.d1]));
        denegado(await s.intentar("truncate saldo_de_stock"));
        // Un upsert tampoco: el INSERT del upsert dispara el mismo disparador a profundidad 1.
        denegado(
          await s.intentar(
            `insert into saldo_de_stock as s (empresa_id, deposito_id, articulo_id, existencia) values ($1, $2, $3, 1)
             on conflict (empresa_id, deposito_id, articulo_id) do update set existencia = s.existencia + 1`,
            [e.m.empresa, e.d1, e.articulo],
          ),
        );
      });
      await sinConfirmar(dueno, async () => {
        denegado(
          await intentoDelDueno(
            dueno,
            `insert into saldo_de_stock (empresa_id, deposito_id, articulo_id, existencia) values ($1, $2, $3, 99)`,
            [e.m.empresa, e.d2, e.articulo],
          ),
        );
        denegado(
          await intentoDelDueno(
            dueno,
            "update saldo_de_stock set existencia = 99 where deposito_id = $1",
            [e.d1],
          ),
        );
        denegado(
          await intentoDelDueno(dueno, "delete from saldo_de_stock where deposito_id = $1", [e.d1]),
        );
        noSeVacia(await intentoDelDueno(dueno, "truncate saldo_de_stock"));
      });
      expect(await existencia(e)).toBe("5.0000");
    });

    it("una existencia fuera de rango (o NaN) no entra, ni un renglón en cero", async () => {
      const e = await escenario();
      await enApp(e.m, async (s, ex) => {
        for (const cantidad of ["0", "NaN", "100000000000000", "-100000000000000"]) {
          const r = await escribirMovimiento(
            ex,
            e.m.empresa,
            entrada(e.m, e.d1, e.articulo, cantidad),
          );
          expect(r.resultado.ok, cantidad).toBe(false);
        }
        await s.deshacer();
      });
      expect(await existencia(e)).toBe("0");
    });

    it("un movimiento sin renglones no se confirma, y los renglones solo entran en la transacción de su movimiento", async () => {
      const e = await escenario();
      check(
        await confirmando(e.m, { ...entrada(e.m, e.d1, e.articulo, "1"), renglones: [] }),
        "movimiento_de_stock_sin_renglones",
      );
      const id = await cargar(e.m, entrada(e.m, e.d1, e.articulo, "5"));
      // Otra transacción le suma un renglón a un movimiento ya confirmado: el libro no se reescribe.
      await enApp(e.m, async (_s, ex) => {
        const otroArticulo = await articuloDeBase(dueno, e.m);
        check(
          await ex(
            `insert into renglon_de_movimiento (empresa_id, movimiento_id, numero, deposito_id, articulo_id, cantidad) values ($1, $2, 2, $3, $4, 1)`,
            [e.m.empresa, id, e.d1, otroArticulo.articulo],
          ),
          "renglon_movimiento_confirmado",
        );
      });
      expect(await existencia(e)).toBe("5.0000");
    });

    it("un renglón por (movimiento, depósito, artículo, composición), contando la ausencia de composición como un valor", async () => {
      const e = await escenario();
      const compuesto = await cargarComposicion(e, { numero: 1 });
      const r = (composicion: string | null) => ({
        articulo: e.articulo,
        cantidad: "1",
        composicion,
      });
      acepta(
        await confirmando(e.m, {
          ...entrada(e.m, e.d1, e.articulo, "1"),
          renglones: [r(null), r(compuesto.composicion)],
        }),
      );
      clave(
        await intentar(e.m, {
          ...entrada(e.m, e.d1, e.articulo, "1"),
          renglones: [r(null), r(null)],
        }),
        "renglon_de_movimiento_unico_uk",
      );
      clave(
        await intentar(e.m, {
          ...entrada(e.m, e.d1, e.articulo, "1"),
          renglones: [r(compuesto.composicion), r(compuesto.composicion)],
        }),
        "renglon_de_movimiento_unico_uk",
      );
    });

    it("propiedad: para historias aleatorias de entradas, salidas, transferencias, ajustes y anulaciones, el saldo es la suma de los renglones y coincide con un modelo independiente", async () => {
      const e = await escenario();
      const d3 = await depositoDeBase(dueno, e.m);
      const otro = await articuloDeBase(dueno, e.m);
      const depositos = [e.d1, e.d2, d3];
      const articulos = [e.articulo, otro.articulo];
      let semilla = 20261110;
      const azar = (n: number): number => {
        semilla = (semilla * 1103515245 + 12345) % 2147483648;
        return Math.floor(semilla / 65536) % n;
      };
      const modelo = new Map<string, number>();
      const sumar = (deposito: string, articulo: string, cantidad: number): void => {
        const k = `${deposito}|${articulo}`;
        modelo.set(k, (modelo.get(k) ?? 0) + cantidad);
      };
      type Hecho = {
        id: string;
        mov: MovimientoDePrueba;
        anulado: boolean;
      };
      const hechos: Hecho[] = [];
      for (let paso = 0; paso < 40; paso += 1) {
        const deposito = depositos[azar(3)] as string;
        const articulo = articulos[azar(2)] as string;
        const cantidad = String(1 + azar(9));
        const tipo = azar(10);
        let mov: MovimientoDePrueba;
        if (tipo <= 2) mov = entrada(e.m, deposito, articulo, cantidad);
        else if (tipo <= 4) mov = salida(e.m, deposito, articulo, cantidad);
        else if (tipo <= 6) {
          const otros = depositos.filter((d) => d !== deposito);
          const destino = otros[azar(otros.length)] as string;
          mov = transferencia(e.m, deposito, destino, articulo, cantidad);
        } else if (tipo === 7) {
          mov = {
            clase: "AJUSTE",
            motivo: "CORRECCION",
            deposito,
            persona: e.m.persona,
            accion: "stock.ajustar",
            detalle: "Ajuste de prueba",
            renglones: [{ articulo, cantidad: azar(2) === 0 ? cantidad : `-${cantidad}` }],
          };
        } else {
          const anulables = hechos.filter((h) => !h.anulado);
          const objetivo = anulables[azar(Math.max(anulables.length, 1))];
          if (objetivo === undefined) continue;
          const id = randomUUID();
          mov = espejoDe(e.m, { ...objetivo.mov, id: objetivo.id });
          objetivo.anulado = true;
          for (const r of mov.renglones)
            sumar(r.deposito ?? mov.deposito, r.articulo, Number(r.cantidad));
          await cargar(e.m, { ...mov, id });
          continue;
        }
        for (const r of mov.renglones)
          sumar(r.deposito ?? mov.deposito, r.articulo, Number(r.cantidad));
        const id = await cargar(e.m, mov);
        hechos.push({ id, mov, anulado: false });
      }
      expect(hechos.length).toBeGreaterThan(20);
      const { rows: difieren } = await dueno.query(
        `select s.deposito_id, s.articulo_id, s.existencia, r.suma
           from saldo_de_stock s
           full join (select deposito_id, articulo_id, sum(cantidad) as suma from renglon_de_movimiento
                       where empresa_id = $1 group by deposito_id, articulo_id) r
             on r.deposito_id = s.deposito_id and r.articulo_id = s.articulo_id
          where coalesce(s.empresa_id, $1) = $1 and s.existencia is distinct from r.suma`,
        [e.m.empresa],
      );
      expect(difieren).toEqual([]);
      for (const deposito of depositos) {
        for (const articulo of articulos) {
          const esperado = modelo.get(`${deposito}|${articulo}`) ?? 0;
          const real = Number(await existenciaDe(dueno, deposito, articulo));
          expect(real, `${deposito} ${articulo}`).toBe(esperado);
        }
      }
    });
  });

  // ---- solo inserción ------------------------------------------------------------------------------------------------------

  describe("solo inserción", () => {
    it("el libro, los renglones, los registros de conteo y las versiones de composición no se modifican, borran ni vacían (ni el dueño; la aplicación ni tiene el privilegio)", async () => {
      const e = await escenario();
      const mov = await cargar(e.m, entrada(e.m, e.d1, e.articulo, "5"));
      const conteo = randomUUID();
      const registro = randomUUID();
      await enApp(e.m, async (s, ex) => {
        acepta(
          await ex(
            `insert into conteo_fisico (id, empresa_id, deposito_id, abierto_por, abierto_en) values ($1, $2, $3, $4, now())`,
            [conteo, e.m.empresa, e.d1, e.m.persona],
          ),
        );
        acepta(
          await ex(
            `insert into conteo_registro (id, empresa_id, conteo_id, articulo_id, cantidad_contada, registrado_por, registrado_en)
           values ($1, $2, $3, $4, 5, $5, now())`,
            [registro, e.m.empresa, conteo, e.articulo, e.m.persona],
          ),
        );
        acepta(await s.confirmar());
      });
      const compuesto = await cargarComposicion(e, { numero: 1 });
      const sentencias: Array<[string, string, unknown[]]> = [
        [
          "motivo_de_movimiento",
          "update motivo_de_movimiento set entra_con_costo = true where codigo = 'MERMA'",
          [],
        ],
        ["motivo_de_movimiento", "delete from motivo_de_movimiento where codigo = 'MERMA'", []],
        [
          "movimiento_de_stock",
          "update movimiento_de_stock set detalle = 'x' where id = $1",
          [mov],
        ],
        ["movimiento_de_stock", "delete from movimiento_de_stock where id = $1", [mov]],
        [
          "renglon_de_movimiento",
          "update renglon_de_movimiento set cantidad = 99 where movimiento_id = $1",
          [mov],
        ],
        [
          "renglon_de_movimiento",
          "delete from renglon_de_movimiento where movimiento_id = $1",
          [mov],
        ],
        [
          "conteo_registro",
          "update conteo_registro set cantidad_contada = 1 where id = $1",
          [registro],
        ],
        ["conteo_registro", "delete from conteo_registro where id = $1", [registro]],
        ["composicion", "update composicion set rinde = 2 where id = $1", [compuesto.composicion]],
        ["composicion", "delete from composicion where id = $1", [compuesto.composicion]],
        [
          "componente_de_composicion",
          "update componente_de_composicion set cantidad = 9 where composicion_id = $1",
          [compuesto.composicion],
        ],
        [
          "componente_de_composicion",
          "delete from componente_de_composicion where composicion_id = $1",
          [compuesto.composicion],
        ],
      ];
      for (const tabla of SOLO_INSERCION) {
        await sinConfirmar(dueno, async () => {
          noSeVacia(await intentoDelDueno(dueno, `truncate ${tabla}`));
        });
      }
      for (const [tabla, texto, parametros] of sentencias) {
        await sinConfirmar(dueno, async () => {
          const r = await intentoDelDueno(dueno, texto, parametros);
          denegado(r);
          expect(!r.ok && r.mensaje, tabla).toMatch(/solo inserción/);
        });
        await enApp(e.m, async (s) => {
          denegado(await s.intentar(texto, parametros));
        });
      }
      for (const tabla of SOLO_INSERCION) {
        await enApp(e.m, async (s) => {
          denegado(await s.intentar(`truncate ${tabla}`));
        });
      }
      expect(await existencia(e)).toBe("5.0000");
    });

    it("el depósito, el artículo, el conteo y el saldo no se borran ni se vacían (ni el dueño)", async () => {
      const e = await escenario();
      const conteo = randomUUID();
      await dueno.query(
        `insert into conteo_fisico (id, empresa_id, deposito_id, abierto_por, abierto_en) values ($1, $2, $3, $4, now())`,
        [conteo, e.m.empresa, e.d2, e.m.persona],
      );
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "5"));
      for (const [tabla, filtro, id] of [
        ["deposito", "id", e.d1],
        ["articulo_de_stock", "id", e.articulo],
        ["conteo_fisico", "id", conteo],
        ["saldo_de_stock", "deposito_id", e.d1],
      ] as const) {
        await sinConfirmar(dueno, async () => {
          const r = await intentoDelDueno(dueno, `delete from ${tabla} where ${filtro} = $1`, [id]);
          denegado(r);
          expect(!r.ok && r.mensaje, tabla).toMatch(/no admite borrados/);
          noSeVacia(await intentoDelDueno(dueno, `truncate ${tabla}`));
        });
        await enApp(e.m, async (s) => {
          denegado(await s.intentar(`delete from ${tabla} where ${filtro} = $1`, [id]));
          denegado(await s.intentar(`truncate ${tabla}`));
        });
      }
    });
  });

  // ---- la fecha de negocio -------------------------------------------------------------------------------------------------

  describe("la fecha de negocio", () => {
    it("un movimiento a las 02:00 con corte 04:00 es de la jornada anterior, a las 04:00 de la del día; los renglones la copian y queda sellada", async () => {
      const e = await escenario();
      await dueno.query("update sucursal set hora_de_corte = '04:00' where id = $1", [
        e.m.sucursal,
      ]);
      const antes = await cargar(
        e.m,
        entrada(e.m, e.d1, e.articulo, "1", { hechoEn: "2026-11-09T05:00:00Z" }),
      ); // 02:00 en Argentina
      const despues = await cargar(
        e.m,
        entrada(e.m, e.d1, e.articulo, "1", { hechoEn: "2026-11-09T07:00:00Z" }),
      ); // 04:00
      const fechas = async (id: string) =>
        un<{ cabecera: string; renglon: string }>(
          `select m.fecha_negocio::text as cabecera, r.fecha_negocio::text as renglon
             from movimiento_de_stock m join renglon_de_movimiento r on r.movimiento_id = m.id where m.id = $1`,
          [id],
        );
      expect(await fechas(antes)).toEqual({ cabecera: "2026-11-08", renglon: "2026-11-08" });
      expect(await fechas(despues)).toEqual({ cabecera: "2026-11-09", renglon: "2026-11-09" });
      // `hecho_en` también se copia al renglón.
      expect(
        (
          await un<{ igual: boolean }>(
            `select bool_and(r.hecho_en = m.hecho_en) as igual from movimiento_de_stock m join renglon_de_movimiento r on r.movimiento_id = m.id where m.id = $1`,
            [antes],
          )
        ).igual,
      ).toBe(true);
      // Cambiar el corte o la zona después no reescribe lo ya sellado.
      await dueno.query("update sucursal set hora_de_corte = '00:00' where id = $1", [
        e.m.sucursal,
      ]);
      await dueno.query("update empresa set zona_horaria = 'Asia/Kolkata' where id = $1", [
        e.m.empresa,
      ]);
      expect(await fechas(antes)).toEqual({ cabecera: "2026-11-08", renglon: "2026-11-08" });
      // Y el movimiento nuevo ya usa la zona y el corte vigentes.
      const nuevo = await cargar(
        e.m,
        entrada(e.m, e.d1, e.articulo, "1", { hechoEn: "2026-11-09T05:00:00Z" }),
      );
      expect((await fechas(nuevo)).cabecera).toBe("2026-11-09");
    });

    it("la fórmula de la base es la de `fechaDeNegocio` de `primitivas/tiempo` para varias zonas, cortes e instantes", async () => {
      const e = await escenario();
      const instantes = [
        "2026-11-10T02:59:00Z",
        "2026-11-10T03:00:00Z",
        "2026-11-10T04:25:00Z",
        "2026-11-10T08:59:00Z",
        "2026-11-10T09:00:00Z",
        "2026-03-29T00:30:00Z",
        "2026-03-29T01:30:00Z",
        "2026-10-25T00:30:00Z",
        "2026-10-25T01:30:00Z",
        "2026-12-31T23:59:00Z",
        "2027-01-01T02:00:00Z",
      ];
      const cortes = ["00:00", "04:00", "06:00", "12:30", "23:59"];
      await dueno.query("begin");
      try {
        for (const zona of [
          "America/Argentina/Buenos_Aires",
          "Europe/Madrid",
          "Asia/Kolkata",
          "UTC",
        ]) {
          await dueno.query("update empresa set zona_horaria = $2 where id = $1", [
            e.m.empresa,
            zona,
          ]);
          for (const corte of cortes) {
            await dueno.query("update sucursal set hora_de_corte = $2 where id = $1", [
              e.m.sucursal,
              corte,
            ]);
            for (const instante of instantes) {
              const id = randomUUID();
              acepta(
                (
                  await escribirMovimiento((t, p) => intentoDelDueno(dueno, t, p), e.m.empresa, {
                    ...entrada(e.m, e.d1, e.articulo, "1"),
                    id,
                    hechoEn: instante,
                    renglones: [],
                  })
                ).resultado,
              );
              const { fecha } = await un<{ fecha: string }>(
                "select fecha_negocio::text as fecha from movimiento_de_stock where id = $1",
                [id],
              );
              const esperada = fechaDeNegocio(new Date(instante), zona, corte);
              expect(esperada.ok, `${zona} ${corte} ${instante}`).toBe(true);
              expect(fecha, `${zona} corte ${corte} ${instante}`).toBe(
                esperada.ok ? esperada.valor : null,
              );
            }
          }
        }
      } finally {
        await dueno.query("rollback");
      }
    });

    it("una transferencia toma la jornada de la sucursal del depósito de ORIGEN", async () => {
      const e = await escenario();
      const otraSucursal = await sucursalDeBase(dueno, e.m.empresa, { corte: "00:00" });
      await dueno.query("update sucursal set hora_de_corte = '04:00' where id = $1", [
        e.m.sucursal,
      ]);
      const lejano = await depositoDeBase(dueno, e.m, { sucursal: otraSucursal });
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "9"));
      await cargar(e.m, entrada(e.m, lejano, e.articulo, "9"));
      const alas02 = "2026-11-09T05:00:00Z"; // 02:00 en Argentina
      const ida = await cargar(
        e.m,
        transferencia(e.m, e.d1, lejano, e.articulo, "3", { hechoEn: alas02 }),
      );
      const vuelta = await cargar(
        e.m,
        transferencia(e.m, lejano, e.d1, e.articulo, "3", { hechoEn: alas02 }),
      );
      const fecha = async (id: string) =>
        (
          await dueno.query<{ f: string }>(
            `select distinct m.fecha_negocio::text as f from movimiento_de_stock m join renglon_de_movimiento r on r.movimiento_id = m.id where m.id = $1`,
            [id],
          )
        ).rows.map((x) => x.f);
      expect(await fecha(ida)).toEqual(["2026-11-08"]); // origen con corte 04:00
      expect(await fecha(vuelta)).toEqual(["2026-11-09"]); // origen con corte 00:00
    });

    it("la salida por venta conserva la fecha de negocio del ticket (aunque `hecho_en` diga otra) y ningún otro movimiento puede mandarla", async () => {
      const e = await escenario();
      const ejemplar = randomUUID();
      const venta = (extra: Partial<MovimientoDePrueba> = {}): MovimientoDePrueba =>
        salida(e.m, e.d1, e.articulo, "1", {
          motivo: "VENTA",
          origen: { tipo: "EJEMPLAR_DE_TICKET", id: randomUUID() },
          accion: "ventas.cerrar_cuenta",
          hechoEn: "2026-11-09T05:00:00Z",
          fechaDeNegocio: "2026-11-05",
          ...extra,
        });
      const id = await cargar(e.m, venta({ origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar } }));
      expect(
        await un(
          `select m.fecha_negocio::text as cabecera, r.fecha_negocio::text as renglon, m.hecho_en = r.hecho_en as igual
             from movimiento_de_stock m join renglon_de_movimiento r on r.movimiento_id = m.id where m.id = $1`,
          [id],
        ),
      ).toEqual({ cabecera: "2026-11-05", renglon: "2026-11-05", igual: true });
      // Sin la fecha del ticket, la venta no se registra (la base no la inventa).
      check(
        await intentar(e.m, venta({ fechaDeNegocio: null })),
        "movimiento_de_stock_venta_sin_fecha_de_negocio",
      );
      // Cualquier otro movimiento con `fecha_negocio` mandada por la aplicación se rechaza.
      for (const otro of [
        entrada(e.m, e.d1, e.articulo, "1", { fechaDeNegocio: "2026-11-05" }),
        salida(e.m, e.d1, e.articulo, "1", { fechaDeNegocio: "2026-11-05" }),
      ]) {
        check(await intentar(e.m, otro), "movimiento_de_stock_fecha_de_negocio_no_admitida");
      }
      // Una fecha absurda no entra ni siquiera como la del ticket.
      check(
        await intentar(e.m, venta({ fechaDeNegocio: "1999-12-31" })),
        "movimiento_de_stock_fecha_ck",
      );
    });
  });

  // ---- depósitos -----------------------------------------------------------------------------------------------------------

  describe("depósitos", () => {
    it("a lo sumo uno «de venta» por sucursal (y de uso normal y activo); el nombre es único por sucursal", async () => {
      const e = await escenario(); // `d1` ya es el de venta
      const otraSucursal = await sucursalDeBase(dueno, e.m.empresa);
      await enApp(e.m, async (s) => {
        const alta = (
          id: string,
          sucursal: string,
          nombre: string,
          uso: string,
          deVenta: boolean,
        ) =>
          s.intentar(
            `insert into deposito (id, empresa_id, sucursal_id, nombre, nombre_clave, uso, de_venta) values ($1, $2, $3, $4, $5, $6, $7)`,
            [id, e.m.empresa, sucursal, nombre, nombre.toLowerCase(), uso, deVenta],
          );
        clave(
          await alta(randomUUID(), e.m.sucursal, "Otro de venta", "NORMAL", true),
          "deposito_de_venta_uk",
        );
        acepta(await alta(randomUUID(), otraSucursal, "De venta de la otra", "NORMAL", true));
        // Cuarentena y rechazo no son de venta.
        check(
          await alta(randomUUID(), otraSucursal, "Cuarentena de venta", "CUARENTENA", true),
          "deposito_de_venta_ck",
        );
        check(
          await alta(randomUUID(), otraSucursal, "Rechazo de venta", "RECHAZO", true),
          "deposito_de_venta_ck",
        );
        // El nombre se repite por sucursal (sin distinguir mayúsculas: lo normaliza la aplicación en `nombre_clave`), y es válido.
        const { nombre } = await un<{ nombre: string }>(
          "select nombre from deposito where id = $1",
          [e.d2],
        );
        clave(
          await alta(randomUUID(), e.m.sucursal, nombre, "NORMAL", false),
          "deposito_nombre_uk",
        );
        acepta(await alta(randomUUID(), otraSucursal, nombre, "NORMAL", false));
        check(
          await alta(randomUUID(), e.m.sucursal, "<b>mal</b>", "NORMAL", false),
          "deposito_nombre_ck",
        );
        check(
          await alta(randomUUID(), e.m.sucursal, "Con uso raro", "VIRTUAL", false),
          "deposito_uso_ck",
        );
        // El de venta no se desactiva ni cambia de uso; otro de la sucursal puede pasar a serlo solo si el actual deja de serlo.
        check(
          await s.intentar("update deposito set activo = false where id = $1", [e.d1]),
          "deposito_de_venta_ck",
        );
        clave(
          await s.intentar("update deposito set de_venta = true where id = $1", [e.d2]),
          "deposito_de_venta_uk",
        );
        acepta(await s.intentar("update deposito set de_venta = false where id = $1", [e.d1]));
        acepta(await s.intentar("update deposito set de_venta = true where id = $1", [e.d2]));
      });
    });

    it("la empresa, la sucursal y el uso no cambian (ni con SQL del dueño)", async () => {
      const e = await escenario();
      const cuarentena = await depositoDeBase(dueno, e.m, { uso: "CUARENTENA" });
      const otraSucursal = await sucursalDeBase(dueno, e.m.empresa);
      await sinConfirmar(dueno, async () => {
        check(
          await intentoDelDueno(dueno, "update deposito set uso = 'NORMAL' where id = $1", [
            cuarentena,
          ]),
          "deposito_uso_inmutable",
        );
        check(
          await intentoDelDueno(dueno, "update deposito set uso = 'RECHAZO' where id = $1", [e.d1]),
          "deposito_uso_inmutable",
        );
        check(
          await intentoDelDueno(dueno, "update deposito set sucursal_id = $2 where id = $1", [
            e.d1,
            otraSucursal,
          ]),
          "deposito_identidad_inmutable",
        );
      });
    });

    it("no se desactiva con existencia ni con un conteo abierto, sí cuando está en cero y sin conteo; uno inactivo no admite movimientos ni conteos", async () => {
      const e = await escenario();
      const vacio = await depositoDeBase(dueno, e.m);
      await cargar(e.m, entrada(e.m, e.d2, e.articulo, "3"));
      await enApp(e.m, async (s) => {
        check(
          await s.intentar("update deposito set activo = false where id = $1", [e.d2]),
          "deposito_con_existencia",
        );
        acepta(await s.intentar("update deposito set activo = false where id = $1", [vacio]));
        // Inactivo: ni entra mercadería, ni se abre un conteo, ni es el destino de una transferencia.
        const r = await escribirMovimiento(
          (t, p) => s.intentar(t, p),
          e.m.empresa,
          entrada(e.m, vacio, e.articulo, "1"),
        );
        check(r.resultado, "movimiento_de_stock_deposito_inactivo");
        check(
          await s.intentar(
            `insert into conteo_fisico (id, empresa_id, deposito_id, abierto_por, abierto_en) values ($1, $2, $3, $4, now())`,
            [randomUUID(), e.m.empresa, vacio, e.m.persona],
          ),
          "conteo_fisico_deposito_inactivo",
        );
        // Con la existencia en cero ya no hay nada que impida desactivarlo; reactivar siempre se puede.
        acepta(await s.intentar("update deposito set activo = true where id = $1", [vacio]));
      });
      const conteo = randomUUID();
      await dueno.query(
        `insert into conteo_fisico (id, empresa_id, deposito_id, abierto_por, abierto_en) values ($1, $2, $3, $4, now())`,
        [conteo, e.m.empresa, vacio, e.m.persona],
      );
      await enApp(e.m, async (s) => {
        check(
          await s.intentar("update deposito set activo = false where id = $1", [vacio]),
          "deposito_con_conteo_abierto",
        );
      });
      await dueno.query(
        "update conteo_fisico set estado = 'CANCELADO', resuelto_por = $2, resuelto_en = now(), motivo = 'Prueba' where id = $1",
        [conteo, e.m.persona],
      );
      await enApp(e.m, async (s) => {
        acepta(await s.intentar("update deposito set activo = false where id = $1", [vacio]));
      });
    });

    it("cuarentena y rechazo no admiten venta, entrada ni salida, pero sí transferencia, ajuste, ajuste por conteo y anulación", async () => {
      const e = await escenario();
      for (const uso of ["CUARENTENA", "RECHAZO"] as const) {
        const d = await depositoDeBase(dueno, e.m, { uso });
        for (const mov of [
          salida(e.m, d, e.articulo, "1", {
            motivo: "VENTA",
            origen: { tipo: "EJEMPLAR_DE_TICKET", id: randomUUID() },
            fechaDeNegocio: "2026-11-09",
          }),
          salida(e.m, d, e.articulo, "1"),
          entrada(e.m, d, e.articulo, "1"),
        ]) {
          check(await intentar(e.m, mov), "renglon_deposito_de_uso_restringido");
        }
        // A cuarentena se llega por transferencia y se corrige por ajuste.
        await cargar(e.m, entrada(e.m, e.d1, e.articulo, "5"));
        const ida = transferencia(e.m, e.d1, d, e.articulo, "5", { id: randomUUID() });
        const idIda = await cargar(e.m, ida);
        expect(await existenciaDe(dueno, d, e.articulo)).toBe("5.0000");
        await cargar(e.m, {
          clase: "AJUSTE",
          motivo: "CORRECCION",
          deposito: d,
          persona: e.m.persona,
          detalle: "Se rompió una",
          renglones: [{ articulo: e.articulo, cantidad: "-1" }],
        });
        // Y la anulación de la transferencia sale de cuarentena.
        await cargar(e.m, espejoDe(e.m, { ...ida, id: idIda }));
        expect(await existenciaDe(dueno, d, e.articulo)).toBe("-1.0000");
        expect(await existenciaDe(dueno, e.d1, e.articulo)).toBe("5.0000");
        // Ajustar de vuelta: la cuenta de cuarentena queda en cero.
        await cargar(e.m, {
          clase: "AJUSTE",
          motivo: "CORRECCION",
          deposito: d,
          persona: e.m.persona,
          detalle: "Se encontró",
          renglones: [{ articulo: e.articulo, cantidad: "1" }],
        });
        await cargar(e.m, salida(e.m, e.d1, e.articulo, "5"));
      }
    });
  });

  // ---- artículos -----------------------------------------------------------------------------------------------------------

  describe("artículos de stock", () => {
    it("solo materia prima, insumo y reventa; la unidad de stock es la base del producto; uno por producto; no cambia nada que lo identifique", async () => {
      const e = await escenario();
      for (const clase of ["ELABORADO", "VENDIBLE"] as const) {
        const producto = await productoDeBase(dueno, e.m.empresa, { clase });
        await sinConfirmar(dueno, async () => {
          check(
            await intentoDelDueno(
              dueno,
              `insert into articulo_de_stock (id, empresa_id, producto_id, unidad_de_stock_id, dimension) values ($1, $2, $3, 'UNIDAD', 'CONTEO')`,
              [randomUUID(), e.m.empresa, producto],
            ),
            "articulo_de_stock_clase_no_controlable",
          );
        });
      }
      for (const clase of ["MATERIA_PRIMA", "INSUMO", "REVENTA"] as const) {
        await articuloDeBase(dueno, e.m, { clase });
      }
      await sinConfirmar(dueno, async () => {
        const kilos = await productoDeBase(dueno, e.m.empresa, {
          clase: "INSUMO",
          unidadBase: "KILOGRAMO",
          dimension: "MASA",
          unidadDeVenta: "KILOGRAMO",
        });
        // La unidad de stock tiene que ser la base del producto, y la dimensión la de la unidad.
        referencia(
          await intentoDelDueno(
            dueno,
            `insert into articulo_de_stock (id, empresa_id, producto_id, unidad_de_stock_id, dimension) values ($1, $2, $3, 'GRAMO', 'MASA')`,
            [randomUUID(), e.m.empresa, kilos],
          ),
          "articulo_de_stock_producto_unidad_fkey",
        );
        referencia(
          await intentoDelDueno(
            dueno,
            `insert into articulo_de_stock (id, empresa_id, producto_id, unidad_de_stock_id, dimension) values ($1, $2, $3, 'KILOGRAMO', 'CONTEO')`,
            [randomUUID(), e.m.empresa, kilos],
          ),
          "articulo_de_stock_producto_dimension_fkey",
        );
        acepta(
          await intentoDelDueno(
            dueno,
            `insert into articulo_de_stock (id, empresa_id, producto_id, unidad_de_stock_id, dimension) values ($1, $2, $3, 'KILOGRAMO', 'MASA')`,
            [randomUUID(), e.m.empresa, kilos],
          ),
        );
        clave(
          await intentoDelDueno(
            dueno,
            `insert into articulo_de_stock (id, empresa_id, producto_id, unidad_de_stock_id, dimension) values ($1, $2, $3, 'KILOGRAMO', 'MASA')`,
            [randomUUID(), e.m.empresa, kilos],
          ),
          "articulo_de_stock_producto_uk",
        );
        check(
          await intentoDelDueno(
            dueno,
            "update articulo_de_stock set unidad_de_stock_id = 'GRAMO' where producto_id = $1",
            [kilos],
          ),
          "articulo_de_stock_inmutable",
        );
      });
      // La unidad base del producto no cambia (E2), y con el artículo creado tampoco habría con qué apuntar.
      await sinConfirmar(dueno, async () => {
        check(
          await intentoDelDueno(
            dueno,
            "update producto set unidad_base_id = 'GRAMO' where id = $1",
            [e.producto],
          ),
          "producto_unidad_inmutable",
        );
      });
    });

    it("un artículo inactivo no admite movimientos nuevos, pero sí la anulación de uno anterior", async () => {
      const e = await escenario();
      const original = entrada(e.m, e.d1, e.articulo, "4");
      const id = await cargar(e.m, original);
      await enApp(e.m, async (s) => {
        acepta(
          await s.intentar("update articulo_de_stock set activo = false where id = $1", [
            e.articulo,
          ]),
        );
        acepta(await s.confirmar());
      });
      check(await intentar(e.m, entrada(e.m, e.d1, e.articulo, "1")), "renglon_articulo_inactivo");
      check(await intentar(e.m, salida(e.m, e.d1, e.articulo, "1")), "renglon_articulo_inactivo");
      // El saldo sigue consultable y lo vendido todavía se puede anular.
      await cargar(e.m, espejoDe(e.m, { ...original, id }));
      expect(await existencia(e)).toBe("0.0000");
    });
  });

  // ---- transferencias y anulaciones ----------------------------------------------------------------------------------------

  describe("transferencia y anulación espejo", () => {
    it("la transferencia suma cero por artículo y mueve entre dos depósitos distintos; el total de la empresa no cambia", async () => {
      const e = await escenario();
      const otro = await articuloDeBase(dueno, e.m);
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "10"));
      await cargar(e.m, entrada(e.m, e.d1, otro.articulo, "4"));
      const multi: MovimientoDePrueba = {
        clase: "TRANSFERENCIA",
        motivo: "TRANSFERENCIA",
        deposito: e.d1,
        persona: e.m.persona,
        renglones: [
          { articulo: e.articulo, cantidad: "-6", deposito: e.d1 },
          { articulo: e.articulo, cantidad: "6", deposito: e.d2 },
          { articulo: otro.articulo, cantidad: "-4", deposito: e.d1 },
          { articulo: otro.articulo, cantidad: "4", deposito: e.d2 },
        ],
      };
      acepta(await confirmando(e.m, multi));
      expect(await existencia(e, e.d1)).toBe("4.0000");
      expect(await existencia(e, e.d2)).toBe("6.0000");
      expect(await existenciaDe(dueno, e.d2, otro.articulo)).toBe("4.0000");
      expect(await existenciaDe(dueno, e.d1, otro.articulo)).toBe("0.0000");
      // No suma cero.
      check(
        await confirmando(e.m, {
          ...multi,
          renglones: [
            { articulo: e.articulo, cantidad: "-1", deposito: e.d1 },
            { articulo: e.articulo, cantidad: "2", deposito: e.d2 },
          ],
        }),
        "movimiento_de_stock_transferencia_no_suma_cero",
      );
      // Origen y destino iguales: un solo depósito.
      check(
        await confirmando(e.m, {
          ...multi,
          renglones: [
            { articulo: e.articulo, cantidad: "-1", deposito: e.d1 },
            { articulo: otro.articulo, cantidad: "1", deposito: e.d1 },
          ],
        }),
        "movimiento_de_stock_transferencia_entre_depositos_distintos",
      );
      // Tres depósitos.
      const d3 = await depositoDeBase(dueno, e.m);
      check(
        await confirmando(e.m, {
          ...multi,
          renglones: [
            { articulo: e.articulo, cantidad: "-2", deposito: e.d1 },
            { articulo: e.articulo, cantidad: "1", deposito: e.d2 },
            { articulo: e.articulo, cantidad: "1", deposito: d3 },
          ],
        }),
        "movimiento_de_stock_transferencia_entre_depositos_distintos",
      );
      // Resta en el destino y suma en el origen: el signo al revés.
      check(
        await confirmando(e.m, {
          ...multi,
          renglones: [
            { articulo: e.articulo, cantidad: "3", deposito: e.d1 },
            { articulo: e.articulo, cantidad: "-3", deposito: e.d2 },
          ],
        }),
        "movimiento_de_stock_signo_invalido",
      );
      expect(await existencia(e, e.d1)).toBe("4.0000");
      expect(await existencia(e, e.d2)).toBe("6.0000");
    });

    it("atómica: con un destino inactivo, o si algo falla después de la salida de origen, no queda ningún renglón y los dos saldos igual", async () => {
      const e = await escenario();
      const inactivo = await depositoDeBase(dueno, e.m, { activo: false });
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "10"));
      check(
        await intentar(e.m, transferencia(e.m, e.d1, inactivo, e.articulo, "3")),
        "renglon_deposito_inactivo",
      );
      // Falla inyectada: el origen ya salió y el destino es un artículo de otra empresa.
      const ajeno = await articuloDeBase(dueno, await crearMundo(dueno));
      await enApp(e.m, async (s, ex) => {
        const r = await escribirMovimiento(ex, e.m.empresa, {
          ...transferencia(e.m, e.d1, e.d2, e.articulo, "3"),
          renglones: [
            { articulo: e.articulo, cantidad: "-3", deposito: e.d1 },
            { articulo: ajeno.articulo, cantidad: "3", deposito: e.d2 },
          ],
        });
        expect(r.resultado.ok).toBe(false);
        // El savepoint de la sentencia fallida se deshizo, pero la salida de origen sigue en esta transacción: se confirma o no según el cuadre.
        const confirmada = await s.confirmar();
        expect(confirmada.ok).toBe(false);
      });
      expect(await existencia(e, e.d1)).toBe("10.0000");
      expect(await existencia(e, e.d2)).toBe("0");
      const { n } = await un<{ n: number }>(
        "select count(*)::int as n from movimiento_de_stock where empresa_id = $1 and clase = 'TRANSFERENCIA'",
        [e.m.empresa],
      );
      expect(n).toBe(0);
    });

    it("la anulación es el espejo exacto: mismos depósitos, artículos y composiciones con la cantidad opuesta; un renglón distinto o faltante se rechaza al confirmar", async () => {
      const e = await escenario();
      const compuesto = await cargarComposicion(e, { numero: 1 });
      const original: MovimientoDePrueba = {
        ...salida(e.m, e.d1, e.articulo, "2", { id: randomUUID() }),
        renglones: [
          { articulo: e.articulo, cantidad: "-2", composicion: compuesto.composicion },
          { articulo: e.articulo, cantidad: "-1" },
        ],
      };
      const id = await cargar(e.m, original);
      expect(await existencia(e)).toBe("-3.0000");
      const espejo = (extra: Partial<MovimientoDePrueba>) =>
        espejoDe(e.m, { ...original, id }, extra);
      const mal = "movimiento_de_stock_anulacion_no_es_espejo";
      // Cantidad distinta, renglón de menos, de más, composición perdida y depósito del acto distinto.
      check(
        await confirmando(
          e.m,
          espejo({
            renglones: [
              { articulo: e.articulo, cantidad: "1", composicion: compuesto.composicion },
              { articulo: e.articulo, cantidad: "1" },
            ],
          }),
        ),
        mal,
      );
      check(
        await confirmando(
          e.m,
          espejo({
            renglones: [
              { articulo: e.articulo, cantidad: "2", composicion: compuesto.composicion },
            ],
          }),
        ),
        mal,
      );
      check(
        await confirmando(
          e.m,
          espejo({
            renglones: [
              { articulo: e.articulo, cantidad: "2", composicion: compuesto.composicion },
              { articulo: e.articulo, cantidad: "1" },
              { articulo: (await articuloDeBase(dueno, e.m)).articulo, cantidad: "1" },
            ],
          }),
        ),
        mal,
      );
      check(
        await confirmando(
          e.m,
          espejo({
            renglones: [
              { articulo: e.articulo, cantidad: "2" },
              { articulo: e.articulo, cantidad: "1", composicion: compuesto.composicion },
            ],
          }),
        ),
        mal,
      );
      check(
        await confirmando(
          e.m,
          espejo({
            deposito: e.d2,
            renglones: [
              {
                articulo: e.articulo,
                cantidad: "2",
                deposito: e.d1,
                composicion: compuesto.composicion,
              },
              { articulo: e.articulo, cantidad: "1", deposito: e.d1 },
            ],
          }),
        ),
        mal,
      );
      expect(await existencia(e)).toBe("-3.0000");
      // El exacto pasa y deja el saldo como antes.
      await cargar(e.m, espejo({}));
      expect(await existencia(e)).toBe("0.0000");
    });

    it("se anula también una transferencia (con sus dos depósitos) y un ajuste", async () => {
      const e = await escenario();
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "8"));
      const ida = transferencia(e.m, e.d1, e.d2, e.articulo, "5", { id: randomUUID() });
      const idIda = await cargar(e.m, ida);
      expect([await existencia(e, e.d1), await existencia(e, e.d2)]).toEqual(["3.0000", "5.0000"]);
      await cargar(e.m, espejoDe(e.m, { ...ida, id: idIda }));
      expect([await existencia(e, e.d1), await existencia(e, e.d2)]).toEqual(["8.0000", "0.0000"]);
      const ajuste: MovimientoDePrueba = {
        id: randomUUID(),
        clase: "AJUSTE",
        motivo: "CORRECCION",
        deposito: e.d1,
        persona: e.m.persona,
        detalle: "Se contó mal",
        renglones: [{ articulo: e.articulo, cantidad: "-3" }],
      };
      const idAjuste = await cargar(e.m, ajuste);
      await cargar(e.m, espejoDe(e.m, { ...ajuste, id: idAjuste }));
      expect(await existencia(e, e.d1)).toBe("8.0000");
    });
  });

  // ---- el control de existencia negativa -----------------------------------------------------------------------------------

  describe("control de existencia negativa (`stock.existencia_negativa`)", () => {
    it("sin nivel guardado rige PERMITIR: la salida deja la existencia en negativo", async () => {
      const e = await escenario();
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "1"));
      await cargar(e.m, salida(e.m, e.d1, e.articulo, "3"));
      expect(await existencia(e)).toBe("-2.0000");
      await dueno.query(
        `insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, null, 'stock.existencia_negativa', 'PERMITIR')`,
        [e.m.empresa],
      );
      await cargar(e.m, salida(e.m, e.d1, e.articulo, "1"));
      expect(await existencia(e)).toBe("-3.0000");
    });

    it("BLOQUEAR rechaza la salida que deja la existencia en negativo (cero sí), también cuando ya estaba en negativo, y no cambia el saldo", async () => {
      const e = await escenario();
      await nivelDeBase(dueno, e.m.empresa, "BLOQUEAR");
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "2"));
      const bloqueada = "stock_existencia_negativa_bloqueada";
      check(await intentar(e.m, salida(e.m, e.d1, e.articulo, "3")), bloqueada);
      check(
        await intentar(
          e.m,
          salida(e.m, e.d1, e.articulo, "3", {
            motivo: "VENTA",
            origen: { tipo: "EJEMPLAR_DE_TICKET", id: randomUUID() },
            fechaDeNegocio: "2026-11-09",
          }),
        ),
        bloqueada,
      );
      // Confirmar no cambia nada: aunque venga marcado como confirmado, BLOQUEAR no se confirma.
      check(
        await intentar(e.m, {
          ...salida(e.m, e.d1, e.articulo, "3"),
          renglones: [{ articulo: e.articulo, cantidad: "-3", confirmoNegativo: true }],
        }),
        bloqueada,
      );
      expect(await existencia(e)).toBe("2.0000");
      // Hasta cero se puede.
      await cargar(e.m, salida(e.m, e.d1, e.articulo, "2"));
      expect(await existencia(e)).toBe("0.0000");
      check(await intentar(e.m, salida(e.m, e.d1, e.articulo, "0.0001")), bloqueada);
      // Un artículo que nunca tuvo saldo tampoco puede salir.
      const nuevo = await articuloDeBase(dueno, e.m);
      check(await intentar(e.m, salida(e.m, e.d1, nuevo.articulo, "1")), bloqueada);
    });

    it("BLOQUEAR no frena entradas, ajustes, ajustes por conteo ni anulaciones, ni la pata de destino de una transferencia; sí su origen", async () => {
      const e = await escenario();
      await nivelDeBase(dueno, e.m.empresa, "BLOQUEAR");
      const original = entrada(e.m, e.d1, e.articulo, "5");
      const id = await cargar(e.m, original);
      // La anulación de una entrada que ya se vendió deja la existencia en negativo: es lo que realmente salió, no se bloquea.
      await cargar(e.m, salida(e.m, e.d1, e.articulo, "4"));
      await cargar(e.m, espejoDe(e.m, { ...original, id }));
      expect(await existencia(e)).toBe("-4.0000");
      // Un ajuste que resta tampoco.
      await cargar(e.m, {
        clase: "AJUSTE",
        motivo: "CORRECCION",
        deposito: e.d1,
        persona: e.m.persona,
        detalle: "Faltaba",
        renglones: [{ articulo: e.articulo, cantidad: "-1" }],
      });
      expect(await existencia(e)).toBe("-5.0000");
      // La transferencia: el origen (resta) se controla; el destino (suma) no.
      check(
        await intentar(e.m, transferencia(e.m, e.d1, e.d2, e.articulo, "1")),
        "stock_existencia_negativa_bloqueada",
      );
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "10"));
      await cargar(e.m, transferencia(e.m, e.d1, e.d2, e.articulo, "5"));
      expect(await existencia(e, e.d2)).toBe("5.0000");
      expect(await existencia(e, e.d1)).toBe("0.0000");
      // Un ajuste por conteo que encuentra menos se aplica aun con BLOQUEAR.
      const conteo = randomUUID();
      await enApp(e.m, async (s, ex) => {
        acepta(
          await ex(
            `insert into conteo_fisico (id, empresa_id, deposito_id, abierto_por, abierto_en) values ($1, $2, $3, $4, now())`,
            [conteo, e.m.empresa, e.d2, e.m.persona],
          ),
        );
        acepta(
          await ex(
            `insert into conteo_registro (id, empresa_id, conteo_id, articulo_id, cantidad_contada, registrado_por, registrado_en) values ($1, $2, $3, $4, 0, $5, now())`,
            [randomUUID(), e.m.empresa, conteo, e.articulo, e.m.persona],
          ),
        );
        acepta(
          await ex(
            `update conteo_fisico set estado = 'APLICADO', resuelto_por = $2, resuelto_en = now() where id = $1`,
            [conteo, e.m.persona],
          ),
        );
        acepta(
          (
            await escribirMovimiento(ex, e.m.empresa, {
              clase: "AJUSTE_POR_CONTEO",
              motivo: "CONTEO",
              deposito: e.d2,
              persona: e.m.persona,
              conteo,
              accion: "conteos.aplicar",
              renglones: [{ articulo: e.articulo, cantidad: "-7" }],
            })
          ).resultado,
        );
        acepta(await s.confirmar());
      });
      expect(await existencia(e, e.d2)).toBe("-2.0000");
    });

    it("AVISAR rechaza la salida que deja la existencia en negativo salvo que el renglón traiga la confirmación", async () => {
      const e = await escenario();
      await nivelDeBase(dueno, e.m.empresa, "AVISAR");
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "1"));
      check(
        await intentar(e.m, salida(e.m, e.d1, e.articulo, "3")),
        "stock_existencia_negativa_sin_confirmar",
      );
      expect(await existencia(e)).toBe("1.0000");
      // Lo que no deja negativo no pide confirmación.
      await cargar(e.m, salida(e.m, e.d1, e.articulo, "1"));
      await cargar(e.m, {
        ...salida(e.m, e.d1, e.articulo, "3"),
        renglones: [{ articulo: e.articulo, cantidad: "-3", confirmoNegativo: true }],
      });
      expect(await existencia(e)).toBe("-3.0000");
      // El origen de una transferencia también pide confirmar.
      check(
        await intentar(e.m, transferencia(e.m, e.d1, e.d2, e.articulo, "1")),
        "stock_existencia_negativa_sin_confirmar",
      );
      await cargar(e.m, {
        ...transferencia(e.m, e.d1, e.d2, e.articulo, "1"),
        renglones: [
          { articulo: e.articulo, cantidad: "-1", deposito: e.d1, confirmoNegativo: true },
          { articulo: e.articulo, cantidad: "1", deposito: e.d2 },
        ],
      });
      expect(await existencia(e, e.d1)).toBe("-4.0000");
    });

    it("la sucursal puede endurecer el nivel de la empresa y no aflojarlo; el de otra empresa no cuenta", async () => {
      const bloqueada = "stock_existencia_negativa_bloqueada";
      // Un nivel de otra empresa no se aplica.
      const e = await escenario();
      const otra = await escenario();
      await nivelDeBase(dueno, otra.m.empresa, "BLOQUEAR");
      await cargar(e.m, salida(e.m, e.d1, e.articulo, "1"));
      expect(await existencia(e)).toBe("-1.0000");
      // La empresa permite y la sucursal bloquea.
      const f = await escenario();
      await nivelDeBase(dueno, f.m.empresa, "PERMITIR");
      await nivelDeBase(dueno, f.m.empresa, "BLOQUEAR", f.m.sucursal);
      check(await intentar(f.m, salida(f.m, f.d1, f.articulo, "1")), bloqueada);
      // La empresa bloquea y la sucursal permite: rige el más exigente.
      const g = await escenario();
      await nivelDeBase(dueno, g.m.empresa, "BLOQUEAR");
      await nivelDeBase(dueno, g.m.empresa, "PERMITIR", g.m.sucursal);
      check(await intentar(g.m, salida(g.m, g.d1, g.articulo, "1")), bloqueada);
      // La sucursal que endurece solo afecta a sus depósitos: otra sucursal sigue con el de la empresa (PERMITIR).
      const h = await escenario();
      const otraSucursal = await sucursalDeBase(dueno, h.m.empresa);
      const lejano = await depositoDeBase(dueno, h.m, { sucursal: otraSucursal });
      await nivelDeBase(dueno, h.m.empresa, "BLOQUEAR", h.m.sucursal);
      await cargar(h.m, salida(h.m, lejano, h.articulo, "1"));
      expect(await existencia(h, lejano)).toBe("-1.0000");
      check(await intentar(h.m, salida(h.m, h.d1, h.articulo, "1")), bloqueada);
    });
  });

  // ---- el conteo físico ----------------------------------------------------------------------------------------------------

  describe("conteo físico", () => {
    const abrir = (e: Escenario, deposito: string, id: string = randomUUID()) => ({
      id,
      sql: `insert into conteo_fisico (id, empresa_id, deposito_id, abierto_por, abierto_en) values ($1, $2, $3, $4, now())`,
      parametros: [id, e.m.empresa, deposito, e.m.persona],
    });

    it("un solo conteo abierto por depósito (se puede abrir otro cuando se cancela o aplica el anterior)", async () => {
      const e = await escenario();
      const primero = abrir(e, e.d1);
      await enApp(e.m, async (s, ex) => {
        acepta(await ex(primero.sql, primero.parametros));
        acepta(await s.confirmar());
      });
      await enApp(e.m, async (_s, ex) => {
        const segundo = abrir(e, e.d1);
        clave(await ex(segundo.sql, segundo.parametros), "conteo_fisico_abierto_uk");
        const otroDeposito = abrir(e, e.d2);
        acepta(await ex(otroDeposito.sql, otroDeposito.parametros));
        // Cancelar exige el motivo, y solo el de la cancelación.
        check(
          await ex(
            "update conteo_fisico set estado = 'CANCELADO', resuelto_por = $2, resuelto_en = now() where id = $1",
            [primero.id, e.m.persona],
          ),
          "conteo_fisico_cancelacion_ck",
        );
        check(
          await ex(
            "update conteo_fisico set estado = 'CANCELADO', resuelto_por = $2, resuelto_en = now(), motivo = '<b>x</b>' where id = $1",
            [primero.id, e.m.persona],
          ),
          "conteo_fisico_motivo_ck",
        );
        acepta(
          await ex(
            "update conteo_fisico set estado = 'CANCELADO', resuelto_por = $2, resuelto_en = now(), motivo = 'Se contó en otro horario' where id = $1",
            [primero.id, e.m.persona],
          ),
        );
        const tercero = abrir(e, e.d1);
        acepta(await ex(tercero.sql, tercero.parametros));
      });
    });

    it("`existencia_al_registrar` la fija la base (cero si el artículo nunca tuvo saldo), el último registro por artículo manda por `orden`, y solo en un conteo abierto", async () => {
      const e = await escenario();
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "6"));
      const otro = await articuloDeBase(dueno, e.m);
      const conteo = abrir(e, e.d1);
      const registrar = (
        ex: Ejecutor,
        articulo: string,
        contada: string,
        id: string = randomUUID(),
      ) =>
        ex(
          `insert into conteo_registro (id, empresa_id, conteo_id, articulo_id, cantidad_contada, registrado_por, registrado_en)
           values ($1, $2, $3, $4, $5, $6, now())`,
          [id, e.m.empresa, conteo.id, articulo, contada, e.m.persona],
        );
      await enApp(e.m, async (s, ex) => {
        acepta(await ex(conteo.sql, conteo.parametros));
        acepta(await registrar(ex, e.articulo, "5"));
        acepta(await registrar(ex, otro.articulo, "2"));
        acepta(await s.confirmar());
      });
      // Una venta después de contar no toca lo registrado; recontar es un registro nuevo.
      await cargar(e.m, salida(e.m, e.d1, e.articulo, "1"));
      const idRecuento = randomUUID();
      await enApp(e.m, async (s, ex) => {
        acepta(await registrar(ex, e.articulo, "4", idRecuento));
        acepta(await s.confirmar());
      });
      const { rows } = await dueno.query<{
        articulo_id: string;
        cantidad_contada: string;
        existencia_al_registrar: string;
      }>(
        `select articulo_id, cantidad_contada::text, existencia_al_registrar::text from conteo_registro where conteo_id = $1 order by orden`,
        [conteo.id],
      );
      expect(rows).toEqual([
        { articulo_id: e.articulo, cantidad_contada: "5.0000", existencia_al_registrar: "6.0000" },
        {
          articulo_id: otro.articulo,
          cantidad_contada: "2.0000",
          existencia_al_registrar: "0.0000",
        },
        { articulo_id: e.articulo, cantidad_contada: "4.0000", existencia_al_registrar: "5.0000" },
      ]);
      await enApp(e.m, async (_s, ex) => {
        // El mismo `id` de registro no se repite (idempotencia del reintento); la existencia no la manda la aplicación.
        clave(await registrar(ex, e.articulo, "4", idRecuento), "conteo_registro_pkey");
        denegado(
          await ex(
            `insert into conteo_registro (id, empresa_id, conteo_id, articulo_id, cantidad_contada, existencia_al_registrar, registrado_por, registrado_en)
             values ($1, $2, $3, $4, 1, 99, $5, now())`,
            [randomUUID(), e.m.empresa, conteo.id, e.articulo, e.m.persona],
          ),
        );
        check(await registrar(ex, e.articulo, "-1"), "conteo_registro_cantidad_ck");
        // Cerrado el conteo no se registra más.
        acepta(
          await ex(
            "update conteo_fisico set estado = 'APLICADO', resuelto_por = $2, resuelto_en = now() where id = $1",
            [conteo.id, e.m.persona],
          ),
        );
        check(await registrar(ex, e.articulo, "3"), "conteo_registro_conteo_cerrado");
      });
    });

    it("no se aplica vacío ni se resuelve dos veces; los registros no cambian el depósito ni quién abrió el conteo", async () => {
      const e = await escenario();
      const conteo = abrir(e, e.d1);
      await enApp(e.m, async (s, ex) => {
        acepta(await ex(conteo.sql, conteo.parametros));
        check(
          await ex(
            "update conteo_fisico set estado = 'APLICADO', resuelto_por = $2, resuelto_en = now() where id = $1",
            [conteo.id, e.m.persona],
          ),
          "conteo_fisico_sin_registros",
        );
        // La aplicación ni tiene el privilegio de cambiar el depósito del conteo.
        denegado(
          await ex("update conteo_fisico set deposito_id = $2 where id = $1", [conteo.id, e.d2]),
        );
        acepta(await s.confirmar());
      });
      await enApp(e.m, async (_s, ex) => {
        acepta(
          await ex(
            "update conteo_fisico set estado = 'CANCELADO', resuelto_por = $2, resuelto_en = now(), motivo = 'Prueba' where id = $1",
            [conteo.id, e.m.persona],
          ),
        );
        // Después de resuelto no cambia más.
        check(
          await ex(
            "update conteo_fisico set estado = 'ABIERTO', resuelto_por = null, resuelto_en = null, motivo = null where id = $1",
            [conteo.id],
          ),
          "conteo_fisico_transicion_invalida",
        );
        check(
          await ex(
            "update conteo_fisico set estado = 'APLICADO', resuelto_por = $2, resuelto_en = now(), motivo = null where id = $1",
            [conteo.id, e.m.persona],
          ),
          "conteo_fisico_transicion_invalida",
        );
      });
      await sinConfirmar(dueno, async () => {
        check(
          await intentoDelDueno(dueno, "update conteo_fisico set deposito_id = $2 where id = $1", [
            conteo.id,
            e.d2,
          ]),
          "conteo_fisico_inmutable",
        );
      });
    });
  });

  // ---- composiciones -------------------------------------------------------------------------------------------------------

  /** Una composición (versión `numero`) de un producto vendible con un componente, armada en una transacción y confirmada. */
  async function cargarComposicion(
    e: Escenario,
    datos: Readonly<{
      numero: number;
      producto?: string;
      componentes?: ReadonlyArray<{ articulo: string; cantidad: string }>;
    }>,
  ): Promise<{ producto: string; composicion: string }> {
    const producto =
      datos.producto ?? (await productoDeBase(dueno, e.m.empresa, { clase: "VENDIBLE" }));
    const composicion = randomUUID();
    await enApp(e.m, async (s, ex) => {
      acepta(
        await ex(
          `insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) values ($1, $2, $3, $4, 1, $5, now())`,
          [composicion, e.m.empresa, producto, datos.numero, e.m.persona],
        ),
      );
      let n = 0;
      for (const c of datos.componentes ?? [{ articulo: e.articulo, cantidad: "2" }]) {
        n += 1;
        acepta(
          await ex(
            `insert into componente_de_composicion (empresa_id, composicion_id, numero, articulo_id, cantidad, unidad_id, dimension)
             values ($1, $2, $3, $4, $5, 'UNIDAD', 'CONTEO')`,
            [e.m.empresa, composicion, n, c.articulo, c.cantidad],
          ),
        );
      }
      acepta(await s.confirmar());
    });
    return { producto, composicion };
  }

  describe("composiciones", () => {
    it("versiones de un producto vendible con número consecutivo (dos versiones simultáneas chocan en la única), vale la de mayor número y una versión vacía la retira", async () => {
      const e = await escenario();
      const v1 = await cargarComposicion(e, { numero: 1 });
      await enApp(e.m, async (_s, ex) => {
        const insertar = (numero: number, producto: string) =>
          ex(
            `insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) values ($1, $2, $3, $4, 10, $5, now())`,
            [randomUUID(), e.m.empresa, producto, numero, e.m.persona],
          );
        check(await insertar(3, v1.producto), "composicion_numero_salteado");
        check(await insertar(1, v1.producto), "composicion_numero_salteado");
        check(
          await insertar(2, await productoDeBase(dueno, e.m.empresa, { clase: "ELABORADO" })),
          "composicion_producto_no_vendible",
        );
        check(
          await insertar(1, await productoDeBase(dueno, e.m.empresa, { clase: "REVENTA" })),
          "composicion_producto_no_vendible",
        );
        check(
          await ex(
            `insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) values ($1, $2, $3, 2, 0, $4, now())`,
            [randomUUID(), e.m.empresa, v1.producto, e.m.persona],
          ),
          "composicion_rinde_ck",
        );
        acepta(await insertar(2, v1.producto)); // versión vacía: retira la receta
      });
      // Dos sesiones a la vez con el mismo número: una gana, la otra choca en la única (`COMPOSICION_DESACTUALIZADA`).
      const s1 = await SesionDePrueba.abrir(
        b(),
        "pedernal_app",
        comoEmpresa(empresaId(e.m.empresa), personaId(e.m.persona)),
      );
      const s2 = await SesionDePrueba.abrir(
        b(),
        "pedernal_app",
        comoEmpresa(empresaId(e.m.empresa), personaId(e.m.persona)),
      );
      try {
        const otra = await cargarComposicion(e, { numero: 1 });
        const mismo = (s: SesionDePrueba) =>
          s.directo(
            `insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) values ($1, $2, $3, 2, 1, $4, now())`,
            [randomUUID(), e.m.empresa, otra.producto, e.m.persona],
          );
        acepta(await mismo(s1));
        const segunda = mismo(s2);
        expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
        acepta(await s1.confirmar());
        clave(await segunda, "composicion_numero_uk");
      } finally {
        await s1.cerrar();
        await s2.cerrar();
      }
    });

    it("los componentes solo entran con su versión, con artículos activos, de la dimensión del artículo, sin repetir y sin compuesto", async () => {
      const e = await escenario();
      const otro = await articuloDeBase(dueno, e.m);
      const inactivo = await articuloDeBase(dueno, e.m, { activo: false });
      const kilos = await articuloDeBase(dueno, e.m, {
        unidadBase: "KILOGRAMO",
        dimension: "MASA",
        clase: "INSUMO",
      });
      const v1 = await cargarComposicion(e, { numero: 1 });
      const producto = await productoDeBase(dueno, e.m.empresa, { clase: "VENDIBLE" });
      await enApp(e.m, async (_s, ex) => {
        // Una versión que ya se confirmó no gana componentes.
        check(
          await ex(
            `insert into componente_de_composicion (empresa_id, composicion_id, numero, articulo_id, cantidad, unidad_id, dimension) values ($1, $2, 9, $3, 1, 'UNIDAD', 'CONTEO')`,
            [e.m.empresa, v1.composicion, otro.articulo],
          ),
          "componente_version_confirmada",
        );
        const nueva = randomUUID();
        acepta(
          await ex(
            `insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) values ($1, $2, $3, 1, 1, $4, now())`,
            [nueva, e.m.empresa, producto, e.m.persona],
          ),
        );
        const componente = (
          numero: number,
          articulo: string | null,
          cantidad: string,
          unidad: string,
          dimension: string,
          extra = "",
        ) =>
          ex(
            `insert into componente_de_composicion (empresa_id, composicion_id, numero, articulo_id, cantidad, unidad_id, dimension${extra === "" ? "" : ", compuesto_id"})
             values ($1, $2, $3, $4, $5, $6, $7${extra === "" ? "" : ", $8"})`,
            [
              e.m.empresa,
              nueva,
              numero,
              articulo,
              cantidad,
              unidad,
              dimension,
              ...(extra === "" ? [] : [extra]),
            ],
          );
        acepta(await componente(1, otro.articulo, "1.5", "UNIDAD", "CONTEO"));
        check(
          await componente(2, inactivo.articulo, "1", "UNIDAD", "CONTEO"),
          "componente_articulo_inactivo",
        );
        // La unidad es de la dimensión del artículo (un artículo por unidad no se descuenta en kilos).
        referencia(
          await componente(2, e.articulo, "1", "KILOGRAMO", "MASA"),
          "componente_articulo_fkey",
        );
        referencia(
          await componente(2, kilos.articulo, "1", "UNIDAD", "CONTEO"),
          "componente_articulo_fkey",
        );
        acepta(await componente(2, kilos.articulo, "500", "GRAMO", "MASA"));
        check(await componente(3, e.articulo, "0", "UNIDAD", "CONTEO"), "componente_cantidad_ck");
        // Una unidad que no es de la dimensión declarada.
        referencia(
          await componente(3, e.articulo, "1", "KILOGRAMO", "CONTEO"),
          "componente_unidad_fkey",
        );
        // Un artículo no se repite en la versión.
        clave(
          await componente(3, otro.articulo, "1", "UNIDAD", "CONTEO"),
          "componente_articulo_uk",
        );
        // El destino es un artículo; el compuesto (subcomposición) lo abre E6.
        check(await componente(3, null, "1", "UNIDAD", "CONTEO"), "componente_destino_ck");
        // Sin permiso sobre `compuesto_id` la aplicación ni lo nombra.
        denegado(await componente(3, e.articulo, "1", "UNIDAD", "CONTEO", producto));
      });
      await sinConfirmar(dueno, async () => {
        const nueva = randomUUID();
        acepta(
          await intentoDelDueno(
            dueno,
            `insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) values ($1, $2, $3, 1, 1, $4, now())`,
            [nueva, e.m.empresa, producto, e.m.persona],
          ),
        );
        check(
          await intentoDelDueno(
            dueno,
            `insert into componente_de_composicion (empresa_id, composicion_id, numero, compuesto_id, cantidad, unidad_id, dimension) values ($1, $2, 1, $3, 1, 'UNIDAD', 'CONTEO')`,
            [e.m.empresa, nueva, producto],
          ),
          "componente_compuesto_cerrado_ck",
        );
      });
    });

    it("un artículo de la composición vigente no se deja de controlar; sí cuando una versión nueva lo saca o la receta se retira", async () => {
      const e = await escenario();
      const v1 = await cargarComposicion(e, { numero: 1 });
      const desactivar = (): Promise<Intento> =>
        enApp(e.m, async (_s, ex) =>
          ex("update articulo_de_stock set activo = false where id = $1", [e.articulo]),
        );
      check(await desactivar(), "articulo_de_stock_en_composicion_activa");
      // Retirar la receta (versión vacía) libera el artículo.
      await enApp(e.m, async (s, ex) => {
        acepta(
          await ex(
            `insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) values ($1, $2, $3, 2, 1, $4, now())`,
            [randomUUID(), e.m.empresa, v1.producto, e.m.persona],
          ),
        );
        acepta(await s.confirmar());
      });
      acepta(await desactivar());
      // Un artículo que ya no está activo no entra en una versión nueva.
      const otroProducto = await productoDeBase(dueno, e.m.empresa, { clase: "VENDIBLE" });
      await enApp(e.m, async (_s, ex) => {
        const nueva = randomUUID();
        acepta(
          await ex(
            `insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) values ($1, $2, $3, 1, 1, $4, now())`,
            [nueva, e.m.empresa, otroProducto, e.m.persona],
          ),
        );
        // `desactivar` revirtió su transacción: el artículo sigue activo acá.
        acepta(
          await ex(
            `insert into componente_de_composicion (empresa_id, composicion_id, numero, articulo_id, cantidad, unidad_id, dimension) values ($1, $2, 1, $3, 1, 'UNIDAD', 'CONTEO')`,
            [e.m.empresa, nueva, e.articulo],
          ),
        );
      });
    });

    it("un renglón del libro puede citar la versión de composición de la que salió, y solo una de su empresa", async () => {
      const e = await escenario();
      const otra = await escenario();
      const compuesto = await cargarComposicion(e, { numero: 1 });
      const ajena = await cargarComposicion(otra, { numero: 1 });
      const id = await cargar(e.m, {
        ...salida(e.m, e.d1, e.articulo, "2"),
        renglones: [{ articulo: e.articulo, cantidad: "-2", composicion: compuesto.composicion }],
      });
      expect(
        (
          await un<{ composicion_id: string }>(
            "select composicion_id from renglon_de_movimiento where movimiento_id = $1",
            [id],
          )
        ).composicion_id,
      ).toBe(compuesto.composicion);
      referencia(
        await intentar(e.m, {
          ...salida(e.m, e.d1, e.articulo, "2"),
          renglones: [{ articulo: e.articulo, cantidad: "-2", composicion: ajena.composicion }],
        }),
        "renglon_de_movimiento_composicion_fkey",
      );
    });
  });

  // ---- la concurrencia sobre el saldo --------------------------------------------------------------------------------------

  describe("concurrencia sobre el saldo (UPDATE atómico del renglón)", () => {
    const sesion = (m: Mundo) =>
      SesionDePrueba.abrir(
        b(),
        "pedernal_app",
        comoEmpresa(empresaId(m.empresa), personaId(m.persona)),
      );

    /** Cabecera y renglones sin savepoint, como los manda la aplicación; devuelve el resultado de la última sentencia (o del primer error). */
    const escribir = async (
      s: SesionDePrueba,
      m: Mundo,
      mov: MovimientoDePrueba,
    ): Promise<Intento> =>
      (await escribirMovimiento((t, p) => s.directo(t, p), m.empresa, mov)).resultado;

    it("dos salidas del último ítem a la vez con BLOQUEAR: una pasa, la otra espera el saldo y se rechaza; la existencia queda en 0, nunca en −1", async () => {
      const e = await escenario();
      await nivelDeBase(dueno, e.m.empresa, "BLOQUEAR");
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "1"));
      const s1 = await sesion(e.m);
      const s2 = await sesion(e.m);
      try {
        acepta(await escribir(s1, e.m, salida(e.m, e.d1, e.articulo, "1")));
        const segunda = escribir(s2, e.m, salida(e.m, e.d1, e.articulo, "1"));
        expect(await esperarBloqueo(dueno, s2.pid), "la segunda espera la fila del saldo").toBe(
          true,
        );
        acepta(await s1.confirmar());
        check(await segunda, "stock_existencia_negativa_bloqueada");
      } finally {
        await s1.cerrar();
        await s2.cerrar();
      }
      expect(await existencia(e)).toBe("0.0000");
      const { n } = await un<{ n: number }>(
        "select count(*)::int as n from movimiento_de_stock where empresa_id = $1 and clase = 'SALIDA'",
        [e.m.empresa],
      );
      expect(n).toBe(1);
    });

    it("lo mismo con PERMITIR: las dos pasan y la existencia queda en −1 exacto; con AVISAR sin confirmar, la segunda pide confirmación", async () => {
      const e = await escenario();
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "1"));
      const doble = async (): Promise<[Intento, Intento]> => {
        const s1 = await sesion(e.m);
        const s2 = await sesion(e.m);
        try {
          const primera = await escribir(s1, e.m, salida(e.m, e.d1, e.articulo, "1"));
          const segunda = escribir(s2, e.m, salida(e.m, e.d1, e.articulo, "1"));
          expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
          await s1.confirmar();
          const resultado = await segunda;
          if (resultado.ok) acepta(await s2.confirmar());
          return [primera, resultado];
        } finally {
          await s1.cerrar();
          await s2.cerrar();
        }
      };
      const [p1, p2] = await doble();
      acepta(p1);
      acepta(p2);
      expect(await existencia(e)).toBe("-1.0000");
      // AVISAR: con la existencia ya negativa, otra salida sin confirmar se rechaza.
      await nivelDeBase(dueno, e.m.empresa, "AVISAR");
      check(
        await intentar(e.m, salida(e.m, e.d1, e.articulo, "1")),
        "stock_existencia_negativa_sin_confirmar",
      );
    });

    it("dos transferencias cruzadas (A→B y B→A) con los renglones en orden canónico terminan sin deadlock y no cambian el total", async () => {
      const e = await escenario();
      await cargar(e.m, entrada(e.m, e.d1, e.articulo, "10"));
      await cargar(e.m, entrada(e.m, e.d2, e.articulo, "10"));
      const ordenar = (mov: MovimientoDePrueba): MovimientoDePrueba => ({
        ...mov,
        renglones: [...mov.renglones].sort((x, y) =>
          (x.deposito ?? "").localeCompare(y.deposito ?? ""),
        ),
      });
      const s1 = await sesion(e.m);
      const s2 = await sesion(e.m);
      try {
        acepta(await escribir(s1, e.m, ordenar(transferencia(e.m, e.d1, e.d2, e.articulo, "3"))));
        const segunda = escribir(s2, e.m, ordenar(transferencia(e.m, e.d2, e.d1, e.articulo, "4")));
        expect(await esperarBloqueo(dueno, s2.pid), "la segunda espera el primer saldo").toBe(true);
        acepta(await s1.confirmar());
        acepta(await segunda);
        acepta(await s2.confirmar());
      } finally {
        await s1.cerrar();
        await s2.cerrar();
      }
      expect(Number(await existencia(e, e.d1)) + Number(await existencia(e, e.d2))).toBe(20);
      expect(await existencia(e, e.d1)).toBe("11.0000");
      expect(await existencia(e, e.d2)).toBe("9.0000");
    });

    it("desactivar un depósito mientras otra sesión le entra mercadería: espera, y después ve la existencia y se rechaza; el depósito no queda inactivo con existencia", async () => {
      const e = await escenario();
      const s1 = await sesion(e.m);
      const s2 = await sesion(e.m);
      try {
        acepta(await escribir(s1, e.m, entrada(e.m, e.d2, e.articulo, "2")));
        const desactivar = s2.directo("update deposito set activo = false where id = $1", [e.d2]);
        expect(await esperarBloqueo(dueno, s2.pid), "desactivar espera al movimiento").toBe(true);
        acepta(await s1.confirmar());
        check(await desactivar, "deposito_con_existencia");
      } finally {
        await s1.cerrar();
        await s2.cerrar();
      }
      expect(
        (await un<{ activo: boolean }>("select activo from deposito where id = $1", [e.d2])).activo,
      ).toBe(true);
      expect(await existencia(e, e.d2)).toBe("2.0000");
    });

    it("dos conteos simultáneos en el mismo depósito: gana uno; dos aplicaciones del mismo conteo: el segundo UPDATE no encuentra el estado abierto", async () => {
      const e = await escenario();
      const s1 = await sesion(e.m);
      const s2 = await sesion(e.m);
      const abrir = (s: SesionDePrueba) =>
        s.directo(
          `insert into conteo_fisico (id, empresa_id, deposito_id, abierto_por, abierto_en) values ($1, $2, $3, $4, now())`,
          [randomUUID(), e.m.empresa, e.d1, e.m.persona],
        );
      try {
        acepta(await abrir(s1));
        const segundo = abrir(s2);
        expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
        acepta(await s1.confirmar());
        clave(await segundo, "conteo_fisico_abierto_uk");
      } finally {
        await s1.cerrar();
        await s2.cerrar();
      }
      const conteo = (
        await un<{ id: string }>("select id from conteo_fisico where deposito_id = $1", [e.d1])
      ).id;
      await dueno.query(
        `insert into conteo_registro (id, empresa_id, conteo_id, articulo_id, cantidad_contada, registrado_por, registrado_en) values ($1, $2, $3, $4, 0, $5, now())`,
        [randomUUID(), e.m.empresa, conteo, e.articulo, e.m.persona],
      );
      const a1 = await sesion(e.m);
      const a2 = await sesion(e.m);
      try {
        const aplicar = (s: SesionDePrueba) =>
          s.directo(
            "update conteo_fisico set estado = 'APLICADO', resuelto_por = $2, resuelto_en = now() where id = $1 and estado = 'ABIERTO'",
            [conteo, e.m.persona],
          );
        expect((await aplicar(a1)).ok && (await aplicar(a1))).toBeTruthy();
        const segunda = aplicar(a2);
        expect(await esperarBloqueo(dueno, a2.pid)).toBe(true);
        acepta(await a1.confirmar());
        const r = await segunda;
        expect(r.ok && r.filas, "la segunda no encuentra el conteo abierto").toBe(0);
      } finally {
        await a1.cerrar();
        await a2.cerrar();
      }
    });
  });

  // ---- la migración y su reversión -----------------------------------------------------------------------------------------

  describe("la migración y su reversión", () => {
    it("sobre una base sin stock sube, baja (deja el esquema como antes, también `producto`), sube de nuevo; con filas la reversión pide confirmar; y frena si `deposito` ya existe", async () => {
      const previa = await baseConMigraciones(b(), await migracionesPrevias());
      const conMia = await carpetaCon([...(await migracionesPrevias()), ARCHIVO]);
      try {
        await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
        const c = previa.cliente;
        const antes = await huellaDeCatalogo(c);
        const reversion = await textoDeLaReversion();
        const fila = async () =>
          (await c.query("select 1 from migracion where nombre = $1", [ARCHIVO])).rows.length;

        // Defensa: si alguien creó `deposito` a mano, frena sin cambiar nada.
        await c.query("create table deposito (x int)");
        await expect(aplicarMigraciones(previa.aparte.base.dueno, conMia)).rejects.toThrow(
          /la tabla deposito ya existe/,
        );
        await c.query("drop table deposito");
        expect(await fila()).toBe(0);
        expect(await huellaDeCatalogo(c)).toEqual(antes);

        // Sube, baja sin datos (no pide nada) y vuelve a subir.
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(await fila()).toBe(1);
        const conStock = await huellaDeCatalogo(c);
        expect(conStock).not.toEqual(antes);
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        expect(await fila()).toBe(0);
        const otraVez = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(otraVez.aplicadas).toEqual([ARCHIVO]);
        expect(await huellaDeCatalogo(c)).toEqual(conStock);

        // Con un depósito cargado: sin confirmar no borra nada.
        const mundo = await crearMundo(c);
        await depositoDeBase(c, mundo);
        await c.query("begin");
        await expect(c.query(reversion)).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(/avisar al dueño/) as string,
        });
        await c.query("rollback");
        expect((await c.query("select count(*)::int as n from deposito")).rows[0]).toEqual({
          n: 1,
        });
        expect(await fila()).toBe(1);
        // Confirmada: borra y deja el esquema como estaba; se puede repetir.
        await c.query(
          `begin; set local pedernal.confirmar_reversion = 'SI'; ${reversion}; commit;`,
        );
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);
      } finally {
        await rm(conMia, { recursive: true, force: true });
        await previa.cerrar();
      }
    });

    it("la reversión declara que es destructiva y que no se recupera, no usa CASCADE ni TRUNCATE y su único DELETE es el de su fila del registro", async () => {
      const texto = await textoDeLaReversion();
      const plano = texto.replace(/\n--\s*/g, " ");
      expect(plano).toMatch(/DESTRUCTIVA/);
      expect(plano).toMatch(/NO SE RECUPERA/);
      expect(plano).toMatch(/NO lo aplica el ejecutor de migraciones/);
      const codigo = texto.replace(/--.*$/gm, "");
      const borrados = codigo.match(/\bDELETE\b[^;]*;/gi) ?? [];
      expect(borrados).toHaveLength(1);
      expect(borrados[0]).toMatch(/^DELETE FROM public\.migracion WHERE nombre LIKE /i);
      expect(codigo).not.toMatch(/\b(TRUNCATE|CASCADE)\b/i);
    });
  });
});
