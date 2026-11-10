import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import {
  boton,
  campo,
  ID_FACTURA,
  legibleYTocable,
  listo,
  PUNTO_1,
  PUNTO_2_PRUEBAS,
  servidorFalso,
} from "../../pruebas/ayudas-de-emision";
import { ArmazonDeOperacion } from "../sesion/ArmazonDeOperacion";
import {
  PantallaDeEmitirDesdeUnTicket,
  type PropsDePantallaDeEmitirDesdeUnTicket,
} from "./PantallaDeEmitirDesdeUnTicket.cliente";
import type { TicketParaLaPantalla } from "./modelo-de-emision-de-un-ticket";

/**
 * Emitir desde un ticket en Chromium (E1 §3.6): los renglones son los del ticket y no se editan, solo se elige el cliente; el pedido lleva
 * únicamente el ticket, el punto de venta, el receptor y UNA clave; el botón confirma una vez. Axe, foco, 390 y 1280 px.
 */

const TICKET_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const TICKET: TicketParaLaPantalla = {
  ticketId: TICKET_ID,
  numero: 124,
  numeroDeCorreccion: null,
  sucursalId: "5c4b3a29-1807-4f6e-9d5c-4b3a29180716",
  total: { moneda: "ARS", monto: "17525.00" },
  lineas: [
    {
      descripcion: "Milanesa",
      varianteNombre: "Grande",
      opciones: ["Napolitana", "Carne"],
      cantidad: "1.0000",
      unidad: null,
      precioUnitario: "12000.000000",
      alicuota: "21",
      importe: "12000.00",
    },
    {
      descripcion: "Pan de campo",
      varianteNombre: null,
      opciones: [],
      cantidad: "1.2500",
      unidad: "kg",
      precioUnitario: "4420.000000",
      alicuota: "10.5",
      importe: "5525.00",
    },
  ],
};

afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

const enArmazon = (props: Partial<PropsDePantallaDeEmitirDesdeUnTicket> = {}) => (
  <ArmazonDeOperacion
    titulo={texto({}, "fiscal.pantalla.emitir_titulo")}
    actual="comprobantes"
    marca="Hotel del Lago"
    empresa="Café del Puerto"
    modulos={[
      {
        clave: "comprobantes",
        href: "/facturacion/comprobantes",
        etiqueta: "Comprobantes",
        icono: "comprobantes",
      },
    ]}
  >
    <PantallaDeEmitirDesdeUnTicket
      ticket={TICKET}
      discriminaIva
      puntosDeVenta={[PUNTO_1]}
      emitir={servidorFalso().emitir}
      irA={() => undefined}
      esperaEntreVerificacionesMs={20}
      {...props}
    />
  </ArmazonDeOperacion>
);

