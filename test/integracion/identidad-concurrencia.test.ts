import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { cambiarEstado } from "../../src/modulos/empresas/publico";
import { errorDeNegocioDeRestriccion } from "../../src/modulos/identidad/casos-de-uso/traducir";
import {
  crearCasosDeUsoDeIdentidad,
  emailDesdeTexto,
  nuevaInvitacion,
  type CasosDeUsoDeIdentidad,
} from "../../src/modulos/identidad/publico";
import {
  personaId,
  sucursalId,
  type PersonaId,
  type SucursalId,
} from "../../src/primitivas/identificadores/marca";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import type { Tokens } from "../../src/puertos/tokens";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  comoPlataforma,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
  type TxDePrueba,
} from "./entorno";
import {
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  incluirEmpresa,
  sucursalDe,
  type RolDePrueba,
} from "./fixtures-identidad";
import { usuarioDePrueba } from "../utilidades/usuarios";

/**
 * H3, tramo 3: concurrencia REAL de los casos de uso de identidad. Cada prueba lanza dos
 * transacciones a la vez (`Promise.all`) y, con una barrera dentro de la transacción, fuerza que
 * AMBAS hayan leído el estado antes de que cualquiera escriba: es el cruce que importa. Después
 * mira la base: nunca hay estados a medias ni duplicados, y el perdedor (tras el reintento
 * serializable del adaptador) ve el resultado del ganador.
 */

const base = inject("baseDePruebas");
const ahora = AHORA_DE_PRUEBA;
const RONDAS = 8;

type Fila = Record<string, unknown>;
type Gancho = (tx: TxDePrueba, esperar: () => Promise<void>) => TxDePrueba;

// Cada caso repite RONDAS carreras con barrera y, ante un conflicto de serialización, el adaptador reintenta con
// espera creciente (hasta ~0,5 s por transacción). Con la máquina cargada eso supera los 5 s por defecto de
// vitest sin que haya ningún defecto. El tope se sube **solo en este archivo**: un bloqueo real sigue fallando,
// a los 60 s.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * El adaptador agota sus reintentos cuando una carrera se encadena bajo carga y devuelve el error tipado
 * `ConcurrenciaAgotada`: es una respuesta legítima («reintentá»), no un estado inconsistente. Lo que estas
 * pruebas garantizan es la regla de negocio, no que nadie pierda nunca la carrera por agotamiento.
 */
const esAgotada = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { tipo?: unknown }).tipo === "ConcurrenciaAgotada";

