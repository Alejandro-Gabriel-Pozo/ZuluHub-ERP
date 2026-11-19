import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { PapelDeTicket } from "../cobrar/PapelDelTicket.cliente";
import type { TicketAnulado } from "../cobrar/modelo-de-cobro";
import { textosDeCobrar } from "../cobrar/textos-de-cobrar";
import { FichaDelTicket } from "./FichaDelTicket.cliente";
import { ListaDeTickets } from "./ListaDeTickets";
import type {
  FichaDelTicketParaLaPantalla,
  TicketsDelDiaParaLaPantalla,
} from "./modelo-de-tickets-del-dia";
import { textosDeTicketsDelDia } from "./textos-de-tickets-del-dia";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});
afterEach(() => {
  restaurarConexion();
  vi.restoreAllMocks();
});

const monto = (m: string) => ({ moneda: "ARS", monto: m });
const UUID = "0b0b0b0b-1111-4222-8333-444444444444";

const fila = (n: number, cambios: Record<string, unknown> = {}) => ({
  ticketId: `${UUID.slice(0, -2)}${String(10 + n)}`,
  numero: n,
  numeroDeCorreccion: 0,
  estado: "COBRADO",
  totalOriginal: monto("20500.00"),
  totalVigente: monto("20500.00"),
  emitidoEn: "2026-11-18T00:14:00.000Z",
  facturado: false,
  ...cambios,
});

