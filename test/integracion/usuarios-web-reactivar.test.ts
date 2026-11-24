import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  desactivarUsuario,
  reactivarUsuario,
} from "../../src/composicion/usuarios-desactivar-y-reactivar-web";
import type { DependenciasDeUsuariosWeb } from "../../src/composicion/usuarios-web";
import { armarWeb } from "../../src/composicion/web";
import { personaId } from "../../src/primitivas/identificadores/marca";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../utilidades/marcas";
import { usuarioDePrueba } from "../utilidades/usuarios";
import { crearBaseAparte } from "./entorno";
import { crearEscenarioDeConfiguracion, otraPersona } from "./fiscal-configuracion-apoyo";
import {
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  sucursalDe,
} from "./fixtures-identidad";

/**
 * Reactivar a una persona desactivada (tramo U3, parte B) con la composición REAL (conexiones y web, base de verdad, roles limitados y las reglas reales de empresa). Reactivar es una INVITACIÓN NUEVA con el
 * mismo rol: el email y el rol los toma el servidor de la membresía, nunca del pedido. Cada prueba lleva el número del brief:
 *  - I8 reactivar: la invitación nueva sale con el mismo rol y UN mail; al aceptarla, la membresía vuelve a estar activa con el mismo rol; con otro rol (por fuera de la pantalla) el servidor lo rechaza al invitar;
 *  - idempotencia: reactivar dos veces (y dos a la vez) deja UNA invitación y UN mail, y la segunda dice «ya había»;
 *  - el pedido no manda ni email ni rol: si manda otros, se ignoran;
 *  - AISLAMIENTO: una persona de otra empresa es indistinguible de una inexistente y no se invita a nadie;
 *  - permisos: un empleado no reactiva a nadie; quien ya está activo o el gerente tampoco (el genérico, nada escrito);
 *  - desactivar y reactivar de punta a punta: el ciclo completo deja la auditoría esperada y nada borrado.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const GENERICO = {
  ok: false,
  error: expect.objectContaining({ codigo: "USUARIOS_NO_PERMITIDO" }) as unknown,
};

describe.skipIf(base === null)("usuarios: reactivar a una persona desactivada (web)", () => {
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
  const contar = async (sql: string, args: unknown[] = []) =>
    Number((await filas(sql, args))[0]?.["n"]);
  const membresia = async (e: Escenario, persona: string) =>
    (
      await filas("select activo, rol from membresia where empresa_id = $1 and persona_id = $2", [
        e.mundo.empresa,
        persona,
      ])
    )[0];
  const invitacionesDe = (e: Escenario, email: string) =>
    filas(
      `select i.id, i.estado, ie.rol from invitacion i join invitacion_empresa ie on ie.invitacion_id = i.id
        where ie.empresa_id = $1 and i.email = $2 order by i.emitida_en, i.id`,
      [e.mundo.empresa, email],
    );
  const trabajosDe = (e: Escenario) =>
    contar(
      "select count(*) as n from trabajo where empresa_id = $1 and tipo = 'enviar_invitacion'",
      [e.mundo.empresa],
    );
  /** Todo lo que escribiría reactivar en una empresa: si no cambia, no se escribió nada. */
  const foto = async (e: Escenario): Promise<string> =>
    JSON.stringify([
      await filas("select * from membresia where empresa_id = $1 order by persona_id", [
        e.mundo.empresa,
      ]),
      await filas(
        "select i.id, i.estado from invitacion i where i.id in (select invitacion_id from invitacion_empresa where empresa_id = $1) order by i.id",
        [e.mundo.empresa],
      ),
      await filas("select id, estado from trabajo where empresa_id = $1 order by id", [
        e.mundo.empresa,
      ]),
      await filas("select id, accion from auditoria_empresa where empresa_id = $1 order by id", [
        e.mundo.empresa,
      ]),
    ]);

  /** Una persona de la empresa, ya desactivada (como la dejaría desactivar). */
  async function desactivada(e: Escenario, rol: "ADMINISTRADOR" | "OPERADOR", prefijo = "dx") {
    const email = emailAlAzar(prefijo);
    const persona = await crearPersonaDeBase(dueno, email);
    await crearMembresiaDeBase(dueno, e.mundo.empresa, persona.id, rol, false);
    return { id: persona.id, email };
  }
  /** Acepta en el MISMO instante en que se emitió (la invitación vence a los 7 días del reloj del contexto de la prueba). */
  const aceptar = (token: string, email: string, e: Escenario) =>
    web.casosDeUsoDeIdentidad().aceptarInvitacion({
      token,
      emailAutenticado: email,
      usuarioAuth: usuarioDePrueba(email),
      marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
      ahora: e.como().ahora,
    });

  it("I8 reactivar crea UNA invitación vigente con el MISMO rol y sale UN mail; al aceptarla la persona vuelve activa con ese rol", async () => {
    const e = await nuevo();
    const ana = await desactivada(e, "OPERADOR");
    const sucursal = await sucursalDe(dueno, e.mundo.empresa);

    const r = datosDe(
      await reactivarUsuario(d(), e.como(), { personaId: ana.id, sucursales: [sucursal] }),
    );

    expect(r.yaExistia).toBe(false);
    expect(await invitacionesDe(e, ana.email)).toEqual([
      { id: r.invitacionId, estado: "PENDIENTE", rol: "OPERADOR" },
    ]);
    expect(await trabajosDe(e)).toBe(1);
    // La membresía no cambia hasta que la persona acepta.
    expect(await membresia(e, ana.id)).toMatchObject({ activo: false, rol: "OPERADOR" });

    const token = conexiones.tokens().derivar(r.invitacionId as never);
    expect((await aceptar(token, ana.email, e)).ok).toBe(true);
    expect(await membresia(e, ana.id)).toMatchObject({ activo: true, rol: "OPERADOR" });
  });

  it("un administrador desactivado vuelve como administrador y sin sucursales aunque se manden", async () => {
    const e = await nuevo();
    const otro = await desactivada(e, "ADMINISTRADOR");
    const sucursal = await sucursalDe(dueno, e.mundo.empresa);

    const r = datosDe(
      await reactivarUsuario(d(), e.como(), { personaId: otro.id, sucursales: [sucursal] }),
    );

    expect((await invitacionesDe(e, otro.email))[0]).toMatchObject({ rol: "ADMINISTRADOR" });
    expect(
      await contar("select count(*) as n from invitacion_sucursal where invitacion_id = $1", [
        r.invitacionId,
      ]),
    ).toBe(0);
    const token = conexiones.tokens().derivar(r.invitacionId as never);
    expect((await aceptar(token, otro.email, e)).ok).toBe(true);
    expect(await membresia(e, otro.id)).toMatchObject({ activo: true, rol: "ADMINISTRADOR" });
  });

  it("el pedido no manda email ni rol: si trae otros, se ignoran y sale la invitación del email y el rol de la persona", async () => {
    const e = await nuevo();
    const ana = await desactivada(e, "OPERADOR");
    const otroEmail = emailAlAzar("otro");

    datosDe(
      await reactivarUsuario(d(), e.como(), {
        personaId: ana.id,
        sucursales: [],
        email: otroEmail,
        rol: "ADMINISTRADOR",
        empresaId: "otra",
      }),
    );

    expect(await invitacionesDe(e, otroEmail)).toEqual([]);
    expect((await invitacionesDe(e, ana.email))[0]).toMatchObject({ rol: "OPERADOR" });
  });

  it("el servidor no deja invitar a un desactivado con OTRO rol (por fuera de la pantalla): el genérico y nada escrito", async () => {
    const e = await nuevo();
    const ana = await desactivada(e, "OPERADOR");
    const antes = await foto(e);

    const r = await web.casosDeUsoDeIdentidad().invitarUsuario(e.como(), {
      email: ana.email,
      rol: "ADMINISTRADOR",
      sucursales: [],
    });

    expect(r.ok).toBe(false);
    expect(await foto(e)).toBe(antes);
  });

  it("idempotencia: reactivar dos veces deja UNA invitación y UN mail, y la segunda dice «ya había»", async () => {
    const e = await nuevo();
    const ana = await desactivada(e, "OPERADOR");

    const primera = datosDe(await reactivarUsuario(d(), e.como(), { personaId: ana.id }));
    const antes = await foto(e);
    const segunda = datosDe(await reactivarUsuario(d(), e.como(), { personaId: ana.id }));

    expect(segunda).toEqual({ invitacionId: primera.invitacionId, yaExistia: true });
    expect(await foto(e)).toBe(antes);
    expect(await invitacionesDe(e, ana.email)).toHaveLength(1);
    expect(await trabajosDe(e)).toBe(1);
  });

  it("concurrencia: reactivar a la misma persona a la vez (dos clics, o dos administradores) deja UNA invitación y UN mail (20 corridas)", async () => {
    const e = await nuevo();
    const otro = await otraPersona(dueno, e, "ADMINISTRADOR");
    for (let corrida = 0; corrida < 20; corrida++) {
      const ana = await desactivada(e, "OPERADOR", `c${String(corrida)}`);
      const trabajosAntes = await trabajosDe(e);

      const resultados = await Promise.all([
        reactivarUsuario(d(), e.como(), { personaId: ana.id }),
        reactivarUsuario(d(), e.como(), { personaId: ana.id }),
        reactivarUsuario(d(), otro.como(), { personaId: ana.id }),
      ]);

      expect(
        resultados.every((r) => r.ok),
        `corrida ${String(corrida)}`,
      ).toBe(true);
      const ids = new Set(resultados.map((r) => (r.ok ? r.dato.invitacionId : "")));
      expect(ids.size, `corrida ${String(corrida)}: una sola invitación`).toBe(1);
      expect(resultados.filter((r) => r.ok && !r.dato.yaExistia)).toHaveLength(1);
      expect(await invitacionesDe(e, ana.email)).toHaveLength(1);
      expect(await trabajosDe(e), `corrida ${String(corrida)}: un solo mail`).toBe(
        trabajosAntes + 1,
      );
    }
  });

  it("AISLAMIENTO: reactivar a una persona de otra empresa da lo mismo que a una inexistente y no invita a nadie", async () => {
    const a = await nuevo();
    const b = await nuevo();
    const deB = await desactivada(b, "OPERADOR");
    const antesA = await foto(a);
    const antesB = await foto(b);

    const ajena = await reactivarUsuario(d(), a.como(), { personaId: deB.id });
    const inexistente = await reactivarUsuario(d(), a.como(), {
      personaId: personaId("0b0b0b0b-1111-4222-8333-4444444444ff"),
    });

    expect(ajena).toEqual(inexistente);
    expect(ajena).toEqual(GENERICO);
    expect(await foto(a)).toBe(antesA);
    expect(await foto(b)).toBe(antesB);
    expect(await invitacionesDe(a, deB.email)).toEqual([]);
  });

  it("permisos: un empleado no reactiva a nadie (el genérico y nada escrito)", async () => {
    const e = await nuevo();
    const empleado = await otraPersona(dueno, e, "OPERADOR");
    const ana = await desactivada(e, "OPERADOR");
    const antes = await foto(e);

    expect(await reactivarUsuario(d(), empleado.como(), { personaId: ana.id })).toEqual(GENERICO);

    expect(await foto(e)).toBe(antes);
  });

  it("quien ya está activo y el gerente no se reactivan: el genérico y nada escrito", async () => {
    const e = await nuevo();
    const admin = await otraPersona(dueno, e, "ADMINISTRADOR");
    const antes = await foto(e);

    expect(await reactivarUsuario(d(), e.como(), { personaId: admin.persona })).toEqual(GENERICO);
    expect(await reactivarUsuario(d(), admin.como(), { personaId: e.persona })).toEqual(GENERICO);

    expect(await foto(e)).toBe(antes);
  });

  it("una sucursal de otra empresa o una persona sin sucursales: la de otra empresa es el genérico; sin sucursales es válido (el empleado se asigna después)", async () => {
    const a = await nuevo();
    const b = await nuevo();
    const ana = await desactivada(a, "OPERADOR");
    const deB = await sucursalDe(dueno, b.mundo.empresa);
    const antes = await foto(a);

    expect(await reactivarUsuario(d(), a.como(), { personaId: ana.id, sucursales: [deB] })).toEqual(
      GENERICO,
    );
    expect(await foto(a)).toBe(antes);
    expect(datosDe(await reactivarUsuario(d(), a.como(), { personaId: ana.id })).yaExistia).toBe(
      false,
    );
  });

  it("el ciclo completo: desactivar, reactivar y aceptar deja a la persona activa con el mismo rol, sin borrar nada y con la auditoría de cada paso", async () => {
    const e = await nuevo();
    const email = emailAlAzar("ciclo");
    const persona = await crearPersonaDeBase(dueno, email);
    await crearMembresiaDeBase(dueno, e.mundo.empresa, persona.id, "OPERADOR", true);

    datosDe(await desactivarUsuario(d(), e.como(), { personaId: persona.id }));
    expect(await membresia(e, persona.id)).toMatchObject({ activo: false });
    const r = datosDe(await reactivarUsuario(d(), e.como(), { personaId: persona.id }));
    const token = conexiones.tokens().derivar(r.invitacionId as never);
    expect((await aceptar(token, email, e)).ok).toBe(true);

    expect(await membresia(e, persona.id)).toMatchObject({ activo: true, rol: "OPERADOR" });
    expect(await filas("select id from persona where id = $1", [persona.id])).toHaveLength(1);
    const acciones = (
      await filas(
        "select accion from auditoria_empresa where empresa_id = $1 and entidad_id in ($2, $3) order by id",
        [e.mundo.empresa, persona.id, r.invitacionId],
      )
    ).map((f) => f["accion"]);
    expect(acciones).toEqual(expect.arrayContaining(["MEMBRESIA_APAGADA", "INVITACION_EMITIDA"]));
  });
});
