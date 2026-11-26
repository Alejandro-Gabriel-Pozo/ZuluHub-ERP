import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { anularElTicket, type DependenciasDeCobrarWeb } from "../../src/composicion/cobrar-web";
import { cobrarLaMesa } from "../../src/composicion/cobrar-mesa-web";
import { TOPE_DE_CUENTAS_POR_CONSULTA } from "../../src/modulos/salon/consultas/numeros-de-mesa";
import { FECHA_DE_NEGOCIO } from "./ventas-apoyo";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * El número de la mesa de las cuentas (SAL-F, `numerosDeMesaDeCuentas`) y la cuenta de cada ticket de la jornada (`listarTickets`) contra una base real: el cierre del día dice «Diferencia por anulación de la mesa N» con lo que salen de acá.
 * La mesa es la que ancla la cuenta HOY (cambiar de mesa la mueve); una cuenta del mostrador, una mesa de otra sucursal o una cuenta ajena no aparecen (nunca se inventa un número); sin permiso de ver mesas o con la sucursal fuera de alcance es el
 * genérico; la lista de cuentas tiene tope. Una anulación de una mesa deja el ticket ANULADO con su cuenta, que es lo que une el cierre.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const monto = (v: string) => ({ moneda: "ARS", monto: v });

describe.skipIf(base === null)("salón: número de mesa de las cuentas", () => {
  let m: MundoDeSalon;
  let d: DependenciasDeCobrarWeb;
  const proxima = new Map<string, number>();
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    d = {
      casosDeUso: () => m.casos,
      consultas: () => m.consultas,
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const nuevaMesa = async (e: EscenarioDeVentas, sucursal: string = e.sucursal) => {
    const n = (proxima.get(`${e.empresa}/${sucursal}`) ?? 0) + 1;
    proxima.set(`${e.empresa}/${sucursal}`, n);
    const mesaId = nuevoId();
    valorDe(
      await m.salon.crearMesa(e.gerente, {
        mesaId,
        sucursalId: sucursal,
        numero: n + 20,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    return { mesaId, numero: n + 20 };
  };
  /** Una mesa con su cuenta y un producto de $ 1000 enviado a cocina, lista para cobrar. */
  const mesaConPedido = async (e: EscenarioDeVentas) => {
    const mesa = await nuevaMesa(e);
    const cuentaId = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId: mesa.mesaId }),
    ).cuentaId;
    valorDe(
      await m.salon.agregarAlPedido(e.gerente, {
        cuentaId,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    valorDe(
      await m.salon.enviarACocina(e.gerente, {
        envioId: nuevoId(),
        cuentaId,
        claveIdempotencia: nuevaClave(),
      }),
    );
    return { ...mesa, cuentaId };
  };
  const cobrar = async (e: EscenarioDeVentas, cuentaId: string) => {
    const caja = await m.cajaAbierta(e);
    const r = await cobrarLaMesa(
      { casosDeUso: () => m.salon, respuesta: { registrar: () => undefined } },
      e.gerente,
      e.sucursal,
      {
        claveIdempotencia: nuevaClave(),
        cuentaId,
        ejemplarId: nuevoId(),
        totalEsperado: monto("1000.00"),
        cajaId: caja.cajaId,
        cobros: [
          {
            medioDePagoId: caja.medios["EFECTIVO"],
            cuentaDeCobroId: null,
            importe: monto("1000.00"),
          },
        ],
      },
    );
    if (!r.ok) throw new Error("no cobró");
    return r.dato;
  };
  const numeros = (
    e: EscenarioDeVentas,
    cuentaIds: readonly string[],
    sucursal: string = e.sucursal,
  ) => m.consultasDeSalon.numerosDeMesaDeCuentas(e.gerente, { sucursalId: sucursal, cuentaIds });

  it("devuelve el número de la mesa de cada cuenta; una cuenta inexistente no aparece", async () => {
    const e = await m.escenario();
    const a = await mesaConPedido(e);
    const b = await mesaConPedido(e);
    const r = await numeros(e, [a.cuentaId, b.cuentaId, nuevoId()]);
    expect(r.ok && [...r.valor].sort((x, y) => x.numero - y.numero)).toEqual(
      [
        { cuentaId: a.cuentaId, numero: a.numero },
        { cuentaId: b.cuentaId, numero: b.numero },
      ].sort((x, y) => x.numero - y.numero),
    );
  });

  it("cambiar de mesa mueve el número: la cuenta responde con la mesa de HOY, no con la de cuando se abrió", async () => {
    const e = await m.escenario();
    const a = await mesaConPedido(e);
    const destino = await nuevaMesa(e);
    valorDe(
      await m.salon.cambiarDeMesa(e.gerente, {
        cuentaId: a.cuentaId,
        mesaDestinoId: destino.mesaId,
      }),
    );
    expect(await numeros(e, [a.cuentaId])).toEqual({
      ok: true,
      valor: [{ cuentaId: a.cuentaId, numero: destino.numero }],
    });
  });

  it("una cuenta del mostrador (sin mesa) no aparece", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const venta = valorDe(
      await m.casos.venderYCobrar(e.gerente, {
        claveIdempotencia: nuevaClave(),
        cuentaId: nuevoId(),
        ejemplarId: nuevoId(),
        sucursalId: e.sucursal,
        lineas: [{ lineaId: nuevoId(), productoId: e.producto, opcionIds: [], cantidad: "1" }],
        totalEsperado: monto("1000.00"),
        cobro: {
          cajaId: caja.cajaId,
          cobros: [
            {
              medioDePagoId: caja.medios["EFECTIVO"] as string,
              cuentaDeCobroId: null,
              importe: monto("1000.00"),
            },
          ],
        },
      }),
    );
    const tickets = valorDe(
      await m.consultas.listarTickets(e.gerente, {
        sucursalId: e.sucursal,
        fechaNegocio: FECHA_DE_NEGOCIO,
      }),
    );
    const cuentaDelTicket = tickets.find((t) => t.ticketId === venta.ticketId)?.cuentaId as string;
    expect(cuentaDelTicket).toBeTruthy();
    expect(await numeros(e, [cuentaDelTicket])).toEqual({ ok: true, valor: [] });
  });

  it("una mesa cobrada y ANULADA: listarTickets trae el ticket ANULADO con su cuenta y la consulta devuelve su mesa", async () => {
    const e = await m.escenario();
    const a = await mesaConPedido(e);
    const cobrada = await cobrar(e, a.cuentaId);
    const anulada = await anularElTicket(d, e.gerente, e.sucursal, {
      claveIdempotencia: nuevaClave(),
      ticketId: cobrada.ticketId,
      ejemplarBaseId: cobrada.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Se cobró de más",
    });
    expect(anulada.ok).toBe(true);
    const tickets = valorDe(
      await m.consultas.listarTickets(e.gerente, {
        sucursalId: e.sucursal,
        fechaNegocio: FECHA_DE_NEGOCIO,
      }),
    );
    expect(tickets.find((t) => t.ticketId === cobrada.ticketId)).toMatchObject({
      estado: "ANULADO",
      cuentaId: a.cuentaId,
    });
    expect(await numeros(e, [a.cuentaId])).toEqual({
      ok: true,
      valor: [{ cuentaId: a.cuentaId, numero: a.numero }],
    });
  });

  it("AISLAMIENTO: otra empresa no ve el número de mesa de la cuenta ajena; otra sucursal de la misma empresa tampoco (la cuenta es de la primera)", async () => {
    const e = await m.escenario();
    const otra = await m.escenario();
    const a = await mesaConPedido(e);
    expect(await numeros(otra, [a.cuentaId], otra.sucursal)).toEqual({ ok: true, valor: [] });
    // La misma empresa pidiendo por OTRA sucursal (si la persona la alcanza): la cuenta es de la sucursal original, no aparece.
    const deOtraSucursal = await numeros(e, [a.cuentaId], e.otraSucursal);
    expect(deOtraSucursal.ok ? deOtraSucursal.valor : "rechazada").toSatisfy(
      (v: unknown) => v === "rechazada" || (Array.isArray(v) && v.length === 0),
    );
  });

  it("PERMISOS Y ENTRADA: sin persona o con una sucursal inválida es el rechazo; más cuentas que el tope o un id mal formado, también", async () => {
    const e = await m.escenario();
    const a = await mesaConPedido(e);
    const sinPersona = await m.consultasDeSalon.numerosDeMesaDeCuentas(
      { ...e.gerente, personaId: null },
      { sucursalId: e.sucursal, cuentaIds: [a.cuentaId] },
    );
    expect(sinPersona.ok).toBe(false);
    expect((await numeros(e, [a.cuentaId], "no-es-un-id")).ok).toBe(false);
    expect((await numeros(e, ["no-es-un-id"])).ok).toBe(false);
    const demasiadas = Array.from({ length: TOPE_DE_CUENTAS_POR_CONSULTA + 1 }, () => nuevoId());
    expect((await numeros(e, demasiadas)).ok).toBe(false);
    expect((await numeros(e, [])).ok).toBe(true);
  });
});
