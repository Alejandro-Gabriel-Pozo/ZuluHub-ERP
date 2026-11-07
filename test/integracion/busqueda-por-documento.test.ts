import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { crearLecturasDeComprobantes, type FiscalDb } from "../../src/modulos/fiscal/publico";
import { criteriosDeListado } from "../../src/modulos/fiscal/consultas/criterios-de-listado";
import { empresaId, sucursalId } from "../../src/primitivas/identificadores/marca";
import { comoEmpresa } from "./entorno";
import { crearComprobante, crearEscenario } from "./facturacion-apoyo";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  carpetaCon,
  huellaDeCatalogo,
} from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";
import { SesionDePrueba } from "./sesiones";

/**
 * La migración 0025 (dueño, 2026-11-07, «Rendimiento B»): un índice para buscar por el comienzo del documento del receptor. Se prueba:
 * que es ADITIVA (ni una fila ni nada del catálogo cambia salvo ese índice), que se puede repetir (`IF NOT EXISTS`, que es lo que permite
 * armarlo antes a mano con `CONCURRENTLY`), que exige 0009/0016, que la reversión lo borra y se puede repetir; y, lo que importa, que la
 * consulta REAL del listado, con el rol real y RLS, usa el índice (rango explícito) y devuelve exactamente los comprobantes cuyo
 * documento empieza con lo buscado, también en los bordes del rango (`9`, `99`, `0`).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const SUFIJO = "busqueda_por_documento";
const INDICE = "comprobante_receptor_doc_pref_ix";
const archivoDe = async (carpeta: string, patron: RegExp): Promise<string> => {
  const encontrados = (await readdir(carpeta)).filter((n) => patron.test(n));
  if (encontrados.length !== 1) throw new Error(`debería haber uno, hay ${encontrados.length}`);
  return encontrados[0] as string;
};
const archivoDeLaMigracion = () =>
  archivoDe(CARPETA_DE_MIGRACIONES, new RegExp(`^\\d{4}_${SUFIJO}\\.sql$`));
const archivoDeLaReversion = () =>
  archivoDe(
    join(CARPETA_DE_MIGRACIONES, "reversiones"),
    new RegExp(`^\\d{4}_revertir_${SUFIJO}\\.sql$`),
  );
const migracionesPrevias = async (): Promise<string[]> => {
  const mia = await archivoDeLaMigracion();
  return (await readdir(CARPETA_DE_MIGRACIONES))
    .sort()
    .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < mia);
};
const texto = async (ruta: string[]) => readFile(join(CARPETA_DE_MIGRACIONES, ...ruta), "utf8");
const b = (): BaseDePruebas => base as BaseDePruebas;

describe.skipIf(base === null)("Búsqueda por documento: la migración 0025", () => {
  it("la cabecera declara lo que es (aditiva, reversión aparte, aviso de bloqueo) y el código solo crea el índice", async () => {
    const plano = await texto([await archivoDeLaMigracion()]);
    expect(plano).toMatch(/ADITIVA/);
    expect(plano).toMatch(/BLOQUEO/);
    expect(plano).toMatch(/CONCURRENTLY/);
    expect(plano).toContain(`reversiones/${await archivoDeLaReversion()}`);
    const codigo = plano
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(codigo).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(codigo).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/i);
    expect(codigo.match(/CREATE\s+INDEX/gi)).toHaveLength(1);
    // El índice EMPIEZA por la empresa (aislamiento) y por la sucursal (todo listado filtra por las dos).
    expect(codigo).toMatch(
      /\(\s*empresa_id\s*,\s*sucursal_id\s*,\s*receptor_documento_numero\s+text_pattern_ops\s*\)/,
    );
  });

  it("sobre una base con datos no cambia ni una fila; solo agrega el índice; se puede repetir; y exige 0009 y 0016", async () => {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
    const conMia = await carpetaCon([
      ...(await migracionesPrevias()),
      await archivoDeLaMigracion(),
    ]);
    try {
      const c = previa.cliente;
      const e = await crearEscenario(c);
      await crearComprobante(c, e, {
        receptor_documento_tipo: "DNI",
        receptor_documento_numero: "12345678",
        receptor_nombre: "Jane Doe",
      });
      await crearComprobante(c, e, {});
      const huella = async () =>
        (
          await c.query<{ id: string; h: string }>(
            "select id::text, md5(to_jsonb(x)::text) as h from comprobante x order by 1",
          )
        ).rows;
      const [antes, catalogoAntes] = [await huella(), await huellaDeCatalogo(c)];

      const r = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      expect(r.aplicadas).toEqual([await archivoDeLaMigracion()]);
      expect(await huella()).toEqual(antes);
      const despues = await huellaDeCatalogo(c);
      expect(
        Object.keys(despues).filter(
          (k) => JSON.stringify(despues[k]) !== JSON.stringify(catalogoAntes[k]),
        ),
      ).toEqual(["indices"]);
      const nuevos = (despues["indices"] ?? []).filter(
        (x) => !(catalogoAntes["indices"] ?? []).includes(x),
      );
      expect(nuevos).toHaveLength(1);
      expect(nuevos[0]).toContain(INDICE);
      expect(nuevos[0]).toMatch(
        /\(empresa_id, sucursal_id, receptor_documento_numero text_pattern_ops\)/,
      );
      expect(nuevos[0]).toMatch(/WHERE \(receptor_documento_numero IS NOT NULL\)/);

      // Repetir el código no falla ni cambia nada (es lo que permite armar el índice antes, a mano, con CONCURRENTLY).
      const sql = await texto([await archivoDeLaMigracion()]);
      await c.query(sql);
      expect(await huellaDeCatalogo(c)).toEqual(despues);

      // Sin la tabla de comprobantes (0009) o sin la sucursal del comprobante (0016) se niega, con un mensaje claro.
      const sinFacturacion = await baseConMigraciones(
        b(),
        (await migracionesPrevias()).filter((n) => n < "0009"),
      );
      try {
        await expect(sinFacturacion.cliente.query(sql)).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(/0009_facturacion/) as string,
        });
      } finally {
        await sinFacturacion.cerrar();
      }
    } finally {
      await rm(conMia, { recursive: true, force: true });
      await previa.cerrar();
    }
  });

  it("la reversión borra el índice y el registro, se puede repetir y la migración se vuelve a aplicar", async () => {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
    const conMia = await carpetaCon([
      ...(await migracionesPrevias()),
      await archivoDeLaMigracion(),
    ]);
    try {
      const c = previa.cliente;
      const antes = await huellaDeCatalogo(c);
      const reversion = await texto(["reversiones", await archivoDeLaReversion()]);
      const registro = async (): Promise<unknown[]> =>
        (
          await c.query<{ n: number }>("select 1 as n from migracion where nombre = $1", [
            await archivoDeLaMigracion(),
          ])
        ).rows;
      await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      expect(await registro()).toHaveLength(1);

      await c.query(`begin; ${reversion}; commit;`);
      expect(await huellaDeCatalogo(c)).toEqual(antes);
      expect(await registro()).toEqual([]);
      await c.query(`begin; ${reversion}; commit;`);
      expect(await huellaDeCatalogo(c)).toEqual(antes);

      const otra = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      expect(otra.aplicadas).toEqual([await archivoDeLaMigracion()]);
      expect(await registro()).toHaveLength(1);
    } finally {
      await rm(conMia, { recursive: true, force: true });
      await previa.cerrar();
    }
  });
});

describe.skipIf(base === null)(
  "Búsqueda por documento: la consulta del listado con el índice",
  () => {
    async function conEscenario() {
      const dueno = new pg.Client({ connectionString: b().dueno });
      await dueno.connect();
      const e = await crearEscenario(dueno);
      const documentos = ["4688", "46880001", "4689", "46", "9", "99", "999123", "0", "00123", "5"];
      const ids = new Map<string, string>();
      for (const [i, documento] of documentos.entries()) {
        ids.set(
          documento,
          await crearComprobante(dueno, e, {
            receptor_documento_tipo: "DNI",
            receptor_documento_numero: documento,
            receptor_nombre: `Persona ${i}`,
          }),
        );
      }
      await crearComprobante(dueno, e, {}); // sin documento
      await dueno.query("analyze comprobante");
      return { dueno, e, ids };
    }

    /** Corre la lectura REAL del listado y devuelve el SQL que mandó (para el plan) y los documentos que trajo. */
    async function listar(e: { empresa: string; sucursal: string }, textoBuscado: string) {
      const capturadas: { sql: string; parametros: unknown[] }[] = [];
      const pool = new pg.Pool({ connectionString: b().app });
      const db = new Kysely<FiscalDb>({
        dialect: new PostgresDialect({ pool }),
        log: (ev) => {
          if (ev.level === "query") {
            capturadas.push({ sql: ev.query.sql, parametros: [...ev.query.parameters] });
          }
        },
      });
      const criterios = criteriosDeListado({ texto: textoBuscado, limite: 50 });
      if (!criterios.ok) throw new Error(criterios.error);
      try {
        // Con el contexto de la empresa: la RLS real filtra (sin contexto el rol de la app no ve ninguna fila).
        const sesion = await SesionDePrueba.abrir(
          b(),
          "pedernal_app",
          comoEmpresa(empresaId(e.empresa)),
        );
        const consulta = capturadas;
        await crearLecturasDeComprobantes(db)
          .listar(empresaId(e.empresa), { ...criterios.valor, sucursalId: sucursalId(e.sucursal) })
          .catch(() => undefined);
        const q = consulta[0] as { sql: string; parametros: unknown[] };
        // Se apagan el recorrido de la tabla y el índice «en orden» del listado: queda lo que el planificador puede hacer con
        // la condición de documento. Con `LIKE` bajo RLS no puede usar el índice de documento (no es «leakproof»); con el rango, sí.
        await sesion.directo("set local enable_seqscan = off");
        await sesion.directo("set local enable_indexscan = off");
        const filas = await sesion.directo(q.sql, q.parametros);
        const plan = await sesion.directo(`explain ${q.sql}`, q.parametros);
        await sesion.deshacer();
        if (!filas.ok || !plan.ok) throw new Error("falló la consulta de prueba");
        return {
          documentos: filas.rows.map((r) => r["receptor_documento_numero"] as string).sort(),
          plan: plan.rows.map((r) => r["QUERY PLAN"] as string).join("\n"),
        };
      } finally {
        await db.destroy();
      }
    }

    it("busca por el comienzo del documento, con los bordes del rango bien, y el plan (rol real, RLS) usa el índice nuevo", async () => {
      const { dueno, e } = await conEscenario();
      try {
        const caso = async (buscado: string) => (await listar(e, buscado)).documentos;
        expect(await caso("4688")).toEqual(["4688", "46880001"]);
        expect(await caso("46")).toEqual(["46", "4688", "46880001", "4689"]);
        expect(await caso("9")).toEqual(["9", "99", "999123"]);
        expect(await caso("99")).toEqual(["99", "999123"]);
        expect(await caso("0")).toEqual(["0", "00123"]);
        expect(await caso("00")).toEqual(["00123"]);
        expect(await caso("12")).toEqual([]); // prefijo, no cualquier parte
        expect(await caso("4.688")).toEqual(["4688", "46880001"]); // con puntos, como se escribe un DNI
        expect(await caso("Persona 3")).toEqual(["46"]); // un texto con letras sigue buscando por nombre

        const { plan } = await listar(e, "4688");
        // El rango entra como CONDICIÓN DEL ÍNDICE (no como filtro posterior): el prefijo y su cota superior.
        expect(plan).toMatch(
          new RegExp(
            `Index Scan on ${INDICE}[^\\n]*\\n\\s*Index Cond: [^\\n]*receptor_documento_numero ~>=~ '4688'[^\\n]*receptor_documento_numero ~<~ '4689'`,
          ),
        );
      } finally {
        await dueno.end();
      }
    });
  },
);
