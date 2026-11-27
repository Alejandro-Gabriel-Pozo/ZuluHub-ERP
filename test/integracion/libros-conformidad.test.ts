import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { LIBROS_REGISTRADOS, type LibroRegistrado } from "../../src/primitivas/libro/publico";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  baseDeEsteArchivo,
  comoEmpresa,
  crearEmpresaActiva,
  crearEntornoDePrueba,
} from "./entorno";
import {
  INVARIANTE_QUE_EXIME,
  evaluarLibro,
  excepcionesQueSobran,
  leerCatalogo,
  violacionesSinDeclarar,
  type CodigoDeInvariante,
} from "./libros-conformidad-apoyo";
import { sufijoUnico } from "./unicos";
import { ddlDeLibroEfimero, libroEfimero } from "./libros-conformidad-efimeros";

/**
 * LB-2: conformidad de los libros contra el catálogo de la base (`primitiva-de-libro-diseno.md` §2.1 y §2.2). Todo libro registrado en
 * `src/primitivas/libro/registro.ts` cumple las invariantes C1 a C6 y la forma de la medida, o declara su divergencia como excepción con
 * vencimiento. Solo lee el catálogo; concurrencia e idempotencia no aplican. Previene: un libro nuevo que olvida el espejo único, el
 * `TRUNCATE` o la RLS (la violación inyectada de cada invariante prueba que la conformidad la detecta).
 */

/**
 * Base propia del archivo: el esquema efímero se crea y se borra con DDL (`DROP SCHEMA ... CASCADE`), que en la base compartida toma bloqueos que chocan con los de otros archivos en paralelo
 * y cayó con `deadlock detected` en la corrida nocturna (Estabilidad, copias 8 y 12, 25 y 26/11/2026).
 */
const base = await baseDeEsteArchivo(inject("baseDePruebas"));
/** Un esquema por corrida: dos corridas contra la misma base (o un archivo repetido) no se pisan. */
const ESQUEMA_EFIMERO = `libros_efimeros_${sufijoUnico()}`;

/** Una entrada por invariante: si se suma una al tipo y no acá, no compila (cada invariante tiene su violación inyectada). */
const INVARIANTES: Readonly<Record<CodigoDeInvariante, true>> = {
  C1_SOLO_INSERCION_DE_FILA: true,
  C1_SOLO_INSERCION_DE_TRUNCATE: true,
  C1_SIN_PRIVILEGIOS_DE_ESCRITURA: true,
  C2_UNICO_ID_Y_EMPRESA: true,
  C2_FK_CON_EMPRESA: true,
  C2_RLS_ACTIVA: true,
  C2_RLS_FORZADA: true,
  C2_POLITICA_POR_EMPRESA: true,
  C3_UNICO_DE_CLAVE: true,
  C3_CLAVE_NO_NULA: true,
  C3_FORMA_DE_CLAVE: true,
  C3_FORMA_DE_HUELLA: true,
  C3_IDENTIDAD_POR_ORIGEN: true,
  C4_AUTOR: true,
  C4_MOMENTO: true,
  C4_FECHA_DE_NEGOCIO: true,
  C5_UNICO_DE_ANULACION: true,
  C5_CHECK_DEL_ESPEJO: true,
  C6_MAGNITUD_DISTINTA_DE_CERO: true,
  MEDIDA_UNA_SOLA_FORMA: true,
};
const CODIGOS = Object.keys(INVARIANTES) as CodigoDeInvariante[];

