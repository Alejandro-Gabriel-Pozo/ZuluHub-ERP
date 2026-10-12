import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeEmpresas,
  type CasosDeUsoDeEmpresas,
} from "../../src/modulos/empresas/publico";
import {
  crearCasosDeUsoDeIdentidad,
  type CasosDeUsoDeIdentidad,
} from "../../src/modulos/identidad/publico";
import {
  invitacionId,
  personaId,
  sucursalId,
  type PersonaId,
  type SucursalId,
} from "../../src/primitivas/identificadores/marca";
import type { Tokens } from "../../src/puertos/tokens";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
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
} from "./fixtures-identidad";

/**
 * H6, tramo T3a: concurrencia REAL de revocar una invitación y de invitar a una sucursal que se
 * desactiva. Cada prueba lanza dos transacciones a la vez (`Promise.all`) y, con una barrera dentro
 * de la transacción, fuerza que AMBAS hayan leído el estado antes de que cualquiera escriba. Después
 * mira la base: nunca hay estados a medias ni duplicados, y el perdedor (tras el reintento
 * serializable del adaptador) ve el resultado del ganador.
 */

const base = inject("baseDePruebas");
const ahora = AHORA_DE_PRUEBA;
const RONDAS = 8;

type Fila = Record<string, unknown>;
type Gancho = (tx: TxDePrueba, esperar: () => Promise<void>) => TxDePrueba;
type Repositorio = "invitaciones" | "membresias" | "sucursales";

// Con la máquina cargada una ronda puede tardar varias veces lo normal: el límite de cada prueba y de
// cerrar la base es holgado a propósito (lo que se prueba es el orden de los efectos, no la velocidad).
const LIMITE_EN_MS = 60_000;

