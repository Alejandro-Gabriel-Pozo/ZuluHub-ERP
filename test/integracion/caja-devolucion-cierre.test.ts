import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import {
  REGLAS_DE_CAJA,
  armarCaja,
  crearEntornoDeCaja,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import { crearMundoDeCobro, origenNuevo, type MundoDeCobro } from "./caja-cobrar-apoyo";
import {
  armarCierreConCaja,
  cerrarElDia,
  conteoDe,
  empezarElCierre,
  jornadaConCobros,
  ticketsFalsos,
  type JornadaLista,
} from "./caja-cierre-del-dia-apoyo";
import { claveNueva, pesos } from "./caja-operacion-apoyo";

/**
 * La devolución con medio en el CIERRE del día (DM-3a), con una base real: la conciliación no cambia su cuenta (un egreso de devolución baja el registrado de SU par y el día se
 * cierra igual), `cobrado` y `devuelto` por par son informativos, el control «cobrado contra el ticket» resta lo ya devuelto (un ticket anulado con todo devuelto no es una
 * diferencia), el informe del día trae lo devuelto y el neto por medio, y la jornada de un cobro ya cerrado no cambia si se devuelve otro día.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("caja: la devolución en el cierre del día", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let tickets: ReturnType<typeof ticketsFalsos>;
  let caja: ReturnType<typeof armarCaja>;
  let cierre: ReturnType<typeof armarCierreConCaja>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8, (tx): TxDeCajaDePrueba => tx);
    tickets = ticketsFalsos();
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

  const mundo = () => crearMundoDeCobro(entornoBase, dueno, caja, {});
  const jornada = (m: MundoDeCobro, cobros: Parameters<typeof jornadaConCobros>[3], dias = 1) =>
    jornadaConCobros(entorno, caja, m, cobros, { sinCerrar: true, tickets, dias });
  const linea = (m: MundoDeCobro, tipo: keyof MundoDeCobro["medios"], monto: string) => ({
    medioDePagoId: m.medios[tipo],
    cuentaDeCobroId: null,
    importe: pesos(monto),
  });
  const devolver = async (
    m: MundoDeCobro,
    j: JornadaLista,
    cobranzaId: string,
    lineas: ReturnType<typeof linea>[],
  ) => {
    const r = await caja.casos.devolverDinero(j.ctx(10), {
      claveDeIdempotencia: claveNueva(),
      cajaId: m.cajaId,
      cobranzaId,
      lineas,
      motivo: "Producto en mal estado",
    });
    if (!r.ok) throw new Error(`no se pudo devolver: ${JSON.stringify(r.error)}`);
    return r.valor;
  };
  const conciliacion = async (j: JornadaLista) => {
    const r = await caja.consultas.conciliacionDeLaJornada(j.ctx(50), j.entrada);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.valor;
  };
  const de = (
    c: Awaited<ReturnType<typeof conciliacion>>,
    m: MundoDeCobro,
    tipo: keyof MundoDeCobro["medios"],
  ) => {
    const l = c.lineas.find((x) => x.medioDePagoId === m.medios[tipo]);
    if (l === undefined) throw new Error(`falta la línea de ${tipo}`);
    return l;
  };

  it("una devolución por OTRO medio baja el registrado de SU par, `cobrado` y `devuelto` son informativos y el día se cierra igual (la cuenta del cierre no cambió)", async () => {
    const m = await mundo();
    const cobranza = origenNuevo();
    const j = await jornada(m, [{ medio: "EFECTIVO", importe: "10000.00", origen: cobranza }]);
    await devolver(m, j, cobranza.id, [linea(m, "TRANSFERENCIA", "10000.00")]);

    const c = await conciliacion(j);
    const efectivo = de(c, m, "EFECTIVO");
    const transferencia = de(c, m, "TRANSFERENCIA");
    // El efectivo: fondo 1.000 + cobro 10.000, sin devoluciones; la transferencia: solo el egreso de la devolución.
    expect(efectivo).toMatchObject({
      registrado: pesos("11000.00"),
      cobrado: pesos("10000.00"),
      devuelto: pesos("0.00"),
    });
    expect(transferencia).toMatchObject({
      registrado: pesos("-10000.00"),
      cobrado: pesos("0.00"),
      devuelto: pesos("10000.00"),
    });
    // El control contra el ticket NO marca diferencia: lo cobrado (10.000) menos lo devuelto (10.000) contra un ticket de 10.000 anulado a 0... aquí el ticket sigue en 10.000.
    expect(c.cobradoContraTicket).toHaveLength(1);

    // Se cierra la sesión (efectivo contado = lo esperado; el resto, conforme) y el día: el disparador de la base acepta la cuenta tal como estaba.
    const cerrada = await caja.casos.cerrarSesion(j.ctx(30), {
      sesionId: j.sesionId,
      conteo: conteoDe("11000.00"),
      otros: [],
      conformeGeneral: true,
      observacion: null,
    });
    expect(cerrada.ok, JSON.stringify(cerrada)).toBe(true);
    await empezarElCierre(cierre, j);
    const dia = await cerrarElDia(cierre, j, { texto: "Ticket anulado con su plata devuelta" });
    expect(dia.ok, JSON.stringify(dia)).toBe(true);
    // Ya cerrada, la conciliación muestra las líneas guardadas y lo informativo sigue ahí.
    const cerradaVista = await conciliacion(j);
    expect(cerradaVista.enVivo).toBe(false);
    expect(de(cerradaVista, m, "TRANSFERENCIA")).toMatchObject({
      registrado: pesos("-10000.00"),
      devuelto: pesos("10000.00"),
    });
  });

  it("el control «cobrado contra el ticket» es NETO: un ticket anulado con $ 18.000 cobrados y $ 18.000 devueltos no es diferencia; devolviendo solo $ 10.000 quedan $ 8.000; anular la devolución vuelve a $ 18.000", async () => {
    const m = await mundo();
    const cobranza = origenNuevo();
    const j = await jornada(m, [
      { medio: "EFECTIVO", importe: "18000.00", origen: cobranza, totalDelTicket: "0.00" },
    ]);
    // Sin devolver: el ticket anulado (total 0) con 18.000 cobrados es una diferencia de 18.000.
    expect((await conciliacion(j)).cobradoContraTicket[0]?.diferencia).toEqual(pesos("18000.00"));

    const parcial = await devolver(m, j, cobranza.id, [linea(m, "TRANSFERENCIA", "10000.00")]);
    const vista = (await conciliacion(j)).cobradoContraTicket;
    expect(vista).toHaveLength(1);
    expect(vista[0]).toMatchObject({
      cobrado: pesos("8000.00"),
      totalDelTicket: pesos("0.00"),
      diferencia: pesos("8000.00"),
    });

    await devolver(m, j, cobranza.id, [linea(m, "QR", "8000.00")]);
    expect((await conciliacion(j)).cobradoContraTicket).toEqual([]);

    // Anular una de las devoluciones libera su importe: la diferencia vuelve.
    const anulada = await caja.casos.anularDevolucion(j.ctx(20), {
      claveDeIdempotencia: claveNueva(),
      devolucionId: parcial.devolucionId,
      motivo: "Se devolvió por error",
    });
    expect(anulada.ok, JSON.stringify(anulada)).toBe(true);
    expect((await conciliacion(j)).cobradoContraTicket[0]?.diferencia).toEqual(pesos("10000.00"));
  });

  it("si Ventas no informa la cobranza el día no se cierra con un dato que no se pudo leer, aunque haya devoluciones (no cambia el modo de fallar)", async () => {
    const m = await mundo();
    const cobranza = origenNuevo();
    const j = await jornada(m, [{ medio: "EFECTIVO", importe: "1000.00", origen: cobranza }]);
    await devolver(m, j, cobranza.id, [linea(m, "QR", "400.00")]);
    tickets.modo.falla = "LANZA";
    try {
      const r = await caja.consultas.conciliacionDeLaJornada(j.ctx(50), j.entrada);
      expect(r).toEqual({ ok: false, error: "APORTE_NO_DISPONIBLE" });
    } finally {
      tickets.modo.falla = "NINGUNA";
    }
  });

  it("el informe del día trae lo devuelto y el neto por medio; el medio por el que solo se devolvió figura con cobros en cero; la devolución anulada no cuenta", async () => {
    const m = await mundo();
    const cobranza = origenNuevo();
    const j = await jornada(m, [
      { medio: "EFECTIVO", importe: "6000.00", origen: cobranza, orden: 1 },
      {
        medio: "TARJETA_CREDITO",
        cuenta: "terminal",
        importe: "4000.00",
        origen: cobranza,
        orden: 2,
      },
    ]);
    const hecha = await devolver(m, j, cobranza.id, [
      linea(m, "TRANSFERENCIA", "2500.00"),
      linea(m, "EFECTIVO", "500.00"),
    ]);
    const sinAnular = await caja.consultas.informeDeCajaDelDia(j.ctx(50), j.entrada);
    expect(sinAnular.ok).toBe(true);
    if (!sinAnular.ok) return;
    expect(sinAnular.valor).toMatchObject({
      cantidadDeCobros: 2,
      cobrado: pesos("10000.00"),
      devuelto: pesos("3000.00"),
      neto: pesos("7000.00"),
    });
    const porTipo = Object.fromEntries(
      sinAnular.valor.porMedio.map((x) => [
        x.medioTipo,
        [x.cobros, x.importe.monto, x.devuelto.monto, x.neto.monto],
      ]),
    );
    expect(porTipo).toEqual({
      EFECTIVO: [1, "6000.00", "500.00", "5500.00"],
      TARJETA_CREDITO: [1, "4000.00", "0.00", "4000.00"],
      TRANSFERENCIA: [0, "0.00", "2500.00", "-2500.00"],
    });

    const anulada = await caja.casos.anularDevolucion(j.ctx(20), {
      claveDeIdempotencia: claveNueva(),
      devolucionId: hecha.devolucionId,
      motivo: "Se devolvió por error",
    });
    expect(anulada.ok).toBe(true);
    const despues = await caja.consultas.informeDeCajaDelDia(j.ctx(50), j.entrada);
    expect(despues.ok && despues.valor).toMatchObject({
      devuelto: pesos("0.00"),
      neto: pesos("10000.00"),
    });
  });

  it("lo cobrado por origen trae lo devuelto y el neto de cada cobranza de ticket; los otros orígenes quedan en cero", async () => {
    const m = await mundo();
    const cobranza = origenNuevo();
    const otro = origenNuevo("otro.tipo");
    const j = await jornada(m, [
      { medio: "EFECTIVO", importe: "300.00", origen: cobranza },
      { medio: "EFECTIVO", importe: "70.00", origen: otro },
    ]);
    await devolver(m, j, cobranza.id, [linea(m, "QR", "120.00")]);
    const r = await caja.consultas.cobradoPorOrigenDeLaJornada(j.ctx(50), j.entrada);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const porId = Object.fromEntries(
      r.valor.origenes.map((o) => [o.origen.id, [o.cobrado.monto, o.devuelto.monto, o.neto.monto]]),
    );
    expect(porId).toEqual({
      [cobranza.id]: ["300.00", "120.00", "180.00"],
      [otro.id]: ["70.00", "0.00", "70.00"],
    });
  });

  it("devolver OTRO día no cambia la jornada del cobro ya cerrada: sus líneas y su control quedan como estaban; la devolución cae en la jornada que devuelve", async () => {
    const m = await mundo();
    const cobranza = origenNuevo();
    const dia1 = await jornada(m, [{ medio: "EFECTIVO", importe: "5000.00", origen: cobranza }], 1);
    await caja.casos.cerrarSesion(dia1.ctx(30), {
      sesionId: dia1.sesionId,
      conteo: conteoDe("6000.00"),
      otros: [],
      conformeGeneral: true,
      observacion: null,
    });
    await empezarElCierre(cierre, dia1);
    const cerrado = await cerrarElDia(cierre, dia1);
    expect(cerrado.ok, JSON.stringify(cerrado)).toBe(true);
    const antes = JSON.stringify(await conciliacion(dia1));

    const dia2 = await jornada(m, [], 2);
    const hecha = await devolver(m, dia2, cobranza.id, [linea(m, "TRANSFERENCIA", "1500.00")]);
    expect(hecha.quedaPorDevolver).toEqual(pesos("3500.00"));
    expect(JSON.stringify(await conciliacion(dia1))).toBe(antes);
    const enDia2 = await conciliacion(dia2);
    expect(de(enDia2, m, "TRANSFERENCIA")).toMatchObject({
      registrado: pesos("-1500.00"),
      devuelto: pesos("1500.00"),
    });
    // El día 2 no tiene cobros de esa cobranza: no hay control que comparar.
    expect(enDia2.cobradoContraTicket).toEqual([]);
  });

  const origenesGuardados = async (m: MundoDeCobro, j: JornadaLista) =>
    (
      await dueno.query<{ origen_id: string; cobrado: string; total_del_ticket: string }>(
        `select origen_id, cobrado::text, total_del_ticket::text from conciliacion_de_cobro_por_origen
          where empresa_id = $1 and sucursal_id = $2 and fecha_negocio = $3 order by origen_id`,
        [m.empresa, m.sucursal, j.fecha],
      )
    ).rows;
  /** Cierra la sesión (efectivo contado = lo esperado, el resto conforme) y el día reconociendo lo reconocible. */
  const cerrarSesionYDia = async (m: MundoDeCobro, j: JornadaLista, esperado: string) => {
    const cerrada = await caja.casos.cerrarSesion(j.ctx(30), {
      sesionId: j.sesionId,
      conteo: conteoDe(esperado),
      otros: [],
      conformeGeneral: true,
      observacion: null,
    });
    expect(cerrada.ok, JSON.stringify(cerrada)).toBe(true);
    await empezarElCierre(cierre, j);
    return cerrarElDia(cierre, j, { texto: "Devolucion reconocida" });
  };

  it("una devolución PARCIAL: el día cierra, cuadra y la foto guarda el cobrado neto (6.000) contra el total del ticket (10.000)", async () => {
    const m = await mundo();
    const cobranza = origenNuevo();
    const j = await jornada(m, [{ medio: "EFECTIVO", importe: "10000.00", origen: cobranza }]);
    await devolver(m, j, cobranza.id, [linea(m, "TRANSFERENCIA", "4000.00")]);
    const dia = await cerrarSesionYDia(m, j, "11000.00");
    expect(dia.ok, JSON.stringify(dia)).toBe(true);
    expect(await origenesGuardados(m, j)).toEqual([
      { origen_id: cobranza.id, cobrado: "6000.00", total_del_ticket: "10000.00" },
    ]);
  });

  it("una devolución ANULADA vuelve al bruto: el día cierra sin diferencia contra el ticket y no guarda ningún origen", async () => {
    const m = await mundo();
    const cobranza = origenNuevo();
    const j = await jornada(m, [{ medio: "EFECTIVO", importe: "10000.00", origen: cobranza }]);
    const d = await devolver(m, j, cobranza.id, [linea(m, "QR", "10000.00")]);
    const anulada = await caja.casos.anularDevolucion(j.ctx(20), {
      claveDeIdempotencia: claveNueva(),
      devolucionId: d.devolucionId,
      motivo: "Se devolvió por error",
    });
    expect(anulada.ok).toBe(true);
    const dia = await cerrarSesionYDia(m, j, "11000.00");
    expect(dia.ok, JSON.stringify(dia)).toBe(true);
    expect(await origenesGuardados(m, j)).toEqual([]);
  });

  it("dos orígenes en la misma jornada: cada uno resta SOLO lo suyo; el que se devolvió entero no figura y el otro guarda su diferencia", async () => {
    const m = await mundo();
    const a = origenNuevo();
    const b = origenNuevo();
    const j = await jornada(m, [
      { medio: "EFECTIVO", importe: "8000.00", origen: a, totalDelTicket: "0.00" },
      { medio: "EFECTIVO", importe: "3000.00", origen: b, totalDelTicket: "2000.00" },
    ]);
    await devolver(m, j, a.id, [linea(m, "TRANSFERENCIA", "8000.00")]);
    await devolver(m, j, b.id, [linea(m, "QR", "500.00")]);
    const dia = await cerrarSesionYDia(m, j, "12000.00");
    expect(dia.ok, JSON.stringify(dia)).toBe(true);
    // A: 8.000 − 8.000 = 0 contra un ticket de 0 → sin diferencia. B: 3.000 − 500 = 2.500 contra 2.000 → diferencia de 500 guardada.
    expect(await origenesGuardados(m, j)).toEqual([
      { origen_id: b.id, cobrado: "2500.00", total_del_ticket: "2000.00" },
    ]);
  });

  it("AISLAMIENTO: lo devuelto de una cobranza de OTRA empresa no entra en la cuenta de esta (ni aunque el id coincida)", async () => {
    const m = await mundo();
    const otra = await mundo();
    const cobranza = origenNuevo();
    const j = await jornada(m, [
      { medio: "EFECTIVO", importe: "1000.00", origen: cobranza, totalDelTicket: "400.00" },
    ]);
    const jOtra = await jornada(otra, [
      { medio: "EFECTIVO", importe: "1000.00", origen: cobranza, totalDelTicket: "400.00" },
    ]);
    await devolver(otra, jOtra, cobranza.id, [linea(otra, "QR", "600.00")]);
    expect((await conciliacion(j)).cobradoContraTicket[0]).toMatchObject({
      cobrado: pesos("1000.00"),
      diferencia: pesos("600.00"),
    });
    expect((await conciliacion(jOtra)).cobradoContraTicket).toEqual([]);
  });

  it("cerrar el día dos veces: la segunda no cambia la foto ni falla", async () => {
    const m = await mundo();
    const cobranza = origenNuevo();
    const j = await jornada(m, [
      { medio: "EFECTIVO", importe: "2000.00", origen: cobranza, totalDelTicket: "1500.00" },
    ]);
    await devolver(m, j, cobranza.id, [linea(m, "QR", "200.00")]);
    const primera = await cerrarSesionYDia(m, j, "2800.00");
    expect(primera.ok, JSON.stringify(primera)).toBe(true);
    const antes = JSON.stringify(await origenesGuardados(m, j));
    const segunda = await cerrarElDia(cierre, j, { texto: "Devolucion reconocida" });
    expect(segunda.ok, JSON.stringify(segunda)).toBe(true);
    expect(JSON.stringify(await origenesGuardados(m, j))).toBe(antes);
  });

  it("CONCURRENCIA: cerrar el día contra una devolución de OTRA jornada sobre la misma cobranza, en los dos órdenes: el cierre siempre confirma y la foto del día del cobro no cambia", async () => {
    for (const cierraPrimero of [true, false]) {
      const m = await mundo();
      const cobranza = origenNuevo();
      const dia1 = await jornada(m, [
        { medio: "EFECTIVO", importe: "5000.00", origen: cobranza, totalDelTicket: "4000.00" },
      ]);
      expect(
        (
          await caja.casos.cerrarSesion(dia1.ctx(30), {
            sesionId: dia1.sesionId,
            conteo: conteoDe("6000.00"),
            otros: [],
            conformeGeneral: true,
            observacion: null,
          })
        ).ok,
      ).toBe(true);
      await empezarElCierre(cierre, dia1);
      const dia2 = await jornada(m, [], 2);
      const cerrar = () => cerrarElDia(cierre, dia1, { texto: "Devolucion reconocida" });
      const devolverYa = () =>
        caja.casos.devolverDinero(dia2.ctx(10), {
          claveDeIdempotencia: claveNueva(),
          cajaId: m.cajaId,
          cobranzaId: cobranza.id,
          lineas: [linea(m, "TRANSFERENCIA", "1000.00")],
          motivo: "Producto en mal estado",
        });
      let pc: ReturnType<typeof cerrar>;
      let pd: ReturnType<typeof devolverYa>;
      if (cierraPrimero) {
        pc = cerrar();
        pd = devolverYa();
      } else {
        pd = devolverYa();
        pc = cerrar();
      }
      const [rc, rd] = await Promise.all([pc, pd]);
      expect(rd.ok, JSON.stringify(rd)).toBe(true);
      expect(rc.ok, JSON.stringify(rc)).toBe(true);
      // La devolución cayó en OTRA jornada: no toca el control del día del cobro, entre en el orden que entre. La foto guarda el bruto (5.000) contra el ticket (4.000).
      expect(await origenesGuardados(m, dia1)).toEqual([
        { origen_id: cobranza.id, cobrado: "5000.00", total_del_ticket: "4000.00" },
      ]);
    }
  });

  it("la reversión de 0115 FRENA (55000) si ya hay una foto de cierre con el cobrado neto de devoluciones, y no cambia nada", async () => {
    const m = await mundo();
    const cobranza = origenNuevo();
    const j = await jornada(m, [{ medio: "EFECTIVO", importe: "3000.00", origen: cobranza }]);
    await devolver(m, j, cobranza.id, [linea(m, "QR", "1000.00")]);
    expect((await cerrarSesionYDia(m, j, "3000.00")).ok).toBe(true);
    expect(await origenesGuardados(m, j)).toHaveLength(1);
    const reversion = await readFile(
      join(
        CARPETA_DE_MIGRACIONES,
        "reversiones/0115_revertir_cierre_de_caja_cobrado_neto_de_devoluciones.sql",
      ),
      "utf8",
    );
    const cuerpo = async () =>
      (
        await dueno.query<{ def: string }>(
          "select pg_get_functiondef(p.oid) as def from pg_proc p where p.proname = 'cierre_de_caja_verificar'",
        )
      ).rows[0]?.def;
    const antes = await cuerpo();
    const fallo = await dueno.query(reversion).then(
      () => null,
      (error: unknown) => error as { code?: string; message?: string },
    );
    expect(fallo?.code).toBe("55000");
    expect(fallo?.message).toContain("no se revierte sin decisión del dueño");
    expect(await cuerpo()).toBe(antes);
  });

  it("una cobranza con cobros en DOS jornadas y UNA devolución en la 2.ª: descuenta solo en la 2.ª (sin doble descuento ni neto negativo falso) y las dos jornadas cierran", async () => {
    const m = await mundo();
    const cobranza = origenNuevo();
    const dia1 = await jornada(m, [
      {
        medio: "EFECTIVO",
        importe: "3000.00",
        origen: cobranza,
        orden: 1,
        totalDelTicket: "5000.00",
      },
    ]);
    expect((await cerrarSesionYDia(m, dia1, "4000.00")).ok).toBe(true);
    const dia2 = await jornada(
      m,
      [
        {
          medio: "EFECTIVO",
          importe: "2000.00",
          origen: cobranza,
          orden: 2,
          totalDelTicket: "5000.00",
        },
      ],
      2,
    );
    await devolver(m, dia2, cobranza.id, [linea(m, "QR", "500.00")]);
    expect((await conciliacion(dia2)).cobradoContraTicket[0]).toMatchObject({
      cobrado: pesos("1500.00"),
    });
    expect(await origenesGuardados(m, dia1)).toEqual([
      { origen_id: cobranza.id, cobrado: "3000.00", total_del_ticket: "5000.00" },
    ]);
    const cerrado2 = await cerrarSesionYDia(m, dia2, "3500.00");
    expect(cerrado2.ok, JSON.stringify(cerrado2)).toBe(true);
    expect(await origenesGuardados(m, dia2)).toEqual([
      { origen_id: cobranza.id, cobrado: "1500.00", total_del_ticket: "5000.00" },
    ]);
  });

  it("CONCURRENCIA: devolver contra cerrar la sesión, en los dos órdenes: el esperado del arqueo cuenta la devolución que entró o la devolución se rechaza; nunca un cierre sin una devolución ya hecha", async () => {
    for (const devuelvePrimero of [true, false]) {
      const m = await mundo();
      const cobranza = origenNuevo();
      const j = await jornada(m, [{ medio: "EFECTIVO", importe: "2000.00", origen: cobranza }]);
      const cerrar = () =>
        caja.casos.cerrarSesion(j.ctx(30), {
          sesionId: j.sesionId,
          // El conteo SIN la devolución: si la devolución entra antes, el cierre no puede confirmar.
          conteo: conteoDe("3000.00"),
          otros: [],
          conformeGeneral: true,
          observacion: null,
        });
      const devolverYa = () =>
        caja.casos.devolverDinero(j.ctx(10), {
          claveDeIdempotencia: claveNueva(),
          cajaId: m.cajaId,
          cobranzaId: cobranza.id,
          lineas: [linea(m, "EFECTIVO", "500.00")],
          motivo: "Producto en mal estado",
        });
      let pd: ReturnType<typeof devolverYa>;
      let pc: ReturnType<typeof cerrar>;
      if (devuelvePrimero) {
        pd = devolverYa();
        pc = cerrar();
      } else {
        pc = cerrar();
        pd = devolverYa();
      }
      const [rd, rc] = await Promise.all([pd, pc]);
      const [{ estado }] = (
        await dueno.query<{ estado: string }>("select estado from sesion_caja where id = $1", [
          j.sesionId,
        ])
      ).rows as [{ estado: string }];
      const devoluciones = Number(
        (
          await dueno.query<{ n: string }>(
            "select count(*) as n from movimiento_de_dinero where empresa_id = $1 and devuelve_origen_id = $2",
            [m.empresa, cobranza.id],
          )
        ).rows[0]?.n,
      );
      // Con la sesión cerrada, el esperado que quedó en el arqueo es EXACTAMENTE lo que hay en sus movimientos: la devolución que entró antes está contada y la que llegó
      // después se rechazó; nunca un cierre calculado sin una devolución que ya estaba.
      expect(rc.ok).toBe(true);
      expect(estado).toBe("CERRADA");
      expect(devoluciones).toBe(rd.ok ? 1 : 0);
      const [arqueo] = (
        await dueno.query<{ esperado: string }>(
          `select (a.contado - a.diferencia)::text as esperado from arqueo_caja a
            where a.sesion_id = $1 and a.medio_de_pago_id = $2`,
          [j.sesionId, m.medios.EFECTIVO],
        )
      ).rows;
      const [movimientos] = (
        await dueno.query<{ total: string }>(
          `select coalesce(sum(importe), 0)::text as total from movimiento_caja
            where sesion_id = $1 and medio_de_pago_id = $2`,
          [j.sesionId, m.medios.EFECTIVO],
        )
      ).rows;
      expect(arqueo?.esperado).toBe(movimientos?.total);
      expect(movimientos?.total).toBe(rd.ok ? "2500.00" : "3000.00");
    }
  });
});