describe.skipIf(base === null)("conformidad de los libros contra el catálogo", () => {
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
  });

  const evaluar = async (libro: LibroRegistrado, esquema: string) => {
    const cat = await leerCatalogo(dueno, esquema, libro.tabla);
    const medida =
      libro.tablaDeMedida === libro.tabla
        ? cat
        : await leerCatalogo(dueno, esquema, libro.tablaDeMedida);
    expect(cat.columnas.size, `la tabla ${libro.tabla} no existe`).toBeGreaterThan(0);
    return evaluarLibro(libro, cat, medida);
  };

  describe("los libros registrados (stock y caja, tal como están, sin migración)", () => {
    it("hay al menos stock y caja, sin nombres ni tablas repetidos", () => {
      expect(LIBROS_REGISTRADOS.map((l) => l.nombre)).toEqual(
        expect.arrayContaining(["stock", "caja"]),
      );
      expect(new Set(LIBROS_REGISTRADOS.map((l) => l.nombre)).size).toBe(LIBROS_REGISTRADOS.length);
      expect(new Set(LIBROS_REGISTRADOS.map((l) => l.tabla)).size).toBe(LIBROS_REGISTRADOS.length);
    });

    for (const libro of LIBROS_REGISTRADOS) {
      describe(libro.nombre, () => {
        it("cumple todas las invariantes, salvo las excepciones que declara", async () => {
          const todas = await evaluar(libro, "public");
          expect(violacionesSinDeclarar(libro, todas)).toEqual([]);
        });

        it("cada excepción declarada sigue haciendo falta (si el libro ya cumple, hay que borrarla)", async () => {
          expect(excepcionesQueSobran(libro, await evaluar(libro, "public"))).toEqual([]);
        });

        it("si se quita una excepción declarada, el libro deja de pasar (y por esa invariante)", async () => {
          for (const excepcion of libro.excepciones) {
            const sinEsa = {
              ...libro,
              excepciones: libro.excepciones.filter((x) => x !== excepcion),
            };
            const sin = violacionesSinDeclarar(sinEsa, await evaluar(libro, "public"));
            expect(sin.map((x) => x.invariante)).toEqual([INVARIANTE_QUE_EXIME[excepcion.codigo]]);
          }
        });

        it("ninguna excepción está vencida ni dura más de 60 días desde el 20/11/2026", () => {
          const hoy = new Date().toISOString().slice(0, 10);
          const tope = "2027-01-19";
          for (const e of libro.excepciones) {
            expect(
              e.vence >= hoy,
              `la excepción ${e.codigo} venció el ${e.vence}: renovarla o pagarla`,
            ).toBe(true);
            expect(e.vence <= tope, `la excepción ${e.codigo} vence después del ${tope}`).toBe(
              true,
            );
          }
        });
      });
    }
  });

  describe("violación inyectada: la conformidad detecta cada invariante que falta", () => {
    beforeAll(async () => {
      await dueno.query(`DROP SCHEMA IF EXISTS ${ESQUEMA_EFIMERO} CASCADE`);
      await dueno.query(`CREATE SCHEMA ${ESQUEMA_EFIMERO}`);
      const armar = async (
        tabla: string,
        medida: "IMPORTE" | "CANTIDAD",
        rota: CodigoDeInvariante | null,
      ) => {
        for (const s of ddlDeLibroEfimero(ESQUEMA_EFIMERO, tabla, medida, rota).sentencias)
          await dueno.query(s);
      };
      await armar("sano_importe", "IMPORTE", null);
      await armar("sano_cantidad", "CANTIDAD", null);
      for (const codigo of CODIGOS) {
        await armar(`roto_${codigo.toLowerCase()}`, "IMPORTE", codigo);
      }
      await armar("roto_medida_cantidad", "CANTIDAD", "MEDIDA_UNA_SOLA_FORMA");
    });
    afterAll(async () => {
      await dueno.query(`DROP SCHEMA IF EXISTS ${ESQUEMA_EFIMERO} CASCADE`);
    });

    it("el libro efímero sano (importe y cantidad) no tiene ninguna violación", async () => {
      expect(await evaluar(libroEfimero("sano_importe", "IMPORTE"), ESQUEMA_EFIMERO)).toEqual([]);
      expect(await evaluar(libroEfimero("sano_cantidad", "CANTIDAD"), ESQUEMA_EFIMERO)).toEqual([]);
    });

    it.each(CODIGOS)("sin %s, la conformidad la detecta (y solo a ella)", async (codigo) => {
      const libro = libroEfimero(`roto_${codigo.toLowerCase()}`, "IMPORTE");
      const encontradas = await evaluar(libro, ESQUEMA_EFIMERO);
      expect(encontradas.map((x) => x.invariante)).toEqual([codigo]);
    });

    it("la forma de la medida también se rompe en un libro de cantidad (cantidad con moneda)", async () => {
      const libro = libroEfimero("roto_medida_cantidad", "CANTIDAD");
      expect((await evaluar(libro, ESQUEMA_EFIMERO)).map((x) => x.invariante)).toEqual([
        "MEDIDA_UNA_SOLA_FORMA",
      ]);
    });
  });

  describe("aislamiento por RLS: la empresa A no ve las filas de la empresa B en ningún libro", () => {
    type Entorno = ReturnType<typeof crearEntornoDePrueba>;
    let entorno: Entorno;
    let a: Awaited<ReturnType<typeof crearEmpresaActiva>>;
    let b: Awaited<ReturnType<typeof crearEmpresaActiva>>;
    const huella = "a".repeat(64);
    /** Lo sembrado, para borrarlo al terminar: no queda ninguna fila huérfana en la base compartida. */
    const sembradas: { tabla: string; id: string }[] = [];

    /** Una fila mínima por empresa y por libro. Se siembra con el dueño y los disparadores y claves foráneas apagados: la prueba es de lectura. */
    const sembrar = async (empresa: string): Promise<void> => {
      await dueno.query("BEGIN");
      try {
        await dueno.query("SET LOCAL session_replication_role = replica");
        const idDeStock = randomUUID();
        const idDeCaja = randomUUID();
        const idDeSaldos = randomUUID();
        sembradas.push(
          { tabla: "movimiento_de_stock", id: idDeStock },
          { tabla: "movimiento_caja", id: idDeCaja },
          { tabla: "asiento_de_saldo", id: idDeSaldos },
        );
        await dueno.query(
          `INSERT INTO movimiento_de_stock (id, empresa_id, clase, motivo, origen_tipo, deposito_id, accion, clave_idempotencia, huella,
                                            hecho_en, registrado_en, fecha_negocio, registrado_por)
           VALUES ($1, $2, 'ENTRADA', 'COMPRA', 'MANUAL', $3, 'stock.entrada', $4, $5, now(), now(), current_date, $6)`,
          [idDeStock, empresa, randomUUID(), `clave-${randomUUID()}`, huella, randomUUID()],
        );
        await dueno.query(
          `INSERT INTO movimiento_caja (id, empresa_id, sesion_id, clase, medio_de_pago_id, moneda, importe, motivo, registrado_en,
                                        registrado_por, clave_idempotencia, huella)
           VALUES ($1, $2, $3, 'INGRESO_MANUAL', $4, 'ARS', 10, 'Prueba', now(), $5, $6, $7)`,
          [idDeCaja, empresa, randomUUID(), randomUUID(), randomUUID(), randomUUID(), huella],
        );
        await dueno.query(
          `INSERT INTO asiento_de_saldo (id, empresa_id, parte_id, sentido, clase, importe, origen_tipo, origen_id, clave_idempotencia,
                                         huella, hecho_en, fecha_negocio, registrado_por)
           VALUES ($1, $2, $3, 'A_PAGAR', 'CARGO_DE_FACTURA_DE_COMPRA', 10, 'compras.factura', $4, $5, $6, now(), current_date, $7)`,
          [idDeSaldos, empresa, randomUUID(), randomUUID(), randomUUID(), huella, randomUUID()],
        );
        await dueno.query("COMMIT");
      } catch (falla) {
        await dueno.query("ROLLBACK");
        throw falla;
      }
    };

    beforeAll(async () => {
      if (base === null) return;
      entorno = crearEntornoDePrueba(base);
      a = await crearEmpresaActiva(entorno, { nombreDeSucursal: "Sucursal de A" });
      b = await crearEmpresaActiva(entorno, { nombreDeSucursal: "Sucursal de B" });
      await sembrar(a.empresa);
      await sembrar(b.empresa);
    });
    afterAll(async () => {
      await entorno.cerrar();
      // Los libros son de solo inserción (aun para el dueño): se borra lo sembrado con los disparadores apagados, igual que se sembró.
      await dueno.query("BEGIN");
      try {
        await dueno.query("SET LOCAL session_replication_role = replica");
        for (const { tabla, id } of sembradas) {
          const borradas = await dueno.query(`DELETE FROM ${tabla} WHERE id = $1`, [id]);
          expect(borradas.rowCount, `${tabla}: no se borró la fila sembrada`).toBe(1);
        }
        await dueno.query("COMMIT");
      } catch (falla) {
        await dueno.query("ROLLBACK");
        throw falla;
      }
    });

    /** Con el rol de la aplicación y el contexto de `quien`: cuántas filas del libro ve en total y cuántas son de `de`. */
    const vistas = async (tabla: string, quien: string, de: string) => {
      const r = await entorno.ejecutar(
        { contexto: comoEmpresa(quien as typeof a.empresa) },
        async ({ db }) => {
          const total = await sql<{
            n: string;
          }>`select count(*) as n from ${sql.table(tabla)}`.execute(db);
          const ajenas = await sql<{
            n: string;
          }>`select count(*) as n from ${sql.table(tabla)} where empresa_id = ${de}`.execute(db);
          return ok({ total: Number(total.rows[0]?.n), deLaOtra: Number(ajenas.rows[0]?.n) });
        },
      );
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      return r.valor;
    };

    for (const libro of LIBROS_REGISTRADOS) {
      it(`${libro.nombre}: cada empresa ve solo su fila y ninguna de la otra`, async () => {
        expect(await vistas(libro.tabla, a.empresa, b.empresa)).toEqual({ total: 1, deLaOtra: 0 });
        expect(await vistas(libro.tabla, b.empresa, a.empresa)).toEqual({ total: 1, deLaOtra: 0 });
      });
    }
  });
});
