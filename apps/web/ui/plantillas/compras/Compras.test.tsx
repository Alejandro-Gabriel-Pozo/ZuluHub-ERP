import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PantallaDeFichaDeCompra } from "./ficha/PantallaDeFichaDeCompra";
import type { FichaDeCompraParaLaPantalla } from "./ficha/modelo-de-ficha-de-compra";
import { PantallaDeListaDeCompras } from "./lista/PantallaDeListaDeCompras";
import type { ListaDeComprasParaLaPantalla } from "./lista/modelo-de-lista-de-compras";
import { textosDeCompras } from "./textos-de-compras";

/**
 * «Compras» y «Compra» (Compras PR 3) en un navegador real: la lista (filas-enlace con su nombre accesible, «Sin precio» y nunca cero, chips y fechas dentro de un formulario GET que anda sin JavaScript,
 * «Página siguiente», lista vacía) y la ficha (líneas, total, factura, anulada). Solo lectura: ningún botón de acción. Sin violaciones de accesibilidad (axe) y con foco visible.
 */

// La hoja de «Anular» recarga la ficha con el enrutador de Next: acá se reemplaza (precedente de «Tickets del día»).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const UUID = "0b0b0b0b-1111-4222-8333-444444444444";
const pesos = (monto: string) => ({ moneda: "ARS", monto });

const fila = (n: number, cambios: Record<string, unknown> = {}) => ({
  recepcionId: `${UUID.slice(0, -2)}${String(10 + n)}`,
  numero: n,
  proveedor: "Carnes del Sur",
  fechaNegocio: "2026-10-31",
  estado: "RECIBIDA_SIN_FACTURAR" as const,
  total: pesos("2000.00"),
  factura: null,
  ...cambios,
});
const lista = (compras: unknown[], resto: Record<string, unknown> = {}) =>
  ({
    compras,
    siguiente: null,
    filtros: { estado: "TODAS", desde: null, hasta: null },
    ...resto,
  }) as unknown as ListaDeComprasParaLaPantalla;

