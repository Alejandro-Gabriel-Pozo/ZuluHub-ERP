import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PantallaDeCobro } from "./PantallaDeCobro.cliente";
import type { CobroPreparado, TicketAnulado, VentaCobrada } from "./modelo-de-cobro";
import type {
  ClienteElegidoAlVender,
  ClienteParaElegirAlVender,
  VentaACuenta,
} from "./modelo-de-vender-a-cuenta";
import { textosDeCobrar } from "./textos-de-cobrar";
import { textosDeVenderACuenta } from "./textos-de-vender-a-cuenta";

/**
 * «Vender a cuenta corriente» desde el cobro (CC-5 B1b): la hoja se ofrece solo si la página la declara (la persona puede cargar a cuenta y hay clientes); elegir un cliente pide al SERVIDOR su saldo y lo que pasaría con
 * esta venta (la pantalla no suma dinero); con el límite pasado «Confirmar» queda apagado para todos y quien no puede aprobar lo ve dicho (decisión del dueño, DEC-CCL-008); un doble toque o un corte de red son UNA venta
 * (el mismo pedido, la misma cuenta y el mismo ejemplar); el resultado es el ticket sin «Cobrado» y el pedido nunca lleva caja, cobros ni aprobación del exceso.
 */
const LISTO: CobroPreparado = {
  estado: "LISTO",
  cajaId: "caja-1",
  opciones: { medios: [], marcasDeTarjeta: [] },
};
const TOTAL = { moneda: "ARS", monto: "60000.00" };
const importe = (monto: string) => ({ moneda: "ARS", monto });

const CLIENTES: readonly ClienteParaElegirAlVender[] = [
  {
    parteId: "c-agencia",
    nombre: "Agencia Cóndor",
    cuit: "30-71234567-4",
    plazoDias: 30,
    estado: "HABILITADA",
  },
  {
    parteId: "c-constructora",
    nombre: "Constructora Patagonia",
    cuit: "30-70987654-3",
    plazoDias: 60,
    estado: "HABILITADA",
  },
  {
    parteId: "c-hotelera",
    nombre: "Hotelera del Sur",
    cuit: null,
    plazoDias: 30,
    estado: "SUSPENDIDA",
  },
];
const DENTRO: ClienteElegidoAlVender = {
  nombre: "Agencia Cóndor",
  cuit: "30-71234567-4",
  estado: "HABILITADA",
  saldo: importe("120000.00"),
  disponible: importe("680000.00"),
  excedido: false,
  puedeAprobarElExceso: false,
  saldoDespues: importe("180000.00"),
  excedeEn: importe("0.00"),
};
const EXCEDE: ClienteElegidoAlVender = {
  ...DENTRO,
  nombre: "Constructora Patagonia",
  saldo: importe("70000.00"),
  disponible: importe("30000.00"),
  saldoDespues: importe("130000.00"),
  excedeEn: importe("30000.00"),
};
const VENDIDA: VentaACuenta = {
  ticketId: "ticket-1",
  ejemplarId: "ejemplar-1",
  numero: 9,
  estado: "EMITIDO",
  fechaNegocio: "2026-11-26",
  total: TOTAL,
  yaExistia: false,
};

let contador = 0;
const nuevoId = () => `id-${String(++contador)}`;
type Ver = (pedido: unknown) => Promise<Respuesta<ClienteElegidoAlVender>>;
type Confirmar = (pedido: unknown) => Promise<Respuesta<VentaACuenta>>;

