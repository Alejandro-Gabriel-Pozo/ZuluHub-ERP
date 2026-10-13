import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  emisorId,
  iniciarSerie,
  puntoDeVentaId,
  reservarNumero,
  solicitudId,
  traducirErroresDeFiscal,
  type Ambiente,
  type PuntoDeVentaId,
} from "../../src/modulos/fiscal/publico";
import type { Contexto } from "../../src/contexto/contexto";
import { empresaId } from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { crearEscenario, type Escenario } from "./facturacion-apoyo";
import {
  altaDe,
  autorizar,
  comoPersonaDe,
  comoSistemaDe,
  crearEntornoFacturacion,
  type TxFacturacionDePrueba,
} from "./facturacion-persistencia-apoyo";
import { crearMundo } from "./fiscal-apoyo";

/**
 * Facturación F3: la serie y el punto de venta modelan el AMBIENTE (homologación o producción) de verdad. Un número de
 * homologación no avanza la serie de producción del mismo punto de venta; una serie nace en el ambiente de su punto de
 * venta; el punto de venta cambia de ambiente con control de versión (QF2) y la base frena lo que no se puede
 * (una serie en curso, volver atrás después de emitir en producción).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const AHORA = new Date("2026-10-12T12:00:00.000Z");

function exito<T, E>(r: Resultado<T, E>): T {
  if (!r.ok) throw new Error(`tenía que ser un éxito: ${JSON.stringify(r.error)}`);
  return r.valor;
}

describe.skipIf(base === null)(
  "facturación F3: el ambiente en la serie y en el punto de venta",
  () => {
    let dueno: pg.Client;
    let entorno: ReturnType<typeof crearEntornoFacturacion>;

    beforeAll(async () => {
      if (base === null) return;
      dueno = new pg.Client({ connectionString: base.dueno });
      await dueno.connect();
      entorno = crearEntornoFacturacion(base);
    });
    afterAll(async () => {
      await entorno.cerrar();
      await dueno.end();
    });

    const consultar = async <T extends Record<string, unknown>>(
      texto: string,
      parametros: unknown[] = [],
    ) => (await dueno.query<T>(texto, parametros)).rows;
    const escenario = (opciones: Parameters<typeof crearEscenario>[1] = {}) =>
      crearEscenario(dueno, opciones);
    async function correr<T>(
      contexto: Contexto,
      trabajo: (tx: TxFacturacionDePrueba) => Promise<T>,
    ): Promise<T> {
      const r = await entorno.ejecutar({ contexto }, async (tx) => ok(await trabajo(tx)));
      if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
      return r.valor;
    }
    const intentar = <T>(contexto: Contexto, trabajo: (tx: TxFacturacionDePrueba) => Promise<T>) =>
      entorno.ejecutar({ contexto }, async (tx) => ok(await trabajo(tx)));
    const pvDe = (e: Escenario): PuntoDeVentaId => puntoDeVentaId(e.pv);
    const pasarAProduccion = async (e: Escenario) => {
      const pv = await correr(comoPersonaDe(e), (tx) =>
        tx.puntosDeVenta.obtener(empresaId(e.empresa), pvDe(e)),
      );
      return correr(comoPersonaDe(e), (tx) =>
        tx.puntosDeVenta.cambiarAmbiente(
          empresaId(e.empresa),
          pvDe(e),
          "PRODUCCION",
          pv?.version ?? 0,
        ),
      );
    };
    /** Una serie LIBRE nueva de FACTURA_B en el ambiente pedido (por defecto, homologación). */
    const nuevaSerie = (e: Escenario, ultimo = 0n, ambiente: Ambiente = "HOMOLOGACION") =>
      exito(
        iniciarSerie(
          {
            empresaId: empresaId(e.empresa),
            puntoDeVentaId: pvDe(e),
            emisorId: emisorId(e.emisor),
            tipo: "FACTURA_B",
            ambiente,
          },
          ultimo,
        ),
      );
    const ambientesDeLasSeries = async (e: Escenario) =>
      (
        await consultar<{ ambiente: string; ultimo: string; estado: string }>(
          "select ambiente, ultimo_numero::text as ultimo, estado from serie_comprobante where punto_de_venta_id = $1 order by ambiente",
          [e.pv],
        )
      ).map((f) => [f.ambiente, f.ultimo, f.estado]);

    // ===============================================================================================
    // El punto de venta
    // ===============================================================================================
    describe("el punto de venta", () => {
      it("nace en HOMOLOGACION y se lee con su ambiente de todas las maneras", async () => {
        const e = await escenario();
        const todos = await correr(comoPersonaDe(e), async (tx) => ({
          uno: await tx.puntosDeVenta.obtener(empresaId(e.empresa), pvDe(e)),
          listar: await tx.puntosDeVenta.listar(empresaId(e.empresa)),
          delEmisor: await tx.puntosDeVenta.listarDelEmisor(
            empresaId(e.empresa),
            emisorId(e.emisor),
          ),
        }));
        expect(todos.uno?.ambiente).toBe("HOMOLOGACION");
        expect(todos.listar.map((p) => p.ambiente)).toEqual(["HOMOLOGACION"]);
        expect(todos.delEmisor.map((p) => p.ambiente)).toEqual(["HOMOLOGACION"]);
      });

      it("`cambiarAmbiente` pasa a PRODUCCION con la versión leída, y repetirlo es un «ya estaba» que no escribe", async () => {
        const e = await escenario();
        const antes = await correr(comoPersonaDe(e), (tx) =>
          tx.puntosDeVenta.obtener(empresaId(e.empresa), pvDe(e)),
        );
        const cambiado = await pasarAProduccion(e);
        expect(cambiado).toMatchObject({
          ambiente: "PRODUCCION",
          version: (antes?.version ?? 0) + 1,
        });
        expect(
          (
            await consultar<{ ambiente: string }>(
              "select ambiente from punto_de_venta where id = $1",
              [e.pv],
            )
          )[0],
        ).toEqual({ ambiente: "PRODUCCION" });
        // Repetir, con la versión vieja o con la nueva: devuelve el mismo punto de venta y no escribe.
        for (const version of [antes?.version ?? 0, cambiado?.version ?? 0]) {
          const otra = await correr(comoPersonaDe(e), (tx) =>
            tx.puntosDeVenta.cambiarAmbiente(empresaId(e.empresa), pvDe(e), "PRODUCCION", version),
          );
          expect(otra).toEqual(cambiado);
        }
        expect(
          (
            await consultar<{ v: number }>(
              "select version as v from punto_de_venta where id = $1",
              [e.pv],
            )
          )[0],
        ).toEqual({ v: cambiado?.version });
      });

      it("con una versión vieja (y otro ambiente) devuelve null y no toca nada; `guardar` nunca mueve el ambiente", async () => {
        const e = await escenario();
        const antes = await correr(comoPersonaDe(e), (tx) =>
          tx.puntosDeVenta.obtener(empresaId(e.empresa), pvDe(e)),
        );
        const viejo = await correr(comoPersonaDe(e), (tx) =>
          tx.puntosDeVenta.cambiarAmbiente(
            empresaId(e.empresa),
            pvDe(e),
            "PRODUCCION",
            (antes?.version ?? 0) + 5,
          ),
        );
        expect(viejo).toBeNull();
        expect(
          await correr(comoPersonaDe(e), (tx) =>
            tx.puntosDeVenta.cambiarAmbiente(
              empresaId(e.empresa),
              puntoDeVentaId("00000000-0000-4000-8000-000000000000"),
              "PRODUCCION",
              1,
            ),
          ),
        ).toBeNull();
        // Guardar el punto de venta con un ambiente distinto en el objeto no lo cambia.
        const conOtroAmbiente = { ...antes!, ambiente: "PRODUCCION" as const };
        const guardado = await correr(comoPersonaDe(e), (tx) =>
          tx.puntosDeVenta.guardar(conOtroAmbiente),
        );
        expect(guardado?.ambiente).toBe("HOMOLOGACION");
        expect(
          (
            await consultar<{ ambiente: string }>(
              "select ambiente from punto_de_venta where id = $1",
              [e.pv],
            )
          )[0],
        ).toEqual({ ambiente: "HOMOLOGACION" });
      });

      it("con una serie EN_CURSO el ambiente no cambia: SERIE_EN_CURSO", async () => {
        const e = await escenario();
        await correr(comoPersonaDe(e), async (tx) => {
          exito(await tx.comprobantes.crear(altaDe(e)));
        });
        // Un comprobante reservando su número deja la serie EN_CURSO.
        await correr(comoSistemaDe(e), async (tx) => {
          const serie = (await tx.series.crear(nuevaSerie(e))).valor;
          const r = exito(reservarNumero(serie, solicitudId(randomUUID()), AHORA));
          if (r.tipo !== "RESERVADA") throw new Error("tenía que reservar");
          await tx.series.guardar({ ...r.serie, ambiente: "HOMOLOGACION" });
        });
        const pv = await correr(comoPersonaDe(e), (tx) =>
          tx.puntosDeVenta.obtener(empresaId(e.empresa), pvDe(e)),
        );
        const r = await intentar(comoPersonaDe(e), (tx) =>
          tx.puntosDeVenta.cambiarAmbiente(
            empresaId(e.empresa),
            pvDe(e),
            "PRODUCCION",
            pv?.version ?? 0,
          ),
        );
        expect(r).toEqual(
          err({ tipo: "Check", restriccion: "punto_de_venta_ambiente_con_serie_en_curso" }),
        );
        expect(traducirErroresDeFiscal(r, ["SERIE_EN_CURSO"])).toEqual(err("SERIE_EN_CURSO"));
        expect(
          (
            await consultar<{ ambiente: string }>(
              "select ambiente from punto_de_venta where id = $1",
              [e.pv],
            )
          )[0],
        ).toEqual({ ambiente: "HOMOLOGACION" });
      });

      it("de PRODUCCION no se vuelve a HOMOLOGACION si ya emitió; sin haber emitido, sí", async () => {
        const e = await escenario();
        await pasarAProduccion(e);
        // Sin series de producción usadas: se puede volver.
        await correr(comoSistemaDe(e), (tx) => tx.series.crear(nuevaSerie(e, 0n, "PRODUCCION")));
        const vuelve = async () => {
          const pv = await correr(comoPersonaDe(e), (tx) =>
            tx.puntosDeVenta.obtener(empresaId(e.empresa), pvDe(e)),
          );
          return intentar(comoPersonaDe(e), (tx) =>
            tx.puntosDeVenta.cambiarAmbiente(
              empresaId(e.empresa),
              pvDe(e),
              "HOMOLOGACION",
              pv?.version ?? 0,
            ),
          );
        };
        const sinEmitir = exito(await vuelve());
        expect(sinEmitir?.ambiente).toBe("HOMOLOGACION");
        // Pasa a producción otra vez, emite (la serie de producción avanza) y ya no vuelve.
        await pasarAProduccion(e);
        const alta = altaDe(e, { ambiente: "PRODUCCION" });
        await correr(comoPersonaDe(e), async (tx) => exito(await tx.comprobantes.crear(alta)));
        await correr(comoSistemaDe(e), (tx) => autorizar(tx, alta.id, e.empresa, AHORA));
        const r = await vuelve();
        expect(r).toEqual(err({ tipo: "Check", restriccion: "punto_de_venta_ambiente_no_vuelve" }));
        expect(traducirErroresDeFiscal(r, ["PUNTO_DE_VENTA_YA_EMITIO_EN_PRODUCCION"])).toEqual(
          err("PUNTO_DE_VENTA_YA_EMITIO_EN_PRODUCCION"),
        );
      });

      it("aislamiento: otra empresa no cambia el ambiente de un punto de venta ajeno", async () => {
        const a = await escenario();
        const b = await escenario({ mundo: await crearMundo(dueno, { tenant: a.tenant }) });
        const r = await correr(comoPersonaDe(b), (tx) =>
          tx.puntosDeVenta.cambiarAmbiente(empresaId(a.empresa), pvDe(a), "PRODUCCION", 1),
        );
        expect(r).toBeNull();
        expect(
          (
            await consultar<{ ambiente: string }>(
              "select ambiente from punto_de_venta where id = $1",
              [a.pv],
            )
          )[0],
        ).toEqual({ ambiente: "HOMOLOGACION" });
      });
    });

    // ===============================================================================================
    // La serie
    // ===============================================================================================
    describe("la serie", () => {
      it("nace en el ambiente de su punto de venta, y pedir otro es SERIE_AMBIENTE_INVALIDO (nada se crea)", async () => {
        const e = await escenario();
        const r = await intentar(comoSistemaDe(e), (tx) =>
          tx.series.crear(nuevaSerie(e, 0n, "PRODUCCION")),
        );
        expect(r).toEqual(err({ tipo: "Check", restriccion: "serie_ambiente_invalido" }));
        expect(traducirErroresDeFiscal(r, ["SERIE_AMBIENTE_INVALIDO"])).toEqual(
          err("SERIE_AMBIENTE_INVALIDO"),
        );
        expect(await ambientesDeLasSeries(e)).toEqual([]);
        const creada = await correr(comoSistemaDe(e), (tx) => tx.series.crear(nuevaSerie(e, 7n)));
        expect(creada).toMatchObject({
          creado: true,
          valor: { ambiente: "HOMOLOGACION", ultimoNumero: 7n, estado: "LIBRE" },
        });
        expect(await ambientesDeLasSeries(e)).toEqual([["HOMOLOGACION", "7", "LIBRE"]]);
      });

      it("la clave incluye el ambiente: la serie de homologación y la de producción del mismo punto de venta y tipo conviven", async () => {
        const e = await escenario();
        await correr(comoSistemaDe(e), (tx) => tx.series.crear(nuevaSerie(e, 7n)));
        await pasarAProduccion(e);
        const produccion = await correr(comoSistemaDe(e), (tx) =>
          tx.series.crear(nuevaSerie(e, 100n, "PRODUCCION")),
        );
        expect(produccion).toMatchObject({
          creado: true,
          valor: { ambiente: "PRODUCCION", ultimoNumero: 100n },
        });
        expect(await ambientesDeLasSeries(e)).toEqual([
          ["HOMOLOGACION", "7", "LIBRE"],
          ["PRODUCCION", "100", "LIBRE"],
        ]);
        const leidas = await correr(comoSistemaDe(e), async (tx) => ({
          homologacion: await tx.series.obtener(
            empresaId(e.empresa),
            pvDe(e),
            "FACTURA_B",
            "HOMOLOGACION",
          ),
          produccion: await tx.series.obtener(
            empresaId(e.empresa),
            pvDe(e),
            "FACTURA_B",
            "PRODUCCION",
          ),
          todasLasActuales: await tx.series.delPuntoDeVenta(empresaId(e.empresa), pvDe(e)),
          todasLasDeHomologacion: await tx.series.delPuntoDeVenta(
            empresaId(e.empresa),
            pvDe(e),
            "HOMOLOGACION",
          ),
        }));
        expect(leidas.produccion).toMatchObject({ ambiente: "PRODUCCION", ultimoNumero: 100n });
        expect(leidas.homologacion).toMatchObject({ ambiente: "HOMOLOGACION", ultimoNumero: 7n });
        expect(leidas.todasLasActuales.map((s) => s.ambiente)).toEqual(["PRODUCCION"]);
        expect(leidas.todasLasDeHomologacion.map((s) => s.ultimoNumero)).toEqual([7n]);
      });

      it("repetir el alta por ambiente devuelve la que existe SIN pisar su último número", async () => {
        const e = await escenario();
        await correr(comoSistemaDe(e), (tx) => tx.series.crear(nuevaSerie(e, 7n)));
        await pasarAProduccion(e);
        const otraVez = await correr(comoSistemaDe(e), (tx) =>
          tx.series.crear(nuevaSerie(e, 999n, "HOMOLOGACION")),
        );
        expect(otraVez).toMatchObject({
          creado: false,
          valor: { ambiente: "HOMOLOGACION", ultimoNumero: 7n },
        });
        // La de producción todavía no existe: pedirla la crea.
        const nueva = await correr(comoSistemaDe(e), (tx) =>
          tx.series.crear(nuevaSerie(e, 5n, "PRODUCCION")),
        );
        expect(nueva).toMatchObject({
          creado: true,
          valor: { ambiente: "PRODUCCION", ultimoNumero: 5n },
        });
      });

      it("guardar mueve la serie de SU ambiente: reservar en homologación (explícito) no toca la de producción", async () => {
        const e = await escenario();
        await correr(comoSistemaDe(e), (tx) => tx.series.crear(nuevaSerie(e, 7n)));
        await pasarAProduccion(e);
        await correr(comoSistemaDe(e), (tx) => tx.series.crear(nuevaSerie(e, 100n, "PRODUCCION")));
        const enCurso = await correr(comoSistemaDe(e), async (tx) => {
          const homologacion = await tx.series.obtener(
            empresaId(e.empresa),
            pvDe(e),
            "FACTURA_B",
            "HOMOLOGACION",
          );
          if (homologacion === null) throw new Error("tenía que existir");
          const r = exito(reservarNumero(homologacion, solicitudId(randomUUID()), AHORA));
          if (r.tipo !== "RESERVADA") throw new Error("tenía que reservar");
          return tx.series.guardar(r.serie);
        });
        expect(enCurso).toMatchObject({
          ambiente: "HOMOLOGACION",
          estado: "EN_CURSO",
          numeroEnCurso: 8n,
        });
        expect(await ambientesDeLasSeries(e)).toEqual([
          ["HOMOLOGACION", "7", "EN_CURSO"],
          ["PRODUCCION", "100", "LIBRE"],
        ]);
        const deProduccion = await correr(comoSistemaDe(e), async (tx) => {
          const produccion = await tx.series.obtener(
            empresaId(e.empresa),
            pvDe(e),
            "FACTURA_B",
            "PRODUCCION",
          );
          if (produccion === null) throw new Error("tenía que existir");
          const r = exito(reservarNumero(produccion, solicitudId(randomUUID()), AHORA));
          if (r.tipo !== "RESERVADA") throw new Error("tenía que reservar");
          return tx.series.guardar(r.serie);
        });
        expect(deProduccion).toMatchObject({ ambiente: "PRODUCCION", numeroEnCurso: 101n });
      });

      it("emitir en homologación no cambia la serie de producción del mismo punto de venta", async () => {
        const e = await escenario();
        // Un comprobante de homologación, autorizado con números 1, 2 y 3...
        for (let n = 0; n < 3; n++) {
          const alta = altaDe(e);
          await correr(comoPersonaDe(e), async (tx) => exito(await tx.comprobantes.crear(alta)));
          await correr(comoSistemaDe(e), (tx) => autorizar(tx, alta.id, e.empresa, AHORA));
        }
        // ... el punto de venta pasa a producción y su serie nace aparte.
        await pasarAProduccion(e);
        await correr(comoSistemaDe(e), (tx) => tx.series.crear(nuevaSerie(e, 500n, "PRODUCCION")));
        // Una pendiente de homologación (nació antes del cambio) se valida contra SU serie de homologación.
        const rezagado = altaDe(e, { ambiente: "HOMOLOGACION" });
        await correr(comoSistemaDe(e), async (tx) => {
          await tx.series.obtener(empresaId(e.empresa), pvDe(e), "FACTURA_B", "HOMOLOGACION");
        });
        // (el alta de un comprobante de homologación con el punto de venta ya en producción la frena la base)
        const r = await intentar(comoPersonaDe(e), (tx) => tx.comprobantes.crear(rezagado));
        expect(r).toEqual(err({ tipo: "Check", restriccion: "comprobante_alta_invalida" }));
        expect(traducirErroresDeFiscal(r, ["COMPROBANTE_ALTA_INVALIDA"])).toEqual(
          err("COMPROBANTE_ALTA_INVALIDA"),
        );
        expect(await ambientesDeLasSeries(e)).toEqual([
          ["HOMOLOGACION", "3", "LIBRE"],
          ["PRODUCCION", "500", "LIBRE"],
        ]);
      });

      it("las vencidas se traen de cualquier ambiente, con el suyo; los números usados cuentan en todos", async () => {
        const e = await escenario();
        const hace = new Date("2026-10-12T10:00:00.000Z");
        const antes = new Date("2026-10-12T09:00:00.000Z");
        await correr(comoSistemaDe(e), (tx) => tx.series.crear(nuevaSerie(e, 3n)));
        await pasarAProduccion(e);
        await correr(comoSistemaDe(e), (tx) => tx.series.crear(nuevaSerie(e, 40n, "PRODUCCION")));
        // Las dos reservan: la de producción hace un rato y la de homologación (de un comprobante que nació antes del
        // cambio) todavía antes; ninguna vence en el futuro.
        for (const [ambiente, cuando] of [
          ["PRODUCCION", hace],
          ["HOMOLOGACION", antes],
        ] as const) {
          await correr(comoSistemaDe(e), async (tx) => {
            const serie = await tx.series.obtener(
              empresaId(e.empresa),
              pvDe(e),
              "FACTURA_B",
              ambiente,
            );
            if (serie === null) throw new Error("tenía que existir");
            const r = exito(reservarNumero(serie, solicitudId(randomUUID()), cuando));
            if (r.tipo !== "RESERVADA") throw new Error("tenía que reservar");
            await tx.series.guardar({ ...r.serie, ambiente });
          });
        }
        const vencidas = await correr(comoSistemaDe(e), (tx) =>
          tx.series.enCursoVencidas(empresaId(e.empresa), AHORA, 10),
        );
        expect(vencidas.map((s) => [s.ambiente, s.estado, s.ultimoNumero])).toEqual([
          ["HOMOLOGACION", "EN_CURSO", 3n],
          ["PRODUCCION", "EN_CURSO", 40n],
        ]);
        expect(
          (
            await correr(comoSistemaDe(e), (tx) =>
              tx.series.enCursoVencidas(empresaId(e.empresa), AHORA, 1),
            )
          ).map((s) => s.ambiente),
        ).toEqual(["HOMOLOGACION"]);
        expect(
          await correr(comoSistemaDe(e), (tx) =>
            tx.series.hayNumerosUsadosDelPuntoDeVenta(empresaId(e.empresa), pvDe(e)),
          ),
        ).toBe(true);
        // Aun si solo la de producción se usó, el punto de venta tiene números usados.
        const otro = await escenario();
        await pasarAProduccion(otro);
        await correr(comoSistemaDe(otro), (tx) =>
          tx.series.crear(nuevaSerie(otro, 12n, "PRODUCCION")),
        );
        expect(
          await correr(comoSistemaDe(otro), (tx) =>
            tx.series.hayNumerosUsadosDelPuntoDeVenta(empresaId(otro.empresa), pvDe(otro)),
          ),
        ).toBe(true);
        expect(
          await correr(comoSistemaDe(otro), (tx) =>
            tx.series.hayNumerosUsadosDelEmisor(empresaId(otro.empresa), emisorId(otro.emisor)),
          ),
        ).toBe(true);
      });
    });
  },
);
