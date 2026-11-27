import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { ok } from "../../src/primitivas/resultado/resultado";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Kysely } from "kysely";
import { crearTransacciones, type SinTablas } from "../../src/adaptadores/postgres/transacciones";
import {
  crearRepositorioDeMovimientosDeDinero,
  huellaDelMovimientoDeDinero,
  type CajaDb,
  type RepositorioDeMovimientosDeDinero,
} from "../../src/modulos/caja/publico";
import { importeATexto, importeDesdeTexto } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { empresaId, personaId, sucursalId } from "../../src/primitivas/identificadores/marca";
import { comoEmpresa, crearBarrera, crearBaseAparte } from "./entorno";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import { nombreUnico } from "./unicos";
import { acepta, conAppDe, crearMundo, type Mundo } from "./fiscal-apoyo";
import {
  HUELLA,
  abrirSesion,
  claveNueva,
  cobrar,
  crearCaja,
  crearEscenario,
  movimiento,
  textoDe,
  type Escenario,
  type TipoDeMedio,
} from "./caja-apoyo";
import { SesionDePrueba, type Intento } from "./sesiones";

/**
 * Migración 0114 (DM-1): la devolución de un cobro de ticket. SQL directo con el rol de la aplicación sobre una base propia con todas las migraciones. Cada caso corre en una
 * transacción que se deshace (`conAppDe`), salvo los de concurrencia y reversión, que confirman datos de verdad. Previene: una devolución que supera lo cobrado de la cobranza
 * (también con dos a la vez), una que cita una cobranza ajena o de otra sucursal, una que nace sin las columnas coherentes, y una reversión que borra devoluciones sin avisar.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const ORIGEN = "ventas.cobranza_de_ticket";
const AHORA = "2026-11-09T22:00:00Z";
const AISLAMIENTOS = ["read committed", "serializable"] as const;
type Aislamiento = (typeof AISLAMIENTOS)[number];

type Devolucion = Partial<{
  importe: string;
  cobranza: string;
  tipo: string | null;
  devolucionId: string | null;
  devuelveA: string | null;
  categoria: string | null;
  sentido: "ENTRADA" | "SALIDA";
  clave: string;
  sucursal: string;
}>;

describe.skipIf(base === null)(
  "migración 0114: devolución de un cobro de ticket (SQL directo)",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let m: Mundo;
    let esc: Escenario;
    let otra: Mundo;
    let escOtra: Escenario;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      m = await crearMundo(dueno);
      esc = await crearEscenario(dueno, m);
      otra = await crearMundo(dueno);
      escOtra = await crearEscenario(dueno, otra);
    });
    afterAll(async () => {
      await dueno.end();
      await propia.destruir();
    });

    const b = () => propia.base;

    // ---------------------------------------------------------------------------------------------
    // Apoyo
    // ---------------------------------------------------------------------------------------------
    const sesionNueva = async (mundo: Mundo = m, escenario: Escenario = esc): Promise<string> => {
      const caja = await crearCaja(dueno, mundo, nombreUnico("Caja"));
      let sesion = "";
      await conAppDe(b(), mundo, async (s) => {
        sesion = (await abrirSesion(s, escenario, { caja })).sesion;
        expect((await s.confirmar()).ok).toBe(true);
      });
      return sesion;
    };

    /** Una cobranza de ticket: un cobro por parte, con el origen de ventas. Devuelve el id de la cobranza. */
    const cobranzaDe = async (
      s: SesionDePrueba,
      sesion: string,
      partes: ReadonlyArray<readonly [TipoDeMedio, string]>,
      escenario: Escenario = esc,
    ): Promise<string> => {
      const id = randomUUID();
      let orden = 1;
      for (const [medio, importe] of partes) {
        await cobrar(s, escenario, sesion, { medio, importe, origen: { id, orden: orden++ } });
      }
      return id;
    };

    /** Una cobranza confirmada (para las pruebas que usan dos conexiones). */
    const cobranzaConfirmada = async (
      partes: ReadonlyArray<readonly [TipoDeMedio, string]> = [["EFECTIVO", "10000.00"]],
    ): Promise<{ cobranza: string; sesion: string }> => {
      const sesion = await sesionNueva();
      let cobranza = "";
      await conAppDe(b(), m, async (s) => {
        cobranza = await cobranzaDe(s, sesion, partes);
        expect((await s.confirmar()).ok).toBe(true);
      });
      return { cobranza, sesion };
    };

    const insertarActo = (
      s: SesionDePrueba,
      sesion: string,
      egreso: string | null,
      d: Devolucion,
      mundo: Mundo = m,
    ): Promise<Intento> =>
      s.intentar(
        `insert into movimiento_de_dinero (empresa_id, sucursal_id, sesion_id, sentido, importe, categoria, motivo, devuelve_a,
                                         devuelve_origen_tipo, devuelve_origen_id, devolucion_id, movimiento_id, clave, huella,
                                         registrado_por, registrado_en)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
        [
          mundo.empresa,
          d.sucursal ?? mundo.sucursal,
          sesion,
          d.sentido ?? "SALIDA",
          d.importe ?? "100.00",
          d.sentido === "ENTRADA" ? null : (d.categoria ?? "DEVOLUCION_DE_UN_COBRO"),
          d.sentido === "ENTRADA" ? null : "Devolucion de prueba",
          d.devuelveA ?? null,
          d.tipo === undefined ? ORIGEN : d.tipo,
          d.cobranza ?? null,
          d.devolucionId === undefined
            ? d.cobranza === undefined
              ? null
              : randomUUID()
            : d.devolucionId,
          egreso,
          d.clave ?? claveNueva(),
          HUELLA,
          mundo.persona,
          AHORA,
        ],
      );

    /** Una devolución completa: el egreso manual (con el medio) y el acto que cita la cobranza. */
    const devolver = async (
      s: SesionDePrueba,
      sesion: string,
      medio: TipoDeMedio,
      importe: string,
      d: Devolucion,
    ): Promise<{ egreso: string; acto: Intento }> => {
      const egreso = textoDe(
        await movimiento(s, esc, sesion, {
          clase: "EGRESO_MANUAL",
          medio,
          importe: `-${importe}`,
          motivo: "Devolucion de prueba",
        }),
        "id",
      );
      return { egreso, acto: await insertarActo(s, sesion, egreso, { ...d, importe }) };
    };

    const rechazo = (r: Intento, restriccion: string): void => {
      expect(r.ok, JSON.stringify(r)).toBe(false);
      if (!r.ok) expect(r.restriccion, `${r.codigo}: ${r.mensaje}`).toBe(restriccion);
    };
    const devolvible = async (s: SesionDePrueba, cobranza: string): Promise<string> =>
      textoDe(
        await s.intentar(
          "select movimiento_de_dinero_devolvible_de_origen($1, $2, $3)::numeric(18,2)::text as v",
          [m.empresa, ORIGEN, cobranza],
        ),
        "v",
      );
    const cuenta = async (texto: string, parametros: unknown[] = []): Promise<number> =>
      Number((await dueno.query<{ n: string }>(texto, parametros)).rows[0]?.n);

    // ---------------------------------------------------------------------------------------------
    describe("tope por cobranza", () => {
      it("feliz y parcial: tres cobros de un ticket suman lo devolvible; 4.000 y 6.000 por dos medios entran y un peso más no", async () => {
        await conAppDe(b(), m, async (s) => {
          const sesion = await sesionNueva();
          const cobranza = await cobranzaDe(s, sesion, [
            ["EFECTIVO", "5000.00"],
            ["TARJETA_DEBITO", "3000.00"],
            ["TRANSFERENCIA", "2000.00"],
          ]);
          expect(await devolvible(s, cobranza)).toBe("10000.00");
          const devolucionId = randomUUID();
          acepta(
            (await devolver(s, sesion, "EFECTIVO", "4000.00", { cobranza, devolucionId })).acto,
          );
          acepta(
            (await devolver(s, sesion, "TRANSFERENCIA", "6000.00", { cobranza, devolucionId }))
              .acto,
          );
          expect(await devolvible(s, cobranza)).toBe("0.00");
          rechazo(
            (await devolver(s, sesion, "EFECTIVO", "0.01", { cobranza })).acto,
            "devolucion_supera_lo_cobrado",
          );
        });
      });

      it("un peso más que lo cobrado se rechaza con la restricción de siempre; justo lo cobrado entra", async () => {
        await conAppDe(b(), m, async (s) => {
          const sesion = await sesionNueva();
          const cobranza = await cobranzaDe(s, sesion, [["EFECTIVO", "10000.00"]]);
          rechazo(
            (await devolver(s, sesion, "EFECTIVO", "10000.01", { cobranza })).acto,
            "devolucion_supera_lo_cobrado",
          );
        });
        await conAppDe(b(), m, async (s) => {
          const sesion = await sesionNueva();
          const cobranza = await cobranzaDe(s, sesion, [["EFECTIVO", "10000.00"]]);
          acepta((await devolver(s, sesion, "EFECTIVO", "10000.00", { cobranza })).acto);
        });
      });

      it("una devolución con su egreso anulado vuelve a liberar el tope", async () => {
        await conAppDe(b(), m, async (s) => {
          const sesion = await sesionNueva();
          const cobranza = await cobranzaDe(s, sesion, [["EFECTIVO", "10000.00"]]);
          const primera = await devolver(s, sesion, "EFECTIVO", "7000.00", { cobranza });
          acepta(primera.acto);
          expect(await devolvible(s, cobranza)).toBe("3000.00");
          acepta(
            await movimiento(s, esc, sesion, {
              clase: "ANULACION",
              medio: "EFECTIVO",
              importe: "7000.00",
              motivo: "Anula la devolucion",
              anulaA: primera.egreso,
            }),
          );
          expect(await devolvible(s, cobranza)).toBe("10000.00");
          acepta((await devolver(s, sesion, "EFECTIVO", "10000.00", { cobranza })).acto);
        });
      });

      it("una cobranza sin cobros (ticket a cuenta corriente) tiene tope 0 y no se puede citar", async () => {
        await conAppDe(b(), m, async (s) => {
          const sesion = await sesionNueva();
          const sinCobros = randomUUID();
          expect(await devolvible(s, sinCobros)).toBe("0.00");
          rechazo(
            (await devolver(s, sesion, "EFECTIVO", "1.00", { cobranza: sinCobros })).acto,
            "movimiento_de_dinero_devuelve_origen_invalido",
          );
        });
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("aislamiento", () => {
      it("una cobranza de otra empresa no existe para esta: se rechaza", async () => {
        const sesionOtra = await sesionNueva(otra, escOtra);
        let ajena = "";
        await conAppDe(b(), otra, async (s) => {
          ajena = await cobranzaDe(s, sesionOtra, [["EFECTIVO", "100.00"]], escOtra);
          expect((await s.confirmar()).ok).toBe(true);
        });
        await conAppDe(b(), m, async (s) => {
          const sesion = await sesionNueva();
          rechazo(
            (await devolver(s, sesion, "EFECTIVO", "10.00", { cobranza: ajena })).acto,
            "movimiento_de_dinero_devuelve_origen_invalido",
          );
        });
      });

      it("una cobranza cobrada en otra sucursal de la misma empresa se rechaza", async () => {
        const { rows } = await dueno.query<{ id: string }>(
          "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
          [m.empresa, nombreUnico("Sucursal dos")],
        );
        const dos: Mundo = { ...m, sucursal: rows[0]?.id as string };
        const escDos: Escenario = { ...esc, m: dos };
        const sesionDos = await sesionNueva(dos, escDos);
        let deLaDos = "";
        await conAppDe(b(), m, async (s) => {
          deLaDos = await cobranzaDe(s, sesionDos, [["EFECTIVO", "500.00"]], escDos);
          expect((await s.confirmar()).ok).toBe(true);
        });
        await conAppDe(b(), m, async (s) => {
          const sesion = await sesionNueva();
          rechazo(
            (await devolver(s, sesion, "EFECTIVO", "10.00", { cobranza: deLaDos })).acto,
            "movimiento_de_dinero_devuelve_origen_invalido",
          );
        });
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("idempotencia y atomicidad", () => {
      it("la misma clave dos veces: la segunda falla por la clave única y queda una sola fila", async () => {
        const { cobranza, sesion } = await cobranzaConfirmada();
        const clave = claveNueva();
        await conAppDe(b(), m, async (s) => {
          acepta((await devolver(s, sesion, "EFECTIVO", "10.00", { cobranza, clave })).acto);
          expect((await s.confirmar()).ok).toBe(true);
        });
        await conAppDe(b(), m, async (s) => {
          rechazo(
            (await devolver(s, sesion, "EFECTIVO", "10.00", { cobranza, clave })).acto,
            "movimiento_de_dinero_clave_uk",
          );
        });
        expect(
          await cuenta("select count(*) as n from movimiento_de_dinero where clave = $1", [clave]),
        ).toBe(1);
      });

      it("un egreso por transferencia SIN su acto no confirma (la puerta no queda abierta)", async () => {
        const { sesion } = await cobranzaConfirmada();
        await conAppDe(b(), m, async (s) => {
          acepta(
            await movimiento(s, esc, sesion, {
              clase: "EGRESO_MANUAL",
              medio: "TRANSFERENCIA",
              importe: "-10.00",
              motivo: "Sin acto",
            }),
          );
          rechazo(await s.confirmar(), "egreso_no_efectivo_sin_acto");
        });
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("restricciones de las columnas nuevas", () => {
      it("cada restricción con filas válidas e inválidas (con el disparador de alta apagado, para ver la restricción y no el disparador)", async () => {
        const sesion = await sesionNueva();
        let egreso = "";
        await conAppDe(b(), m, async (s) => {
          egreso = textoDe(
            await movimiento(s, esc, sesion, {
              clase: "EGRESO_MANUAL",
              medio: "EFECTIVO",
              importe: "-1.00",
              motivo: "Prueba",
            }),
            "id",
          );
          expect((await s.confirmar()).ok).toBe(true);
        });
        const cobranza = randomUUID();
        const intentar = async (d: Devolucion): Promise<string> => {
          await dueno.query("begin");
          try {
            await dueno.query(
              "alter table movimiento_de_dinero disable trigger movimiento_de_dinero_alta",
            );
            await dueno.query("savepoint p");
            const columnas = [
              m.empresa,
              m.sucursal,
              sesion,
              d.sentido ?? "SALIDA",
              "1.00",
              d.sentido === "ENTRADA" ? null : (d.categoria ?? "DEVOLUCION_DE_UN_COBRO"),
              d.sentido === "ENTRADA" ? null : "Prueba",
              d.devuelveA ?? null,
              d.tipo === undefined ? ORIGEN : d.tipo,
              d.cobranza === undefined ? null : d.cobranza,
              d.devolucionId === undefined
                ? d.cobranza === undefined
                  ? null
                  : randomUUID()
                : d.devolucionId,
              d.sentido === "ENTRADA" ? null : egreso,
              claveNueva(),
              HUELLA,
              m.persona,
              AHORA,
            ];
            try {
              await dueno.query(
                `insert into movimiento_de_dinero (empresa_id, sucursal_id, sesion_id, sentido, importe, categoria, motivo, devuelve_a,
                                                 devuelve_origen_tipo, devuelve_origen_id, devolucion_id, movimiento_id, clave, huella,
                                                 registrado_por, registrado_en)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
                columnas,
              );
              return "ok";
            } catch (error) {
              return (error as { constraint?: string }).constraint ?? String(error);
            }
          } finally {
            await dueno.query("rollback");
          }
        };
        // El par tipo/id va junto.
        expect(await intentar({ cobranza, tipo: null })).toBe("movimiento_de_dinero_origen_par_ck");
        // Lista cerrada de orígenes.
        expect(await intentar({ cobranza, tipo: "otro.origen" })).toBe(
          "movimiento_de_dinero_origen_tipo_ck",
        );
        // El pedido (`devolucion_id`) va si y solo si hay cobranza.
        expect(await intentar({ cobranza, devolucionId: null })).toBe(
          "movimiento_de_dinero_devolucion_id_ck",
        );
        // La devolución cita UNA cosa: una entrada o una cobranza, no las dos ni ninguna; otra categoría no cita nada.
        expect(await intentar({ cobranza, devuelveA: randomUUID() })).toBe(
          "movimiento_de_dinero_devolucion_ck",
        );
        expect(await intentar({ tipo: null, devolucionId: null })).toBe(
          "movimiento_de_dinero_devolucion_ck",
        );
        expect(await intentar({ cobranza, categoria: "GASTO_MENOR" })).toBe(
          "movimiento_de_dinero_devolucion_ck",
        );
        // La entrada no lleva las columnas nuevas.
        expect(await intentar({ sentido: "ENTRADA", cobranza })).not.toBe("ok");
        expect(await intentar({ sentido: "ENTRADA", cobranza })).toMatch(/^movimiento_de_dinero_/);
        // Una válida entra (sin el disparador: solo se prueba la forma).
        expect(await intentar({ cobranza })).toBe("ok");
      });

      it("el importe de una devolución cero, negativo o sobre el tope se rechaza", async () => {
        await conAppDe(b(), m, async (s) => {
          const sesion = await sesionNueva();
          const cobranza = await cobranzaDe(s, sesion, [["EFECTIVO", "1000.00"]]);
          for (const malo of ["0.00", "-5.00", "1000000000.00"]) {
            await s.directo("savepoint q");
            const r = await insertarActo(s, sesion, null, { cobranza, importe: malo });
            expect(r.ok, malo).toBe(false);
            await s.directo("rollback to savepoint q");
          }
        });
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("concurrencia", () => {
      const conReintento = async (
        aislamiento: Aislamiento,
        trabajo: (s: SesionDePrueba, primerIntento: boolean) => Promise<Intento | null>,
      ): Promise<string> => {
        for (let intento = 1; ; intento++) {
          const s = await SesionDePrueba.abrir(
            b(),
            "pedernal_app",
            comoEmpresa(empresaId(m.empresa), personaId(m.persona)),
            aislamiento,
          );
          try {
            const r = (await trabajo(s, intento === 1)) ?? (await s.confirmar());
            if (r.ok) return "ok";
            if (r.codigo === "40001" && intento < 3) continue;
            return r.restriccion ?? r.codigo;
          } finally {
            await s.cerrar();
          }
        }
      };

      it.each(AISLAMIENTOS)(
        "(%s) dos devoluciones de 7.000 sobre 10.000 desde dos cajas, en los DOS órdenes: una entra y la otra falla por el tope; nunca las dos",
        async (aislamiento) => {
          for (const _orden of ["A primero", "B primero"]) {
            const { cobranza } = await cobranzaConfirmada();
            const [cajaB, cajaC] = [await sesionNueva(), await sesionNueva()];
            const barrera = crearBarrera(2);
            const intentar = (sesion: string) =>
              conReintento(aislamiento, async (s, primero) => {
                const e = await movimiento(s, esc, sesion, {
                  clase: "EGRESO_MANUAL",
                  medio: "EFECTIVO",
                  importe: "-7000.00",
                  motivo: "Devolucion de prueba",
                });
                if (!e.ok) return e;
                if (primero) await barrera();
                const a = await insertarActo(s, sesion, textoDe(e, "id"), {
                  cobranza,
                  importe: "7000.00",
                });
                return a.ok ? null : a;
              });
            const resultados =
              _orden === "A primero"
                ? await Promise.all([intentar(cajaB), intentar(cajaC)])
                : (await Promise.all([intentar(cajaC), intentar(cajaB)])).reverse();
            expect(
              resultados.filter((r) => r === "ok"),
              JSON.stringify(resultados),
            ).toHaveLength(1);
            for (const r of resultados.filter((r) => r !== "ok")) {
              expect(r).toBe("devolucion_supera_lo_cobrado");
            }
            expect(
              await cuenta(
                "select coalesce(sum(importe), 0) as n from movimiento_de_dinero where devuelve_origen_id = $1",
                [cobranza],
              ),
            ).toBe(7000);
          }
        },
      );

      it.each(AISLAMIENTOS)(
        "(%s) devolver contra iniciar el cierre de la misma sesión: gana el que llegó primero; la devolución nunca entra en una sesión que ya no está abierta",
        async (aislamiento) => {
          const iniciarCierre = (s: SesionDePrueba, sesion: string) =>
            s.directo(
              `update sesion_caja set estado = 'EN_CIERRE', cierre_iniciado_por = $3,
                      cierre_iniciado_en = abierta_en + interval '1 hour'
                where empresa_id = $1 and id = $2`,
              [m.empresa, sesion, m.persona],
            );
          const abrirApp = () =>
            SesionDePrueba.abrir(
              b(),
              "pedernal_app",
              comoEmpresa(empresaId(m.empresa), personaId(m.persona)),
              aislamiento,
            );

          // (1) La devolución está en vuelo: el cierre espera, y al confirmar la devolución el movimiento queda dentro de la sesión.
          {
            const { cobranza } = await cobranzaConfirmada();
            const sesion = await sesionNueva();
            const a = await abrirApp();
            const c = await abrirApp();
            try {
              const dev = await devolver(a, sesion, "EFECTIVO", "1000.00", { cobranza });
              expect(dev.acto.ok, JSON.stringify(dev.acto)).toBe(true);
              let cierreTermino = false;
              const cierre = iniciarCierre(c, sesion).then((r) => {
                cierreTermino = true;
                return r;
              });
              await new Promise((r) => setTimeout(r, 400));
              expect(cierreTermino, "el cierre debe esperar a la devolución en vuelo").toBe(false);
              expect((await a.confirmar()).ok).toBe(true);
              await cierre;
              const confirmado = await c.confirmar();
              // Serializable puede cortar al segundo (40001): en ningún caso la devolución queda fuera de la sesión ni a medias.
              if (!confirmado.ok) expect(confirmado.codigo).toBe("40001");
            } finally {
              await a.cerrar();
              await c.cerrar();
            }
            expect(
              await cuenta(
                "select count(*) as n from movimiento_de_dinero where devuelve_origen_id = $1 and sesion_id = $2",
                [cobranza, sesion],
              ),
            ).toBe(1);
            expect(
              await cuenta(
                "select count(*) as n from movimiento_caja where sesion_id = $1 and importe = -1000",
                [sesion],
              ),
            ).toBe(1);
          }

          // (2) El cierre ya se confirmó: la devolución se rechaza completa (ni egreso ni acto) y lo devolvible no se toca.
          {
            const { cobranza } = await cobranzaConfirmada();
            const sesion = await sesionNueva();
            const c = await abrirApp();
            try {
              expect((await iniciarCierre(c, sesion)).ok).toBe(true);
              expect((await c.confirmar()).ok).toBe(true);
            } finally {
              await c.cerrar();
            }
            const antes = await cuenta(
              "select count(*) as n from movimiento_caja where sesion_id = $1",
              [sesion],
            );
            const a = await abrirApp();
            let rechazada: boolean | undefined;
            try {
              const egreso = await movimiento(a, esc, sesion, {
                clase: "EGRESO_MANUAL",
                medio: "EFECTIVO",
                importe: "-1000.00",
                motivo: "Devolucion de prueba",
              });
              rechazada = !egreso.ok;
              if (egreso.ok) {
                const acto = await insertarActo(a, sesion, textoDe(egreso, "id"), {
                  cobranza,
                  importe: "1000.00",
                });
                rechazada = !acto.ok;
              }
              await a.confirmar();
            } finally {
              await a.cerrar();
            }
            expect(rechazada, "una sesión en cierre no admite la devolución").toBe(true);
            expect(
              await cuenta(
                "select count(*) as n from movimiento_de_dinero where devuelve_origen_id = $1",
                [cobranza],
              ),
            ).toBe(0);
            expect(
              await cuenta("select count(*) as n from movimiento_caja where sesion_id = $1", [
                sesion,
              ]),
            ).toBe(antes);
          }
        },
      );

      it.each(AISLAMIENTOS)(
        "(%s) dos devoluciones que caben juntas (4.000 y 6.000) entran las dos",
        async (aislamiento) => {
          const { cobranza } = await cobranzaConfirmada();
          const [cajaB, cajaC] = [await sesionNueva(), await sesionNueva()];
          const barrera = crearBarrera(2);
          const intentar = (sesion: string, importe: string) =>
            conReintento(aislamiento, async (s, primero) => {
              const e = await movimiento(s, esc, sesion, {
                clase: "EGRESO_MANUAL",
                medio: "EFECTIVO",
                importe: `-${importe}`,
                motivo: "Devolucion de prueba",
              });
              if (!e.ok) return e;
              if (primero) await barrera();
              const a = await insertarActo(s, sesion, textoDe(e, "id"), { cobranza, importe });
              return a.ok ? null : a;
            });
          expect(
            await Promise.all([intentar(cajaB, "4000.00"), intentar(cajaC, "6000.00")]),
          ).toEqual(["ok", "ok"]);
        },
      );
    });

    // ---------------------------------------------------------------------------------------------
    describe("repositorio", () => {
      it("guarda y lee una devolución de cobranza (tipo, id y pedido) y devolvibleDeOrigen lee la regla de la base", async () => {
        const { cobranza, sesion } = await cobranzaConfirmada([["EFECTIVO", "100.00"]]);
        const entorno = crearTransacciones<{
          db: Kysely<SinTablas>;
          movimientosDeDinero: RepositorioDeMovimientosDeDinero;
        }>({
          urls: { OPERATIVO: b().app },
          armar: (db) => ({
            db,
            movimientosDeDinero: crearRepositorioDeMovimientosDeDinero(db.withTables<CajaDb>()),
          }),
          armarDeLectura: (db) => ({
            db,
            movimientosDeDinero: crearRepositorioDeMovimientosDeDinero(db.withTables<CajaDb>()),
          }),
          maximoDeConexiones: 2,
          clave: b().clave,
        });
        try {
          const contexto = comoEmpresa(empresaId(m.empresa), personaId(m.persona));
          const devolucionId = randomUUID();
          const resultado = await entorno.ejecutar(
            { contexto },
            async ({ db, movimientosDeDinero }) => {
              const egreso = (
                await db
                  .withTables<CajaDb>()
                  .insertInto("movimiento_caja")
                  .values({
                    empresa_id: m.empresa,
                    sesion_id: sesion,
                    clase: "EGRESO_MANUAL",
                    medio_de_pago_id: esc.medios.EFECTIVO,
                    cuenta_de_cobro_id: null,
                    importe: "-30.00",
                    motivo: "Devolucion de prueba",
                    registrado_en: new Date(AHORA),
                    registrado_por: m.persona,
                    clave_idempotencia: claveNueva(),
                    huella: HUELLA,
                  })
                  .returning("id")
                  .executeTakeFirstOrThrow()
              ).id;
              const id = await movimientosDeDinero.insertar({
                empresa: empresaId(m.empresa),
                sucursalId: sucursalId(m.sucursal),
                sesionId: sesion,
                sentido: "SALIDA",
                importe: importeDesdeTexto(ARS, "30.00"),
                categoria: "DEVOLUCION_DE_UN_COBRO",
                concepto: null,
                motivo: "Devolucion de prueba",
                terceroNombre: null,
                terceroPersonaId: null,
                referencia: null,
                devuelveA: null,
                devuelveOrigen: { tipo: ORIGEN, id: cobranza, devolucionId },
                movimientoId: egreso,
                claveDeIdempotencia: claveNueva(),
                huella: huellaDelMovimientoDeDinero({
                  sentido: "SALIDA",
                  sesionId: sesion,
                  importe: "30.00",
                  categoria: "DEVOLUCION_DE_UN_COBRO",
                  concepto: null,
                  motivo: "Devolucion de prueba",
                  terceroNombre: null,
                  terceroPersonaId: null,
                  referencia: null,
                  devuelveA: null,
                }),
                registradoEn: new Date(AHORA),
                registradoPor: personaId(m.persona),
              });
              const e = empresaId(m.empresa);
              return ok({
                leido: await movimientosDeDinero.obtener(e, id),
                queda: await movimientosDeDinero.devolvibleDeOrigen(e, ORIGEN, cobranza),
                sinCobros: await movimientosDeDinero.devolvibleDeOrigen(e, ORIGEN, randomUUID()),
                mal: await movimientosDeDinero.devolvibleDeOrigen(e, ORIGEN, "no-es-un-uuid"),
              });
            },
          );
          if (!resultado.ok) throw new Error("no se pudo guardar la devolución");
          const guardado = resultado.valor;
          expect(guardado.leido?.devuelveOrigen).toEqual({
            tipo: ORIGEN,
            id: cobranza,
            devolucionId,
          });
          expect(guardado.leido?.devuelveA).toBeNull();
          expect(importeATexto(guardado.queda)).toBe("70.00");
          expect(importeATexto(guardado.sinCobros)).toBe("0.00");
          expect(importeATexto(guardado.mal)).toBe("0.00");
        } finally {
          await entorno.cerrar();
        }
      });
    });

    // ---------------------------------------------------------------------------------------------
    describe("reversión", () => {
      const REVERSION = "reversiones/0114_revertir_devolucion_de_un_cobro_de_ticket.sql";
      const MIGRACION = "0114_devolucion_de_un_cobro_de_ticket.sql";
      const foto = async (c: pg.Client): Promise<string> => {
        const funciones = await c.query(
          `select p.proname, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'movimiento_de_dinero_%' order by 1`,
        );
        const restricciones = await c.query(
          `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.movimiento_de_dinero'::regclass order by 1`,
        );
        const columnas = await c.query(
          `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'movimiento_de_dinero' order by 1`,
        );
        const indices = await c.query(
          `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'movimiento_de_dinero' order by 1`,
        );
        return JSON.stringify([funciones.rows, restricciones.rows, columnas.rows, indices.rows]);
      };

      it("sin datos revierte (vuelven los cuerpos de 0091, sin columnas nuevas) y la migración se puede volver a aplicar con el mismo resultado", async () => {
        const aparte = await crearBaseAparte(base as NonNullable<typeof base>);
        const c = new pg.Client({ connectionString: aparte.base.dueno });
        await c.connect();
        try {
          const con = await foto(c);
          const reversion = await readFile(join(CARPETA_DE_MIGRACIONES, REVERSION), "utf8");
          const migracion = await readFile(join(CARPETA_DE_MIGRACIONES, MIGRACION), "utf8");
          await c.query(reversion);
          const sin = await foto(c);
          expect(sin).not.toBe(con);
          expect(sin).not.toContain("devuelve_origen");
          expect(sin).not.toContain("devolvible_de_origen");
          expect(
            (await c.query("select 1 from public.migracion where nombre = $1", [MIGRACION]))
              .rowCount,
          ).toBe(0);
          // Revertir otra vez no cambia nada.
          await c.query(reversion);
          expect(await foto(c)).toBe(sin);
          // Y volver a aplicar deja la base como estaba con la migración.
          await c.query(migracion);
          expect(await foto(c)).toBe(con);
        } finally {
          await c.end();
          await aparte.destruir();
        }
      });

      it("con una devolución de cobranza FRENA (55000) y no cambia nada", async () => {
        const aparte = await crearBaseAparte(base as NonNullable<typeof base>);
        const c = new pg.Client({ connectionString: aparte.base.dueno });
        await c.connect();
        try {
          const mundo = await crearMundo(c);
          const escenario = await crearEscenario(c, mundo);
          const caja = await crearCaja(c, mundo, nombreUnico("Caja"));
          let sesion = "";
          await conAppDe(aparte.base, mundo, async (s) => {
            sesion = (await abrirSesion(s, escenario, { caja })).sesion;
            expect((await s.confirmar()).ok).toBe(true);
          });
          await conAppDe(aparte.base, mundo, async (s) => {
            const cobranza = randomUUID();
            await cobrar(s, escenario, sesion, {
              medio: "EFECTIVO",
              importe: "100.00",
              origen: { id: cobranza },
            });
            const egreso = textoDe(
              await movimiento(s, escenario, sesion, {
                clase: "EGRESO_MANUAL",
                medio: "EFECTIVO",
                importe: "-40.00",
                motivo: "Devolucion de prueba",
              }),
              "id",
            );
            acepta(await insertarActo(s, sesion, egreso, { cobranza, importe: "40.00" }, mundo));
            expect((await s.confirmar()).ok).toBe(true);
          });
          const antes = await foto(c);
          const reversion = await readFile(join(CARPETA_DE_MIGRACIONES, REVERSION), "utf8");
          const fallo = await c.query(reversion).then(
            () => null,
            (error: unknown) => error as { code?: string; message?: string },
          );
          expect(fallo?.code).toBe("55000");
          expect(fallo?.message).toContain("no se revierte sin decisión del dueño");
          expect(await foto(c)).toBe(antes);
          expect(
            (await c.query("select 1 from public.migracion where nombre = $1", [MIGRACION]))
              .rowCount,
          ).toBe(1);
        } finally {
          await c.end();
          await aparte.destruir();
        }
      });
    });
  },
);
