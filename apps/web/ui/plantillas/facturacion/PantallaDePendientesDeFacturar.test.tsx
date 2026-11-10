import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { ArmazonDeOperacion } from "../sesion/ArmazonDeOperacion";
import { armarLosPendientes } from "./modelo-de-pendientes";
import { PantallaDePendientesDeFacturar } from "./PantallaDePendientesDeFacturar";

/**
 * «Pendientes de facturar» en Chromium (E1 §3.6): una tarjeta por venta cobrada, cada una un enlace real a Emitir desde ese ticket; el aviso
 * cuando no hay; «Página siguiente»; axe, tamaños y sin desborde en 390 y 1280 px.
 */

const T1 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const T2 = "8b7a6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d";
const SUCURSAL = "5c4b3a29-1807-4f6e-9d5c-4b3a29180716";

const enArmazon = (cuerpo: React.ReactNode) => (
  <ArmazonDeOperacion
    titulo={texto({}, "fiscal.pantalla.pendientes_titulo")}
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
    {cuerpo}
  </ArmazonDeOperacion>
);

const lista = armarLosPendientes(
  {},
  {
    tickets: [
      {
        ticketId: T1,
        numero: 124,
        fechaNegocio: "2026-11-09",
        total: { moneda: "ARS", monto: "17525.00" },
      },
      {
        ticketId: T2,
        numero: 125,
        fechaNegocio: "2026-11-09",
        total: { moneda: "ARS", monto: "1234567890.00" },
      },
    ],
    siguiente: { fechaNegocio: "2026-11-09", numero: 125, sucursalId: SUCURSAL },
  },
);

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("pendientes de facturar", () => {
  it("una tarjeta por venta, cada una un enlace a Emitir desde ese ticket, con su número, su día y su total; y «Página siguiente»", async () => {
    await render(enArmazon(<PantallaDePendientesDeFacturar pendientes={lista} />));
    await expect.element(page.getByText("Venta N.º 124")).toBeVisible();
    await expect.element(page.getByText("$ 17.525,00")).toBeVisible();
    const enlaces = [...document.querySelectorAll('a[href*="/emitir/venta/"]')].map((a) =>
      a.getAttribute("href"),
    );
    expect(enlaces).toEqual([
      `/facturacion/comprobantes/emitir/venta/${T1}`,
      `/facturacion/comprobantes/emitir/venta/${T2}`,
    ]);
    await expect
      .element(page.getByRole("link", { name: "Página siguiente" }))
      .toHaveAttribute("href", lista.siguiente?.href ?? "");
  });

  it("sin ventas: el aviso «No hay ventas pendientes de facturar» y ninguna tarjeta", async () => {
    await render(
      enArmazon(
        <PantallaDePendientesDeFacturar
          pendientes={armarLosPendientes({}, { tickets: [], siguiente: null })}
        />,
      ),
    );
    await expect.element(page.getByText("No hay ventas pendientes de facturar")).toBeVisible();
    expect(document.querySelectorAll('a[href*="/emitir/venta/"]').length).toBe(0);
  });

  it("axe, tamaños y sin desborde en 390 y 1280 px (también con un total enorme)", async () => {
    for (const ancho of [390, 1280]) {
      await page.viewport(ancho, 900);
      const { unmount } = await render(
        enArmazon(<PantallaDePendientesDeFacturar pendientes={lista} />),
      );
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });
});
