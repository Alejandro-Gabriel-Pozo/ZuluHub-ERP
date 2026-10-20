import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { personaId } from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
} from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase, type RolDePrueba } from "./fixtures-identidad";
import { SesionDePrueba, esperarBloqueo } from "./sesiones";

/**
 * H6, tramo T1: concurrencia REAL de las reglas de la base de 0005 (traspaso de gerencia, sucursales,
 * asignaciones), sin los casos de uso: cada prueba lanza varias transacciones a la vez y, con una
 * barrera dentro, fuerza que TODAS hayan leído antes de que cualquiera escriba (el cruce que importa).
 * Después mira la base: nunca dos gerentes ni ninguno, nunca una empresa sin sucursal activa, nunca un
 * traspaso aceptado sin el cambio de roles. Las pruebas del entrelazado exacto (quién espera a quién)
 * usan sesiones directas con el rol real.
 */

const base = inject("baseDePruebas");
// Rondas y reintentos con la máquina cargada: más que los 5 s que vale una prueba por defecto.
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 12;
/** El invariante «nunca dos gerentes ni ninguno» es el más serio: se repite más. */
const RONDAS_CRITICAS = 100;
const PROPUESTO_EN = new Date("2026-10-11T12:00:00Z");
const VENCE_EN = new Date("2026-10-18T12:00:00Z");

type Aislamiento = "read committed" | "serializable";
const AISLAMIENTOS: readonly Aislamiento[] = ["serializable", "read committed"];