describe("emitir desde un ticket: lo que se ve", () => {
  it("«Venta N.º 124», dos pasos (Cliente y Revisar) y, en Revisar, los renglones del ticket con su unidad, el IVA y el total cobrado", async () => {
    await render(enArmazon());
    await expect.element(page.getByText("Venta N.º 124")).toBeVisible();
    expect(
      [...document.querySelectorAll("ol li")].map((li) => li.textContent?.replace(/\s+/g, " ")),
    ).toEqual(["1 Cliente", "2 Revisar"]);
    // No hay «Renglones» (no se editan) ni «+ Agregar renglón».
    expect(document.body.textContent).not.toContain("Agregar renglón");
    await userEvent.click(boton("Siguiente"));
    await expect.element(page.getByText("Milanesa · Grande · Napolitana · Carne")).toBeVisible();
    await expect.element(page.getByText("1,25 kg × $ 4.420,00 · IVA 10,5 %")).toBeVisible();
    await expect.element(page.getByText("1 × $ 12.000,00 · IVA 21 %")).toBeVisible();
    await expect.element(page.getByText("$ 17.525,00").first()).toBeVisible();
    // La unidad base no se imprime (ni «u»), y no hay campos para editar los renglones.
    expect(document.body.textContent).not.toMatch(/\b1 u\b/);
    expect(document.querySelectorAll("input[name^=renglon], textarea").length).toBe(0);
  });

  it("una empresa que no discrimina IVA (letra C) no muestra la alícuota de los renglones", async () => {
    await render(enArmazon({ discriminaIva: false }));
    await userEvent.click(boton("Siguiente"));
    await expect.element(page.getByText("1,25 kg × $ 4.420,00")).toBeVisible();
    expect(document.body.textContent).not.toContain("IVA 10,5");
  });

  it("sin puntos de venta, sin dónde emitir: cartel y «Emitir factura» apagado", async () => {
    await render(enArmazon({ puntosDeVenta: [] }));
    await userEvent.click(boton("Siguiente"));
    await expect.element(page.getByText("Ninguno activo")).toBeVisible();
    await expect.element(boton("Emitir factura")).toBeDisabled();
  });

  it("axe, tamaños y sin desborde en 390 y 1280 px, en los dos pasos", async () => {
    // Alto suficiente para ver todo sin scroll, como las pruebas de Emitir (`enLosDosAnchos`): con un alto menor la barra inferior fija
    // queda sobre los botones del final y axe (`target-size`) los mide solapados, según el alto del contenido en esa máquina.
    for (const [ancho, alto] of [
      [390, 1600],
      [1280, 1100],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(enArmazon());
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
      await userEvent.click(boton("Siguiente"));
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });
});

describe("emitir desde un ticket: el pedido y el envío", () => {
  it("el pedido lleva SOLO el ticket, el punto de venta, el receptor y UNA clave (ni renglones, ni importes, ni sucursal, ni empresa)", async () => {
    const servidor = servidorFalso();
    await render(enArmazon({ emitir: servidor.emitir }));
    await userEvent.selectOptions(campo("Documento"), "DNI");
    await userEvent.type(campo("DNI"), "27345678");
    await userEvent.type(campo("Nombre o razón social"), "Juan Pérez");
    await userEvent.selectOptions(campo("Condición frente al IVA"), "CONSUMIDOR_FINAL");
    await userEvent.click(boton("Siguiente"));
    tocar(boton("Emitir factura"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    expect(servidor.pedidos[0]?.["clave"]).toMatch(UUID);
    expect({ ...servidor.pedidos[0], clave: "(la clave)" }).toEqual({
      clave: "(la clave)",
      ticketId: TICKET_ID,
      puntoDeVentaId: PUNTO_1.id,
      receptor: {
        nombre: "Juan Pérez",
        documento: { tipo: "DNI", numero: "27345678" },
        condicionIva: "CONSUMIDOR_FINAL",
        domicilio: null,
      },
    });
  });

  it("consumidor final: receptor sin documento ni nombre; con varios puntos manda el elegido", async () => {
    const servidor = servidorFalso();
    await render(enArmazon({ emitir: servidor.emitir, puntosDeVenta: [PUNTO_1, PUNTO_2_PRUEBAS] }));
    await userEvent.click(boton("Siguiente"));
    await userEvent.selectOptions(
      page.getByRole("combobox", { name: "Punto de venta" }),
      PUNTO_2_PRUEBAS.id,
    );
    tocar(boton("Emitir factura"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    expect(servidor.pedidos[0]).toMatchObject({
      ticketId: TICKET_ID,
      puntoDeVentaId: PUNTO_2_PRUEBAS.id,
      receptor: {
        nombre: null,
        documento: { tipo: "SIN_IDENTIFICAR" },
        condicionIva: "CONSUMIDOR_FINAL",
        domicilio: null,
      },
    });
  });

  it("el botón se bloquea al primer toque, un triple toque es UNA emisión y al terminar abre el detalle del comprobante", async () => {
    const servidor = servidorFalso(
      () => new Promise((resolver) => setTimeout(() => resolver(listo), 60)),
    );
    const irA = vi.fn();
    await render(enArmazon({ emitir: servidor.emitir, irA }));
    await userEvent.click(boton("Siguiente"));
    tocar(boton("Emitir factura"));
    tocar(boton("Emitir factura"));
    tocar(boton("Emitir factura"));
    await expect.element(boton("Enviando…")).toHaveAttribute("aria-disabled", "true");
    await vi.waitFor(() =>
      expect(irA).toHaveBeenCalledWith(`/facturacion/comprobantes/${ID_FACTURA}`),
    );
    tocar(boton("Enviando…"));
    expect(servidor.pedidos).toHaveLength(1);
    expect(irA).toHaveBeenCalledTimes(1);
  });

  it("si otra persona ya facturó el ticket, el servidor devuelve ese comprobante y la pantalla va a él (sin error)", async () => {
    const servidor = servidorFalso(() =>
      Promise.resolve({ ok: true, dato: { comprobanteId: ID_FACTURA, yaExistia: true } }),
    );
    const irA = vi.fn();
    await render(enArmazon({ emitir: servidor.emitir, irA }));
    await userEvent.click(boton("Siguiente"));
    tocar(boton("Emitir factura"));
    await vi.waitFor(() =>
      expect(irA).toHaveBeenCalledWith(`/facturacion/comprobantes/${ID_FACTURA}`),
    );
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("un rechazo del servidor se ve con su texto, sin el código, y se puede volver a intentar", async () => {
    const servidor = servidorFalso((n) =>
      Promise.resolve(
        n === 1
          ? {
              ok: false as const,
              error: {
                codigo: "FISCAL_SIN_CERTIFICADO" as const,
                clave: "error.fiscal_sin_certificado" as const,
                presentacion: "AVISO" as const,
              },
            }
          : listo,
      ),
    );
    const irA = vi.fn();
    await render(enArmazon({ emitir: servidor.emitir, irA }));
    await userEvent.click(boton("Siguiente"));
    tocar(boton("Emitir factura"));
    await vi.waitFor(() => expect(servidor.pedidos).toHaveLength(1));
    expect(document.body.textContent).not.toContain("FISCAL_SIN_CERTIFICADO");
    expect(irA).not.toHaveBeenCalled();
  });
});
