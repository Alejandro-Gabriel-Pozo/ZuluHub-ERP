import { describe, expect, it } from "vitest";
import { errorDeCodigo } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  cobrarUnTicketACuenta,
  ticketACobrarDelCliente,
  type DependenciasDeCobrarACuentaWeb,
} from "./cobrar-a-cuenta-web";
import { entradaDeCobrarACuenta, entradaDelTicketACobrar } from "./entradas-de-cobrar-a-cuenta";

/**
 * «Cobrar un ticket a cuenta» por la composición web, sin base: lo que se pide y lo que se manda al caso de uso (el importe lo pone el servidor), la coherencia entre el libro y el ticket, los errores sin
 * detalle y que el saldo de después nunca esconda un cobro hecho. Con la base real: `test/integracion/cobrar-a-cuenta-web.test.ts`.
 */

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIENTE = U(1);
const TICKET = U(2);
const EJEMPLAR = U(3);
const CAJA = U(4);
const MEDIO = U(5);
const SUCURSAL = U(6);
const CONTEXTO = {} as ContextoOperativo;
const GENERICO = { ok: false, error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA") };

const CARGO = {
  asientoId: U(9),
  ticketId: TICKET,
  venceEl: "2026-12-09",
  vencida: false,
  pendiente: { moneda: "ARS", monto: "1000.00" },
  cliente: { id: CLIENTE, nombre: "Agencia" },
};
const TICKET_LEIDO = {
  ticketId: TICKET,
  numero: 4821,
  canal: "SALON" as const,
  sucursalId: SUCURSAL,
  fechaNegocio: "2026-10-12",
  estado: "EMITIDO" as const,
  ejemplarId: EJEMPLAR,
  total: { moneda: "ARS", monto: "1000.00" },
  cliente: { id: CLIENTE, nombre: "Agencia" },
};
const CAJAS = {
  cajas: [
    {
      cajaId: CAJA,
      nombre: "Caja 1",
      estado: "ABIERTA",
      sesionId: U(7),
      fechaDeNegocio: "2026-11-09",
      jornadaVencida: false,
      otraCosa: "no sale",
    },
  ],
  jornadaActual: { fechaDeNegocio: "2026-11-09", estado: "ABIERTA" },
};
const COBRADO = {
  ticketId: TICKET,
  ejemplarId: EJEMPLAR,
  cobranzaId: U(8),
  total: { moneda: "ARS", monto: "1000.00" },
  cobros: [],
  sesionDeCajaId: U(7),
  fechaDeCobro: "2026-11-09",
  jornadaVencida: false,
  yaExistia: false,
};

type Cambios = Partial<{
  cargo: unknown;
  ticket: unknown;
  cajas: unknown;
  cobrar: unknown;
  saldo: unknown;
}>;
const llamadas: { cobrar: unknown[]; saldo: number } = { cobrar: [], saldo: 0 };
const dependencias = (c: Cambios = {}): DependenciasDeCobrarACuentaWeb => ({
  cobro: () =>
    ({
      cargoACobrarDelCliente: () => Promise.resolve(c.cargo ?? ok(CARGO)),
      ticketACobrar: () => Promise.resolve(c.ticket ?? ok(TICKET_LEIDO)),
      saldoDelClienteACuenta: () => {
        llamadas.saldo += 1;
        return Promise.resolve(c.saldo ?? ok({ moneda: "ARS", monto: "250.00" }));
      },
    }) as never,
  casosDeUso: () =>
    ({
      cobrar: (_contexto: unknown, entrada: unknown) => {
        llamadas.cobrar.push(entrada);
        return Promise.resolve(c.cobrar ?? ok(COBRADO));
      },
    }) as never,
  consultas: () =>
    ({
      estadoDeCajasParaCobrar: () => Promise.resolve(c.cajas ?? ok(CAJAS)),
    }) as never,
  respuesta: { registrar: () => undefined, azar: () => new Uint8Array(4) },
});

const PEDIDO = {
  claveIdempotencia: "clave-de-prueba-1234567890",
  ticketId: TICKET,
  ejemplarId: EJEMPLAR,
  cajaId: CAJA,
  medioDePagoId: MEDIO,
  cuentaDeCobroId: null,
};

describe("la hoja de «Cobrar un ticket a cuenta»", () => {
  it("arma la hoja con el ticket, el total, el vencimiento y las cajas de la sucursal del ticket (lista blanca)", async () => {
    const r = await ticketACobrarDelCliente(dependencias(), CONTEXTO, { clienteId: CLIENTE });
    expect(r).toEqual({
      ok: true,
      dato: {
        cliente: { id: CLIENTE, nombre: "Agencia" },
        ticket: {
          ticketId: TICKET,
          numero: 4821,
          canal: "SALON",
          sucursalId: SUCURSAL,
          fechaNegocio: "2026-10-12",
          ejemplarId: EJEMPLAR,
          total: { moneda: "ARS", monto: "1000.00" },
          venceEl: "2026-12-09",
          vencida: false,
        },
        cajas: [
          {
            cajaId: CAJA,
            nombre: "Caja 1",
            estado: "ABIERTA",
            sesionId: U(7),
            fechaDeNegocio: "2026-11-09",
            jornadaVencida: false,
          },
        ],
        jornadaActual: { fechaDeNegocio: "2026-11-09", estado: "ABIERTA" },
      },
    });
  });

  it("sin cargo pendiente la hoja es vacía; un cliente sin nombre usa el del ticket", async () => {
    expect(
      await ticketACobrarDelCliente(dependencias({ cargo: ok(null) }), CONTEXTO, {
        clienteId: CLIENTE,
      }),
    ).toEqual({ ok: true, dato: null });
    const sinNombre = dependencias({
      cargo: ok({ ...CARGO, cliente: { id: CLIENTE, nombre: null } }),
    });
    const r = await ticketACobrarDelCliente(sinNombre, CONTEXTO, { clienteId: CLIENTE });
    expect(r.ok && r.dato?.cliente.nombre).toBe("Agencia");
  });

  it.each([
    ["el ticket ya está cobrado", { ticket: ok({ ...TICKET_LEIDO, estado: "COBRADO" }) }],
    [
      "el ticket es de otro cliente",
      { ticket: ok({ ...TICKET_LEIDO, cliente: { id: U(99), nombre: "Otro" } }) },
    ],
    [
      "el total del ticket no es lo pendiente del libro",
      { ticket: ok({ ...TICKET_LEIDO, total: { moneda: "ARS", monto: "999.00" } }) },
    ],
  ])("si %s, el libro y el ticket no cuentan lo mismo: genérico", async (_motivo, cambios) => {
    expect(
      await ticketACobrarDelCliente(dependencias(cambios), CONTEXTO, { clienteId: CLIENTE }),
    ).toMatchObject(GENERICO);
  });

  it("un pedido mal formado o con claves de más es el genérico y no lee nada", async () => {
    for (const crudo of [
      null,
      {},
      { clienteId: "x" },
      { clienteId: CLIENTE, sucursalId: SUCURSAL },
    ]) {
      expect(await ticketACobrarDelCliente(dependencias(), CONTEXTO, crudo)).toMatchObject(
        GENERICO,
      );
    }
  });

  it("un error de las lecturas sale sin detalle: el guard con su código, lo demás genérico", async () => {
    expect(
      await ticketACobrarDelCliente(dependencias({ cargo: err("SIN_PERMISO") }), CONTEXTO, {
        clienteId: CLIENTE,
      }),
    ).toEqual({ ok: false, error: errorDeCodigo("SIN_PERMISO") });
    for (const cambios of [
      { ticket: err("TICKET_NO_COBRABLE") },
      { cajas: err("SUCURSAL_FUERA_DEL_ALCANCE") },
      { cargo: err("CUENTA_DEMASIADO_GRANDE") },
    ]) {
      expect(
        await ticketACobrarDelCliente(dependencias(cambios), CONTEXTO, { clienteId: CLIENTE }),
      ).toMatchObject(GENERICO);
    }
  });
});

describe("cobrar el ticket a cuenta", () => {
  it("manda UN cobro por el total del ticket (el importe lo pone el servidor), con el medio y la caja elegidos, y devuelve lo hecho con el saldo de después", async () => {
    llamadas.cobrar = [];
    const r = await cobrarUnTicketACuenta(dependencias(), CONTEXTO, PEDIDO);
    expect(llamadas.cobrar).toEqual([
      {
        claveIdempotencia: PEDIDO.claveIdempotencia,
        ticketId: TICKET,
        ejemplarId: EJEMPLAR,
        cajaId: CAJA,
        cobros: [
          {
            medioDePagoId: MEDIO,
            cuentaDeCobroId: null,
            importe: { moneda: "ARS", monto: "1000.00" },
          },
        ],
      },
    ]);
    expect(r).toEqual({
      ok: true,
      dato: {
        ticketId: TICKET,
        numero: 4821,
        cobranzaId: U(8),
        cliente: { id: CLIENTE, nombre: "Agencia" },
        total: { moneda: "ARS", monto: "1000.00" },
        fechaDeCobro: "2026-11-09",
        jornadaVencida: false,
        saldoDelCliente: { moneda: "ARS", monto: "250.00" },
        yaExistia: false,
      },
    });
  });

  it("los datos del medio viajan sin las claves ausentes", async () => {
    llamadas.cobrar = [];
    await cobrarUnTicketACuenta(dependencias(), CONTEXTO, {
      ...PEDIDO,
      datos: { ultimos4: "1234", cupon: undefined },
    });
    expect((llamadas.cobrar[0] as { cobros: { datos?: unknown }[] }).cobros[0]?.datos).toEqual({
      ultimos4: "1234",
    });
  });

  it("repetir devuelve lo hecho (yaExistia) sin cobrar de nuevo por esta composición", async () => {
    const r = await cobrarUnTicketACuenta(
      dependencias({ cobrar: ok({ ...COBRADO, yaExistia: true }) }),
      CONTEXTO,
      PEDIDO,
    );
    expect(r.ok && r.dato.yaExistia).toBe(true);
  });

  it("sin permiso para ver la cuenta, el cobro hecho sale igual con el saldo vacío", async () => {
    const r = await cobrarUnTicketACuenta(
      dependencias({ saldo: err("SIN_PERMISO") }),
      CONTEXTO,
      PEDIDO,
    );
    expect(r.ok && r.dato.saldoDelCliente).toBeNull();
    expect(r.ok && r.dato.cobranzaId).toBe(U(8));
  });

  it("si el ticket no se puede cobrar a cuenta, no se llama a cobrar", async () => {
    llamadas.cobrar = [];
    const r = await cobrarUnTicketACuenta(
      dependencias({ ticket: err("TICKET_NO_COBRABLE") }),
      CONTEXTO,
      PEDIDO,
    );
    expect(r).toMatchObject(GENERICO);
    expect(llamadas.cobrar).toEqual([]);
  });

  it("los errores de cobrar salen sin detalle: genérico, y el guard con su código", async () => {
    for (const error of [
      "CLAVE_REUTILIZADA",
      { error: "TICKET_YA_COBRADO", cobranzaId: U(8) },
      "COBRO_NO_CUADRA",
      "EJEMPLAR_DESACTUALIZADO",
    ]) {
      const r = await cobrarUnTicketACuenta(dependencias({ cobrar: err(error) }), CONTEXTO, PEDIDO);
      expect(r).toMatchObject(GENERICO);
      expect(JSON.stringify(r)).not.toContain(U(8));
    }
    expect(
      await cobrarUnTicketACuenta(dependencias({ cobrar: err("SIN_PERMISO") }), CONTEXTO, PEDIDO),
    ).toEqual({ ok: false, error: errorDeCodigo("SIN_PERMISO") });
  });

  it("una excepción sale con referencia y sin detalle", async () => {
    const d: DependenciasDeCobrarACuentaWeb = {
      ...dependencias(),
      casosDeUso: () => ({ cobrar: () => Promise.reject(new Error("la base no responde")) }),
    };
    const r = await cobrarUnTicketACuenta(d, CONTEXTO, PEDIDO);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("la base no responde");
    expect(!r.ok && r.error.referencia).toMatch(/^PD-/);
  });

  it("un pedido con importe, sucursal, cliente o cobros de más, o sin un dato, es el genérico y no cobra", async () => {
    llamadas.cobrar = [];
    for (const crudo of [
      { ...PEDIDO, importe: { moneda: "ARS", monto: "1.00" } },
      { ...PEDIDO, cobros: [] },
      { ...PEDIDO, sucursalId: SUCURSAL },
      { ...PEDIDO, clienteId: CLIENTE },
      { ...PEDIDO, ticketId: "no-es-un-id" },
      { ...PEDIDO, claveIdempotencia: undefined },
      null,
    ]) {
      expect(await cobrarUnTicketACuenta(dependencias(), CONTEXTO, crudo)).toMatchObject(GENERICO);
    }
    expect(llamadas.cobrar).toEqual([]);
  });
});

describe("la frontera de «Cobrar un ticket a cuenta»", () => {
  it("la lectura acepta el cliente y, opcional, un ticket; nada más", () => {
    expect(entradaDelTicketACobrar({ clienteId: CLIENTE }).ok).toBe(true);
    expect(entradaDelTicketACobrar({ clienteId: CLIENTE, ticketId: TICKET }).ok).toBe(true);
    expect(entradaDelTicketACobrar({ clienteId: CLIENTE, otra: 1 }).ok).toBe(false);
  });

  it("el cobro acepta los datos del medio y la cuenta de cobro, y rechaza un dato desconocido", () => {
    expect(entradaDeCobrarACuenta({ ...PEDIDO, cuentaDeCobroId: U(10) }).ok).toBe(true);
    expect(entradaDeCobrarACuenta({ ...PEDIDO, datos: { cuotas: 3, dni: "30111222" } }).ok).toBe(
      true,
    );
    expect(entradaDeCobrarACuenta({ ...PEDIDO, datos: { numeroDeTarjeta: "4111" } }).ok).toBe(
      false,
    );
  });
});
