import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  REGLAS_DE_CAJA,
  armarCaja,
  crearEntornoDeCaja,
  sumarPersona,
} from "./caja-configuracion-apoyo";
import { crearMundoDeCobro, origenNuevo, type MundoDeCobro } from "./caja-cobrar-apoyo";
import {
  armarCierreConCaja,
  cerrarElDia,
  empezarElCierre,
  jornadaConCobros,
  ticketsFalsos,
  type CobroDePrueba,
  type JornadaLista,
  type OpcionesDeJornada,
} from "./caja-cierre-del-dia-apoyo";
import { claveNueva, conAhora, pesos } from "./caja-operacion-apoyo";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";

/**
 * Las consultas del Cierre del día de caja (E3, tramo 8; e3b §4.5) con una base real: las sesiones, los cobros (con cursor de hasta 100, su
 * medio original y vigente, las correcciones y `correccionPosible`), los movimientos manuales, el cobrado por origen y el informe; y los permisos
 * de los tres roles en las acciones nuevas, el alcance de sucursal, «solo lectura» por baja de plan y el aislamiento entre empresas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Fila = Record<string, unknown>;

describe.skipIf(base === null)("cierre del día de caja: consultas y permisos", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  let cierre: ReturnType<typeof armarCierreConCaja>;
  const tickets = ticketsFalsos();

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8);
    caja = armarCaja(entorno, REGLAS_DE_CAJA, tickets);
    cierre = armarCierreConCaja(entorno, tickets);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const mundo = (opciones = {}) => crearMundoDeCobro(entornoBase, dueno, caja, opciones);
  const listo = (
    m: MundoDeCobro,
    cobros: readonly CobroDePrueba[],
    opciones: OpcionesDeJornada = {},
  ) => jornadaConCobros(entorno, caja, m, cobros, { tickets, ...opciones });
  const corregir = (
    m: MundoDeCobro,
    j: JornadaLista,
    i: number,
    medio: keyof MundoDeCobro["medios"],
    cuenta: keyof MundoDeCobro["cuentas"] | null = null,
    ctx = j.ctx(45),
  ) =>
    caja.casos.corregirMedioDeCobro(ctx, {
      claveDeIdempotencia: claveNueva(),
      cobroId: j.cobroIds[i] as string,
      medioDestinoId: m.medios[medio],
      cuentaDestinoId: cuenta === null ? null : m.cuentas[cuenta],
      motivo: "Era otro medio",
    });

  // =============================================================================================
  describe("cobrosDeLaJornada", () => {
    it("trae el cobro original y el vigente, el origen, las correcciones con su motivo y correccionPosible; el filtro por medio mira el original y el vigente", async () => {
      const m = await mundo();
      const j = await listo(m, [
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "18400.00" },
        { medio: "EFECTIVO", importe: "50.00" },
      ]);
      const pedir = (cambios = {}, ctx = j.ctx(50)) =>
        caja.consultas.cobrosDeLaJornada(ctx, { ...j.entrada, ...cambios });
      // Con la jornada abierta (sin auditar) todavía no se puede corregir.
      const antes = await pedir();
      expect(antes.ok && antes.valor.cobros.map((c) => c.correccionPosible)).toEqual([
        false,
        false,
      ]);
      await empezarElCierre(cierre, j);
      expect((await corregir(m, j, 0, "TARJETA_DEBITO", "terminal")).ok).toBe(true);

      const r = await pedir();
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.siguiente).toBeNull();
      expect(r.valor.cobros.map((c) => c.cobroId)).toEqual([...j.cobroIds]);
      const [corregido, efectivo] = r.valor.cobros;
      expect(corregido).toMatchObject({
        importe: { monto: "18400.00" },
        sesionId: j.sesionId,
        correccionPosible: true,
        original: { medioTipo: "TARJETA_CREDITO", cuentaDeCobroId: m.cuentas.terminal },
        vigente: { medioTipo: "TARJETA_DEBITO", cuentaDeCobroId: m.cuentas.terminal },
        origen: { tipo: "ventas.cobranza_de_ticket", id: j.origenes[0]?.id, orden: 1 },
        registradoPor: m.persona,
        correcciones: [
          {
            secuencia: 1,
            motivo: "Era otro medio",
            medioTipo: "TARJETA_DEBITO",
            corregidaPor: m.persona,
          },
        ],
      });
      expect(efectivo).toMatchObject({
        correcciones: [],
        original: { medioTipo: "EFECTIVO" },
        vigente: { medioTipo: "EFECTIVO" },
      });
      // El filtro por medio: el cobro corregido aparece con el medio original y con el vigente.
      for (const medio of ["TARJETA_CREDITO", "TARJETA_DEBITO"] as const) {
        const f = await pedir({ medioDePagoId: m.medios[medio] });
        expect(f.ok && f.valor.cobros.map((c) => c.cobroId), medio).toEqual([j.cobroIds[0]]);
      }
      const e = await pedir({ medioDePagoId: m.medios.EFECTIVO });
      expect(e.ok && e.valor.cobros.map((c) => c.cobroId)).toEqual([j.cobroIds[1]]);
      // Cerrada la jornada, ya no se puede corregir.
      expect((await cerrarElDia(cierre, j)).ok).toBe(true);
      const cerrada = await pedir();
      expect(cerrada.ok && cerrada.valor.cobros.map((c) => c.correccionPosible)).toEqual([
        false,
        false,
      ]);
    });

    it("pagina con cursor (hasta 100), sin repetir ni saltear, y rechaza límites, cursores, medios y fechas inválidos", async () => {
      const m = await mundo();
      const cobros: CobroDePrueba[] = Array.from({ length: 7 }, (_, i) => ({
        medio: "EFECTIVO",
        importe: `${i + 1}.00`,
      }));
      const j = await listo(m, cobros);
      const vistos: string[] = [];
      let cursor: { registradoEn: string; id: string } | null = null;
      let paginas = 0;
      do {
        const r = await caja.consultas.cobrosDeLaJornada(j.ctx(50), {
          ...j.entrada,
          limite: 3,
          despuesDe: cursor,
        });
        if (!r.ok) throw new Error(JSON.stringify(r.error));
        expect(r.valor.cobros.length).toBeLessThanOrEqual(3);
        vistos.push(...r.valor.cobros.map((c) => c.cobroId));
        cursor = r.valor.siguiente;
        paginas += 1;
      } while (cursor !== null && paginas < 10);
      expect(paginas).toBe(3);
      expect(vistos).toEqual([...j.cobroIds]);
      expect(new Set(vistos).size).toBe(7);

      const pedir = (cambios: Record<string, unknown>) =>
        caja.consultas.cobrosDeLaJornada(j.ctx(50), { ...j.entrada, ...cambios });
      for (const limite of [0, 101, 1.5, -1, Number.NaN]) {
        expect(await pedir({ limite }), String(limite)).toEqual({
          ok: false,
          error: "LIMITE_INVALIDO",
        });
      }
      expect((await pedir({ limite: 100 })).ok).toBe(true);
      expect(
        await pedir({ despuesDe: { registradoEn: "no es una fecha", id: j.cobroIds[0] } }),
      ).toEqual({ ok: false, error: "CURSOR_INVALIDO" });
      expect(
        await pedir({ despuesDe: { registradoEn: new Date().toISOString(), id: "x" } }),
      ).toEqual({ ok: false, error: "CURSOR_INVALIDO" });
      expect(await pedir({ medioDePagoId: "x" })).toEqual({
        ok: false,
        error: "MEDIO_NO_ENCONTRADO",
      });
      expect(await pedir({ fechaDeNegocio: "2026-02-30" })).toEqual({
        ok: false,
        error: "FECHA_INVALIDA",
      });
      expect(await pedir({ sucursalId: "x" })).toEqual({
        ok: false,
        error: "SUCURSAL_NO_ENCONTRADA",
      });
    });
  });

  // =============================================================================================
  describe("cobradoPorOrigenDeLaJornada, movimientosManualesDeLaJornada e informeDeCajaDelDia", () => {
    it("lo cobrado por origen es dato crudo de caja (no cambia con una corrección) y se pagina por origen; el informe cuenta los cobros por el medio ya corregido", async () => {
      const m = await mundo();
      const comun = origenNuevo();
      const j = await listo(m, [
        { medio: "EFECTIVO", importe: "100.00", origen: comun, totalDelTicket: "300.00" },
        { medio: "QR", cuenta: "qr", importe: "200.00", origen: comun, orden: 2 },
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "50.00" },
        { medio: "EFECTIVO", importe: "7.00", origen: origenNuevo("otro.tipo") },
      ]);
      // Dos cobros de un mismo origen con distintos medios (orden 1 y 2 de un mismo ticket) no se pueden con el apoyo: se cobra por separado.
      await empezarElCierre(cierre, j);
      expect((await corregir(m, j, 2, "TARJETA_DEBITO", "terminal")).ok).toBe(true);

      const todos = await caja.consultas.cobradoPorOrigenDeLaJornada(j.ctx(50), j.entrada);
      expect(todos.ok).toBe(true);
      if (!todos.ok) return;
      expect(todos.valor.origenes).toHaveLength(3);
      // Dos cobros del mismo origen suman en una fila; el medio con que se cobró no importa.
      expect(
        Object.fromEntries(
          todos.valor.origenes.map((o) => [o.origen.id, [o.cobrado.monto, o.cobros]]),
        ),
      ).toEqual({
        [comun.id]: ["300.00", 2],
        [j.origenes[2]?.id as string]: ["50.00", 1],
        [j.origenes[3]?.id as string]: ["7.00", 1],
      });
      const ordenados = todos.valor.origenes.map((o) => `${o.origen.tipo}|${o.origen.id}`);
      expect(ordenados).toEqual([...ordenados].sort());
      // Con cursor.
      const vistos: string[] = [];
      let cursor: { tipo: string; id: string } | null = null;
      let paginas = 0;
      do {
        const r = await caja.consultas.cobradoPorOrigenDeLaJornada(j.ctx(50), {
          ...j.entrada,
          limite: 2,
          despuesDe: cursor,
        });
        if (!r.ok) throw new Error(JSON.stringify(r.error));
        vistos.push(...r.valor.origenes.map((o) => o.origen.id));
        cursor = r.valor.siguiente;
        paginas += 1;
      } while (cursor !== null && paginas < 5);
      expect(paginas).toBe(2);
      expect(vistos).toEqual(todos.valor.origenes.map((o) => o.origen.id));
      for (const limite of [0, 101]) {
        expect(
          await caja.consultas.cobradoPorOrigenDeLaJornada(j.ctx(50), { ...j.entrada, limite }),
        ).toEqual({ ok: false, error: "LIMITE_INVALIDO" });
      }
      expect(
        await caja.consultas.cobradoPorOrigenDeLaJornada(j.ctx(50), {
          ...j.entrada,
          despuesDe: { tipo: "ventas.cobranza_de_ticket", id: "x" },
        }),
      ).toEqual({ ok: false, error: "CURSOR_INVALIDO" });

      const informe = await caja.consultas.informeDeCajaDelDia(j.ctx(50), j.entrada);
      expect(informe).toMatchObject({
        ok: true,
        valor: { cantidadDeCobros: 4, cobrado: { monto: "357.00" } },
      });
      if (!informe.ok) return;
      const porMedio = Object.fromEntries(
        informe.valor.porMedio.map((x) => [x.medioTipo, [x.cobros, x.importe.monto]]),
      );
      expect(porMedio).toEqual({
        EFECTIVO: [2, "107.00"],
        QR: [1, "200.00"],
        TARJETA_DEBITO: [1, "50.00"],
      });
    });

    it("los movimientos manuales de la jornada: ingresos, egresos, ajustes y anulaciones con su motivo y quién", async () => {
      const m = await mundo();
      const j = await listo(m, [{ medio: "EFECTIVO", importe: "50.00" }], { sinCerrar: true });
      const ingreso = await caja.casos.registrarMovimientoManual(j.ctx(10), {
        claveDeIdempotencia: claveNueva(),
        sesionId: j.sesionId,
        sentido: "INGRESO",
        importe: pesos("20.00"),
        motivo: "Cambio",
      });
      const egreso = await caja.casos.registrarMovimientoManual(j.ctx(11), {
        claveDeIdempotencia: claveNueva(),
        sesionId: j.sesionId,
        sentido: "EGRESO",
        importe: pesos("5.00"),
        motivo: "Retiro",
      });
      expect(ingreso.ok && egreso.ok).toBe(true);
      const anulacion = await caja.casos.anularMovimientoDeCaja(j.ctx(12), {
        claveDeIdempotencia: claveNueva(),
        movimientoId: egreso.ok ? egreso.valor.movimientoId : "",
        motivo: "Me equivoqué",
      });
      expect(anulacion.ok).toBe(true);
      const r = await caja.consultas.movimientosManualesDeLaJornada(j.ctx(20), j.entrada);
      expect(
        r.ok &&
          r.valor.movimientos.map((x) => [
            x.clase,
            x.importe.monto,
            x.motivo,
            x.corrigeJornada,
            x.sesionId,
            x.medioTipo,
          ]),
      ).toEqual([
        ["INGRESO_MANUAL", "20.00", "Cambio", null, j.sesionId, "EFECTIVO"],
        ["EGRESO_MANUAL", "-5.00", "Retiro", null, j.sesionId, "EFECTIVO"],
        ["ANULACION", "5.00", "Me equivoqué", null, j.sesionId, "EFECTIVO"],
      ]);
      expect(r.ok && r.valor.movimientos[2]?.anulaA).toBe(
        egreso.ok ? egreso.valor.movimientoId : "",
      );
    });
  });

  // =============================================================================================
  describe("permisos, alcance, solo lectura y aislamiento (e3b §4.7)", () => {
    it("los tres roles pueden corregir, declarar y dar el conforme (cobros.corregir_medio y declaraciones_de_total.registrar: G A O) y mirar", async () => {
      const m = await mundo();
      const j = await listo(m, [
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "100.00" },
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "110.00" },
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "120.00" },
      ]);
      await empezarElCierre(cierre, j);
      const roles = [
        ["GERENTE", m.ctx],
        ["ADMINISTRADOR", await sumarPersona(dueno, m, "ADMINISTRADOR", true)],
        ["OPERADOR", await sumarPersona(dueno, m, "OPERADOR", true)],
      ] as const;
      for (const [i, [rol, contexto]] of roles.entries()) {
        const ctx = conAhora(contexto(), j.ctx(45).ahora);
        expect(
          (await corregir(m, j, i, "TARJETA_DEBITO", "terminal", ctx)).ok,
          `${rol}: corregir`,
        ).toBe(true);
        const declarada = await caja.casos.declararTotal(ctx, {
          claveDeIdempotencia: claveNueva(),
          ...j.entrada,
          medioDePagoId: m.medios.QR,
          cuentaDeCobroId: null,
          importe: pesos(`${i + 1}.00`),
        });
        expect(declarada.ok, `${rol}: declarar`).toBe(true);
        const conforme = await caja.casos.darConformeGeneral(ctx, {
          claveDeIdempotencia: claveNueva(),
          ...j.entrada,
        });
        expect(conforme.ok, `${rol}: conforme`).toBe(true);
        expect(
          (await caja.consultas.conciliacionDeLaJornada(ctx, j.entrada)).ok,
          `${rol}: ver`,
        ).toBe(true);
        expect((await caja.consultas.cobrosDeLaJornada(ctx, j.entrada)).ok, `${rol}: cobros`).toBe(
          true,
        );
      }
      expect(
        await contar("select count(*) as n from correccion_de_medio where empresa_id = $1", [
          m.empresa,
        ]),
      ).toBe(3);
    });

    it("un operador sin la sucursal asignada no corrige, no declara ni mira esa jornada (SUCURSAL_FUERA_DE_ALCANCE) y no escribe nada", async () => {
      const m = await mundo();
      const j = await listo(m, [
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "100.00" },
      ]);
      await empezarElCierre(cierre, j);
      const ctx = conAhora((await sumarPersona(dueno, m, "OPERADOR", false))(), j.ctx(45).ahora);
      const antes = await contar(
        "select count(*) as n from auditoria_empresa where empresa_id = $1",
        [m.empresa],
      );
      expect(await corregir(m, j, 0, "TARJETA_DEBITO", "terminal", ctx)).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      expect(
        await caja.casos.declararTotal(ctx, {
          claveDeIdempotencia: claveNueva(),
          ...j.entrada,
          medioDePagoId: m.medios.QR,
          cuentaDeCobroId: null,
          importe: pesos("1.00"),
        }),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      expect(
        await caja.casos.darConformeGeneral(ctx, {
          claveDeIdempotencia: claveNueva(),
          ...j.entrada,
        }),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      for (const consulta of [
        caja.consultas.conciliacionDeLaJornada,
        caja.consultas.cobrosDeLaJornada,
        caja.consultas.sesionesDeLaJornada,
        caja.consultas.movimientosManualesDeLaJornada,
        caja.consultas.cobradoPorOrigenDeLaJornada,
        caja.consultas.informeDeCajaDelDia,
      ]) {
        expect(await consulta(ctx, j.entrada)).toEqual({
          ok: false,
          error: "SUCURSAL_FUERA_DE_ALCANCE",
        });
      }
      expect(
        await contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
          m.empresa,
        ]),
      ).toBe(antes);
    });

    it("con la baja de plan (solo lectura) las dos acciones nuevas se permiten (completan o cierran) y la empresa sin el módulo activo no puede nada", async () => {
      const m = await mundo();
      const j = await listo(m, [
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "100.00" },
      ]);
      await empezarElCierre(cierre, j);
      const { version } = await crearPlanPublicado(dueno, { modulos: ["cierre"] });
      await asignarPlan(dueno, m.tenant, version, { desdeSegundos: -5 });
      expect((await corregir(m, j, 0, "TARJETA_DEBITO", "terminal")).ok).toBe(true);
      expect(
        (
          await caja.casos.declararTotal(j.ctx(46), {
            claveDeIdempotencia: claveNueva(),
            ...j.entrada,
            medioDePagoId: m.medios.QR,
            cuentaDeCobroId: null,
            importe: pesos("1.00"),
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await caja.casos.darConformeGeneral(j.ctx(47), {
            claveDeIdempotencia: claveNueva(),
            ...j.entrada,
          })
        ).ok,
      ).toBe(true);
      expect((await caja.consultas.conciliacionDeLaJornada(j.ctx(48), j.entrada)).ok).toBe(true);
      // El aporte de caja sigue contando para el cierre aunque esté en solo lectura: hay actividad que revisar.
      expect(await cierre.consultas.controlesDeLaJornada(j.ctx(49), j.entrada)).toMatchObject({
        ok: true,
      });
      expect((await cerrarElDia(cierre, j)).ok).toBe(true);

      // Sin el módulo activo, nada (el guard va primero: ni siquiera se mira si el cobro existe).
      const apagada = await mundo({ plan: [], activados: [] });
      const ctx = apagada.ctx();
      expect(
        await caja.casos.corregirMedioDeCobro(ctx, {
          claveDeIdempotencia: claveNueva(),
          cobroId: j.cobroIds[0] as string,
          medioDestinoId: apagada.medios.QR,
          cuentaDestinoId: null,
          motivo: "x",
        }),
      ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
      expect(await caja.consultas.conciliacionDeLaJornada(ctx, j.entrada)).toEqual({
        ok: false,
        error: "MODULO_NO_ACTIVO",
      });
    });

    it("la empresa A y la B no se ven: B no corrige, no declara ni lee la jornada de A", async () => {
      const a = await mundo();
      const ja = await listo(a, [
        { medio: "TARJETA_CREDITO", cuenta: "terminal", importe: "100.00" },
      ]);
      await empezarElCierre(cierre, ja);
      const b = await mundo();
      const ctxB = conAhora(b.ctx(), ja.ctx(45).ahora);
      const sobreA = (cobroId: string) =>
        caja.casos.corregirMedioDeCobro(ctxB, {
          claveDeIdempotencia: claveNueva(),
          cobroId,
          medioDestinoId: b.medios.TARJETA_DEBITO,
          cuentaDestinoId: null,
          motivo: "Intento",
        });
      expect(await sobreA(ja.cobroIds[0] as string)).toEqual({
        ok: false,
        error: "COBRO_NO_ENCONTRADO",
      });
      expect(
        await caja.casos.declararTotal(ctxB, {
          claveDeIdempotencia: claveNueva(),
          ...ja.entrada,
          medioDePagoId: b.medios.QR,
          cuentaDeCobroId: null,
          importe: pesos("1.00"),
        }),
      ).toEqual({ ok: false, error: "JORNADA_NO_ENCONTRADA" });
      expect(
        await caja.casos.darConformeGeneral(ctxB, {
          claveDeIdempotencia: claveNueva(),
          ...ja.entrada,
        }),
      ).toEqual({ ok: false, error: "JORNADA_NO_ENCONTRADA" });
      // Las lecturas de B sobre la sucursal y la fecha de A no traen nada de A.
      const conciliacion = await caja.consultas.conciliacionDeLaJornada(ctxB, ja.entrada);
      expect(conciliacion).toMatchObject({
        ok: true,
        valor: { lineas: [], cobradoContraTicket: [], ajustesQueCorrigenJornadasCerradas: [] },
      });
      const cobros = await caja.consultas.cobrosDeLaJornada(ctxB, ja.entrada);
      expect(cobros).toMatchObject({ ok: true, valor: { cobros: [] } });
      const sesiones = await caja.consultas.sesionesDeLaJornada(ctxB, ja.entrada);
      expect(sesiones).toMatchObject({ ok: true, valor: { sesiones: [] } });
      expect(await caja.consultas.cobradoPorOrigenDeLaJornada(ctxB, ja.entrada)).toMatchObject({
        ok: true,
        valor: { origenes: [] },
      });
      expect(await caja.consultas.informeDeCajaDelDia(ctxB, ja.entrada)).toMatchObject({
        ok: true,
        valor: { cantidadDeCobros: 0 },
      });
      expect(
        await contar("select count(*) as n from correccion_de_medio where empresa_id = $1", [
          a.empresa,
        ]),
      ).toBe(0);
    });
  });
});
