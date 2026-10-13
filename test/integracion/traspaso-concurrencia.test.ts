import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  crearCasosDeUsoDeIdentidad,
  type CasosDeUsoDeIdentidad,
} from "../../src/modulos/identidad/publico";
import type { SucursalId } from "../../src/primitivas/identificadores/marca";
import { crearBarrera, crearBaseAparte, crearEntornoDePrueba, type TxDePrueba } from "./entorno";
import { crearApoyoDeTraspaso, type Escenario } from "./traspaso-apoyo";

/**
 * H6, tramos T3b y T4: concurrencia REAL del traspaso de gerencia y de la asignación de sucursales.
 * Cada prueba lanza dos transacciones a la vez (`Promise.all`) y, con una barrera dentro de la
 * transacción, fuerza que AMBAS hayan leído el estado antes de que cualquiera escriba (el cruce que
 * importa). Después mira la base: nunca dos gerentes ni ninguno, nunca un traspaso a medias ni
 * duplicado, y la perdedora (tras el reintento serializable del adaptador) ve el resultado de la
 * ganadora.
 */

const base = inject("baseDePruebas");
const RONDAS = 12;
/** El invariante «nunca dos gerentes ni ninguno» es el más serio: se repite más. */
const RONDAS_CRITICAS = 40;

type Gancho = (tx: TxDePrueba, esperar: () => Promise<void>) => TxDePrueba;
type Repositorio = "traspasos" | "membresias" | "asignaciones";

// Con la máquina cargada una ronda puede tardar varias veces lo normal: el límite de cada prueba y de
// cerrar la base es holgado a propósito (lo que se prueba es el orden de los efectos, no la velocidad).
const LIMITE_EN_MS = 120_000;

