import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { exigirSucursal } from "../../src/capacidades/permisos/alcance";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import { comoEmpresa, crearBaseAparte, crearEmpresaActiva, crearEntornoDePrueba } from "./entorno";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  sucursalDe,
  type RolDePrueba,
} from "./fixtures-identidad";

/**
 * Tramo previo común, K5: `CargaDeAutorizacion.sucursalesDelActor` contra una base real. El alcance
 * del operador es «asignación activa Y sucursal activa»; gerente y administrador activos operan en
 * todas; sin rol vigente no hay alcance (falla cerrado). Se lee dentro de la transacción en curso.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("alcance de sucursales: el adaptador contra una base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 5);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const alcanceDe = async (empresa: EmpresaId, persona: PersonaId | null) => {
    const contexto = comoEmpresa(empresa, persona);
    const r = await entorno.ejecutar({ contexto }, async (tx) =>
      ok(await tx.autorizacion.sucursalesDelActor(contexto)),
    );
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  const miembro = async (empresa: EmpresaId, rol: RolDePrueba, activo = true) => {
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, empresa, p.id, rol, activo);
    return personaId(p.id);
  };
  /** Una empresa con su sucursal inicial y `extra` sucursales más; devuelve todas, ordenadas por id. */
  const empresaConSucursales = async (extra: number) => {
    const { empresa } = await crearEmpresaActiva(entorno);
    const ids: SucursalId[] = [sucursalId(await sucursalDe(dueno, empresa))];
    for (let i = 0; i < extra; i += 1) {
      const { rows } = await dueno.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
        [empresa, `Sucursal ${i + 2}`],
      );
      ids.push(sucursalId(rows[0]?.id as string));
    }
    return { empresa, sucursales: ids.sort() };
  };

  it.each(["GERENTE", "ADMINISTRADOR"] as const)(
    "un %s activo opera en todas las sucursales, aunque no tenga asignaciones",
    async (rol) => {
      const { empresa } = await empresaConSucursales(1);
      const persona = await miembro(empresa, rol);
      expect(await alcanceDe(empresa, persona)).toBe("TODAS");
    },
  );

  it("un operador solo opera en las sucursales con asignación activa, ordenadas por id", async () => {
    const { empresa, sucursales } = await empresaConSucursales(2);
    const persona = await miembro(empresa, "OPERADOR");
    const [primera, segunda, tercera] = sucursales as [SucursalId, SucursalId, SucursalId];
    await crearAsignacionDeBase(dueno, empresa, persona, tercera);
    await crearAsignacionDeBase(dueno, empresa, persona, primera);
    expect(await alcanceDe(empresa, persona)).toEqual([primera, tercera]);
    expect(exigirSucursal(await alcanceDe(empresa, persona), segunda)).toEqual({
      ok: false,
      error: "SUCURSAL_FUERA_DE_ALCANCE",
    });
  });

  it("un operador sin asignaciones no opera en ninguna sucursal", async () => {
    const { empresa } = await empresaConSucursales(1);
    const persona = await miembro(empresa, "OPERADOR");
    expect(await alcanceDe(empresa, persona)).toEqual([]);
  });

  it("una asignación apagada no cuenta, y las otras del mismo operador siguen contando", async () => {
    const { empresa, sucursales } = await empresaConSucursales(1);
    const persona = await miembro(empresa, "OPERADOR");
    const [a, b] = sucursales as [SucursalId, SucursalId];
    await crearAsignacionDeBase(dueno, empresa, persona, a, false);
    await crearAsignacionDeBase(dueno, empresa, persona, b, true);
    expect(await alcanceDe(empresa, persona)).toEqual([b]);
  });

  it("una sucursal desactivada no cuenta, aunque la asignación siga activa (la desactivación no apaga asignaciones)", async () => {
    const { empresa, sucursales } = await empresaConSucursales(1);
    const persona = await miembro(empresa, "OPERADOR");
    const [a, b] = sucursales as [SucursalId, SucursalId];
    await crearAsignacionDeBase(dueno, empresa, persona, a);
    await crearAsignacionDeBase(dueno, empresa, persona, b);
    await dueno.query("update sucursal set activa = false where id = $1", [a]);
    expect(await alcanceDe(empresa, persona)).toEqual([b]);
  });

  it("un operador con membresía apagada no tiene alcance, aunque conserve asignaciones activas", async () => {
    const { empresa, sucursales } = await empresaConSucursales(0);
    const persona = await miembro(empresa, "OPERADOR");
    await crearAsignacionDeBase(dueno, empresa, persona, sucursales[0] as SucursalId);
    expect(await alcanceDe(empresa, persona)).toEqual(sucursales);
    await dueno.query(
      "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
      [empresa, persona],
    );
    expect(await alcanceDe(empresa, persona)).toEqual([]);
  });

  it("una persona suspendida globalmente no tiene alcance: ni el gerente ni el operador, y lo recupera al levantarse", async () => {
    const { empresa, sucursales } = await empresaConSucursales(0);
    const gerente = await miembro(empresa, "GERENTE");
    const operador = await miembro(empresa, "OPERADOR");
    await crearAsignacionDeBase(dueno, empresa, operador, sucursales[0] as SucursalId);
    await dueno.query("update persona set activo_global = false where id = any($1)", [
      [gerente, operador],
    ]);
    expect(await alcanceDe(empresa, gerente)).toEqual([]);
    expect(await alcanceDe(empresa, operador)).toEqual([]);
    await dueno.query("update persona set activo_global = true where id = any($1)", [
      [gerente, operador],
    ]);
    expect(await alcanceDe(empresa, gerente)).toBe("TODAS");
    expect(await alcanceDe(empresa, operador)).toEqual(sucursales);
  });

  it("el sistema (sin persona) y quien no es miembro no tienen alcance", async () => {
    const { empresa } = await empresaConSucursales(0);
    await miembro(empresa, "GERENTE");
    const ajena = personaId((await crearPersonaDeBase(dueno)).id);
    expect(await alcanceDe(empresa, null)).toEqual([]);
    expect(await alcanceDe(empresa, ajena)).toEqual([]);
  });

  it("lo de otra empresa no cuenta: el gerente ajeno no tiene alcance acá y las asignaciones son por empresa", async () => {
    const aqui = await empresaConSucursales(0);
    const alla = await empresaConSucursales(0);
    const gerenteDeAlla = await miembro(alla.empresa, "GERENTE");
    expect(await alcanceDe(aqui.empresa, gerenteDeAlla)).toEqual([]);

    // La misma persona es operadora en las dos empresas, con su propia asignación en cada una.
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, aqui.empresa, p.id, "OPERADOR");
    await crearMembresiaDeBase(dueno, alla.empresa, p.id, "OPERADOR");
    await crearAsignacionDeBase(dueno, alla.empresa, p.id, alla.sucursales[0] as SucursalId);
    expect(await alcanceDe(aqui.empresa, personaId(p.id))).toEqual([]);
    expect(await alcanceDe(alla.empresa, personaId(p.id))).toEqual(alla.sucursales);
  });

  it("se lee en la transacción en curso, sin caché: una baja se ve en la operación siguiente y no a mitad de una", async () => {
    const { empresa, sucursales } = await empresaConSucursales(0);
    const persona = await miembro(empresa, "OPERADOR");
    await crearAsignacionDeBase(dueno, empresa, persona, sucursales[0] as SucursalId);
    const contexto = comoEmpresa(empresa, persona);
    const r = await entorno.ejecutar({ contexto }, async (tx) => {
      const antes = await tx.autorizacion.sucursalesDelActor(contexto);
      // Otra conexión da de baja la asignación y confirma mientras esta transacción sigue abierta.
      await dueno.query(
        "update asignacion_sucursal set activa = false where empresa_id = $1 and persona_id = $2",
        [empresa, persona],
      );
      const durante = await tx.autorizacion.sucursalesDelActor(contexto);
      return ok({ antes, durante });
    });
    // La transacción serializable ve una foto consistente: las dos lecturas coinciden.
    expect(r).toEqual({ ok: true, valor: { antes: sucursales, durante: sucursales } });
    expect(await alcanceDe(empresa, persona)).toEqual([]);
  });
});