describe.skipIf(base === null)("identidad: concurrencia de los casos de uso (K1 a K9)", () => {
  // Base propia de este archivo: SERIALIZABLE aborta por falsos positivos cuando OTROS archivos de
  // prueba, en paralelo, escriben las mismas tablas (los bloqueos de lectura son por página o tabla).
  // Aislarla hace que los reintentos que se ven acá sean solo los de la concurrencia que se prueba.
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let tokens: Tokens;
  let casos: CasosDeUsoDeIdentidad;
  // La barrera de la ronda en curso: cada ronda arma una nueva (una barrera se usa una vez).
  let barrera: () => Promise<void> = () => Promise.resolve();
  let gancho: Gancho = (tx) => tx;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 12, (tx) => gancho(tx, () => barrera()));
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    tokens = crearTokensHmac(randomBytes(32));
    casos = crearCasosDeUsoDeIdentidad({
      transacciones: entorno,
      tokens,
      reglas: REGLAS_DE_EMPRESA,
    });
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  /** Prepara la ronda: `participantes` transacciones esperan en el punto que marque el gancho. */
  const ronda = (participantes: number, nuevoGancho: Gancho) => {
    barrera = crearBarrera(participantes);
    gancho = nuevoGancho;
  };

  /** Espera en la primera lectura de cada transacción (cada intento arma su propio `tx`). */
  const trasLeer =
    <K extends "invitaciones" | "membresias" | "empresas" | "autorizacion">(
      repositorio: K,
      metodo: string,
    ): Gancho =>
    (tx, esperar) => {
      let primera = true;
      const original = tx[repositorio] as unknown as Record<
        string,
        (...a: unknown[]) => Promise<unknown>
      >;
      const envuelto = {
        ...original,
        [metodo]: async (...args: unknown[]) => {
          const r = await (original[metodo] as (...a: unknown[]) => Promise<unknown>)(...args);
          if (primera) {
            primera = false;
            await esperar();
          }
          return r;
        },
      };
      return { ...tx, [repositorio]: envuelto };
    };

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);

  type Escenario = EmpresaDePrueba &
    Readonly<{ sucursal: SucursalId; gerente: PersonaId; ctx: ContextoOperativo }>;

  const escenario = async (tenant?: EmpresaDePrueba["tenant"]): Promise<Escenario> => {
    const e = await crearEmpresaActiva(entorno, tenant === undefined ? {} : { tenant });
    const sucursal = sucursalId(await sucursalDe(dueno, e.empresa));
    const g = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, g.id, "GERENTE");
    const gerente = personaId(g.id);
    return { ...e, sucursal, gerente, ctx: comoEmpresa(e.empresa, gerente) };
  };

  /** Una empresa activa SIN gerente: dos administradores y nada más. */
  const empresaConDosAdmins = async () => {
    const e = await crearEmpresaActiva(entorno);
    const a = await crearPersonaDeBase(dueno);
    const b = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, a.id, "ADMINISTRADOR");
    await crearMembresiaDeBase(dueno, e.empresa, b.id, "ADMINISTRADOR");
    const a1 = personaId(a.id);
    const b1 = personaId(b.id);
    return { e, a: a1, b: b1, ctxA: comoEmpresa(e.empresa, a1), ctxB: comoEmpresa(e.empresa, b1) };
  };

  const invitacionMultiempresa = async (
    empresas: { e: EmpresaDePrueba; rol: RolDePrueba }[],
    email = emailAlAzar("multi"),
  ) => {
    const emitido = tokens.emitir();
    const inv = await crearInvitacionDeBase(dueno, {
      tenant: empresas[0]?.e.tenant as string,
      id: emitido.invitacionId,
      tokenHash: emitido.tokenHash,
      email,
    });
    for (const { e, rol } of empresas) await incluirEmpresa(dueno, inv, e.empresa, rol);
    return { inv, email, token: emitido.token };
  };

  const altaPendiente = async () => {
    const empresa = await crearEmpresaEnAlta(entorno);
    const emitido = tokens.emitir();
    const email = emailAlAzar("gerente");
    const inv = await crearInvitacionDeBase(dueno, {
      tenant: empresa.tenant,
      id: emitido.invitacionId,
      tokenHash: emitido.tokenHash,
      tipo: "ALTA_GERENTE",
      email,
      emitidaEn: new Date("2026-10-11T00:00:00Z"),
      venceEn: new Date("2026-10-12T00:00:00Z"),
    });
    await incluirEmpresa(dueno, inv, empresa.empresa, "GERENTE");
    return { empresa, inv, email, token: emitido.token };
  };

  const aceptar = (token: string, email: string) =>
    casos.aceptarInvitacion({
      token,
      emailAutenticado: email,
      usuarioAuth: usuarioDePrueba(email),
      ahora,
    });

  // =============================================================================================
  it("K1: dos aceptaciones simultáneas de una invitación a 3 empresas dejan 3 membresías (no 6)", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const e1 = await escenario();
      const e2 = await escenario(e1.tenant);
      const e3 = await escenario(e1.tenant);
      const { inv, email, token } = await invitacionMultiempresa([
        { e: e1, rol: "OPERADOR" },
        { e: e2, rol: "ADMINISTRADOR" },
        { e: e3, rol: "OPERADOR" },
      ]);
      ronda(2, trasLeer("invitaciones", "obtenerPorHash"));

      const [x, y] = await Promise.all([aceptar(token, email), aceptar(token, email)]);

      expect([x.ok, y.ok], `ronda ${n}`).toEqual([true, true]);
      const yaEstaban = [x, y].map((r) => r.ok && r.valor.yaEstabaAceptada);
      expect(
        yaEstaban.filter(Boolean),
        `ronda ${n}: una gana, la otra ve el resultado`,
      ).toHaveLength(1);
      expect(await contar("select count(*) as n from persona where email = $1", [email])).toBe(1);
      const persona = (await filas("select id from persona where email = $1", [email]))[0]?.["id"];
      expect(
        await contar("select count(*) as n from membresia where persona_id = $1", [persona]),
      ).toBe(3);
      expect(await filas("select estado from invitacion where id = $1", [inv.id])).toEqual([
        { estado: "ACEPTADA" },
      ]);
      for (const e of [e1, e2, e3]) {
        expect(
          await contar(
            "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'INVITACION_ACEPTADA'",
            [e.empresa],
          ),
        ).toBe(1);
      }
    }
  });

  it("K2: dos aceptaciones simultáneas del alta dejan un solo gerente y la empresa ACTIVE", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const { empresa, email, token } = await altaPendiente();
      ronda(2, trasLeer("invitaciones", "obtenerPorHash"));

      const [x, y] = await Promise.all([aceptar(token, email), aceptar(token, email)]);

      expect([x.ok, y.ok], `ronda ${n}`).toEqual([true, true]);
      expect([x, y].filter((r) => r.ok && r.valor.yaEstabaAceptada)).toHaveLength(1);
      expect(
        await filas("select rol, activo from membresia where empresa_id = $1", [empresa.empresa]),
      ).toEqual([{ rol: "GERENTE", activo: true }]);
      expect(
        (await filas("select estado from empresa where id = $1", [empresa.empresa]))[0]?.["estado"],
      ).toBe("ACTIVE");
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'EMPRESA_ACTIVADA'",
          [empresa.empresa],
        ),
      ).toBe(1);
    }
  });

  it("K2b: dos aceptaciones del alta por personas distintas: solo una se queda con la invitación", async () => {
    // La segunda persona no puede aceptar con el token (el email no es el suyo): se rechaza sin tocar nada.
    const { empresa, email, token } = await altaPendiente();
    const intruso = emailAlAzar("intruso");
    ronda(2, trasLeer("invitaciones", "obtenerPorHash"));
    const [legitima, ajena] = await Promise.all([aceptar(token, email), aceptar(token, intruso)]);
    expect(legitima.ok).toBe(true);
    expect(ajena).toEqual({ ok: false, error: "INVITACION_DE_OTRO_EMAIL" });
    expect(
      await contar("select count(*) as n from membresia where empresa_id = $1", [empresa.empresa]),
    ).toBe(1);
    expect(await contar("select count(*) as n from persona where email = $1", [intruso])).toBe(0);
  });

  it("K3: aceptar el alta mientras la plataforma la cancela: gana una y el estado queda coherente", async () => {
    const resultados = { acepto: 0, cancelo: 0 };
    for (let n = 0; n < RONDAS; n++) {
      const { empresa, inv, email, token } = await altaPendiente();
      ronda(2, trasLeer("empresas", "obtener"));

      const cancelar = entorno.ejecutar({ contexto: comoPlataforma() }, async (tx) => {
        const actual = await tx.empresas.obtener(empresa.empresa);
        if (actual === null) throw new Error("sin empresa");
        const cambio = cambiarEstado(actual, "CANCELLED", "alta cancelada por la plataforma");
        // Si la aceptación ya la activó, cancelar es una transición no permitida: un error de negocio.
        if (!cambio.ok) return err(cambio.error);
        const r = await tx.empresas.cambiarEstado(actual.id, actual.version, cambio.valor);
        if (!r.ok) return err(r.error);
        await sql`update invitacion set estado = 'REVOCADA', revocada_en = ${ahora}, motivo_revocacion = 'alta cancelada'
                  where id = ${inv.id} and estado = 'PENDIENTE'`.execute(tx.db);
        return ok("cancelada" as const);
      });
      const [aceptacion, cancelacion] = await Promise.all([aceptar(token, email), cancelar]);

      const estado = (
        await filas("select estado from empresa where id = $1", [empresa.empresa])
      )[0]?.["estado"];
      const gerentes = await contar(
        "select count(*) as n from membresia where empresa_id = $1 and rol = 'GERENTE' and activo",
        [empresa.empresa],
      );
      const estadoInv = (await filas("select estado from invitacion where id = $1", [inv.id]))[0]?.[
        "estado"
      ];
      if (aceptacion.ok) {
        // Ganó la aceptación: la empresa opera, hay un gerente y la cancelación ya no pudo.
        resultados.acepto++;
        expect({ estado, gerentes, estadoInv }, `ronda ${n}`).toEqual({
          estado: "ACTIVE",
          gerentes: 1,
          estadoInv: "ACEPTADA",
        });
        expect(cancelacion.ok, `ronda ${n}`).toBe(false);
      } else {
        // Ganó la cancelación: nadie queda como gerente y la aceptación se rechazó con un error de negocio.
        resultados.cancelo++;
        expect({ estado, gerentes, estadoInv }, `ronda ${n}`).toEqual({
          estado: "CANCELLED",
          gerentes: 0,
          estadoInv: "REVOCADA",
        });
        expect(cancelacion.ok, `ronda ${n}`).toBe(true);
        expect(["ALTA_NO_PENDIENTE", "INVITACION_REVOCADA"]).toContain(aceptacion.error);
      }
    }
    expect(resultados.acepto + resultados.cancelo).toBe(RONDAS);
  });

  it("K4: dos reenvíos simultáneos de la misma invitación dejan una sola vigente", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const e = await escenario();
      const r0 = await casos.invitarUsuario(e.ctx, {
        email: emailAlAzar(),
        rol: "OPERADOR",
        sucursales: [e.sucursal],
      });
      if (!r0.ok) throw new Error("no se pudo invitar");
      const origen = r0.valor.invitacionId;
      ronda(2, trasLeer("invitaciones", "obtenerPorId"));

      const [x, y] = await Promise.all([
        casos.reenviarInvitacion(e.ctx, { invitacionId: origen }),
        casos.reenviarInvitacion(e.ctx, { invitacionId: origen }),
      ]);

      expect([x.ok, y.ok], `ronda ${n}`).toEqual([true, true]);
      if (!x.ok || !y.ok) return;
      expect(x.valor.invitacionId, `ronda ${n}: las dos ven la misma vigente`).toBe(
        y.valor.invitacionId,
      );
      expect([x, y].filter((r) => r.ok && r.valor.yaEstabaReenviada)).toHaveLength(1);
      const vigentes = await filas(
        "select invitacion_id from invitacion_empresa where empresa_id = $1 and estado = 'PENDIENTE'",
        [e.empresa],
      );
      expect(vigentes).toEqual([{ invitacion_id: x.valor.invitacionId }]);
      expect(
        await filas("select estado, reemplazada_por from invitacion where id = $1", [origen]),
      ).toEqual([{ estado: "REVOCADA", reemplazada_por: x.valor.invitacionId }]);
      // Un envío por invitación: la de origen y la única nueva.
      expect(
        await contar("select count(*) as n from trabajo where empresa_id = $1", [e.empresa]),
      ).toBe(2);
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'INVITACION_REENVIADA'",
          [e.empresa],
        ),
      ).toBe(1);
    }
  });

  it("K5: dos invitaciones simultáneas al mismo email dejan una sola pendiente", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const e = await escenario();
      const email = emailAlAzar("mismo");
      ronda(2, trasLeer("invitaciones", "pendientesDeEmail"));

      const [x, y] = await Promise.all([
        casos.invitarUsuario(e.ctx, { email, rol: "OPERADOR", sucursales: [e.sucursal] }),
        casos.invitarUsuario(e.ctx, { email, rol: "OPERADOR", sucursales: [e.sucursal] }),
      ]);

      expect([x.ok, y.ok], `ronda ${n}`).toEqual([true, true]);
      if (!x.ok || !y.ok) return;
      expect(x.valor.invitacionId).toBe(y.valor.invitacionId);
      expect([x, y].filter((r) => r.ok && r.valor.yaExistia)).toHaveLength(1);
      expect(
        await contar(
          "select count(*) as n from invitacion_empresa where empresa_id = $1 and email = $2",
          [e.empresa, email],
        ),
      ).toBe(1);
      expect(
        await contar("select count(*) as n from trabajo where empresa_id = $1", [e.empresa]),
      ).toBe(1);
      expect(
        await contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
          e.empresa,
        ]),
      ).toBe(1);
    }
  });

  it("K6: dos administradores se apagan entre sí a la vez: siempre queda uno (nunca cero)", async () => {
    const motivos = new Map<string, number>();
    let rondas = 0;
    for (let n = 0; n < RONDAS * 2; n++) {
      const { e, a, b, ctxA, ctxB } = await empresaConDosAdmins();
      ronda(2, trasLeer("membresias", "listarActivas"));

      const resultados = await Promise.all([
        casos.apagarMembresia(ctxA, { personaId: b }),
        casos.apagarMembresia(ctxB, { personaId: a }),
      ]);

      const activos = await filas(
        "select persona_id from membresia where empresa_id = $1 and activo",
        [e.empresa],
      );
      const exitos = resultados.filter((r) => r.ok).length;
      // La regla: nunca cero, no pueden apagarse los dos, y cada éxito apaga exactamente a uno.
      expect(activos.length, `ronda ${n}: quedó sin admin`).toBeGreaterThanOrEqual(1);
      expect(exitos, `ronda ${n}: se apagaron los dos`).toBeLessThanOrEqual(1);
      expect(activos.length, `ronda ${n}: cada éxito apaga a uno`).toBe(2 - exitos);
      // La que perdió ve al otro ya apagado (ya no es admin ella, o es la última) o agotó los reintentos.
      for (const r of resultados) {
        if (r.ok) continue;
        const motivo = esAgotada(r.error) ? "ConcurrenciaAgotada" : JSON.stringify(r.error);
        motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1);
        expect(['"SIN_PERMISO"', '"ULTIMO_ADMIN"', "ConcurrenciaAgotada"]).toContain(motivo);
      }
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'MEMBRESIA_APAGADA'",
          [e.empresa],
        ),
      ).toBe(exitos);
      rondas++;
    }
    expect(rondas).toBe(RONDAS * 2);
    expect([...motivos.keys()].length).toBeGreaterThan(0);
  });

  it("K6b: un administrador se apaga a sí mismo y al otro a la vez: siempre queda uno", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const { e, a, b, ctxA } = await empresaConDosAdmins();
      ronda(2, trasLeer("membresias", "listarActivas"));

      const resultados = await Promise.all([
        casos.apagarMembresia(ctxA, { personaId: a }),
        casos.apagarMembresia(ctxA, { personaId: b }),
      ]);

      const activos = await contar(
        "select count(*) as n from membresia where empresa_id = $1 and activo",
        [e.empresa],
      );
      const exitos = resultados.filter((r) => r.ok).length;
      // La regla: nunca cero, no pueden apagarse los dos, y cada éxito apaga exactamente a uno.
      expect(activos, `ronda ${n}: quedó sin admin`).toBeGreaterThanOrEqual(1);
      expect(exitos, `ronda ${n}: se apagaron los dos`).toBeLessThanOrEqual(1);
      expect(activos, `ronda ${n}: cada éxito apaga a uno`).toBe(2 - exitos);
      for (const r of resultados) {
        if (r.ok) continue;
        const motivo = esAgotada(r.error) ? "ConcurrenciaAgotada" : r.error;
        expect(["SIN_PERMISO", "ULTIMO_ADMIN", "ConcurrenciaAgotada"]).toContain(motivo);
      }
    }
  });

  it("K7: aceptar una invitación a 3 empresas mientras se suspende una: todo o nada", async () => {
    const resultados = { acepto: 0, rechazo: 0 };
    for (let n = 0; n < RONDAS; n++) {
      const e1 = await escenario();
      const e2 = await escenario(e1.tenant);
      const e3 = await escenario(e1.tenant);
      const { inv, email, token } = await invitacionMultiempresa([
        { e: e1, rol: "OPERADOR" },
        { e: e2, rol: "OPERADOR" },
        { e: e3, rol: "OPERADOR" },
      ]);
      ronda(2, trasLeer("empresas", "obtener"));

      const suspender = entorno.ejecutar({ contexto: comoPlataforma() }, async (tx) => {
        const actual = await tx.empresas.obtener(e2.empresa);
        if (actual === null) throw new Error("sin empresa");
        const cambio = cambiarEstado(actual, "SUSPENDED", "suspendida en la prueba");
        if (!cambio.ok) throw new Error("cambio inválido");
        const r = await tx.empresas.cambiarEstado(actual.id, actual.version, cambio.valor);
        if (!r.ok) throw new Error("no se pudo suspender");
        return ok("suspendida" as const);
      });
      const [aceptacion, suspension] = await Promise.all([aceptar(token, email), suspender]);

      expect(suspension.ok, `ronda ${n}`).toBe(true);
      const membresias = await contar(
        "select count(*) as n from membresia where empresa_id = any($1) and rol <> 'GERENTE'",
        [[e1.empresa, e2.empresa, e3.empresa]],
      );
      const estadoInv = (await filas("select estado from invitacion where id = $1", [inv.id]))[0]?.[
        "estado"
      ];
      if (aceptacion.ok) {
        resultados.acepto++;
        expect({ membresias, estadoInv }, `ronda ${n}`).toEqual({
          membresias: 3,
          estadoInv: "ACEPTADA",
        });
      } else {
        resultados.rechazo++;
        expect({ membresias, estadoInv }, `ronda ${n}: ninguna membresía`).toEqual({
          membresias: 0,
          estadoInv: "PENDIENTE",
        });
        expect(aceptacion.error).toEqual({
          codigo: "EMPRESA_NO_OPERA",
          empresaId: e2.empresa,
          motivo: "EMPRESA_SUSPENDIDA",
        });
      }
    }
    expect(resultados.acepto + resultados.rechazo).toBe(RONDAS);
  });

  it("K8: el último admin se apaga a sí mismo mientras otra persona acepta ser admin: nunca queda sin admin", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const e = await crearEmpresaActiva(entorno);
      const x = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, x.id, "ADMINISTRADOR");
      const { email, token } = await invitacionMultiempresa([{ e, rol: "ADMINISTRADOR" }]);
      ronda(2, trasLeer("empresas", "obtener"));

      const [apagado, aceptacion] = await Promise.all([
        casos.apagarMembresia(comoEmpresa(e.empresa, personaId(x.id)), {
          personaId: personaId(x.id),
        }),
        aceptar(token, email),
      ]);

      expect(aceptacion.ok, `ronda ${n}`).toBe(true);
      const admins = await contar(
        "select count(*) as n from membresia where empresa_id = $1 and activo",
        [e.empresa],
      );
      expect(admins, `ronda ${n}: quedó sin admin`).toBeGreaterThanOrEqual(1);
      // Si apagó, es porque la aceptación ya estaba confirmada en su foto: el otro admin existe.
      if (apagado.ok) {
        expect(admins).toBe(1);
        expect(
          await contar(
            "select count(*) as n from membresia where empresa_id = $1 and activo and persona_id = $2",
            [e.empresa, x.id],
          ),
        ).toBe(0);
      } else {
        expect(apagado.error).toBe("ULTIMO_ADMIN");
        expect(admins).toBe(2);
      }
    }
  });

  it("K8b: apagar a una persona mientras acepta una invitación que la incluye: no queda aceptada ni a medias", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const e = await escenario();
      const otra = await escenario(e.tenant);
      const p = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, p.id, "OPERADOR");
      const { inv, token } = await invitacionMultiempresa(
        [
          { e, rol: "OPERADOR" },
          { e: otra, rol: "OPERADOR" },
        ],
        p.email,
      );
      ronda(2, trasLeer("empresas", "obtener"));

      const [apagado, aceptacion] = await Promise.all([
        casos.apagarMembresia(e.ctx, { personaId: personaId(p.id) }),
        aceptar(token, p.email),
      ]);

      expect(apagado.ok, `ronda ${n}`).toBe(true);
      expect(aceptacion.ok, `ronda ${n}: aceptó siendo miembro o con la invitación revocada`).toBe(
        false,
      );
      expect(["YA_ES_MIEMBRO", "INVITACION_REVOCADA"]).toContain(
        aceptacion.ok ? "?" : aceptacion.error,
      );
      expect(
        await contar(
          "select count(*) as n from membresia where empresa_id = $1 and persona_id = $2 and activo",
          [e.empresa, p.id],
        ),
      ).toBe(0);
      expect(
        await contar(
          "select count(*) as n from membresia where empresa_id = $1 and persona_id = $2",
          [otra.empresa, p.id],
        ),
      ).toBe(0);
      const estadoInv = (await filas("select estado from invitacion where id = $1", [inv.id]))[0]?.[
        "estado"
      ];
      expect(["PENDIENTE", "REVOCADA"]).toContain(estadoInv);
    }
  });

  it("K9: dos altas pendientes para la misma empresa: gana una y la otra es ALTA_YA_TIENE_INVITACION", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const empresa = await crearEmpresaEnAlta(entorno);
      ronda(2, (tx, esperar) => ({
        ...tx,
        invitaciones: {
          ...tx.invitaciones,
          crear: async (nueva) => {
            await esperar();
            await tx.invitaciones.crear(nueva);
          },
        },
      }));
      const emitirAlta = () => {
        const emitido = tokens.emitir();
        const email = emailDesdeTexto(emailAlAzar("gerente"));
        if (!email.ok) throw new Error("email inválido");
        const nueva = nuevaInvitacion(
          {
            id: emitido.invitacionId,
            tokenHash: emitido.tokenHash,
            tenantId: empresa.tenant,
            tipo: "ALTA_GERENTE",
            email: email.valor,
            empresas: [{ empresaId: empresa.empresa, rol: "GERENTE", sucursales: [] }],
            emitidaPor: null,
          },
          ahora,
        );
        if (!nueva.ok) throw new Error("alta inválida");
        return nueva.valor;
      };
      const emitirYGuardar = async () => {
        const nueva = emitirAlta();
        return entorno.ejecutar({ contexto: comoPlataforma() }, async (tx) => {
          await tx.invitaciones.crear(nueva);
          return ok(nueva.id);
        });
      };

      const [x, y] = await Promise.all([emitirYGuardar(), emitirYGuardar()]);

      expect([x.ok, y.ok].filter(Boolean), `ronda ${n}`).toHaveLength(1);
      const perdedora = x.ok ? y : x;
      expect(perdedora.ok).toBe(false);
      if (!perdedora.ok) {
        expect(perdedora.error).toEqual({
          tipo: "Unicidad",
          restriccion: "invitacion_empresa_gerente_uk",
        });
        if (typeof perdedora.error === "object" && "tipo" in perdedora.error) {
          expect(errorDeNegocioDeRestriccion(perdedora.error)).toBe("ALTA_YA_TIENE_INVITACION");
        }
      }
      // La perdedora no deja ni la cabecera: es todo o nada.
      expect(
        await contar("select count(*) as n from invitacion where tenant_id = $1", [empresa.tenant]),
      ).toBe(1);
    }
  });

  it("K10: apagan a un administrador mientras invita: o su invitación quedó antes, o ve su baja y da SIN_PERMISO", async () => {
    const resultados = { invito: 0, sinPermiso: 0 };
    for (let n = 0; n < RONDAS * 2; n++) {
      const e = await escenario();
      const admin = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, admin.id, "ADMINISTRADOR");
      const email = emailAlAzar("invitado");
      // Los dos leen quién es el actor (el guard) antes de que cualquiera escriba.
      ronda(2, trasLeer("autorizacion", "delActor"));

      const [invitar, apagar] = await Promise.all([
        casos.invitarUsuario(comoEmpresa(e.empresa, personaId(admin.id)), {
          email,
          rol: "OPERADOR",
          sucursales: [e.sucursal],
        }),
        casos.apagarMembresia(e.ctx, { personaId: personaId(admin.id) }),
      ]);

      expect(apagar.ok, `ronda ${n}`).toBe(true);
      expect(
        await contar(
          "select count(*) as n from membresia where empresa_id = $1 and persona_id = $2 and activo",
          [e.empresa, admin.id],
        ),
      ).toBe(0);
      const invitaciones = await contar(
        "select count(*) as n from invitacion_empresa where empresa_id = $1 and email = $2",
        [e.empresa, email],
      );
      const enviosEncolados = await contar(
        "select count(*) as n from trabajo where empresa_id = $1 and tipo = 'enviar_invitacion'",
        [e.empresa],
      );
      const emitidas = await contar(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'INVITACION_EMITIDA'",
        [e.empresa],
      );
      if (invitar.ok) {
        resultados.invito += 1;
        expect([invitaciones, enviosEncolados, emitidas], `ronda ${n}`).toEqual([1, 1, 1]);
      } else {
        resultados.sinPermiso += 1;
        expect(invitar.error, `ronda ${n}`).toBe("SIN_PERMISO");
        // Sin permiso no queda nada: ni invitación, ni envío, ni auditoría.
        expect([invitaciones, enviosEncolados, emitidas], `ronda ${n}`).toEqual([0, 0, 0]);
      }
    }
    expect(resultados.invito + resultados.sinPermiso).toBe(RONDAS * 2);
  });

  it("K11: suspenden a la persona (activo_global) mientras invita: o quedó antes, o da SIN_PERMISO", async () => {
    for (let n = 0; n < RONDAS; n++) {
      const e = await escenario();
      const email = emailAlAzar("invitado");
      ronda(2, trasLeer("autorizacion", "delActor"));

      const suspender = entorno.ejecutar({ contexto: comoPlataforma() }, async (tx) => {
        // Llega al punto de encuentro: la invitación ya leyó quién es el actor.
        await barrera();
        await sql`update persona set activo_global = false where id = ${e.gerente}`.execute(tx.db);
        return ok(null);
      });
      const [invitar, suspension] = await Promise.all([
        casos.invitarUsuario(e.ctx, { email, rol: "OPERADOR", sucursales: [e.sucursal] }),
        suspender,
      ]);

      expect(suspension.ok, `ronda ${n}`).toBe(true);
      const invitaciones = await contar(
        "select count(*) as n from invitacion_empresa where empresa_id = $1 and email = $2",
        [e.empresa, email],
      );
      // Una sola de dos: quedó antes de la suspensión o la vio y se rechazó. Nunca a medias.
      expect(invitaciones, `ronda ${n}`).toBe(invitar.ok ? 1 : 0);
      if (!invitar.ok) expect(invitar.error).toBe("SIN_PERMISO");
      // Pase lo que pase, la operación siguiente ya no puede.
      expect(
        await casos.invitarUsuario(e.ctx, {
          email: emailAlAzar("otro"),
          rol: "OPERADOR",
          sucursales: [],
        }),
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
    }
  });
});
