import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  anularElTicket,
  cajasParaCobrar,
  cobrarLaVenta,
  opcionesDeCobroDeLaCaja,
  type DependenciasDeCobrarWeb,
} from "../../src/composicion/cobrar-web";
import { calcularVuelto } from "../../src/modulos/ventas/publico";
import {
  montarVentas,
  nuevaClave,
  nuevoId,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Composición web de cobrar (mostrador, K3 y K5) con los casos de uso reales y una base real: lo que sale a la pantalla, no los casos de uso (esos
 * tienen sus pruebas en `ventas-cobro*.test.ts`). Cubre: cobrar y la lista blanca de lo que se devuelve; clic doble y reintento con la MISMA clave
 * (un solo ticket, un solo cobro); dos envíos a la vez; el vuelto (al servidor llega el neto; un sobrante se rechaza); el precio que cambió y el cobro que
 * no cuadra no escriben nada y salen genéricos; anular desde el resultado (idempotente, ejemplar equivocado); autorización (sin persona, otra
 * sucursal); aislamiento entre empresas; y las dos lecturas (cajas y opciones).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const monto = (m: string) => ({ moneda: "ARS", monto: m });
const GENERICO = { ok: false, error: { codigo: "CAJA_ACCION_NO_PERMITIDA" } };

describe.skipIf(base === null)("composición web: cobrar y anular", () => {
  let m: MundoDeVentas;
  const registrados: string[] = [];
  let d: DependenciasDeCobrarWeb;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base);
    d = {
      casosDeUso: () => m.casos,
      consultas: () => m.consultas,
      respuesta: { registrar: (x) => registrados.push(x) },
    };
  });
  afterAll(async () => {
    await m.cerrar();
  });

  type Caja = Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>;

  /** Lo que arma la pantalla: ids y clave generados una vez, importes en texto. Venta de un producto de $1000. */
  const pedido = (e: EscenarioDeVentas, caja: Caja, cambios: Record<string, unknown> = {}) => ({
    claveIdempotencia: nuevaClave(),
    cuentaId: nuevoId(),
    ejemplarId: nuevoId(),
    lineas: [{ lineaId: nuevoId(), productoId: e.producto, opcionIds: [], cantidad: "1" }],
    totalEsperado: monto("1000.00"),
    cajaId: caja.cajaId,
    cobros: [
      { medioDePagoId: caja.medios["EFECTIVO"], cuentaDeCobroId: null, importe: monto("1000.00") },
    ],
    ...cambios,
  });

  const contar = (tabla: string, empresa: string) =>
    m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [empresa]);
  const rastros = async (e: EscenarioDeVentas) => ({
    cuentas: await contar("cuenta_consumo", e.empresa),
    tickets: await contar("ticket", e.empresa),
    cobranzas: await contar("cobranza_de_ticket", e.empresa),
    movimientos: await contar("movimiento_caja", e.empresa),
    cobros: await contar("cobro", e.empresa),
    auditoria: await contar("auditoria_empresa", e.empresa),
  });

  it("cobra y devuelve SOLO la lista blanca: ticket, total y cobros como texto decimal, sin ids internos de más", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const r = await cobrarLaVenta(d, e.gerente, e.sucursal, pedido(e, caja));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.dato).sort()).toEqual(
      [
        "cobranzaId",
        "cobros",
        "ejemplarId",
        "estado",
        "fechaNegocio",
        "numero",
        "pendienteDeFacturar",
        "ticketId",
        "total",
        "yaExistia",
      ].sort(),
    );
    expect(r.dato).toMatchObject({ estado: "COBRADO", total: monto("1000.00"), yaExistia: false });
    expect(r.dato.cobros).toHaveLength(1);
    expect(Object.keys(r.dato.cobros[0] ?? {}).sort()).toEqual(
      ["cuentaDeCobroId", "importe", "medioDePagoId", "orden"].sort(),
    );
    expect(await rastros(e)).toMatchObject({ tickets: 1, cobranzas: 1, cobros: 1 });
  });

  it("idempotencia: el clic doble y el reintento con la misma clave devuelven lo hecho y no duplican ticket, cobro ni caja", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const p = pedido(e, caja);
    const primera = await cobrarLaVenta(d, e.gerente, e.sucursal, p);
    const antes = await rastros(e);
    const segunda = await cobrarLaVenta(d, e.gerente, e.sucursal, p);
    const tercera = await cobrarLaVenta(d, e.gerente, e.sucursal, structuredClone(p));
    expect(primera.ok && segunda.ok && tercera.ok).toBe(true);
    if (!primera.ok || !segunda.ok || !tercera.ok) return;
    expect(segunda.dato).toEqual({ ...primera.dato, yaExistia: true });
    expect(tercera.dato).toEqual(segunda.dato);
    expect(await rastros(e)).toEqual(antes);
  });

  it("concurrencia: dos envíos a la vez con la misma clave dejan un solo ticket y un solo cobro", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const p = pedido(e, caja);
    m.armarBarrera(2);
    let rs;
    try {
      rs = await Promise.all([
        cobrarLaVenta(d, e.gerente, e.sucursal, p),
        cobrarLaVenta(d, e.gerente, e.sucursal, p),
      ]);
    } finally {
      m.soltarBarrera();
    }
    expect(rs.every((r) => r.ok)).toBe(true);
    const nuevos = rs.filter((r) => r.ok && !r.dato.yaExistia);
    expect(nuevos).toHaveLength(1);
    expect(await rastros(e)).toMatchObject({ tickets: 1, cobranzas: 1, cobros: 1 });
  });

  it("el vuelto es presentación: al servidor llega el neto en efectivo; mandar lo entregado completo es un sobrante y se rechaza sin escribir", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const v = calcularVuelto({
      total: monto("1000.00"),
      pagos: [{ tipo: "EFECTIVO", importe: monto("2000.00") }],
    });
    expect(v.ok && v.valor).toMatchObject({ vuelto: "1000.00", netoEnEfectivo: "1000.00" });
    const antes = await rastros(e);
    const conSobrante = pedido(e, caja, {
      cobros: [
        {
          medioDePagoId: caja.medios["EFECTIVO"],
          cuentaDeCobroId: null,
          importe: monto("2000.00"),
        },
      ],
    });
    expect(await cobrarLaVenta(d, e.gerente, e.sucursal, conSobrante)).toMatchObject(GENERICO);
    expect(await rastros(e)).toEqual(antes);
    if (!v.ok) return;
    const conNeto = pedido(e, caja, {
      cobros: [
        {
          medioDePagoId: caja.medios["EFECTIVO"],
          cuentaDeCobroId: null,
          importe: monto(v.valor.netoEnEfectivo),
        },
      ],
    });
    expect((await cobrarLaVenta(d, e.gerente, e.sucursal, conNeto)).ok).toBe(true);
  });

  it("precio que cambió, cobro que falta y caja de otra sucursal: genérico y no se escribe NADA (atomicidad)", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const antes = await rastros(e);
    const peticiones = [
      pedido(e, caja, { totalEsperado: monto("999.00") }),
      pedido(e, caja, {
        cobros: [
          {
            medioDePagoId: caja.medios["EFECTIVO"],
            cuentaDeCobroId: null,
            importe: monto("500.00"),
          },
        ],
      }),
      pedido(e, caja, { cajaId: nuevoId() }),
    ];
    for (const p of peticiones) {
      expect(await cobrarLaVenta(d, e.gerente, e.sucursal, p)).toMatchObject(GENERICO);
    }
    expect(await rastros(e)).toEqual(antes);
  });

  it("misma clave con otro pedido: genérico, no se reusa en silencio", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const p = pedido(e, caja);
    expect((await cobrarLaVenta(d, e.gerente, e.sucursal, p)).ok).toBe(true);
    const antes = await rastros(e);
    const otro = {
      ...p,
      totalEsperado: monto("2000.00"),
      lineas: [{ ...p.lineas[0], cantidad: "2" }],
      cobros: [{ ...p.cobros[0], importe: monto("2000.00") }],
    };
    expect(await cobrarLaVenta(d, e.gerente, e.sucursal, otro)).toMatchObject(GENERICO);
    expect(await rastros(e)).toEqual(antes);
  });

  it("autorización: sin persona sale con el código del guard; el operador no cobra en la sucursal de otro; el pedido no puede traer la sucursal", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const otraCaja = await m.cajaAbierta(e, { sucursal: e.otraSucursal });
    const antes = await rastros(e);
    const anonimo = { ...e.gerente, personaId: null };
    expect(await cobrarLaVenta(d, anonimo, e.sucursal, pedido(e, caja))).toMatchObject({
      ok: false,
      error: { codigo: "MODULO_NO_ACTIVO" },
    });
    expect(await cobrarLaVenta(d, e.operador, e.otraSucursal, pedido(e, otraCaja))).toMatchObject(
      GENERICO,
    );
    expect(
      await cobrarLaVenta(d, e.operador, e.sucursal, {
        ...pedido(e, caja),
        sucursalId: e.otraSucursal,
      }),
    ).toMatchObject(GENERICO);
    expect(await rastros(e)).toEqual(antes);
    expect((await cobrarLaVenta(d, e.operador, e.sucursal, pedido(e, caja))).ok).toBe(true);
  });

  it("aislamiento entre empresas: otra empresa no cobra contra la caja de esta ni la ve", async () => {
    const a = await m.escenario();
    const b = await m.escenario();
    const cajaDeA = await m.cajaAbierta(a);
    const antesA = await rastros(a);
    const antesB = await rastros(b);
    expect(await cobrarLaVenta(d, b.gerente, b.sucursal, pedido(b, cajaDeA))).toMatchObject(
      GENERICO,
    );
    expect(await opcionesDeCobroDeLaCaja(d, b.gerente, { cajaId: cajaDeA.cajaId })).toMatchObject(
      GENERICO,
    );
    expect(await rastros(a)).toEqual(antesA);
    expect(await rastros(b)).toEqual(antesB);
  });

  it("anular desde el resultado: anula con el ejemplar del cobro, es idempotente y un ejemplar equivocado no anula", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const cobrada = await cobrarLaVenta(d, e.gerente, e.sucursal, pedido(e, caja));
    if (!cobrada.ok) throw new Error("no cobró");
    const anulacion = {
      claveIdempotencia: nuevaClave(),
      ticketId: cobrada.dato.ticketId,
      ejemplarBaseId: cobrada.dato.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Se cobró de más",
    };
    const equivocado = { ...anulacion, claveIdempotencia: nuevaClave(), ejemplarBaseId: nuevoId() };
    expect(await anularElTicket(d, e.gerente, e.sucursal, equivocado)).toMatchObject(GENERICO);
    const primera = await anularElTicket(d, e.gerente, e.sucursal, anulacion);
    expect(primera).toMatchObject({ ok: true, dato: { estado: "ANULADO", yaExistia: false } });
    const antes = await rastros(e);
    const segunda = await anularElTicket(d, e.gerente, e.sucursal, anulacion);
    expect(segunda).toMatchObject({ ok: true, dato: { estado: "ANULADO", yaExistia: true } });
    expect(await rastros(e)).toEqual(antes);
    expect(
      await anularElTicket(d, e.gerente, e.sucursal, { ...anulacion, motivo: "Otro motivo" }),
    ).toMatchObject(GENERICO);
    expect(
      await anularElTicket(d, e.gerente, e.sucursal, { ...anulacion, motivo: "" }),
    ).toMatchObject(GENERICO);
  });

  it("anular: la sucursal la fija el servidor; sin sucursal de trabajo, de otra sucursal o con el caso de uso sin ella (un llamado que la omite) es «no encontrado» y no escribe nada, ni siquiera en una repetición", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const cobrada = await cobrarLaVenta(d, e.gerente, e.sucursal, pedido(e, caja));
    if (!cobrada.ok) throw new Error("no cobró");
    const anulacion = {
      claveIdempotencia: nuevaClave(),
      ticketId: cobrada.dato.ticketId,
      ejemplarBaseId: cobrada.dato.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Se cobró de más",
    };
    const antes = await rastros(e);
    expect(await anularElTicket(d, e.gerente, "", anulacion)).toMatchObject(GENERICO);
    expect(await anularElTicket(d, e.gerente, e.otraSucursal, anulacion)).toMatchObject(GENERICO);
    expect(await m.casos.anularTicket(e.gerente, anulacion as never)).toEqual({
      ok: false,
      error: "TICKET_NO_ENCONTRADO",
    });
    expect(await rastros(e)).toEqual(antes);
    expect(await anularElTicket(d, e.gerente, e.sucursal, anulacion)).toMatchObject({
      ok: true,
      dato: { estado: "ANULADO", yaExistia: false },
    });
    // Una repetición con la misma clave desde otra sucursal tampoco devuelve lo hecho.
    expect(await anularElTicket(d, e.gerente, e.otraSucursal, anulacion)).toMatchObject(GENERICO);
    expect(await anularElTicket(d, e.gerente, e.sucursal, anulacion)).toMatchObject({
      ok: true,
      dato: { yaExistia: true },
    });
  });

  it("concurrencia al anular: dos anulaciones a la vez con la misma clave dejan una sola anulación", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const cobrada = await cobrarLaVenta(d, e.gerente, e.sucursal, pedido(e, caja));
    if (!cobrada.ok) throw new Error("no cobró");
    const anulacion = {
      claveIdempotencia: nuevaClave(),
      ticketId: cobrada.dato.ticketId,
      ejemplarBaseId: cobrada.dato.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Se cobró de más",
    };
    m.armarBarrera(2);
    let rs;
    try {
      rs = await Promise.all([
        anularElTicket(d, e.gerente, e.sucursal, anulacion),
        anularElTicket(d, e.gerente, e.sucursal, anulacion),
      ]);
    } finally {
      m.soltarBarrera();
    }
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(rs.filter((r) => r.ok && !r.dato.yaExistia)).toHaveLength(1);
    expect(
      await m.contar("select count(*) as n from ticket_correccion where empresa_id = $1", [
        e.empresa,
      ]),
    ).toBe(1);
  });

  it("las lecturas: cajas con su sesión y opciones de la caja, con la lista blanca y la sucursal del servidor", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const cajas = await cajasParaCobrar(d, e.gerente, e.sucursal);
    expect(cajas.ok && cajas.dato.cajas.find((c) => c.cajaId === caja.cajaId)).toMatchObject({
      estado: "ABIERTA",
      sesionId: caja.sesionId,
    });
    expect(cajas.ok && Object.keys(cajas.dato).sort()).toEqual(["cajas", "jornadaActual"]);
    const opciones = await opcionesDeCobroDeLaCaja(d, e.gerente, { cajaId: caja.cajaId });
    expect(opciones.ok && opciones.dato.medios.map((x) => x.tipo)).toEqual(
      expect.arrayContaining(["EFECTIVO", "QR"]),
    );
    expect(
      await opcionesDeCobroDeLaCaja(d, e.gerente, { cajaId: caja.cajaId, sucursalId: e.sucursal }),
    ).toMatchObject(GENERICO);
    expect(await cajasParaCobrar(d, e.operador, e.otraSucursal)).toMatchObject(GENERICO);
  });
});
