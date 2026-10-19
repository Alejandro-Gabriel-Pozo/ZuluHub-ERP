import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { Contexto, ContextoOperativo } from "../../src/contexto/contexto";
import {
  puntoDeVentaId,
  solicitudId,
  type EmisionElectronica,
  type SolicitudDeAutorizacion,
} from "../../src/modulos/fiscal/publico";
import type {
  ResultadoDeAutorizacionArca,
  TipoDeComprobante,
} from "../../src/modulos/fiscal/publico";
import {
  empresaId,
  marcaComercialId,
  type MarcaComercialId,
} from "../../src/primitivas/identificadores/marca";
import { cuitDesdeTexto } from "../../src/primitivas/identificacion-fiscal/cuit";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import {
  CODIGO_DE_RECHAZO_DEL_FALSO,
  EmisionFalsa,
  solicitudDeAutorizacion,
} from "../utilidades/emision-falsa";
import { fecha } from "../utilidades/facturacion";
import { crearBaseAparte } from "./entorno";
import {
  REGLAS_CON_FACTURACION,
  casosDeNumeracion,
  crearEntornoDeNumeracion,
  crearEscenario,
  entradaDe,
  type Escenario,
  type TxDeNumeracionDePrueba,
} from "./fiscal-numeracion-apoyo";
import { crearMundo, crearPuntoDeVenta, crearSerie } from "./fiscal-apoyo";
import { nuevoId } from "./fiscal-persistencia-apoyo";
import { crearMarca } from "./marcas-apoyo";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../utilidades/marcas";

