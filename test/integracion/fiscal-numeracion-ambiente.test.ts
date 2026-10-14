import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  cerrarEnTx,
  resincronizarEnTx,
  type EntradaDeResincronizarSerie,
} from "../../src/modulos/fiscal/casos-de-uso/numeracion-en-tx";
import { importesParaArca } from "../../src/modulos/fiscal/dominio/importes-para-arca";
import { reconciliarComprobante } from "../../src/modulos/fiscal/dominio/reconciliacion-de-comprobante";
import {
  emisorId,
  puntoDeVentaId,
  solicitudId,
  type Ambiente,
  type ResultadoDeAutorizacionArca,
  type SolicitudDeAutorizacion,
} from "../../src/modulos/fiscal/publico";
import { empresaId } from "../../src/primitivas/identificadores/marca";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import {
  consumidorFinal,
  contextoDeEmision,
  facturaArmada,
  fecha,
  renglon,
} from "../utilidades/facturacion";
import { armarNumerarParaPruebas } from "../utilidades/numerar-para-pruebas";
import { crearBarrera, crearBaseAparte } from "./entorno";
import { crearSerie, usarSerie } from "./fiscal-apoyo";
import {
  casosDeNumeracion,
  crearEntornoDeNumeracion,
  crearEscenario,
  entradaDe,
  type Escenario,
} from "./fiscal-numeracion-apoyo";
import { nuevoId } from "./fiscal-persistencia-apoyo";

