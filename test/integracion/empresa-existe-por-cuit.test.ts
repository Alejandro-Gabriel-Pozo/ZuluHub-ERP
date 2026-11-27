import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { leerClaveDeContextoVigente } from "../../src/adaptadores/postgres/contexto-firmado";
import { empresaExistePorCuit } from "../../src/adaptadores/postgres/empresa-existe-por-cuit";
import { crearMarcaLista, crearTenantConPlan } from "./altas-apoyo";
import { crearBaseAparte, cuitUnico } from "./entorno";

/**
 * «¿Ya hay una empresa viva con ese CUIT?» (el alta de un cliente decide con esto si el secreto de invitaciones se puede generar de nuevo): una empresa activa cuenta, una cancelada no, y un
 * CUIT que nadie usó tampoco. Contra Postgres real y con la cadena del dueño, como lo corre el workflow. Solo lectura.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("empresa existe por CUIT", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  it("una empresa activa cuenta; una cancelada o un CUIT sin empresa, no (y la consulta no escribe nada)", async () => {
    const marca = await crearMarcaLista(dueno);
    const mundo = await crearTenantConPlan(dueno, marca, { empresasPorTenant: "5" });
    const viva = cuitUnico();
    const cancelada = cuitUnico();
    await dueno.query(
      "insert into empresa (tenant_id, cuit, razon_social, estado) values ($1, $2, 'Viva S.A.', 'ACTIVE')",
      [mundo.tenant, viva],
    );
    await dueno.query(
      "insert into empresa (tenant_id, cuit, razon_social, estado, motivo_estado) values ($1, $2, 'Cancelada S.A.', 'CANCELLED', 'prueba')",
      [mundo.tenant, cancelada],
    );
    const antes = (await dueno.query("select count(*)::int as n from empresa")).rows[0] as {
      n: number;
    };

    expect(await empresaExistePorCuit(propia.base.dueno, viva)).toBe(true);
    expect(await empresaExistePorCuit(propia.base.dueno, cancelada)).toBe(false);
    expect(await empresaExistePorCuit(propia.base.dueno, cuitUnico())).toBe(false);

    const despues = (await dueno.query("select count(*)::int as n from empresa")).rows[0] as {
      n: number;
    };
    expect(despues.n).toBe(antes.n);
  });

  it("una cadena que no conecta falla (no devuelve «no existe»)", async () => {
    await expect(
      empresaExistePorCuit("postgres://nadie:nada@127.0.0.1:1/ninguna", cuitUnico()),
    ).rejects.toThrow();
  });

  it("la clave de contexto vigente se lee con la cadena del dueño (la de mayor kid) y una revocada no cuenta", async () => {
    await dueno.query("delete from contexto_clave");
    expect(await leerClaveDeContextoVigente(propia.base.dueno)).toBeNull();
    await dueno.query(
      "insert into contexto_clave (kid, secreto, vigente) values (7, decode($1, 'hex'), true), (9, decode($2, 'hex'), true), (11, decode($3, 'hex'), false)",
      ["aa".repeat(32), "bb".repeat(32), "cc".repeat(32)],
    );
    expect(await leerClaveDeContextoVigente(propia.base.dueno)).toBe(`9:${"bb".repeat(32)}`);
  });
});
