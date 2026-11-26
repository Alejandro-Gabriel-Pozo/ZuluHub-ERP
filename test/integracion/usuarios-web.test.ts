import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  fichaDeUsuario,
  listarUsuarios,
  type DependenciasDeUsuariosWeb,
  type ListaDeUsuariosParaLaPantalla,
} from "../../src/composicion/usuarios-web";
import { armarWeb } from "../../src/composicion/web";
import { crearBaseAparte } from "./entorno";
import { crearEscenarioDeConfiguracion, otraPersona } from "./fiscal-configuracion-apoyo";
import {
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  incluirEmpresa,
  tokenAlAzar,
} from "./fixtures-identidad";

/**
 * La pantalla «Usuarios» de /cuenta (tramo U1, solo lectura) con la composición REAL (conexiones y web, base de verdad, roles limitados y las reglas reales de empresa). Lo que se prueba es el CABLEADO de
 * `listarUsuarios` y `fichaDeUsuario` (las reglas de las consultas están en `usuarios-admin-casos-de-uso.test.ts`):
 *  - solo gerente y administrador; un empleado o quien no es de la empresa no recibe ninguna fila, solo el genérico;
 *  - aislamiento: la lista de una empresa no trae a nadie de otra ni sus invitaciones, y la ficha de una persona ajena es indistinguible de una inexistente;
 *  - la lista trae al desactivado y a la invitación vencida (en el instante exacto del vencimiento ya es «vencida»), y nunca un token ni un hash;
 *  - una empresa suspendida sigue viendo a su gente (las consultas no exigen que opere);
 *  - leer es repetible: varias lecturas a la vez dan lo mismo y no escriben.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const GENERICO = { ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } };

describe.skipIf(base === null)("usuarios: lista y ficha de la empresa (web)", () => {
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
  const datosDe = <T>(r: Respuesta<T>): T => {
    if (!r.ok) throw new Error(`se esperaba ok: ${JSON.stringify(r.error)}`);
    return r.dato;
  };
  const conteo = async (tabla: string): Promise<number> =>
    Number((await dueno.query<{ n: string }>(`select count(*) as n from ${tabla}`)).rows[0]?.n);

  /** Suma una persona con membresía a la empresa del escenario. */
  async function sumar(
    e: Awaited<ReturnType<typeof nuevo>>,
    email: string,
    rol: "ADMINISTRADOR" | "OPERADOR",
    activo = true,
  ): Promise<string> {
    const persona = await crearPersonaDeBase(dueno, email);
    await crearMembresiaDeBase(dueno, e.mundo.empresa, persona.id, rol, activo);
    return persona.id;
  }
  /** Una invitación pendiente de usuario a la empresa del escenario. */
  async function invitar(
    e: Awaited<ReturnType<typeof nuevo>>,
    email: string,
    rol: "ADMINISTRADOR" | "OPERADOR",
    venceEn: Date,
  ) {
    const { tokenHash } = tokenAlAzar();
    const inv = await crearInvitacionDeBase(dueno, {
      tenant: e.mundo.tenant,
      email,
      venceEn,
      tokenHash,
    });
    await incluirEmpresa(dueno, inv, e.mundo.empresa, rol);
    return { ...inv, tokenHash };
  }

  it("el gerente ve a todos (activos y desactivados) y las invitaciones, vigentes y vencidas, ordenados por email y sin token ni hash", async () => {
    const e = await nuevo("GERENTE");
    const ahora = new Date("2026-11-23T15:00:00.000Z");
    const gerente = (
      await dueno.query<{ email: string }>("select email from persona where id = $1", [e.persona])
    ).rows[0]?.email as string;
    const admin = await sumar(e, "b-admin@prueba.test", "ADMINISTRADOR");
    const sofia = await sumar(e, "c-sofia@prueba.test", "OPERADOR");
    const ana = await sumar(e, "d-ana@prueba.test", "OPERADOR", false);
    const vigente = await invitar(
      e,
      "e-julia@prueba.test",
      "OPERADOR",
      new Date("2026-11-29T10:00:00.000Z"),
    );
    const vencida = await invitar(
      e,
      "f-pablo@prueba.test",
      "ADMINISTRADOR",
      new Date("2026-11-21T10:00:00.000Z"),
    );

    const respuesta = await listarUsuarios(d(), e.como(ahora));
    const lista = datosDe(respuesta);

    expect(lista.usuarios).toEqual(
      [
        { personaId: e.persona, email: gerente, rol: "GERENTE", rolPropioId: null, activo: true },
        {
          personaId: admin,
          email: "b-admin@prueba.test",
          rol: "ADMINISTRADOR",
          rolPropioId: null,
          activo: true,
        },
        {
          personaId: sofia,
          email: "c-sofia@prueba.test",
          rol: "OPERADOR",
          rolPropioId: null,
          activo: true,
        },
        {
          personaId: ana,
          email: "d-ana@prueba.test",
          rol: "OPERADOR",
          rolPropioId: null,
          activo: false,
        },
      ].sort((a, b) => (a.email < b.email ? -1 : 1)),
    );
    expect(lista.invitaciones).toEqual([
      {
        invitacionId: vigente.id,
        email: "e-julia@prueba.test",
        rol: "OPERADOR",
        venceEn: "2026-11-29T10:00:00.000Z",
        vencida: false,
      },
      {
        invitacionId: vencida.id,
        email: "f-pablo@prueba.test",
        rol: "ADMINISTRADOR",
        venceEn: "2026-11-21T10:00:00.000Z",
        vencida: true,
      },
    ]);
    const crudo = JSON.stringify(respuesta);
    expect(crudo).not.toContain(vigente.tokenHash);
    expect(crudo).not.toContain(vencida.tokenHash);
    expect(crudo).not.toMatch(/token|hash|sucursales|emitid/i);
  });

  it("el administrador también ve la lista (gerente y administrador se gestionan por igual)", async () => {
    const e = await nuevo("ADMINISTRADOR");
    await sumar(e, "otro-admin@prueba.test", "ADMINISTRADOR");
    const lista = datosDe(await listarUsuarios(d(), e.como()));
    expect(lista.usuarios.map((u) => u.rol).sort()).toEqual(["ADMINISTRADOR", "ADMINISTRADOR"]);
  });

  it("la invitación es «vencida» en el instante exacto del vencimiento y no un milisegundo antes", async () => {
    const e = await nuevo("GERENTE");
    const vence = new Date("2026-11-29T10:00:00.000Z");
    await invitar(e, "justo@prueba.test", "OPERADOR", vence);
    const flag = async (ahora: Date) =>
      datosDe(await listarUsuarios(d(), e.como(ahora))).invitaciones[0]?.vencida;
    expect(await flag(new Date(vence.getTime() - 1))).toBe(false);
    expect(await flag(vence)).toBe(true);
    expect(await flag(new Date(vence.getTime() + 1))).toBe(true);
  });

  it("AISLAMIENTO: la lista de una empresa no trae a nadie de otra ni sus invitaciones", async () => {
    const a = await nuevo("GERENTE");
    const b = await nuevo("GERENTE");
    await sumar(a, "solo-de-a@prueba.test", "OPERADOR");
    const deB = await sumar(b, "solo-de-b@prueba.test", "OPERADOR");
    await invitar(a, "inv-de-a@prueba.test", "OPERADOR", new Date("2026-12-10T10:00:00.000Z"));
    await invitar(b, "inv-de-b@prueba.test", "ADMINISTRADOR", new Date("2026-12-10T10:00:00.000Z"));

    const deA = datosDe(await listarUsuarios(d(), a.como()));
    expect(deA.usuarios.map((u) => u.email)).toContain("solo-de-a@prueba.test");
    expect(deA.usuarios.map((u) => u.email)).not.toContain("solo-de-b@prueba.test");
    expect(deA.invitaciones.map((i) => i.email)).toEqual(["inv-de-a@prueba.test"]);
    expect(JSON.stringify(deA)).not.toContain(deB);

    const delaOtra = datosDe(await listarUsuarios(d(), b.como()));
    expect(delaOtra.usuarios.map((u) => u.email)).not.toContain("solo-de-a@prueba.test");
    expect(delaOtra.invitaciones.map((i) => i.email)).toEqual(["inv-de-b@prueba.test"]);
  });

  it("AISLAMIENTO: la ficha de una persona de otra empresa es idéntica a la de una que no existe", async () => {
    const a = await nuevo("GERENTE");
    const b = await nuevo("GERENTE");
    const deB = await sumar(b, "ajena@prueba.test", "OPERADOR");
    const ajena = await fichaDeUsuario(d(), a.como(), { personaId: deB });
    const inexistente = await fichaDeUsuario(d(), a.como(), {
      personaId: "0b0b0b0b-1111-4222-8333-4444444444ee",
    });
    const mal = await fichaDeUsuario(d(), a.como(), { personaId: "no-es-un-id" });
    expect(ajena).toMatchObject(GENERICO);
    expect(ajena).toEqual(inexistente);
    expect(ajena).toEqual(mal);
    expect(JSON.stringify(ajena)).not.toContain("ajena@prueba.test");
  });

  it("la ficha trae a la persona de la empresa (activa o desactivada) con la lista blanca", async () => {
    const e = await nuevo("GERENTE");
    const sofia = await sumar(e, "sofia@prueba.test", "OPERADOR");
    const ana = await sumar(e, "ana@prueba.test", "OPERADOR", false);
    expect(datosDe(await fichaDeUsuario(d(), e.como(), { personaId: sofia }))).toEqual({
      personaId: sofia,
      email: "sofia@prueba.test",
      rol: "OPERADOR",
      rolPropioId: null,
      activo: true,
    });
    expect(datosDe(await fichaDeUsuario(d(), e.como(), { personaId: ana }))).toEqual({
      personaId: ana,
      email: "ana@prueba.test",
      rol: "OPERADOR",
      rolPropioId: null,
      activo: false,
    });
  });

  it("PERMISOS: un empleado no recibe filas, solo el genérico (lista y ficha)", async () => {
    const e = await nuevo("GERENTE");
    const empleado = await otraPersona(dueno, e, "OPERADOR");
    const sofia = await sumar(e, "sofia-permisos@prueba.test", "OPERADOR");
    await invitar(e, "inv-permisos@prueba.test", "OPERADOR", new Date("2026-12-10T10:00:00.000Z"));
    const lista = await listarUsuarios(d(), empleado.como());
    const ficha = await fichaDeUsuario(d(), empleado.como(), { personaId: sofia });
    expect(lista).toMatchObject(GENERICO);
    expect(ficha).toMatchObject(GENERICO);
    expect(JSON.stringify([lista, ficha])).not.toMatch(/prueba\.test|personaId|email|invitacionId/);
  });

  it("PERMISOS: quien no es miembro de la empresa (aunque sea persona del sistema) tampoco ve nada", async () => {
    const e = await nuevo("GERENTE");
    const otra = await nuevo("GERENTE");
    const lista = await listarUsuarios(d(), { ...e.como(), personaId: otra.como().personaId });
    expect(lista).toMatchObject(GENERICO);
  });

  it("una empresa suspendida sigue viendo a su gente (la lectura no exige que opere)", async () => {
    const suspendida = await crearEscenarioDeConfiguracion(dueno, {
      rol: "GERENTE",
      estado: "SUSPENDED",
    });
    await sumar(suspendida, "sigue@prueba.test", "OPERADOR");
    const lista = datosDe(await listarUsuarios(d(), suspendida.como()));
    expect(lista.usuarios.map((u) => u.email)).toContain("sigue@prueba.test");
  });

  it("IDEMPOTENCIA: leer repetido y a la vez da lo mismo y no escribe ni audita nada", async () => {
    const e = await nuevo("GERENTE");
    await sumar(e, "repetida@prueba.test", "OPERADOR");
    await invitar(e, "inv-repetida@prueba.test", "OPERADOR", new Date("2026-12-10T10:00:00.000Z"));
    const antes = [
      await conteo("membresia"),
      await conteo("invitacion"),
      await conteo("auditoria_empresa"),
    ];
    const lecturas: Respuesta<ListaDeUsuariosParaLaPantalla>[] = await Promise.all(
      Array.from({ length: 6 }, () => listarUsuarios(d(), e.como())),
    );
    for (const r of lecturas) expect(r).toEqual(lecturas[0]);
    const despues = [
      await conteo("membresia"),
      await conteo("invitacion"),
      await conteo("auditoria_empresa"),
    ];
    expect(despues).toEqual(antes);
  });
});
