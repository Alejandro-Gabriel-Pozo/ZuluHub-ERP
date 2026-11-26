import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  accionesParaElegir,
  archivar,
  crear,
  editar,
  historialDelRol,
  type DependenciasDeRolesWeb,
} from "../../src/composicion/roles-web";
import { armarWeb } from "../../src/composicion/web";
import { crearBaseAparte } from "./entorno";
import { crearEscenarioDeConfiguracion } from "./fiscal-configuracion-apoyo";
import { crearMembresiaDeBase, crearPersonaDeBase } from "./fixtures-identidad";

/**
 * El historial de un rol propio (H4b T6, B3b) con la composición REAL (conexiones y web, base de verdad, roles limitados y las reglas reales de empresa). Solo el gerente (`roles.ver`); un rol de otra empresa o
 * inexistente es el genérico (indistinguibles); dos empresas no se mezclan; cuenta lo que pasó, del más nuevo al más viejo, con quién; los eventos de otra entidad no aparecen; una acción que el catálogo ya no
 * tiene se omite; el tope de eventos; y leer no escribe nada.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const GENERICO = { ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } };
const AHORA = new Date("2026-11-26T15:00:00.000Z");

describe.skipIf(base === null)("roles: historial de un rol (web)", () => {
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
  const vacio = (rolId: string, nombre: string) => ({ rolId, nombre, origen: { tipo: "VACIO" } });
  const auditadas = async (empresa: string): Promise<number> =>
    Number(
      (
        await dueno.query<{ n: string }>(
          "select count(*) as n from auditoria_empresa where empresa_id = $1",
          [empresa],
        )
      ).rows[0]?.n,
    );
  /** Una acción que el gerente puede tildar (sin piso y de un módulo del plan) y el conjunto final que la incluye (con las que todo rol lleva, que la pantalla manda tildadas). */
  const unaAccionDelegable = async (e: Awaited<ReturnType<typeof nuevo>>) => {
    const modulos = datosDe(await accionesParaElegir(d(), e.como(AHORA)));
    const todas = modulos.filter((m) => m.enElPlan).flatMap((m) => m.acciones);
    const accion = todas.find((a) => a.piso === null);
    if (accion === undefined) throw new Error("no hay una acción delegable en el plan de prueba");
    const pisos = modulos.flatMap((m) => m.acciones).filter((a) => a.piso === "TODOS_LOS_ROLES");
    return { accion: accion.accion, conjunto: [accion.accion, ...pisos.map((p) => p.accion)] };
  };

  it("cuenta la vida del rol del más nuevo al más viejo: alta, edición (acciones y nombre), archivado y reactivado, con quién lo hizo", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();
    const { accion, conjunto } = await unaAccionDelegable(e);
    const correo = (
      await dueno.query<{ email: string }>("select email from persona where id = $1", [e.persona])
    ).rows[0]?.email;

    datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Cajero")));
    const vista = datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Cajero")));
    expect(vista.yaExistia).toBe(true); // repetir el alta no suma un evento (ver el conteo abajo)
    datosDe(
      await editar(d(), e.como(AHORA), {
        rolId,
        nombre: "Cajera",
        acciones: conjunto,
      }),
    );
    datosDe(await archivar(d(), e.como(AHORA), { rolId }));
    datosDe(await editar(d(), e.como(AHORA), { rolId, reactivar: true }));

    const historial = datosDe(await historialDelRol(d(), e.como(AHORA), { rolId }));

    expect(historial.map((h) => h.tipo)).toEqual(["REACTIVADO", "ARCHIVADO", "EDITADO", "CREADO"]);
    expect(historial.every((h) => h.por === correo)).toBe(true);
    const editado = historial.find((h) => h.tipo === "EDITADO");
    expect(editado).toMatchObject({ nombreAnterior: "Cajero", nombreNuevo: "Cajera" });
    expect(editado?.agregadas).toContain(accion);
    expect(editado?.quitadas).toEqual([]);
    // Fechas como instante ISO, no decrecientes hacia el pasado.
    const instantes = historial.map((h) => new Date(h.cuando).getTime());
    expect(instantes).toEqual([...instantes].sort((a, b) => b - a));
    // El orden es estable: leer dos veces da lo mismo.
    expect(datosDe(await historialDelRol(d(), e.como(AHORA), { rolId }))).toEqual(historial);
  });

  it("leer el historial no escribe nada (las filas de auditoría son las mismas antes y después, también repetido)", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();
    datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Mozo")));
    const antes = await auditadas(e.mundo.empresa);

    await Promise.all([1, 2, 3].map(() => historialDelRol(d(), e.como(AHORA), { rolId })));

    expect(await auditadas(e.mundo.empresa)).toBe(antes);
  });

  it("solo el gerente: un administrador y un operador reciben el genérico, sin filas", async () => {
    for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
      const e = await nuevo(rol);
      const r = await historialDelRol(d(), e.como(AHORA), { rolId: randomUUID() });
      expect(r).toMatchObject(GENERICO);
    }
  });

  it("un rol propio con acciones tampoco ve el historial: `roles.ver` es solo del gerente (piso de plataforma)", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();
    datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Curioso")));
    const curioso = (await crearPersonaDeBase(dueno)).id;
    await crearMembresiaDeBase(dueno, e.mundo.empresa, curioso, "OPERADOR", true);
    await dueno.query("alter table membresia disable trigger membresia_cambio");
    await dueno.query(
      "update membresia set rol = 'PROPIO', rol_propio_id = $3 where empresa_id = $1 and persona_id = $2",
      [e.mundo.empresa, curioso, rolId],
    );
    await dueno.query("alter table membresia enable trigger membresia_cambio");
    const ctx = { ...e.como(AHORA), personaId: curioso as never };

    expect(await historialDelRol(d(), ctx, { rolId })).toMatchObject(GENERICO);
  });

  it("un rol de OTRA empresa y uno inexistente dan lo mismo (el genérico), y dos empresas con roles del mismo nombre no se mezclan", async () => {
    const a = await nuevo("GERENTE");
    const b = await nuevo("GERENTE");
    const rolA = randomUUID();
    const rolB = randomUUID();
    datosDe(await crear(d(), a.como(AHORA), vacio(rolA, "Encargado")));
    datosDe(await crear(d(), b.como(AHORA), vacio(rolB, "Encargado")));
    datosDe(await archivar(d(), b.como(AHORA), { rolId: rolB }));

    const ajeno = await historialDelRol(d(), b.como(AHORA), { rolId: rolA });
    const inexistente = await historialDelRol(d(), b.como(AHORA), { rolId: randomUUID() });
    const deA = datosDe(await historialDelRol(d(), a.como(AHORA), { rolId: rolA }));
    const deB = datosDe(await historialDelRol(d(), b.como(AHORA), { rolId: rolB }));

    expect(ajeno).toMatchObject(GENERICO);
    expect(inexistente).toMatchObject(GENERICO);
    expect(ajeno).toEqual(inexistente);
    expect(deA.map((h) => h.tipo)).toEqual(["CREADO"]);
    expect(deB.map((h) => h.tipo)).toEqual(["ARCHIVADO", "CREADO"]);
  });

  it("una forma inválida del id es el genérico y no llega a la base", async () => {
    const e = await nuevo("GERENTE");
    for (const crudo of [{ rolId: "no-es-un-uuid" }, { rolId: 7 }, {}, null, "x"]) {
      expect(await historialDelRol(d(), e.como(AHORA), crudo)).toMatchObject(GENERICO);
    }
  });

  it("no aparecen los eventos de otra entidad ni los de otro rol, y una acción que el catálogo ya no tiene se omite sin romper el historial", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();
    const otro = randomUUID();
    datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Uno")));
    datosDe(await crear(d(), e.como(AHORA), vacio(otro, "Dos")));
    // Una asignación de persona (entidad membresía) y un evento del otro rol: no cuentan.
    await dueno.query(
      `insert into auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id, antes, despues)
       values ($1, $2, 'ROL_ASIGNADO', 'membresia', $3, '{}'::jsonb, '{}'::jsonb)`,
      [e.mundo.empresa, e.persona, e.persona],
    );
    // Una edición vieja que menciona una acción que el catálogo ya no tiene, y una con un cuerpo sin la forma esperada.
    await dueno.query(
      `insert into auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id, antes, despues)
       values ($1, $2, 'ROL_EDITADO', 'rol_de_empresa', $3, '{"nombre":"Uno"}'::jsonb,
               '{"nombre":"Uno","agregadas":["accion.retirada","otra.retirada"],"quitadas":"no es una lista"}'::jsonb),
              ($1, NULL, 'ROL_EDITADO', 'rol_de_empresa', $3, 'null'::jsonb, '[1,2]'::jsonb)`,
      [e.mundo.empresa, e.persona, rolId],
    );

    const historial = datosDe(await historialDelRol(d(), e.como(AHORA), { rolId }));

    expect(historial.map((h) => h.tipo).sort()).toEqual(["CREADO", "EDITADO", "EDITADO"]);
    for (const h of historial.filter((x) => x.tipo === "EDITADO")) {
      expect(h.agregadas).toEqual([]);
      expect(h.quitadas).toEqual([]);
      expect(h.nombreAnterior).toBeNull();
    }
    // El actor de sistema no tiene correo: el campo viene vacío, no roto.
    expect(historial.some((h) => h.por === null)).toBe(true);
  });

  it("trae como mucho los últimos 50 eventos, del más nuevo al más viejo, con un orden estable aunque coincida el instante", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();
    datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Muchos")));
    // 60 ediciones de nombre dentro de la MISMA transacción (mismo `now()`): el desempate es el id.
    await dueno.query("begin");
    for (let i = 1; i <= 60; i++) {
      await dueno.query(
        `insert into auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id, antes, despues)
         values ($1, $2, 'ROL_EDITADO', 'rol_de_empresa', $3, $4::jsonb, $5::jsonb)`,
        [
          e.mundo.empresa,
          e.persona,
          rolId,
          JSON.stringify({ nombre: `N${i - 1}` }),
          JSON.stringify({ nombre: `N${i}` }),
        ],
      );
    }
    await dueno.query("commit");

    const historial = datosDe(await historialDelRol(d(), e.como(AHORA), { rolId }));

    expect(historial).toHaveLength(50);
    expect(historial[0]).toMatchObject({ tipo: "EDITADO", nombreNuevo: "N60" });
    expect(historial[49]).toMatchObject({ tipo: "EDITADO", nombreNuevo: "N11" });
    expect(datosDe(await historialDelRol(d(), e.como(AHORA), { rolId }))).toEqual(historial);
  });

  it("una edición a la vez que se lee deja un historial coherente (cada edición figura entera o no figura)", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();
    datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Carrera")));
    const { accion, conjunto } = await unaAccionDelegable(e);

    const [, lectura] = await Promise.all([
      editar(d(), e.como(AHORA), { rolId, nombre: "Carrera 2", acciones: conjunto }),
      historialDelRol(d(), e.como(AHORA), { rolId }),
    ]);
    const despues = datosDe(await historialDelRol(d(), e.como(AHORA), { rolId }));

    const durante = datosDe(lectura);
    expect([1, 2]).toContain(durante.length);
    if (durante.length === 2)
      expect(durante[0]).toMatchObject({ tipo: "EDITADO", nombreAnterior: "Carrera" });
    expect(despues).toHaveLength(2);
  });
});
