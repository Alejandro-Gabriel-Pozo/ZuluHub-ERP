import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ROLES_DE_EMPRESA } from "../../src/capacidades/permisos/roles";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import { comoEmpresa, crearBaseAparte, crearEmpresaActiva, crearEntornoDePrueba } from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase, type RolDePrueba } from "./fixtures-identidad";

/**
 * H4: el adaptador de autorización contra una base real. Lee el rol de la membresía ACTIVA del actor
 * en la empresa del contexto, con la persona activa globalmente, dentro de la transacción en curso.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("autorización: el adaptador contra una base real", () => {
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

  /** Lo que el adaptador devuelve para esa persona en esa empresa, dentro de una transacción. */
  const delActor = async (empresa: EmpresaId, persona: PersonaId | null) => {
    const contexto = comoEmpresa(empresa, persona);
    const r = await entorno.ejecutar({ contexto }, async (tx) =>
      ok(await tx.autorizacion.delActor(contexto)),
    );
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  const miembro = async (empresa: EmpresaId, rol: RolDePrueba, activo = true) => {
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, empresa, p.id, rol, activo);
    return personaId(p.id);
  };
  const empresaNueva = async () => (await crearEmpresaActiva(entorno)).empresa;

  it.each(ROLES_DE_EMPRESA)("un %s activo: devuelve su rol", async (rol) => {
    const empresa = await empresaNueva();
    const persona = await miembro(empresa, rol);
    expect(await delActor(empresa, persona)).toEqual({
      rol,
      modulosActivados: [],
      modulosHabilitados: [],
    });
  });

  it("una membresía apagada: sin rol, sea cual sea el rol que tuvo", async () => {
    const empresa = await empresaNueva();
    for (const rol of ROLES_DE_EMPRESA) {
      const persona = await miembro(empresa, rol === "GERENTE" ? "OPERADOR" : rol, false);
      expect(await delActor(empresa, persona)).toEqual({
        rol: null,
        modulosActivados: [],
        modulosHabilitados: [],
      });
    }
  });

  it("una persona que no es miembro: sin rol", async () => {
    const empresa = await empresaNueva();
    await miembro(empresa, "GERENTE");
    const ajena = personaId((await crearPersonaDeBase(dueno)).id);
    expect(await delActor(empresa, ajena)).toEqual({
      rol: null,
      modulosActivados: [],
      modulosHabilitados: [],
    });
  });

  it("el sistema (sin persona): sin rol", async () => {
    const empresa = await empresaNueva();
    await miembro(empresa, "GERENTE");
    expect(await delActor(empresa, null)).toEqual({
      rol: null,
      modulosActivados: [],
      modulosHabilitados: [],
    });
  });

  it("el gerente de OTRA empresa no tiene rol en esta (ni siquiera ve la fila)", async () => {
    const empresa = await empresaNueva();
    const otra = await empresaNueva();
    const gerenteDeOtra = await miembro(otra, "GERENTE");
    expect(await delActor(empresa, gerenteDeOtra)).toEqual({
      rol: null,
      modulosActivados: [],
      modulosHabilitados: [],
    });
    expect(await delActor(otra, gerenteDeOtra)).toEqual({
      rol: "GERENTE",
      modulosActivados: [],
      modulosHabilitados: [],
    });
  });

  it("la persona con roles distintos en dos empresas tiene, en cada una, el suyo", async () => {
    const e1 = await empresaNueva();
    const e2 = await empresaNueva();
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e1, p.id, "ADMINISTRADOR");
    await crearMembresiaDeBase(dueno, e2, p.id, "OPERADOR");
    expect((await delActor(e1, personaId(p.id))).rol).toBe("ADMINISTRADOR");
    expect((await delActor(e2, personaId(p.id))).rol).toBe("OPERADOR");
  });

  it("defensa en profundidad: aunque la RLS ya limite a la empresa de la transacción, el rol se pide de la empresa del contexto recibido", async () => {
    const e1 = await empresaNueva();
    const e2 = await empresaNueva();
    const persona = await miembro(e1, "ADMINISTRADOR");
    const enE1 = comoEmpresa(e1, persona);
    // La transacción corre con el contexto de e1 (la RLS solo deja ver e1) pero se pregunta por e2.
    const r = await entorno.ejecutar({ contexto: enE1 }, async (tx) =>
      ok({
        pregunta_e1: (await tx.autorizacion.delActor(enE1)).rol,
        pregunta_e2: (await tx.autorizacion.delActor(comoEmpresa(e2, persona))).rol,
      }),
    );
    expect(r).toEqual({ ok: true, valor: { pregunta_e1: "ADMINISTRADOR", pregunta_e2: null } });
  });

  it("S4/D8: una persona suspendida globalmente pierde el rol aunque su membresía siga activa, y lo recupera al levantarse", async () => {
    const empresa = await empresaNueva();
    const gerente = await miembro(empresa, "GERENTE");
    expect((await delActor(empresa, gerente)).rol).toBe("GERENTE");

    await dueno.query("update persona set activo_global = false where id = $1", [gerente]);
    expect(await delActor(empresa, gerente)).toEqual({
      rol: null,
      modulosActivados: [],
      modulosHabilitados: [],
    });
    const { rows } = await dueno.query<{ activo: boolean }>(
      "select activo from membresia where empresa_id = $1 and persona_id = $2",
      [empresa, gerente],
    );
    expect(rows[0]?.activo).toBe(true);

    await dueno.query("update persona set activo_global = true where id = $1", [gerente]);
    expect((await delActor(empresa, gerente)).rol).toBe("GERENTE");
  });

  it("nada se guarda entre una operación y la siguiente: una baja se ve de inmediato", async () => {
    const empresa = await empresaNueva();
    const admin = await miembro(empresa, "ADMINISTRADOR");
    expect((await delActor(empresa, admin)).rol).toBe("ADMINISTRADOR");
    await dueno.query(
      "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
      [empresa, admin],
    );
    expect((await delActor(empresa, admin)).rol).toBeNull();
  });

  it("dentro de una misma transacción ve lo que esa transacción cambió (se lee en la transacción en curso)", async () => {
    const empresa = await empresaNueva();
    const gerente = await miembro(empresa, "GERENTE");
    const admin = await miembro(empresa, "ADMINISTRADOR");
    const contexto = comoEmpresa(empresa, gerente);
    const r = await entorno.ejecutar({ contexto }, async (tx) => {
      const antes = await tx.autorizacion.delActor(comoEmpresa(empresa, admin));
      const apagada = await tx.membresias.apagar(empresa, admin, 1);
      const despues = await tx.autorizacion.delActor(comoEmpresa(empresa, admin));
      return ok({ antes: antes.rol, apagada, despues: despues.rol });
    });
    expect(r).toEqual({
      ok: true,
      valor: { antes: "ADMINISTRADOR", apagada: true, despues: null },
    });
  });

  it("un rol desconocido en la base es una falla (no se autoriza por omisión)", async () => {
    // Base descartable: se le quita el CHECK para forzar un valor que la base real no deja pasar.
    const aparte = await crearBaseAparte(base!);
    const cliente = new pg.Client({ connectionString: aparte.base.dueno });
    const entornoAparte = crearEntornoDePrueba(aparte.base, 2);
    try {
      await cliente.connect();
      const e = await crearEmpresaActiva(entornoAparte);
      const p = await crearPersonaDeBase(cliente);
      await cliente.query("alter table membresia drop constraint membresia_rol_ck");
      await cliente.query(
        "insert into membresia (empresa_id, persona_id, rol) values ($1, $2, 'SUPERVISOR')",
        [e.empresa, p.id],
      );
      const contexto = comoEmpresa(e.empresa, personaId(p.id));
      await expect(
        entornoAparte.ejecutar({ contexto }, async (tx) =>
          ok(await tx.autorizacion.delActor(contexto)),
        ),
      ).rejects.toThrow("rol desconocido en la base: SUPERVISOR");
    } finally {
      await cliente.end();
      await entornoAparte.cerrar();
      await aparte.destruir();
    }
  });

  describe("los roles de TypeScript son exactamente los de la base", () => {
    const rolesDelCheck = async (restriccion: string): Promise<string[]> => {
      const { rows } = await dueno.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1",
        [restriccion],
      );
      expect(rows, `${restriccion} existe una sola vez`).toHaveLength(1);
      return [...(rows[0]?.def ?? "").matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] ?? "").sort();
    };

    it.each(["membresia_rol_ck", "invitacion_empresa_rol_ck"])(
      "%s admite exactamente ROLES_DE_EMPRESA",
      async (restriccion) => {
        expect(await rolesDelCheck(restriccion)).toEqual([...ROLES_DE_EMPRESA].sort());
      },
    );
  });
});
