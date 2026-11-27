import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { leerClaveDeContextoVigente } from "../../src/adaptadores/postgres/contexto-firmado";
import { hayEmpresaViva } from "../../src/adaptadores/postgres/hay-empresa-viva";
import { crearMarcaLista, crearTenantConPlan } from "./altas-apoyo";
import { crearBaseAparte, cuitUnico } from "./entorno";

/**
 * «¿Ya hay una empresa viva con ese CUIT?» (el alta de un cliente decide con esto si el secreto de invitaciones se puede generar de nuevo): una empresa activa cuenta, una cancelada no, y un
 * CUIT que nadie usó tampoco. Contra Postgres real y con la cadena del dueño, como lo corre el workflow. Solo lectura.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("hay empresa viva", () => {
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

  it("sin empresas no hay alta; con una viva sí (con cualquier CUIT), y la consulta no escribe", async () => {
    expect(await hayEmpresaViva(propia.base.dueno)).toBe(false);
    const marca = await crearMarcaLista(dueno);
    const mundo = await crearTenantConPlan(dueno, marca, { empresasPorTenant: "5" });
    await dueno.query(
      "insert into empresa (tenant_id, cuit, razon_social, estado, motivo_estado) values ($1, $2, 'Cancelada S.A.', 'CANCELLED', 'prueba')",
      [mundo.tenant, cuitUnico()],
    );
    const antes = (await dueno.query("select count(*)::int as n from empresa")).rows[0] as {
      n: number;
    };
    // La fixture del tenant ya trae una empresa activa: hay alta, y la cancelada de arriba no cambia eso.
    expect(await hayEmpresaViva(propia.base.dueno)).toBe(true);
    const despues = (await dueno.query("select count(*)::int as n from empresa")).rows[0] as {
      n: number;
    };
    expect(despues.n).toBe(antes.n);
  });

  it("una cadena que no conecta falla (no devuelve «no existe»)", async () => {
    await expect(hayEmpresaViva("postgres://nadie:nada@127.0.0.1:1/ninguna")).rejects.toThrow();
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
