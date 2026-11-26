import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { ticketsDelDia } from "../../src/modulos/ventas/consultas/tickets-del-dia";
import { crearFacturadorDeTickets } from "../../src/composicion/facturacion-de-tickets";
import { conteoDe } from "./caja-cierre-del-dia-apoyo";
import {
  montarVentas,
  nuevaClave,
  nuevoId,
  REGLAS_DE_PRUEBA,
  valorDe,
  type MundoDeVentas,
} from "./ventas-apoyo";
import {
  crearFiscalDePrueba,
  escenarioFacturable,
  nuevaClaveDeFactura,
  receptorConsumidorFinal,
  type EscenarioDeFacturacionDeTickets,
} from "./ventas-facturar-apoyo";

/**
 * «Tickets del día» y la ficha del ticket (PR-5 bis, DDD:293), con los casos de uso reales y una base real: qué jornada se muestra, el orden, el
 * tope, «facturado» (lo decide fiscal), los cobros con su medio y su caja, el anulado con su motivo y los renglones del original, el alcance por
 * sucursal, el aislamiento entre empresas y que repetir o leer a la vez no escribe nada.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Fila = Record<string, unknown>;
const monto = (m: string) => ({ moneda: "ARS", monto: m });

describe.skipIf(base === null)("ventas: tickets del día y ficha del ticket", () => {
  let m: MundoDeVentas;
  let fiscal: ReturnType<typeof crearFiscalDePrueba>;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { facturacion: true, conexiones: 16 });
    fiscal = crearFiscalDePrueba(m);
  });
  afterAll(async () => {
    await fiscal.cerrar();
    await m.cerrar();
  });

  type Caja = Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>;
  type Cobro = Readonly<{ tipo: string; cuenta?: string; importe: string }>;

  /** Un ticket cobrado por el camino real, con los cobros pedidos (por defecto, todo en efectivo). */
  async function vender(
    e: EscenarioDeFacturacionDeTickets,
    caja: Caja,
    cambios: Partial<{
      cobros: Cobro[];
      productoId: string;
      opcionIds: string[];
      total: string;
    }> = {},
  ) {
    const total = cambios.total ?? "1000.00";
    const cobros = cambios.cobros ?? [{ tipo: "EFECTIVO", importe: total }];
    const r = valorDe(
      await m.casos.venderYCobrar(e.gerente, {
        claveIdempotencia: nuevaClave(),
        cuentaId: nuevoId(),
        ejemplarId: nuevoId(),
        sucursalId: e.sucursal,
        lineas: [
          {
            lineaId: nuevoId(),
            productoId: cambios.productoId ?? e.producto,
            opcionIds: cambios.opcionIds ?? [],
            cantidad: "1",
          },
        ],
        totalEsperado: monto(total),
        cobro: {
          cajaId: caja.cajaId,
          cobros: cobros.map((c) => ({
            medioDePagoId: caja.medios[c.tipo] as string,
            cuentaDeCobroId: c.cuenta ?? null,
            importe: monto(c.importe),
          })),
        },
      }),
    );
    return { ticketId: r.ticketId, ejemplarId: r.ejemplarId };
  }

  const terminal = async (e: EscenarioDeFacturacionDeTickets, nombre: string) =>
    (
      await m.filas<{ id: string }>(
        "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, 'TERMINAL', $2, $3) returning id",
        [e.empresa, nombre, e.sucursal],
      )
    )[0]?.id as string;

  const anular = (
    e: EscenarioDeFacturacionDeTickets,
    t: { ticketId: string; ejemplarId: string },
  ) =>
    m.casos.anularTicket(e.gerente, {
      sucursalDeTrabajo: e.sucursal,
      claveIdempotencia: nuevaClave(),
      ticketId: t.ticketId,
      ejemplarBaseId: t.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Se cargó dos veces",
    });

  const lista = (ctx: ContextoOperativo, sucursal: string) =>
    m.consultas.ticketsDelDia(ctx, { sucursalId: sucursal });

  const escrituras = async (empresa: string) => {
    const cuenta = (tabla: string) =>
      m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [empresa]);
    return {
      tickets: await cuenta("ticket"),
      cobranzas: await cuenta("cobranza_de_ticket"),
      correcciones: await cuenta("ticket_correccion"),
      auditoria: (await m.auditoria(empresa)).length,
    };
  };

  it("la lista trae los tickets de la jornada del número mayor al menor, con su hora y totales; el anulado conserva el total original; otra jornada no aparece", async () => {
    const e = await escenarioFacturable(m);
    const caja = await m.cajaAbierta(e);
    const t1 = await vender(e, caja);
    const t2 = await vender(e, caja, { total: "1000.00" });
    const t3 = await vender(e, caja);
    valorDe(await anular(e, t2));
    // Una segunda caja abierta desde ayer: son dos abiertas, así que manda la jornada del reloj, y el ticket de ayer no aparece.
    const cajaDeAyer = await m.cajaAbierta(e, {
      contexto: { ...e.gerente, ahora: new Date("2026-11-08T15:00:00Z") },
    });
    await vender(e, cajaDeAyer);

    const l = valorDe(await lista(e.operador, e.sucursal));
    expect(l.fechaNegocio).toBe("2026-11-09");
    expect(l.tickets.map((t) => t.ticketId)).toEqual([t3.ticketId, t2.ticketId, t1.ticketId]);
    expect(l.tickets.map((t) => t.numero)).toEqual(
      [...l.tickets.map((t) => t.numero)].sort((a, b) => b - a),
    );
    const anulado = l.tickets[1];
    expect(anulado).toMatchObject({
      estado: "ANULADO",
      totalOriginal: monto("1000.00"),
      totalVigente: monto("0.00"),
      facturado: false,
    });
    expect(l.tickets[0]).toMatchObject({ estado: "COBRADO", totalVigente: monto("1000.00") });
    expect(l.tickets[0]?.emitidoEn).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  });

  it("la jornada es la de la caja abierta (aunque el reloj ya esté en otra); sin caja abierta, la del reloj", async () => {
    const e = await escenarioFacturable(m);
    const ayer = { ...e.gerente, ahora: new Date("2026-11-08T15:00:00Z") };
    const caja = await m.cajaAbierta(e, { contexto: ayer });
    expect(caja.fechaDeNegocio).toBe("2026-11-08");
    expect(valorDe(await lista(e.operador, e.sucursal)).fechaNegocio).toBe("2026-11-08");
    const sinCaja = await escenarioFacturable(m);
    expect(valorDe(await lista(sinCaja.operador, sinCaja.sucursal)).fechaNegocio).toBe(
      "2026-11-09",
    );
  });

  it("«facturado» lo decide fiscal: sin comprobante no; con comprobante vigente sí; acreditado por completo con una nota autorizada, no", async () => {
    const e = await escenarioFacturable(m);
    const caja = await m.cajaAbierta(e);
    const sin = await vender(e, caja);
    const con = await vender(e, caja);
    const acreditado = await vender(e, caja);
    fiscal.adelantar();
    const facturar = async (ticketId: string) =>
      valorDe(
        await m.casos.emitirComprobanteDeTicket(
          { ...e.gerente, ahora: fiscal.reloj.ahora() },
          {
            ticketId,
            receptor: receptorConsumidorFinal(),
            puntoDeVentaId: e.pv,
            clave: nuevaClaveDeFactura(),
          },
        ),
      );
    await facturar(con.ticketId);
    const f = await facturar(acreditado.ticketId);
    await fiscal.autorizar(e, f.comprobanteId);
    await fiscal.autorizar(e, await fiscal.notaDeCredito(e, f.comprobanteId, "1000.00"));

    const l = valorDe(await lista(e.gerente, e.sucursal));
    const facturado = (id: string) => l.tickets.find((t) => t.ticketId === id)?.facturado;
    expect(facturado(sin.ticketId)).toBe(false);
    expect(facturado(con.ticketId)).toBe(true);
    expect(facturado(acreditado.ticketId)).toBe(false);
    expect(valorDe(await m.consultas.fichaDelTicketDelDia(e.gerente, con)).facturado).toBe(true);
    expect(valorDe(await m.consultas.fichaDelTicketDelDia(e.gerente, sin)).facturado).toBe(false);
  });

  it("más tickets que el tope: DEMASIADOS_TICKETS (no se recorta en silencio)", async () => {
    const e = await escenarioFacturable(m);
    const caja = await m.cajaAbierta(e);
    for (let i = 0; i < 3; i++) await vender(e, caja);
    const dependencias = {
      transacciones: m.entorno,
      reglas: REGLAS_DE_PRUEBA,
      facturador: crearFacturadorDeTickets(REGLAS_DE_PRUEBA),
    };
    const conTope = (tope: number) =>
      m.entorno.ejecutar(
        { contexto: e.gerente, aislamiento: "read committed", soloLectura: true },
        (tx) =>
          ticketsDelDia(tx, e.gerente, dependencias, "TODAS", { sucursalId: e.sucursal }, tope),
      );
    expect(await conTope(2)).toEqual({ ok: false, error: "DEMASIADOS_TICKETS" });
    expect(valorDe(await conTope(3)).tickets).toHaveLength(3);
  });

  it("la ficha trae el sello de caja por cobro: lo que el medio pedía y quedó vacío; no cambia si después cambia la configuración", async () => {
    const e = await escenarioFacturable(m);
    const caja = await m.cajaAbierta(e);
    await m.dueno.query(
      "update medio_de_pago set pide_cupon = true, avisa_si_falta_cupon = true where empresa_id = $1 and tipo = 'TARJETA_DEBITO'",
      [e.empresa],
    );
    const cuenta = await terminal(e, "Terminal 2");
    const t = await vender(e, caja, {
      total: "1000.00",
      cobros: [
        { tipo: "EFECTIVO", importe: "400.00" },
        { tipo: "TARJETA_DEBITO", cuenta, importe: "600.00" },
      ],
    });
    await m.dueno.query(
      "update medio_de_pago set avisa_si_falta_cupon = false where empresa_id = $1 and tipo = 'TARJETA_DEBITO'",
      [e.empresa],
    );
    const f = valorDe(await m.consultas.fichaDelTicketDelDia(e.operador, t));
    expect(f.cobros.find((c) => c.medioTipo === "TARJETA_DEBITO")?.datosPendientes).toEqual([
      "cupon",
    ]);
    expect(f.cobros.find((c) => c.medioTipo === "EFECTIVO")?.datosPendientes).toEqual([]);
  });

  it("la ficha: renglones con medida y opciones, cobros con medio y cuenta, caja, quién y cuándo; una cuenta desactivada conserva su nombre; el medio corregido en el cierre se ve", async () => {
    const e = await escenarioFacturable(m);
    const caja = await m.cajaAbierta(e);
    const grupo = await m.grupoDeBase(e.empresa, e.producto, {
      clase: "ADICIONAL",
      nombre: "Extras",
      admiteVarias: true,
    });
    const miel = await m.opcionDeBase(e.empresa, e.producto, grupo, {
      nombre: "Miel",
      recargo: "150",
    });
    const cuenta = await terminal(e, "Terminal del frente");
    const t = await vender(e, caja, {
      total: "1150.00",
      opcionIds: [miel.opcion],
      cobros: [
        { tipo: "EFECTIVO", importe: "400.00" },
        { tipo: "TARJETA_DEBITO", cuenta, importe: "750.00" },
      ],
    });
    await m.dueno.query("update cuenta_de_cobro set activa = false where id = $1", [cuenta]);

    const f = valorDe(await m.consultas.fichaDelTicketDelDia(e.operador, t));
    expect(f).toMatchObject({
      ticketId: t.ticketId,
      estado: "COBRADO",
      fechaNegocio: "2026-11-09",
      totalOriginal: monto("1150.00"),
      totalVigente: monto("1150.00"),
      emitidoPor: e.gerente.personaId,
      ejemplarVigenteId: t.ejemplarId,
      anulacion: null,
      facturado: false,
      imprimible: true,
    });
    expect(f.emitidoEn).toMatch(/Z$/);
    expect(f.renglones).toHaveLength(1);
    expect(f.renglones[0]).toMatchObject({ cantidad: "1.0000", importe: "1150.00" });
    expect(f.renglones[0]?.unidadSimbolo).toBeTruthy();
    expect(f.renglones[0]?.opciones).toEqual([
      { grupo: "Extras", nombre: "Miel", recargo: "150.000000" },
    ]);
    const filaCaja = (
      await m.filas<Fila>("select nombre from caja where id = $1", [caja.cajaId])
    )[0];
    expect(f.caja).toEqual({ id: caja.cajaId, nombre: filaCaja?.["nombre"] });
    // Salen por orden de aplicación (el que fija el caso de uso); cada uno con su medio, su cuenta y su importe.
    expect(f.cobros.map((c) => c.orden)).toEqual([...f.cobros.map((c) => c.orden)].sort());
    expect(f.cobros.find((c) => c.medioTipo === "EFECTIVO")).toMatchObject({
      cuentaDeCobro: null,
      importe: monto("400.00"),
    });
    expect(f.cobros.find((c) => c.medioTipo === "TARJETA_DEBITO")).toMatchObject({
      cuentaDeCobro: { id: cuenta, nombre: "Terminal del frente" },
      importe: monto("750.00"),
    });

    // Una corrección de medio del cierre (efectivo → transferencia): la ficha muestra el medio con que quedó en la caja.
    const cobro = (
      await m.filas<Fila>(
        `select a.cobro_id from aplicacion_de_cobro a join cobranza_de_ticket c on c.id = a.cobranza_id and c.empresa_id = a.empresa_id
          where c.ticket_id = $1 and a.importe = 400`,
        [t.ticketId],
      )
    )[0]?.["cobro_id"];
    const tarde = { ...e.gerente, ahora: new Date("2026-11-09T21:00:00Z") };
    valorDe(
      await m.caja.cerrarSesion(tarde, {
        sesionId: caja.sesionId,
        conteo: conteoDe("400.00"),
        otros: [],
        conformeGeneral: true,
        observacion: null,
      }),
    );
    valorDe(
      await m.cierre.iniciarAuditoria(tarde, {
        sucursalId: e.sucursal,
        fechaDeNegocio: "2026-11-09",
      }),
    );
    valorDe(
      await m.caja.corregirMedioDeCobro(tarde, {
        claveDeIdempotencia: nuevaClave(),
        cobroId: String(cobro),
        medioDestinoId: caja.medios["TRANSFERENCIA"] as string,
        cuentaDestinoId: null,
        motivo: "Era transferencia",
      }),
    );
    const corregida = valorDe(await m.consultas.fichaDelTicketDelDia(e.operador, t));
    expect(corregida.cobros.map((c) => c.medioTipo).sort()).toEqual([
      "TARJETA_DEBITO",
      "TRANSFERENCIA",
    ]);
    expect(corregida.cobros.find((c) => c.medioTipo === "TRANSFERENCIA")?.importe).toEqual(
      monto("400.00"),
    );
  });

  it("la ficha de un anulado: motivo, quién, cuándo y los renglones del original; el total original queda y el vigente es 0", async () => {
    const e = await escenarioFacturable(m);
    const caja = await m.cajaAbierta(e);
    const t = await vender(e, caja);
    valorDe(await anular(e, t));
    const f = valorDe(await m.consultas.fichaDelTicketDelDia(e.operador, t));
    expect(f).toMatchObject({
      estado: "ANULADO",
      imprimible: false,
      totalOriginal: monto("1000.00"),
      totalVigente: monto("0.00"),
      anulacion: { motivo: "Se cargó dos veces", hechaPor: e.gerente.personaId },
    });
    expect(f.anulacion?.hechaEn).toMatch(/Z$/);
    expect(f.renglones).toHaveLength(1);
    expect(f.renglones[0]?.importe).toBe("1000.00");
    expect(f.ejemplarVigenteId).not.toBe(t.ejemplarId);
  });

  it("autorización y alcance: el operador ve la sucursal y los tickets de la suya, no los de otra; sin persona, nada", async () => {
    const e = await escenarioFacturable(m);
    const caja = await m.cajaAbierta(e);
    const cajaOtra = await m.cajaAbierta(e, { sucursal: e.otraSucursal });
    const propio = await vender(e, caja);
    const ajeno = await m.casos.venderYCobrar(e.gerente, {
      claveIdempotencia: nuevaClave(),
      cuentaId: nuevoId(),
      ejemplarId: nuevoId(),
      sucursalId: e.otraSucursal,
      lineas: [{ lineaId: nuevoId(), productoId: e.producto, opcionIds: [], cantidad: "1" }],
      totalEsperado: monto("1000.00"),
      cobro: {
        cajaId: cajaOtra.cajaId,
        cobros: [
          {
            medioDePagoId: cajaOtra.medios["EFECTIVO"] as string,
            cuentaDeCobroId: null,
            importe: monto("1000.00"),
          },
        ],
      },
    });
    const idAjeno = valorDe(ajeno).ticketId;

    expect(valorDe(await lista(e.operador, e.sucursal)).tickets).toHaveLength(1);
    expect(await lista(e.operador, e.otraSucursal)).toMatchObject({ ok: false });
    expect(valorDe(await m.consultas.fichaDelTicketDelDia(e.operador, propio)).ticketId).toBe(
      propio.ticketId,
    );
    expect(await m.consultas.fichaDelTicketDelDia(e.operador, { ticketId: idAjeno })).toMatchObject(
      { ok: false },
    );
    const sinPersona = { ...e.operador, personaId: null };
    expect(await lista(sinPersona, e.sucursal)).toMatchObject({ ok: false });
    expect(await m.consultas.fichaDelTicketDelDia(sinPersona, propio)).toMatchObject({
      ok: false,
    });
    expect(await lista(e.operador, "no-es-un-id")).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
    expect(await m.consultas.fichaDelTicketDelDia(e.operador, { ticketId: nuevoId() })).toEqual({
      ok: false,
      error: "TICKET_NO_ENCONTRADO",
    });
  });

  it("aislamiento entre empresas: ni la lista ni la ficha de otra empresa", async () => {
    const a = await escenarioFacturable(m);
    const b = await escenarioFacturable(m);
    const t = await vender(a, await m.cajaAbierta(a));
    expect(valorDe(await lista(b.gerente, b.sucursal)).tickets).toEqual([]);
    expect(await lista(b.gerente, a.sucursal)).toMatchObject({ ok: false });
    expect(await m.consultas.fichaDelTicketDelDia(b.gerente, t)).toEqual({
      ok: false,
      error: "TICKET_NO_ENCONTRADO",
    });
  });

  it("repetir la lectura y leer a la vez dan lo mismo y no escriben nada", async () => {
    const e = await escenarioFacturable(m);
    const caja = await m.cajaAbierta(e);
    const t = await vender(e, caja);
    valorDe(await anular(e, await vender(e, caja)));
    const antes = await escrituras(e.empresa);
    const [l1, l2, f1, f2] = await Promise.all([
      lista(e.gerente, e.sucursal),
      lista(e.gerente, e.sucursal),
      m.consultas.fichaDelTicketDelDia(e.gerente, t),
      m.consultas.fichaDelTicketDelDia(e.gerente, t),
    ]);
    expect(l1).toEqual(l2);
    expect(f1).toEqual(f2);
    expect(await lista(e.gerente, e.sucursal)).toEqual(l1);
    expect(await escrituras(e.empresa)).toEqual(antes);
  });
});