/**
 * H7 facturación, tramo F4, contra una base real: la numeración con AMBIENTE (la serie es de un punto
 * de venta, un tipo y un ambiente), la salida de `BLOQUEADA` (`resincronizarEnTx`, QF1), el desenlace
 * `NO_ENVIADO` y el tope de ocho dígitos de ARCA. Las pruebas de T6 (reservar, cerrar, reconciliar,
 * concurrencia) siguen en `fiscal-numeracion*.test.ts`; acá va lo que F4 agrega, con el rol limitado de
 * la aplicación y, donde importa, concurrencia real con barrera y `Promise.all`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

const RONDAS = 5;
const T0 = new Date("2026-10-12T12:00:00Z");
const despues = (minutos: number) => new Date(T0.getTime() + minutos * 60_000);

describe.skipIf(base === null)("fiscal F4: ambiente, resincronizar y no enviado", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeNumeracion>;
  /** Mientras haya una barrera, toda transacción espera en ella al leer la serie por primera vez. */
  let barrera: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeNumeracion(propia.base, 16, (tx) => ({
      ...tx,
      series: {
        ...tx.series,
        obtener: async (...args) => {
          const serie = await tx.series.obtener(...args);
          if (barrera !== null) await barrera();
          return serie;
        },
      },
    }));
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
    (await dueno.query<T>(texto, p)).rows;
  /** Las series del punto de venta, de todos los ambientes, para comparar de un vistazo. */
  const series = async (e: Escenario, tipo = "FACTURA_B") =>
    (
      await filas<{ ambiente: string; estado: string; ultimo: string; en_curso: string | null }>(
        `select ambiente, estado, ultimo_numero::text as ultimo, numero_en_curso::text as en_curso
           from serie_comprobante where punto_de_venta_id = $1 and tipo_comprobante = $2
          order by ambiente`,
        [e.puntoDeVenta, tipo],
      )
    ).map((f) => [f.ambiente, f.estado, f.ultimo, f.en_curso]);
  const auditoria = (e: Escenario, accion: string) =>
    filas<{
      entidad_id: string;
      actor_persona_id: string | null;
      antes: unknown;
      despues: unknown;
    }>(
      `select entidad_id, actor_persona_id, antes, despues from auditoria_empresa
        where empresa_id = $1 and accion = $2 order by id`,
      [e.mundo.empresa, accion],
    );
  const escenario = (opciones: Parameters<typeof crearEscenario>[1] = {}) =>
    crearEscenario(dueno, { conSerie: true, ...opciones });
  const cuitDe = (e: Escenario) => e.mundo.cuit as never;
  const pasarA = (e: Escenario, ambiente: Ambiente) =>
    dueno.query("update punto_de_venta set ambiente = $2 where id = $1", [
      e.puntoDeVenta,
      ambiente,
    ]);

  /** `n` llamadas a la vez; con barrera, todas leen la serie antes de que cualquiera escriba. */
  async function enParalelo<T>(n: number, llamada: (i: number) => Promise<T>): Promise<T[]> {
    barrera = crearBarrera(n);
    try {
      return await Promise.all(Array.from({ length: n }, (_, i) => llamada(i)));
    } finally {
      barrera = null;
    }
  }
  async function juntas<A, B>(a: () => Promise<A>, b: () => Promise<B>): Promise<[A, B]> {
    barrera = crearBarrera(2);
    try {
      return await Promise.all([a(), b()]);
    } finally {
      barrera = null;
    }
  }

  // ===============================================================================================
  describe("ambiente: la serie es de un punto de venta, un tipo y un ambiente", () => {
    it("emitir en homologación no cambia la serie de producción del mismo punto de venta; cada ambiente numera desde su ARCA", async () => {
      const e = await escenario({ conSerie: false });
      const homologacion = new EmisionFalsa({ ultimoInicial: 7n });
      const deHomologacion = casosDeNumeracion(entorno, homologacion);
      const r1 = await deHomologacion.numerarComprobante(e.como(T0), entradaDe(e));
      const r2 = await deHomologacion.numerarComprobante(e.como(T0), entradaDe(e));
      expect([r1.ok && r1.valor.numero, r2.ok && r2.valor.numero]).toEqual([8n, 9n]);
      expect(await series(e)).toEqual([["HOMOLOGACION", "LIBRE", "9", null]]);

      // El punto de venta pasa a producción: otro ARCA, con otra numeración.
      await pasarA(e, "PRODUCCION");
      const produccion = new EmisionFalsa({ ultimoInicial: 500n });
      const deProduccion = casosDeNumeracion(entorno, produccion);
      const r3 = await deProduccion.numerarComprobante(
        e.como(T0),
        entradaDe(e, undefined, "FACTURA_B", "PRODUCCION"),
      );
      expect(r3.ok && r3.valor.numero).toBe(501n);
      expect(await series(e)).toEqual([
        ["HOMOLOGACION", "LIBRE", "9", null],
        ["PRODUCCION", "LIBRE", "501", null],
      ]);
      // ARCA de homologación no se enteró de nada de producción, y al revés.
      expect(homologacion.pedidos.map((p) => p.numero)).toEqual([8n, 9n]);
      expect(produccion.pedidos.map((p) => p.numero)).toEqual([501n]);

      // Un comprobante de homologación rezagado ya no puede reservar: no toca ninguna serie.
      expect(await deHomologacion.reservarNumeroDeComprobante(e.como(T0), entradaDe(e))).toEqual(
        err("AMBIENTE_DISTINTO_DEL_PUNTO_DE_VENTA"),
      );
      expect(await series(e)).toEqual([
        ["HOMOLOGACION", "LIBRE", "9", null],
        ["PRODUCCION", "LIBRE", "501", null],
      ]);
      // La auditoría distingue los dos ambientes aunque sean el mismo punto de venta y el mismo tipo.
      const entidades = (await auditoria(e, "NUMERO_DE_COMPROBANTE_AUTORIZADO")).map(
        (a) => a.entidad_id,
      );
      expect(entidades).toEqual([
        `${e.puntoDeVenta}:FACTURA_B:HOMOLOGACION`,
        `${e.puntoDeVenta}:FACTURA_B:HOMOLOGACION`,
        `${e.puntoDeVenta}:FACTURA_B:PRODUCCION`,
      ]);
    });

    it("cerrar y reconciliar leen la serie de SU ambiente aunque el punto de venta ya esté en otro", async () => {
      const e = await escenario({ conSerie: false });
      const arca = new EmisionFalsa();
      const c = casosDeNumeracion(entorno, arca);
      const entrada = entradaDe(e);
      const reserva = await c.reservarNumeroDeComprobante(e.como(T0), entrada);
      expect(reserva.ok && reserva.valor.numero).toBe(1n);
      const autorizado: ResultadoDeAutorizacionArca = {
        tipo: "AUTORIZADO",
        codigo: "CAE-1",
        vence: fecha("2099-12-31"),
        fecha: fecha("2026-10-13"),
        observaciones: [],
      };
      const cierre = { ...entrada, numero: 1n, resultado: autorizado };
      expect(await c.cerrarReservaDeNumero(e.como(T0), cierre)).toEqual(
        ok({ desenlace: "AUTORIZADO", numero: 1n, yaCerrada: false }),
      );
      await pasarA(e, "PRODUCCION");
      // Repetir el cierre de homologación mira la serie de homologación: sigue siendo el mismo éxito.
      expect(await c.cerrarReservaDeNumero(e.como(despues(1)), cierre)).toEqual(
        ok({ desenlace: "AUTORIZADO", numero: 1n, yaCerrada: true }),
      );
      // Y la de producción no existe todavía.
      expect(
        await c.cerrarReservaDeNumero(e.como(despues(1)), { ...cierre, ambiente: "PRODUCCION" }),
      ).toEqual(err("SERIE_NO_ENCONTRADA"));
      expect(
        await c.reconciliarSerie(e.sistema(despues(10)), { ...entrada, ambiente: "PRODUCCION" }),
      ).toEqual(err("SERIE_NO_ENCONTRADA"));
      expect(await series(e)).toEqual([["HOMOLOGACION", "LIBRE", "1", null]]);
    });

    it("el ambiente de la serie está en su identidad: la base no deja crearla en otro que el de su punto de venta", async () => {
      const e = await escenario({ conSerie: false });
      // Sin serie, ARCA de producción no se pregunta: el punto de venta está en homologación.
      const arca = new EmisionFalsa({ ultimoInicial: 3n });
      let consultas = 0;
      const original = arca.ultimoAutorizado.bind(arca);
      arca.ultimoAutorizado = (...args) => {
        consultas += 1;
        return original(...args);
      };
      const c = casosDeNumeracion(entorno, arca);
      expect(
        await c.reservarNumeroDeComprobante(
          e.como(T0),
          entradaDe(e, undefined, "FACTURA_B", "PRODUCCION"),
        ),
      ).toEqual(err("AMBIENTE_DISTINTO_DEL_PUNTO_DE_VENTA"));
      expect(consultas).toBe(0);
      expect(await series(e)).toEqual([]);
      expect(await auditoria(e, "SERIE_DE_COMPROBANTES_CREADA")).toEqual([]);
    });

    it("reservar y cambiar el ambiente del punto de venta a la vez: gana uno de los dos, nunca queda una reserva en un ambiente que el punto de venta ya dejó", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await escenario();
        const c = casosDeNumeracion(entorno, new EmisionFalsa());
        // El cambio lo hace el dueño de la base en su propia transacción SERIALIZABLE (como lo haría la
        // aplicación): el disparador de 0009 lo frena si la reserva llegó antes, y la reserva lo nota si el
        // cambio llegó antes.
        const cambiar = async (): Promise<boolean> => {
          await dueno.query("begin isolation level serializable");
          try {
            await pasarA(e, "PRODUCCION");
            await dueno.query("commit");
            return true;
          } catch {
            await dueno.query("rollback");
            return false;
          }
        };
        const [reserva, cambio] = await Promise.all([
          c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e)),
          cambiar(),
        ]);
        const ambiente = (
          await filas<{ ambiente: string }>("select ambiente from punto_de_venta where id = $1", [
            e.puntoDeVenta,
          ])
        )[0]?.ambiente;
        const enCurso = (await series(e)).filter((s) => s[1] === "EN_CURSO");
        // Lo que jamás puede pasar: una serie EN_CURSO en un ambiente que el punto de venta ya dejó.
        expect(
          ambiente === "PRODUCCION" && enCurso.length > 0,
          `ronda ${ronda}: serie en curso en homologación con el punto de venta en producción`,
        ).toBe(false);
        if (reserva.ok) {
          expect(enCurso, `ronda ${ronda}`).toEqual([["HOMOLOGACION", "EN_CURSO", "0", "1"]]);
          expect(ambiente, `ronda ${ronda}`).toBe("HOMOLOGACION");
          expect(cambio, `ronda ${ronda}`).toBe(false);
        } else {
          // Ganó el cambio: la reserva ve un punto de venta de otro ambiente y no toca nada.
          expect(reserva.error, `ronda ${ronda}`).toBe("AMBIENTE_DISTINTO_DEL_PUNTO_DE_VENTA");
          expect(ambiente, `ronda ${ronda}`).toBe("PRODUCCION");
          expect(enCurso, `ronda ${ronda}`).toEqual([]);
          expect(cambio, `ronda ${ronda}`).toBe(true);
        }
      }
    });

    it("la serie de producción, recién nacida, soporta reservas simultáneas: una gana, las otras SERIE_OCUPADA, sin tocar la de homologación", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await escenario({ ultimo: 4 });
        await pasarA(e, "PRODUCCION");
        const arca = new EmisionFalsa({ ultimoInicial: 100n });
        const c = casosDeNumeracion(entorno, arca);
        const rs = await enParalelo(4, () =>
          c.reservarNumeroDeComprobante(
            e.como(T0),
            entradaDe(e, solicitudId(nuevoId()), "FACTURA_B", "PRODUCCION"),
          ),
        );
        expect(
          rs.filter((r) => r.ok).map((r) => r.ok && r.valor.numero),
          `ronda ${ronda}`,
        ).toEqual([101n]);
        expect(
          rs.filter((r) => !r.ok).map((r) => !r.ok && r.error),
          `ronda ${ronda}`,
        ).toEqual(["SERIE_OCUPADA", "SERIE_OCUPADA", "SERIE_OCUPADA"]);
        expect(await series(e), `ronda ${ronda}`).toEqual([
          ["HOMOLOGACION", "LIBRE", "4", null],
          ["PRODUCCION", "EN_CURSO", "100", "101"],
        ]);
        expect(await auditoria(e, "SERIE_DE_COMPROBANTES_CREADA"), `ronda ${ronda}`).toHaveLength(
          1,
        );
      }
    });
  });

  // ===============================================================================================
  describe("tope: ARCA no admite números de más de ocho dígitos", () => {
    it("el 99 999 999 es el último que se reserva; después SERIE_AGOTADA sin escribir nada", async () => {
      const e = await escenario({ ultimo: 99_999_997 });
      const arca = new EmisionFalsa({ ultimoInicial: 99_999_997n });
      const c = casosDeNumeracion(entorno, arca);
      const r1 = await c.numerarComprobante(e.como(T0), entradaDe(e));
      const r2 = await c.numerarComprobante(e.como(T0), entradaDe(e));
      expect([r1.ok && r1.valor.numero, r2.ok && r2.valor.numero]).toEqual([
        99_999_998n,
        99_999_999n,
      ]);
      const antes = await series(e);
      expect(antes).toEqual([["HOMOLOGACION", "LIBRE", "99999999", null]]);
      expect(await c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e))).toEqual(
        err("SERIE_AGOTADA"),
      );
      expect(await series(e)).toEqual(antes);
      expect(await auditoria(e, "NUMERO_DE_COMPROBANTE_RESERVADO")).toHaveLength(2);
    });
  });

  // ===============================================================================================
  describe("no enviado: el pedido seguro no salió", () => {
    it("libera el número sin avanzar, con su propia auditoría, y el reintento usa el mismo número", async () => {
      const e = await escenario();
      const arca = new EmisionFalsa();
      arca.programar("NO_ENVIADO", "AUTORIZA");
      const c = casosDeNumeracion(entorno, arca);
      const primera = await c.numerarComprobante(e.como(T0), entradaDe(e));
      expect(primera).toEqual(
        ok({ numero: 1n, resultado: { tipo: "NO_ENVIADO", motivo: "no salió (falso)" } }),
      );
      expect(await series(e)).toEqual([["HOMOLOGACION", "LIBRE", "0", null]]);
      const liberadas = await auditoria(e, "NUMERO_DE_COMPROBANTE_LIBERADO");
      expect(liberadas).toHaveLength(1);
      expect(liberadas[0]?.despues).toMatchObject({
        estado: "LIBRE",
        ambiente: "HOMOLOGACION",
        ultimoNumero: "0",
        numero: "1",
      });
      const segunda = await c.numerarComprobante(e.como(T0), entradaDe(e));
      expect(segunda.ok && segunda.valor.numero).toBe(1n);
      expect(await series(e)).toEqual([["HOMOLOGACION", "LIBRE", "1", null]]);
    });

    it("cerrar dos veces como no enviado es el mismo éxito sin escribir; si otro ya usó ese número, SOLICITUD_NO_VIGENTE", async () => {
      const e = await escenario();
      const arca = new EmisionFalsa();
      const c = casosDeNumeracion(entorno, arca);
      const entrada = entradaDe(e);
      await c.reservarNumeroDeComprobante(e.como(T0), entrada);
      const cierre = {
        ...entrada,
        numero: 1n,
        resultado: { tipo: "NO_ENVIADO", motivo: "sin conexión" } as const,
      };
      expect(await c.cerrarReservaDeNumero(e.como(T0), cierre)).toEqual(
        ok({ desenlace: "NO_ENVIADO", numero: 1n, yaCerrada: false }),
      );
      expect(await c.cerrarReservaDeNumero(e.como(despues(1)), cierre)).toEqual(
        ok({ desenlace: "NO_ENVIADO", numero: 1n, yaCerrada: true }),
      );
      expect(await auditoria(e, "NUMERO_DE_COMPROBANTE_LIBERADO")).toHaveLength(1);
      // Otra solicitud toma el mismo número y lo autoriza: el «no salió» viejo ya no puede ser cierto.
      await c.numerarComprobante(e.como(despues(2)), entradaDe(e));
      expect(await c.cerrarReservaDeNumero(e.como(despues(3)), cierre)).toEqual(
        err("SOLICITUD_NO_VIGENTE"),
      );
    });

    it("dos cierres como no enviado a la vez liberan UNA vez y las dos reciben el éxito", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await escenario();
        const c = casosDeNumeracion(entorno, new EmisionFalsa());
        const entrada = entradaDe(e);
        await c.reservarNumeroDeComprobante(e.como(T0), entrada);
        const rs = await enParalelo(2, () =>
          c.cerrarReservaDeNumero(e.como(T0), {
            ...entrada,
            numero: 1n,
            resultado: { tipo: "NO_ENVIADO", motivo: "sin conexión" },
          }),
        );
        expect(
          rs.map((r) => r.ok),
          `ronda ${ronda}`,
        ).toEqual([true, true]);
        expect(
          rs.filter((r) => r.ok && !r.valor.yaCerrada),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(await series(e), `ronda ${ronda}`).toEqual([["HOMOLOGACION", "LIBRE", "0", null]]);
        expect(await auditoria(e, "NUMERO_DE_COMPROBANTE_LIBERADO"), `ronda ${ronda}`).toHaveLength(
          1,
        );
      }
    });
  });

  // ===============================================================================================
  describe("resincronizar: la salida de BLOQUEADA (QF1)", () => {
    /** Una serie BLOQUEADA con el último número en `ultimo`, y su ARCA con el suyo. */
    async function bloqueada(ultimo: number, deArca: bigint) {
      const e = await escenario({ conSerie: false });
      await crearSerie(dueno, e.mundo.empresa, e.puntoDeVenta, e.mundo.emisor, "FACTURA_B", ultimo);
      await usarSerie(dueno, e.puntoDeVenta, "BLOQUEADA");
      const arca = new EmisionFalsa();
      arca.fijarUltimo({ cuit: cuitDe(e), numero: 1 }, "FACTURA_B", deArca);
      return { e, arca, c: casosDeNumeracion(entorno, arca) };
    }
    const entrada = (
      e: Escenario,
      cambios: Partial<EntradaDeResincronizarSerie> = {},
    ): EntradaDeResincronizarSerie => ({
      puntoDeVentaId: puntoDeVentaId(e.puntoDeVenta),
      tipo: "FACTURA_B",
      ambiente: "HOMOLOGACION",
      ultimoVistoEnArca: 9n,
      ultimoDeArca: 9n,
      motivo: "otro sistema usó el punto de venta",
      ...cambios,
    });
    const resincronizar = (e: Escenario, cambios: Partial<EntradaDeResincronizarSerie> = {}) =>
      entorno.ejecutar({ contexto: e.como(T0) }, (tx) =>
        resincronizarEnTx(tx, e.como(T0), entrada(e, cambios)),
      );

    it("vuelve a LIBRE con el último de ARCA, audita el antes y el después con el motivo, y se vuelve a numerar sin romper la secuencia de ARCA", async () => {
      const { e, c } = await bloqueada(4, 9n);
      expect(await series(e)).toEqual([["HOMOLOGACION", "BLOQUEADA", "4", null]]);
      // Mientras está bloqueada no se reserva.
      expect(await c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e))).toEqual(
        err("SERIE_BLOQUEADA"),
      );
      expect(await resincronizar(e)).toEqual(ok({ ultimoNumero: 9n }));
      expect(await series(e)).toEqual([["HOMOLOGACION", "LIBRE", "9", null]]);
      const [registro, ...resto] = await auditoria(e, "SERIE_RESINCRONIZADA");
      expect(resto).toEqual([]);
      expect(registro).toMatchObject({
        entidad_id: `${e.puntoDeVenta}:FACTURA_B:HOMOLOGACION`,
        actor_persona_id: e.persona,
        antes: {
          estado: "BLOQUEADA",
          ambiente: "HOMOLOGACION",
          ultimoNumero: "4",
          motivoBloqueo: "desfase de prueba",
        },
        despues: {
          estado: "LIBRE",
          ambiente: "HOMOLOGACION",
          ultimoNumero: "9",
          ultimoVistoEnArca: "9",
          motivo: "otro sistema usó el punto de venta",
        },
      });
      // El siguiente comprobante es el 10 y ARCA (que exige secuencia) lo acepta.
      const siguiente = await c.numerarComprobante(e.como(T0), entradaDe(e));
      expect(siguiente.ok && siguiente.valor).toMatchObject({
        numero: 10n,
        resultado: { tipo: "AUTORIZADO" },
      });
    });

    it("repetirla encuentra la serie ya libre: SERIE_NO_BLOQUEADA, sin escribir ni auditar de nuevo", async () => {
      const { e } = await bloqueada(4, 9n);
      await resincronizar(e);
      const antes = await series(e);
      expect(await resincronizar(e)).toEqual(err("SERIE_NO_BLOQUEADA"));
      expect(await series(e)).toEqual(antes);
      expect(await auditoria(e, "SERIE_RESINCRONIZADA")).toHaveLength(1);
    });

    it("nunca hacia atrás, y nunca con un dato viejo: no escribe ni audita nada", async () => {
      const { e } = await bloqueada(4, 9n);
      expect(await resincronizar(e, { ultimoVistoEnArca: 3n, ultimoDeArca: 3n })).toEqual(
        err("DESFASE_HACIA_ATRAS"),
      );
      expect(await resincronizar(e, { ultimoVistoEnArca: 8n })).toEqual(
        err("ULTIMO_DISTINTO_DEL_DE_ARCA"),
      );
      expect(await series(e)).toEqual([["HOMOLOGACION", "BLOQUEADA", "4", null]]);
      expect(await auditoria(e, "SERIE_RESINCRONIZADA")).toEqual([]);
    });

    it("una serie que no está bloqueada, que no existe o es de otra empresa no se resincroniza", async () => {
      const libre = await escenario({ ultimo: 4 });
      expect(await resincronizar(libre)).toEqual(err("SERIE_NO_BLOQUEADA"));
      const sin = await escenario({ conSerie: false });
      expect(await resincronizar(sin)).toEqual(err("SERIE_NO_ENCONTRADA"));
      const { e: ajena } = await bloqueada(4, 9n);
      // Con la puerta de la empresa A y los datos de la serie de B: no la ve.
      expect(
        await entorno.ejecutar({ contexto: libre.como(T0) }, (tx) =>
          resincronizarEnTx(tx, libre.como(T0), entrada(ajena)),
        ),
      ).toEqual(err("SERIE_NO_ENCONTRADA"));
      expect(await series(ajena)).toEqual([["HOMOLOGACION", "BLOQUEADA", "4", null]]);
    });

    it("una empresa suspendida no opera: no resincroniza", async () => {
      const { e } = await bloqueada(4, 9n);
      await dueno.query(
        "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [e.mundo.empresa],
      );
      expect(await resincronizar(e)).toEqual(
        err({
          codigo: "EMPRESA_NO_OPERA",
          empresaId: e.mundo.empresa,
          motivo: "EMPRESA_SUSPENDIDA",
        }),
      );
      expect(await series(e)).toEqual([["HOMOLOGACION", "BLOQUEADA", "4", null]]);
    });

    it("la serie y la auditoría van juntas: si falla la auditoría, la serie sigue bloqueada", async () => {
      const { e } = await bloqueada(4, 9n);
      await expect(
        entorno.ejecutar({ contexto: e.como(T0) }, (tx) =>
          resincronizarEnTx(
            {
              ...tx,
              auditoria: {
                registrar: async (registro) => {
                  await tx.auditoria.registrar(registro);
                  throw new Error("falla la auditoría");
                },
              },
            },
            e.como(T0),
            entrada(e),
          ),
        ),
      ).rejects.toThrow("falla la auditoría");
      expect(await series(e)).toEqual([["HOMOLOGACION", "BLOQUEADA", "4", null]]);
      expect(await auditoria(e, "SERIE_RESINCRONIZADA")).toEqual([]);
    });

    it("dos resincronizaciones a la vez: una libera la serie y la otra encuentra que ya no está bloqueada; una sola auditoría", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const { e } = await bloqueada(4, 9n);
        const rs = await enParalelo(2, () => resincronizar(e));
        expect(rs.map((r) => (r.ok ? "OK" : r.error)).sort(), `ronda ${ronda}`).toEqual([
          "OK",
          "SERIE_NO_BLOQUEADA",
        ]);
        expect(await series(e), `ronda ${ronda}`).toEqual([["HOMOLOGACION", "LIBRE", "9", null]]);
        expect(await auditoria(e, "SERIE_RESINCRONIZADA"), `ronda ${ronda}`).toHaveLength(1);
      }
    });

    it("resincronizar y reservar a la vez: se reserva el 10 (después de la salida) o SERIE_BLOQUEADA (antes); jamás un número que ARCA ya pasó", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const { e, c } = await bloqueada(4, 9n);
        const [resincro, reserva] = await juntas(
          () => resincronizar(e),
          () => c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e)),
        );
        expect(resincro, `ronda ${ronda}`).toEqual(ok({ ultimoNumero: 9n }));
        if (reserva.ok) {
          expect(reserva.valor.numero, `ronda ${ronda}`).toBe(10n);
          expect(await series(e), `ronda ${ronda}`).toEqual([
            ["HOMOLOGACION", "EN_CURSO", "9", "10"],
          ]);
        } else {
          expect(reserva.error, `ronda ${ronda}`).toBe("SERIE_BLOQUEADA");
          expect(await series(e), `ronda ${ronda}`).toEqual([["HOMOLOGACION", "LIBRE", "9", null]]);
        }
      }
    });
  });

  // ===============================================================================================
  describe("reconciliar por consulta (F4 deja la función pura y el falso; el caso de uso es de F5)", () => {
    const FECHA = fecha("2026-10-13");
    /** El contenido del comprobante en vuelo, en el punto de venta del escenario, y su pedido a ARCA. */
    function contenidoDe(e: Escenario) {
      return facturaArmada(
        consumidorFinal,
        [renglon("1210.00", "1", "21")],
        {},
        contextoDeEmision({
          empresaId: empresaId(e.mundo.empresa),
          emisorId: emisorId(e.mundo.emisor),
          puntoDeVentaId: puntoDeVentaId(e.puntoDeVenta),
        }),
      );
    }
    const pedidoDe =
      (contenido: ReturnType<typeof contenidoDe>) =>
      (base: Pick<SolicitudDeAutorizacion, "puntoDeVenta" | "tipo" | "numero" | "solicitud">) => ({
        ...base,
        fecha: FECHA,
        concepto: contenido.concepto,
        servicio: contenido.servicio,
        receptor: contenido.receptor,
        importes: importesParaArca(contenido),
        asociado: contenido.asociado,
      });

    /** Lo que haría el trabajo de reconciliación (TXr), en una transacción, con la serie real. */
    async function reconciliar(
      e: Escenario,
      arca: EmisionFalsa,
      contenido: ReturnType<typeof contenidoDe>,
      solicitud: string,
      numero: bigint,
    ) {
      const punto = { cuit: cuitDe(e), numero: 1 };
      const consulta = await arca.consultar(punto, "FACTURA_B", numero);
      const ultimo = await arca.ultimoAutorizado(punto, "FACTURA_B");
      if (!ultimo.ok) throw new Error("ARCA no responde");
      return entorno.ejecutar({ contexto: e.sistema(despues(6)) }, async (tx) => {
        const serie = await tx.series.obtener(
          empresaId(e.mundo.empresa),
          puntoDeVentaId(e.puntoDeVenta),
          "FACTURA_B",
          "HOMOLOGACION",
        );
        if (serie === null) throw new Error("la serie tenía que existir");
        const r = reconciliarComprobante(
          serie,
          { solicitud: solicitudId(solicitud), numero, fecha: FECHA, contenido },
          consulta,
          ultimo.valor,
          despues(6),
        );
        if (!r.ok) return r;
        if (r.valor.resolucion !== "SIN_CAMBIOS") {
          const guardada = await tx.series.guardar(r.valor.serie);
          if (guardada === null) throw new Error("la serie cambió");
        }
        return ok(r.valor.resolucion);
      });
    }

    /** El recorrido de reservar, autorizar (con el pedido que corresponde al contenido) y cerrar. */
    const numerarConContenido = (
      e: Escenario,
      arca: EmisionFalsa,
      contenido: ReturnType<typeof contenidoDe>,
    ) => armarNumerarParaPruebas(casosDeNumeracion(entorno, arca), arca, pedidoDe(contenido));

    it("ARCA autorizó y se cayó: la consulta encuentra lo nuestro y la serie queda LIBRE con ese número (la base acepta la transición)", async () => {
      const e = await escenario();
      const contenido = contenidoDe(e);
      const arca = new EmisionFalsa();
      arca.programar("AUTORIZA_Y_SE_CAE");
      const entrada = entradaDe(e);
      const numerar = await numerarConContenido(e, arca, contenido)(e.como(T0), entrada);
      expect(numerar.ok && numerar.valor.resultado.tipo).toBe("INCIERTO");
      expect(await series(e)).toEqual([["HOMOLOGACION", "EN_CURSO", "0", "1"]]);
      // La función de F1 con la consulta del puerto: coincide, así que AUTORIZADO_POR_CONSULTA.
      expect(await reconciliar(e, arca, contenido, entrada.solicitud, 1n)).toEqual(
        ok("AUTORIZADO_POR_CONSULTA"),
      );
      expect(await series(e)).toEqual([["HOMOLOGACION", "LIBRE", "1", null]]);
    });

    it("otro sistema usó el número: la consulta lo ve distinto, la serie queda BLOQUEADA (la base acepta la transición) y se sale resincronizando", async () => {
      const e = await escenario();
      const contenido = contenidoDe(e);
      const arca = new EmisionFalsa();
      arca.programar("AUTORIZA_CON_OTROS_DATOS");
      const numerar = numerarConContenido(e, arca, contenido);
      const entrada = entradaDe(e);
      const primera = await numerar(e.como(T0), entrada);
      expect(primera.ok && primera.valor.resultado.tipo).toBe("INCIERTO");
      expect(await series(e)).toEqual([["HOMOLOGACION", "EN_CURSO", "0", "1"]]);

      expect(await reconciliar(e, arca, contenido, entrada.solicitud, 1n)).toEqual(ok("CONFLICTO"));
      expect(await series(e)).toEqual([["HOMOLOGACION", "BLOQUEADA", "0", null]]);

      // Salir: ARCA informa 1 (lo usó otro): la serie vuelve a LIBRE en 1 y el próximo comprobante es el 2.
      const salida = await entorno.ejecutar({ contexto: e.como(despues(7)) }, (tx) =>
        resincronizarEnTx(tx, e.como(despues(7)), {
          puntoDeVentaId: puntoDeVentaId(e.puntoDeVenta),
          tipo: "FACTURA_B",
          ambiente: "HOMOLOGACION",
          ultimoVistoEnArca: 1n,
          ultimoDeArca: 1n,
          motivo: "el número 1 lo emitió otro sistema",
        }),
      );
      expect(salida).toEqual(ok({ ultimoNumero: 1n }));
      const siguiente = await numerar(e.como(despues(8)), entradaDe(e));
      expect(siguiente.ok && siguiente.valor.numero).toBe(2n);
    });

    it("la consulta caída no decide nada: la serie sigue EN_CURSO y la reconciliación se reintenta", async () => {
      const e = await escenario();
      const contenido = contenidoDe(e);
      const arca = new EmisionFalsa();
      arca.programar("AUTORIZA_Y_SE_CAE");
      const entrada = entradaDe(e);
      await numerarConContenido(e, arca, contenido)(e.como(T0), entrada);
      arca.consultaCaida = true;
      expect(await reconciliar(e, arca, contenido, entrada.solicitud, 1n)).toEqual(
        ok("SIN_CAMBIOS"),
      );
      expect(await series(e)).toEqual([["HOMOLOGACION", "EN_CURSO", "0", "1"]]);
    });
  });

  // ===============================================================================================
  describe("cerrarEnTx corre también sin persona (el trabajo de validación)", () => {
    it("cierra como sistema: la auditoría queda sin actor y la serie avanza", async () => {
      const e = await escenario();
      const c = casosDeNumeracion(entorno, new EmisionFalsa());
      const entrada = entradaDe(e);
      await c.reservarNumeroDeComprobante(e.como(T0), entrada);
      const contexto: ContextoOperativo = e.sistema(despues(1));
      const r = await entorno.ejecutar({ contexto }, (tx) =>
        cerrarEnTx(tx, contexto, {
          ...entrada,
          numero: 1n,
          resultado: {
            tipo: "AUTORIZADO",
            codigo: "CAE-1",
            vence: fecha("2099-12-31"),
            fecha: fecha("2026-10-13"),
            observaciones: [],
          },
        }),
      );
      expect(r).toEqual(ok({ desenlace: "AUTORIZADO", numero: 1n, yaCerrada: false }));
      expect(await series(e)).toEqual([["HOMOLOGACION", "LIBRE", "1", null]]);
      expect(
        (await auditoria(e, "NUMERO_DE_COMPROBANTE_AUTORIZADO"))[0]?.actor_persona_id,
      ).toBeNull();
    });
  });
});
