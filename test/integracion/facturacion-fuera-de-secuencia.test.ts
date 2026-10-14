import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  crearManejadorDeValidarComprobante,
  puntoDeVentaId,
  type ComprobanteId,
  type DependenciasDeFacturacion,
  type EmisionElectronica,
  type PuntoDeVentaParaEmision,
} from "../../src/modulos/fiscal/publico";
import { empresaId } from "../../src/primitivas/identificadores/marca";
import { CODIGO_FUERA_DE_SECUENCIA, EmisionFalsa } from "../utilidades/emision-falsa";
import { crearBaseAparte } from "./entorno";
import {
  RelojDePrueba,
  casosDeFacturacion,
  crearEntornoDeFacturacion,
  crearEscenarioDeCasos,
  facturaManual,
  type EscenarioDeCasos,
  type TxDeFacturacionDePrueba,
} from "./facturacion-casos-apoyo";
import { crearSerie } from "./fiscal-apoyo";
import { REGLAS_CON_FACTURACION } from "./fiscal-numeracion-apoyo";

/**
 * H7 facturación, pieza F5b: ARCA responde 10016 (numeración fuera de secuencia) a un número recién reservado
 * (tabla de §B.5.4). Contra una base real y con ARCA SIEMPRE falsa:
 *  - otro sistema usó el punto de venta (ARCA va adelante): el comprobante queda `RECHAZADO` (terminal, sin CAE) y
 *    la serie `BLOQUEADA` por desfase, en la misma transacción; no se rechaza cada comprobante nuevo uno por uno;
 *  - sin desfase (ARCA en el último número de la serie): rechazo común, serie `LIBRE`;
 *  - ARCA sin responder la consulta: la serie NO se libera en silencio, queda `BLOQUEADA`;
 *  - repetir (misma clave, el trabajo de nuevo, la reconciliación) no consulta ni cambia nada;
 *  - un corte en el cierre no deja nada a medias.
 * La concurrencia está en `facturacion-fuera-de-secuencia-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });

type Fila = Record<string, unknown>;

/** Un adaptador que cuenta cada llamada y delega en el falso: para probar que repetir no vuelve a preguntar. */
class ArcaContada implements EmisionElectronica {
  llamadas = { ultimoAutorizado: 0, autorizar: 0, consultar: 0 };
  /** Con `true`, `ultimoAutorizado` no vuelve nunca (el tiempo límite propio lo corta). */
  colgado = false;
  /** Con `true`, `ultimoAutorizado` lanza una excepción en vez de responder. */
  lanza = false;
  constructor(readonly falsa: EmisionFalsa) {}
  ultimoAutorizado: EmisionElectronica["ultimoAutorizado"] = (pv, tipo) => {
    this.llamadas.ultimoAutorizado += 1;
    if (this.lanza) return Promise.reject(new Error("el adaptador falló"));
    if (this.colgado) return new Promise(() => undefined);
    return this.falsa.ultimoAutorizado(pv, tipo);
  };
  autorizar: EmisionElectronica["autorizar"] = (s) => {
    this.llamadas.autorizar += 1;
    return this.falsa.autorizar(s);
  };
  consultar: EmisionElectronica["consultar"] = (pv, tipo, n) => {
    this.llamadas.consultar += 1;
    return this.falsa.consultar(pv, tipo, n);
  };
}