async function cobro(
  o: Readonly<{
    ver?: Ver;
    confirmar?: Confirmar;
    clientes?: readonly ClienteParaElegirAlVender[] | null;
    mesa?: boolean;
  }> = {},
) {
  const ver = vi.fn<Ver>(o.ver ?? (() => Promise.resolve({ ok: true, dato: DENTRO })));
  const confirmar = vi.fn<Confirmar>(
    o.confirmar ?? (() => Promise.resolve({ ok: true, dato: VENDIDA })),
  );
  const cobrar = vi.fn<(pedido: unknown) => Promise<Respuesta<VentaCobrada>>>();
  const anular = vi.fn<(pedido: unknown) => Promise<Respuesta<TicketAnulado>>>();
  const alNuevaVenta = vi.fn();
  await render(
    <PantallaDeCobro
      cuenta={
        o.mesa === true
          ? []
          : [
              {
                clave: "l-1",
                productoId: "p-1",
                varianteId: null,
                opcionIds: [],
                cantidad: 10000,
                revision: 0,
              },
            ]
      }
      total={TOTAL}
      preparado={LISTO}
      textos={textosDeCobrar()}
      cobrar={cobrar}
      anular={anular}
      imprimir={vi.fn()}
      alVolver={vi.fn()}
      alNuevaVenta={alNuevaVenta}
      nuevoId={nuevoId}
      esperaEntreVerificacionesMs={10}
      {...(o.mesa === true ? { cuentaExistente: { cuentaId: "cuenta-de-la-mesa" } } : {})}
      aCuenta={
        o.clientes === null
          ? undefined
          : {
              clientes: o.clientes ?? CLIENTES,
              verCliente: ver,
              confirmar,
              textos: textosDeVenderACuenta(),
            }
      }
    />,
  );
  return { ver, confirmar, cobrar, anular, alNuevaVenta };
}

const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });
const selector = () => page.getByRole("combobox", { name: "Cliente" });
const pedidoDe = (llamadas: { mock: { calls: unknown[][] } }, n: number) =>
  llamadas.mock.calls[n]?.[0] as Record<string, unknown>;
async function abrirYElegir(parteId: string) {
  await userEvent.click(boton("Vender a cuenta corriente"));
  await userEvent.selectOptions(selector(), parteId);
}

afterEach(() => {
  restaurarConexion();
});

