import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import {
  comoEmpresa,
  comoGrupo,
  comoTrabajos,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
  type TxDePrueba,
} from "./entorno";
import { valoresGuardados } from "./listas-apoyo";

/**
 * Una empresa NO puede escribir las listas del sistema (e3 §3.7, decisión 130: «una empresa no agrega ni saca valores; lo que se cambia
 * lo ven todas»), ni ningún otro rol que no sea la plataforma: SQL directo con el rol de la aplicación, el de grupo y el de trabajos.
 * Sí LEE la lista (el cobro la usa). Base propia: si alguna escritura entrara, no contaminaría las demás pruebas.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("listas del sistema: una empresa solo lee", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDePrueba>;
  let empresa: EmpresaDePrueba;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDePrueba(propia.base);
    empresa = await crearEmpresaActiva(entorno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const comoApp = () => comoEmpresa(empresa.empresa);

  it("la empresa lee las marcas de tarjeta y los motivos de rechazo", async () => {
    const r = await entorno.ejecutar(
      { contexto: comoApp(), aislamiento: "read committed", soloLectura: true },
      async (tx) => {
        const { rows } = await sql<{
          n: string;
        }>`select count(*)::text as n from valor_de_lista`.execute(tx.db);
        return ok(Number(rows[0]?.n));
      },
    );
    expect(r).toEqual(ok(10));
  });

  it("la empresa no agrega un valor (SQL directo con el rol de la aplicación)", async () => {
    const r = await entorno.ejecutar({ contexto: comoApp() }, async (tx) => {
      await sql`insert into valor_de_lista (lista, nombre) values ('MARCAS_DE_TARJETA', 'Marca colada')`.execute(
        tx.db,
      );
      return ok(null);
    });
    expect(r).toEqual(err({ tipo: "AccesoDenegado" }));
  });

  it("la empresa no cambia el nombre, no desactiva ni reactiva un valor", async () => {
    for (const cambio of [
      sql`update valor_de_lista set nombre = 'Cambiada' where nombre = 'Visa'`,
      sql`update valor_de_lista set activo = false where nombre = 'Visa'`,
      sql`update valor_de_lista set activo = true where nombre = 'Visa'`,
    ]) {
      const r = await entorno.ejecutar({ contexto: comoApp() }, async (tx) => {
        await cambio.execute(tx.db);
        return ok(null);
      });
      expect(r).toEqual(err({ tipo: "AccesoDenegado" }));
    }
  });

  it("la empresa no borra ni vacía la lista", async () => {
    for (const orden of [sql`delete from valor_de_lista`, sql`truncate valor_de_lista`]) {
      const r = await entorno.ejecutar({ contexto: comoApp() }, async (tx) => {
        await orden.execute(tx.db);
        return ok(null);
      });
      expect(r).toEqual(err({ tipo: "AccesoDenegado" }));
    }
  });

  it("tampoco el rol de grupo ni el de trabajos: no leen ni escriben", async () => {
    const grupo = comoGrupo(empresa.tenant, "00000000-0000-4000-8000-000000000001" as never);
    for (const contexto of [grupo, comoTrabajos()]) {
      for (const orden of [
        sql`insert into valor_de_lista (lista, nombre) values ('MARCAS_DE_TARJETA', 'Marca colada')`,
        sql`update valor_de_lista set nombre = 'Cambiada' where nombre = 'Visa'`,
        sql`select * from valor_de_lista`,
      ]) {
        const r = await entorno.ejecutar({ contexto }, async (tx) => {
          await orden.execute(tx.db);
          return ok(null);
        });
        expect(r.ok, contexto.tipo).toBe(false);
      }
    }
  });

  it("después de todo eso la lista está intacta", async () => {
    const valores = await valoresGuardados(dueno);
    expect(valores).toHaveLength(10);
    expect(valores.every((v) => v.activo && v.version === 1)).toBe(true);
    expect(valores.map((v) => v.nombre)).not.toContain("Marca colada");
    expect(valores.map((v) => v.nombre)).not.toContain("Cambiada");
  });
});
