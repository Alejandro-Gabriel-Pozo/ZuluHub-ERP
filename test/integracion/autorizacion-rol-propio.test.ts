import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import { comoEmpresa, crearBaseAparte, crearEmpresaActiva, crearEntornoDePrueba } from "./entorno";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
} from "./fixtures-identidad";

/**
 * T4 de H4b: el adaptador de autorización con una persona de rol PROPIO, contra una base real y con el rol de la aplicación. El conjunto sale de la versión vigente de su rol
 * propio; un rol propio archivado (aunque la membresía siga apuntando a él) es conjunto VACÍO y una persona apagada no tiene rol; el alcance de sucursales de un PROPIO es el de
 * sus asignaciones (nunca «todas»). Lo que se arma por escrito directo (escena) lo hace el dueño de la base, apagando un instante los disparadores que lo impedirían.
 */
const base = inject("baseDePruebas");
const CATALOGO = new Set(
  Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones)),
);
const PISO = [
  "gerencia.aceptar_traspaso",
  "gerencia.rechazar_traspaso",
  "gerencia.ver_traspaso",
  "permisos.ver_propios",
];

describe.skipIf(base === null)("autorización: una persona con rol propio", () => {
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

  const delActor = async (empresa: EmpresaId, persona: PersonaId) => {
    const contexto = comoEmpresa(empresa, persona);
    const r = await entorno.ejecutar({ contexto }, async (tx) =>
      ok(await tx.autorizacion.delActor(contexto)),
    );
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  };
  const alcance = async (empresa: EmpresaId, persona: PersonaId) => {
    const contexto = comoEmpresa(empresa, persona);
    const r = await entorno.ejecutar({ contexto }, async (tx) =>
      ok(await tx.autorizacion.sucursalesDelActor(contexto)),
    );
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  /** Una empresa con un rol propio (activo, con su versión 1) y una persona que lo tiene (activa). */
  const escena = async (acciones: readonly string[]) => {
    const creada = await crearEmpresaActiva(entorno);
    const empresa = creada.empresa;
    const autor = (await crearPersonaDeBase(dueno)).id;
    const persona = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, empresa, persona.id, "OPERADOR", true);
    const rol = randomUUID();
    await dueno.query(
      "insert into rol_de_empresa (id, empresa_id, nombre, nombre_clave) values ($1, $2, $3, $3)",
      [rol, empresa, `r-${rol}`],
    );
    const version = (numero: number, lista: readonly string[]) =>
      dueno.query(
        "insert into version_de_rol (empresa_id, rol_id, numero, acciones, creado_por, creado_en) values ($1, $2, $3, $4::text[], $5, now())",
        [empresa, rol, numero, lista, autor],
      );
    await version(1, acciones);
    const asignar = async () => {
      await dueno.query("alter table membresia disable trigger membresia_cambio");
      await dueno.query(
        "update membresia set rol = 'PROPIO', rol_propio_id = $3 where empresa_id = $1 and persona_id = $2",
        [empresa, persona.id, rol],
      );
      await dueno.query("alter table membresia enable trigger membresia_cambio");
    };
    await asignar();
    return {
      empresa,
      persona: personaId(persona.id),
      rol,
      version,
      sucursal: creada.empresa && (await sucursalDe(empresa)),
    };
  };
  const sucursalDe = async (empresa: EmpresaId) =>
    (
      await dueno.query<{ id: string }>("select id from sucursal where empresa_id = $1 limit 1", [
        empresa,
      ])
    ).rows[0]?.id as string;

  it("tiene exactamente las acciones de la versión vigente de su rol (rol 'PROPIO'), y una versión nueva rige desde la operación siguiente", async () => {
    const e = await escena([...PISO, "ventas.ver", "comprobantes.ver"]);
    const antes = await delActor(e.empresa, e.persona);
    expect(antes.rol).toBe("PROPIO");
    expect(antes.acciones).toEqual([...PISO, "comprobantes.ver", "ventas.ver"].sort());
    await e.version(2, PISO);
    expect((await delActor(e.empresa, e.persona)).acciones).toEqual([...PISO].sort());
  });

  it("una clave retirada del catálogo no otorga nada y no bloquea las demás", async () => {
    const e = await escena([...PISO, "ventas.ver", "modulo_que_ya_no_existe.hacer"]);
    const actor = await delActor(e.empresa, e.persona);
    expect(actor.acciones).toEqual([...PISO, "ventas.ver"].sort());
    expect((actor.acciones ?? []).every((a) => CATALOGO.has(a))).toBe(true);
  });

  it("CONDICIÓN 2: un rol propio ARCHIVADO es conjunto vacío aunque la membresía siga apuntando a él (la persona conserva el rol PROPIO pero ninguna acción)", async () => {
    const e = await escena([...PISO, "ventas.ver"]);
    await dueno.query("alter table rol_de_empresa disable trigger rol_de_empresa_archivado");
    await dueno.query("update rol_de_empresa set activo = false where id = $1", [e.rol]);
    await dueno.query("alter table rol_de_empresa enable trigger rol_de_empresa_archivado");
    expect(await delActor(e.empresa, e.persona)).toMatchObject({ rol: "PROPIO", acciones: [] });
  });

  it("CONDICIÓN 2: una persona APAGADA con rol archivado no tiene rol ni acciones, y reasignada o reactivada a un rol base no recupera las del rol archivado", async () => {
    const e = await escena([...PISO, "usuarios.ver"]);
    await dueno.query(
      "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
      [e.empresa, e.persona],
    );
    await dueno.query("alter table rol_de_empresa disable trigger rol_de_empresa_archivado");
    await dueno.query("update rol_de_empresa set activo = false where id = $1", [e.rol]);
    await dueno.query("alter table rol_de_empresa enable trigger rol_de_empresa_archivado");
    expect(await delActor(e.empresa, e.persona)).toMatchObject({ rol: null, acciones: [] });
    // Reasignada a OPERADOR (sin reactivarse) y después reactivada: tiene las del OPERADOR, ninguna del rol archivado.
    await dueno.query("alter table membresia disable trigger membresia_cambio");
    await dueno.query(
      "update membresia set rol = 'OPERADOR', rol_propio_id = null, activo = true where empresa_id = $1 and persona_id = $2",
      [e.empresa, e.persona],
    );
    await dueno.query("alter table membresia enable trigger membresia_cambio");
    const actor = await delActor(e.empresa, e.persona);
    expect(actor.rol).toBe("OPERADOR");
    expect(actor.acciones).not.toContain("usuarios.ver");
  });

  it("un rol propio SIN versión legible (sin ninguna versión) queda sin acciones", async () => {
    const e = await escena([...PISO]);
    await dueno.query("alter table version_de_rol disable trigger user");
    await dueno.query("delete from version_de_rol where rol_id = $1", [e.rol]);
    await dueno.query("alter table version_de_rol enable trigger user");
    expect(await delActor(e.empresa, e.persona)).toMatchObject({ rol: "PROPIO", acciones: [] });
  });

  it("el alcance de sucursales de un PROPIO es el de sus asignaciones: nunca «todas» (falla cerrado)", async () => {
    const e = await escena([...PISO]);
    expect(await alcance(e.empresa, e.persona)).toEqual([]);
    await crearAsignacionDeBase(dueno, e.empresa, e.persona, e.sucursal);
    expect(await alcance(e.empresa, e.persona)).toEqual([sucursalId(e.sucursal)]);
  });
});