describe("ListaDeTickets", () => {
  it("la jornada, una fila-enlace por ticket con su nombre accesible, el anulado tachado; sin violaciones de accesibilidad", async () => {
    const lista: TicketsDelDiaParaLaPantalla = {
      fechaNegocio: "2026-11-17",
      tickets: [
        fila(3, { estado: "ANULADO", totalVigente: monto("0.00") }),
        fila(2, { facturado: true }),
        fila(1, { estado: "CORTESIA", totalOriginal: monto("0.00"), totalVigente: monto("0.00") }),
      ],
    };
    await render(<ListaDeTickets lista={lista} textos={textosDeTicketsDelDia()} />);
    await expect.element(page.getByText("Jornada 17/11/2026")).toBeVisible();
    const enlaces = page.getByRole("link").elements();
    expect(enlaces.map((e) => e.getAttribute("aria-label"))).toEqual([
      "Ticket N.º 3, Anulado, 21:14, $ 20.500,00",
      "Ticket N.º 2, Cobrado y facturado, 21:14, $ 20.500,00",
      "Ticket N.º 1, Cortesía, 21:14, $ 0,00",
    ]);
    expect(enlaces[0]?.getAttribute("href")).toBe(`/ventas/tickets-del-dia/${fila(3).ticketId}`);
    expect(document.querySelectorAll("s")).toHaveLength(1);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("vacía: el texto y nada más; con 48 tickets salen 48 filas", async () => {
    const { unmount } = await render(
      <ListaDeTickets
        lista={{ fechaNegocio: "2026-11-17", tickets: [] }}
        textos={textosDeTicketsDelDia()}
      />,
    );
    await expect.element(page.getByText("Todavía no hay tickets")).toBeVisible();
    expect(page.getByRole("link").elements()).toHaveLength(0);
    await unmount();
    await render(
      <ListaDeTickets
        lista={{
          fechaNegocio: "2026-11-17",
          tickets: Array.from({ length: 48 }, (_, i) => fila(48 - i)),
        }}
        textos={textosDeTicketsDelDia()}
      />,
    );
    expect(page.getByRole("link").elements()).toHaveLength(48);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});

const renglon = {
  lineaCuentaId: "l-1",
  descripcion: "Milanesa",
  varianteNombre: "Grande",
  opciones: [{ grupo: "Extras", nombre: "Huevo", recargo: "300.000000" }],
  cantidad: "2.0000",
  unidadDeVenta: "UNIDAD",
  importe: "3000.00",
};
const FICHA: FichaDelTicketParaLaPantalla = {
  ticketId: UUID,
  numero: 14,
  numeroDeCorreccion: 0,
  estado: "COBRADO",
  fechaNegocio: "2026-11-17",
  ejemplarVigenteId: "ejemplar-1",
  totalOriginal: monto("3000.00"),
  totalVigente: monto("3000.00"),
  emitidoPor: "gerente@ejemplo.com",
  emitidoEn: "2026-11-18T00:14:00.000Z",
  facturado: false,
  renglones: [renglon],
  caja: { id: "c-1", nombre: "Caja 1" },
  cobros: [
    { orden: 1, medioTipo: "EFECTIVO", cuentaDeCobro: null, importe: monto("1000.00") },
    {
      orden: 2,
      medioTipo: "TARJETA_DEBITO",
      cuentaDeCobro: { id: "q-1", nombre: "Terminal del frente" },
      importe: monto("2000.00"),
    },
  ],
  anulacion: null,
  imprimible: true,
};
const PAPEL: PapelDeTicket = {
  ancho: 80,
  lineas: [{ texto: "Ticket N.º 14", estilo: "NEGRITA" }],
};
const GENERICO = { ok: false, error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA") } as const;
const ANULADO_OK: Respuesta<TicketAnulado> = {
  ok: true,
  dato: { ticketId: UUID, numero: 14, estado: "ANULADO" },
};

let contador = 0;
const nuevoId = () => `anu-${String(++contador)}`;
const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });

type Anular = (pedido: unknown) => Promise<Respuesta<TicketAnulado>>;
type Imprimir = (pedido: unknown) => Promise<Respuesta<PapelDeTicket>>;

function ficha(
  f: FichaDelTicketParaLaPantalla,
  opciones: Readonly<{ anular?: Anular; imprimir?: Imprimir }> = {},
) {
  const anular = vi.fn<Anular>(opciones.anular ?? (() => Promise.resolve(ANULADO_OK)));
  const imprimir = vi.fn<Imprimir>(
    opciones.imprimir ?? (() => Promise.resolve({ ok: true, dato: PAPEL })),
  );
  const elemento = (fi: FichaDelTicketParaLaPantalla) => (
    <FichaDelTicket
      ficha={fi}
      textos={textosDeTicketsDelDia()}
      textosDeCobrar={textosDeCobrar()}
      anular={anular}
      imprimir={imprimir}
      nuevoId={nuevoId}
      esperaEntreVerificacionesMs={10}
    />
  );
  return { anular, imprimir, elemento };
}

describe("FichaDelTicket", () => {
  it("cobrado: franja, jornada, cuándo y quién, renglones con detalle, total, cobros con su medio y cuenta, la caja y los dos botones", async () => {
    const { elemento } = ficha(FICHA);
    await render(elemento(FICHA));
    await expect
      .element(page.getByRole("heading", { name: "Ticket N.º 14", level: 2 }))
      .toBeVisible();
    for (const t of [
      "Cobrado",
      "Jornada 17/11/2026",
      "17/11/2026 21:14",
      "gerente@ejemplo.com",
      "2 Milanesa",
      "$ 3.000,00",
      "Grande · Huevo",
      "Cobros",
      "Efectivo",
      "Tarjeta de débito",
      "Terminal del frente",
      "Caja 1",
    ]) {
      await expect.element(page.getByText(t, { exact: true }).first()).toBeVisible();
    }
    await expect.element(boton("Imprimir ticket")).toBeVisible();
    await expect.element(boton("Anular")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("facturado dice «Cobrado y facturado»; cortesía y por cobrar no se cobran: sin «Cobros»", async () => {
    const facturada = { ...FICHA, facturado: true };
    const { unmount } = await render(ficha(facturada).elemento(facturada));
    await expect.element(page.getByText("Cobrado y facturado", { exact: true })).toBeVisible();
    await unmount();
    const cortesia = {
      ...FICHA,
      estado: "CORTESIA",
      imprimible: false,
      cobros: [],
      caja: null,
      totalOriginal: monto("0.00"),
    };
    const otra = await render(ficha(cortesia).elemento(cortesia));
    await expect.element(page.getByText("Cortesía", { exact: true })).toBeVisible();
    expect(page.getByText("Cobros", { exact: true }).elements()).toHaveLength(0);
    expect(boton("Imprimir ticket").elements()).toHaveLength(0);
    await expect.element(boton("Anular")).toBeVisible();
    await otra.unmount();
    const porCobrar = { ...cortesia, estado: "EMITIDO", imprimible: true };
    await render(ficha(porCobrar).elemento(porCobrar));
    await expect.element(page.getByText("Por cobrar", { exact: true })).toBeVisible();
    await expect.element(boton("Imprimir ticket")).toBeVisible();
  });

  it("anulado: motivo, quién y cuándo en la franja, los renglones del original y sin botones; sin correo no se dibuja la línea", async () => {
    const anulada = {
      ...FICHA,
      estado: "ANULADO",
      imprimible: false,
      emitidoPor: null,
      anulacion: {
        motivo: "Venta duplicada",
        hechaPor: "tomas@ejemplo.com",
        hechaEn: "2026-11-18T00:38:00.000Z",
      },
    };
    await render(ficha(anulada).elemento(anulada));
    await expect.element(page.getByText("Anulado", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Venta duplicada")).toBeVisible();
    await expect.element(page.getByText("tomas@ejemplo.com")).toBeVisible();
    await expect.element(page.getByText("17/11/2026 21:38")).toBeVisible();
    await expect.element(page.getByText("2 Milanesa", { exact: true })).toBeVisible();
    expect(page.getByText("gerente@ejemplo.com").elements()).toHaveLength(0);
    expect(boton("Anular").elements()).toHaveLength(0);
    expect(boton("Imprimir ticket").elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Imprimir ticket» pide el papel una sola vez aun con doble toque, muestra «Ticket del cliente» y «Volver» regresa a la ficha", async () => {
    let entregar: (r: Respuesta<PapelDeTicket>) => void = () => undefined;
    const { imprimir, elemento } = ficha(FICHA, {
      imprimir: () =>
        new Promise<Respuesta<PapelDeTicket>>((resolver) => {
          entregar = resolver;
        }),
    });
    await render(elemento(FICHA));
    const b = page.getByRole("button", { name: "Imprimir ticket", exact: true });
    await userEvent.click(b);
    await userEvent.click(b, { force: true }).catch(() => undefined);
    entregar({ ok: true, dato: PAPEL });
    await expect.element(page.getByRole("heading", { name: "Ticket del cliente" })).toBeVisible();
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(imprimir).toHaveBeenCalledWith({ ticketId: UUID });
    await userEvent.click(page.getByRole("button", { name: "Volver", exact: true }));
    await expect
      .element(page.getByRole("heading", { name: "Ticket N.º 14", level: 2 }))
      .toBeVisible();
  });

  it("anular: motivo vacío dice «Escribí el motivo»; con motivo manda el ejemplar vigente y, anulado, cierra la hoja y vuelve a leer la ficha", async () => {
    const { anular, elemento } = ficha(FICHA);
    await render(elemento(FICHA));
    await userEvent.click(boton("Anular"));
    const hoja = page.getByRole("dialog");
    await expect.element(hoja).toBeVisible();
    await userEvent.click(hoja.getByRole("button", { name: "Anular", exact: true }));
    await expect.element(page.getByText("Escribí el motivo")).toBeVisible();
    expect(anular).not.toHaveBeenCalled();
    await userEvent.fill(hoja.getByRole("textbox", { name: "Motivo" }), "Se cargó dos veces");
    await userEvent.click(hoja.getByRole("button", { name: "Anular", exact: true }));
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
    expect(anular).toHaveBeenCalledTimes(1);
    expect(anular).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: UUID,
        ejemplarBaseId: "ejemplar-1",
        motivo: "Se cargó dos veces",
      }),
    );
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
  });

  it("la hoja: «Cancelar» va antes que «Anular»; Escape y «Cancelar» la cierran sin mandar nada", async () => {
    const { anular, elemento } = ficha(FICHA);
    await render(elemento(FICHA));
    await userEvent.click(boton("Anular"));
    const nombres = page
      .getByRole("dialog")
      .getByRole("button")
      .elements()
      .map((b) => b.textContent);
    expect(nombres.indexOf("Cancelar")).toBeLessThan(nombres.indexOf("Anular"));
    await userEvent.click(
      page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }),
    );
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    await userEvent.click(boton("Anular"));
    await userEvent.keyboard("{Escape}");
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    expect(anular).not.toHaveBeenCalled();
  });

  it("rechazo: se vuelve a leer la ficha; si la hoja sigue abierta (ficha sin anular) muestra el rechazo adentro; si la ficha vuelve anulada, la hoja se cierra y arriba queda el genérico", async () => {
    const { elemento } = ficha(FICHA, { anular: () => Promise.resolve(GENERICO) });
    const { rerender } = await render(elemento(FICHA));
    await userEvent.click(boton("Anular"));
    const hoja = page.getByRole("dialog");
    await userEvent.fill(hoja.getByRole("textbox", { name: "Motivo" }), "Venta duplicada");
    await userEvent.click(hoja.getByRole("button", { name: "Anular", exact: true }));
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
    await expect.element(hoja.getByText("Esta acción no está permitida")).toBeVisible();
    // El servidor devuelve la ficha ya anulada por otra persona.
    const anulada = {
      ...FICHA,
      estado: "ANULADO",
      imprimible: false,
      anulacion: {
        motivo: "Venta duplicada",
        hechaPor: "tomas@ejemplo.com",
        hechaEn: "2026-11-18T00:38:00.000Z",
      },
    };
    await rerender(elemento(anulada));
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Esta acción no está permitida");
    await expect.element(page.getByText("tomas@ejemplo.com")).toBeVisible();
  });

  it("«Volver» de la ficha lleva a la lista", async () => {
    await render(ficha(FICHA).elemento(FICHA));
    await userEvent.click(boton("Volver"));
    expect(router.push).toHaveBeenCalledWith("/ventas/tickets-del-dia");
  });
});
