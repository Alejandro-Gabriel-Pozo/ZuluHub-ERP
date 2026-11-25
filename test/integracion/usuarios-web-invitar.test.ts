import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  fichaDeInvitacion,
  invitar,
  listarUsuarios,
  reenviar,
  revocar,
  type DependenciasDeUsuariosWeb,
} from "../../src/composicion/usuarios-web";
import { armarWeb } from "../../src/composicion/web";
import { crearBaseAparte } from "./entorno";
import { crearEscenarioDeConfiguracion } from "./fiscal-configuracion-apoyo";
import {
  aceptarDeBase,
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  incluirEmpresa,
  revocarDeBase,
  tokenAlAzar,
} from "./fixtures-identidad";

/**
 * Invitar, reenviar y revocar (tramo U2) con la composición REAL (conexiones y web, base de verdad, roles limitados y las reglas reales de empresa). Lo que se prueba es el CABLEADO de `invitar`,
 * `reenviar`, `revocar` y `fichaDeInvitacion` (las reglas de cada caso de uso están en `identidad-casos-de-uso.test.ts`):
 *  - I1 doble envío: la misma invitación enviada dos veces deja UNA fila, UN trabajo de mail y UNA auditoría; la segunda dice `yaExistia`;
 *  - I2 concurrencia: dos invitaciones al mismo email a la vez (con roles distintos y con el mismo) dejan UNA, con el rol de la primera confirmada; la otra no guarda el suyo (20 corridas);
 *  - I3 reenviar dos veces y a la vez: una sola invitación nueva vigente, la anterior revocada con `reemplazada_por` y UN mail encolado por invitación nueva;
 *  - I4 revocar contra aceptar: el estado final es coherente (nunca aceptada y revocada);
 *  - I5 la vencida se reemplaza al invitar y se reenvía;
 *  - I6 aislamiento: una invitación de otra empresa da el genérico y no escribe;
 *  - I7 permisos: el empleado que llama directo recibe el genérico y no escribe; el Gerente no se invita;
 *  - I8 ya es miembro: no escribe y dice «Ya es parte de la empresa»;
 *  - I9 la empresa suspendida da el genérico y no escribe;
 *  - I10 el trabajo del mail no lleva el token;
 *  - I11 H1: invitar a un desactivado con otro rol se rechaza al invitar (no recién al aceptar).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const GENERICO = {
  ok: false,
  error: expect.objectContaining({ codigo: "USUARIOS_NO_PERMITIDO" }) as unknown,
};

describe.skipIf(base === null)("usuarios: invitar, reenviar y revocar (web)", () => {
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

  const nuevo = (rol: "GERENTE" | "ADMINISTRADOR" | "OPERADOR" = "GERENTE", estado?: "SUSPENDED") =>
    crearEscenarioDeConfiguracion(dueno, { rol, ...(estado === undefined ? {} : { estado }) });
  type Escenario = Awaited<ReturnType<typeof nuevo>>;

  const datosDe = <T>(r: Respuesta<T>): T => {
    if (!r.ok) throw new Error(`se esperaba ok: ${JSON.stringify(r.error)}`);
    return r.dato;
  };
  const filas = async <T extends Record<string, unknown> = Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []): Promise<number> =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);

  const invitacionesDe = (empresa: string, email: string) =>
    filas<{ id: string; estado: string; reemplazada_por: string | null }>(
      "select id, estado, reemplazada_por from invitacion where id in (select invitacion_id from invitacion_empresa where empresa_id = $1 and email = $2) order by emitida_en, id",
      [empresa, email],
    );
  const pendientesDe = (empresa: string, email: string) =>
    contar(
      "select count(*) as n from invitacion_empresa where empresa_id = $1 and email = $2 and estado = 'PENDIENTE'",
      [empresa, email],
    );
  const rolesDe = (invitacionId: string) =>
    filas<{ rol: string }>("select rol from invitacion_empresa where invitacion_id = $1", [
      invitacionId,
    ]);
  const trabajosDe = (empresa: string) =>
    filas<{ datos: Record<string, unknown>; clave_idempotencia: string }>(
      "select datos, clave_idempotencia from trabajo where empresa_id = $1 and tipo = 'enviar_invitacion' order by creado_en, id",
      [empresa],
    );
  const auditoriaDe = (empresa: string, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      empresa,
      accion,
    ]);
  /** Todo lo que escribiría invitar, reenviar o revocar en una empresa: si no cambia, no se escribió nada. */
  const foto = async (empresa: string) =>
    JSON.stringify([
      await filas(
        "select i.id, i.estado, i.reemplazada_por, i.version from invitacion i where i.id in (select invitacion_id from invitacion_empresa where empresa_id = $1) order by i.id",
        [empresa],
      ),
      await filas("select id, estado from trabajo where empresa_id = $1 order by id", [empresa]),
      await auditoriaDe(empresa, "INVITACION_EMITIDA"),
      await auditoriaDe(empresa, "INVITACION_REENVIADA"),
      await auditoriaDe(empresa, "INVITACION_REVOCADA"),
    ]);

  /** Una invitación pendiente armada por el dueño de la base (con su vencimiento). */
  async function pendiente(
    e: Escenario,
    email: string,
    rol: "ADMINISTRADOR" | "OPERADOR",
    venceEn: Date,
  ) {
    const inv = await crearInvitacionDeBase(dueno, {
      tenant: e.mundo.tenant,
      email,
      venceEn,
      tokenHash: tokenAlAzar().tokenHash,
    });
    await incluirEmpresa(dueno, inv, e.mundo.empresa, rol);
    return inv;
  }

  const enUnaSemana = () => new Date(Date.now() + 7 * 86_400_000);

  it("I1 doble envío: invitar crea la invitación; la segunda vez devuelve la misma, sin otra fila, otro mail ni otra auditoría", async () => {
    const e = await nuevo();
    const email = emailAlAzar("doble");
    const pedido = { email, rol: "OPERADOR", sucursales: [e.mundo.sucursal] };

    const primera = datosDe(await invitar(d(), e.como(), pedido));
    expect(primera.yaExistia).toBe(false);
    const despues = await foto(e.mundo.empresa);
    const segunda = datosDe(
      await invitar(d(), e.como(), { ...pedido, email: email.toUpperCase() }),
    );

    expect(segunda).toEqual({ invitacionId: primera.invitacionId, yaExistia: true });
    expect(await foto(e.mundo.empresa)).toBe(despues);
    expect(await invitacionesDe(e.mundo.empresa, email)).toHaveLength(1);
    expect(await trabajosDe(e.mundo.empresa)).toHaveLength(1);
    expect(await auditoriaDe(e.mundo.empresa, "INVITACION_EMITIDA")).toBe(1);
    expect(
      await contar("select count(*) as n from invitacion_sucursal where invitacion_id = $1", [
        primera.invitacionId,
      ]),
    ).toBe(1);
  });

  it("I2 concurrencia: dos invitaciones al mismo email a la vez con roles distintos dejan UNA, con el rol de la primera confirmada; la otra no guarda el suyo (20 corridas)", async () => {
    const e = await nuevo();
    const otro = await crearEscenarioDeConfiguracion(dueno, { rol: "ADMINISTRADOR" });
    // Un segundo administrador DE LA MISMA empresa: dos personas distintas invitando al mismo tiempo.
    const persona = (await crearPersonaDeBase(dueno)).id;
    await crearMembresiaDeBase(dueno, e.mundo.empresa, persona, "ADMINISTRADOR");
    const segundoCtx = { ...e.como(), personaId: persona } as ReturnType<typeof e.como>;
    void otro;

    for (let corrida = 0; corrida < 20; corrida++) {
      const email = emailAlAzar(`carrera${String(corrida)}`);
      const [a, b] = await Promise.all([
        invitar(d(), e.como(), { email, rol: "OPERADOR", sucursales: [] }),
        invitar(d(), segundoCtx, { email, rol: "ADMINISTRADOR", sucursales: [] }),
      ]);

      const filasDelEmail = await invitacionesDe(e.mundo.empresa, email);
      expect(filasDelEmail, `corrida ${String(corrida)}`).toHaveLength(1);
      expect(await pendientesDe(e.mundo.empresa, email)).toBe(1);
      const ganadora = filasDelEmail[0]?.id as string;
      const rolGuardado = (await rolesDe(ganadora))[0]?.rol as "OPERADOR" | "ADMINISTRADOR";
      // Una sola creó; la otra dijo «ya había una» (roles distintos: no se hace pasar por hecho lo pedido) y su rol NO quedó guardado.
      const resultados = [
        { respuesta: a, rol: "OPERADOR" },
        { respuesta: b, rol: "ADMINISTRADOR" },
      ];
      const creadoras = resultados.filter((r) => r.respuesta.ok && !r.respuesta.dato.yaExistia);
      expect(creadoras).toHaveLength(1);
      expect(creadoras[0]?.rol).toBe(rolGuardado);
      const perdedora = resultados.find((r) => r !== creadoras[0]);
      expect(perdedora?.respuesta).toEqual({
        ok: false,
        error: expect.objectContaining({ codigo: "USUARIOS_YA_HABIA_INVITACION" }) as unknown,
      });
      expect(await trabajosDe(e.mundo.empresa)).toHaveLength(corrida + 1);
    }
  });

  it("I2 concurrencia: dos invitaciones al mismo email y el MISMO rol a la vez dejan UNA, y la otra dice «ya había» sin error (20 corridas)", async () => {
    const e = await nuevo();
    for (let corrida = 0; corrida < 20; corrida++) {
      const email = emailAlAzar(`mismo${String(corrida)}`);
      const pedido = { email, rol: "OPERADOR", sucursales: [] };
      const [a, b] = await Promise.all([
        invitar(d(), e.como(), pedido),
        invitar(d(), e.como(), pedido),
      ]);
      const [x, y] = [datosDe(a), datosDe(b)];
      expect(x.invitacionId).toBe(y.invitacionId);
      expect([x.yaExistia, y.yaExistia].sort()).toEqual([false, true]);
      expect(await invitacionesDe(e.mundo.empresa, email)).toHaveLength(1);
    }
    expect(await trabajosDe(e.mundo.empresa)).toHaveLength(20);
    expect(await auditoriaDe(e.mundo.empresa, "INVITACION_EMITIDA")).toBe(20);
  });

  it("I3 reenviar dos veces seguidas deja UNA invitación nueva vigente: la anterior queda revocada con `reemplazada_por` y sale UN mail por invitación nueva", async () => {
    const e = await nuevo();
    const email = emailAlAzar("reenvio");
    const origen = datosDe(
      await invitar(d(), e.como(), { email, rol: "OPERADOR", sucursales: [] }),
    );

    const primera = datosDe(await reenviar(d(), e.como(), { invitacionId: origen.invitacionId }));
    expect(primera.yaEstabaReenviada).toBe(false);
    expect(primera.invitacionId).not.toBe(origen.invitacionId);
    const despues = await foto(e.mundo.empresa);
    const segunda = datosDe(await reenviar(d(), e.como(), { invitacionId: origen.invitacionId }));

    expect(segunda).toEqual({ invitacionId: primera.invitacionId, yaEstabaReenviada: true });
    expect(await foto(e.mundo.empresa)).toBe(despues);
    expect(await pendientesDe(e.mundo.empresa, email)).toBe(1);
    const todas = await invitacionesDe(e.mundo.empresa, email);
    expect(todas).toHaveLength(2);
    expect(todas.find((i) => i.id === origen.invitacionId)).toMatchObject({
      estado: "REVOCADA",
      reemplazada_por: primera.invitacionId,
    });
    // Un trabajo por invitación (la de origen y la nueva), cada uno con su clave: el de la reemplazada se omite al correr.
    const trabajos = await trabajosDe(e.mundo.empresa);
    expect(trabajos.map((t) => t.datos["invitacionId"]).sort()).toEqual(
      [origen.invitacionId, primera.invitacionId].sort(),
    );
    expect(await auditoriaDe(e.mundo.empresa, "INVITACION_REENVIADA")).toBe(1);
  });

  it("I3 reenviar a la vez desde dos pestañas deja UNA invitación nueva (10 corridas)", async () => {
    const e = await nuevo();
    for (let corrida = 0; corrida < 10; corrida++) {
      const email = emailAlAzar(`reenvios${String(corrida)}`);
      const origen = datosDe(
        await invitar(d(), e.como(), { email, rol: "ADMINISTRADOR", sucursales: [] }),
      );
      const [a, b] = await Promise.all([
        reenviar(d(), e.como(), { invitacionId: origen.invitacionId }),
        reenviar(d(), e.como(), { invitacionId: origen.invitacionId }),
      ]);
      const [x, y] = [datosDe(a), datosDe(b)];
      expect(x.invitacionId).toBe(y.invitacionId);
      expect([x.yaEstabaReenviada, y.yaEstabaReenviada].sort()).toEqual([false, true]);
      expect(await pendientesDe(e.mundo.empresa, email)).toBe(1);
      expect(await invitacionesDe(e.mundo.empresa, email)).toHaveLength(2);
    }
  });

  it("revocar saca la invitación de la lista; repetirlo no escribe ni audita otra vez; una revocada ya no se reenvía", async () => {
    const e = await nuevo();
    const email = emailAlAzar("revoca");
    const emitida = datosDe(
      await invitar(d(), e.como(), { email, rol: "OPERADOR", sucursales: [] }),
    );

    expect(datosDe(await revocar(d(), e.como(), { invitacionId: emitida.invitacionId }))).toEqual({
      yaEstabaRevocada: false,
    });
    const despues = await foto(e.mundo.empresa);
    expect(datosDe(await revocar(d(), e.como(), { invitacionId: emitida.invitacionId }))).toEqual({
      yaEstabaRevocada: true,
    });

    expect(await foto(e.mundo.empresa)).toBe(despues);
    expect(await auditoriaDe(e.mundo.empresa, "INVITACION_REVOCADA")).toBe(1);
    expect(datosDe(await listarUsuarios(d(), e.como())).invitaciones).toEqual([]);
    expect(await reenviar(d(), e.como(), { invitacionId: emitida.invitacionId })).toEqual(GENERICO);
  });

  it("I4 revocar contra aceptar a la vez: gana una y el estado es coherente (nunca aceptada y revocada); revocar una ya aceptada es el genérico", async () => {
    const e = await nuevo();
    for (let corrida = 0; corrida < 10; corrida++) {
      const email = emailAlAzar(`rvsa${String(corrida)}`);
      const inv = await pendiente(e, email, "OPERADOR", enUnaSemana());
      const aceptante = (await crearPersonaDeBase(dueno, email)).id;
      const [revocacion] = await Promise.all([
        revocar(d(), e.como(), { invitacionId: inv.id }),
        aceptarDeBase(dueno, inv, aceptante).catch(() => undefined),
      ]);
      const [fila] = await filas<{ estado: string; aceptada_por: string | null }>(
        "select estado, aceptada_por from invitacion where id = $1",
        [inv.id],
      );
      expect(["ACEPTADA", "REVOCADA"]).toContain(fila?.estado);
      if (fila?.estado === "ACEPTADA") {
        // Perdió la revocación o llegó antes la aceptación: nunca las dos cosas.
        expect(fila.aceptada_por).toBe(aceptante);
        if (!revocacion.ok) expect(revocacion).toEqual(GENERICO);
      } else {
        expect(fila?.aceptada_por).toBeNull();
      }
    }
    const emailYa = emailAlAzar("aceptada");
    const ya = await pendiente(e, emailYa, "OPERADOR", enUnaSemana());
    await aceptarDeBase(dueno, ya, (await crearPersonaDeBase(dueno, emailYa)).id);
    const antes = await foto(e.mundo.empresa);
    expect(await revocar(d(), e.como(), { invitacionId: ya.id })).toEqual(GENERICO);
    expect(await foto(e.mundo.empresa)).toBe(antes);
  });

  it("I5 vencida: invitar al email de una vencida la reemplaza (la vieja queda revocada, la nueva vigente) y reenviar una vencida funciona", async () => {
    const e = await nuevo();
    const email = emailAlAzar("vencida");
    const vieja = await pendiente(e, email, "OPERADOR", enUnaSemana());
    // El reloj del contexto pasa los 7 días: la invitación llegó a su vencimiento (no se guarda, se calcula).
    const pasadaLaSemana = e.como(new Date(Date.now() + 8 * 86_400_000));

    const nueva = datosDe(
      await invitar(d(), pasadaLaSemana, { email, rol: "ADMINISTRADOR", sucursales: [] }),
    );

    expect(nueva.yaExistia).toBe(false);
    expect(nueva.invitacionId).not.toBe(vieja.id);
    const todas = await invitacionesDe(e.mundo.empresa, email);
    expect(todas.find((i) => i.id === vieja.id)).toMatchObject({
      estado: "REVOCADA",
      reemplazada_por: nueva.invitacionId,
    });
    expect(await pendientesDe(e.mundo.empresa, email)).toBe(1);
    expect((await rolesDe(nueva.invitacionId))[0]?.rol).toBe("ADMINISTRADOR");

    const otraVencida = await pendiente(e, emailAlAzar("vencida2"), "OPERADOR", enUnaSemana());
    expect(
      datosDe(await fichaDeInvitacion(d(), pasadaLaSemana, { invitacionId: otraVencida.id }))
        .vencida,
    ).toBe(true);
    const reenviada = datosDe(
      await reenviar(d(), pasadaLaSemana, { invitacionId: otraVencida.id }),
    );
    expect(reenviada.yaEstabaReenviada).toBe(false);
    const ficha = datosDe(
      await fichaDeInvitacion(d(), pasadaLaSemana, { invitacionId: reenviada.invitacionId }),
    );
    expect(ficha.vencida).toBe(false);
  });

  it("la ficha de la invitación trae lo de la lista blanca más las sucursales, y nunca el token ni quién invitó", async () => {
    const e = await nuevo();
    const email = emailAlAzar("ficha");
    const emitida = datosDe(
      await invitar(d(), e.como(), {
        email,
        rol: "OPERADOR",
        sucursales: [e.mundo.sucursal],
      }),
    );
    const respuesta = await fichaDeInvitacion(d(), e.como(), {
      invitacionId: emitida.invitacionId,
    });
    const ficha = datosDe(respuesta);
    expect(ficha).toEqual({
      invitacionId: emitida.invitacionId,
      email,
      rol: "OPERADOR",
      venceEn: expect.any(String) as unknown,
      vencida: false,
      sucursales: [e.mundo.sucursal],
    });
    expect(JSON.stringify(respuesta)).not.toMatch(/token|hash|emitid/i);
  });

  it("I6 AISLAMIENTO: reenviar, revocar o abrir la ficha de una invitación de OTRA empresa da el genérico, idéntico a una inexistente, y no escribe", async () => {
    const a = await nuevo();
    const b = await nuevo();
    const deB = await pendiente(b, emailAlAzar("de-b"), "OPERADOR", enUnaSemana());
    const antes = await foto(b.mundo.empresa);
    const inexistente = "0b0b0b0b-1111-4222-8333-444444444444";

    for (const invitacionId of [deB.id, inexistente]) {
      expect(await reenviar(d(), a.como(), { invitacionId })).toEqual(GENERICO);
      expect(await revocar(d(), a.como(), { invitacionId })).toEqual(GENERICO);
      expect(await fichaDeInvitacion(d(), a.como(), { invitacionId })).toEqual(GENERICO);
    }
    expect(await foto(b.mundo.empresa)).toBe(antes);
    expect(await foto(a.mundo.empresa)).toBe(await foto(a.mundo.empresa));
    expect(await invitacionesDe(a.mundo.empresa, "de-b")).toEqual([]);
    expect((await filas("select estado from invitacion where id = $1", [deB.id]))[0]).toEqual({
      estado: "PENDIENTE",
    });
  });

  it("I6 AISLAMIENTO: invitar a un email que ya es miembro de OTRA empresa funciona igual y no dice nada de esa otra (la pantalla no lo sabe)", async () => {
    const a = await nuevo();
    const b = await nuevo();
    const email = emailAlAzar("en-las-dos");
    const persona = await crearPersonaDeBase(dueno, email);
    await crearMembresiaDeBase(dueno, b.mundo.empresa, persona.id, "OPERADOR");

    const r = await invitar(d(), a.como(), { email, rol: "OPERADOR", sucursales: [] });

    expect(datosDe(r).yaExistia).toBe(false);
    expect(JSON.stringify(r)).not.toContain(b.mundo.empresa);
  });

  it("I7 permisos: el empleado que llama directo a las tres acciones recibe el genérico y no se escribe nada; el Gerente no se invita", async () => {
    const gerente = await nuevo("GERENTE");
    const empleada = await nuevo("OPERADOR");
    const deLaEmpleada = await pendiente(
      empleada,
      emailAlAzar("a-la-empleada"),
      "OPERADOR",
      enUnaSemana(),
    );
    const antes = await foto(empleada.mundo.empresa);

    expect(
      await invitar(d(), empleada.como(), {
        email: emailAlAzar("x"),
        rol: "OPERADOR",
        sucursales: [],
      }),
    ).toEqual(GENERICO);
    expect(await reenviar(d(), empleada.como(), { invitacionId: deLaEmpleada.id })).toEqual(
      GENERICO,
    );
    expect(await revocar(d(), empleada.como(), { invitacionId: deLaEmpleada.id })).toEqual(
      GENERICO,
    );
    expect(
      await fichaDeInvitacion(d(), empleada.como(), { invitacionId: deLaEmpleada.id }),
    ).toEqual(GENERICO);
    expect(await foto(empleada.mundo.empresa)).toBe(antes);

    const email = emailAlAzar("gerente");
    const antesDelGerente = await foto(gerente.mundo.empresa);
    expect(await invitar(d(), gerente.como(), { email, rol: "GERENTE", sucursales: [] })).toEqual(
      GENERICO,
    );
    expect(await foto(gerente.mundo.empresa)).toBe(antesDelGerente);
  });

  it("I7 permisos: el administrador también invita, reenvía y revoca (gerente y administrador se gestionan por igual)", async () => {
    const e = await nuevo("ADMINISTRADOR");
    const email = emailAlAzar("por-admin");
    const emitida = datosDe(
      await invitar(d(), e.como(), { email, rol: "OPERADOR", sucursales: [] }),
    );
    const nueva = datosDe(await reenviar(d(), e.como(), { invitacionId: emitida.invitacionId }));
    expect(datosDe(await revocar(d(), e.como(), { invitacionId: nueva.invitacionId }))).toEqual({
      yaEstabaRevocada: false,
    });
  });

  it("I8 ya es miembro: invitar al email de un miembro activo no escribe y dice «Ya es parte de la empresa»", async () => {
    const e = await nuevo();
    const email = emailAlAzar("miembro");
    const persona = await crearPersonaDeBase(dueno, email);
    await crearMembresiaDeBase(dueno, e.mundo.empresa, persona.id, "OPERADOR");
    const antes = await foto(e.mundo.empresa);

    const r = await invitar(d(), e.como(), { email, rol: "OPERADOR", sucursales: [] });

    expect(r).toEqual({
      ok: false,
      error: expect.objectContaining({ codigo: "USUARIOS_YA_ES_MIEMBRO" }) as unknown,
    });
    expect(await foto(e.mundo.empresa)).toBe(antes);
  });

  it("el email inválido dice «El email no es válido» y no escribe; una sucursal que no es de la empresa es el genérico y no deja nada", async () => {
    const a = await nuevo();
    const b = await nuevo();
    const antes = await foto(a.mundo.empresa);

    expect(
      await invitar(d(), a.como(), { email: "no-es-un-email", rol: "OPERADOR", sucursales: [] }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ codigo: "CLIENTES_EMAIL_INVALIDO" }) as unknown,
    });
    expect(
      await invitar(d(), a.como(), {
        email: emailAlAzar("ajena"),
        rol: "OPERADOR",
        sucursales: [b.mundo.sucursal],
      }),
    ).toEqual(GENERICO);
    expect(await foto(a.mundo.empresa)).toBe(antes);
  });

  it("I9 empresa que no opera: invitar con la empresa suspendida es el genérico y no escribe", async () => {
    const e = await nuevo("GERENTE", "SUSPENDED");
    const antes = await foto(e.mundo.empresa);

    expect(
      await invitar(d(), e.como(), { email: emailAlAzar("susp"), rol: "OPERADOR", sucursales: [] }),
    ).toEqual(GENERICO);
    expect(await foto(e.mundo.empresa)).toBe(antes);
  });

  it("I10 el trabajo del mail no lleva el token ni su hash, y tiene una clave por invitación", async () => {
    const e = await nuevo();
    const emitida = datosDe(
      await invitar(d(), e.como(), {
        email: emailAlAzar("mail"),
        rol: "OPERADOR",
        sucursales: [],
      }),
    );
    const trabajos = await trabajosDe(e.mundo.empresa);
    expect(trabajos).toHaveLength(1);
    expect(trabajos[0]?.datos).toEqual({ invitacionId: emitida.invitacionId });
    expect(trabajos[0]?.clave_idempotencia).toContain(emitida.invitacionId);
    const [hash] = await filas<{ token_hash: string }>(
      "select token_hash from invitacion where id = $1",
      [emitida.invitacionId],
    );
    expect(JSON.stringify(trabajos)).not.toContain(hash?.token_hash ?? "sin-hash");
    expect(await auditoriaDe(e.mundo.empresa, "INVITACION_EMITIDA")).toBe(1);
  });

  it("I11 H1: invitar a un desactivado con OTRO rol se rechaza al invitar y no deja invitación ni mail; con el MISMO rol funciona", async () => {
    const e = await nuevo();
    const email = emailAlAzar("desactivada");
    const persona = await crearPersonaDeBase(dueno, email);
    await crearMembresiaDeBase(dueno, e.mundo.empresa, persona.id, "OPERADOR", false);
    const antes = await foto(e.mundo.empresa);

    expect(await invitar(d(), e.como(), { email, rol: "ADMINISTRADOR", sucursales: [] })).toEqual(
      GENERICO,
    );
    expect(await foto(e.mundo.empresa)).toBe(antes);

    const r = await invitar(d(), e.como(), { email, rol: "OPERADOR", sucursales: [] });
    expect(datosDe(r).yaExistia).toBe(false);
    expect(await trabajosDe(e.mundo.empresa)).toHaveLength(1);
  });

  it("H2: con una invitación vigente de otro rol no se hace pasar por hecho lo pedido: dice «ya había una» y no cambia nada", async () => {
    const e = await nuevo();
    const email = emailAlAzar("h2");
    const primera = datosDe(
      await invitar(d(), e.como(), { email, rol: "OPERADOR", sucursales: [] }),
    );
    const antes = await foto(e.mundo.empresa);

    const r = await invitar(d(), e.como(), { email, rol: "ADMINISTRADOR", sucursales: [] });

    expect(r).toEqual({
      ok: false,
      error: expect.objectContaining({ codigo: "USUARIOS_YA_HABIA_INVITACION" }) as unknown,
    });
    expect(await foto(e.mundo.empresa)).toBe(antes);
    expect((await rolesDe(primera.invitacionId))[0]?.rol).toBe("OPERADOR");
  });

  it("una invitación revocada o reemplazada ya no figura: su ficha es el genérico", async () => {
    const e = await nuevo();
    const inv = await pendiente(e, emailAlAzar("ya-no"), "OPERADOR", enUnaSemana());
    await revocarDeBase(dueno, inv);
    expect(await fichaDeInvitacion(d(), e.como(), { invitacionId: inv.id })).toEqual(GENERICO);
    // Y la lista la deja afuera (la de arriba que la reemplazó es la vigente).
    expect(datosDe(await listarUsuarios(d(), e.como())).invitaciones).toEqual([]);
    void incluirEmpresa;
  });
});