describe.skipIf(base === null)(
  "administración de usuarios: concurrencia (R1 a R9)",
  { timeout: LIMITE_EN_MS },
  () => {
    // Base propia de este archivo (ver `identidad-concurrencia.test.ts`).
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let entorno: ReturnType<typeof crearEntornoDePrueba>;
    let dueno: pg.Client;
    let tokens: Tokens;
    let casos: CasosDeUsoDeIdentidad;
    let casosDeEmpresas: CasosDeUsoDeEmpresas;
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
      casosDeEmpresas = crearCasosDeUsoDeEmpresas({
        transacciones: entorno,
        reglas: REGLAS_DE_EMPRESA,
      });
    }, LIMITE_EN_MS);
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    }, LIMITE_EN_MS);

    /** Prepara la ronda: `participantes` transacciones esperan en el punto que marque el gancho. */
    const ronda = (participantes: number, nuevoGancho: Gancho) => {
      barrera = crearBarrera(participantes);
      gancho = nuevoGancho;
    };

    /**
     * Cada transacción espera en la primera lectura que haga con CUALQUIERA de los métodos indicados
     * del repositorio (cada intento arma su propio `tx`, así que cada reintento no vuelve a esperar).
     */
    const trasLeer =
      (repositorio: Repositorio, ...metodos: string[]): Gancho =>
      (tx, esperar) => {
        let primera = true;
        const original = tx[repositorio] as unknown as Record<
          string,
          (...a: unknown[]) => Promise<unknown>
        >;
        const envuelto = Object.fromEntries(
          metodos.map((metodo) => [
            metodo,
            async (...args: unknown[]) => {
              const r = await (original[metodo] as (...a: unknown[]) => Promise<unknown>)(...args);
              if (primera) {
                primera = false;
                await esperar();
              }
              return r;
            },
          ]),
        );
        return { ...tx, [repositorio]: { ...original, ...envuelto } };
      };

    const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
      (await dueno.query<T>(texto, parametros)).rows;
    const contar = async (texto: string, parametros: unknown[] = []) =>
      Number((await filas<{ n: string }>(texto, parametros))[0]?.n);

    type Escenario = EmpresaDePrueba &
      Readonly<{ sucursal: SucursalId; gerente: PersonaId; ctx: ContextoOperativo }>;

    const escenario = async (): Promise<Escenario> => {
      const e = await crearEmpresaActiva(entorno);
      const sucursal = sucursalId(await sucursalDe(dueno, e.empresa));
      const g = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, g.id, "GERENTE");
      const gerente = personaId(g.id);
      return { ...e, sucursal, gerente, ctx: comoEmpresa(e.empresa, gerente) };
    };

    const invitar = async (e: Escenario, email = emailAlAzar("invitado")) => {
      const r = await casos.invitarUsuario(e.ctx, {
        email,
        rol: "OPERADOR",
        sucursales: [e.sucursal],
      });
      if (!r.ok) throw new Error(`no se pudo invitar: ${JSON.stringify(r.error)}`);
      return { id: r.valor.invitacionId, email, token: tokens.derivar(r.valor.invitacionId) };
    };

    const sucursalNueva = async (e: Escenario, nombre: string): Promise<SucursalId> => {
      const r = await casosDeEmpresas.crearSucursal(e.ctx, { nombre });
      if (!r.ok) throw new Error(`no se pudo crear la sucursal: ${JSON.stringify(r.error)}`);
      return r.valor.sucursalId;
    };

    const auditorias = (empresa: string, accion: string) =>
      contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
        empresa,
        accion,
      ]);
    const estadoDe = async (id: string) =>
      (await filas("select estado from invitacion where id = $1", [id]))[0]?.["estado"];

    // =============================================================================================
    it("R1: aceptar y revocar a la vez: gana uno, nunca quedan las dos, y la perdedora ve el resultado", async () => {
      const resultados = { acepto: 0, reboco: 0 };
      for (let n = 0; n < RONDAS; n++) {
        const e = await escenario();
        const { id, email, token } = await invitar(e);
        ronda(2, trasLeer("invitaciones", "obtenerPorHash", "obtenerPorId"));

        const [aceptacion, revocacion] = await Promise.all([
          casos.aceptarInvitacion({ token, emailAutenticado: email, ahora }),
          casos.revocarInvitacion(e.ctx, { invitacionId: id }),
        ]);

        const miembros = await contar(
          "select count(*) as n from membresia m join persona p on p.id = m.persona_id where m.empresa_id = $1 and p.email = $2",
          [e.empresa, email],
        );
        if (aceptacion.ok) {
          resultados.acepto++;
          expect(revocacion, `ronda ${n}`).toEqual({ ok: false, error: "INVITACION_ACEPTADA" });
          expect(await estadoDe(id), `ronda ${n}`).toBe("ACEPTADA");
          expect(miembros, `ronda ${n}`).toBe(1);
          expect(await auditorias(e.empresa, "INVITACION_ACEPTADA"), `ronda ${n}`).toBe(1);
          expect(await auditorias(e.empresa, "INVITACION_REVOCADA"), `ronda ${n}`).toBe(0);
        } else {
          resultados.reboco++;
          expect(aceptacion.error, `ronda ${n}`).toBe("INVITACION_REVOCADA");
          expect(revocacion, `ronda ${n}`).toEqual({
            ok: true,
            valor: { yaEstabaRevocada: false },
          });
          expect(await estadoDe(id), `ronda ${n}`).toBe("REVOCADA");
          expect(miembros, `ronda ${n}: nadie entró`).toBe(0);
          expect(
            await contar("select count(*) as n from persona where email = $1", [email]),
            `ronda ${n}: ni la persona se creó`,
          ).toBe(0);
          expect(await auditorias(e.empresa, "INVITACION_ACEPTADA"), `ronda ${n}`).toBe(0);
          expect(await auditorias(e.empresa, "INVITACION_REVOCADA"), `ronda ${n}`).toBe(1);
        }
      }
      expect(resultados.acepto + resultados.reboco).toBe(RONDAS);
    });

    it("R2: dos revocaciones simultáneas de la misma invitación escriben una vez (la otra ve que ya estaba)", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await escenario();
        const { id } = await invitar(e);
        ronda(2, trasLeer("invitaciones", "obtenerPorId"));

        const [x, y] = await Promise.all([
          casos.revocarInvitacion(e.ctx, { invitacionId: id }),
          casos.revocarInvitacion(e.ctx, { invitacionId: id }),
        ]);

        expect([x.ok, y.ok], `ronda ${n}`).toEqual([true, true]);
        expect(
          [x, y].filter((r) => r.ok && r.valor.yaEstabaRevocada),
          `ronda ${n}: una escribe, la otra ve`,
        ).toHaveLength(1);
        expect(await estadoDe(id)).toBe("REVOCADA");
        expect(await auditorias(e.empresa, "INVITACION_REVOCADA"), `ronda ${n}`).toBe(1);
      }
    });

    it("R3: revocar y reenviar a la vez la misma invitación: queda una sola vigente o ninguna, nunca dos", async () => {
      const resultados = { reenvioPrimero: 0, revocoPrimero: 0 };
      for (let n = 0; n < RONDAS; n++) {
        const e = await escenario();
        const { id } = await invitar(e);
        ronda(2, trasLeer("invitaciones", "obtenerPorId"));

        const [revocacion, reenvio] = await Promise.all([
          casos.revocarInvitacion(e.ctx, { invitacionId: id }),
          casos.reenviarInvitacion(e.ctx, { invitacionId: id }),
        ]);

        expect(revocacion.ok, `ronda ${n}`).toBe(true);
        const vigentes = await filas(
          "select invitacion_id from invitacion_empresa where empresa_id = $1 and estado = 'PENDIENTE'",
          [e.empresa],
        );
        expect(await estadoDe(id), `ronda ${n}`).toBe("REVOCADA");
        if (reenvio.ok) {
          // Reenviar ganó: la original quedó reemplazada, y revocar la encontró ya revocada.
          resultados.reenvioPrimero++;
          expect(revocacion.ok && revocacion.valor.yaEstabaRevocada, `ronda ${n}`).toBe(true);
          expect(vigentes, `ronda ${n}`).toEqual([{ invitacion_id: reenvio.valor.invitacionId }]);
        } else {
          // Revocar ganó: reenviar ve una revocada sin reemplazo.
          resultados.revocoPrimero++;
          expect(reenvio.error, `ronda ${n}`).toBe("INVITACION_REVOCADA");
          expect(vigentes, `ronda ${n}`).toEqual([]);
        }
      }
      expect(resultados.reenvioPrimero + resultados.revocoPrimero).toBe(RONDAS);
    });

    it("R4: revocar y apagar a la persona a la vez (que también revoca sus pendientes): ambas terminan bien y se revoca una vez", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await escenario();
        const persona = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, e.empresa, persona.id, "OPERADOR");
        // Una pendiente dirigida al email de alguien que ya es miembro (la arma el dueño de la base).
        const inv = await crearInvitacionDeBase(dueno, { tenant: e.tenant, email: persona.email });
        await incluirEmpresa(dueno, inv, e.empresa, "OPERADOR");
        // Las dos esperan tras su lectura de la invitación pendiente.
        ronda(2, trasLeer("invitaciones", "obtenerPorId", "pendientesDeEmail"));

        const [revocacion, apagado] = await Promise.all([
          casos.revocarInvitacion(e.ctx, { invitacionId: invitacionId(inv.id) }),
          casos.apagarMembresia(e.ctx, { personaId: personaId(persona.id) }),
        ]);

        expect(revocacion.ok, `ronda ${n}`).toBe(true);
        expect(apagado.ok, `ronda ${n}`).toBe(true);
        expect(await estadoDe(inv.id), `ronda ${n}`).toBe("REVOCADA");
        expect(await auditorias(e.empresa, "INVITACION_REVOCADA"), `ronda ${n}: una sola vez`).toBe(
          1,
        );
        expect(
          await filas("select activo from membresia where empresa_id = $1 and persona_id = $2", [
            e.empresa,
            persona.id,
          ]),
        ).toEqual([{ activo: false }]);
      }
    });

    it("R5: revocar la pendiente mientras se invita al mismo email: nunca quedan dos pendientes", async () => {
      const resultados = { devolvioLaVieja: 0, creoOtra: 0 };
      for (let n = 0; n < RONDAS; n++) {
        const e = await escenario();
        const { id, email } = await invitar(e);
        ronda(2, trasLeer("invitaciones", "obtenerPorId", "pendientesDeEmail"));

        const [revocacion, invitacion] = await Promise.all([
          casos.revocarInvitacion(e.ctx, { invitacionId: id }),
          casos.invitarUsuario(e.ctx, { email, rol: "OPERADOR", sucursales: [e.sucursal] }),
        ]);

        expect(revocacion.ok, `ronda ${n}`).toBe(true);
        expect(invitacion.ok, `ronda ${n}`).toBe(true);
        if (!invitacion.ok) return;
        expect(await estadoDe(id), `ronda ${n}`).toBe("REVOCADA");
        const vigentes = await filas(
          "select invitacion_id from invitacion_empresa where empresa_id = $1 and estado = 'PENDIENTE'",
          [e.empresa],
        );
        if (invitacion.valor.yaExistia) {
          // Invitar leyó la pendiente antes de la baja: devolvió esa (orden válido: invitar, después revocar).
          resultados.devolvioLaVieja++;
          expect(invitacion.valor.invitacionId, `ronda ${n}`).toBe(id);
          expect(vigentes, `ronda ${n}`).toEqual([]);
        } else {
          // Revocar ganó: invitar creó otra.
          resultados.creoOtra++;
          expect(invitacion.valor.invitacionId, `ronda ${n}`).not.toBe(id);
          expect(vigentes, `ronda ${n}`).toEqual([
            { invitacion_id: invitacion.valor.invitacionId },
          ]);
        }
      }
      expect(resultados.devolvioLaVieja + resultados.creoOtra).toBe(RONDAS);
    });

    // =============================================================================================
    it("R6: invitar a una sucursal mientras se la desactiva: las dos terminan bien o invitar da SUCURSAL_INACTIVA; sin deadlocks ni reintentos agotados", async () => {
      const resultados = new Map<string, number>();
      for (let n = 0; n < RONDAS * 2; n++) {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        const email = emailAlAzar("carrera");
        // Las dos esperan tras haber leído la sucursal (activa para ambas).
        ronda(2, trasLeer("sucursales", "obtener"));

        const [invitacion, baja] = await Promise.all([
          casos.invitarUsuario(e.ctx, { email, rol: "OPERADOR", sucursales: [norte] }),
          casosDeEmpresas.desactivarSucursal(e.ctx, { sucursalId: norte }),
        ]);

        // La baja siempre sale bien (queda la Casa central).
        expect(baja, `ronda ${n}`).toEqual({ ok: true, valor: { yaEstabaInactiva: false } });
        expect(
          (await filas("select activa from sucursal where id = $1", [norte]))[0]?.["activa"],
          `ronda ${n}`,
        ).toBe(false);
        const invitaciones = await contar(
          "select count(*) as n from invitacion_empresa where empresa_id = $1 and email = $2",
          [e.empresa, email],
        );
        const clave = invitacion.ok ? "invitó" : JSON.stringify(invitacion.error);
        resultados.set(clave, (resultados.get(clave) ?? 0) + 1);
        if (invitacion.ok) {
          // Invitar es anterior a la baja en el orden serial: la invitación existe, completa.
          expect(invitaciones, `ronda ${n}`).toBe(1);
          expect(
            await contar(
              "select count(*) as n from invitacion_sucursal where empresa_id = $1 and sucursal_id = $2",
              [e.empresa, norte],
            ),
            `ronda ${n}`,
          ).toBe(1);
          expect(await auditorias(e.empresa, "INVITACION_EMITIDA"), `ronda ${n}`).toBe(1);
        } else {
          // La baja fue anterior: no se escribió nada de la invitación.
          expect(invitacion.error, `ronda ${n}`).toBe("SUCURSAL_INACTIVA");
          expect(invitaciones, `ronda ${n}`).toBe(0);
          expect(await auditorias(e.empresa, "INVITACION_EMITIDA"), `ronda ${n}`).toBe(0);
          expect(
            await contar("select count(*) as n from trabajo where empresa_id = $1", [e.empresa]),
            `ronda ${n}`,
          ).toBe(0);
        }
        expect(await auditorias(e.empresa, "SUCURSAL_DESACTIVADA"), `ronda ${n}`).toBe(1);
      }
      for (const clave of resultados.keys()) {
        expect(["invitó", '"SUCURSAL_INACTIVA"'], "solo resultados de negocio").toContain(clave);
      }
    });

    it("R7: la baja se confirma mientras invitar ya había leído la sucursal activa: o la invitación nace completa (en el orden: invitar, baja) o el reintento da SUCURSAL_INACTIVA; nada a medias, y la siguiente ya se rechaza", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        const email = emailAlAzar("orden");
        let bajaConfirmada: () => void = () => undefined;
        const esperaLaBaja = new Promise<void>((resolver) => {
          bajaConfirmada = resolver;
        });
        let invitacionDetenida: () => void = () => undefined;
        const estaDetenida = new Promise<void>((resolver) => {
          invitacionDetenida = resolver;
        });
        // Solo la invitación espera (la baja no lee pendientes), y lo hace tras haber leído la sucursal
        // activa y la pendiente del email: la baja se confirma entera mientras tanto.
        gancho = (tx) => ({
          ...tx,
          invitaciones: {
            ...tx.invitaciones,
            pendientesDeEmail: async (
              ...args: Parameters<typeof tx.invitaciones.pendientesDeEmail>
            ) => {
              const r = await tx.invitaciones.pendientesDeEmail(...args);
              invitacionDetenida();
              await esperaLaBaja;
              return r;
            },
          },
        });
        const invitando = casos.invitarUsuario(e.ctx, {
          email,
          rol: "OPERADOR",
          sucursales: [norte],
        });
        // La baja arranca recién cuando la invitación ya leyó (si no, la leería inactiva y daría bien SUCURSAL_INACTIVA).
        await estaDetenida;
        const baja = await casosDeEmpresas.desactivarSucursal(e.ctx, { sucursalId: norte });
        expect(baja, `ronda ${n}`).toEqual({ ok: true, valor: { yaEstabaInactiva: false } });
        bajaConfirmada();
        const invitacion = await invitando;

        const completa = await contar(
          "select count(*) as n from invitacion_sucursal where empresa_id = $1 and sucursal_id = $2",
          [e.empresa, norte],
        );
        if (invitacion.ok) {
          // La lectura de invitar es anterior a la baja (aunque escriba después): orden serial válido.
          expect(completa, `ronda ${n}`).toBe(1);
          expect(await auditorias(e.empresa, "INVITACION_EMITIDA"), `ronda ${n}`).toBe(1);
        } else {
          // Hubo un conflicto de serialización, y el reintento ya vio la sucursal desactivada.
          expect(invitacion.error, `ronda ${n}`).toBe("SUCURSAL_INACTIVA");
          expect(completa, `ronda ${n}`).toBe(0);
          expect(await auditorias(e.empresa, "INVITACION_EMITIDA"), `ronda ${n}`).toBe(0);
        }
        // Con la baja ya confirmada, un pedido nuevo se rechaza.
        expect(
          await casos.invitarUsuario(e.ctx, {
            email: emailAlAzar("despues"),
            rol: "OPERADOR",
            sucursales: [norte],
          }),
          `ronda ${n}`,
        ).toEqual({ ok: false, error: "SUCURSAL_INACTIVA" });
      }
    });

    it("R8: invitar a la sucursal que se reactiva a la vez: o la invitación nace o da SUCURSAL_INACTIVA, nunca un error de otro tipo", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await escenario();
        const norte = await sucursalNueva(e, "Sucursal norte");
        await casosDeEmpresas.desactivarSucursal(e.ctx, { sucursalId: norte });
        ronda(2, trasLeer("sucursales", "obtener"));

        const [invitacion, reactivacion] = await Promise.all([
          casos.invitarUsuario(e.ctx, {
            email: emailAlAzar("reactiva"),
            rol: "OPERADOR",
            sucursales: [norte],
          }),
          casosDeEmpresas.reactivarSucursal(e.ctx, { sucursalId: norte }),
        ]);

        expect(reactivacion, `ronda ${n}`).toEqual({ ok: true, valor: { yaEstabaActiva: false } });
        // Invitar leyó la sucursal desactivada (o reactivada, si la reactivación fue primera).
        expect(invitacion.ok || invitacion.error === "SUCURSAL_INACTIVA", `ronda ${n}`).toBe(true);
        expect(
          (await filas("select activa from sucursal where id = $1", [norte]))[0]?.["activa"],
        ).toBe(true);
      }
    });

    it("R9: dos empresas revocan e invitan a la vez sin pisarse", async () => {
      const a = await escenario();
      const b = await escenario();
      const deA = await invitar(a);
      const deB = await invitar(b);
      ronda(2, trasLeer("invitaciones", "obtenerPorId"));
      const [x, y, cruzada] = await Promise.all([
        casos.revocarInvitacion(a.ctx, { invitacionId: deA.id }),
        casos.revocarInvitacion(b.ctx, { invitacionId: deB.id }),
        // Y una cruzada: A intenta revocar la de B (no la ve).
        casos.revocarInvitacion(a.ctx, { invitacionId: deB.id }),
      ]);
      expect([x.ok, y.ok]).toEqual([true, true]);
      expect(cruzada).toEqual({ ok: false, error: "INVITACION_NO_ENCONTRADA" });
      expect([await estadoDe(deA.id), await estadoDe(deB.id)]).toEqual(["REVOCADA", "REVOCADA"]);
      expect(await auditorias(a.empresa, "INVITACION_REVOCADA")).toBe(1);
      expect(await auditorias(b.empresa, "INVITACION_REVOCADA")).toBe(1);
    });
  },
);