describe.skipIf(base === null)("administración: concurrencia de las reglas de 0005", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 12);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const consultar = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;

  type Escena = Readonly<{
    empresa: EmpresaDePrueba;
    sucursal: string;
    gerente: string;
    admin: string;
    operador: string;
    otro: string;
  }>;

  const armar = async (): Promise<Escena> => {
    const empresa = await crearEmpresaActiva(entorno);
    const sucursal = (
      await consultar<{ id: string }>("select id from sucursal where empresa_id = $1", [
        empresa.empresa,
      ])
    )[0]?.id as string;
    const nueva = async (rol: RolDePrueba) => {
      const p = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, empresa.empresa, p.id, rol);
      return p.id;
    };
    return {
      empresa,
      sucursal,
      gerente: await nueva("GERENTE"),
      admin: await nueva("ADMINISTRADOR"),
      operador: await nueva("OPERADOR"),
      otro: await nueva("OPERADOR"),
    };
  };
  const ctx = (e: Escena, persona: string) => comoEmpresa(e.empresa.empresa, personaId(persona));

  const proponer = async (e: Escena, entrante: string): Promise<string> =>
    (
      await dueno.query<{ id: string }>(
        `insert into traspaso_gerencia (empresa_id, origen, propuesto_por, saliente_persona_id,
                                        entrante_persona_id, propuesto_en, vence_en)
         values ($1, 'GERENTE', $2, $2, $3, $4, $5) returning id`,
        [e.empresa.empresa, e.gerente, entrante, PROPUESTO_EN, VENCE_EN],
      )
    ).rows[0]?.id as string;

  const gerentesActivos = async (e: Escena) =>
    (
      await consultar<{ persona_id: string }>(
        "select persona_id from membresia where empresa_id = $1 and rol = 'GERENTE' and activo",
        [e.empresa.empresa],
      )
    ).map((f) => f.persona_id);
  const membresia = async (e: Escena, persona: string) =>
    (
      await consultar<{ rol: string; activo: boolean }>(
        "select rol, activo from membresia where empresa_id = $1 and persona_id = $2",
        [e.empresa.empresa, persona],
      )
    )[0];
  const traspaso = async (id: string) =>
    (
      await consultar<{ estado: string; version: number }>(
        "select estado, version from traspaso_gerencia where id = $1",
        [id],
      )
    )[0];

  // Lo que hace la aceptación (como lo hará T4): el UPDATE condicionado al estado, y los dos roles.
  const intentarAceptar = (
    e: Escena,
    id: string,
    aislamiento: Aislamiento,
    esperar: () => Promise<void>,
  ) =>
    entorno
      .ejecutar(
        { contexto: ctx(e, e.operador), aislamiento },
        async ({ db }): Promise<Resultado<string, never>> => {
          await sql`select estado from traspaso_gerencia where id = ${id}`.execute(db);
          await esperar();
          const r =
            await sql`update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = ${AHORA_DE_PRUEBA}
                            where id = ${id} and estado = 'PROPUESTO'`.execute(db);
          if (Number(r.numAffectedRows) === 0) return ok("YA_RESUELTO");
          const baja = await sql`update membresia set rol = 'ADMINISTRADOR'
                               where empresa_id = ${e.empresa.empresa} and persona_id = ${e.gerente}`.execute(
            db,
          );
          const alta = await sql`update membresia set rol = 'GERENTE'
                               where empresa_id = ${e.empresa.empresa} and persona_id = ${e.operador}`.execute(
            db,
          );
          if (Number(baja.numAffectedRows) !== 1 || Number(alta.numAffectedRows) !== 1) {
            // El código real devuelve un error de negocio: la transacción se revierte entera.
            throw new Error("el cambio de roles no tocó una fila");
          }
          return ok("ACEPTO");
        },
      )
      .catch((error: unknown) => {
        // Un paso que no tocó su fila (por ejemplo el entrante apagado a la vez) se revierte y cuenta como «perdió».
        if (error instanceof Error && error.message.startsWith("el cambio de roles")) {
          return err({ tipo: "Check", restriccion: "perdio" });
        }
        throw error;
      });

  // ===============================================================================================
  // Traspaso de gerencia
  // ===============================================================================================
  it.each(AISLAMIENTOS)(
    "T1 (%s): dos aceptaciones simultáneas del mismo traspaso dejan una sola (un gerente nuevo, un ex gerente administrador)",
    async (aislamiento) => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await armar();
        const id = await proponer(e, e.operador);
        const barrera = crearBarrera(2);
        const [x, y] = await Promise.all([
          intentarAceptar(e, id, aislamiento, barrera),
          intentarAceptar(e, id, aislamiento, barrera),
        ]);
        const resultados = [x, y].map((r) => (r.ok ? r.valor : "ERROR"));
        expect(
          resultados.filter((r) => r === "ACEPTO"),
          `ronda ${n}: ${JSON.stringify([x, y])}`,
        ).toHaveLength(1);
        expect(resultados.filter((r) => r === "YA_RESUELTO")).toHaveLength(1);
        expect(await gerentesActivos(e), `ronda ${n}`).toEqual([e.operador]);
        expect(await membresia(e, e.gerente)).toEqual({ rol: "ADMINISTRADOR", activo: true });
        expect(await traspaso(id)).toEqual({ estado: "ACEPTADO", version: 2 });
      }
    },
  );

  it.each(AISLAMIENTOS)(
    "T2 (%s): aceptar contra cancelar a la vez: gana una y el estado es coherente (nunca ACEPTADO sin el cambio de roles, ni CANCELADO con él)",
    async (aislamiento) => {
      const ganadores = new Set<string>();
      for (let n = 0; n < RONDAS; n++) {
        const e = await armar();
        const id = await proponer(e, e.operador);
        const barrera = crearBarrera(2);
        const [aceptacion, cancelacion] = await Promise.all([
          intentarAceptar(e, id, aislamiento, barrera),
          entorno.ejecutar(
            { contexto: ctx(e, e.gerente), aislamiento },
            async ({ db }): Promise<Resultado<string, never>> => {
              await sql`select estado from traspaso_gerencia where id = ${id}`.execute(db);
              await barrera();
              const r =
                await sql`update traspaso_gerencia set estado = 'CANCELADO', resuelto_en = ${AHORA_DE_PRUEBA},
                                    motivo = 'CANCELADO_POR_LA_EMPRESA'
                                  where id = ${id} and estado = 'PROPUESTO'`.execute(db);
              return ok(Number(r.numAffectedRows) === 0 ? "YA_RESUELTO" : "CANCELO");
            },
          ),
        ]);
        const estado = (await traspaso(id))?.estado as string;
        ganadores.add(estado);
        const gerentes = await gerentesActivos(e);
        if (estado === "ACEPTADO") {
          expect(gerentes, `ronda ${n}`).toEqual([e.operador]);
          expect(aceptacion.ok && aceptacion.valor).toBe("ACEPTO");
          expect(cancelacion.ok && cancelacion.valor).toBe("YA_RESUELTO");
        } else {
          expect(estado, `ronda ${n}`).toBe("CANCELADO");
          expect(gerentes).toEqual([e.gerente]);
          expect(cancelacion.ok && cancelacion.valor).toBe("CANCELO");
          expect(aceptacion.ok && aceptacion.valor).toBe("YA_RESUELTO");
        }
      }
      expect(ganadores.size).toBeGreaterThan(0);
    },
  );

  it.each(AISLAMIENTOS)(
    "T3 (%s): dos propuestas simultáneas a entrantes distintos dejan un solo traspaso en curso",
    async (aislamiento) => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await armar();
        const barrera = crearBarrera(2);
        const proponerA = (entrante: string) =>
          entorno.ejecutar({ contexto: ctx(e, e.gerente), aislamiento }, async ({ db }) => {
            await sql`select count(*) from traspaso_gerencia`.execute(db);
            await barrera();
            await sql`insert into traspaso_gerencia (empresa_id, origen, propuesto_por, saliente_persona_id,
                                                     entrante_persona_id, propuesto_en, vence_en)
                      values (${e.empresa.empresa}, 'GERENTE', ${e.gerente}, ${e.gerente}, ${entrante},
                              ${PROPUESTO_EN}, ${VENCE_EN})`.execute(db);
            return ok(entrante);
          });
        const [x, y] = await Promise.all([proponerA(e.operador), proponerA(e.otro)]);
        expect([x.ok, y.ok].filter(Boolean), `ronda ${n}: ${JSON.stringify([x, y])}`).toHaveLength(
          1,
        );
        const perdedora = x.ok ? y : x;
        expect(perdedora).toEqual({
          ok: false,
          error: { tipo: "Unicidad", restriccion: "traspaso_gerencia_en_curso_uk" },
        });
        expect(
          await consultar(
            "select 1 from traspaso_gerencia where empresa_id = $1 and estado = 'PROPUESTO'",
            [e.empresa.empresa],
          ),
        ).toHaveLength(1);
      }
    },
  );

  /**
   * Corre «apagar al entrante contra aceptar» `rondas` veces y verifica el invariante de cada ronda.
   * `traspasoPrimero`: el orden en que `apagarMembresia` toca las filas. Con el traspaso primero (el
   * mismo orden que la aceptación) las dos transacciones se esperan en fila; con la membresía primero
   * se cruzan los bloqueos (deadlock): Postgres aborta una a las 1 s (`deadlock_timeout`) y el adaptador
   * la repite. Las dos son correctas; la primera es la que conviene al código real.
   */
  const apagarContraAceptar = async (
    aislamiento: Aislamiento,
    rondas: number,
    traspasoPrimero: boolean,
  ) => {
    let aceptaron = 0;
    let apagaron = 0;
    for (let n = 0; n < rondas; n++) {
      const e = await armar();
      const id = await proponer(e, e.operador);
      const barrera = crearBarrera(2);
      const [aceptacion, apagado] = await Promise.all([
        intentarAceptar(e, id, aislamiento, barrera),
        entorno.ejecutar(
          { contexto: ctx(e, e.admin), aislamiento },
          async ({ db }): Promise<Resultado<string, never>> => {
            await sql`select activo from membresia where persona_id = ${e.operador}`.execute(db);
            await barrera();
            // Como `apagarMembresia`: apaga al miembro y cancela el traspaso en curso del apagado.
            const cancelar = () =>
              sql`update traspaso_gerencia set estado = 'CANCELADO', resuelto_en = ${AHORA_DE_PRUEBA},
                    motivo = 'ENTRANTE_DADO_DE_BAJA'
                  where empresa_id = ${e.empresa.empresa} and entrante_persona_id = ${e.operador}
                    and estado = 'PROPUESTO'`.execute(db);
            const apagar = () =>
              sql`update membresia set activo = false
                  where empresa_id = ${e.empresa.empresa} and persona_id = ${e.operador}`.execute(
                db,
              );
            if (traspasoPrimero) await cancelar();
            const r = await apagar();
            if (Number(r.numAffectedRows) === 0) return ok("ES_EL_GERENTE");
            if (!traspasoPrimero) await cancelar();
            return ok("APAGADO");
          },
        ),
      ]);
      const gerentes = await gerentesActivos(e);
      // SIEMPRE exactamente un gerente activo.
      expect(gerentes, `ronda ${n}: ${JSON.stringify([aceptacion, apagado])}`).toHaveLength(1);
      const estado = (await traspaso(id))?.estado;
      const entrante = await membresia(e, e.operador);
      if (gerentes[0] === e.operador) {
        aceptaron++;
        expect(estado).toBe("ACEPTADO");
        expect(entrante).toEqual({ rol: "GERENTE", activo: true });
        expect(await membresia(e, e.gerente)).toEqual({ rol: "ADMINISTRADOR", activo: true });
        expect(apagado.ok && apagado.valor, `ronda ${n}`).toBe("ES_EL_GERENTE");
        expect(aceptacion.ok && aceptacion.valor).toBe("ACEPTO");
      } else {
        apagaron++;
        expect(gerentes).toEqual([e.gerente]);
        expect(await membresia(e, e.gerente)).toEqual({ rol: "GERENTE", activo: true });
        expect(entrante).toEqual({ rol: "OPERADOR", activo: false });
        expect(estado, `ronda ${n}`).toBe("CANCELADO");
        expect(apagado.ok && apagado.valor, `ronda ${n}`).toBe("APAGADO");
      }
    }
    expect(aceptaron + apagaron).toBe(rondas);
  };

  it.each(AISLAMIENTOS)(
    `T4 (%s): apagar al entrante contra aceptar (${RONDAS_CRITICAS} corridas): o queda gerente (y apagarlo da ES_EL_GERENTE) o la aceptación pierde; nunca dos gerentes ni ninguno`,
    async (aislamiento) => {
      await apagarContraAceptar(aislamiento, RONDAS_CRITICAS, true);
    },
    120_000,
  );

  it.each(AISLAMIENTOS)(
    "T4b (%s): lo mismo tocando la membresía antes que el traspaso: los bloqueos se cruzan (deadlock, lo resuelve Postgres y el adaptador repite) y el invariante se mantiene",
    async (aislamiento) => {
      await apagarContraAceptar(aislamiento, 8, false);
    },
    120_000,
  );

  it("T5: dos aceptaciones de plataforma y de la empresa a la vez sobre el mismo traspaso (sesiones, READ COMMITTED): la segunda espera y no encuentra nada que aceptar", async () => {
    if (base === null) return;
    const e = await armar();
    const id = await proponer(e, e.operador);
    const s1 = await SesionDePrueba.abrir(propia.base, "pedernal_app", ctx(e, e.operador));
    const s2 = await SesionDePrueba.abrir(propia.base, "pedernal_app", ctx(e, e.operador));
    try {
      const sentencia =
        "update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = $2 where id = $1 and estado = 'PROPUESTO'";
      expect((await s1.directo(sentencia, [id, AHORA_DE_PRUEBA])).ok).toBe(true);
      const segunda = s2.directo(sentencia, [id, AHORA_DE_PRUEBA]);
      expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
      await s1.directo(
        "update membresia set rol = 'ADMINISTRADOR' where empresa_id = $1 and persona_id = $2",
        [e.empresa.empresa, e.gerente],
      );
      await s1.directo(
        "update membresia set rol = 'GERENTE' where empresa_id = $1 and persona_id = $2",
        [e.empresa.empresa, e.operador],
      );
      expect((await s1.confirmar()).ok).toBe(true);
      const r = await segunda;
      expect(r).toMatchObject({ ok: true, filas: 0 });
    } finally {
      await s1.cerrar();
      await s2.cerrar();
    }
    expect(await gerentesActivos(e)).toEqual([e.operador]);
  });

  // ===============================================================================================
  // Sucursales: nunca sin una activa
  // ===============================================================================================
  const conSucursales = async (cantidad: number) => {
    const e = await armar();
    const ids = [e.sucursal];
    for (let i = 1; i < cantidad; i++) {
      ids.push(
        (
          await dueno.query<{ id: string }>(
            "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
            [e.empresa.empresa, `Local ${i}`],
          )
        ).rows[0]?.id as string,
      );
    }
    return { e, ids };
  };
  const activas = async (e: Escena) =>
    Number(
      (
        await consultar<{ n: string }>(
          "select count(*) as n from sucursal where empresa_id = $1 and activa",
          [e.empresa.empresa],
        )
      )[0]?.n,
    );

  it("S1 (READ COMMITTED, sesiones): la segunda baja de las dos últimas espera a la primera y, al confirmarse esta, se rechaza", async () => {
    if (base === null) return;
    const { e, ids } = await conSucursales(2);
    const s1 = await SesionDePrueba.abrir(propia.base, "pedernal_app", ctx(e, e.gerente));
    const s2 = await SesionDePrueba.abrir(propia.base, "pedernal_app", ctx(e, e.gerente));
    try {
      expect(
        await s1.directo("update sucursal set activa = false where id = $1", [ids[0]]),
      ).toMatchObject({ ok: true, filas: 1 });
      const segunda = s2.directo("update sucursal set activa = false where id = $1", [ids[1]]);
      expect(await esperarBloqueo(dueno, s2.pid), "la segunda tiene que esperar a la primera").toBe(
        true,
      );
      expect((await s1.confirmar()).ok).toBe(true);
      expect(await segunda).toMatchObject({
        ok: false,
        codigo: "23514",
        restriccion: "sucursal_ultima_activa",
      });
    } finally {
      await s1.cerrar();
      await s2.cerrar();
    }
    expect(await activas(e)).toBe(1);
  });

  it("S2 (REPEATABLE READ, sesiones): con un instante de lectura viejo la segunda baja no pasa a ciegas: Postgres aborta (40001) y el trabajo se repite", async () => {
    if (base === null) return;
    const { e, ids } = await conSucursales(2);
    const s1 = await SesionDePrueba.abrir(
      propia.base,
      "pedernal_app",
      ctx(e, e.gerente),
      "repeatable read",
    );
    const s2 = await SesionDePrueba.abrir(
      propia.base,
      "pedernal_app",
      ctx(e, e.gerente),
      "repeatable read",
    );
    try {
      // Las dos toman su instante de lectura ANTES de que cualquiera escriba.
      await s1.directo("select count(*) from sucursal");
      await s2.directo("select count(*) from sucursal");
      expect(
        await s1.directo("update sucursal set activa = false where id = $1", [ids[0]]),
      ).toMatchObject({ ok: true, filas: 1 });
      const segunda = s2.directo("update sucursal set activa = false where id = $1", [ids[1]]);
      expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
      expect((await s1.confirmar()).ok).toBe(true);
      expect(await segunda).toMatchObject({ ok: false, codigo: "40001" });
    } finally {
      await s1.cerrar();
      await s2.cerrar();
    }
    expect(await activas(e)).toBe(1);
  });

  it.each(AISLAMIENTOS)(
    "S3 (%s): desactivar a la vez las dos últimas sucursales deja una activa; la perdedora recibe sucursal_ultima_activa",
    async (aislamiento) => {
      for (let n = 0; n < RONDAS; n++) {
        const { e, ids } = await conSucursales(2);
        const barrera = crearBarrera(2);
        const baja = (id: string) =>
          entorno.ejecutar({ contexto: ctx(e, e.gerente), aislamiento }, async ({ db }) => {
            await sql`select id from sucursal where empresa_id = ${e.empresa.empresa} and activa`.execute(
              db,
            );
            await barrera();
            await sql`update sucursal set activa = false where id = ${id}`.execute(db);
            return ok(id);
          });
        const [x, y] = await Promise.all([baja(ids[0] as string), baja(ids[1] as string)]);
        expect([x.ok, y.ok].filter(Boolean), `ronda ${n}: ${JSON.stringify([x, y])}`).toHaveLength(
          1,
        );
        expect(x.ok ? y : x).toEqual({
          ok: false,
          error: { tipo: "Check", restriccion: "sucursal_ultima_activa" },
        });
        expect(await activas(e)).toBe(1);
      }
    },
  );

  it.each(AISLAMIENTOS)(
    "S4 (%s): tres bajas simultáneas de tres sucursales dejan exactamente una activa",
    async (aislamiento) => {
      for (let n = 0; n < RONDAS; n++) {
        const { e, ids } = await conSucursales(3);
        const barrera = crearBarrera(3);
        const resultados = await Promise.all(
          ids.map((id) =>
            entorno.ejecutar({ contexto: ctx(e, e.gerente), aislamiento }, async ({ db }) => {
              await sql`select id from sucursal where empresa_id = ${e.empresa.empresa} and activa`.execute(
                db,
              );
              await barrera();
              await sql`update sucursal set activa = false where id = ${id}`.execute(db);
              return ok(id);
            }),
          ),
        );
        expect(
          resultados.filter((r) => r.ok),
          `ronda ${n}`,
        ).toHaveLength(2);
        for (const r of resultados.filter((r) => !r.ok)) {
          expect(r).toEqual({
            ok: false,
            error: { tipo: "Check", restriccion: "sucursal_ultima_activa" },
          });
        }
        expect(await activas(e)).toBe(1);
      }
    },
  );

  it("S5 (sesiones): renombrar una sucursal a la vez que se desactiva otra no se traba (sin deadlock) y las dos confirman", async () => {
    if (base === null) return;
    const { e, ids } = await conSucursales(3);
    const s1 = await SesionDePrueba.abrir(propia.base, "pedernal_app", ctx(e, e.gerente));
    const s2 = await SesionDePrueba.abrir(propia.base, "pedernal_app", ctx(e, e.gerente));
    try {
      // s2 renombra la segunda (queda su fila bloqueada); s1 desactiva la primera: necesita bloquear
      // en modo compartido a las otras activas, así que espera a que s2 confirme. s2 no espera a nadie.
      expect(
        await s2.directo("update sucursal set nombre = 'Renombrada' where id = $1", [ids[1]]),
      ).toMatchObject({ ok: true });
      const baja = s1.directo("update sucursal set activa = false where id = $1", [ids[0]]);
      expect(await esperarBloqueo(dueno, s1.pid)).toBe(true);
      expect((await s2.confirmar()).ok).toBe(true);
      expect(await baja).toMatchObject({ ok: true, filas: 1 });
      expect((await s1.confirmar()).ok).toBe(true);
    } finally {
      await s1.cerrar();
      await s2.cerrar();
    }
    expect(await activas(e)).toBe(2);
  });

  // ===============================================================================================
  // Asignaciones
  // ===============================================================================================
  it("A1 (READ COMMITTED, sesiones): dos altas de la misma asignación a la vez: la segunda espera y choca con la clave", async () => {
    if (base === null) return;
    const e = await armar();
    const alta =
      "insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id) values ($1, $2, $3)";
    const parametros = [e.empresa.empresa, e.operador, e.sucursal];
    const s1 = await SesionDePrueba.abrir(propia.base, "pedernal_app", ctx(e, e.gerente));
    const s2 = await SesionDePrueba.abrir(propia.base, "pedernal_app", ctx(e, e.admin));
    try {
      expect(await s1.directo(alta, parametros)).toMatchObject({ ok: true, filas: 1 });
      const segunda = s2.directo(alta, parametros);
      expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
      expect((await s1.confirmar()).ok).toBe(true);
      expect(await segunda).toMatchObject({
        ok: false,
        codigo: "23505",
        restriccion: "asignacion_sucursal_pkey",
      });
    } finally {
      await s1.cerrar();
      await s2.cerrar();
    }
    expect(
      await consultar("select 1 from asignacion_sucursal where persona_id = $1", [e.operador]),
    ).toHaveLength(1);
  });

  it("A2 (SERIALIZABLE): asignar a un miembro a la vez que se lo apaga (y se apagan sus asignaciones) nunca deja una asignación activa de un miembro apagado", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const e = await armar();
      const barrera = crearBarrera(2);
      const [asignado, apagado] = await Promise.all([
        entorno.ejecutar({ contexto: ctx(e, e.gerente) }, async ({ db }) => {
          await sql`select activo from membresia where persona_id = ${e.operador}`.execute(db);
          await barrera();
          await sql`insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id)
                    values (${e.empresa.empresa}, ${e.operador}, ${e.sucursal})`.execute(db);
          return ok("ASIGNADO");
        }),
        entorno.ejecutar({ contexto: ctx(e, e.admin) }, async ({ db }) => {
          await sql`select activa from asignacion_sucursal where persona_id = ${e.operador}`.execute(
            db,
          );
          await barrera();
          await sql`update membresia set activo = false
                    where empresa_id = ${e.empresa.empresa} and persona_id = ${e.operador}`.execute(
            db,
          );
          await sql`update asignacion_sucursal set activa = false where persona_id = ${e.operador}`.execute(
            db,
          );
          return ok("APAGADO");
        }),
      ]);
      const huerfanas = await consultar(
        `select 1 from asignacion_sucursal a join membresia m
           on m.empresa_id = a.empresa_id and m.persona_id = a.persona_id
         where a.empresa_id = $1 and a.activa and not m.activo`,
        [e.empresa.empresa],
      );
      expect(huerfanas, `ronda ${n}: ${JSON.stringify([asignado, apagado])}`).toEqual([]);
      expect((await membresia(e, e.operador))?.activo).toBe(false);
    }
  });
});
