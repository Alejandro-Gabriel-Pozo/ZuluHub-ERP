import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { agotadaEnElResultado, repetirSiAgotada } from "./concurrencia-apoyo";
import { ajustarPerilla } from "./marcas-apoyo";
import { cuentaConLinea, montarVentas, nuevoId, valorDe, type MundoDeVentas } from "./ventas-apoyo";
import {
  crearFiscalDePrueba,
  escenarioFacturable,
  nuevaClaveDeFactura as nuevaClave,
  receptorConsumidorFinal,
  type EscenarioDeFacturacionDeTickets,
} from "./ventas-facturar-apoyo";

/**
 * R-05a (decisión del dueño, 14/11/2026: «se permite facturar antes de cobrar»): la política por empresa con la perilla `facturar_antes_de_cobrar`
 * (base APAGADA), con los casos de uso reales de ventas, el facturador real, la base real y el rol de la aplicación. Cubre: apagada = como hoy
 * (EMITIDO es TICKET_NO_FACTURABLE); encendida, un EMITIDO se factura y SIGUE EMITIDO; cobrarlo después no cambia la factura y hay una sola
 * cobranza; ANULADO y CORTESIA nunca; anular un EMITIDO facturado exige acreditar; las dos órdenes de emitir+cobrar y emitir+anular, y la carrera
 * de cada par; idempotencia por clave; la perilla de una empresa no mueve a otra; y la lista de pendientes (encendida suma los EMITIDO).
 * La base ya trae la migración 0108 (R-05b), que afloja el disparador de alta; sus propias pruebas están en `ventas-facturar-antes-de-cobrar-migracion.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

type Fila = Record<string, unknown>;
type Cualquiera = Resultado<unknown, unknown>;

/** El código de un resultado: `ok`, el error si es texto, o su `error` o `tipo` si es un objeto tipado. */
function codigoDe(r: Cualquiera): string {
  if (r.ok) return "ok";
  const x = r.error;
  if (typeof x === "string") return x;
  if (typeof x === "object" && x !== null) {
    if ("error" in x && typeof x.error === "string") return x.error;
    if ("tipo" in x && typeof x.tipo === "string") return x.tipo;
  }
  return "otro";
}

function falla<E>(r: Readonly<{ ok: true; valor: unknown } | { ok: false; error: E }>): E {
  if (r.ok) throw new Error(`se esperaba un error y vino ok ${JSON.stringify(r.valor)}`);
  return r.error;
}

