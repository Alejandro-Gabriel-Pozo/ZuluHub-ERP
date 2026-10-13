import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cerrarSerie,
  iniciarSerie,
  puntoDeVentaId,
  reservarNumero,
  solicitudId,
  verificarSecuencia,
  type ComprobanteId,
} from "../../src/modulos/fiscal/publico";
import type { Contexto } from "../../src/contexto/contexto";
import type { Aislamiento } from "../../src/puertos/transacciones";
import { empresaId } from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { crearBarrera, crearBaseAparte } from "./entorno";
import { crearEscenario, type Escenario } from "./facturacion-apoyo";
import {
  CAE_DE_PRUEBA,
  altaDe,
  cargaDe,
  comoPersonaDe,
  comoSistemaDe,
  crearEntornoFacturacion,
  diaDe,
  fechaCivil,
  intentoDe,
  pedidoDe,
  type TxFacturacionDePrueba,
} from "./facturacion-persistencia-apoyo";

/**
 * Facturación F3: concurrencia REAL de los repositorios de la facturación. Cada prueba lanza varias transacciones a la vez
 * (`Promise.all`) y, con una barrera dentro de cada una, fuerza que TODAS hayan empezado antes de que cualquiera escriba. Después
 * mira la base: nunca hay duplicados, huecos ni estados a medias, y quien pierde la carrera recibe el MISMO resultado exitoso
 * (cuando la acción era la misma) o un resultado con nombre (cuando era otra), nunca una excepción cruda ni un éxito falso.
 * Se corren con los dos niveles de aislamiento: el de las escrituras con invariantes (SERIALIZABLE, con reintento) y READ COMMITTED.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 240_000 });

const RONDAS = 10;
const AISLAMIENTOS: readonly Aislamiento[] = ["serializable", "read committed"];
const AHORA = new Date("2026-10-12T12:00:00.000Z");
const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));
/** Para los mensajes de falla: `JSON.stringify` no sabe de `bigint`. */
const texto = (x: unknown) =>
  JSON.stringify(x, (_k, v: unknown) => (typeof v === "bigint" ? `${v}n` : v));

function valor<T>(r: Resultado<T, unknown>): T {
  if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
  return r.valor;
}