describe("PantallaDeListaDeCompras", () => {
  it("una fila-enlace por compra con su nombre accesible; «Sin precio» y nunca cero; sin botones de acción; sin violaciones de accesibilidad", async () => {
    await render(
      <PantallaDeListaDeCompras
        lista={lista([
          fila(3, { total: null }),
          fila(2, {
            estado: "RECIBIDA_Y_FACTURADA",
            factura: { letra: "A", puntoDeVenta: 4, numero: 5678 },
          }),
          fila(1, { estado: "ANULADA" }),
        ])}
        textos={textosDeCompras()}
      />,
    );
    const enlaces = page.getByRole("link").elements();
    expect(enlaces.map((e) => e.getAttribute("aria-label"))).toEqual([
      "Compra 3 · Carnes del Sur, Recibida sin facturar, Sin precio",
      "Compra 2 · Carnes del Sur, Factura A 00004-00005678, $ 2.000,00",
      "Compra 1 · Carnes del Sur, Recibida sin facturar · Anulada, $ 2.000,00",
    ]);
    expect(enlaces[0]?.getAttribute("href")).toBe(`/compras/${fila(3).recepcionId}`);
    expect(document.body.textContent).not.toContain("$ 0,00");
    // Solo se puede aplicar el filtro: ningún otro botón.
    const botones = page.getByRole("button").elements();
    expect(botones.map((b) => b.textContent)).toEqual(["Aplicar filtros"]);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el filtro es un formulario GET con chips, dos fechas y «Aplicar filtros»: anda sin JavaScript", async () => {
    await render(
      <PantallaDeListaDeCompras
        lista={lista([fila(1)], {
          filtros: { estado: "SIN_FACTURAR", desde: "2026-10-01", hasta: null },
        })}
        textos={textosDeCompras()}
      />,
    );
    const formulario = document.querySelector("form");
    expect(formulario?.getAttribute("method")).toBe("get");
    expect(formulario?.getAttribute("action")).toBe("/compras");
    expect(page.getByRole("radio", { name: "Todas" }).element()).toHaveProperty("checked", false);
    expect(page.getByRole("radio", { name: "Sin facturar" }).element()).toHaveProperty(
      "checked",
      true,
    );
    expect(document.querySelector<HTMLInputElement>('input[name="desde"]')?.value).toBe(
      "2026-10-01",
    );
    expect(document.querySelector<HTMLInputElement>('input[name="hasta"]')?.value).toBe("");
    // Todo lo que viaja tiene su `name`: lo que se manda es lo que se ve.
    const nombres = [...new FormData(formulario as HTMLFormElement).keys()].sort();
    expect(nombres).toEqual(["desde", "estado", "hasta"]);
    // Elegir otro chip cambia lo que viaja.
    await page.getByRole("radio", { name: "Todas" }).click();
    expect(new FormData(formulario as HTMLFormElement).get("estado")).toBe("TODAS");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Página siguiente» solo si hay otra página, con el filtro aplicado en la dirección; foco visible con el teclado", async () => {
    const { unmount } = await render(
      <PantallaDeListaDeCompras lista={lista([fila(1)])} textos={textosDeCompras()} />,
    );
    expect(page.getByRole("link", { name: "Página siguiente" }).elements()).toHaveLength(0);
    await unmount();
    await render(
      <PantallaDeListaDeCompras
        lista={lista([fila(1)], {
          siguiente: "2026-10-31|7",
          filtros: { estado: "SIN_FACTURAR", desde: null, hasta: null },
        })}
        textos={textosDeCompras()}
      />,
    );
    const siguiente = page.getByRole("link", { name: "Página siguiente" });
    await expect
      .element(siguiente)
      .toHaveAttribute("href", "/compras?estado=SIN_FACTURAR&despues=2026-10-31%7C7");
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).not.toBe(document.body);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("vacía: «Sin resultados» y «Ver todas»; sin filas ni «Página siguiente»", async () => {
    await render(
      <PantallaDeListaDeCompras
        lista={lista([], { filtros: { estado: "SIN_FACTURAR", desde: null, hasta: null } })}
        textos={textosDeCompras()}
      />,
    );
    await expect.element(page.getByText("Sin resultados")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Ver todas" }))
      .toHaveAttribute("href", "/compras");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});

const FICHA: FichaDeCompraParaLaPantalla = {
  recepcionId: UUID,
  numero: 5,
  proveedor: "Carnes del Sur",
  fechaNegocio: "2026-10-31",
  estado: "RECIBIDA_Y_FACTURADA",
  remito: { puntoDeVenta: 1, numero: 45, fecha: "2026-10-30" },
  registradaPor: "ana@ejemplo.com",
  registradaEn: "2026-11-01T00:14:00.000Z",
  anulacion: null,
  lineas: [
    {
      numero: 1,
      producto: "Bife de chorizo",
      cantidadDeCompra: "2.0000",
      presentacion: "Caja",
      unidadDeCompraId: "KILOGRAMO",
      cantidadEnStock: "46.6000",
      unidadDeStockId: "KILOGRAMO",
      importe: pesos("512600.00"),
      costoPorUnidadDeStock: pesos("11000.000000"),
      precioPor: { tipo: "PRESENTACION", unidadId: null },
      correccionesVistas: 0,
      correcciones: [],
    },
    {
      numero: 2,
      producto: "Aceite",
      cantidadDeCompra: "2.0000",
      presentacion: null,
      unidadDeCompraId: "LITRO",
      cantidadEnStock: "2.0000",
      unidadDeStockId: "LITRO",
      importe: null,
      costoPorUnidadDeStock: null,
      precioPor: null,
      correccionesVistas: 0,
      correcciones: [],
    },
  ],
  total: null,
  factura: {
    letra: "A",
    puntoDeVenta: 2,
    numero: 1187,
    fecha: "2026-10-31",
    vencimientoDePago: "2026-11-30",
    totalSegunLaFactura: pesos("29225040.00"),
  },
};

describe("PantallaDeFichaDeCompra", () => {
  it("líneas con lo que entra a tu stock y el costo, «Sin precio» sin costo, la factura y el remito; solo «Volver»; sin violaciones de accesibilidad", async () => {
    await render(<PantallaDeFichaDeCompra ficha={FICHA} textos={textosDeCompras()} />);
    await expect.element(page.getByText("Carnes del Sur · 31/10/2026")).toBeVisible();
    await expect.element(page.getByText("2 Caja · Entra a tu stock: 46,6 Kilogramo")).toBeVisible();
    await expect.element(page.getByText("Costo por unidad de stock: $ 11.000,00")).toBeVisible();
    await expect.element(page.getByText("2 Litro · Entra a tu stock: 2 Litro")).toBeVisible();
    expect(document.body.textContent).toContain("Sin precio");
    expect(document.body.textContent).not.toContain("$ 0,00");
    expect(document.body.textContent?.match(/Costo por unidad de stock/g)).toHaveLength(1);
    await expect.element(page.getByText("Factura A 00002-00001187")).toBeVisible();
    await expect.element(page.getByText("31/10/2026 · Vence 30/11/2026")).toBeVisible();
    await expect.element(page.getByText("Remito del proveedor")).toBeVisible();
    await expect.element(page.getByText("ana@ejemplo.com · 31/10/2026 21:14")).toBeVisible();
    expect(page.getByRole("button").elements()).toHaveLength(0);
    expect(
      page
        .getByRole("link")
        .elements()
        .map((e) => e.textContent),
    ).toEqual(["Volver"]);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("anulada: «Anulada» con texto, motivo, quién y cuándo", async () => {
    await render(
      <PantallaDeFichaDeCompra
        ficha={{
          ...FICHA,
          estado: "ANULADA",
          factura: null,
          remito: null,
          anulacion: {
            motivo: "Se cargó por error",
            hechaPor: "bea@ejemplo.com",
            hechaEn: "2026-11-02T15:00:00.000Z",
          },
        }}
        textos={textosDeCompras()}
      />,
    );
    await expect.element(page.getByText("Anulada")).toBeVisible();
    await expect.element(page.getByText("Se cargó por error")).toBeVisible();
    await expect.element(page.getByText("bea@ejemplo.com · 02/11/2026 12:00")).toBeVisible();
    await expect.element(page.getByText("Sin remito")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
