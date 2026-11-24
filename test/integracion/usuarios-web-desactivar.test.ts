import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  desactivarUsuario,
  listarUsuarios,
  type DependenciasDeUsuariosWeb,
} from "../../src/composicion/usuarios-web";
import { armarWeb } from "../../src/composicion/web";
import { personaId } from "../../src/primitivas/identificadores/marca";
import { crearBaseAparte } from "./entorno";
import { crearEscenarioDeConfiguracion, otraPersona } from "./fiscal-configuracion-apoyo";
import {
  crearAsignacionDeBase,
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  incluirEmpresa,
  sucursalDe,
  tokenAlAzar,
} from "./fixtures-identidad";

/**
 * Desactivar a una persona desde su ficha (tramo U3, parte A) con la composición REAL (conexiones y web, base de verdad, roles limitados y las reglas reales de empresa). Cada prueba lleva el número del brief:
 *  - I1 idempotencia: desactivar dos veces (y dos a la vez) deja la membresía apagada y UNA sola auditoría `MEMBRESIA_APAGADA`;
 *  - I2 atomicidad: si falla el paso que revoca las invitaciones, no queda nada a medias (ni membresía apagada, ni asignaciones apagadas, ni auditoría);
 *  - I3 efectos: la invitación pendiente a ese email queda revocada, las asignaciones apagadas y no se borra nada;
 *  - I4 el gerente no se desactiva y I10 nadie se desactiva a sí mismo (H3): el genérico y nada escrito;
 *  - I5 corte de acceso: apagada la membresía, la persona no puede hacer nada más en la empresa (ni siquiera ver la lista);
 *  - I6 aislamiento: una persona de OTRA empresa es indistinguible de una inexistente y no se toca;
 *  - I7 permisos: un empleado no desactiva a nadie;
 *  - I9 traspaso: desactivar al entrante de un traspaso en curso lo cancela en la misma transacción;
 *  - la empresa suspendida no desactiva a nadie.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const GENERICO = { ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } };

describe.skipIf(base === null)("usuarios: desactivar a una persona de la empresa (web)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexiones: Conexiones;
  let web: ReturnType<typeof armarWeb>;
  const registrados: string[] = [];

  const d = (): DependenciasDeUsuariosWeb => ({
    casosDeUso: web.casosDeUsoDeIdentidad,
    consultas: web.consultasDeIdentidad,
    respuesta: { registrar: (x) => registrados.push(x) },
  });

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    const fuente = {
      PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
      PEDERNAL_DB_APP: propia.base.app,
      // Los casos de uso de identidad arman sus tokens de invitación aunque desactivar no los use.
      PEDERNAL_SECRETO_INVITACIONES: randomBytes(32).toString("hex"),
    };
    conexiones = armarConexiones({ fuente: () => fuente, registrar: (x) => registrados.push(x) });
    web = armarWeb(conexiones);
  }, 120_000);
  afterAll(async () => {
    await conexiones.transaccionesDeApp().cerrar();
    await dueno.end();
    await propia.destruir();
  });

  const nuevo = (rol: "GERENTE" | "ADMINISTRADOR" | "OPERADOR" = "GERENTE") =>
    crearEscenarioDeConfiguracion(dueno, { rol });
  type Escenario = Awaited<ReturnType<typeof nuevo>>;

  const datosDe = <T>(r: Respuesta<T>): T => {
    if (!r.ok) throw new Error(`se esperaba ok: ${JSON.stringify(r.error)}`);
    return r.dato;
  };
  const filas = async (sql: string, args: unknown[] = []) =>
    (await dueno.query(sql, args)).rows as Record<string, unknown>[];
  const membresia = async (e: Escenario, persona: string) =>
    (
      await filas("select activo, rol from membresia where empresa_id = $1 and persona_id = $2", [
        e.mundo.empresa,
        persona,
      ])
    )[0];
  const auditorias = async (e: Escenario, accion: string) =>
    filas("select entidad_id from auditoria_empresa where empresa_id = $1 and accion = $2", [
      e.mundo.empresa,
      accion,
    ]);
  const todoLoDeLaEmpresa = async (e: Escenario): Promise<string> =>
    JSON.stringify([
      await filas("select * from membresia where empresa_id = $1 order by persona_id", [
        e.mundo.empresa,
      ]),
      await filas(
        "select * from asignacion_sucursal where empresa_id = $1 order by persona_id, sucursal_id",
        [e.mundo.empresa],
      ),
      await filas("select id, accion from auditoria_empresa where empresa_id = $1 order by id", [
        e.mundo.empresa,
      ]),
      await filas(
        "select i.id, i.estado from invitacion i where i.id in (select invitacion_id from invitacion_empresa where empresa_id = $1) order by i.id",
        [e.mundo.empresa],
      ),
    ]);

  /** Suma una persona con membresía a la empresa del escenario. */
  async function sumar(
    e: Escenario,
    email: string,
    rol: "ADMINISTRADOR" | "OPERADOR",
  ): Promise<{ id: string; email: string }> {
    const persona = await crearPersonaDeBase(dueno, email);
    await crearMembresiaDeBase(dueno, e.mundo.empresa, persona.id, rol);
    return { id: persona.id, email };
  }
  /** Una invitación pendiente de usuario a la empresa del escenario. */
  async function invitar(e: Escenario, email: string) {
    const { tokenHash } = tokenAlAzar();
    const inv = await crearInvitacionDeBase(dueno, { tenant: e.mundo.tenant, email, tokenHash });
    await incluirEmpresa(dueno, inv, e.mundo.empresa, "OPERADOR");
    return inv;
  }
  const estadoDeInvitacion = async (id: string) =>
    (await filas("select estado from invitacion where id = $1", [id]))[0]?.["estado"];

  it("I1 idempotencia: desactivar dos veces deja la membresía apagada y UNA sola auditoría; la segunda no escribe", async () => {
    const e = await nuevo("GERENTE");
    const ana = await sumar(e, "ana-i1@prueba.test", "OPERADOR");

    expect(datosDe(await desactivarUsuario(d(), e.como(), { personaId: ana.id }))).toEqual({
      yaEstabaApagada: false,
    });
    const despues = await todoLoDeLaEmpresa(e);
    expect(datosDe(await desactivarUsuario(d(), e.como(), { personaId: ana.id }))).toEqual({
      yaEstabaApagada: true,
    });

    expect(await todoLoDeLaEmpresa(e)).toBe(despues);
    expect(await membresia(e, ana.id)).toMatchObject({ activo: false });
    expect(await auditorias(e, "MEMBRESIA_APAGADA")).toHaveLength(1);
  });

  it("I1 el doble clic: dos desactivaciones a la vez de la misma persona son ok las dos y dejan una sola auditoría", async () => {
    const e = await nuevo("GERENTE");
    const otroAdmin = await otraPersona(dueno, e, "ADMINISTRADOR");
    const ana = await sumar(e, "ana-i1b@prueba.test", "OPERADOR");
    await crearAsignacionDeBase(
      dueno,
      e.mundo.empresa,
      ana.id,
      await sucursalDe(dueno, e.mundo.empresa),
    );

    const [uno, dos, tres] = await Promise.all([
      desactivarUsuario(d(), e.como(), { personaId: ana.id }),
      desactivarUsuario(d(), e.como(), { personaId: ana.id }),
      desactivarUsuario(d(), otroAdmin.como(), { personaId: ana.id }),
    ]);

    expect([uno.ok, dos.ok, tres.ok]).toEqual([true, true, true]);
    expect(
      [uno, dos, tres].filter((r) => r.ok && !r.dato.yaEstabaApagada),
      "solo una escribió",
    ).toHaveLength(1);
    expect(await membresia(e, ana.id)).toMatchObject({ activo: false });
    expect(await auditorias(e, "MEMBRESIA_APAGADA")).toHaveLength(1);
  });

  it("I2 atomicidad: si falla el paso que revoca las invitaciones no queda nada a medias", async () => {
    const e = await nuevo("GERENTE");
    const ana = await sumar(e, "ana-i2@prueba.test", "OPERADOR");
    await crearAsignacionDeBase(
      dueno,
      e.mundo.empresa,
      ana.id,
      await sucursalDe(dueno, e.mundo.empresa),
    );
    const pendiente = await invitar(e, ana.email);
    const antes = await todoLoDeLaEmpresa(e);

    // Un disparador que solo salta con ESTA invitación: apagar la membresía y sus asignaciones ya pasó cuando se intenta revocarla.
    const nombre = `falla_i2_${pendiente.id.replaceAll("-", "").slice(0, 8)}`;
    await dueno.query(
      `create function ${nombre}() returns trigger language plpgsql as $$ begin raise exception 'falla forzada de la prueba'; end $$`,
    );
    await dueno.query(
      `create trigger ${nombre} before update on invitacion for each row when (old.id = '${pendiente.id}') execute function ${nombre}()`,
    );
    try {
      registrados.length = 0;
      const r = await desactivarUsuario(d(), e.como(), { personaId: ana.id });
      expect(r.ok).toBe(false);
      // Un fallo inesperado de la base sale con referencia y sin el detalle.
      expect(JSON.stringify(r)).not.toContain("falla forzada");
    } finally {
      await dueno.query(`drop trigger ${nombre} on invitacion`);
      await dueno.query(`drop function ${nombre}()`);
    }

    expect(await todoLoDeLaEmpresa(e)).toBe(antes);
    expect(await membresia(e, ana.id)).toMatchObject({ activo: true });
    expect(await auditorias(e, "MEMBRESIA_APAGADA")).toHaveLength(0);
    expect(await estadoDeInvitacion(pendiente.id)).toBe("PENDIENTE");
    // Y sin el fallo, el mismo pedido sale bien: nada quedó trabado.
    expect(datosDe(await desactivarUsuario(d(), e.como(), { personaId: ana.id }))).toEqual({
      yaEstabaApagada: false,
    });
  });

  it("I3 efectos: revoca su invitación pendiente, apaga sus sucursales y no borra nada", async () => {
    const e = await nuevo("GERENTE");
    const ana = await sumar(e, "ana-i3@prueba.test", "OPERADOR");
    const otra = await sumar(e, "otra-i3@prueba.test", "OPERADOR");
    const suc = await sucursalDe(dueno, e.mundo.empresa);
    await crearAsignacionDeBase(dueno, e.mundo.empresa, ana.id, suc);
    await crearAsignacionDeBase(dueno, e.mundo.empresa, otra.id, suc);
    const deAna = await invitar(e, ana.email);
    const deOtra = await invitar(e, "ajena-i3@prueba.test");

    datosDe(await desactivarUsuario(d(), e.como(), { personaId: ana.id }));

    expect(await estadoDeInvitacion(deAna.id)).toBe("REVOCADA");
    expect(await estadoDeInvitacion(deOtra.id)).toBe("PENDIENTE");
    expect(
      await filas("select activa from asignacion_sucursal where persona_id = $1", [ana.id]),
    ).toEqual([{ activa: false }]);
    expect(
      await filas("select activa from asignacion_sucursal where persona_id = $1", [otra.id]),
    ).toEqual([{ activa: true }]);
    // No se borra nada: la persona y su membresía siguen, solo apagada, y la lista la muestra «desactivada».
    expect(await filas("select id from persona where id = $1", [ana.id])).toHaveLength(1);
    const lista = datosDe(await listarUsuarios(d(), e.como()));
    expect(lista.usuarios.find((u) => u.personaId === ana.id)).toMatchObject({ activo: false });
    expect(lista.invitaciones.map((i) => i.email)).toEqual(["ajena-i3@prueba.test"]);
    const auditoria = await auditorias(e, "MEMBRESIA_APAGADA");
    expect(auditoria).toEqual([{ entidad_id: ana.id }]);
  });

  it("I4 el gerente no se desactiva, ni siquiera por fuera de la pantalla: el genérico y nada escrito", async () => {
    const e = await nuevo("GERENTE");
    const admin = await otraPersona(dueno, e, "ADMINISTRADOR");
    const antes = await todoLoDeLaEmpresa(e);

    expect(await desactivarUsuario(d(), admin.como(), { personaId: e.persona })).toMatchObject(
      GENERICO,
    );

    expect(await todoLoDeLaEmpresa(e)).toBe(antes);
    expect(await membresia(e, e.persona)).toMatchObject({ activo: true, rol: "GERENTE" });
  });

  it("I10 nadie se desactiva a sí mismo (H3): ni un administrador ni el gerente; el genérico y nada escrito", async () => {
    const e = await nuevo("GERENTE");
    const admin = await otraPersona(dueno, e, "ADMINISTRADOR");
    const antes = await todoLoDeLaEmpresa(e);

    expect(await desactivarUsuario(d(), admin.como(), { personaId: admin.persona })).toMatchObject(
      GENERICO,
    );
    expect(await desactivarUsuario(d(), e.como(), { personaId: e.persona })).toMatchObject(
      GENERICO,
    );

    expect(await todoLoDeLaEmpresa(e)).toBe(antes);
    expect(await membresia(e, admin.persona)).toMatchObject({ activo: true });
  });

  it("un administrador puede desactivar a otro administrador (se gestionan por igual)", async () => {
    const e = await nuevo("ADMINISTRADOR");
    const otro = await otraPersona(dueno, e, "ADMINISTRADOR");

    datosDe(await desactivarUsuario(d(), e.como(), { personaId: otro.persona }));

    expect(await membresia(e, otro.persona)).toMatchObject({ activo: false });
    expect(await membresia(e, e.persona)).toMatchObject({ activo: true });
  });

  it("I5 corte de acceso: la persona desactivada ya no puede hacer nada en la empresa (ni ver la lista)", async () => {
    const e = await nuevo("GERENTE");
    const admin = await otraPersona(dueno, e, "ADMINISTRADOR");
    expect(datosDe(await listarUsuarios(d(), admin.como())).usuarios.length).toBeGreaterThan(0);

    datosDe(await desactivarUsuario(d(), e.como(), { personaId: admin.persona }));

    expect(await listarUsuarios(d(), admin.como())).toMatchObject(GENERICO);
    expect(await desactivarUsuario(d(), admin.como(), { personaId: e.persona })).toMatchObject(
      GENERICO,
    );
    expect(await membresia(e, e.persona)).toMatchObject({ activo: true });
  });

  it("I6 AISLAMIENTO: desactivar a una persona de otra empresa da lo mismo que a una inexistente y no la toca", async () => {
    const a = await nuevo("GERENTE");
    const b = await nuevo("GERENTE");
    const deB = await sumar(b, "ajena-i6@prueba.test", "OPERADOR");
    const antesA = await todoLoDeLaEmpresa(a);
    const antesB = await todoLoDeLaEmpresa(b);

    const ajena = await desactivarUsuario(d(), a.como(), { personaId: deB.id });
    const inexistente = await desactivarUsuario(d(), a.como(), {
      personaId: personaId("0b0b0b0b-1111-4222-8333-4444444444ff"),
    });

    expect(ajena).toEqual(inexistente);
    expect(ajena).toMatchObject(GENERICO);
    expect(await todoLoDeLaEmpresa(a)).toBe(antesA);
    expect(await todoLoDeLaEmpresa(b)).toBe(antesB);
    expect(await membresia(b, deB.id)).toMatchObject({ activo: true });
  });

  it("I7 permisos: un empleado que llama a la acción directamente recibe el genérico y no escribe nada", async () => {
    const e = await nuevo("GERENTE");
    const empleado = await otraPersona(dueno, e, "OPERADOR");
    const ana = await sumar(e, "ana-i7@prueba.test", "OPERADOR");
    const antes = await todoLoDeLaEmpresa(e);

    expect(await desactivarUsuario(d(), empleado.como(), { personaId: ana.id })).toMatchObject(
      GENERICO,
    );

    expect(await todoLoDeLaEmpresa(e)).toBe(antes);
  });

  it("el pedido solo lleva el id: un rol, un email o una empresa que mande el navegador no cambian nada", async () => {
    const e = await nuevo("GERENTE");
    const b = await nuevo("GERENTE");
    const ana = await sumar(e, "ana-lista@prueba.test", "OPERADOR");

    datosDe(
      await desactivarUsuario(d(), e.como(), {
        personaId: ana.id,
        empresaId: b.mundo.empresa,
        rol: "GERENTE",
        actor: b.persona,
      }),
    );

    expect(await membresia(e, ana.id)).toMatchObject({ activo: false, rol: "OPERADOR" });
    expect(await membresia(b, b.persona)).toMatchObject({ activo: true });
  });

  it("I9 traspaso: desactivar al entrante de un traspaso en curso lo cancela en la misma transacción", async () => {
    const e = await nuevo("GERENTE");
    const entrante = await sumar(e, "entrante-i9@prueba.test", "ADMINISTRADOR");
    const propuesta = await web
      .casosDeUsoDeIdentidad()
      .proponerTraspaso(e.como(), { entrantePersonaId: personaId(entrante.id) });
    if (!propuesta.ok) throw new Error(`no se pudo proponer: ${JSON.stringify(propuesta.error)}`);

    datosDe(await desactivarUsuario(d(), e.como(), { personaId: entrante.id }));

    expect(
      await filas("select estado, motivo from traspaso_gerencia where id = $1", [
        propuesta.valor.traspasoId,
      ]),
    ).toEqual([{ estado: "CANCELADO", motivo: "ENTRANTE_DADO_DE_BAJA" }]);
    expect(await membresia(e, entrante.id)).toMatchObject({ activo: false });
  });

  it("una empresa suspendida no desactiva a nadie: el genérico y nada escrito", async () => {
    const e = await nuevo("GERENTE");
    const ana = await sumar(e, "ana-susp@prueba.test", "OPERADOR");
    await dueno.query(
      "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
      [e.mundo.empresa],
    );
    const antes = await todoLoDeLaEmpresa(e);

    expect(await desactivarUsuario(d(), e.como(), { personaId: ana.id })).toMatchObject(GENERICO);

    expect(await todoLoDeLaEmpresa(e)).toBe(antes);
  });

  it("dos administradores que se desactivan entre sí a la vez: nunca queda la empresa sin nadie que pueda administrar", async () => {
    for (let ronda = 0; ronda < 5; ronda++) {
      const e = await nuevo("ADMINISTRADOR");
      const otro = await otraPersona(dueno, e, "ADMINISTRADOR");
      // Sin gerente activo (una empresa vieja): solo ellos dos pueden administrar.
      await dueno.query("delete from membresia where empresa_id = $1 and rol = 'GERENTE'", [
        e.mundo.empresa,
      ]);

      const resultados = await Promise.all([
        desactivarUsuario(d(), e.como(), { personaId: otro.persona }),
        desactivarUsuario(d(), otro.como(), { personaId: e.persona }),
      ]);

      const activos = await filas(
        "select persona_id from membresia where empresa_id = $1 and activo",
        [e.mundo.empresa],
      );
      expect(activos.length, `ronda ${ronda}: quedó sin administrador`).toBeGreaterThanOrEqual(1);
      expect(resultados.filter((r) => r.ok).length, `ronda ${ronda}: se apagaron los dos`).toBe(1);
      expect(
        resultados.find((r) => !r.ok),
        `ronda ${ronda}`,
      ).toMatchObject(GENERICO);
      expect(await auditorias(e, "MEMBRESIA_APAGADA")).toHaveLength(1);
    }
  });
});