describe.skipIf(base === null)(
  "facturación F5b: rechazo 10016 (numeración fuera de secuencia)",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: ReturnType<typeof crearEntornoDeFacturacion>;
    /** Lo que se le agrega a la transacción de cada caso de uso (una falla inyectada). */
    let ajuste: (tx: TxDeFacturacionDePrueba) => TxDeFacturacionDePrueba = (tx) => tx;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDeFacturacion(propia.base, 8, (tx) => ajuste(tx));
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

    const comprobante = async (id: string) =>
      (
        await filas(
          `select estado, envios, numero_reservado::text as reservado, numero::text as numero, cae, version
           from comprobante where id = $1`,
          [id],
        )
      )[0];
    const serie = async (e: EscenarioDeCasos) =>
      (
        await filas(
          `select estado, ultimo_numero::text as ultimo, numero_en_curso::text as en_curso, motivo_bloqueo as motivo,
                version
           from serie_comprobante where punto_de_venta_id = $1 and tipo_comprobante = 'FACTURA_B'
            and ambiente = 'HOMOLOGACION'`,
          [e.pv],
        )
      )[0];
    const intentos = async (id: string) =>
      await filas(
        `select operacion, desenlace, numero::text as numero, mensajes from intento_arca
        where comprobante_id = $1 order by iniciado_en, operacion`,
        [id],
      );
    const auditorias = async (e: EscenarioDeCasos, entidad: string) =>
      await filas<{ accion: string; actor: string | null; despues: Record<string, unknown> }>(
        `select accion, actor_persona_id as actor, despues from auditoria_empresa
        where empresa_id = $1 and entidad_id = $2 order by id`,
        [e.empresa, entidad],
      );
    const entidadDeLaSerie = (e: EscenarioDeCasos) => `${e.pv}:FACTURA_B:HOMOLOGACION`;
    /** Lo que haría el procesador de trabajos: los de validación vivos del comprobante terminan HECHO. */
    const terminarTrabajos = async (id: string) => {
      const vivos = "starts_with(clave_idempotencia, $1) and estado in ('PENDIENTE', 'EN_CURSO')";
      await dueno.query(
        `update trabajo set estado = 'EN_CURSO' where ${vivos} and estado = 'PENDIENTE'`,
        [`fiscal.validar:${id}:`],
      );
      await dueno.query(`update trabajo set estado = 'HECHO' where ${vivos}`, [
        `fiscal.validar:${id}:`,
      ]);
    };
    /** Todo lo que una repetición podría cambiar, para compararlo antes y después. */
    const instantanea = async (e: EscenarioDeCasos) => ({
      comprobantes: await filas(
        "select id, estado, version, numero_reservado, numero, cae from comprobante where empresa_id = $1 order by id",
        [e.empresa],
      ),
      series: await filas("select * from serie_comprobante where empresa_id = $1", [e.empresa]),
      auditoria: await filas(
        "select accion, entidad_id from auditoria_empresa where empresa_id = $1 order by id",
        [e.empresa],
      ),
      intentos: await filas(
        "select id, operacion, desenlace from intento_arca where empresa_id = $1 order by id",
        [e.empresa],
      ),
    });

    /**
     * Una empresa con su serie ya creada en 0 (como si el punto de venta ya hubiera facturado y ARCA estuviera
     * en 0) y ARCA falsa contada. `adelantar(n)` hace que otro sistema emita hasta `n` en el mismo punto de venta.
     */
    async function preparar(
      opciones: { ultimo?: number; tiempos?: { ultimoAutorizadoEnMs: number } } = {},
    ) {
      const e = await crearEscenarioDeCasos(dueno, propia.base, { rol: "GERENTE" });
      await crearSerie(dueno, e.empresa, e.pv, e.emisor, "FACTURA_B", opciones.ultimo ?? 0);
      const reloj = new RelojDePrueba(new Date());
      const falsa = new EmisionFalsa();
      const arca = new ArcaContada(falsa);
      const pv = { cuit: e.cuit, numero: e.pvNumero } as PuntoDeVentaParaEmision;
      if (opciones.ultimo !== undefined)
        falsa.fijarUltimo(pv, "FACTURA_B", BigInt(opciones.ultimo));
      const tiempos = {
        autorizarEnMs: 2_000,
        consultarEnMs: 2_000,
        ultimoAutorizadoEnMs: opciones.tiempos?.ultimoAutorizadoEnMs ?? 2_000,
      };
      const casos = casosDeFacturacion(
        entorno,
        { HOMOLOGACION: arca, PRODUCCION: new EmisionFalsa() },
        reloj,
        { tiempos },
      );
      const dependencias: DependenciasDeFacturacion = {
        transacciones: entorno,
        reglas: REGLAS_CON_FACTURACION,
        emision: { para: (_e, _x, ambiente) => (ambiente === "HOMOLOGACION" ? arca : falsa) },
        reloj,
        opciones: { tiempos },
      };
      return {
        e,
        reloj,
        falsa,
        arca,
        casos,
        dependencias,
        pv,
        adelantar: (n: bigint) => falsa.fijarUltimo(pv, "FACTURA_B", n),
        como: () => e.como(reloj.ahora()),
        sistema: () => e.sistema(reloj.ahora()),
        emitir: async (): Promise<{ id: ComprobanteId; clave: string }> => {
          const pedido = facturaManual(e);
          const r = await casos.emitirComprobanteManual(e.como(reloj.ahora()), pedido);
          if (!r.ok) throw new Error(`no se emitió: ${JSON.stringify(r.error)}`);
          return { id: r.valor.comprobanteId, clave: pedido.clave };
        },
        validar: (id: ComprobanteId) =>
          casos.validarComprobante(e.sistema(reloj.ahora()), { comprobanteId: id }),
        resincronizar: (ultimoVistoEnArca: bigint) =>
          casos.resincronizarSerie(e.como(reloj.ahora()), {
            puntoDeVentaId: puntoDeVentaId(e.pv),
            tipo: "FACTURA_B",
            ambiente: "HOMOLOGACION",
            ultimoVistoEnArca,
            motivo: "otro sistema usó el punto de venta",
          }),
      };
    }

    const MENSAJE_10016 = {
      clase: "ERROR",
      codigo: CODIGO_FUERA_DE_SECUENCIA,
      texto: expect.stringContaining("fuera de secuencia") as unknown,
    };

    // ===============================================================================================
    describe("ARCA va adelante: otro sistema usó el punto de venta", () => {
      it("el comprobante queda RECHAZADO sin CAE y la serie BLOQUEADA por desfase, sin avanzar; todo auditado", async () => {
        const p = await preparar();
        p.adelantar(5n);
        const { id } = await p.emitir();

        const r = await p.validar(id);
        expect(r).toEqual({
          ok: true,
          valor: {
            tipo: "ENVIADO",
            numero: 1n,
            desenlace: "RECHAZADO",
            cerrado: true,
            serieBloqueada: true,
          },
        });
        // El comprobante: terminal, con el número que se intentó (para diagnosticar), sin número ni CAE.
        expect(await comprobante(id)).toMatchObject({
          estado: "RECHAZADO",
          reservado: "1",
          numero: null,
          cae: null,
        });
        // La serie: BLOQUEADA, el último número no avanzó y el motivo dice qué pasó.
        expect(await serie(p.e)).toMatchObject({
          estado: "BLOQUEADA",
          ultimo: "0",
          en_curso: null,
          motivo:
            "desfase con ARCA: informa 5 como último autorizado y el número 1 se rechazó por fuera de secuencia (10016); se esperaba 0",
        });
        // Lo que se le preguntó a ARCA: un pedido y una consulta del último, nunca un reenvío.
        expect(p.arca.llamadas).toEqual({ ultimoAutorizado: 1, autorizar: 1, consultar: 0 });
        // Los intentos: el rechazo (con su 10016) y la consulta del último, con lo que ARCA respondió.
        expect(await intentos(id)).toEqual([
          {
            operacion: "AUTORIZAR",
            desenlace: "RECHAZADO",
            numero: "1",
            mensajes: [MENSAJE_10016],
          },
          { operacion: "ULTIMO_AUTORIZADO", desenlace: "RESPONDIDO", numero: "5", mensajes: [] },
        ]);
      });

      it("la auditoría dice qué, quién y qué vio ARCA, en las dos entidades y sin textos de ARCA", async () => {
        const p = await preparar();
        p.adelantar(5n);
        const { id } = await p.emitir();
        await p.validar(id);

        const deLaSerie = await auditorias(p.e, entidadDeLaSerie(p.e));
        expect(deLaSerie.map((a) => a.accion)).toEqual([
          "NUMERO_DE_COMPROBANTE_RESERVADO",
          "SERIE_BLOQUEADA",
        ]);
        expect(deLaSerie[1]).toMatchObject({
          actor: null,
          despues: {
            estado: "BLOQUEADA",
            ultimoNumero: "0",
            numero: "1",
            solicitud: id,
            errores: [10016],
            observaciones: [],
            resolucion: "BLOQUEADA",
            ultimoAutorizadoPorElServicio: "5",
          },
        });
        expect(deLaSerie[1]?.despues["motivoBloqueo"]).toEqual(expect.stringContaining("desfase"));
        const delComprobante = await auditorias(p.e, id);
        expect(delComprobante.map((a) => a.accion)).toEqual([
          "COMPROBANTE_CREADO",
          "COMPROBANTE_EN_VALIDACION",
          "COMPROBANTE_RECHAZADO",
        ]);
        expect(delComprobante[2]).toMatchObject({
          actor: null,
          despues: {
            estado: "RECHAZADO",
            errores: [10016],
            ultimoAutorizadoPorElServicio: "5",
            serie: "BLOQUEADA",
          },
        });
        // Los textos de ARCA no llegan a la auditoría.
        const todo = JSON.stringify([deLaSerie, delComprobante]);
        expect(todo).not.toContain("numeración fuera de secuencia");
      });

      it("no se rechaza cada comprobante nuevo: el siguiente espera con la serie bloqueada y no sale a ARCA", async () => {
        const p = await preparar();
        p.adelantar(5n);
        const primero = await p.emitir();
        await p.validar(primero.id);
        const segundo = await p.emitir();
        const pedidos = p.falsa.pedidos.length;
        const llamadas = { ...p.arca.llamadas };

        expect(await p.validar(segundo.id)).toEqual({
          ok: true,
          valor: { tipo: "SERIE_BLOQUEADA" },
        });
        expect(await comprobante(segundo.id)).toMatchObject({
          estado: "PENDIENTE",
          reservado: null,
        });
        expect(p.falsa.pedidos).toHaveLength(pedidos);
        expect(p.arca.llamadas).toEqual(llamadas);
      });

      it("el gerente resincroniza con lo que ve en ARCA, el comprobante pendiente sale con el siguiente número y el rechazado sigue rechazado", async () => {
        const p = await preparar();
        p.adelantar(5n);
        const primero = await p.emitir();
        await p.validar(primero.id);
        const segundo = await p.emitir();
        await p.validar(segundo.id);
        await terminarTrabajos(segundo.id);

        // Visto distinto de lo que ARCA dice: no se resincroniza con un dato viejo.
        expect(await p.resincronizar(3n)).toEqual({
          ok: false,
          error: "ULTIMO_DISTINTO_DEL_DE_ARCA",
        });
        expect(await p.resincronizar(5n)).toEqual({
          ok: true,
          valor: { ultimoNumero: 5n, reencolados: 1 },
        });
        expect(await serie(p.e)).toMatchObject({ estado: "LIBRE", ultimo: "5" });
        expect(await p.resincronizar(5n)).toEqual({ ok: false, error: "SERIE_NO_BLOQUEADA" });

        expect(await p.validar(segundo.id)).toMatchObject({
          ok: true,
          valor: { numero: 6n, desenlace: "AUTORIZADO" },
        });
        expect(await comprobante(segundo.id)).toMatchObject({ estado: "AUTORIZADO", numero: "6" });
        expect(await comprobante(primero.id)).toMatchObject({ estado: "RECHAZADO", cae: null });
        expect(await serie(p.e)).toMatchObject({ estado: "LIBRE", ultimo: "6" });
        const acciones = (await auditorias(p.e, entidadDeLaSerie(p.e))).map((a) => a.accion);
        expect(acciones).toEqual([
          "NUMERO_DE_COMPROBANTE_RESERVADO",
          "SERIE_BLOQUEADA",
          "SERIE_RESINCRONIZADA",
          "NUMERO_DE_COMPROBANTE_RESERVADO",
          "NUMERO_DE_COMPROBANTE_AUTORIZADO",
        ]);
      });

      it("ARCA justo en el número reservado (otro sistema se lo llevó) también es desfase", async () => {
        const p = await preparar();
        p.adelantar(1n);
        const { id } = await p.emitir();
        expect(await p.validar(id)).toMatchObject({
          ok: true,
          valor: { desenlace: "RECHAZADO", serieBloqueada: true },
        });
        expect(await serie(p.e)).toMatchObject({ estado: "BLOQUEADA", ultimo: "0" });
      });

      it("ARCA atrás de la serie (la serie guardó más de lo que ARCA tiene) bloquea igual y solo soporte la sale", async () => {
        const p = await preparar({ ultimo: 7 });
        p.adelantar(4n);
        const { id } = await p.emitir();
        expect(await p.validar(id)).toMatchObject({
          ok: true,
          valor: { numero: 8n, desenlace: "RECHAZADO", serieBloqueada: true },
        });
        expect(await serie(p.e)).toMatchObject({ estado: "BLOQUEADA", ultimo: "7" });
        expect(await p.resincronizar(4n)).toEqual({ ok: false, error: "DESFASE_HACIA_ATRAS" });
        expect(await serie(p.e)).toMatchObject({ estado: "BLOQUEADA", ultimo: "7" });
      });

      it("el manejador del trabajo termina HECHO con la nota de la serie bloqueada", async () => {
        const p = await preparar();
        p.adelantar(5n);
        const { id } = await p.emitir();
        const manejador = crearManejadorDeValidarComprobante(p.dependencias);
        const trabajo = {
          id: "00000000-0000-4000-8000-000000000001",
          empresaId: empresaId(p.e.empresa),
          tipo: "fiscal.validar_comprobante",
          datos: { comprobanteId: id },
          intentos: 1,
        };
        expect(await manejador(trabajo, p.reloj.ahora())).toEqual({
          tipo: "HECHO",
          nota: "SERIE_BLOQUEADA: rechazo 10016, espera la resincronización",
        });
      });
    });

    // ===============================================================================================
    describe("sin desfase: el 10016 con ARCA en el último número de la serie sigue como cualquier rechazo", () => {
      it("RECHAZADO y la serie LIBRE sin avanzar; el siguiente comprobante recibe el MISMO número y se autoriza", async () => {
        const p = await preparar();
        // 10016 por la fecha («número o fecha»): ARCA está en 0 y el número reservado es el 1.
        p.falsa.programar({
          guion: "RECHAZA",
          errores: [{ codigo: CODIGO_FUERA_DE_SECUENCIA, texto: "fuera de secuencia (por fecha)" }],
        });
        const { id } = await p.emitir();
        expect(await p.validar(id)).toEqual({
          ok: true,
          valor: { tipo: "ENVIADO", numero: 1n, desenlace: "RECHAZADO", cerrado: true },
        });
        expect(await comprobante(id)).toMatchObject({
          estado: "RECHAZADO",
          numero: null,
          cae: null,
        });
        expect(await serie(p.e)).toMatchObject({ estado: "LIBRE", ultimo: "0", motivo: null });
        expect((await intentos(id)).map((i) => [i.operacion, i.desenlace, i.numero])).toEqual([
          ["AUTORIZAR", "RECHAZADO", "1"],
          ["ULTIMO_AUTORIZADO", "RESPONDIDO", "0"],
        ]);
        const deLaSerie = await auditorias(p.e, entidadDeLaSerie(p.e));
        expect(deLaSerie.map((a) => a.accion)).toEqual([
          "NUMERO_DE_COMPROBANTE_RESERVADO",
          "NUMERO_DE_COMPROBANTE_RECHAZADO",
        ]);
        expect(deLaSerie[1]?.despues).toMatchObject({
          errores: [10016],
          resolucion: "LIBERADA",
          ultimoAutorizadoPorElServicio: "0",
        });

        const siguiente = await p.emitir();
        expect(await p.validar(siguiente.id)).toMatchObject({
          ok: true,
          valor: { numero: 1n, desenlace: "AUTORIZADO" },
        });
        expect(await serie(p.e)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
      });

      it("un rechazo que no es 10016 no consulta el último autorizado: la serie se libera como siempre", async () => {
        const p = await preparar();
        p.falsa.programar({ guion: "RECHAZA", errores: [{ codigo: 10015, texto: "documento" }] });
        const { id } = await p.emitir();
        await p.validar(id);
        expect(p.arca.llamadas).toEqual({ ultimoAutorizado: 0, autorizar: 1, consultar: 0 });
        expect(await serie(p.e)).toMatchObject({ estado: "LIBRE", ultimo: "0" });
        expect((await intentos(id)).map((i) => i.operacion)).toEqual(["AUTORIZAR"]);
      });
    });

    // ===============================================================================================
    describe("ARCA no responde la consulta del último autorizado: la serie no se libera en silencio", () => {
      const rechazoFueraDeSecuencia = {
        guion: "RECHAZA",
        errores: [{ codigo: CODIGO_FUERA_DE_SECUENCIA, texto: "fuera de secuencia" }],
      } as const;

      const esperaBloqueada = async (
        p: Awaited<ReturnType<typeof preparar>>,
        id: ComprobanteId,
      ) => {
        expect(await comprobante(id)).toMatchObject({ estado: "RECHAZADO", cae: null });
        expect(await serie(p.e)).toMatchObject({
          estado: "BLOQUEADA",
          ultimo: "0",
          motivo:
            "desfase posible con ARCA: el número 1 se rechazó por fuera de secuencia (10016) y no se pudo consultar el último autorizado; se esperaba 0",
        });
        expect(await intentos(id)).toEqual([
          {
            operacion: "AUTORIZAR",
            desenlace: "RECHAZADO",
            numero: "1",
            mensajes: [MENSAJE_10016],
          },
          {
            operacion: "ULTIMO_AUTORIZADO",
            desenlace: "CONSULTA_FALLIDA",
            numero: null,
            mensajes: [],
          },
        ]);
        const deLaSerie = await auditorias(p.e, entidadDeLaSerie(p.e));
        expect(deLaSerie.at(-1)).toMatchObject({
          accion: "SERIE_BLOQUEADA",
          despues: { ultimoAutorizadoPorElServicio: null, resolucion: "BLOQUEADA" },
        });
      };

      it("servicio no disponible: RECHAZADO y serie BLOQUEADA; resincronizar con ARCA de vuelta en el último número la libera sin saltar", async () => {
        const p = await preparar();
        p.falsa.programar(rechazoFueraDeSecuencia);
        p.falsa.servicioCaido = true;
        const { id } = await p.emitir();
        expect(await p.validar(id)).toMatchObject({
          ok: true,
          valor: { desenlace: "RECHAZADO", serieBloqueada: true },
        });
        await esperaBloqueada(p, id);

        // ARCA no responde: no se puede resincronizar a ciegas.
        expect(await p.resincronizar(0n)).toMatchObject({ ok: false });
        expect(await serie(p.e)).toMatchObject({ estado: "BLOQUEADA" });
        p.falsa.servicioCaido = false;
        expect(await p.resincronizar(0n)).toEqual({
          ok: true,
          valor: { ultimoNumero: 0n, reencolados: 0 },
        });
        expect(await serie(p.e)).toMatchObject({ estado: "LIBRE", ultimo: "0" });
        const siguiente = await p.emitir();
        expect(await p.validar(siguiente.id)).toMatchObject({
          ok: true,
          valor: { numero: 1n, desenlace: "AUTORIZADO" },
        });
      });

      it("el adaptador no vuelve: el tiempo límite propio lo corta y se bloquea igual", async () => {
        const p = await preparar({ tiempos: { ultimoAutorizadoEnMs: 50 } });
        p.falsa.programar(rechazoFueraDeSecuencia);
        p.arca.colgado = true;
        const { id } = await p.emitir();
        await p.validar(id);
        await esperaBloqueada(p, id);
      });

      it("el adaptador lanza una excepción: se trata como no respondido y se bloquea igual", async () => {
        const p = await preparar();
        p.falsa.programar(rechazoFueraDeSecuencia);
        p.arca.lanza = true;
        const { id } = await p.emitir();
        await p.validar(id);
        await esperaBloqueada(p, id);
      });
    });

    // ===============================================================================================
    describe("repetir no cambia nada ni vuelve a preguntar", () => {
      it("la misma clave, el trabajo otra vez y la reconciliación después del bloqueo devuelven lo mismo y no tocan nada", async () => {
        const p = await preparar();
        p.adelantar(5n);
        const pedido = facturaManual(p.e);
        const emitido = await p.casos.emitirComprobanteManual(p.como(), pedido);
        if (!emitido.ok) throw new Error("no se emitió");
        const id = emitido.valor.comprobanteId;
        await p.validar(id);
        const antes = await instantanea(p.e);
        const llamadas = { ...p.arca.llamadas };
        const pedidos = p.falsa.pedidos.length;

        // La misma clave y el mismo pedido: el mismo comprobante, ya rechazado.
        expect(await p.casos.emitirComprobanteManual(p.como(), pedido)).toEqual({
          ok: true,
          valor: {
            comprobanteId: id,
            estado: "RECHAZADO",
            tipo: "FACTURA_B",
            total: "121.00",
            yaExistia: true,
          },
        });
        // El trabajo de validación otra vez (un reintento de la cola): nada que validar.
        expect(await p.validar(id)).toEqual({
          ok: true,
          valor: { tipo: "NADA_QUE_VALIDAR", estado: "RECHAZADO" },
        });
        // La reconciliación mucho después: no hay nada en vuelo y el rechazado no se contradice.
        p.reloj.avanzar(60);
        expect(await p.casos.reconciliarComprobantes(p.sistema())).toEqual({
          ok: true,
          valor: { comprobantes: [], reencolados: 0 },
        });
        p.reloj.avanzar(24 * 60);
        expect(await p.casos.reconciliarComprobantes(p.sistema())).toEqual({
          ok: true,
          valor: { comprobantes: [], reencolados: 0 },
        });

        expect(await instantanea(p.e)).toEqual(antes);
        expect(p.arca.llamadas).toEqual(llamadas);
        expect(p.falsa.pedidos).toHaveLength(pedidos);
        expect(await comprobante(id)).toMatchObject({ estado: "RECHAZADO", cae: null });
        expect(await serie(p.e)).toMatchObject({ estado: "BLOQUEADA", ultimo: "0" });
      });

      it("la misma clave con otro pedido sigue siendo CLAVE_REUTILIZADA aunque el original esté rechazado y la serie bloqueada", async () => {
        const p = await preparar();
        p.adelantar(5n);
        const pedido = facturaManual(p.e);
        const emitido = await p.casos.emitirComprobanteManual(p.como(), pedido);
        if (!emitido.ok) throw new Error("no se emitió");
        await p.validar(emitido.valor.comprobanteId);
        const otro = { ...pedido, concepto: "SERVICIOS" as const, servicio: null };
        expect(await p.casos.emitirComprobanteManual(p.como(), otro)).toEqual({
          ok: false,
          error: "CLAVE_REUTILIZADA",
        });
      });

      it("una repetición mientras la serie está bloqueada por otro comprobante no consulta de más", async () => {
        const p = await preparar();
        p.adelantar(5n);
        const primero = await p.emitir();
        const segundo = await p.emitir();
        await p.validar(primero.id);
        const llamadas = { ...p.arca.llamadas };
        for (let i = 0; i < 3; i++) await p.validar(segundo.id);
        expect(p.arca.llamadas).toEqual(llamadas);
        expect(await comprobante(segundo.id)).toMatchObject({ estado: "PENDIENTE" });
      });
    });

    // ===============================================================================================
    describe("un corte en el cierre no deja nada a medias", () => {
      it("si la transacción del cierre falla, ni la serie ni el comprobante cambian; la reconciliación lo resuelve como conflicto y bloquea", async () => {
        const p = await preparar();
        p.adelantar(5n);
        const { id } = await p.emitir();
        ajuste = (tx) => ({
          ...tx,
          comprobantes: {
            ...tx.comprobantes,
            transicionar: (empresa, cid, version, cambio) => {
              if (cambio.a === "RECHAZADO") throw new Error("falla inyectada en el cierre");
              return tx.comprobantes.transicionar(empresa, cid, version, cambio);
            },
          },
        });
        try {
          await expect(p.validar(id)).rejects.toThrow("falla inyectada");
        } finally {
          ajuste = (tx) => tx;
        }
        // Nada a medias: la reserva sigue y el comprobante sigue en vuelo.
        expect(await comprobante(id)).toMatchObject({ estado: "EN_VALIDACION", reservado: "1" });
        expect(await serie(p.e)).toMatchObject({ estado: "EN_CURSO", ultimo: "0", en_curso: "1" });
        expect((await auditorias(p.e, entidadDeLaSerie(p.e))).map((a) => a.accion)).toEqual([
          "NUMERO_DE_COMPROBANTE_RESERVADO",
        ]);

        // Vencida la reserva, la reconciliación consulta el número (ARCA ya pasó de él) y bloquea la serie.
        p.reloj.avanzar(6);
        expect(await p.casos.reconciliarComprobantes(p.sistema())).toMatchObject({
          ok: true,
          valor: {
            comprobantes: [{ comprobanteId: id, resultado: { ok: true, valor: "CONFLICTO" } }],
          },
        });
        expect(await serie(p.e)).toMatchObject({ estado: "BLOQUEADA", ultimo: "0" });
        expect(await comprobante(id)).toMatchObject({ estado: "CONFLICTO", cae: null });
      });
    });
  },
);
