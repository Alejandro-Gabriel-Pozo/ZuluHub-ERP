import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { randomUUID } from "node:crypto";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCaja,
  crearEntornoDeCaja,
  otraSucursalDeCaja,
  sumarPersona,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import {
  cobrarComoVentas,
  crearMundoDeCobro,
  entradaDeCobro,
  importe,
  type MundoDeCobro,
} from "./caja-cobrar-apoyo";
import { claveNueva, conAhora, instanteLocal, pesos } from "./caja-operacion-apoyo";

/**
 * La devolución con medio de un cobro de ticket (DM-2) con una base real: `devolverDinero` y `anularDevolucion`, la consulta `cobrosDevolublesDeUnOrigen` y el rechazo del camino
 * genérico (`anularMovimientoDeCaja`) sobre el egreso de una devolución. Cubre: el feliz (por otro medio, mixto y parcial), el tope por cobranza, el efectivo que no alcanza (avisa, no
 * bloquea), la idempotencia (la misma clave, otro contenido, tras consumir el tope), la concurrencia (dos devoluciones que no caben juntas, la misma clave a la vez, devolver contra
 * iniciar el cierre, dos anulaciones a la vez), los permisos, el aislamiento por empresa y sucursal, las validaciones, la atomicidad con falla inyectada y la integridad del pedido
 * al anular. El tope y el bloqueo por cobranza son de la base (DM-1: `devolucion-de-un-cobro-migracion.test.ts`).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

type Fila = Record<string, unknown>;
const UUID_QUE_NO_EXISTE = "99999999-9999-4999-8999-999999999999";
const SIN_PERMISO = { ok: false, error: "SIN_PERMISO" };
type TipoDeMedio = keyof MundoDeCobro["medios"];

describe.skipIf(base === null)("caja: devolver dinero de un cobro de ticket", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  /** Fallas inyectadas (atomicidad e integridad): se ponen por prueba y se vuelven a `NINGUNA`. */
  let falla: "NINGUNA" | "EN_EL_2DO_ACTO" | "EN_LA_AUDITORIA" = "NINGUNA";
  let pedidoMezclado = false;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    const conFallas = (tx: TxDeCajaDePrueba): TxDeCajaDePrueba => {
      let altas = 0;
      return {
        ...tx,
        movimientosDeDinero: {
          ...tx.movimientosDeDinero,
          insertar: async (nuevo) => {
            altas += 1;
            if (falla === "EN_EL_2DO_ACTO" && altas === 2) {
              throw new Error("falla inyectada al insertar el segundo acto");
            }
            return tx.movimientosDeDinero.insertar(nuevo);
          },
          // Un pedido «mezclado»: la segunda línea cita OTRA cobranza (lo que un alta armada a mano podría dejar).
          deLaDevolucion: async (...a) => {
            const lineas = await tx.movimientosDeDinero.deLaDevolucion(...a);
            if (!pedidoMezclado || lineas.length < 2) return lineas;
            return lineas.map((l, i) =>
              i === 1 && l.devuelveOrigen !== null
                ? { ...l, devuelveOrigen: { ...l.devuelveOrigen, id: UUID_QUE_NO_EXISTE } }
                : l,
            );
          },
        },
        auditoria: {
          registrar: async (registro) => {
            if (falla === "EN_LA_AUDITORIA" && registro.accion === "DEVOLUCION_REGISTRADA") {
              throw new Error("falla inyectada en la auditoría de la devolución");
            }
            await tx.auditoria.registrar(registro);
          },
        },
      };
    };
    entorno = crearEntornoDeCaja(propia.base, 8, conFallas);
    caja = armarCaja(entorno);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  const casos = () => caja.casos;
  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const mundo = (rol: "GERENTE" | "ADMINISTRADOR" = "GERENTE") =>
    crearMundoDeCobro(entornoBase, dueno, caja, { rol });
  const en = (minutos = 0) => new Date(instanteLocal(1, "10:00").getTime() + minutos * 60_000);
  const ctxEn = (m: MundoDeCobro, minutos = 5) => conAhora(m.ctx(), en(minutos));

  const abrir = async (m: MundoDeCobro, fondo = "1000.00"): Promise<string> => {
    const r = await casos().abrirSesion(ctxEn(m, 0), {
      claveDeIdempotencia: claveNueva(),
      sucursalId: m.sucursal,
      cajaId: m.cajaId,
      fondoInicial: pesos(fondo),
    });
    if (!r.ok) throw new Error(`no se pudo abrir la sesión: ${JSON.stringify(r.error)}`);
    return r.valor.sesionId;
  };
  /** Una cobranza de ticket: un cobro por parte, todos con el mismo origen. Devuelve el id de la cobranza. */
  const cobranza = async (
    m: MundoDeCobro,
    partes: ReadonlyArray<readonly [TipoDeMedio, string]>,
  ): Promise<string> => {
    const id = randomUUID();
    let orden = 1;
    for (const [tipo, monto] of partes) {
      const r = await cobrarComoVentas(
        entorno,
        ctxEn(m, 1),
        entradaDeCobro(m, {
          origen: { tipo: "ventas.cobranza_de_ticket", id },
          origenOrden: orden++,
          medioDePagoId: m.medios[tipo],
          importe: importe(monto),
        }),
      );
      if (!r.ok) throw new Error(`no se pudo cobrar: ${JSON.stringify(r.error)}`);
    }
    return id;
  };
  const linea = (m: MundoDeCobro, tipo: TipoDeMedio, monto: string) => ({
    medioDePagoId: m.medios[tipo],
    cuentaDeCobroId: null,
    importe: pesos(monto),
  });
  const devolver = (
    m: MundoDeCobro,
    cobranzaId: string,
    lineas: ReturnType<typeof linea>[],
    resto: Partial<Parameters<ReturnType<typeof casos>["devolverDinero"]>[1]> = {},
    ctx: ContextoOperativo = ctxEn(m),
  ) =>
    casos().devolverDinero(ctx, {
      claveDeIdempotencia: claveNueva(),
      cajaId: m.cajaId,
      cobranzaId,
      lineas,
      motivo: "Producto en mal estado",
      ...resto,
    });
  const exito = async <T>(
    promesa: Promise<{ ok: boolean; valor?: T; error?: unknown }>,
  ): Promise<T> => {
    const r = await promesa;
    if (!r.ok) throw new Error(`se esperaba éxito: ${JSON.stringify(r.error)}`);
    return r.valor as T;
  };
  const anular = (
    m: MundoDeCobro,
    devolucionId: string,
    resto: Partial<Parameters<ReturnType<typeof casos>["anularDevolucion"]>[1]> = {},
    ctx: ContextoOperativo = ctxEn(m, 10),
  ) =>
    casos().anularDevolucion(ctx, {
      claveDeIdempotencia: claveNueva(),
      devolucionId,
      motivo: "Se devolvió por error",
      ...resto,
    });

  const auditorias = (m: MundoDeCobro, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      m.empresa,
      accion,
    ]);
  const actosDe = (m: MundoDeCobro) =>
    filas(
      `select id, categoria, importe::text as importe, motivo, devuelve_origen_tipo, devuelve_origen_id, devolucion_id, movimiento_id,
              tercero_nombre, tercero_persona_id, registrado_en
         from movimiento_de_dinero where empresa_id = $1 order by registrado_en, id`,
      [m.empresa],
    );
  const egresosDe = (m: MundoDeCobro) =>
    filas(
      `select id, clase, medio_de_pago_id, cuenta_de_cobro_id, importe::text as importe, anula_a
         from movimiento_caja where empresa_id = $1 and clase in ('EGRESO_MANUAL', 'ANULACION') order by registrado_en, id`,
      [m.empresa],
    );
  /** Todo lo que escribe una devolución: movimientos de caja, actos y la cuenta de auditorías. */
  const foto = async (m: MundoDeCobro) =>
    JSON.stringify({
      movimientos: await filas("select * from movimiento_caja where empresa_id = $1 order by id", [
        m.empresa,
      ]),
      actos: await filas("select * from movimiento_de_dinero where empresa_id = $1 order by id", [
        m.empresa,
      ]),
      auditoria: await contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        m.empresa,
      ]),
    });
  const registradoDe = async (m: MundoDeCobro, tipo: TipoDeMedio): Promise<string> =>
    (
      await filas<{ t: string }>(
        "select coalesce(sum(importe), 0)::text as t from movimiento_caja where empresa_id = $1 and medio_de_pago_id = $2",
        [m.empresa, m.medios[tipo]],
      )
    )[0]?.t as string;

  // ===========================================================================================
  describe("feliz", () => {
    it("un cobro en efectivo devuelto por TRANSFERENCIA: un egreso en la transferencia y un acto; el efectivo esperado no cambia; no hay aviso", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "10000.00"]]);
      const efectivoAntes = await registradoDe(m, "EFECTIVO");
      const r = await exito(
        devolver(m, c, [linea(m, "TRANSFERENCIA", "10000.00")], { motivo: "Se cobró de más" }),
      );
      expect(r.yaExistia).toBe(false);
      expect(r.avisos).toEqual([]);
      expect(r.quedaPorDevolver).toEqual(pesos("0.00"));
      expect(r.actos).toHaveLength(1);
      const egresos = (await egresosDe(m)).filter((e) => e.clase === "EGRESO_MANUAL");
      expect(egresos).toHaveLength(1);
      expect(egresos[0]).toMatchObject({
        medio_de_pago_id: m.medios.TRANSFERENCIA,
        cuenta_de_cobro_id: null,
        importe: "-10000.00",
      });
      expect(await registradoDe(m, "EFECTIVO")).toBe(efectivoAntes);
      expect(await registradoDe(m, "TRANSFERENCIA")).toBe("-10000.00");
      const actos = await actosDe(m);
      expect(actos).toHaveLength(1);
      expect(actos[0]).toMatchObject({
        categoria: "DEVOLUCION_DE_UN_COBRO",
        importe: "10000.00",
        motivo: "Se cobró de más",
        devuelve_origen_tipo: "ventas.cobranza_de_ticket",
        devuelve_origen_id: c,
        devolucion_id: r.devolucionId,
        movimiento_id: egresos[0]?.id,
        tercero_nombre: null,
        tercero_persona_id: null,
      });
      expect(await auditorias(m, "DEVOLUCION_REGISTRADA")).toBe(1);
    });

    it("un cobro mixto (6.000 efectivo y 4.000 transferencia) devuelto en dos líneas: dos egresos, dos actos con el mismo pedido y nada queda por devolver", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [
        ["EFECTIVO", "6000.00"],
        ["TRANSFERENCIA", "4000.00"],
      ]);
      const r = await exito(
        devolver(m, c, [linea(m, "EFECTIVO", "6000.00"), linea(m, "TRANSFERENCIA", "4000.00")]),
      );
      expect(r.actos).toHaveLength(2);
      expect(r.quedaPorDevolver).toEqual(pesos("0.00"));
      const actos = await actosDe(m);
      expect(new Set(actos.map((a) => a.devolucion_id))).toEqual(new Set([r.devolucionId]));
      expect((await egresosDe(m)).filter((e) => e.clase === "EGRESO_MANUAL")).toHaveLength(2);
    });

    it("la fecha: el acto lleva el «ahora» del contexto y queda en la sesión que devuelve", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "500.00"]]);
      const ahora = en(30);
      await exito(devolver(m, c, [linea(m, "EFECTIVO", "100.00")], {}, conAhora(m.ctx(), ahora)));
      const [acto] = await filas<{ registrado_en: Date; sesion_id: string }>(
        "select registrado_en, sesion_id from movimiento_de_dinero where empresa_id = $1",
        [m.empresa],
      );
      expect(acto?.registrado_en.getTime()).toBe(ahora.getTime());
      expect(acto?.sesion_id).toBe(sesion);
    });

    it("devolver en partes: el tope se va consumiendo; pasarse por un peso se rechaza y, agotado, ya no hay nada para devolver", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "10000.00"]]);
      const primera = await exito(devolver(m, c, [linea(m, "TRANSFERENCIA", "3000.00")]));
      expect(primera.quedaPorDevolver).toEqual(pesos("7000.00"));
      expect(await devolver(m, c, [linea(m, "TRANSFERENCIA", "7000.01")])).toEqual({
        ok: false,
        error: "DEVOLUCION_SUPERA_LO_COBRADO",
      });
      const segunda = await exito(devolver(m, c, [linea(m, "TRANSFERENCIA", "7000.00")]));
      expect(segunda.quedaPorDevolver).toEqual(pesos("0.00"));
      expect(await devolver(m, c, [linea(m, "TRANSFERENCIA", "1.00")])).toEqual({
        ok: false,
        error: "SIN_COBRO_PARA_DEVOLVER",
      });
      expect(await actosDe(m)).toHaveLength(2);
    });

    it("el efectivo que no alcanza AVISA y deja constancia, pero no bloquea; por transferencia no hay aviso", async () => {
      const m = await mundo();
      await abrir(m, "1000.00");
      const c = await cobranza(m, [["TRANSFERENCIA", "5000.00"]]);
      const r = await exito(devolver(m, c, [linea(m, "EFECTIVO", "5000.00")]));
      expect(r.avisos).toEqual(["EFECTIVO_NO_ALCANZA"]);
      expect(await auditorias(m, "EGRESO_SUPERA_EFECTIVO")).toBe(1);
      expect(await actosDe(m)).toHaveLength(1);
    });
  });

  // ===========================================================================================
  describe("idempotencia", () => {
    it("la misma devolución dos veces con la misma clave: la segunda devuelve yaExistia y no escribe ni audita", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "10000.00"]]);
      const clave = claveNueva();
      const primera = await exito(
        devolver(m, c, [linea(m, "TRANSFERENCIA", "4000.00")], { claveDeIdempotencia: clave }),
      );
      const antes = await foto(m);
      const segunda = await exito(
        devolver(m, c, [linea(m, "TRANSFERENCIA", "4000.00")], { claveDeIdempotencia: clave }),
      );
      expect(segunda.yaExistia).toBe(true);
      expect(segunda.devolucionId).toBe(primera.devolucionId);
      expect(segunda.actos).toEqual(primera.actos);
      expect(await foto(m)).toBe(antes);
    });

    it("repetir un pedido ya hecho devuelve lo hecho aunque ese mismo pedido haya consumido todo el tope", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "2000.00"]]);
      const clave = claveNueva();
      const entrada = { claveDeIdempotencia: clave };
      await exito(devolver(m, c, [linea(m, "QR", "2000.00")], entrada));
      const otra = await devolver(m, c, [linea(m, "QR", "2000.00")], entrada);
      expect(otra.ok && otra.valor.yaExistia).toBe(true);
    });

    it("la misma clave con otras líneas o con otro motivo es CLAVE_REUTILIZADA y no escribe nada", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "10000.00"]]);
      const clave = claveNueva();
      await exito(
        devolver(m, c, [linea(m, "TRANSFERENCIA", "1000.00")], { claveDeIdempotencia: clave }),
      );
      const antes = await foto(m);
      for (const cambio of [
        { lineas: [linea(m, "TRANSFERENCIA", "1500.00")] },
        { lineas: [linea(m, "QR", "1000.00")] },
        { motivo: "Otro motivo" },
      ]) {
        const r = await devolver(m, c, cambio.lineas ?? [linea(m, "TRANSFERENCIA", "1000.00")], {
          claveDeIdempotencia: clave,
          ...(cambio.motivo === undefined ? {} : { motivo: cambio.motivo }),
        });
        expect(r).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
      }
      expect(await foto(m)).toBe(antes);
    });

    it("el orden de las líneas no cambia el pedido: la misma clave con las líneas al revés es una repetición", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "10000.00"]]);
      const clave = claveNueva();
      const a = linea(m, "EFECTIVO", "1000.00");
      const b = linea(m, "TRANSFERENCIA", "2000.00");
      await exito(devolver(m, c, [a, b], { claveDeIdempotencia: clave }));
      const r = await exito(devolver(m, c, [b, a], { claveDeIdempotencia: clave }));
      expect(r.yaExistia).toBe(true);
      expect(await actosDe(m)).toHaveLength(2);
    });
  });

  // ===========================================================================================
  describe("concurrencia", () => {
    it("dos gerentes devuelven 7.000 sobre 10.000 a la vez, en los dos órdenes: una entra y la otra es DEVOLUCION_SUPERA_LO_COBRADO; nunca las dos", async () => {
      const m = await mundo();
      await abrir(m);
      const segundo = await sumarPersona(dueno, m, "ADMINISTRADOR");
      for (const orden of ["A primero", "B primero"]) {
        const c = await cobranza(m, [["EFECTIVO", "10000.00"]]);
        const a = () => devolver(m, c, [linea(m, "TRANSFERENCIA", "7000.00")]);
        const b = () => devolver(m, c, [linea(m, "QR", "7000.00")], {}, conAhora(segundo(), en(5)));
        const resultados =
          orden === "A primero"
            ? await Promise.all([a(), b()])
            : (await Promise.all([b(), a()])).reverse();
        expect(
          resultados.filter((r) => r.ok),
          JSON.stringify(resultados),
        ).toHaveLength(1);
        for (const r of resultados.filter((r) => !r.ok)) {
          expect(r).toEqual({ ok: false, error: "DEVOLUCION_SUPERA_LO_COBRADO" });
        }
        expect(
          await contar(
            "select coalesce(sum(importe), 0) as n from movimiento_de_dinero where devuelve_origen_id = $1",
            [c],
          ),
        ).toBe(7000);
      }
    });

    it("el doble clic: la misma clave a la vez deja UNA devolución y las dos respuestas son la misma", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "10000.00"]]);
      const clave = claveNueva();
      const pedir = () =>
        devolver(m, c, [linea(m, "TRANSFERENCIA", "2500.00")], { claveDeIdempotencia: clave });
      const [x, y] = await Promise.all([pedir(), pedir()]);
      expect(x.ok && y.ok, JSON.stringify([x, y])).toBe(true);
      if (x.ok && y.ok) {
        expect(x.valor.devolucionId).toBe(y.valor.devolucionId);
        expect([x.valor.yaExistia, y.valor.yaExistia].sort()).toEqual([false, true]);
      }
      expect(await actosDe(m)).toHaveLength(1);
      expect((await egresosDe(m)).filter((e) => e.clase === "EGRESO_MANUAL")).toHaveLength(1);
    });

    it("devolver contra iniciar el cierre de la sesión, en los dos órdenes: la devolución entra entera o se rechaza entera; nunca a medias", async () => {
      for (const devuelvePrimero of [true, false]) {
        const m = await mundo();
        const sesion = await abrir(m);
        const c = await cobranza(m, [
          ["EFECTIVO", "6000.00"],
          ["TRANSFERENCIA", "4000.00"],
        ]);
        const lineas = [linea(m, "EFECTIVO", "6000.00"), linea(m, "TRANSFERENCIA", "4000.00")];
        const d = () => devolver(m, c, lineas);
        const cierre = () => casos().iniciarCierre(ctxEn(m, 20), { sesionId: sesion });
        let pd: ReturnType<typeof d>;
        let pc: ReturnType<typeof cierre>;
        if (devuelvePrimero) {
          pd = d();
          pc = cierre();
        } else {
          pc = cierre();
          pd = d();
        }
        const [rd, rc] = await Promise.all([pd, pc]);
        expect(rc.ok, JSON.stringify(rc)).toBe(true);
        const entraron = (await actosDe(m)).length;
        const egresos = (await egresosDe(m)).filter((e) => e.clase === "EGRESO_MANUAL").length;
        expect(egresos).toBe(entraron);
        expect(entraron).toBe(rd.ok ? 2 : 0);
        if (!rd.ok) {
          expect(JSON.stringify(rd.error)).toMatch(/CAJA_EN_CIERRE|SIN_SESION_ABIERTA/);
        }
      }
    });

    it("dos pestañas anulando lo mismo a la vez (con claves distintas): una anula y la otra es DEVOLUCION_YA_ANULADA; las líneas se anulan una sola vez", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [
        ["EFECTIVO", "6000.00"],
        ["TRANSFERENCIA", "4000.00"],
      ]);
      const d = await exito(
        devolver(m, c, [linea(m, "EFECTIVO", "6000.00"), linea(m, "TRANSFERENCIA", "4000.00")]),
      );
      const [x, y] = await Promise.all([anular(m, d.devolucionId), anular(m, d.devolucionId)]);
      expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
      const rechazada = x.ok ? y : x;
      expect(rechazada).toEqual({ ok: false, error: "DEVOLUCION_YA_ANULADA" });
      expect((await egresosDe(m)).filter((e) => e.clase === "ANULACION")).toHaveLength(2);
    });
  });

  // ===========================================================================================
  describe("anular una devolución", () => {
    it("el espejo exacto de cada línea (mismo medio y cuenta, importe opuesto), el tope se libera y se puede volver a devolver", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [
        ["EFECTIVO", "6000.00"],
        ["TRANSFERENCIA", "4000.00"],
      ]);
      const d = await exito(
        devolver(m, c, [linea(m, "EFECTIVO", "6000.00"), linea(m, "TRANSFERENCIA", "4000.00")]),
      );
      const efectivoDespues = await registradoDe(m, "EFECTIVO");
      const a = await exito(anular(m, d.devolucionId));
      expect(a.yaExistia).toBe(false);
      expect(a.anulaciones).toHaveLength(2);
      expect(a.quedaPorDevolver).toEqual(pesos("10000.00"));
      const originales = (await egresosDe(m)).filter((e) => e.clase === "EGRESO_MANUAL");
      const espejos = (await egresosDe(m)).filter((e) => e.clase === "ANULACION");
      expect(espejos).toHaveLength(2);
      for (const e of originales) {
        const espejo = espejos.find((x) => x.anula_a === e.id);
        expect(espejo).toMatchObject({
          medio_de_pago_id: e.medio_de_pago_id,
          cuenta_de_cobro_id: e.cuenta_de_cobro_id,
          importe: String(e.importe).replace(/^-/, ""),
        });
      }
      // Neto cero: el efectivo y la transferencia vuelven a donde estaban antes de la devolución.
      expect(Number(await registradoDe(m, "EFECTIVO"))).toBe(Number(efectivoDespues) + 6000);
      expect(await registradoDe(m, "TRANSFERENCIA")).toBe("4000.00");
      // Los actos no se tocan y el pedido se puede volver a hacer.
      expect(await actosDe(m)).toHaveLength(2);
      const otra = await exito(devolver(m, c, [linea(m, "TRANSFERENCIA", "10000.00")]));
      expect(otra.quedaPorDevolver).toEqual(pesos("0.00"));
      expect(await auditorias(m, "DEVOLUCION_ANULADA")).toBe(1);
    });

    it("anular la misma devolución dos veces con la misma clave: la segunda devuelve yaExistia y no escribe ni audita", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "10000.00"]]);
      const d = await exito(devolver(m, c, [linea(m, "TRANSFERENCIA", "10000.00")]));
      const clave = claveNueva();
      const primera = await exito(anular(m, d.devolucionId, { claveDeIdempotencia: clave }));
      const antes = await foto(m);
      const segunda = await exito(anular(m, d.devolucionId, { claveDeIdempotencia: clave }));
      expect(segunda.yaExistia).toBe(true);
      expect(segunda.anulaciones).toEqual(primera.anulaciones);
      expect(await foto(m)).toBe(antes);
      // La misma clave con otro motivo no es una repetición.
      expect(
        await anular(m, d.devolucionId, { claveDeIdempotencia: clave, motivo: "Otro motivo" }),
      ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
    });

    it("ya anulada con OTRA clave es DEVOLUCION_YA_ANULADA y no escribe nada", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "1000.00"]]);
      const d = await exito(devolver(m, c, [linea(m, "QR", "1000.00")]));
      await exito(anular(m, d.devolucionId));
      const antes = await foto(m);
      expect(await anular(m, d.devolucionId)).toEqual({
        ok: false,
        error: "DEVOLUCION_YA_ANULADA",
      });
      expect(await foto(m)).toBe(antes);
    });

    it("el motivo es obligatorio y con la sesión en cierre no se anula", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "1000.00"]]);
      const d = await exito(devolver(m, c, [linea(m, "QR", "1000.00")]));
      const antes = await foto(m);
      expect(await anular(m, d.devolucionId, { motivo: "   " })).toEqual({
        ok: false,
        error: "MOTIVO_INVALIDO",
      });
      expect((await casos().iniciarCierre(ctxEn(m, 20), { sesionId: sesion })).ok).toBe(true);
      const cierre = await foto(m);
      expect(await anular(m, d.devolucionId)).toEqual({ ok: false, error: "SESION_EN_CIERRE" });
      expect(await foto(m)).toBe(cierre);
      expect(antes).not.toBe(cierre);
    });

    it("el camino genérico rechaza anular el egreso de una devolución (MOVIMIENTO_CON_DEVOLUCION), aun para quien puede anular movimientos de otros", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "1000.00"]]);
      await exito(devolver(m, c, [linea(m, "QR", "1000.00")]));
      const egreso = (await egresosDe(m)).find((e) => e.clase === "EGRESO_MANUAL");
      const antes = await foto(m);
      const r = await casos().anularMovimientoDeCaja(ctxEn(m, 10), {
        claveDeIdempotencia: claveNueva(),
        movimientoId: egreso?.id as string,
        motivo: "Quiero anularlo por la puerta de atrás",
      });
      expect(r).toEqual({ ok: false, error: "MOVIMIENTO_CON_DEVOLUCION" });
      expect(await foto(m)).toBe(antes);
    });

    it("un pedido cuyas líneas no cierran (una cita otra cobranza) falla cerrado y no anula ninguna línea", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [
        ["EFECTIVO", "6000.00"],
        ["TRANSFERENCIA", "4000.00"],
      ]);
      const d = await exito(
        devolver(m, c, [linea(m, "EFECTIVO", "6000.00"), linea(m, "TRANSFERENCIA", "4000.00")]),
      );
      const antes = await foto(m);
      pedidoMezclado = true;
      try {
        await expect(anular(m, d.devolucionId)).rejects.toThrow(/invariante rota/);
      } finally {
        pedidoMezclado = false;
      }
      expect(await foto(m)).toBe(antes);
      // Sin la mezcla, el pedido se anula normalmente: nada quedó a medias.
      expect((await anular(m, d.devolucionId)).ok).toBe(true);
    });
  });

  // ===========================================================================================
  describe("permisos y aislamiento", () => {
    it("PERMISOS: el operador no devuelve ni anula; el administrador sí; sin persona no se escribe nada", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "3000.00"]]);
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      const administrador = await sumarPersona(dueno, m, "ADMINISTRADOR");
      const d = await exito(devolver(m, c, [linea(m, "QR", "1000.00")]));
      const antes = await foto(m);
      const comoOperador = conAhora(operador(), en(5));
      expect(await devolver(m, c, [linea(m, "QR", "500.00")], {}, comoOperador)).toEqual(
        SIN_PERMISO,
      );
      expect(await anular(m, d.devolucionId, {}, comoOperador)).toEqual(SIN_PERMISO);
      expect(
        (await devolver(m, c, [linea(m, "QR", "500.00")], {}, { ...ctxEn(m), personaId: null })).ok,
      ).toBe(false);
      expect(await foto(m)).toBe(antes);
      const comoAdmin = conAhora(administrador(), en(5));
      expect((await devolver(m, c, [linea(m, "QR", "500.00")], {}, comoAdmin)).ok).toBe(true);
      expect((await anular(m, d.devolucionId, {}, comoAdmin)).ok).toBe(true);
    });

    it("AISLAMIENTO: una cobranza o una devolución de otra empresa no existe; una cobranza de otra sucursal se rechaza; nada se escribe", async () => {
      const m = await mundo();
      const otra = await mundo();
      await abrir(m);
      await abrir(otra);
      const deOtra = await cobranza(otra, [["EFECTIVO", "1000.00"]]);
      const devolucionDeOtra = await exito(devolver(otra, deOtra, [linea(otra, "QR", "100.00")]));
      const antes = await foto(m);
      expect(await devolver(m, deOtra, [linea(m, "QR", "100.00")])).toEqual({
        ok: false,
        error: "COBRANZA_NO_ENCONTRADA",
      });
      expect(await devolver(m, UUID_QUE_NO_EXISTE, [linea(m, "QR", "100.00")])).toEqual({
        ok: false,
        error: "COBRANZA_NO_ENCONTRADA",
      });
      expect(await anular(m, devolucionDeOtra.devolucionId)).toEqual({
        ok: false,
        error: "DEVOLUCION_NO_ENCONTRADA",
      });
      expect(
        await devolver(m, deOtra, [linea(m, "QR", "100.00")], { cajaId: otra.cajaId }),
      ).toEqual({ ok: false, error: "CAJA_NO_ENCONTRADA" });
      expect(await foto(m)).toBe(antes);
      // Una caja de OTRA sucursal de la misma empresa no puede devolver un cobro de la primera.
      const dos = await otraSucursalDeCaja(dueno, m.empresa, "Sucursal dos");
      const cajaDos = (
        await filas<{ id: string }>(
          "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Caja 2') returning id",
          [m.empresa, dos],
        )
      )[0]?.id as string;
      const abierta = await casos().abrirSesion(ctxEn(m, 0), {
        claveDeIdempotencia: claveNueva(),
        sucursalId: dos,
        cajaId: cajaDos,
        fondoInicial: pesos("100.00"),
      });
      expect(abierta.ok, JSON.stringify(abierta)).toBe(true);
      const c = await cobranza(m, [["EFECTIVO", "1000.00"]]);
      expect(await devolver(m, c, [linea(m, "QR", "100.00")], { cajaId: cajaDos })).toEqual({
        ok: false,
        error: "COBRANZA_DE_OTRA_SUCURSAL",
      });
      expect(await actosDe(m)).toHaveLength(0);
    });

    it("la consulta de cobros devolubles: cobrado por medio, ya devuelto, lo que queda y TODOS los medios cobrados; la de otra empresa no existe", async () => {
      const m = await mundo();
      const otra = await mundo();
      await abrir(m);
      const c = await cobranza(m, [
        ["EFECTIVO", "6000.00"],
        ["TRANSFERENCIA", "4000.00"],
      ]);
      await exito(devolver(m, c, [linea(m, "QR", "2500.00")]));
      const r = await exito(caja.consultas.cobrosDevolublesDeUnOrigen(ctxEn(m), { cobranzaId: c }));
      expect(r.cobradoPorMedio).toEqual([
        { medioDePagoId: m.medios.EFECTIVO, cuentaDeCobroId: null, importe: pesos("6000.00") },
        { medioDePagoId: m.medios.TRANSFERENCIA, cuentaDeCobroId: null, importe: pesos("4000.00") },
      ]);
      expect(r.yaDevuelto).toEqual(pesos("2500.00"));
      expect(r.quedaPorDevolver).toEqual(pesos("7500.00"));
      expect(new Set(r.mediosCobrados)).toEqual(
        new Set([m.medios.EFECTIVO, m.medios.TRANSFERENCIA]),
      );
      expect(
        await caja.consultas.cobrosDevolublesDeUnOrigen(ctxEn(otra), { cobranzaId: c }),
      ).toEqual({ ok: false, error: "COBRANZA_NO_ENCONTRADA" });
      // El operador mira (cajas.ver) aunque no pueda devolver.
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      expect(
        (
          await caja.consultas.cobrosDevolublesDeUnOrigen(conAhora(operador(), en(5)), {
            cobranzaId: c,
          })
        ).ok,
      ).toBe(true);
    });
  });

  // ===========================================================================================
  describe("validaciones y atomicidad", () => {
    it("las entradas inválidas se rechazan sin escribir nada", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "10000.00"]]);
      const antes = await foto(m);
      const un = linea(m, "QR", "100.00");
      const rechazos: Array<[string, Awaited<ReturnType<typeof devolver>>]> = [
        ["sin líneas", await devolver(m, c, [])],
        [
          "más de 10 líneas",
          await devolver(
            m,
            c,
            Array.from({ length: 11 }, () => un),
          ),
        ],
        ["línea repetida", await devolver(m, c, [un, un])],
        ["importe cero", await devolver(m, c, [linea(m, "QR", "0.00")])],
        ["importe con 3 decimales", await devolver(m, c, [linea(m, "QR", "10.005")])],
        ["importe negativo", await devolver(m, c, [linea(m, "QR", "-5.00")])],
        [
          "en dólares",
          await devolver(m, c, [{ ...un, importe: { moneda: "USD", monto: "10.00" } }]),
        ],
        ["motivo vacío", await devolver(m, c, [un], { motivo: "" })],
        ["clave inválida", await devolver(m, c, [un], { claveDeIdempotencia: "corta" })],
        ["medio inexistente", await devolver(m, c, [{ ...un, medioDePagoId: UUID_QUE_NO_EXISTE }])],
        ["cobranza no uuid", await devolver(m, "no-es-un-uuid", [un])],
      ];
      for (const [caso, r] of rechazos) expect(r.ok, caso).toBe(false);
      expect(await foto(m)).toBe(antes);
    });

    it("sin sesión abierta o con la sesión en cierre se rechaza entera y no escribe nada", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "1000.00"]]);
      expect((await casos().iniciarCierre(ctxEn(m, 20), { sesionId: sesion })).ok).toBe(true);
      const antes = await foto(m);
      const r = await devolver(m, c, [linea(m, "QR", "100.00")], {}, ctxEn(m, 25));
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).toMatch(/CAJA_EN_CIERRE|SIN_SESION_ABIERTA/);
      expect(await foto(m)).toBe(antes);
    });

    it("ATOMICIDAD: si falla el acto de la segunda línea no queda el egreso de la primera ni la auditoría; si falla la auditoría, tampoco queda nada", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "10000.00"]]);
      const antes = await foto(m);
      const lineas = [linea(m, "EFECTIVO", "1000.00"), linea(m, "TRANSFERENCIA", "2000.00")];
      for (const modo of ["EN_EL_2DO_ACTO", "EN_LA_AUDITORIA"] as const) {
        falla = modo;
        try {
          await expect(devolver(m, c, lineas)).rejects.toThrow(/falla inyectada/);
        } finally {
          falla = "NINGUNA";
        }
        expect(await foto(m), modo).toBe(antes);
      }
      expect((await devolver(m, c, lineas)).ok).toBe(true);
    });

    it("la auditoría no lleva nombres ni datos de tarjeta, pero sí el pedido y las líneas", async () => {
      const m = await mundo();
      await abrir(m);
      const c = await cobranza(m, [["EFECTIVO", "1000.00"]]);
      const d = await exito(devolver(m, c, [linea(m, "TARJETA_DEBITO", "1000.00")]));
      const [fila] = await filas<{ despues: Record<string, unknown> }>(
        "select despues from auditoria_empresa where empresa_id = $1 and accion = 'DEVOLUCION_REGISTRADA'",
        [m.empresa],
      );
      const texto = JSON.stringify(fila?.despues);
      expect(texto).toContain(d.devolucionId);
      expect(texto).toContain(c);
      expect(texto).toContain("1000.00");
      expect(texto).not.toMatch(/tercero|cupon|ultimos4|dni|nombre/i);
    });
  });
});