/**
 * H7 (fiscal base), tramo T6: los casos de uso de numeración contra una base real, con el rol limitado
 * de la aplicación y el contexto firmado (nunca el dueño de la base, salvo para armar el escenario y
 * para mirar). Cubre el guard, reservar (idempotente), cerrar (idempotente), numerar con el adaptador
 * falso de ARCA, los cortes a mitad de camino, la reconciliación, el aislamiento entre empresas y la
 * auditoría exacta. La concurrencia está en `fiscal-numeracion-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });

const T0 = new Date("2026-10-12T12:00:00Z");
const INCIERTO: ResultadoDeAutorizacionArca = { tipo: "INCIERTO", motivo: "sin respuesta" };
const despues = (minutos: number) => new Date(T0.getTime() + minutos * 60_000);

type Fila = Record<string, unknown>;

describe.skipIf(base === null)("fiscal T6: numeración contra una base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  /** Lo que se le agrega a la transacción de cada caso de uso (una falla inyectada, un espía). */
  let ajuste: (tx: TxDeNumeracionDePrueba) => TxDeNumeracionDePrueba = (tx) => tx;
  let entorno: ReturnType<typeof crearEntornoDeNumeracion>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeNumeracion(propia.base, 8, (tx) => ajuste(tx));
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const escenario = (opciones: Parameters<typeof crearEscenario>[1] = {}) =>
    crearEscenario(dueno, { conSerie: true, ...opciones });

  const serie = async (e: Escenario, tipo = "FACTURA_B") =>
    (
      await filas(
        `select estado, ultimo_numero::text as ultimo, numero_en_curso::text as en_curso,
                solicitud_en_curso as solicitud, motivo_bloqueo, version
           from serie_comprobante where punto_de_venta_id = $1 and tipo_comprobante = $2`,
        [e.puntoDeVenta, tipo],
      )
    )[0];
  const auditoria = (e: Escenario, accion?: string) =>
    filas(
      `select accion, actor_persona_id, entidad, entidad_id, antes, despues from auditoria_empresa
        where empresa_id = $1 ${accion === undefined ? "" : "and accion = $2"} order by id`,
      accion === undefined ? [e.mundo.empresa] : [e.mundo.empresa, accion],
    );

  /** Cuántas transacciones tiene abiertas la aplicación en este momento (todas las conexiones). */
  const transaccionesAbiertas = async (): Promise<number> =>
    Number(
      (
        await filas<{ n: string }>(
          `select count(*) as n from pg_stat_activity
            where datname = current_database() and pid <> pg_backend_pid() and xact_start is not null
              and backend_type = 'client backend'`,
        )
      )[0]?.n,
    );

  /** El adaptador falso de ARCA, que además anota si había una transacción abierta en cada pedido. */
  class EmisionVigilada implements EmisionElectronica {
    readonly falsa: EmisionFalsa;
    readonly transaccionesDuranteLosPedidos: number[] = [];
    consultas = 0;
    constructor(falsa = new EmisionFalsa()) {
      this.falsa = falsa;
    }
    async ultimoAutorizado(...args: Parameters<EmisionFalsa["ultimoAutorizado"]>) {
      this.consultas += 1;
      this.transaccionesDuranteLosPedidos.push(await transaccionesAbiertas());
      return this.falsa.ultimoAutorizado(...args);
    }
    async autorizar(solicitud: SolicitudDeAutorizacion): Promise<ResultadoDeAutorizacionArca> {
      this.transaccionesDuranteLosPedidos.push(await transaccionesAbiertas());
      return this.falsa.autorizar(solicitud);
    }
    async consultar(...args: Parameters<EmisionFalsa["consultar"]>) {
      this.transaccionesDuranteLosPedidos.push(await transaccionesAbiertas());
      return this.falsa.consultar(...args);
    }
  }
  const cuitDe = (e: Escenario) => {
    const r = cuitDesdeTexto(e.mundo.cuit);
    if (!r.ok) throw new Error("el CUIT de la empresa de prueba no es válido");
    return r.valor;
  };
  const arcaDe = (e: Escenario, tipo: TipoDeComprobante = "FACTURA_B") => ({
    punto: { cuit: cuitDe(e), numero: 1 },
    tipo,
  });
  const casos = (emision: EmisionElectronica, reglas = REGLAS_CON_FACTURACION) =>
    casosDeNumeracion(entorno, emision, undefined, reglas);

  // ===============================================================================================
  describe("el guard: con el catálogo real todavía no se puede emitir", () => {
    it("reservar, cerrar y numerar dan MODULO_EN_DESARROLLO a los tres roles y no escriben nada ni llaman a ARCA", async () => {
      for (const rol of ["GERENTE", "ADMINISTRADOR", "OPERADOR"] as const) {
        const e = await escenario({ rol });
        const arca = new EmisionVigilada();
        const real = casos(arca, REGLAS_DE_EMPRESA);
        const en = { ...entradaDe(e), numero: 1n, resultado: INCIERTO };
        const motivo = err("MODULO_EN_DESARROLLO");
        expect(await real.reservarNumeroDeComprobante(e.como(T0), entradaDe(e)), rol).toEqual(
          motivo,
        );
        expect(await real.cerrarReservaDeNumero(e.como(T0), en), rol).toEqual(motivo);
        expect(await real.numerarComprobante(e.como(T0), entradaDe(e)), rol).toEqual(motivo);
        expect(await serie(e), rol).toMatchObject({ estado: "LIBRE", ultimo: "0", version: 1 });
        expect(await auditoria(e), rol).toEqual([]);
        expect(arca.transaccionesDuranteLosPedidos, rol).toEqual([]);
      }
    });

    it("con la facturación construida, los tres roles reservan; quien no es miembro, o es miembro apagado, da SIN_PERMISO", async () => {
      for (const rol of ["GERENTE", "ADMINISTRADOR", "OPERADOR"] as const) {
        const e = await escenario({ rol });
        const r = await casos(new EmisionFalsa()).reservarNumeroDeComprobante(
          e.como(T0),
          entradaDe(e),
        );
        expect(r.ok && r.valor.numero, rol).toBe(1n);
      }
      const e = await escenario();
      const ajena = await escenario();
      const arca = new EmisionVigilada();
      // Una persona de otra empresa, con la puerta de esta: no es miembro de la empresa del contexto.
      const intruso: Contexto = { ...e.como(T0), personaId: ajena.como(T0).personaId };
      expect(await casos(arca).reservarNumeroDeComprobante(intruso as never, entradaDe(e))).toEqual(
        err("SIN_PERMISO"),
      );
      await dueno.query("update membresia set activo = false where persona_id = $1", [e.persona]);
      expect(await casos(arca).reservarNumeroDeComprobante(e.como(T0), entradaDe(e))).toEqual(
        err("SIN_PERMISO"),
      );
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "0" });
    });

    it("la persona que entra por la puerta de OTRA marca (o sin puerta) da SIN_PERMISO en reservar, cerrar y numerar, y la serie no se toca (Q1)", async () => {
      const e = await escenario();
      const otraMarca = marcaComercialId(await crearMarca(dueno));
      const c = casos(new EmisionFalsa());
      const por = (marcaDeEntrada: MarcaComercialId | null): ContextoOperativo => ({
        ...e.como(T0),
        marcaDeEntrada,
      });
      for (const marca of [otraMarca, null]) {
        expect(await c.reservarNumeroDeComprobante(por(marca), entradaDe(e))).toEqual(
          err("SIN_PERMISO"),
        );
        expect(await c.numerarComprobante(por(marca), entradaDe(e))).toEqual(err("SIN_PERMISO"));
        expect(
          await c.cerrarReservaDeNumero(por(marca), {
            ...entradaDe(e),
            numero: 1n,
            resultado: { tipo: "INCIERTO", motivo: "sin respuesta" },
          }),
        ).toEqual(err("SIN_PERMISO"));
      }
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "0" });
      expect(await auditoria(e)).toEqual([]);
      // Por su puerta, la misma persona reserva (el filtro de marca no le quita nada a quien entra bien).
      const r = await c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e));
      expect(r.ok && r.valor.numero).toBe(1n);
    });

    it("una empresa suspendida no opera (EMPRESA_NO_OPERA): ni reserva ni cierra ni reconcilia", async () => {
      const e = await escenario();
      await dueno.query(
        "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [e.mundo.empresa],
      );
      const c = casos(new EmisionFalsa());
      const noOpera = err({
        codigo: "EMPRESA_NO_OPERA",
        empresaId: e.mundo.empresa,
        motivo: "EMPRESA_SUSPENDIDA",
      });
      expect(await c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e))).toEqual(noOpera);
      expect(
        await c.cerrarReservaDeNumero(e.como(T0), {
          ...entradaDe(e),
          numero: 1n,
          resultado: INCIERTO,
        }),
      ).toEqual(noOpera);
      expect(await c.reconciliarSerie(e.sistema(T0), entradaDe(e))).toEqual(noOpera);
      expect(await c.reconciliarSeriesVencidas(e.sistema(T0))).toEqual(noOpera);
    });
  });

  // ===============================================================================================
  describe("reservar", () => {
    it("pasa la serie de LIBRE a EN_CURSO con el número siguiente, el plazo y la auditoría exacta", async () => {
      const e = await escenario({ ultimo: 41 });
      const entrada = entradaDe(e);
      const r = await casos(new EmisionFalsa()).reservarNumeroDeComprobante(e.como(T0), entrada);
      expect(r).toEqual(
        ok({
          numero: 42n,
          puntoDeVenta: { cuit: e.mundo.cuit, numero: 1 },
          yaReservada: false,
        }),
      );
      expect(await serie(e)).toMatchObject({
        estado: "EN_CURSO",
        ultimo: "41",
        en_curso: "42",
        solicitud: entrada.solicitud,
        version: 2,
      });
      expect(await auditoria(e)).toEqual([
        {
          accion: "NUMERO_DE_COMPROBANTE_RESERVADO",
          actor_persona_id: e.persona,
          entidad: "serie_comprobante",
          entidad_id: `${e.puntoDeVenta}:FACTURA_B:HOMOLOGACION`,
          antes: { estado: "LIBRE", ambiente: "HOMOLOGACION", ultimoNumero: "41" },
          despues: {
            estado: "EN_CURSO",
            ambiente: "HOMOLOGACION",
            ultimoNumero: "41",
            numeroEnCurso: "42",
            solicitud: entrada.solicitud,
            enCursoHasta: despues(5).toISOString(),
          },
        },
      ]);
    });

    it("repetir con la misma solicitud devuelve el mismo número, sin escribir ni auditar de nuevo", async () => {
      const e = await escenario();
      const entrada = entradaDe(e);
      const c = casos(new EmisionFalsa());
      const primera = await c.reservarNumeroDeComprobante(e.como(T0), entrada);
      const antes = await serie(e);
      const segunda = await c.reservarNumeroDeComprobante(e.como(despues(1)), entrada);
      expect(primera.ok && primera.valor).toMatchObject({ numero: 1n, yaReservada: false });
      expect(segunda.ok && segunda.valor).toMatchObject({ numero: 1n, yaReservada: true });
      expect(await serie(e)).toEqual(antes);
      expect(await auditoria(e, "NUMERO_DE_COMPROBANTE_RESERVADO")).toHaveLength(1);
    });

    it("otra solicitud recibe SERIE_OCUPADA mientras haya una reserva en curso, aunque haya vencido (la libera la reconciliación)", async () => {
      const e = await escenario();
      const c = casos(new EmisionFalsa());
      await c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e));
      expect(await c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e))).toEqual(
        err("SERIE_OCUPADA"),
      );
      expect(await c.reservarNumeroDeComprobante(e.como(despues(60)), entradaDe(e))).toEqual(
        err("SERIE_OCUPADA"),
      );
      expect(await auditoria(e, "NUMERO_DE_COMPROBANTE_RESERVADO")).toHaveLength(1);
    });

    it("cada tipo de comprobante tiene su propia serie: el mismo punto de venta numera FACTURA_A y FACTURA_B por separado", async () => {
      const e = await escenario();
      await crearSerie(dueno, e.mundo.empresa, e.puntoDeVenta, e.mundo.emisor, "FACTURA_A", 9);
      const c = casos(new EmisionFalsa());
      const b = await c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e));
      const a = await c.reservarNumeroDeComprobante(
        e.como(T0),
        entradaDe(e, solicitudId(nuevoId()), "FACTURA_A"),
      );
      expect(b.ok && b.valor.numero).toBe(1n);
      expect(a.ok && a.valor.numero).toBe(10n);
    });

    it("la serie que no existe nace con el último número que informa el servicio, preguntado FUERA de la transacción", async () => {
      const e = await escenario({ conSerie: false });
      const arca = new EmisionVigilada(new EmisionFalsa({ ultimoInicial: 57n }));
      const c = casos(arca);
      const entrada = entradaDe(e);
      const r = await c.reservarNumeroDeComprobante(e.como(T0), entrada);
      expect(r.ok && r.valor).toMatchObject({ numero: 58n, yaReservada: false });
      expect(await serie(e)).toMatchObject({ estado: "EN_CURSO", ultimo: "57", en_curso: "58" });
      expect(arca.consultas).toBe(1);
      expect(arca.transaccionesDuranteLosPedidos).toEqual([0]);
      expect((await auditoria(e)).map((a) => a.accion)).toEqual([
        "SERIE_DE_COMPROBANTES_CREADA",
        "NUMERO_DE_COMPROBANTE_RESERVADO",
      ]);
      expect((await auditoria(e, "SERIE_DE_COMPROBANTES_CREADA"))[0]).toMatchObject({
        despues: { estado: "LIBRE", ambiente: "HOMOLOGACION", ultimoNumero: "57" },
      });
      // Repetir ya no le pregunta nada al servicio.
      const otra = await c.reservarNumeroDeComprobante(e.como(T0), entrada);
      expect(otra.ok && otra.valor).toMatchObject({ numero: 58n, yaReservada: true });
      expect(arca.consultas).toBe(1);
    });

    it("si el servicio no responde al crear la serie, no se crea nada y se puede reintentar", async () => {
      const e = await escenario({ conSerie: false });
      const falsa = new EmisionFalsa({ ultimoInicial: 3n });
      falsa.servicioCaido = true;
      const c = casos(falsa);
      expect(await c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e))).toEqual(
        err({ codigo: "SERVICIO_NO_DISPONIBLE", detalle: "servicio caído (falso)" }),
      );
      expect(await serie(e)).toBeUndefined();
      expect(await auditoria(e)).toEqual([]);
      falsa.servicioCaido = false;
      const r = await c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e));
      expect(r.ok && r.valor.numero).toBe(4n);
    });

    it("un punto de venta que no existe, o es de otra empresa, es PUNTO_DE_VENTA_NO_ENCONTRADO y no toca la serie ajena", async () => {
      const e = await escenario();
      const ajena = await escenario();
      const c = casos(new EmisionVigilada());
      const deOtra = { ...entradaDe(ajena) };
      expect(await c.reservarNumeroDeComprobante(e.como(T0), deOtra)).toEqual(
        err("PUNTO_DE_VENTA_NO_ENCONTRADO"),
      );
      expect(
        await c.reservarNumeroDeComprobante(e.como(T0), {
          ...entradaDe(e),
          puntoDeVentaId: puntoDeVentaId(nuevoId()),
        }),
      ).toEqual(err("PUNTO_DE_VENTA_NO_ENCONTRADO"));
      expect(await serie(ajena)).toMatchObject({ estado: "LIBRE", ultimo: "0", version: 1 });
      expect(await auditoria(ajena)).toEqual([]);
    });

    it("un punto de venta inactivo no reserva números nuevos", async () => {
      const e = await escenario();
      await dueno.query("update punto_de_venta set estado = 'INACTIVO' where id = $1", [
        e.puntoDeVenta,
      ]);
      expect(
        await casos(new EmisionFalsa()).reservarNumeroDeComprobante(e.como(T0), entradaDe(e)),
      ).toEqual(err("PUNTO_DE_VENTA_INACTIVO"));
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "0", version: 1 });
    });

    it("una serie bloqueada es SERIE_BLOQUEADA", async () => {
      const e = await escenario();
      await dueno.query(
        `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = 1,
                solicitud_en_curso = $2, en_curso_hasta = now() where punto_de_venta_id = $1`,
        [e.puntoDeVenta, nuevoId()],
      );
      await dueno.query(
        `update serie_comprobante set estado = 'BLOQUEADA', numero_en_curso = null,
                solicitud_en_curso = null, en_curso_hasta = null, motivo_bloqueo = 'desfase'
          where punto_de_venta_id = $1`,
        [e.puntoDeVenta],
      );
      expect(
        await casos(new EmisionFalsa()).reservarNumeroDeComprobante(e.como(T0), entradaDe(e)),
      ).toEqual(err("SERIE_BLOQUEADA"));
    });
  });

  // ===============================================================================================
  describe("cerrar", () => {
    const AUTORIZADO: ResultadoDeAutorizacionArca = {
      tipo: "AUTORIZADO",
      codigo: "CAE-123",
      vence: fecha("2099-12-31"),
      fecha: fecha("2026-10-13"),
      observaciones: [{ codigo: 10237, texto: "una observación" }],
    };

    /** Una reserva hecha por el caso de uso: el escenario, su entrada y el número. */
    async function conReserva(ultimo = 0) {
      const e = await escenario({ ultimo });
      const entrada = entradaDe(e);
      const c = casos(new EmisionFalsa());
      const r = await c.reservarNumeroDeComprobante(e.como(T0), entrada);
      if (!r.ok) throw new Error("no se pudo reservar");
      return { e, entrada, c, numero: r.valor.numero };
    }

    it("autorizado: el último número avanza, la serie queda LIBRE y la auditoría guarda el código", async () => {
      const { e, entrada, c, numero } = await conReserva(10);
      const r = await c.cerrarReservaDeNumero(e.como(T0), {
        ...entrada,
        numero,
        resultado: AUTORIZADO,
      });
      expect(r).toEqual(ok({ desenlace: "AUTORIZADO", numero: 11n, yaCerrada: false }));
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "11", en_curso: null });
      expect((await auditoria(e, "NUMERO_DE_COMPROBANTE_AUTORIZADO"))[0]).toEqual({
        accion: "NUMERO_DE_COMPROBANTE_AUTORIZADO",
        actor_persona_id: e.persona,
        entidad: "serie_comprobante",
        entidad_id: `${e.puntoDeVenta}:FACTURA_B:HOMOLOGACION`,
        antes: {
          estado: "EN_CURSO",
          ambiente: "HOMOLOGACION",
          ultimoNumero: "10",
          numeroEnCurso: "11",
          solicitud: entrada.solicitud,
          enCursoHasta: despues(5).toISOString(),
        },
        despues: {
          estado: "LIBRE",
          ambiente: "HOMOLOGACION",
          ultimoNumero: "11",
          numero: "11",
          solicitud: entrada.solicitud,
          codigoDeAutorizacion: "CAE-123",
          vence: "2099-12-31",
          fecha: "2026-10-13",
          observaciones: [10237],
        },
      });
    });

    it("repetir el cierre autorizado da el mismo éxito (yaCerrada) y no avanza dos veces ni audita de nuevo", async () => {
      const { e, entrada, c, numero } = await conReserva();
      const cierre = { ...entrada, numero, resultado: AUTORIZADO };
      await c.cerrarReservaDeNumero(e.como(T0), cierre);
      const antes = await serie(e);
      const otra = await c.cerrarReservaDeNumero(e.como(despues(1)), cierre);
      expect(otra).toEqual(ok({ desenlace: "AUTORIZADO", numero: 1n, yaCerrada: true }));
      expect(await serie(e)).toEqual(antes);
      expect(await auditoria(e, "NUMERO_DE_COMPROBANTE_AUTORIZADO")).toHaveLength(1);
    });

    it("rechazado: libera sin avanzar (no hay hueco) y la próxima solicitud toma el mismo número; repetirlo es un éxito", async () => {
      const { e, entrada, c, numero } = await conReserva(5);
      const cierre = {
        ...entrada,
        numero,
        resultado: {
          tipo: "RECHAZADO",
          errores: [{ codigo: 10015, texto: "CUIT inválido de Juan Pérez" }],
          observaciones: [],
        } satisfies ResultadoDeAutorizacionArca,
      } as const;
      expect(await c.cerrarReservaDeNumero(e.como(T0), cierre)).toEqual(
        ok({ desenlace: "RECHAZADO", numero: 6n, yaCerrada: false }),
      );
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "5" });
      expect(await c.cerrarReservaDeNumero(e.como(T0), cierre)).toEqual(
        ok({ desenlace: "RECHAZADO", numero: 6n, yaCerrada: true }),
      );
      expect((await auditoria(e, "NUMERO_DE_COMPROBANTE_RECHAZADO")).map((a) => a.despues)).toEqual(
        [
          {
            estado: "LIBRE",
            ambiente: "HOMOLOGACION",
            ultimoNumero: "5",
            numero: "6",
            solicitud: entrada.solicitud,
            errores: [10015],
            observaciones: [],
          },
        ],
      );
      // La auditoría guarda los códigos de ARCA, no sus textos (que pueden llevar datos de la persona).
      expect(JSON.stringify(await auditoria(e))).not.toContain("Juan");
      const siguiente = await c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e));
      expect(siguiente.ok && siguiente.valor.numero).toBe(6n);
    });

    it("incierto: la serie sigue EN_CURSO, no se escribe ni se audita nada, y repetirlo da lo mismo", async () => {
      const { e, entrada, c, numero } = await conReserva();
      const antes = await serie(e);
      const cierre = { ...entrada, numero, resultado: INCIERTO } as const;
      for (let i = 0; i < 2; i++) {
        expect(await c.cerrarReservaDeNumero(e.como(T0), cierre)).toEqual(
          ok({ desenlace: "INCIERTO", numero: 1n, yaCerrada: false }),
        );
      }
      expect(await serie(e)).toEqual(antes);
      expect(await auditoria(e, "NUMERO_DE_COMPROBANTE_RESERVADO")).toHaveLength(1);
      expect(await auditoria(e)).toHaveLength(1);
    });

    it("un número equivocado es NUMERO_INVALIDO; la reserva de otra solicitud, SOLICITUD_NO_VIGENTE; sin serie, SERIE_NO_ENCONTRADA", async () => {
      const { e, entrada, c, numero } = await conReserva();
      expect(
        await c.cerrarReservaDeNumero(e.como(T0), {
          ...entrada,
          numero: numero + 1n,
          resultado: AUTORIZADO,
        }),
      ).toEqual(err("NUMERO_INVALIDO"));
      expect(
        await c.cerrarReservaDeNumero(e.como(T0), {
          ...entradaDe(e),
          numero,
          resultado: AUTORIZADO,
        }),
      ).toEqual(err("SOLICITUD_NO_VIGENTE"));
      expect(
        await c.cerrarReservaDeNumero(e.como(T0), {
          ...entradaDe(e, undefined, "FACTURA_C"),
          numero,
          resultado: AUTORIZADO,
        }),
      ).toEqual(err("SERIE_NO_ENCONTRADA"));
      expect(await serie(e)).toMatchObject({ estado: "EN_CURSO", ultimo: "0" });
    });

    it("una empresa no puede cerrar la reserva de otra, ni conociendo su punto de venta y su solicitud", async () => {
      const { e, entrada, numero } = await conReserva();
      const ajena = await escenario();
      expect(
        await casos(new EmisionFalsa()).cerrarReservaDeNumero(ajena.como(T0), {
          ...entrada,
          numero,
          resultado: AUTORIZADO,
        }),
      ).toEqual(err("SERIE_NO_ENCONTRADA"));
      expect(await serie(e)).toMatchObject({ estado: "EN_CURSO", ultimo: "0", version: 2 });
    });

    it("serie y auditoría van juntas o ninguna: una falla de la base después del UPDATE deja la reserva como estaba", async () => {
      const { e, entrada, c, numero } = await conReserva();
      const antes = await serie(e);
      ajuste = (tx) => ({
        ...tx,
        series: {
          ...tx.series,
          guardar: async (s) => {
            const guardada = await tx.series.guardar(s);
            await sql`select 1/0`.execute(tx.db); // la base falla DESPUÉS del UPDATE
            return guardada;
          },
        },
      });
      try {
        const r = await c.cerrarReservaDeNumero(e.como(T0), {
          ...entrada,
          numero,
          resultado: AUTORIZADO,
        });
        expect(r.ok).toBe(false);
        expect(!r.ok && r.error).toMatchObject({ tipo: "Inesperado" });
      } finally {
        ajuste = (tx) => tx;
      }
      expect(await serie(e)).toEqual(antes);
      expect(await auditoria(e, "NUMERO_DE_COMPROBANTE_AUTORIZADO")).toEqual([]);
    });

    it("y al revés: si falla la auditoría después de guardar la serie, la serie tampoco avanza", async () => {
      const { e, entrada, c, numero } = await conReserva();
      const antes = await serie(e);
      ajuste = (tx) => ({
        ...tx,
        auditoria: {
          registrar: async (registro) => {
            await tx.auditoria.registrar(registro);
            await sql`select 1/0`.execute(tx.db);
          },
        },
      });
      try {
        const r = await c.cerrarReservaDeNumero(e.como(T0), {
          ...entrada,
          numero,
          resultado: AUTORIZADO,
        });
        expect(!r.ok && r.error).toMatchObject({ tipo: "Inesperado" });
      } finally {
        ajuste = (tx) => tx;
      }
      expect(await serie(e)).toEqual(antes);
      expect(await auditoria(e, "NUMERO_DE_COMPROBANTE_AUTORIZADO")).toEqual([]);
    });
  });

  // ===============================================================================================
  describe("numerar: reservar, pedir a ARCA fuera de la transacción y cerrar", () => {
    it("autoriza: el número queda cerrado, ARCA lo recibió una vez y sin ninguna transacción abierta", async () => {
      const e = await escenario();
      const arca = new EmisionVigilada();
      const c = casos(arca);
      const entrada = entradaDe(e);
      const r = await c.numerarComprobante(e.como(T0), entrada);
      expect(r).toEqual(
        ok({
          numero: 1n,
          resultado: {
            tipo: "AUTORIZADO",
            codigo: "00001000000001",
            vence: "2099-12-31",
            fecha: "2026-10-13",
            observaciones: [],
          },
        }),
      );
      expect(arca.falsa.pedidos).toEqual([
        solicitudDeAutorizacion({
          puntoDeVenta: { cuit: cuitDe(e), numero: 1 },
          tipo: "FACTURA_B",
          numero: 1n,
          solicitud: entrada.solicitud,
        }),
      ]);
      expect(arca.transaccionesDuranteLosPedidos).toEqual([0]);
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
      expect((await auditoria(e)).map((a) => a.accion)).toEqual([
        "NUMERO_DE_COMPROBANTE_RESERVADO",
        "NUMERO_DE_COMPROBANTE_AUTORIZADO",
      ]);
    });

    it("rechaza: no hay hueco, la serie queda LIBRE donde estaba y el número se reutiliza", async () => {
      const e = await escenario();
      const falsa = new EmisionFalsa();
      falsa.programar("RECHAZA", "AUTORIZA");
      const c = casos(falsa);
      const primera = await c.numerarComprobante(e.como(T0), entradaDe(e));
      expect(primera).toEqual(
        ok({
          numero: 1n,
          resultado: {
            tipo: "RECHAZADO",
            errores: [{ codigo: CODIGO_DE_RECHAZO_DEL_FALSO, texto: "rechazado (falso)" }],
            observaciones: [],
          },
        }),
      );
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "0" });
      const segunda = await c.numerarComprobante(e.como(T0), entradaDe(e));
      expect(segunda.ok && segunda.valor.numero).toBe(1n);
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
    });

    it("una serie sin crear se crea con el último de ARCA y el primer comprobante sigue esa secuencia", async () => {
      const e = await escenario({ conSerie: false });
      const arca = new EmisionVigilada(new EmisionFalsa({ ultimoInicial: 100n }));
      const r = await casos(arca).numerarComprobante(e.como(T0), entradaDe(e));
      expect(r.ok && r.valor.numero).toBe(101n);
      expect(r.ok && r.valor.resultado.tipo).toBe("AUTORIZADO");
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "101" });
      expect(arca.transaccionesDuranteLosPedidos).toEqual([0, 0]);
    });

    it("incierto: la serie queda EN_CURSO y la reconciliación la libera (ARCA no autorizó nada); sin hueco", async () => {
      const e = await escenario();
      const arca = new EmisionVigilada();
      arca.falsa.programar("INCIERTO");
      const c = casos(arca);
      const entrada = entradaDe(e);
      const r = await c.numerarComprobante(e.como(T0), entrada);
      expect(r).toEqual(
        ok({ numero: 1n, resultado: { tipo: "INCIERTO", motivo: "sin respuesta (falso)" } }),
      );
      expect(await serie(e)).toMatchObject({ estado: "EN_CURSO", ultimo: "0", en_curso: "1" });

      // Todavía vigente: la reconciliación no toca nada ni le pregunta a ARCA.
      const consultasAntes = arca.consultas;
      expect(await c.reconciliarSerie(e.sistema(despues(1)), entrada)).toEqual(
        err("RESERVA_NO_VENCIDA"),
      );
      expect(arca.consultas).toBe(consultasAntes);

      const rec = await c.reconciliarSerie(e.sistema(despues(6)), entrada);
      expect(rec).toEqual(
        ok({ tipo: "RECONCILIADA", resolucion: "LIBERADA", ultimoAutorizado: 0n }),
      );
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "0", en_curso: null });
      const siguiente = await c.numerarComprobante(e.como(despues(7)), entradaDe(e));
      expect(siguiente.ok && siguiente.valor.numero).toBe(1n);
    });

    it("ARCA autorizó y se cayó (responde incierto): queda EN_CURSO y la reconciliación lo cierra como autorizado", async () => {
      const e = await escenario();
      const arca = new EmisionVigilada();
      arca.falsa.programar("AUTORIZA_Y_SE_CAE");
      const c = casos(arca);
      const entrada = entradaDe(e);
      expect(await c.numerarComprobante(e.como(T0), entrada)).toEqual(
        ok({ numero: 1n, resultado: { tipo: "INCIERTO", motivo: "autorizó y se cayó (falso)" } }),
      );
      expect(await serie(e)).toMatchObject({ estado: "EN_CURSO", ultimo: "0", en_curso: "1" });

      const rec = await c.reconciliarSerie(e.sistema(despues(6)), entrada);
      expect(rec).toEqual(
        ok({ tipo: "RECONCILIADA", resolucion: "CERRADA_COMO_AUTORIZADA", ultimoAutorizado: 1n }),
      );
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
      expect(arca.transaccionesDuranteLosPedidos.every((n) => n === 0)).toBe(true);
      // El comprobante siguiente es el 2 y ARCA lo acepta: la secuencia no se rompió.
      const siguiente = await c.numerarComprobante(e.como(despues(7)), entradaDe(e));
      expect(siguiente.ok && siguiente.valor).toMatchObject({
        numero: 2n,
        resultado: { tipo: "AUTORIZADO" },
      });
    });

    it("ARCA responde pero el cierre falla: la reserva queda EN_CURSO, el error trae lo que respondió ARCA y la reconciliación lo recupera", async () => {
      const e = await escenario();
      const arca = new EmisionVigilada();
      const c = casos(arca);
      const entrada = entradaDe(e);
      // La base falla en la transacción del CIERRE (la de la reserva, la primera, pasa).
      let cierres = 0;
      ajuste = (tx) => ({
        ...tx,
        series: {
          ...tx.series,
          guardar: async (s) => {
            const guardada = await tx.series.guardar(s);
            if (s.estado === "LIBRE") {
              cierres += 1;
              await sql`select 1/0`.execute(tx.db);
            }
            return guardada;
          },
        },
      });
      let r: Awaited<ReturnType<typeof c.numerarComprobante>>;
      try {
        r = await c.numerarComprobante(e.como(T0), entrada);
      } finally {
        ajuste = (tx) => tx;
      }
      expect(cierres).toBeGreaterThan(0);
      expect(r).toEqual(
        err({
          codigo: "CIERRE_SIN_CONFIRMAR",
          numero: 1n,
          resultado: {
            tipo: "AUTORIZADO",
            codigo: "00001000000001",
            vence: "2099-12-31",
            fecha: "2026-10-13",
            observaciones: [],
          },
          causa: expect.objectContaining({ tipo: "Inesperado" }) as unknown,
        }),
      );
      expect(await serie(e)).toMatchObject({ estado: "EN_CURSO", ultimo: "0", en_curso: "1" });
      expect(await auditoria(e, "NUMERO_DE_COMPROBANTE_AUTORIZADO")).toEqual([]);

      const rec = await c.reconciliarSerie(e.sistema(despues(6)), entrada);
      expect(rec).toEqual(
        ok({ tipo: "RECONCILIADA", resolucion: "CERRADA_COMO_AUTORIZADA", ultimoAutorizado: 1n }),
      );
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
    });

    it("si el adaptador de ARCA lanza una excepción, no se traga: la reserva queda EN_CURSO y se reconcilia", async () => {
      const e = await escenario();
      const falsa = new EmisionFalsa();
      const caido: EmisionElectronica = {
        ultimoAutorizado: (...a) => falsa.ultimoAutorizado(...a),
        autorizar: () => Promise.reject(new Error("se cortó la conexión")),
        consultar: (...a) => falsa.consultar(...a),
      };
      const c = casos(caido);
      await expect(c.numerarComprobante(e.como(T0), entradaDe(e))).rejects.toThrow(
        "se cortó la conexión",
      );
      expect(await serie(e)).toMatchObject({ estado: "EN_CURSO", ultimo: "0", en_curso: "1" });
      const rec = await c.reconciliarSerie(e.sistema(despues(6)), entradaDe(e));
      expect(rec.ok && rec.valor).toMatchObject({ resolucion: "LIBERADA" });
    });

    it("repetir con la misma solicitud mientras la reserva sigue en curso NO vuelve a pedirle el número a ARCA (RESERVA_EN_CURSO)", async () => {
      const e = await escenario();
      const arca = new EmisionVigilada();
      arca.falsa.programar("AUTORIZA_Y_SE_CAE");
      const c = casos(arca);
      const entrada = entradaDe(e);
      await c.numerarComprobante(e.como(T0), entrada);
      expect(await c.numerarComprobante(e.como(despues(1)), entrada)).toEqual(
        err({ codigo: "RESERVA_EN_CURSO", numero: 1n }),
      );
      expect(arca.falsa.pedidos).toHaveLength(1);
    });

    it("un punto de venta ajeno no numera: PUNTO_DE_VENTA_NO_ENCONTRADO y ARCA no recibe nada", async () => {
      const e = await escenario();
      const ajena = await escenario();
      const arca = new EmisionVigilada();
      expect(await casos(arca).numerarComprobante(e.como(T0), entradaDe(ajena))).toEqual(
        err("PUNTO_DE_VENTA_NO_ENCONTRADO"),
      );
      expect(arca.falsa.pedidos).toEqual([]);
    });
  });

  // ===============================================================================================
  describe("reconciliar", () => {
    /** Una reserva EN_CURSO de FACTURA_B hecha por el caso de uso en T0, con su ARCA. */
    async function conReservaEnCurso(ultimo = 0) {
      const e = await escenario({ ultimo });
      const arca = new EmisionVigilada();
      const c = casos(arca);
      const entrada = entradaDe(e);
      const r = await c.reservarNumeroDeComprobante(e.como(T0), entrada);
      if (!r.ok) throw new Error("no se pudo reservar");
      arca.consultas = 0;
      arca.transaccionesDuranteLosPedidos.length = 0;
      return { e, arca, c, entrada };
    }

    it("ARCA tiene autorizado el número en curso: cierra como autorizado y deja la auditoría exacta", async () => {
      const { e, arca, c, entrada } = await conReservaEnCurso(4);
      const { punto, tipo } = arcaDe(e);
      arca.falsa.fijarUltimo(punto, tipo, 5n);
      const r = await c.reconciliarSerie(e.sistema(despues(5)), entrada);
      expect(r).toEqual(
        ok({ tipo: "RECONCILIADA", resolucion: "CERRADA_COMO_AUTORIZADA", ultimoAutorizado: 5n }),
      );
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "5", en_curso: null });
      expect((await auditoria(e, "SERIE_DE_COMPROBANTES_RECONCILIADA"))[0]).toEqual({
        accion: "SERIE_DE_COMPROBANTES_RECONCILIADA",
        actor_persona_id: null,
        entidad: "serie_comprobante",
        entidad_id: `${e.puntoDeVenta}:FACTURA_B:HOMOLOGACION`,
        antes: {
          estado: "EN_CURSO",
          ambiente: "HOMOLOGACION",
          ultimoNumero: "4",
          numeroEnCurso: "5",
          solicitud: entrada.solicitud,
          enCursoHasta: despues(5).toISOString(),
        },
        despues: {
          estado: "LIBRE",
          ambiente: "HOMOLOGACION",
          ultimoNumero: "5",
          resolucion: "CERRADA_COMO_AUTORIZADA",
          solicitud: entrada.solicitud,
          ultimoAutorizadoPorElServicio: "5",
        },
      });
      expect(arca.transaccionesDuranteLosPedidos).toEqual([0]);
    });

    it("ARCA no autorizó el número en curso: libera la serie sin avanzar", async () => {
      const { e, arca, c, entrada } = await conReservaEnCurso(4);
      const { punto, tipo } = arcaDe(e);
      arca.falsa.fijarUltimo(punto, tipo, 4n);
      expect(await c.reconciliarSerie(e.sistema(despues(5)), entrada)).toEqual(
        ok({ tipo: "RECONCILIADA", resolucion: "LIBERADA", ultimoAutorizado: 4n }),
      );
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "4" });
    });

    it("desfase (ARCA informa otro número): la serie queda BLOQUEADA con el motivo y no se reserva más", async () => {
      const { e, arca, c, entrada } = await conReservaEnCurso(4);
      const { punto, tipo } = arcaDe(e);
      arca.falsa.fijarUltimo(punto, tipo, 9n);
      expect(await c.reconciliarSerie(e.sistema(despues(5)), entrada)).toEqual(
        ok({ tipo: "RECONCILIADA", resolucion: "BLOQUEADA", ultimoAutorizado: 9n }),
      );
      expect(await serie(e)).toMatchObject({
        estado: "BLOQUEADA",
        ultimo: "4",
        en_curso: null,
        motivo_bloqueo: "desfase con el servicio de emisión: informa 9, se esperaba 4 o 5",
      });
      expect((await auditoria(e, "SERIE_DE_COMPROBANTES_BLOQUEADA")).map((a) => a.despues)).toEqual(
        [
          {
            estado: "BLOQUEADA",
            ambiente: "HOMOLOGACION",
            ultimoNumero: "4",
            motivoBloqueo: "desfase con el servicio de emisión: informa 9, se esperaba 4 o 5",
            resolucion: "BLOQUEADA",
            solicitud: entrada.solicitud,
            ultimoAutorizadoPorElServicio: "9",
          },
        ],
      );
      expect(await c.reservarNumeroDeComprobante(e.como(despues(6)), entradaDe(e))).toEqual(
        err("SERIE_BLOQUEADA"),
      );
      // Una reconciliación más no la toca: la única salida de BLOQUEADA es resincronizarla (QF1).
      expect(await c.reconciliarSerie(e.sistema(despues(7)), entrada)).toEqual(
        ok({ tipo: "NADA_QUE_RECONCILIAR" }),
      );
    });

    it("repetir la reconciliación da el mismo éxito (NADA_QUE_RECONCILIAR) sin escribir ni auditar otra vez", async () => {
      const { e, arca, c, entrada } = await conReservaEnCurso();
      const { punto, tipo } = arcaDe(e);
      arca.falsa.fijarUltimo(punto, tipo, 1n);
      await c.reconciliarSerie(e.sistema(despues(5)), entrada);
      const antes = await serie(e);
      const consultas = arca.consultas;
      expect(await c.reconciliarSerie(e.sistema(despues(6)), entrada)).toEqual(
        ok({ tipo: "NADA_QUE_RECONCILIAR" }),
      );
      expect(await serie(e)).toEqual(antes);
      expect(arca.consultas).toBe(consultas);
      expect(await auditoria(e, "SERIE_DE_COMPROBANTES_RECONCILIADA")).toHaveLength(1);
    });

    it("el servicio caído deja la reserva como estaba y se reintenta cuando vuelve", async () => {
      const { e, arca, c, entrada } = await conReservaEnCurso();
      arca.falsa.servicioCaido = true;
      const antes = await serie(e);
      expect(await c.reconciliarSerie(e.sistema(despues(6)), entrada)).toEqual(
        err({ codigo: "SERVICIO_NO_DISPONIBLE", detalle: "servicio caído (falso)" }),
      );
      expect(await serie(e)).toEqual(antes);
      arca.falsa.servicioCaido = false;
      const r = await c.reconciliarSerie(e.sistema(despues(6)), entrada);
      expect(r.ok && r.valor).toMatchObject({ resolucion: "LIBERADA" });
    });

    it("si mientras se le pregunta a ARCA se cierra la reserva y otra solicitud toma la serie, la reconciliación no pisa a la nueva", async () => {
      const { e, arca, c, entrada } = await conReservaEnCurso();
      const { punto, tipo } = arcaDe(e);
      arca.falsa.fijarUltimo(punto, tipo, 0n);
      const otra = entradaDe(e);
      // Mientras ARCA responde (fuera de toda transacción): la primera se rechaza y la otra reserva.
      const original = arca.falsa.ultimoAutorizado.bind(arca.falsa);
      arca.falsa.ultimoAutorizado = async (...args) => {
        const respuesta = await original(...args);
        await c.cerrarReservaDeNumero(e.como(despues(5)), {
          ...entrada,
          numero: 1n,
          resultado: { tipo: "RECHAZADO", errores: [], observaciones: [] },
        });
        await c.reservarNumeroDeComprobante(e.como(despues(5)), otra);
        return respuesta;
      };
      expect(await c.reconciliarSerie(e.sistema(despues(5)), entrada)).toEqual(
        ok({ tipo: "NADA_QUE_RECONCILIAR" }),
      );
      expect(await serie(e)).toMatchObject({
        estado: "EN_CURSO",
        ultimo: "0",
        en_curso: "1",
        solicitud: otra.solicitud,
      });
      expect(await auditoria(e, "SERIE_DE_COMPROBANTES_RECONCILIADA")).toEqual([]);
    });

    it("una serie que no existe es SERIE_NO_ENCONTRADA y la de otra empresa, también", async () => {
      const e = await escenario();
      const ajena = await escenario();
      const c = casos(new EmisionVigilada());
      expect(
        await c.reconciliarSerie(e.sistema(despues(6)), entradaDe(e, undefined, "FACTURA_C")),
      ).toEqual(err("SERIE_NO_ENCONTRADA"));
      expect(await c.reconciliarSerie(e.sistema(despues(6)), entradaDe(ajena))).toEqual(
        err("SERIE_NO_ENCONTRADA"),
      );
    });

    it("reconciliarSeriesVencidas resuelve solo las vencidas de SU empresa, de la más vieja a la más nueva, y respeta el límite", async () => {
      const e = await escenario();
      const arca = new EmisionVigilada();
      const c = casos(arca);
      // Tres series de tipos distintos: A reservada en T0, B en T0+1, C en T0+3 (vence a T0+8).
      const tipos = ["FACTURA_A", "FACTURA_B", "FACTURA_C"] as const;
      for (const tipo of tipos.filter((t) => t !== "FACTURA_B")) {
        await crearSerie(dueno, e.mundo.empresa, e.puntoDeVenta, e.mundo.emisor, tipo, 0);
      }
      const minutos = { FACTURA_A: 0, FACTURA_B: 1, FACTURA_C: 3 } as const;
      for (const tipo of tipos) {
        const r = await c.reservarNumeroDeComprobante(
          e.como(despues(minutos[tipo])),
          entradaDe(e, undefined, tipo),
        );
        expect(r.ok).toBe(true);
      }
      // Otra empresa con una vencida: no se toca.
      const ajena = await escenario();
      await casos(new EmisionFalsa()).reservarNumeroDeComprobante(ajena.como(T0), entradaDe(ajena));

      // En T0+7: vencidas A (T0+5) y B (T0+6); C (T0+8) todavía no.
      const primera = await c.reconciliarSeriesVencidas(e.sistema(despues(7)), { limite: 1 });
      expect(primera.ok && primera.valor.hayMas).toBe(true);
      expect(primera.ok && primera.valor.series.map((s) => s.tipo)).toEqual(["FACTURA_A"]);
      const segunda = await c.reconciliarSeriesVencidas(e.sistema(despues(7)));
      expect(segunda.ok && segunda.valor).toEqual({
        hayMas: false,
        series: [
          {
            puntoDeVentaId: puntoDeVentaId(e.puntoDeVenta),
            tipo: "FACTURA_B",
            ambiente: "HOMOLOGACION",
            resultado: ok({
              tipo: "RECONCILIADA",
              resolucion: "LIBERADA",
              ultimoAutorizado: 0n,
            }),
          },
        ],
      });
      expect(await serie(e, "FACTURA_A")).toMatchObject({ estado: "LIBRE" });
      expect(await serie(e, "FACTURA_B")).toMatchObject({ estado: "LIBRE" });
      expect(await serie(e, "FACTURA_C")).toMatchObject({ estado: "EN_CURSO" });
      expect(await serie(ajena)).toMatchObject({ estado: "EN_CURSO" });
      // Repetir la corrida es seguro: no queda nada vencido.
      expect(await c.reconciliarSeriesVencidas(e.sistema(despues(7)))).toEqual(
        ok({ series: [], hayMas: false }),
      );
    });

    it("la reserva vence EXACTAMENTE a los cinco minutos: un milisegundo antes no se reconcilia y en el vencimiento sí", async () => {
      const e = await escenario();
      const c = casos(new EmisionVigilada());
      await c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e));
      const casiVencida = new Date(despues(5).getTime() - 1);
      expect(await c.reconciliarSeriesVencidas(e.sistema(casiVencida))).toEqual(
        ok({ series: [], hayMas: false }),
      );
      expect(await c.reconciliarSerie(e.sistema(casiVencida), entradaDe(e))).toEqual(
        err("RESERVA_NO_VENCIDA"),
      );
      const r = await c.reconciliarSeriesVencidas(e.sistema(despues(5)));
      expect(r.ok && r.valor.series.map((s) => s.resultado.ok)).toEqual([true]);
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "0" });
    });

    it("que una serie falle (ARCA caído) no frena a las demás: su error queda en su entrada", async () => {
      const e = await escenario();
      const arca = new EmisionVigilada();
      const c = casos(arca);
      await c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e));
      arca.falsa.servicioCaido = true;
      const r = await c.reconciliarSeriesVencidas(e.sistema(despues(6)));
      expect(r.ok && r.valor.series).toEqual([
        {
          puntoDeVentaId: puntoDeVentaId(e.puntoDeVenta),
          tipo: "FACTURA_B",
          ambiente: "HOMOLOGACION",
          resultado: err({ codigo: "SERVICIO_NO_DISPONIBLE", detalle: "servicio caído (falso)" }),
        },
      ]);
    });
  });

  // ===============================================================================================
  describe("aislamiento entre empresas", () => {
    it("dos empresas numeran a la vez sus propias series sin mezclarse: cada una empieza en 1", async () => {
      const a = await escenario();
      const b = await escenario();
      const c = casos(new EmisionFalsa());
      const [ra, rb] = await Promise.all([
        c.numerarComprobante(a.como(T0), entradaDe(a)),
        c.numerarComprobante(b.como(T0), entradaDe(b)),
      ]);
      expect(ra.ok && ra.valor.numero).toBe(1n);
      expect(rb.ok && rb.valor.numero).toBe(1n);
      expect(await serie(a)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
      expect(await serie(b)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
      expect(await auditoria(a)).toHaveLength(2);
      expect(await auditoria(b)).toHaveLength(2);
    });

    it("dos puntos de venta del mismo emisor tienen series independientes: los dos empiezan en 1", async () => {
      const m = await crearMundo(dueno);
      const pv1 = await crearPuntoDeVenta(dueno, m, { numero: 1, activo: true });
      const pv2 = await crearPuntoDeVenta(dueno, m, { numero: 2, activo: true });
      await crearSerie(dueno, m.empresa, pv1, m.emisor);
      await crearSerie(dueno, m.empresa, pv2, m.emisor);
      const persona = (
        await dueno.query<{ id: string }>("insert into persona (email) values ($1) returning id", [
          `${nuevoId()}@prueba.test`,
        ])
      ).rows[0]?.id as string;
      await dueno.query(
        "insert into membresia (empresa_id, persona_id, rol) values ($1, $2, 'GERENTE')",
        [m.empresa, persona],
      );
      const contexto = {
        tipo: "OPERATIVO",
        empresaId: empresaId(m.empresa),
        personaId: persona as never,
        marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
        ahora: T0,
      } as const;
      const c = casos(new EmisionFalsa());
      const r1 = await c.numerarComprobante(contexto, {
        puntoDeVentaId: puntoDeVentaId(pv1),
        tipo: "FACTURA_B",
        ambiente: "HOMOLOGACION",
        solicitud: solicitudId(nuevoId()),
      });
      const r2 = await c.numerarComprobante(contexto, {
        puntoDeVentaId: puntoDeVentaId(pv2),
        tipo: "FACTURA_B",
        ambiente: "HOMOLOGACION",
        solicitud: solicitudId(nuevoId()),
      });
      expect(r1.ok && r1.valor.numero).toBe(1n);
      expect(r2.ok && r2.valor.numero).toBe(1n);
    });
  });
});