describe.skipIf(base === null)("ventas: facturar antes de cobrar (R-05a)", () => {
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

  /** Una empresa facturable con su caja abierta y la perilla en el estado pedido (apagada de base). */
  async function preparar(encendida = false) {
    const e = await escenarioFacturable(m);
    const caja = await m.cajaAbierta(e);
    if (encendida) await perilla(e, true);
    fiscal.adelantar();
    return { e, caja };
  }
  type Preparado = Awaited<ReturnType<typeof preparar>>;

  /** Cambia la perilla con un ajuste de la empresa (lo que hace la plataforma con motivo y vigencia). */
  async function perilla(e: EscenarioDeFacturacionDeTickets, encendida: boolean) {
    const fila = (
      await m.filas<{ tenant_id: string }>("select tenant_id from empresa where id = $1", [
        e.empresa,
      ])
    )[0];
    await ajustarPerilla(
      m.dueno,
      String(fila?.tenant_id),
      "facturar_antes_de_cobrar",
      encendida ? "1" : "0",
      { empresa: e.empresa },
    );
  }

  /** Un ticket cerrado SIN cobrar (EMITIDO): lo que cierra la cuenta a cuenta corriente o el salón. */
  async function emitido(e: EscenarioDeFacturacionDeTickets, cantidad = "1") {
    const { cuenta } = await cuentaConLinea(m, e, e.gerente, cantidad);
    const t = valorDe(
      await m.casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }),
    );
    return { cuenta, ...t };
  }
  type Emitido = Awaited<ReturnType<typeof emitido>>;

  const ctx = (e: EscenarioDeFacturacionDeTickets) => ({
    ...e.gerente,
    ahora: fiscal.reloj.ahora(),
  });
  const facturar = (e: EscenarioDeFacturacionDeTickets, ticketId: string, clave = nuevaClave()) =>
    m.casos.emitirComprobanteDeTicket(ctx(e), {
      ticketId,
      receptor: receptorConsumidorFinal(),
      puntoDeVentaId: e.pv,
      clave,
    });
  const cobrar = (p: Preparado, t: Emitido) =>
    m.casos.cobrar(p.e.gerente, {
      claveIdempotencia: nuevaClave(),
      ticketId: t.ticketId,
      ejemplarId: t.ejemplarId,
      cajaId: p.caja.cajaId,
      cobros: [
        {
          medioDePagoId: p.caja.medios["EFECTIVO"] as string,
          cuentaDeCobroId: null,
          importe: { moneda: "ARS", monto: "1000.00" },
        },
      ],
    });
  const anular = (e: EscenarioDeFacturacionDeTickets, t: Emitido) =>
    m.casos.anularTicket(e.gerente, {
      sucursalDeTrabajo: e.sucursal,
      claveIdempotencia: nuevaClave(),
      ticketId: t.ticketId,
      ejemplarBaseId: t.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Cargado por error",
    });

  const estado = async (ticketId: string) =>
    (await m.filas<Fila>("select estado from ticket where id = $1", [ticketId]))[0]?.["estado"];
  const vigentes = (ticketId: string) =>
    m.filas<Fila>(
      "select comprobante_id, clave from documento_de_ticket where ticket_id = $1 and vigente",
      [ticketId],
    );
  const cobranzas = (ticketId: string) =>
    m.contar("select count(*) as n from cobranza_de_ticket where ticket_id = $1", [ticketId]);
  const escrituras = async (empresa: string) => ({
    comprobantes: await m.contar("select count(*) as n from comprobante where empresa_id = $1", [
      empresa,
    ]),
    punteros: await m.contar(
      "select count(*) as n from documento_de_ticket where empresa_id = $1",
      [empresa],
    ),
  });
  const pendientes = async (e: EscenarioDeFacturacionDeTickets) =>
    valorDe(await m.consultas.ticketsPendientesDeFacturar(ctx(e), {})).tickets;

  /** El mismo pedido se repite si pierde por agotamiento (es seguro por su clave). */
  const firme = <R extends Cualquiera>(trabajo: () => Promise<R>) =>
    repetirSiAgotada(trabajo, { esAgotada: agotadaEnElResultado });
  const dosALaVez = async <A, B>(a: () => Promise<A>, b: () => Promise<B>): Promise<[A, B]> => {
    m.armarBarrera(2);
    try {
      return await Promise.all([a(), b()]);
    } finally {
      m.soltarBarrera();
    }
  };

  // ---- apagada: como hoy -------------------------------------------------------------------------------------------------------

  it("apagada (de base): un ticket EMITIDO es TICKET_NO_FACTURABLE, no escribe nada y no se ofrece para facturar", async () => {
    const p = await preparar();
    const t = await emitido(p.e);
    const antes = await escrituras(p.e.empresa);
    expect(falla(await facturar(p.e, t.ticketId))).toBe("TICKET_NO_FACTURABLE");
    expect(await escrituras(p.e.empresa)).toEqual(antes);
    expect(falla(await m.consultas.ticketParaFacturar(ctx(p.e), { ticketId: t.ticketId }))).toBe(
      "TICKET_NO_FACTURABLE",
    );
    expect(
      valorDe(await m.consultas.fichaDeTicket(ctx(p.e), { ticketId: t.ticketId }))
        .pendienteDeFacturar,
    ).toBe(false);
    expect((await pendientes(p.e)).map((x) => x.ticketId)).not.toContain(t.ticketId);
  });

  // ---- encendida: se factura un EMITIDO y sigue EMITIDO ------------------------------------------------------------------------

  it("encendida: un EMITIDO se factura por el total del ejemplar vigente y SIGUE EMITIDO (sin cobranza); la ficha y la lista lo ofrecen", async () => {
    const p = await preparar(true);
    const t = await emitido(p.e, "2");
    const lectura = valorDe(
      await m.consultas.ticketParaFacturar(ctx(p.e), { ticketId: t.ticketId }),
    );
    expect(lectura.total.monto).toBe("2000.00");
    expect(
      valorDe(await m.consultas.fichaDeTicket(ctx(p.e), { ticketId: t.ticketId }))
        .pendienteDeFacturar,
    ).toBe(true);
    const enLista = (await pendientes(p.e)).find((x) => x.ticketId === t.ticketId);
    expect(enLista).toMatchObject({ motivo: "SIN_COMPROBANTE", cobradoEn: null });

    const f = valorDe(await facturar(p.e, t.ticketId));
    expect(f.yaExistia).toBe(false);
    expect(await estado(t.ticketId)).toBe("EMITIDO");
    expect(await cobranzas(t.ticketId)).toBe(0);
    expect(
      (
        await m.filas<Fila>(
          "select total::text as total from comprobante where id = $1 and empresa_id = $2",
          [f.comprobanteId, p.e.empresa],
        )
      )[0]?.["total"],
    ).toBe("2000.00");
    expect(await vigentes(t.ticketId)).toHaveLength(1);
    expect((await m.auditoria(p.e.empresa, "DOCUMENTO_DE_TICKET_CREADO")).length).toBe(1);
    // Ya facturado, deja de ser pendiente.
    expect((await pendientes(p.e)).map((x) => x.ticketId)).not.toContain(t.ticketId);
  });

  it("encendida: la lista de pendientes trae EMITIDO y COBRADO sin comprobante, y nunca CORTESIA ni ANULADO", async () => {
    const p = await preparar(true);
    const porCobrar = await emitido(p.e);
    const cobrado = await emitido(p.e);
    valorDe(await cobrar(p, cobrado));
    const anulado = await emitido(p.e);
    valorDe(await anular(p.e, anulado));
    const productoACero = await m.productoVendible(p.e.empresa, "0");
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(p.e.gerente, { cuentaId: cuenta, sucursalId: p.e.sucursal }));
    valorDe(
      await m.casos.agregarLinea(p.e.gerente, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: productoACero,
        opcionIds: [],
        cantidad: "1",
        confirmaciones: ["VENTA_A_CERO"],
      }),
    );
    const cortesia = valorDe(
      await m.casos.cerrarCuenta(p.e.gerente, {
        cuentaId: cuenta,
        ejemplarId: nuevoId(),
        confirmaciones: ["VENTA_A_CERO"],
      }),
    );
    expect(await estado(cortesia.ticketId)).toBe("CORTESIA");

    const ids = (await pendientes(p.e)).map((x) => x.ticketId);
    expect(ids).toContain(porCobrar.ticketId);
    expect(ids).toContain(cobrado.ticketId);
    expect(ids).not.toContain(anulado.ticketId);
    expect(ids).not.toContain(cortesia.ticketId);
    // Ni anulado ni cortesía se facturan, aunque la perilla esté encendida.
    expect(falla(await facturar(p.e, anulado.ticketId))).toBe("TICKET_NO_FACTURABLE");
    expect(falla(await facturar(p.e, cortesia.ticketId))).toBe("TICKET_NO_FACTURABLE");
    // Apagada: solo los cobrados.
    await perilla(p.e, false);
    const sinPerilla = (await pendientes(p.e)).map((x) => x.ticketId);
    expect(sinPerilla).toContain(cobrado.ticketId);
    expect(sinPerilla).not.toContain(porCobrar.ticketId);
  });

  // ---- facturar y cobrar: dos dimensiones independientes ------------------------------------------------------------------------

  it("facturar y después cobrar: el ticket pasa a COBRADO, la factura no cambia y hay una sola cobranza", async () => {
    const p = await preparar(true);
    const t = await emitido(p.e);
    const f = valorDe(await facturar(p.e, t.ticketId));
    const antes = await vigentes(t.ticketId);
    valorDe(await cobrar(p, t));
    expect(await estado(t.ticketId)).toBe("COBRADO");
    expect(await cobranzas(t.ticketId)).toBe(1);
    expect(await vigentes(t.ticketId)).toEqual(antes);
    expect(antes[0]?.["comprobante_id"]).toBe(f.comprobanteId);
    // Cobrar de nuevo (otra clave) no duplica la cobranza.
    expect(falla(await cobrar(p, t))).toBeDefined();
    expect(await cobranzas(t.ticketId)).toBe(1);
  });

  it("cobrar y después facturar (el otro orden): se factura el COBRADO, una sola cobranza y un solo comprobante", async () => {
    const p = await preparar(true);
    const t = await emitido(p.e);
    valorDe(await cobrar(p, t));
    valorDe(await facturar(p.e, t.ticketId));
    expect(await estado(t.ticketId)).toBe("COBRADO");
    expect(await cobranzas(t.ticketId)).toBe(1);
    expect(await vigentes(t.ticketId)).toHaveLength(1);
  });

  it("emitir y cobrar a la vez: las dos cosas se hacen, ninguna estropea a la otra (una cobranza, un comprobante vigente)", async () => {
    const p = await preparar(true);
    for (let i = 0; i < 4; i++) {
      const t = await emitido(p.e);
      const [rf, rc] = await dosALaVez(
        () => firme(() => facturar(p.e, t.ticketId)),
        () => firme(() => cobrar(p, t)),
      );
      expect([codigoDe(rf), codigoDe(rc)]).toEqual(["ok", "ok"]);
      expect(await estado(t.ticketId)).toBe("COBRADO");
      expect(await cobranzas(t.ticketId)).toBe(1);
      expect(await vigentes(t.ticketId)).toHaveLength(1);
    }
  });

  // ---- anular -------------------------------------------------------------------------------------------------------------------

  it("anular un EMITIDO facturado es TICKET_CON_COMPROBANTE_VIGENTE; con la nota de crédito total autorizada, se anula", async () => {
    const p = await preparar(true);
    const t = await emitido(p.e);
    const f = valorDe(await facturar(p.e, t.ticketId));
    expect(falla(await anular(p.e, t))).toEqual({
      error: "TICKET_CON_COMPROBANTE_VIGENTE",
      comprobanteId: f.comprobanteId,
    });
    expect(await estado(t.ticketId)).toBe("EMITIDO");
    await fiscal.autorizar(p.e, f.comprobanteId);
    await fiscal.autorizar(p.e, await fiscal.notaDeCredito(p.e, f.comprobanteId, "1000.00"));
    expect(valorDe(await anular(p.e, t)).estado).toBe("ANULADO");
  });

  it("anular antes de facturar: el ticket anulado no se factura (TICKET_NO_FACTURABLE) y no escribe", async () => {
    const p = await preparar(true);
    const t = await emitido(p.e);
    valorDe(await anular(p.e, t));
    const antes = await escrituras(p.e.empresa);
    expect(falla(await facturar(p.e, t.ticketId))).toBe("TICKET_NO_FACTURABLE");
    expect(await escrituras(p.e.empresa)).toEqual(antes);
  });

  it("emitir y anular a la vez: uno gana y nunca queda un ticket anulado con factura vigente", async () => {
    const p = await preparar(true);
    let ganoLaFactura = 0;
    let ganoLaAnulacion = 0;
    for (let i = 0; i < 6; i++) {
      const t = await emitido(p.e);
      const [rf, ra] = await dosALaVez(
        () => firme(() => facturar(p.e, t.ticketId)),
        () => firme(() => anular(p.e, t)),
      );
      const [cf, ca] = [codigoDe(rf), codigoDe(ra)];
      const vig = await vigentes(t.ticketId);
      if (cf === "ok") {
        ganoLaFactura++;
        expect(ca).toBe("TICKET_CON_COMPROBANTE_VIGENTE");
        expect(await estado(t.ticketId)).toBe("EMITIDO");
        expect(vig).toHaveLength(1);
      } else {
        ganoLaAnulacion++;
        expect(cf).toBe("TICKET_NO_FACTURABLE");
        expect(ca).toBe("ok");
        expect(await estado(t.ticketId)).toBe("ANULADO");
        expect(vig).toHaveLength(0);
      }
    }
    expect(ganoLaFactura + ganoLaAnulacion).toBe(6);
  });

  // ---- idempotencia -------------------------------------------------------------------------------------------------------------

  it("la misma clave repetida devuelve la misma factura sin segundo comprobante; otra clave sobre el mismo ticket es TICKET_YA_FACTURADO", async () => {
    const p = await preparar(true);
    const t = await emitido(p.e);
    const clave = nuevaClave();
    const primera = valorDe(await facturar(p.e, t.ticketId, clave));
    const antes = await escrituras(p.e.empresa);
    const segunda = valorDe(await facturar(p.e, t.ticketId, clave));
    expect(segunda).toMatchObject({ comprobanteId: primera.comprobanteId, yaExistia: true });
    expect(await escrituras(p.e.empresa)).toEqual(antes);
    expect(falla(await facturar(p.e, t.ticketId))).toEqual({
      error: "TICKET_YA_FACTURADO",
      comprobanteId: primera.comprobanteId,
    });
    expect(await escrituras(p.e.empresa)).toEqual(antes);
  });

  it("doble clic (la misma clave a la vez) y dos cajeros (claves distintas a la vez): un solo comprobante vigente", async () => {
    const p = await preparar(true);
    const t1 = await emitido(p.e);
    const clave = nuevaClave();
    const [a, b] = await dosALaVez(
      () => firme(() => facturar(p.e, t1.ticketId, clave)),
      () => firme(() => facturar(p.e, t1.ticketId, clave)),
    );
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(await vigentes(t1.ticketId)).toHaveLength(1);

    const t2 = await emitido(p.e);
    const [c, d] = await dosALaVez(
      () => firme(() => facturar(p.e, t2.ticketId)),
      () => firme(() => facturar(p.e, t2.ticketId)),
    );
    expect([codigoDe(c), codigoDe(d)].sort()).toEqual(["TICKET_YA_FACTURADO", "ok"]);
    expect(await vigentes(t2.ticketId)).toHaveLength(1);
    expect(
      await m.contar("select count(*) as n from documento_de_ticket where ticket_id = $1", [
        t2.ticketId,
      ]),
    ).toBe(1);
  });

  // ---- la perilla: por empresa, sin invalidar lo hecho ---------------------------------------------------------------------------

  it("apagarla no invalida lo ya facturado, pero no deja facturar otro EMITIDO", async () => {
    const p = await preparar(true);
    const facturado = await emitido(p.e);
    const otro = await emitido(p.e);
    const f = valorDe(await facturar(p.e, facturado.ticketId));
    await perilla(p.e, false);
    expect((await vigentes(facturado.ticketId))[0]?.["comprobante_id"]).toBe(f.comprobanteId);
    expect(falla(await facturar(p.e, otro.ticketId))).toBe("TICKET_NO_FACTURABLE");
    // La repetición de lo ya hecho sigue devolviendo lo hecho (idempotencia por clave).
    const clave = (await vigentes(facturado.ticketId))[0]?.["clave"] as string;
    expect(valorDe(await facturar(p.e, facturado.ticketId, clave)).yaExistia).toBe(true);
  });

  it("la perilla de una empresa no mueve a otra (aislamiento) y un ticket de otra empresa es inexistente", async () => {
    const a = await preparar(true);
    const b = await preparar(false);
    const tb = await emitido(b.e);
    expect(falla(await facturar(b.e, tb.ticketId))).toBe("TICKET_NO_FACTURABLE");
    const ta = await emitido(a.e);
    expect(falla(await facturar(b.e, ta.ticketId))).toBe("TICKET_NO_ENCONTRADO");
    valorDe(await facturar(a.e, ta.ticketId));
  });

  it("la base es la segunda cerradura: con la perilla encendida, ANULADO y CORTESIA no se facturan ni directo contra la base", async () => {
    const p = await preparar(true);
    const anulado = await emitido(p.e);
    valorDe(await anular(p.e, anulado));
    const comprobante = valorDe(await facturar(p.e, (await emitido(p.e)).ticketId)).comprobanteId;
    const ejemplar = (
      await m.filas<Fila>(
        "select id from ticket_ejemplar where ticket_id = $1 order by numero_de_ejemplar desc limit 1",
        [anulado.ticketId],
      )
    )[0]?.["id"];
    await expect(
      m.dueno.query(
        `insert into documento_de_ticket (id, empresa_id, ticket_id, ejemplar_id, intento, vigente, clave, comprobante_id, creado_por, creado_en)
         values (gen_random_uuid(), $1, $2, $3, 1, true, $4, $5, $6, now())`,
        [
          p.e.empresa,
          anulado.ticketId,
          ejemplar,
          nuevaClave(),
          comprobante,
          p.e.personaDelOperador,
        ],
      ),
    ).rejects.toMatchObject({ constraint: "documento_ticket_no_facturable" });
  });
});