describe.skipIf(base === null)(
  "traspaso de gerencia y asignación de sucursales: concurrencia",
  { timeout: LIMITE_EN_MS },
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let entorno: ReturnType<typeof crearEntornoDePrueba>;
    let dueno: pg.Client;
    let casos: CasosDeUsoDeIdentidad;
    let apoyo: ReturnType<typeof crearApoyoDeTraspaso>;
    // La barrera de la ronda en curso: cada ronda arma una nueva (una barrera se usa una vez).
    let barrera: () => Promise<void> = () => Promise.resolve();
    let gancho: Gancho = (tx) => tx;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDePrueba(propia.base, 12, (tx) => gancho(tx, () => barrera()));
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      apoyo = crearApoyoDeTraspaso(entorno, dueno);
      casos = crearCasosDeUsoDeIdentidad({
        transacciones: entorno,
        tokens: crearTokensHmac(randomBytes(32)),
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

    /** Varios ganchos a la vez: cada transacción solo pasa por UNO de ellos (si no, contaría doble). */
    const algunoDe =
      (...ganchos: Gancho[]): Gancho =>
      (tx, esperar) =>
        ganchos.reduce((acumulado, g) => g(acumulado, esperar), tx);

    const estadoDe = async (id: string) => (await apoyo.traspaso(id))?.["estado"];

    /** El traspaso del gerente a un operador nuevo, ya en curso. */
    const conTraspaso = async (e: Escenario) => {
      const entrante = await apoyo.miembro(e, "OPERADOR");
      const id = await apoyo.proponerDeBase(e, entrante.id);
      return { entrante, id };
    };

    /** El invariante que no se negocia: exactamente un gerente activo. */
    const unSoloGerente = async (e: Escenario, contexto: string) => {
      const gerentes = await apoyo.gerentesActivos(e.empresa);
      expect(gerentes, `${contexto}: gerentes ${JSON.stringify(gerentes)}`).toHaveLength(1);
      return gerentes[0] as string;
    };

    // =============================================================================================
    it("T1: dos aceptaciones simultáneas del mismo traspaso: una escribe y la otra ve que ya estaba aceptado", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await apoyo.escenario();
        const { entrante, id } = await conTraspaso(e);
        ronda(2, trasLeer("traspasos", "obtener"));

        const [x, y] = await Promise.all([
          casos.aceptarTraspaso(entrante.ctx, { traspasoId: id }),
          casos.aceptarTraspaso(entrante.ctx, { traspasoId: id }),
        ]);

        expect([x.ok, y.ok], `ronda ${n}`).toEqual([true, true]);
        expect(
          [x, y].filter((r) => r.ok && r.valor.yaEstabaAceptado),
          `ronda ${n}: una escribe, la otra ve`,
        ).toHaveLength(1);
        expect(await unSoloGerente(e, `ronda ${n}`)).toBe(entrante.id);
        expect(await apoyo.membresia(e.empresa, e.gerente)).toMatchObject({
          rol: "ADMINISTRADOR",
          activo: true,
        });
        expect(await estadoDe(id)).toBe("ACEPTADO");
        expect(await apoyo.auditoria(e.empresa, "TRASPASO_ACEPTADO"), `ronda ${n}`).toHaveLength(1);
        expect(
          await apoyo.auditoria(e.empresa, "MEMBRESIA_ROL_CAMBIADO"),
          `ronda ${n}`,
        ).toHaveLength(2);
        expect(await apoyo.trabajos(e.empresa), `ronda ${n}`).toHaveLength(1);
      }
    });

    it("T2: aceptar y cancelar a la vez: gana una; el estado es coherente y nunca queda aceptado y cancelado", async () => {
      const resultados = { acepto: 0, cancelo: 0 };
      for (let n = 0; n < RONDAS; n++) {
        const e = await apoyo.escenario();
        const { entrante, id } = await conTraspaso(e);
        ronda(2, trasLeer("traspasos", "obtener", "enCurso"));

        const [aceptacion, cancelacion] = await Promise.all([
          casos.aceptarTraspaso(entrante.ctx, { traspasoId: id }),
          casos.cancelarTraspaso(e.ctx, {}),
        ]);

        const gerente = await unSoloGerente(e, `ronda ${n}`);
        if (aceptacion.ok) {
          // Aceptar ganó: el gerente de antes ya es administrador y no puede cancelar.
          resultados.acepto++;
          expect(aceptacion.valor, `ronda ${n}`).toEqual({ yaEstabaAceptado: false });
          expect(cancelacion, `ronda ${n}`).toEqual({ ok: false, error: "SIN_PERMISO" });
          expect(await estadoDe(id)).toBe("ACEPTADO");
          expect(gerente).toBe(entrante.id);
          expect(await apoyo.auditoria(e.empresa, "TRASPASO_CANCELADO"), `ronda ${n}`).toEqual([]);
        } else {
          // Cancelar ganó: aceptar encuentra un traspaso resuelto y nada cambió de manos.
          resultados.cancelo++;
          expect(aceptacion.error, `ronda ${n}`).toBe("TRASPASO_RESUELTO");
          expect(cancelacion, `ronda ${n}`).toEqual({ ok: true, valor: { yaNoHabia: false } });
          expect(await estadoDe(id)).toBe("CANCELADO");
          expect(gerente).toBe(e.gerente);
          expect(await apoyo.auditoria(e.empresa, "TRASPASO_ACEPTADO"), `ronda ${n}`).toEqual([]);
          expect(await apoyo.auditoria(e.empresa, "MEMBRESIA_ROL_CAMBIADO")).toEqual([]);
        }
        expect(await apoyo.auditoria(e.empresa, "TRASPASO_CANCELADO")).toHaveLength(
          aceptacion.ok ? 0 : 1,
        );
      }
      expect(resultados.acepto + resultados.cancelo).toBe(RONDAS);
    });

    it("T3: aceptar y rechazar a la vez: gana una, la otra ve el resultado; nunca cambia un rol si ganó el rechazo", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await apoyo.escenario();
        const { entrante, id } = await conTraspaso(e);
        ronda(2, trasLeer("traspasos", "obtener"));

        const [aceptacion, rechazo] = await Promise.all([
          casos.aceptarTraspaso(entrante.ctx, { traspasoId: id }),
          casos.rechazarTraspaso(entrante.ctx, { traspasoId: id }),
        ]);

        const gerente = await unSoloGerente(e, `ronda ${n}`);
        if (aceptacion.ok) {
          expect(rechazo, `ronda ${n}`).toEqual({ ok: false, error: "TRASPASO_RESUELTO" });
          expect(await estadoDe(id)).toBe("ACEPTADO");
          expect(gerente).toBe(entrante.id);
        } else {
          expect(aceptacion.error, `ronda ${n}`).toBe("TRASPASO_RESUELTO");
          expect(rechazo, `ronda ${n}`).toEqual({ ok: true, valor: { yaEstabaRechazado: false } });
          expect(await estadoDe(id)).toBe("RECHAZADO");
          expect(gerente).toBe(e.gerente);
          expect(await apoyo.auditoria(e.empresa, "MEMBRESIA_ROL_CAMBIADO")).toEqual([]);
        }
      }
    });

    it("T4: dos propuestas a la vez a personas distintas: queda UNA en curso y la otra recibe TRASPASO_EN_CURSO", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await apoyo.escenario();
        const uno = await apoyo.miembro(e, "OPERADOR");
        const otro = await apoyo.miembro(e, "ADMINISTRADOR");
        ronda(2, trasLeer("traspasos", "enCurso"));

        const [x, y] = await Promise.all([
          casos.proponerTraspaso(e.ctx, { entrantePersonaId: uno.id }),
          casos.proponerTraspaso(e.ctx, { entrantePersonaId: otro.id }),
        ]);

        const ganadoras = [x, y].filter((r) => r.ok);
        const perdedoras = [x, y].filter((r) => !r.ok);
        expect(ganadoras, `ronda ${n}: ${JSON.stringify([x, y])}`).toHaveLength(1);
        expect(
          perdedoras.map((r) => !r.ok && r.error),
          `ronda ${n}`,
        ).toEqual(["TRASPASO_EN_CURSO"]);
        const enCurso = (await apoyo.traspasosDe(e.empresa)).filter(
          (t) => t["estado"] === "PROPUESTO",
        );
        expect(enCurso, `ronda ${n}`).toHaveLength(1);
        expect(await apoyo.traspasosDe(e.empresa)).toHaveLength(1);
        expect(await apoyo.auditoria(e.empresa, "TRASPASO_PROPUESTO"), `ronda ${n}`).toHaveLength(
          1,
        );
        expect(await apoyo.trabajos(e.empresa), `ronda ${n}`).toHaveLength(1);
      }
    });

    it("T5: dos propuestas a la vez a la MISMA persona: las dos terminan bien con el mismo id y se escribe una vez", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await apoyo.escenario();
        const op = await apoyo.miembro(e, "OPERADOR");
        ronda(2, trasLeer("traspasos", "enCurso"));

        const [x, y] = await Promise.all([
          casos.proponerTraspaso(e.ctx, { entrantePersonaId: op.id }),
          casos.proponerTraspaso(e.ctx, { entrantePersonaId: op.id }),
        ]);

        expect([x.ok, y.ok], `ronda ${n}: ${JSON.stringify([x, y])}`).toEqual([true, true]);
        if (!x.ok || !y.ok) return;
        expect(x.valor.traspasoId, `ronda ${n}`).toBe(y.valor.traspasoId);
        expect(
          [x, y].filter((r) => r.ok && r.valor.yaExistia),
          `ronda ${n}`,
        ).toHaveLength(1);
        expect(await apoyo.traspasosDe(e.empresa), `ronda ${n}`).toHaveLength(1);
        expect(await apoyo.auditoria(e.empresa, "TRASPASO_PROPUESTO"), `ronda ${n}`).toHaveLength(
          1,
        );
        expect(await apoyo.trabajos(e.empresa), `ronda ${n}`).toHaveLength(1);
      }
    });

    it(`T6: apagar al entrante contra aceptar (${RONDAS_CRITICAS} corridas): o queda gerente (y apagarlo da ES_EL_GERENTE) o la aceptación pierde; nunca dos gerentes ni ninguno`, async () => {
      const resultados = { aceptaron: 0, apagaron: 0 };
      for (let n = 0; n < RONDAS_CRITICAS; n++) {
        const e = await apoyo.escenario();
        const { entrante, id } = await conTraspaso(e);
        ronda(2, trasLeer("traspasos", "obtener", "enCurso"));

        const [aceptacion, apagado] = await Promise.all([
          casos.aceptarTraspaso(entrante.ctx, { traspasoId: id }),
          casos.apagarMembresia(e.ctx, { personaId: entrante.id }),
        ]);

        const gerente = await unSoloGerente(e, `ronda ${n}`);
        if (aceptacion.ok) {
          // Aceptar ganó: el entrante es gerente, y apagarlo es apagar al gerente.
          resultados.aceptaron++;
          expect(apagado, `ronda ${n}`).toEqual({ ok: false, error: "ES_EL_GERENTE" });
          expect(gerente).toBe(entrante.id);
          expect(await estadoDe(id)).toBe("ACEPTADO");
          expect(await apoyo.membresia(e.empresa, entrante.id)).toMatchObject({
            rol: "GERENTE",
            activo: true,
          });
          expect(await apoyo.membresia(e.empresa, e.gerente)).toMatchObject({
            rol: "ADMINISTRADOR",
            activo: true,
          });
        } else {
          // Apagar ganó: el traspaso se canceló en la misma transacción y aceptar ya no tiene permiso.
          resultados.apagaron++;
          expect(aceptacion.error, `ronda ${n}`).toBe("SIN_PERMISO");
          expect(apagado.ok, `ronda ${n}`).toBe(true);
          expect(gerente).toBe(e.gerente);
          expect(await estadoDe(id)).toBe("CANCELADO");
          expect(await apoyo.traspaso(id)).toMatchObject({ motivo: "ENTRANTE_DADO_DE_BAJA" });
          expect(await apoyo.membresia(e.empresa, entrante.id)).toMatchObject({
            rol: "OPERADOR",
            activo: false,
          });
        }
      }
      expect(resultados.aceptaron + resultados.apagaron).toBe(RONDAS_CRITICAS);
    });

    it("T7: apagar al gerente saliente (con otro administrador) contra aceptar: nunca dos gerentes ni ninguno, y el saliente queda administrador, apagado o no", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await apoyo.escenario();
        const admin = await apoyo.miembro(e, "ADMINISTRADOR");
        const { entrante, id } = await conTraspaso(e);
        // Aceptar espera tras leer el traspaso; apagar al gerente corta apenas lee su membresía (ES_EL_GERENTE),
        // antes de mirar los traspasos: espera ahí.
        ronda(2, algunoDe(trasLeer("traspasos", "obtener"), trasLeer("membresias", "obtener")));

        const [aceptacion, apagado] = await Promise.all([
          casos.aceptarTraspaso(entrante.ctx, { traspasoId: id }),
          casos.apagarMembresia(admin.ctx, { personaId: e.gerente }),
        ]);

        expect(aceptacion, `ronda ${n}`).toEqual({ ok: true, valor: { yaEstabaAceptado: false } });
        expect(await unSoloGerente(e, `ronda ${n}`)).toBe(entrante.id);
        const saliente = await apoyo.membresia(e.empresa, e.gerente);
        if (apagado.ok) {
          // Apagar vino después de la aceptación: el saliente ya era administrador.
          expect(saliente, `ronda ${n}`).toMatchObject({ rol: "ADMINISTRADOR", activo: false });
        } else {
          // Apagar vino antes: el saliente era el gerente.
          expect(apagado.error, `ronda ${n}`).toBe("ES_EL_GERENTE");
          expect(saliente, `ronda ${n}`).toMatchObject({ rol: "ADMINISTRADOR", activo: true });
        }
      }
    });

    it("T8: proponer a alguien mientras se lo apaga: nunca queda una propuesta en curso a una persona apagada", async () => {
      const resultados = { propuso: 0, apagoPrimero: 0 };
      for (let n = 0; n < RONDAS; n++) {
        const e = await apoyo.escenario();
        const op = await apoyo.miembro(e, "OPERADOR");
        // Proponer lee al entrante y las propuestas en curso; apagar, las propuestas en curso.
        ronda(2, trasLeer("traspasos", "enCurso"));

        const [propuesta, apagado] = await Promise.all([
          casos.proponerTraspaso(e.ctx, { entrantePersonaId: op.id }),
          casos.apagarMembresia(e.ctx, { personaId: op.id }),
        ]);

        expect(apagado.ok, `ronda ${n}`).toBe(true);
        expect(await apoyo.membresia(e.empresa, op.id), `ronda ${n}`).toMatchObject({
          activo: false,
        });
        const enCurso = (await apoyo.traspasosDe(e.empresa)).filter(
          (t) => t["estado"] === "PROPUESTO",
        );
        expect(enCurso, `ronda ${n}: ninguna propuesta viva a un apagado`).toEqual([]);
        if (propuesta.ok) {
          resultados.propuso++;
          expect(await apoyo.traspasosDe(e.empresa)).toHaveLength(1);
          expect(await apoyo.traspasosDe(e.empresa)).toMatchObject([
            { estado: "CANCELADO", motivo: "ENTRANTE_DADO_DE_BAJA" },
          ]);
        } else {
          resultados.apagoPrimero++;
          expect(propuesta.error, `ronda ${n}`).toBe("ENTRANTE_INACTIVO");
          expect(await apoyo.traspasosDe(e.empresa)).toEqual([]);
        }
      }
      expect(resultados.propuso + resultados.apagoPrimero).toBe(RONDAS);
    });

    // =============================================================================================
    // Asignación de sucursales
    // =============================================================================================
    const conSucursales = async () => {
      const e = await apoyo.escenario();
      const a = await apoyo.sucursalExtra(e, "Norte");
      const b = await apoyo.sucursalExtra(e, "Sur");
      const op = await apoyo.miembro(e, "OPERADOR");
      return { e, a, b, op };
    };

    it("A1: dos asignaciones a la vez para la misma persona con conjuntos distintos: queda exactamente uno de los dos, y la auditoría de la segunda parte de la primera", async () => {
      const finales = new Set<string>();
      for (let n = 0; n < RONDAS; n++) {
        const { e, a, b, op } = await conSucursales();
        const conjuntoA: SucursalId[] = [a];
        const conjuntoB: SucursalId[] = [b, e.sucursal];
        ronda(2, trasLeer("asignaciones", "deLaPersona"));

        const [x, y] = await Promise.all([
          casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: conjuntoA }),
          casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: conjuntoB }),
        ]);

        expect([x.ok, y.ok], `ronda ${n}: ${JSON.stringify([x, y])}`).toEqual([true, true]);
        const final = await apoyo.asignadas(e.empresa, op.id);
        const esA = JSON.stringify(final) === JSON.stringify([...conjuntoA].sort());
        const esB = JSON.stringify(final) === JSON.stringify([...conjuntoB].sort());
        expect(esA || esB, `ronda ${n}: ${JSON.stringify(final)}`).toBe(true);
        finales.add(esA ? "A" : "B");
        // Dos cambios, dos auditorías encadenadas: el «antes» de la segunda es el «después» de la primera.
        const auditorias = await apoyo.auditoria(e.empresa, "ASIGNACIONES_CAMBIADAS");
        expect(auditorias, `ronda ${n}`).toHaveLength(2);
        const [primera, segunda] = auditorias;
        expect(primera?.["antes"], `ronda ${n}`).toEqual({ sucursales: [] });
        expect(segunda?.["antes"], `ronda ${n}`).toEqual({
          sucursales: (primera?.["despues"] as { sucursales: string[] }).sucursales,
        });
        expect((segunda?.["despues"] as { sucursales: string[] }).sucursales).toEqual(final);
      }
      expect(finales.size).toBeGreaterThan(0);
    });

    it("A2: dos asignaciones IGUALES a la vez: las dos terminan bien, una escribe y la otra ve que ya estaba", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const { e, a, op } = await conSucursales();
        ronda(2, trasLeer("asignaciones", "deLaPersona"));

        const [x, y] = await Promise.all([
          casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [a] }),
          casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [a] }),
        ]);

        expect([x.ok, y.ok], `ronda ${n}: ${JSON.stringify([x, y])}`).toEqual([true, true]);
        expect(await apoyo.asignadas(e.empresa, op.id)).toEqual([a]);
        expect(
          await apoyo.auditoria(e.empresa, "ASIGNACIONES_CAMBIADAS"),
          `ronda ${n}: una sola vez`,
        ).toHaveLength(1);
        expect(
          [x, y].filter((r) => r.ok && r.valor.agregadas.length === 1),
          `ronda ${n}`,
        ).toHaveLength(1);
      }
    });

    it("A3: asignar mientras se apaga al miembro: nunca queda una asignación activa de una membresía apagada", async () => {
      const resultados = { asigno: 0, apagoPrimero: 0 };
      for (let n = 0; n < RONDAS_CRITICAS; n++) {
        const { e, a, op } = await conSucursales();
        // Asignar lee las asignaciones de la persona; apagar, las propuestas en curso.
        ronda(
          2,
          algunoDe(trasLeer("asignaciones", "deLaPersona"), trasLeer("traspasos", "enCurso")),
        );

        const [asignacion, apagado] = await Promise.all([
          casos.asignarSucursales(e.ctx, { personaId: op.id, sucursales: [a, e.sucursal] }),
          casos.apagarMembresia(e.ctx, { personaId: op.id }),
        ]);

        expect(apagado.ok, `ronda ${n}`).toBe(true);
        expect(await apoyo.membresia(e.empresa, op.id)).toMatchObject({ activo: false });
        expect(
          await apoyo.asignadas(e.empresa, op.id),
          `ronda ${n}: un apagado no tiene asignaciones activas (${JSON.stringify(asignacion)})`,
        ).toEqual([]);
        if (asignacion.ok) resultados.asigno++;
        else {
          resultados.apagoPrimero++;
          expect(asignacion.error, `ronda ${n}`).toBe("MEMBRESIA_INACTIVA");
        }
      }
      expect(resultados.asigno + resultados.apagoPrimero).toBe(RONDAS_CRITICAS);
    });
  },
);
