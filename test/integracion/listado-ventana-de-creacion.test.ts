import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { criteriosDeListado } from "../../src/modulos/fiscal/consultas/criterios-de-listado";
import { crearLecturasDeComprobantes, type FiscalDb } from "../../src/modulos/fiscal/publico";
import { empresaId, sucursalId } from "../../src/primitivas/identificadores/marca";
import { fechaCivilDesdeTexto } from "../../src/primitivas/tiempo/fecha-civil";
import { comoEmpresa } from "./entorno";
import {
  confirmarDueno,
  crearEscenario,
  datosDeComprobante,
  insertarComprobante,
  viaDueno,
  type Escenario,
} from "./facturacion-apoyo";
import { SesionDePrueba } from "./sesiones";

/**
 * La ventana de creación de la búsqueda de texto (`creadoDesde`, «Todo» con texto = últimos 12 meses): contra una base real, con el rol
 * real y RLS. Qué prueba: (1) los bordes, con el día de ARGENTINA (02:59:59Z es el día anterior, 03:00:00Z el mismo día), combinados con
 * la búsqueda por nombre o documento (qué encuentra la búsqueda NO cambia: solo se acota por creación); (2) que la cota entra como
 * CONDICIÓN DEL ÍNDICE de orden del listado (`comprobante_sucursal_listado_ix`), que es lo que hace que la búsqueda deje de leer toda
 * la historia (medido: 431-550 ms → 77-109 ms con 800.000 comprobantes en la sucursal). Si alguien la vuelve un filtro posterior, la
 * segunda prueba falla.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("listado: ventana de creación de la búsqueda de texto", () => {
  let dueno: pg.Client;
  let e: Escenario;
  const ids = new Map<string, string>();
  const fecha = (t: string) => {
    const r = fechaCivilDesdeTexto(t);
    if (!r.ok) throw new Error(t);
    return r.valor;
  };

  async function crear(clave: string, creadoEn: string, receptor: Record<string, unknown>) {
    const datos = datosDeComprobante(e, receptor);
    await dueno.query("begin");
    // El disparador se apaga antes de escribir nada: con eventos diferidos pendientes la base no deja alterar la tabla.
    await dueno.query("alter table comprobante disable trigger comprobante_cambio");
    const r = await insertarComprobante(viaDueno(dueno), datos);
    if (!r.ok) {
      await dueno.query("rollback");
      throw new Error(`no se pudo crear ${clave}: ${r.mensaje}`);
    }
    await dueno.query("update comprobante set creado_en = $2 where id = $1", [
      datos["id"],
      creadoEn,
    ]);
    await dueno.query("set constraints all immediate");
    await dueno.query("alter table comprobante enable trigger comprobante_cambio");
    const c = await confirmarDueno(dueno);
    if (!c.ok) throw new Error(`no se pudo confirmar ${clave}: ${c.mensaje}`);
    ids.set(clave, datos["id"] as string);
  }

  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: base!.dueno });
    await dueno.connect();
    e = await crearEscenario(dueno);
    const garcia = {
      receptor_nombre: "Ana García",
      receptor_documento_tipo: "DNI",
      receptor_documento_numero: "30111222",
    };
    // Argentina es UTC-3: el corte del 10 de octubre es 03:00:00Z.
    await crear("antes-del-corte", "2026-10-10T02:59:59.999999Z", garcia);
    await crear("en-el-corte", "2026-10-10T03:00:00.000000Z", garcia);
    await crear("despues", "2026-10-20T15:00:00.000000Z", garcia);
    await crear("otro-nombre", "2026-10-20T16:00:00.000000Z", {
      receptor_nombre: "Luis Pérez",
      receptor_documento_tipo: "DNI",
      receptor_documento_numero: "40999888",
    });
    await dueno.query("analyze comprobante");
  });
  afterAll(async () => {
    await dueno.end();
  });

  /** Corre la lectura REAL con el rol de la app y devuelve los ids que trajo y el SQL que mandó. */
  async function listar(pedido: Parameters<typeof criteriosDeListado>[0]) {
    const capturadas: { sql: string; parametros: unknown[] }[] = [];
    const pool = new pg.Pool({ connectionString: base!.app });
    const db = new Kysely<FiscalDb>({
      dialect: new PostgresDialect({ pool }),
      log: (ev) => {
        if (ev.level === "query") {
          capturadas.push({ sql: ev.query.sql, parametros: [...ev.query.parameters] });
        }
      },
    });
    const criterios = criteriosDeListado(pedido);
    if (!criterios.ok) throw new Error(criterios.error);
    const sesion = await SesionDePrueba.abrir(
      base!,
      "pedernal_app",
      comoEmpresa(empresaId(e.empresa)),
    );
    try {
      await crearLecturasDeComprobantes(db)
        .listar(empresaId(e.empresa), { ...criterios.valor, sucursalId: sucursalId(e.sucursal) })
        .catch(() => undefined);
      const q = capturadas[0] as { sql: string; parametros: unknown[] };
      // La misma sentencia, ahora sí con el contexto de la empresa (la RLS real filtra).
      const filas = await sesion.directo(q.sql, q.parametros);
      // Para ver QUÉ puede hacer el planificador con la cota: sin recorrer la tabla ni armar mapas de bits.
      await sesion.directo("set local enable_seqscan = off");
      await sesion.directo("set local enable_bitmapscan = off");
      const plan = await sesion.directo(`explain ${q.sql}`, q.parametros);
      if (!filas.ok || !plan.ok) throw new Error("falló la consulta de prueba");
      return {
        ids: filas.rows.map((r) => r["id"] as string).sort(),
        plan: plan.rows.map((r) => r["QUERY PLAN"] as string).join("\n"),
      };
    } finally {
      await sesion.deshacer();
      await db.destroy();
    }
  }
  const de = (...claves: string[]) => claves.map((c) => ids.get(c) as string).sort();

  it("el corte es el día de Argentina, inclusive: 02:59:59Z del 10 es el 9 (afuera), 03:00:00Z es el 10 (adentro)", async () => {
    expect((await listar({ texto: "García", creadoDesde: fecha("2026-10-10") })).ids).toEqual(
      de("en-el-corte", "despues"),
    );
    expect((await listar({ texto: "García", creadoDesde: fecha("2026-10-09") })).ids).toEqual(
      de("antes-del-corte", "en-el-corte", "despues"),
    );
    expect((await listar({ texto: "García", creadoDesde: fecha("2026-10-11") })).ids).toEqual(
      de("despues"),
    );
    expect((await listar({ texto: "García", creadoDesde: fecha("2026-10-21") })).ids).toEqual([]);
  });

  it("no cambia QUÉ encuentra la búsqueda: nombre o documento (por prefijo), dentro de la ventana; sin ventana, todo", async () => {
    const v = fecha("2026-10-10");
    expect((await listar({ texto: "pérez", creadoDesde: v })).ids).toEqual(de("otro-nombre"));
    expect((await listar({ texto: "4099", creadoDesde: v })).ids).toEqual(de("otro-nombre"));
    expect((await listar({ texto: "3011", creadoDesde: v })).ids).toEqual(
      de("en-el-corte", "despues"),
    );
    expect((await listar({ texto: "3011" })).ids).toEqual(
      de("antes-del-corte", "en-el-corte", "despues"),
    );
    expect((await listar({ creadoDesde: v })).ids).toEqual(
      de("en-el-corte", "despues", "otro-nombre"),
    );
  });

  it("la cota entra como condición del índice de orden del listado, no como filtro posterior", async () => {
    const { plan } = await listar({ texto: "García", creadoDesde: fecha("2026-10-10") });
    expect(plan).toMatch(
      /Index Scan using comprobante_sucursal_listado_ix[^\n]*\n\s*Index Cond: [^\n]*creado_en >= /,
    );
    // Sin la ventana, el mismo índice recorre toda la sucursal (la cota no está en la condición del índice).
    const sin = await listar({ texto: "García" });
    expect(sin.plan).not.toMatch(/Index Cond: [^\n]*creado_en >= /);
  });
});