describe("PantallaDeCobro: vender a cuenta corriente", () => {
  it("sin la declaración de la página, o sin clientes, el cobro NO ofrece vender a cuenta", async () => {
    await cobro({ clientes: null });
    expect(page.getByRole("button", { name: "Vender a cuenta corriente" }).elements()).toHaveLength(
      0,
    );
  });

  it("sin clientes con cuenta no se ofrece la hoja", async () => {
    await cobro({ clientes: [] });
    expect(page.getByRole("button", { name: "Vender a cuenta corriente" }).elements()).toHaveLength(
      0,
    );
  });

  it("elegir un cliente pide al SERVIDOR su saldo con el total de la venta y muestra saldo actual, crédito, esta venta y saldo después; sin violaciones de accesibilidad", async () => {
    const { ver } = await cobro();
    await abrirYElegir("c-agencia");
    await expect.element(page.getByText("Saldo actual")).toBeVisible();
    await expect.element(page.getByText("$ 120.000,00")).toBeVisible();
    await expect.element(page.getByText("Crédito disponible")).toBeVisible();
    await expect.element(page.getByText("$ 680.000,00")).toBeVisible();
    await expect.element(page.getByText("Esta venta")).toBeVisible();
    await expect.element(page.getByText("Saldo después")).toBeVisible();
    await expect.element(page.getByText("$ 180.000,00")).toBeVisible();
    expect(ver).toHaveBeenCalledTimes(1);
    expect(pedidoDe(ver, 0)).toEqual({ clienteId: "c-agencia", totalDeLaVenta: "60000.00" });
    await expect.element(boton("Confirmar venta a cuenta")).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("la mesa consulta por su cuenta de consumo abierta", async () => {
    const { ver } = await cobro({ mesa: true });
    await abrirYElegir("c-agencia");
    await expect.element(page.getByText("Saldo después")).toBeVisible();
    expect(pedidoDe(ver, 0)).toEqual({
      clienteId: "c-agencia",
      totalDeLaVenta: "60000.00",
      cuentaDeConsumoId: "cuenta-de-la-mesa",
    });
  });

  it("confirmar manda cuenta, ejemplar, cliente, líneas y el total que se vio: SIN caja, cobros, aprobación ni sucursal", async () => {
    const { confirmar } = await cobro();
    await abrirYElegir("c-agencia");
    await userEvent.click(boton("Confirmar venta a cuenta"));
    await vi.waitFor(() => {
      expect(confirmar).toHaveBeenCalledTimes(1);
    });
    const pedido = pedidoDe(confirmar, 0);
    expect(Object.keys(pedido).sort()).toEqual(
      [
        "claveIdempotencia",
        "clienteId",
        "cuentaId",
        "ejemplarId",
        "lineas",
        "totalEsperado",
      ].sort(),
    );
    expect(pedido).toMatchObject({ clienteId: "c-agencia", totalEsperado: TOTAL });
  });

  it("la mesa confirma sin líneas y con el id de su cuenta", async () => {
    const { confirmar } = await cobro({ mesa: true });
    await abrirYElegir("c-agencia");
    await userEvent.click(boton("Confirmar venta a cuenta"));
    await vi.waitFor(() => {
      expect(confirmar).toHaveBeenCalledTimes(1);
    });
    const pedido = pedidoDe(confirmar, 0);
    expect(pedido).toMatchObject({ cuentaId: "cuenta-de-la-mesa", clienteId: "c-agencia" });
    expect(Object.keys(pedido)).not.toContain("lineas");
  });

  it("IDEMPOTENCIA: un doble toque en «Confirmar» es UNA venta", async () => {
    const { confirmar } = await cobro();
    await abrirYElegir("c-agencia");
    const confirmarVenta = boton("Confirmar venta a cuenta");
    tocar(confirmarVenta);
    tocar(confirmarVenta);
    await expect.element(page.getByText("Ticket N.º 9")).toBeVisible();
    expect(confirmar).toHaveBeenCalledTimes(1);
  });

  it("IDEMPOTENCIA: tras un corte de red se repite con la MISMA clave, cuenta y ejemplar", async () => {
    let intento = 0;
    const { confirmar } = await cobro({
      confirmar: () => {
        intento += 1;
        return intento === 1
          ? Promise.reject(new Error("sin red"))
          : Promise.resolve({ ok: true, dato: VENDIDA });
      },
    });
    await abrirYElegir("c-agencia");
    await userEvent.click(boton("Confirmar venta a cuenta"));
    await expect.element(page.getByText("Ticket N.º 9")).toBeVisible();
    const lleva = (campo: string) =>
      new Set(confirmar.mock.calls.map((c) => (c[0] as Record<string, unknown>)[campo]));
    expect(confirmar.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(lleva("claveIdempotencia").size).toBe(1);
    expect(lleva("cuentaId").size).toBe(1);
    expect(lleva("ejemplarId").size).toBe(1);
  });

  it("tras vender: el número del ticket SIN «Cobrado», con «Imprimir ticket», «Anular» y «Nueva venta»", async () => {
    const { alNuevaVenta } = await cobro();
    await abrirYElegir("c-agencia");
    await userEvent.click(boton("Confirmar venta a cuenta"));
    await expect.element(page.getByText("Ticket N.º 9")).toBeVisible();
    expect(page.getByText("Cobrado", { exact: true }).elements()).toHaveLength(0);
    await expect.element(boton("Imprimir ticket")).toBeVisible();
    await expect.element(boton("Anular")).toBeVisible();
    await userEvent.click(boton("Nueva venta"));
    expect(alNuevaVenta).toHaveBeenCalledTimes(1);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("con el límite pasado «Confirmar» queda apagado y quien NO puede aprobar ve que no puede; no se manda nada", async () => {
    const { confirmar } = await cobro({
      ver: () => Promise.resolve({ ok: true, dato: { ...EXCEDE, puedeAprobarElExceso: false } }),
    });
    await abrirYElegir("c-constructora");
    await expect
      .element(page.getByText(/Esta venta supera el límite de crédito del cliente\./))
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          /No tenés permiso para aprobar este exceso\. Pedile a un gerente o administrador que lo apruebe\./,
        ),
      )
      .toBeVisible();
    await expect.element(page.getByText("$ 130.000,00")).toBeVisible();
    await expect.element(boton("Confirmar venta a cuenta")).toBeDisabled();
    tocar(boton("Confirmar venta a cuenta"));
    expect(confirmar).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("quien SÍ puede aprobar ve el aviso del límite SIN el texto de permiso, y también queda bloqueado (sin hoja de aprobar)", async () => {
    const { confirmar } = await cobro({
      ver: () => Promise.resolve({ ok: true, dato: { ...EXCEDE, puedeAprobarElExceso: true } }),
    });
    await abrirYElegir("c-constructora");
    await expect
      .element(page.getByText(/Esta venta supera el límite de crédito del cliente\./))
      .toBeVisible();
    expect(page.getByText(/No tenés permiso para aprobar este exceso/).elements()).toHaveLength(0);
    expect(page.getByText(/Pedir aprobación/).elements()).toHaveLength(0);
    await expect.element(boton("Confirmar venta a cuenta")).toBeDisabled();
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("«Elegir otro cliente» limpia la elección y se puede vender a otro dentro del límite", async () => {
    const { confirmar } = await cobro({
      ver: (pedido) =>
        Promise.resolve({
          ok: true,
          dato: (pedido as { clienteId: string }).clienteId === "c-constructora" ? EXCEDE : DENTRO,
        }),
    });
    await abrirYElegir("c-constructora");
    await userEvent.click(boton("Elegir otro cliente"));
    await expect.element(selector()).toHaveValue("");
    expect(page.getByText(/supera el límite/).elements()).toHaveLength(0);
    await userEvent.selectOptions(selector(), "c-agencia");
    await expect.element(boton("Confirmar venta a cuenta")).toBeEnabled();
    await userEvent.click(boton("Confirmar venta a cuenta"));
    await vi.waitFor(() => {
      expect(confirmar).toHaveBeenCalledTimes(1);
    });
    expect(pedidoDe(confirmar, 0)["clienteId"]).toBe("c-agencia");
  });

  it("un cliente con la cuenta suspendida no se puede confirmar", async () => {
    const { confirmar } = await cobro({
      ver: () => Promise.resolve({ ok: true, dato: { ...DENTRO, estado: "SUSPENDIDA" } }),
    });
    await abrirYElegir("c-hotelera");
    await expect.element(page.getByText("Estado: Suspendida")).toBeVisible();
    await expect.element(boton("Confirmar venta a cuenta")).toBeDisabled();
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("sin cliente elegido «Confirmar» está apagado", async () => {
    await cobro();
    await userEvent.click(boton("Vender a cuenta corriente"));
    await expect.element(boton("Confirmar venta a cuenta")).toBeDisabled();
  });

  it("una respuesta vieja no pisa la del último cliente elegido", async () => {
    let soltarElPrimero: (r: Respuesta<ClienteElegidoAlVender>) => void = () => undefined;
    const { ver } = await cobro({
      ver: (pedido) =>
        (pedido as { clienteId: string }).clienteId === "c-agencia"
          ? new Promise((resolver) => {
              soltarElPrimero = resolver;
            })
          : Promise.resolve({ ok: true, dato: EXCEDE }),
    });
    await abrirYElegir("c-agencia");
    await userEvent.selectOptions(selector(), "c-constructora");
    await expect.element(page.getByText(/supera el límite/)).toBeVisible();
    soltarElPrimero({ ok: true, dato: DENTRO });
    await vi.waitFor(() => {
      expect(ver).toHaveBeenCalledTimes(2);
    });
    await expect.element(page.getByText(/supera el límite/)).toBeVisible();
    await expect.element(boton("Confirmar venta a cuenta")).toBeDisabled();
  });

  it("un error al consultar el cliente sale como error y no deja confirmar", async () => {
    await cobro({
      ver: () => Promise.resolve({ ok: false, error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA") }),
    });
    await abrirYElegir("c-agencia");
    await expect.element(page.getByRole("alert")).toBeVisible();
    await expect.element(boton("Confirmar venta a cuenta")).toBeDisabled();
  });

  it("un rechazo del servidor al confirmar sale como el genérico y no hay resultado", async () => {
    const { confirmar } = await cobro({
      confirmar: () =>
        Promise.resolve({ ok: false, error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA") }),
    });
    await abrirYElegir("c-agencia");
    await userEvent.click(boton("Confirmar venta a cuenta"));
    await expect.element(page.getByRole("alert")).toBeVisible();
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(page.getByText("Ticket N.º 9").elements()).toHaveLength(0);
  });

  it("«Volver al cobro» deja la hoja y no manda nada", async () => {
    const { confirmar } = await cobro();
    await userEvent.click(boton("Vender a cuenta corriente"));
    await userEvent.click(boton("Volver al cobro"));
    await expect.element(boton("Cobrar")).toBeVisible();
    expect(confirmar).not.toHaveBeenCalled();
  });
});
