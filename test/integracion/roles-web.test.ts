import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  accionesParaElegir,
  archivar,
  asignar,
  crear,
  editar,
  fichaDeRol,
  listarLosRoles,
  rolesAsignables,
  type DependenciasDeRolesWeb,
} from "../../src/composicion/roles-web";
import { armarWeb } from "../../src/composicion/web";
import { crearBaseAparte } from "./entorno";
import { crearEscenarioDeConfiguracion } from "./fiscal-configuracion-apoyo";
import { crearMembresiaDeBase, crearPersonaDeBase } from "./fixtures-identidad";

/**
 * La pantalla «Roles» de /cuenta con la composición REAL (conexiones y web, base de verdad, roles limitados y las reglas reales de empresa). Lo que se prueba es el CABLEADO de la web (las reglas de los
 * casos de uso están en `roles-casos-de-uso.test.ts`): solo el gerente; aislamiento entre empresas; crear es idempotente (también con dos pedidos a la vez); editar con una versión vieja no pisa
 * lo de otro; archivar repetido es inocuo; una forma inválida no llega a la base.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const GENERICO = { ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } };
const AHORA = new Date("2026-11-26T15:00:00.000Z");

describe.skipIf(base === null)("roles: pantalla de la empresa (web)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexiones: Conexiones;
  let web: ReturnType<typeof armarWeb>;
  const registrados: string[] = [];

  const d = (): DependenciasDeRolesWeb => ({
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
  const datosDe = <T>(r: Respuesta<T>): T => {
    if (!r.ok) throw new Error(`se esperaba ok: ${JSON.stringify(r.error)}`);
    return r.dato;
  };
  const filas = async (empresa: string): Promise<number> =>
    Number(
      (
        await dueno.query<{ n: string }>(
          "select count(*) as n from rol_de_empresa where empresa_id = $1",
          [empresa],
        )
      ).rows[0]?.n,
    );
  const vacio = (rolId: string, nombre: string) => ({
    rolId,
    nombre,
    origen: { tipo: "VACIO" },
  });

  it("el gerente crea un rol, lo ve en la lista y en su ficha, y el catálogo de casillas trae todos los módulos", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();

    const creado = datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Cajero")));
    const lista = datosDe(await listarLosRoles(d(), e.como(AHORA)));
    const ficha = datosDe(await fichaDeRol(d(), e.como(AHORA), { rolId }));
    const modulos = datosDe(await accionesParaElegir(d(), e.como(AHORA)));

    expect(creado).toEqual({ rolId, yaExistia: false });
    expect(lista.map((r) => r.nombre)).toEqual(["Cajero"]);
    expect(ficha).toMatchObject({ rolId, nombre: "Cajero", activo: true, personasActivas: 0 });
    expect(modulos.some((m) => m.modulo === "administracion" && m.enElPlan)).toBe(true);
  });

  it("repetir el mismo pedido de crear (doble clic, reintento) devuelve el mismo rol y no escribe otro", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();

    const primera = datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Mozo")));
    const segunda = datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Mozo")));

    expect([primera, segunda]).toEqual([
      { rolId, yaExistia: false },
      { rolId, yaExistia: true },
    ]);
    expect(await filas(e.mundo.empresa)).toBe(1);
  });

  it("dos pedidos de crear a la vez con el mismo id dejan UN solo rol y los dos responden bien, de cualquier lado que gane", async () => {
    const e = await nuevo("GERENTE");

    for (let ronda = 0; ronda < 6; ronda++) {
      const rolId = randomUUID();
      const [a, b] = await Promise.all([
        crear(d(), e.como(AHORA), vacio(rolId, `Encargado ${ronda}`)),
        crear(d(), e.como(AHORA), vacio(rolId, `Encargado ${ronda}`)),
      ]);

      expect([datosDe(a).rolId, datosDe(b).rolId]).toEqual([rolId, rolId]);
      expect([datosDe(a).yaExistia, datosDe(b).yaExistia].sort()).toEqual([false, true]);
    }
    expect(await filas(e.mundo.empresa)).toBe(6);
  });

  it("dos pedidos de crear a la vez con el mismo nombre y ids distintos dejan UN solo rol activo con ese nombre", async () => {
    const e = await nuevo("GERENTE");

    const [a, b] = await Promise.all([
      crear(d(), e.como(AHORA), vacio(randomUUID(), "Supervisor")),
      crear(d(), e.como(AHORA), vacio(randomUUID(), "Supervisor")),
    ]);

    expect(datosDe(a).rolId).toBe(datosDe(b).rolId);
    expect(await filas(e.mundo.empresa)).toBe(1);
  });

  it("quien no es el gerente recibe el genérico en todo y no se escribe nada", async () => {
    for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
      const e = await nuevo(rol);
      const rolId = randomUUID();
      const ctx = e.como(AHORA);

      const respuestas = [
        await listarLosRoles(d(), ctx),
        await fichaDeRol(d(), ctx, { rolId }),
        await accionesParaElegir(d(), ctx),
        await crear(d(), ctx, vacio(rolId, "Intruso")),
        await editar(d(), ctx, { rolId, nombre: "Otro" }),
        await archivar(d(), ctx, { rolId }),
      ];

      for (const r of respuestas) expect(r).toMatchObject(GENERICO);
      expect(await filas(e.mundo.empresa)).toBe(0);
    }
  });

  it("un rol de otra empresa es indistinguible de uno inexistente y no figura en la lista", async () => {
    const a = await nuevo("GERENTE");
    const b = await nuevo("GERENTE");
    const rolId = randomUUID();
    datosDe(await crear(d(), a.como(AHORA), vacio(rolId, "De A")));

    const ajeno = await fichaDeRol(d(), b.como(AHORA), { rolId });
    const inexistente = await fichaDeRol(d(), b.como(AHORA), { rolId: randomUUID() });
    const listaDeB = datosDe(await listarLosRoles(d(), b.como(AHORA)));
    const editarAjeno = await editar(d(), b.como(AHORA), { rolId, nombre: "Robado" });
    const archivarAjeno = await archivar(d(), b.como(AHORA), { rolId });

    expect(ajeno).toMatchObject(GENERICO);
    expect(inexistente).toMatchObject(GENERICO);
    expect(ajeno).toEqual(inexistente);
    expect(listaDeB).toEqual([]);
    expect(editarAjeno).toMatchObject(GENERICO);
    expect(archivarAjeno).toMatchObject(GENERICO);
    expect(datosDe(await fichaDeRol(d(), a.como(AHORA), { rolId })).nombre).toBe("De A");
  });

  it("editar con una versión vieja no pisa lo que otra persona ya cambió; con la vigente cambia y repetir no vuelve a escribir", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();
    datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Caja")));
    const vista = datosDe(await fichaDeRol(d(), e.como(AHORA), { rolId }));
    datosDe(await editar(d(), e.como(AHORA), { rolId, nombre: "Caja 1" }));

    const vieja = await editar(d(), e.como(AHORA), {
      rolId,
      nombre: "Caja 2",
      versionEsperada: vista.version,
    });
    const vigente = datosDe(await fichaDeRol(d(), e.como(AHORA), { rolId }));
    const buena = datosDe(
      await editar(d(), e.como(AHORA), {
        rolId,
        nombre: "Caja 3",
        versionEsperada: vigente.version,
      }),
    );
    const repetida = datosDe(await editar(d(), e.como(AHORA), { rolId, nombre: "Caja 3" }));

    expect(vieja).toMatchObject(GENERICO);
    expect(buena.cambio).toBe(true);
    expect(repetida.cambio).toBe(false);
    expect(datosDe(await fichaDeRol(d(), e.como(AHORA), { rolId })).nombre).toBe("Caja 3");
  });

  it("archivar y reactivar: archivar repetido es inocuo y editar con reactivar lo vuelve a activar", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();
    datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Temporal")));

    const una = datosDe(await archivar(d(), e.como(AHORA), { rolId }));
    const otra = datosDe(await archivar(d(), e.como(AHORA), { rolId }));
    const archivado = datosDe(await fichaDeRol(d(), e.como(AHORA), { rolId }));
    datosDe(await editar(d(), e.como(AHORA), { rolId, reactivar: true }));
    const activo = datosDe(await fichaDeRol(d(), e.como(AHORA), { rolId }));

    expect(una).toEqual({ yaEstabaArchivado: false });
    expect(otra).toEqual({ yaEstabaArchivado: true });
    expect(archivado.activo).toBe(false);
    expect(activo.activo).toBe(true);
  });

  it("una forma inválida (id que no es identificador, origen desconocido, acciones que no son texto) es el genérico y no llega a la base", async () => {
    const e = await nuevo("GERENTE");
    const ctx = e.como(AHORA);

    const invalidas = [
      await crear(d(), ctx, { rolId: "no-es-un-id", nombre: "X", origen: { tipo: "VACIO" } }),
      await crear(d(), ctx, { rolId: randomUUID(), nombre: "X", origen: { tipo: "OTRO" } }),
      await editar(d(), ctx, { rolId: randomUUID(), acciones: [1, 2] }),
      await fichaDeRol(d(), ctx, { rolId: "../etc" }),
      await archivar(d(), ctx, undefined),
    ];

    for (const r of invalidas) expect(r).toMatchObject(GENERICO);
    expect(await filas(e.mundo.empresa)).toBe(0);
  });

  /** Suma una persona con membresía a la empresa del escenario y devuelve su id. */
  async function sumar(
    e: Awaited<ReturnType<typeof nuevo>>,
    email: string,
    rol: "ADMINISTRADOR" | "OPERADOR" = "OPERADOR",
  ): Promise<string> {
    const persona = await crearPersonaDeBase(dueno, email);
    await crearMembresiaDeBase(dueno, e.mundo.empresa, persona.id, rol, true);
    return persona.id;
  }
  const rolDe = async (empresa: string, persona: string) =>
    (
      await dueno.query<{ rol: string; rol_propio_id: string | null }>(
        "select rol, rol_propio_id from membresia where empresa_id = $1 and persona_id = $2",
        [empresa, persona],
      )
    ).rows[0];

  it("asignar: el gerente pasa a una persona a un rol propio y de vuelta a uno base; repetir no cambia nada; los roles asignables son los activos", async () => {
    const e = await nuevo("GERENTE");
    const persona = await sumar(e, `op-${randomUUID()}@prueba.test`);
    const rolId = randomUUID();
    datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Cajero")));
    const viejo = randomUUID();
    datosDe(await crear(d(), e.como(AHORA), vacio(viejo, "Viejo")));
    datosDe(await archivar(d(), e.como(AHORA), { rolId: viejo }));

    const asignables = datosDe(await rolesAsignables(d(), e.como(AHORA)));
    const ida = datosDe(
      await asignar(d(), e.como(AHORA), { personaId: persona, destino: { tipo: "PROPIO", rolId } }),
    );
    const repetida = datosDe(
      await asignar(d(), e.como(AHORA), { personaId: persona, destino: { tipo: "PROPIO", rolId } }),
    );
    const alPropio = await rolDe(e.mundo.empresa, persona);
    const vuelta = datosDe(
      await asignar(d(), e.como(AHORA), {
        personaId: persona,
        destino: { tipo: "BASE", rol: "ADMINISTRADOR" },
      }),
    );

    expect(asignables.propios.map((r) => r.nombre)).toEqual(["Cajero"]);
    expect(asignables.base).toEqual(["ADMINISTRADOR", "OPERADOR"]);
    expect([ida.cambio, repetida.cambio, vuelta.cambio]).toEqual([true, false, true]);
    expect(alPropio).toEqual({ rol: "PROPIO", rol_propio_id: rolId });
    expect(await rolDe(e.mundo.empresa, persona)).toEqual({
      rol: "ADMINISTRADOR",
      rol_propio_id: null,
    });
  });

  it("asignar: un rol archivado, el gerente y una persona o un rol de otra empresa se rechazan con el genérico y no cambian nada", async () => {
    const a = await nuevo("GERENTE");
    const b = await nuevo("GERENTE");
    const persona = await sumar(a, `op-${randomUUID()}@prueba.test`);
    const ajena = await sumar(b, `ajena-${randomUUID()}@prueba.test`);
    const archivado = randomUUID();
    datosDe(await crear(d(), a.como(AHORA), vacio(archivado, "Archivado")));
    datosDe(await archivar(d(), a.como(AHORA), { rolId: archivado }));
    const deB = randomUUID();
    datosDe(await crear(d(), b.como(AHORA), vacio(deB, "De B")));

    const rechazos = [
      await asignar(d(), a.como(AHORA), {
        personaId: persona,
        destino: { tipo: "PROPIO", rolId: archivado },
      }),
      await asignar(d(), a.como(AHORA), {
        personaId: persona,
        destino: { tipo: "PROPIO", rolId: deB },
      }),
      await asignar(d(), a.como(AHORA), {
        personaId: ajena,
        destino: { tipo: "BASE", rol: "OPERADOR" },
      }),
      await asignar(d(), a.como(AHORA), {
        personaId: a.persona,
        destino: { tipo: "BASE", rol: "OPERADOR" },
      }),
    ];

    for (const r of rechazos) expect(r).toMatchObject(GENERICO);
    expect(await rolDe(a.mundo.empresa, persona)).toEqual({ rol: "OPERADOR", rol_propio_id: null });
    expect(await rolDe(b.mundo.empresa, ajena)).toEqual({ rol: "OPERADOR", rol_propio_id: null });
    expect((await rolDe(a.mundo.empresa, a.persona))?.rol).toBe("GERENTE");
  });

  it("asignar: quien no es el gerente recibe el genérico y los roles asignables tampoco se ven", async () => {
    for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
      const e = await nuevo(rol);
      const persona = await sumar(e, `op-${randomUUID()}@prueba.test`);

      const respuestas = [
        await asignar(d(), e.como(AHORA), {
          personaId: persona,
          destino: { tipo: "BASE", rol: "ADMINISTRADOR" },
        }),
        await rolesAsignables(d(), e.como(AHORA)),
      ];

      for (const r of respuestas) expect(r).toMatchObject(GENERICO);
      expect(await rolDe(e.mundo.empresa, persona)).toEqual({
        rol: "OPERADOR",
        rol_propio_id: null,
      });
    }
  });

  it("asignar: una forma inválida (destino desconocido, el rol gerente, id que no es identificador) es el genérico y no llega a la base", async () => {
    const e = await nuevo("GERENTE");
    const persona = await sumar(e, `op-${randomUUID()}@prueba.test`);
    const ctx = e.como(AHORA);

    const invalidas = [
      await asignar(d(), ctx, { personaId: persona, destino: { tipo: "BASE", rol: "GERENTE" } }),
      await asignar(d(), ctx, { personaId: persona, destino: { tipo: "OTRO" } }),
      await asignar(d(), ctx, {
        personaId: persona,
        destino: { tipo: "PROPIO", rolId: "no-es-un-id" },
      }),
      await asignar(d(), ctx, { personaId: "../etc", destino: { tipo: "BASE", rol: "OPERADOR" } }),
      await asignar(d(), ctx, undefined),
    ];

    for (const r of invalidas) expect(r).toMatchObject(GENERICO);
    expect(await rolDe(e.mundo.empresa, persona)).toEqual({ rol: "OPERADOR", rol_propio_id: null });
  });

  it("asignar: dos asignaciones a la vez a la misma persona dejan UN rol coherente (el último que confirmó la base) y ninguna se rompe", async () => {
    const e = await nuevo("GERENTE");
    const persona = await sumar(e, `op-${randomUUID()}@prueba.test`);
    const rolId = randomUUID();
    datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Mozo")));

    const resultados = await Promise.all([
      asignar(d(), e.como(AHORA), { personaId: persona, destino: { tipo: "PROPIO", rolId } }),
      asignar(d(), e.como(AHORA), {
        personaId: persona,
        destino: { tipo: "BASE", rol: "ADMINISTRADOR" },
      }),
    ]);

    const final = await rolDe(e.mundo.empresa, persona);
    // La base ordena las dos: queda uno de los dos destinos completo, nunca un estado a medias (el puntero de rol propio solo existe con el rol PROPIO).
    expect([
      { rol: "PROPIO", rol_propio_id: rolId },
      { rol: "ADMINISTRADOR", rol_propio_id: null },
    ]).toContainEqual(final);
    expect(resultados.filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
  });
});