describe.skipIf(base === null)("facturación F3: concurrencia de los repositorios", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoFacturacion>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoFacturacion(propia.base, 16);
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
  const cuenta = async (texto: string, parametros: unknown[] = []) =>
    Number((await consultar<{ n: string }>(texto, parametros))[0]?.n);
  const escenario = (opciones: Parameters<typeof crearEscenario>[1] = {}) =>
    crearEscenario(dueno, opciones);

  /**
   * `n` transacciones a la vez; cada una espera en la barrera, después de haber empezado, antes de hacer su trabajo. Devuelve
   * los `Resultado` tal como los recibe quien llama (con los errores de negocio del trabajo, si los hay).
   */
  async function enParalelo<T, E>(
    contexto: Contexto,
    trabajos: readonly ((tx: TxFacturacionDePrueba) => Promise<Resultado<T, E>>)[],
    aislamiento: Aislamiento = "serializable",
  ) {
    const barrera = crearBarrera(trabajos.length);
    return Promise.all(
      trabajos.map((trabajo) =>
        entorno.ejecutar({ contexto, aislamiento }, async (tx) => {
          await sql`select 1`.execute(tx.db); // la transacción ya empezó
          await barrera();
          return trabajo(tx);
        }),
      ),
    );
  }
  const exitoso =
    <T>(trabajo: (tx: TxFacturacionDePrueba) => Promise<T>) =>
    async (tx: TxFacturacionDePrueba): Promise<Resultado<T, never>> =>
      ok(await trabajo(tx));

  // ===============================================================================================
  // Altas del mismo comprobante o de la misma clave: uno gana, el otro ve «ya estaba»
  // ===============================================================================================
  describe("idempotencia: la misma alta a la vez deja un comprobante", () => {
    const filas = async (e: Escenario) => ({
      comprobantes: await cuenta("select count(*) as n from comprobante where empresa_id = $1", [
        e.empresa,
      ]),
      renglones: await cuenta("select count(*) as n from comprobante_linea where empresa_id = $1", [
        e.empresa,
      ]),
      desglose: await cuenta(
        "select count(*) as n from comprobante_alicuota where empresa_id = $1",
        [e.empresa],
      ),
    });

    for (const aislamiento of AISLAMIENTOS) {
      it(`dos altas del MISMO comprobante (mismo id) a la vez: una lo crea, la otra recibe el mismo [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const e = await escenario();
          const alta = altaDe(e);
          const rs = (
            await enParalelo(
              comoPersonaDe(e),
              [(tx) => tx.comprobantes.crear(alta), (tx) => tx.comprobantes.crear(alta)],
              aislamiento,
            )
          ).map(valor);
          const [a, b] = rs;
          expect([a?.creado, b?.creado].sort(), `ronda ${n}`).toEqual([false, true]);
          expect(a?.valor, `ronda ${n}`).toEqual(b?.valor);
          expect(await filas(e), `ronda ${n}`).toEqual({
            comprobantes: 1,
            renglones: 1,
            desglose: 1,
          });
        }
      });

      it(`dos altas de la MISMA CLAVE MANUAL con ids distintos a la vez: gana una, la otra recibe el comprobante ganador [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const e = await escenario();
          const primera = altaDe(e);
          const huella = primera.huella;
          const segunda = altaDe(e, { origen: primera.contenido.origen, huella });
          const rs = (
            await enParalelo(
              comoPersonaDe(e),
              [(tx) => tx.comprobantes.crear(primera), (tx) => tx.comprobantes.crear(segunda)],
              aislamiento,
            )
          ).map(valor);
          const [a, b] = rs;
          expect([a?.creado, b?.creado].sort(), `ronda ${n}`).toEqual([false, true]);
          // Las dos hablan del MISMO comprobante, el que ganó (su id es el de una de las dos altas).
          expect(a?.valor.id, `ronda ${n}`).toBe(b?.valor.id);
          expect([primera.id, segunda.id], `ronda ${n}`).toContain(a?.valor.id);
          expect(await filas(e), `ronda ${n}`).toEqual({
            comprobantes: 1,
            renglones: 1,
            desglose: 1,
          });
        }
      });

      it(`la misma clave con OTROS datos a la vez: gana una y la otra ve la huella del ganador (el caso de uso dirá CLAVE_REUTILIZADA) [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const e = await escenario();
          const primera = altaDe(e);
          const segunda = altaDe(e, { origen: primera.contenido.origen });
          expect(primera.huella).not.toBe(segunda.huella);
          const rs = (
            await enParalelo(
              comoPersonaDe(e),
              [(tx) => tx.comprobantes.crear(primera), (tx) => tx.comprobantes.crear(segunda)],
              aislamiento,
            )
          ).map(valor);
          const [a, b] = rs;
          const ganador = a?.creado === true ? primera : segunda;
          expect([a?.creado, b?.creado].sort(), `ronda ${n}`).toEqual([false, true]);
          expect(a?.valor.huella, `ronda ${n}`).toBe(ganador.huella);
          expect(b?.valor.huella, `ronda ${n}`).toBe(ganador.huella);
          expect((await filas(e)).comprobantes, `ronda ${n}`).toBe(1);
        }
      });

      it(`tres altas de la misma clave a la vez dejan un solo comprobante y las tres hablan de él [${aislamiento}]`, async () => {
        const e = await escenario();
        const origen = altaDe(e).contenido.origen;
        const altas = [0, 1, 2].map(() => altaDe(e, { origen, huella: "a".repeat(64) }));
        const rs = (
          await enParalelo(
            comoPersonaDe(e),
            altas.map((alta) => (tx: TxFacturacionDePrueba) => tx.comprobantes.crear(alta)),
            aislamiento,
          )
        ).map(valor);
        const creados = rs;
        expect(creados.filter((c) => c.creado)).toHaveLength(1);
        expect(new Set(creados.map((c) => c.valor.id)).size).toBe(1);
        expect(await filas(e)).toEqual({ comprobantes: 1, renglones: 1, desglose: 1 });
      });

      it(`dos altas de la misma identidad que no es manual (otro origen) con ids distintos a la vez: gana una [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const e = await escenario();
          const origen = { tipo: "SUSCRIPCION", id: altaDe(e).contenido.origen.id } as const;
          const rs = (
            await enParalelo(
              comoPersonaDe(e),
              [
                (tx) => tx.comprobantes.crear(altaDe(e, { origen })),
                (tx) => tx.comprobantes.crear(altaDe(e, { origen })),
              ],
              aislamiento,
            )
          ).map(valor);
          const [a, b] = rs;
          expect([a?.creado, b?.creado].sort(), `ronda ${n}`).toEqual([false, true]);
          expect(a?.valor.id, `ronda ${n}`).toBe(b?.valor.id);
          expect((await filas(e)).comprobantes, `ronda ${n}`).toBe(1);
        }
      });
    }

    it("claves distintas a la vez no se pisan: entran todas, cada una con sus renglones", async () => {
      const e = await escenario();
      const altas = Array.from({ length: 6 }, () => altaDe(e));
      const rs = (
        await enParalelo(
          comoPersonaDe(e),
          altas.map((alta) => (tx: TxFacturacionDePrueba) => tx.comprobantes.crear(alta)),
        )
      ).map(valor);
      expect(rs.every((r) => r.creado)).toBe(true);
      expect(await filas(e)).toEqual({ comprobantes: 6, renglones: 6, desglose: 6 });
    });
  });

  // ===============================================================================================
  // La serie: dos reservas del mismo número
  // ===============================================================================================
  type MotivoDeReintento = "SERIE_OCUPADA" | "SERIE_CAMBIO" | "COMPROBANTE_CAMBIO";

  /** El trabajo de reserva: lo que hará el trabajo de validación (TXa) en una transacción. */
  const reservar =
    (id: ComprobanteId, e: Escenario, ahora: Date) =>
    async (tx: TxFacturacionDePrueba): Promise<Resultado<bigint | null, MotivoDeReintento>> => {
      const c = await tx.comprobantes.obtener(empresaId(e.empresa), id);
      if (c === null) throw new Error("no está");
      if (c.estado !== "PENDIENTE") return ok(null); // ya lo hizo otro intento: idempotente
      let serie = await tx.series.obtener(c.empresaId, c.puntoDeVentaId, c.tipo, c.ambiente);
      if (serie === null) {
        const nueva = iniciarSerie(
          {
            empresaId: c.empresaId,
            puntoDeVentaId: c.puntoDeVentaId,
            emisorId: c.emisorId,
            tipo: c.tipo,
          },
          0n,
        );
        if (!nueva.ok) throw new Error("serie inválida");
        serie = (await tx.series.crear(nueva.valor, c.ambiente)).valor;
      }
      const r = reservarNumero(serie, solicitudId(c.id), ahora);
      if (!r.ok) return err("SERIE_OCUPADA");
      if (r.valor.tipo !== "RESERVADA") return ok(r.valor.numero);
      const guardada = await tx.series.guardar({ ...r.valor.serie, ambiente: c.ambiente });
      if (guardada === null) return err("SERIE_CAMBIO");
      const movido = await tx.comprobantes.transicionar(c.empresaId, c.id, c.version, {
        a: "EN_VALIDACION",
        numeroReservado: r.valor.numero,
        fechaEmision: diaDe(ahora),
      });
      if (movido === null) return err("COMPROBANTE_CAMBIO");
      return ok(r.valor.numero);
    };

  /** El trabajo de cierre (TXb): cierra la serie y autoriza el comprobante que sigue EN_VALIDACION. */
  const cerrarYAutorizar =
    (id: ComprobanteId, e: Escenario, ahora: Date) =>
    async (tx: TxFacturacionDePrueba): Promise<Resultado<bigint | null, MotivoDeReintento>> => {
      const c = await tx.comprobantes.obtener(empresaId(e.empresa), id);
      if (c === null) throw new Error("no está");
      if (c.estado !== "EN_VALIDACION") return ok(null);
      const serie = await tx.series.obtener(c.empresaId, c.puntoDeVentaId, c.tipo, c.ambiente);
      if (serie === null) throw new Error("falta la serie");
      const cierre = cerrarSerie(serie, solicitudId(c.id), "AUTORIZADO");
      if (!cierre.ok) return err("SERIE_CAMBIO");
      const guardada = await tx.series.guardar({ ...cierre.valor.serie, ambiente: c.ambiente });
      if (guardada === null) return err("SERIE_CAMBIO");
      const autorizado = await tx.comprobantes.transicionar(c.empresaId, c.id, c.version, {
        a: "AUTORIZADO",
        cae: CAE_DE_PRUEBA,
        caeVence: fechaCivil("2026-10-22"),
        autorizadoEn: ahora,
        resueltoPor: "RESPUESTA",
      });
      if (autorizado === null) return err("COMPROBANTE_CAMBIO");
      return ok(autorizado.numero);
    };

  describe("numeración: dos reservas de la misma serie", () => {
    for (const aislamiento of AISLAMIENTOS) {
      it(`dos comprobantes reservan a la vez: uno obtiene el número 1 y el otro espera (nunca los dos) [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const e = await escenario();
          const [a, b] = [altaDe(e), altaDe(e)];
          for (const alta of [a, b]) {
            valor(
              await entorno.ejecutar(
                { contexto: comoPersonaDe(e) },
                exitoso((tx) => tx.comprobantes.crear(alta)),
              ),
            );
          }
          const rs = await enParalelo(
            comoSistemaDe(e),
            [reservar(a.id, e, AHORA), reservar(b.id, e, AHORA)],
            aislamiento,
          );
          const ganadores = rs.filter((r) => r.ok && r.valor !== null);
          const perdedores = rs.filter((r) => !r.ok);
          expect(ganadores, `ronda ${n}`).toHaveLength(1);
          expect(perdedores, `ronda ${n}`).toHaveLength(1);
          // El perdedor recibe un motivo con nombre (la serie está ocupada o cambió), nunca una excepción.
          expect(["SERIE_OCUPADA", "SERIE_CAMBIO", "COMPROBANTE_CAMBIO"]).toContain(
            (perdedores[0] as { error: string }).error,
          );
          const enValidacion = await consultar<{ id: string; numero_reservado: string }>(
            "select id, numero_reservado::text from comprobante where empresa_id = $1 and estado = 'EN_VALIDACION'",
            [e.empresa],
          );
          expect(enValidacion, `ronda ${n}`).toHaveLength(1);
          expect(enValidacion[0]?.numero_reservado).toBe("1");
          const serie = await consultar<{
            estado: string;
            solicitud_en_curso: string;
            numero_en_curso: string;
          }>(
            "select estado, solicitud_en_curso::text, numero_en_curso::text from serie_comprobante where punto_de_venta_id = $1",
            [e.pv],
          );
          expect(serie[0], `ronda ${n}`).toEqual({
            estado: "EN_CURSO",
            solicitud_en_curso: enValidacion[0]?.id,
            numero_en_curso: "1",
          });
          expect(
            await cuenta(
              "select count(*) as n from comprobante where empresa_id = $1 and estado = 'PENDIENTE'",
              [e.empresa],
            ),
          ).toBe(1);
        }
      });
    }

    it("la MISMA reserva dos veces a la vez (reintento del trabajo) da el mismo número y la serie avanza una sola vez", async () => {
      for (let n = 0; n < RONDAS; n++) {
        const e = await escenario();
        const alta = altaDe(e);
        valor(
          await entorno.ejecutar(
            { contexto: comoPersonaDe(e) },
            exitoso((tx) => tx.comprobantes.crear(alta)),
          ),
        );
        const rs = await enParalelo(comoSistemaDe(e), [
          reservar(alta.id, e, AHORA),
          reservar(alta.id, e, AHORA),
        ]);
        // Una reserva el número 1; la otra no hace nada (ya no está PENDIENTE) o ve el mismo número. Ninguna falla.
        expect(
          rs.every((r) => r.ok),
          `ronda ${n}: ${texto(rs)}`,
        ).toBe(true);
        expect(
          rs.flatMap((r) => (r.ok && r.valor !== null ? [r.valor] : [])).every((x) => x === 1n),
          `ronda ${n}`,
        ).toBe(true);
        const filas = await consultar<{ ultimo: string; en_curso: string }>(
          "select ultimo_numero::text as ultimo, numero_en_curso::text as en_curso from serie_comprobante where punto_de_venta_id = $1",
          [e.pv],
        );
        expect(filas, `ronda ${n}`).toEqual([{ ultimo: "0", en_curso: "1" }]);
        expect(
          await cuenta("select envios as n from comprobante where id = $1", [alta.id]),
          `ronda ${n}`,
        ).toBe(1);
      }
    });

    it("8 trabajadores con varios comprobantes cada uno sobre la MISMA serie: los números autorizados son 1…N, sin repetidos ni huecos", async () => {
      const e = await escenario();
      const TRABAJADORES = 8;
      const POR_TRABAJADOR = 4;
      const ids: ComprobanteId[][] = [];
      for (let w = 0; w < TRABAJADORES; w++) {
        const propios: ComprobanteId[] = [];
        for (let i = 0; i < POR_TRABAJADOR; i++) {
          const alta = altaDe(e);
          valor(
            await entorno.ejecutar(
              { contexto: comoPersonaDe(e) },
              exitoso((tx) => tx.comprobantes.crear(alta)),
            ),
          );
          propios.push(alta.id);
        }
        ids.push(propios);
      }
      /** Repite el trabajo mientras pierda la carrera por la serie; cualquier otro error es un fallo. */
      const hastaQueSalga = async (
        trabajo: (
          tx: TxFacturacionDePrueba,
        ) => Promise<Resultado<bigint | null, MotivoDeReintento>>,
      ) => {
        for (let intento = 0; intento < 4000; intento++) {
          const r = await entorno.ejecutar({ contexto: comoSistemaDe(e) }, trabajo);
          if (r.ok) return;
          if (typeof r.error !== "string") {
            throw new Error(`error inesperado: ${JSON.stringify(r.error)}`);
          }
          await esperar(2 + Math.floor(Math.random() * 6));
        }
        throw new Error("el trabajador no consiguió la serie");
      };
      await Promise.all(
        ids.map(async (propios) => {
          for (const id of propios) {
            await hastaQueSalga(reservar(id, e, AHORA));
            await hastaQueSalga(cerrarYAutorizar(id, e, AHORA));
          }
        }),
      );
      const numeros = (
        await consultar<{ numero: string }>(
          "select numero::text from comprobante where empresa_id = $1 and estado = 'AUTORIZADO'",
          [e.empresa],
        )
      ).map((f) => BigInt(f.numero));
      expect(numeros).toHaveLength(TRABAJADORES * POR_TRABAJADOR);
      expect(verificarSecuencia(0n, numeros)).toEqual(ok(BigInt(TRABAJADORES * POR_TRABAJADOR)));
      expect(
        (
          await consultar<{ estado: string; ultimo: string }>(
            "select estado, ultimo_numero::text as ultimo from serie_comprobante where punto_de_venta_id = $1",
            [e.pv],
          )
        )[0],
      ).toEqual({ estado: "LIBRE", ultimo: String(TRABAJADORES * POR_TRABAJADOR) });
      expect(
        await cuenta(
          "select count(*) as n from comprobante where empresa_id = $1 and estado <> 'AUTORIZADO'",
          [e.empresa],
        ),
      ).toBe(0);
    });
  });

  // ===============================================================================================
  // Dos transiciones del mismo comprobante: una gana
  // ===============================================================================================
  describe("transiciones concurrentes del mismo comprobante", () => {
    for (const aislamiento of AISLAMIENTOS) {
      it(`dos descartes a la vez: uno gana y el otro recibe null (versión vieja); el comprobante se descarta una sola vez [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const e = await escenario();
          const alta = altaDe(e);
          valor(
            await entorno.ejecutar(
              { contexto: comoPersonaDe(e) },
              exitoso((tx) => tx.comprobantes.crear(alta)),
            ),
          );
          const descartar = (motivo: string) =>
            exitoso((tx: TxFacturacionDePrueba) =>
              tx.comprobantes.transicionar(empresaId(e.empresa), alta.id, 1, {
                a: "DESCARTADO",
                motivo,
              }),
            );
          const rs = (
            await enParalelo(comoPersonaDe(e), [descartar("uno"), descartar("dos")], aislamiento)
          ).map(valor);
          expect(
            rs.filter((r) => r !== null),
            `ronda ${n}`,
          ).toHaveLength(1);
          expect(
            rs.filter((r) => r === null),
            `ronda ${n}`,
          ).toHaveLength(1);
          const fila = (
            await consultar<{ estado: string; version: number; motivo_descarte: string }>(
              "select estado, version, motivo_descarte from comprobante where id = $1",
              [alta.id],
            )
          )[0];
          expect(fila?.estado, `ronda ${n}`).toBe("DESCARTADO");
          expect(fila?.version, `ronda ${n}`).toBe(2);
          expect(["uno", "dos"], `ronda ${n}`).toContain(fila?.motivo_descarte);
        }
      });

      it(`descartar contra validar el mismo comprobante: o queda DESCARTADO sin número, o EN_VALIDACION con su serie en curso; nunca las dos cosas [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const e = await escenario();
          const alta = altaDe(e);
          valor(
            await entorno.ejecutar(
              { contexto: comoPersonaDe(e) },
              exitoso((tx) => tx.comprobantes.crear(alta)),
            ),
          );
          const descartar = async (
            tx: TxFacturacionDePrueba,
          ): Promise<Resultado<bigint | null, MotivoDeReintento>> => {
            const r = await tx.comprobantes.transicionar(empresaId(e.empresa), alta.id, 1, {
              a: "DESCARTADO",
              motivo: "No va",
            });
            return r === null ? err("COMPROBANTE_CAMBIO") : ok(null);
          };
          const rs = await enParalelo(
            comoPersonaDe(e),
            [reservar(alta.id, e, AHORA), descartar],
            aislamiento,
          );
          const comprobante = (
            await consultar<{ estado: string; numero_reservado: string | null }>(
              "select estado, numero_reservado::text from comprobante where id = $1",
              [alta.id],
            )
          )[0];
          const serie = (
            await consultar<{ estado: string; solicitud_en_curso: string | null }>(
              "select estado, solicitud_en_curso::text from serie_comprobante where punto_de_venta_id = $1",
              [e.pv],
            )
          )[0];
          // Ningún error crudo de la base: cada uno terminó bien o con un motivo con nombre.
          expect(
            rs.every((r) => r.ok || typeof r.error === "string"),
            `ronda ${n}: ${texto(rs)}`,
          ).toBe(true);
          if (comprobante?.estado === "DESCARTADO") {
            expect(comprobante.numero_reservado, `ronda ${n}`).toBeNull();
            // El que reservaba se deshizo entero: ni siquiera quedó una serie creada que apunte al comprobante.
            expect(serie?.estado ?? "LIBRE", `ronda ${n}`).not.toBe("EN_CURSO");
          } else {
            expect(comprobante?.estado, `ronda ${n}`).toBe("EN_VALIDACION");
            expect(comprobante?.numero_reservado, `ronda ${n}`).toBe("1");
            expect(serie, `ronda ${n}`).toEqual({
              estado: "EN_CURSO",
              solicitud_en_curso: alta.id,
            });
          }
        }
      });

      it(`autorizar contra dejar INCIERTO el mismo comprobante: gana uno y la serie queda coherente con el ganador [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const e = await escenario();
          const alta = altaDe(e);
          valor(
            await entorno.ejecutar(
              { contexto: comoPersonaDe(e) },
              exitoso((tx) => tx.comprobantes.crear(alta)),
            ),
          );
          valor(
            await entorno.ejecutar({ contexto: comoSistemaDe(e) }, reservar(alta.id, e, AHORA)),
          );
          const incierto = async (
            tx: TxFacturacionDePrueba,
          ): Promise<Resultado<bigint | null, MotivoDeReintento>> => {
            const c = await tx.comprobantes.obtener(empresaId(e.empresa), alta.id);
            if (c === null) throw new Error("no está");
            // Como el caso de uso: si otro ya lo resolvió, no hay nada que hacer.
            if (c.estado !== "EN_VALIDACION") return ok(null);
            const r = await tx.comprobantes.transicionar(c.empresaId, c.id, c.version, {
              a: "INCIERTO",
            });
            return r === null ? err("COMPROBANTE_CAMBIO") : ok(null);
          };
          const rs = await enParalelo(
            comoSistemaDe(e),
            [cerrarYAutorizar(alta.id, e, AHORA), incierto],
            aislamiento,
          );
          const comprobante = (
            await consultar<{ estado: string }>("select estado from comprobante where id = $1", [
              alta.id,
            ])
          )[0];
          const serie = (
            await consultar<{ estado: string; ultimo: string }>(
              "select estado, ultimo_numero::text as ultimo from serie_comprobante where punto_de_venta_id = $1",
              [e.pv],
            )
          )[0];
          expect(
            rs.every((r) => r.ok || typeof r.error === "string"),
            `ronda ${n}: ${texto(rs)}`,
          ).toBe(true);
          if (comprobante?.estado === "AUTORIZADO")
            expect(serie, `ronda ${n}`).toEqual({ estado: "LIBRE", ultimo: "1" });
          else {
            expect(comprobante?.estado, `ronda ${n}`).toBe("INCIERTO");
            expect(serie, `ronda ${n}`).toEqual({ estado: "EN_CURSO", ultimo: "0" });
          }
        }
      });
    }
  });

  // ===============================================================================================
  // Certificados, accesos, intentos y punto de venta
  // ===============================================================================================
  describe("certificados, accesos, intentos y ambiente", () => {
    for (const aislamiento of AISLAMIENTOS) {
      it(`dos cargas de certificado para el mismo emisor y ambiente: queda UN vigente y el otro reemplazado, sin errores crudos [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const e = await escenario();
          const [uno, dos] = [pedidoDe(e), pedidoDe(e)];
          for (const p of [uno, dos]) {
            valor(
              await entorno.ejecutar(
                { contexto: comoPersonaDe(e) },
                exitoso((tx) => tx.certificados.crearPedido(p)),
              ),
            );
          }
          const cargar = (id: typeof uno.id) =>
            exitoso((tx: TxFacturacionDePrueba) =>
              tx.certificados.activar(empresaId(e.empresa), id, 1, cargaDe()),
            );
          const rs = (
            await enParalelo(comoPersonaDe(e), [cargar(uno.id), cargar(dos.id)], aislamiento)
          ).map(valor);
          expect(
            rs.every((r) => r !== null),
            `ronda ${n}`,
          ).toBe(true);
          const estados = (
            await consultar<{ estado: string }>(
              "select estado from certificado_arca where empresa_id = $1 order by estado",
              [e.empresa],
            )
          ).map((f) => f.estado);
          expect(estados, `ronda ${n}`).toEqual(["REEMPLAZADO", "VIGENTE"]);
          // Exactamente una de las dos cargas reemplazó a la otra.
          expect(
            rs.filter((r) => r?.reemplazado !== null),
            `ronda ${n}`,
          ).toHaveLength(1);
        }
      });

      it(`dos pedidos de certificado con el mismo id a la vez: uno lo crea, el otro recibe el mismo [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const e = await escenario();
          const pedido = pedidoDe(e);
          const alta = exitoso((tx: TxFacturacionDePrueba) => tx.certificados.crearPedido(pedido));
          const rs = (await enParalelo(comoPersonaDe(e), [alta, alta], aislamiento))
            .map(valor)
            .map(valor);
          expect(rs.map((r) => r.creado).sort(), `ronda ${n}`).toEqual([false, true]);
          expect(rs[0]?.valor, `ronda ${n}`).toEqual(rs[1]?.valor);
        }
      });

      it(`dos registros del mismo intento a la vez: uno lo guarda, el otro recibe el mismo [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const e = await escenario();
          const comprobante = altaDe(e);
          valor(
            await entorno.ejecutar(
              { contexto: comoPersonaDe(e) },
              exitoso((tx) => tx.comprobantes.crear(comprobante)),
            ),
          );
          const intento = intentoDe(e, comprobante.id);
          const registrar = exitoso((tx: TxFacturacionDePrueba) => tx.intentos.registrar(intento));
          const rs = (await enParalelo(comoSistemaDe(e), [registrar, registrar], aislamiento))
            .map(valor)
            .map(valor);
          expect(rs.map((r) => r.creado).sort(), `ronda ${n}`).toEqual([false, true]);
          expect(
            await cuenta("select count(*) as n from intento_arca where empresa_id = $1", [
              e.empresa,
            ]),
          ).toBe(1);
        }
      });

      it(`dos pedidos de renovación de la credencial a la vez: UNA sola consigue la renovación (una sola llamada a ARCA) [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const e = await escenario();
          const pedido = pedidoDe(e);
          valor(
            await entorno.ejecutar(
              { contexto: comoPersonaDe(e) },
              exitoso((tx) => tx.certificados.crearPedido(pedido)),
            ),
          );
          valor(
            await entorno.ejecutar(
              { contexto: comoPersonaDe(e) },
              exitoso((tx) =>
                tx.certificados.activar(empresaId(e.empresa), pedido.id, 1, cargaDe()),
              ),
            ),
          );
          valor(
            await entorno.ejecutar(
              { contexto: comoSistemaDe(e) },
              exitoso((tx) => tx.accesos.asegurar(empresaId(e.empresa), pedido.id, "wsfe")),
            ),
          );
          const tomar = exitoso((tx: TxFacturacionDePrueba) =>
            tx.accesos.tomarRenovacion(
              empresaId(e.empresa),
              pedido.id,
              "wsfe",
              AHORA,
              new Date(AHORA.getTime() + 60_000),
            ),
          );
          const rs = (await enParalelo(comoSistemaDe(e), [tomar, tomar, tomar], aislamiento)).map(
            valor,
          );
          expect(
            rs.filter((x) => x),
            `ronda ${n}`,
          ).toHaveLength(1);
        }
      });

      it(`dos cambios de ambiente del mismo punto de venta a la vez: queda en PRODUCCION, con la versión subida una sola vez, y las dos reciben el punto de venta [${aislamiento}]`, async () => {
        for (let n = 0; n < RONDAS; n++) {
          const e = await escenario();
          const antes = (
            await consultar<{ version: number }>(
              "select version from punto_de_venta where id = $1",
              [e.pv],
            )
          )[0]?.version as number;
          const cambiar = exitoso((tx: TxFacturacionDePrueba) =>
            tx.puntosDeVenta.cambiarAmbiente(
              empresaId(e.empresa),
              puntoDeVentaId(e.pv),
              "PRODUCCION",
              antes,
            ),
          );
          const rs = (await enParalelo(comoPersonaDe(e), [cambiar, cambiar], aislamiento)).map(
            valor,
          );
          // Con la misma versión leída: una gana; la otra ve que ya estaba (serializable) o recibe null (read committed).
          expect(rs.filter((r) => r !== null).length, `ronda ${n}`).toBeGreaterThanOrEqual(1);
          const fila = (
            await consultar<{ ambiente: string; version: number }>(
              "select ambiente, version from punto_de_venta where id = $1",
              [e.pv],
            )
          )[0];
          expect(fila, `ronda ${n}`).toEqual({ ambiente: "PRODUCCION", version: antes + 1 });
        }
      });
    }
  });
});
