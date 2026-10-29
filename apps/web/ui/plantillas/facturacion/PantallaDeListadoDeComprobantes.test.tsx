import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { violacionesDeAccesibilidad, verificarFoco } from "../../pruebas/ayudas";
import { ArmazonDeOperacion } from "../sesion/ArmazonDeOperacion";
import { FILTROS_POR_DEFECTO, armarLosFiltros } from "./filtros-del-listado";
import {
  armarElListado,
  armarLaEleccionDeSucursal,
  type PaginaParaMostrar,
} from "./modelo-del-listado";
import {
  PantallaDeListadoDeComprobantes,
  type PropsDePantallaDeListadoDeComprobantes,
} from "./PantallaDeListadoDeComprobantes";

/**
 * El listado de comprobantes en Chromium, en el celular (390 px, tarjetas) y en escritorio (1280 px, tabla): axe como página sin
 * violaciones (contraste incluido), nada de letra por debajo de 16 px, controles de 48 px o más, sin desborde lateral, foco visible,
 * el panel de filtros accesible por teclado y las dos fechas del período «Personalizado» solo con ese período.
 */
const sucursales = [
  { id: "s-centro", nombre: "Centro", activa: true },
  { id: "s-norte", nombre: "Norte", activa: false },
];

const pagina: PaginaParaMostrar = {
  items: [
    {
      id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
      tipo: "FACTURA_B",
      numero: "00001-00001234",
      fecha: "2026-10-14",
      receptorNombre: null,
      receptorDocumento: { tipo: "SIN_IDENTIFICAR" },
      total: "9000.00",
      estado: "AUTORIZADO",
      acreditacion: "PARCIAL",
    },
    {
      id: "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c",
      tipo: "FACTURA_A",
      numero: null,
      fecha: "2026-10-13",
      receptorNombre: "Distribuidora del Sur y Compañía Sociedad de Responsabilidad Limitada",
      receptorDocumento: { tipo: "CUIT", numero: "30712345678" },
      total: "12345678901.50",
      estado: "INCIERTO",
      acreditacion: null,
    },
    {
      id: "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d",
      tipo: "NOTA_CREDITO_B",
      numero: "00001-00000045",
      fecha: "2026-10-12",
      receptorNombre: "Juan Pérez",
      receptorDocumento: { tipo: "DNI", numero: "27345678" },
      total: "4500.00",
      estado: "RECHAZADO",
      acreditacion: null,
    },
  ],
  siguiente: "2026-10-12T10:00:00.000000Z|2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d",
};

const props = (
  cambios: Partial<PropsDePantallaDeListadoDeComprobantes> = {},
  filtros = FILTROS_POR_DEFECTO,
): PropsDePantallaDeListadoDeComprobantes => ({
  eleccionDeSucursal: armarLaEleccionDeSucursal(sucursales, "s-centro"),
  accionDeSucursal: () => Promise.resolve({ error: null }),
  filtros: armarLosFiltros(filtros, [1, 2]),
  listado: armarElListado(pagina, filtros),
  ...cambios,
});

const enArmazon = (p: PropsDePantallaDeListadoDeComprobantes) => (
  <ArmazonDeOperacion
    titulo={texto({}, "fiscal.pantalla.listado_titulo")}
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
    <PantallaDeListadoDeComprobantes {...p} />
  </ArmazonDeOperacion>
);

/** Se ve de verdad: ni `hidden`, ni `display:none`, ni el contenido de un `<details>` cerrado (que se salta con `content-visibility`). */
const visible = (el: Element): boolean =>
  el.closest("[hidden]") === null && el.checkVisibility({ visibilityProperty: true });

/**
 * El alto de la ventana alcanza para toda la página: la barra inferior es `sticky` y, con la página más larga que la ventana, tapa
 * lo que está más abajo (axe lo cuenta como control tapado). Con la ventana a la medida la barra queda al final, como al llegar
 * al final de la página.
 */
const ventana = (ancho: number): Promise<void> => page.viewport(ancho, ancho < 800 ? 2600 : 1600);

/** Cada texto visible llega a 16 px, cada control visible a 48 px de alto y la página no se corre hacia el costado. */
function legibleYTocable(): void {
  const chicos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
    const tieneTexto = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
    );
    if (!tieneTexto || !visible(el)) continue;
    const tamano = Number.parseFloat(getComputedStyle(el).fontSize);
    if (tamano < 16) chicos.push(`${el.tagName.toLowerCase()} ${tamano}px: ${el.textContent}`);
  }
  expect(chicos).toEqual([]);
  const bajos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>(
    "button, a[href], select, input:not([type=hidden]), summary",
  )) {
    if (!visible(el)) continue;
    const alto = el.getBoundingClientRect().height;
    if (alto < 48) bajos.push(`${el.tagName.toLowerCase()} ${alto}px: ${el.textContent}`);
  }
  expect(bajos).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

const tarjetas = (): HTMLElement | null => document.body.querySelector("ul[class*=tarjetas]");
const tabla = (): HTMLElement | null => document.body.querySelector("table");

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("listado de comprobantes en el celular (6A, tarjetas)", () => {
  it("sin violaciones de accesibilidad como página, legible y tocable; tarjetas y no tabla", async () => {
    await ventana(390);
    await render(enArmazon(props()));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    expect(document.body.querySelectorAll("h1")).toHaveLength(1);
    expect(visible(tarjetas() as HTMLElement)).toBe(true);
    expect(visible(tabla() as HTMLElement)).toBe(false);
    // Una tarjeta por comprobante, cada una un enlace real al detalle.
    const enlaces = [...(tarjetas() as HTMLElement).querySelectorAll("a[href]")];
    expect(enlaces.map((a) => a.getAttribute("href"))).toEqual(
      pagina.items.map((i) => `/facturacion/comprobantes/${i.id}`),
    );
  });

  it("los importes, también el enorme, no desbordan y se leen a 18 px con peso fuerte", async () => {
    await render(enArmazon(props()));
    const importes = [...(tarjetas() as HTMLElement).querySelectorAll<HTMLElement>("span")].filter(
      (el) => /^\$ /.test(el.textContent ?? "") && el.children.length === 0,
    );
    expect(importes.length).toBe(3);
    for (const el of importes) {
      expect(
        Number.parseFloat(getComputedStyle(el).fontSize),
        el.textContent ?? "",
      ).toBeGreaterThanOrEqual(18);
      expect(Number(getComputedStyle(el).fontWeight)).toBeGreaterThanOrEqual(600);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("el panel de filtros: cerrado no se ve; se abre con teclado y sus controles son tocables", async () => {
    await ventana(390);
    await render(enArmazon(props()));
    const periodo = page.getByLabelText("Período");
    expect(visible(periodo.element())).toBe(false);
    const resumen = page.getByText("Filtros (0)");
    // Desde el campo de búsqueda, un Tab lleva al botón «Filtros (n)», con el foco visible.
    await userEvent.click(page.getByLabelText("Nombre o CUIT"));
    await verificarFoco(document.querySelector("summary") as HTMLElement);
    await userEvent.keyboard("{Enter}");
    expect(visible(periodo.element())).toBe(true);
    await expect.element(resumen).toBeVisible();
    legibleYTocable();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    // Se cierra con el mismo teclado.
    await userEvent.keyboard("{Enter}");
    expect(visible(periodo.element())).toBe(false);
  });

  it("el foco se ve en el botón de filtros, en una tarjeta y en «Página siguiente»", async () => {
    await render(enArmazon(props()));
    const resumen = document.querySelector("summary") as HTMLElement;
    await userEvent.click(page.getByLabelText("Nombre o CUIT"));
    await verificarFoco(resumen);
    const tarjeta = (tarjetas() as HTMLElement).querySelector("a") as HTMLElement;
    tarjeta.focus();
    await userEvent.tab();
    await userEvent.tab();
    const siguiente = page.getByRole("link", { name: "Página siguiente" }).element() as HTMLElement;
    siguiente.focus();
    await userEvent.tab({ shift: true });
    await verificarFoco(siguiente);
  });

  it("las fechas del período «Personalizado» solo se ven con ese período", async () => {
    await ventana(390);
    await render(enArmazon(props()));
    await userEvent.click(page.getByText("Filtros (0)"));
    const desde = page.getByLabelText("Desde");
    expect(visible(desde.element())).toBe(false);
    await page.getByLabelText("Período").selectOptions("personalizado");
    expect(visible(desde.element())).toBe(true);
    expect(visible(page.getByLabelText("Hasta").element())).toBe(true);
    legibleYTocable();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await page.getByLabelText("Período").selectOptions("hoy");
    expect(visible(desde.element())).toBe(false);
  });

  it("los campos arrancan con los filtros de la dirección y se reinician cuando la pantalla los cambia («Limpiar»)", async () => {
    const filtrado = { ...FILTROS_POR_DEFECTO, estado: "RECHAZADO", texto: "Sur" } as const;
    const { rerender } = await render(enArmazon(props({}, filtrado)));
    await userEvent.click(page.getByText("Filtros (1)"));
    expect((page.getByLabelText("Estado").element() as HTMLSelectElement).value).toBe("RECHAZADO");
    expect((page.getByLabelText("Nombre o CUIT").element() as HTMLInputElement).value).toBe("Sur");
    await rerender(enArmazon(props()));
    expect((page.getByLabelText("Estado").element() as HTMLSelectElement).value).toBe("");
    expect((page.getByLabelText("Nombre o CUIT").element() as HTMLInputElement).value).toBe("");
  });

  it("sin comprobantes: aviso accesible y sin lista", async () => {
    await ventana(390);
    await render(
      enArmazon(
        props({ listado: armarElListado({ items: [], siguiente: null }, FILTROS_POR_DEFECTO) }),
      ),
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent(
        "No hay comprobantes con esos filtros. Probá con otro período o tocá «Limpiar».",
      );
    expect(tabla()).toBeNull();
    legibleYTocable();
  });

  it("sin sucursal elegida: la invitación y el selector, accesibles y tocables", async () => {
    await ventana(390);
    await render(
      enArmazon(
        props({
          eleccionDeSucursal: armarLaEleccionDeSucursal(sucursales, ""),
          filtros: null,
          listado: null,
        }),
      ),
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await expect
      .element(page.getByText("Elegí una sucursal para ver sus comprobantes."))
      .toBeVisible();
    // «Sucursal» nombra el grupo y el selector: el selector se busca por su rol.
    const selector = page.getByRole("combobox", { name: "Sucursal" });
    await expect.element(selector).toBeVisible();
    expect((selector.element() as HTMLSelectElement).required).toBe(true);
    await expect.element(page.getByRole("group", { name: "Sucursal" })).toBeVisible();
    const opciones = [...(selector.element() as HTMLSelectElement).options];
    expect(opciones.map((o) => o.textContent)).toEqual([
      "Elegí una sucursal",
      "Centro",
      "Norte · Cerrada",
    ]);
  });
});

describe("listado de comprobantes en escritorio (6C, tabla)", () => {
  it("sin violaciones como página, legible y tocable; tabla y no tarjetas; filtros siempre a la vista", async () => {
    await ventana(1280);
    await render(enArmazon(props()));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    expect(visible(tabla() as HTMLElement)).toBe(true);
    expect(visible(tarjetas() as HTMLElement)).toBe(false);
    // Los filtros se ven sin abrir nada y el botón «Filtros (n)» no hace falta.
    for (const rotulo of ["Período", "Estado", "Letra", "Punto de venta", "Nombre o CUIT"]) {
      expect(visible(page.getByLabelText(rotulo).element()), rotulo).toBe(true);
    }
    expect(visible(document.querySelector("summary") as HTMLElement)).toBe(false);
    const columnas = [...(tabla() as HTMLElement).querySelectorAll("th")].map(
      (th) => th.textContent,
    );
    expect(columnas).toEqual(["Fecha", "Comprobante", "Cliente", "Documento", "Total", "Estado"]);
  });

  it("cada fila es un enlace al detalle que cubre toda la fila", async () => {
    await ventana(1280);
    await render(enArmazon(props()));
    const filas = [...(tabla() as HTMLElement).querySelectorAll("tbody tr")];
    expect(filas).toHaveLength(3);
    for (const fila of filas) {
      const enlace = fila.querySelector("a[href]") as HTMLAnchorElement;
      const celda = fila.querySelectorAll("td")[3] as HTMLElement;
      const caja = celda.getBoundingClientRect();
      const tocado = document.elementFromPoint(
        caja.left + caja.width / 2,
        caja.top + caja.height / 2,
      );
      expect(tocado?.closest("a"), enlace.textContent ?? "").toBe(enlace);
    }
  });

  it("la tabla no corre la página hacia el costado, ni con un nombre larguísimo o un importe enorme", async () => {
    await ventana(1280);
    await render(enArmazon(props()));
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    const contenedor = (tabla() as HTMLElement).parentElement as HTMLElement;
    expect(contenedor.scrollWidth).toBeLessThanOrEqual(contenedor.clientWidth);
  });

  it("los filtros con un período personalizado: las fechas aparecen en la misma fila", async () => {
    await ventana(1280);
    await render(enArmazon(props({}, { ...FILTROS_POR_DEFECTO, periodo: "personalizado" })));
    expect(visible(page.getByLabelText("Desde").element())).toBe(true);
    legibleYTocable();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("el destino «Comprobantes» de la barra queda marcado como actual", async () => {
    await render(enArmazon(props()));
    await expect
      .element(page.getByRole("link", { name: "Comprobantes" }))
      .toHaveAttribute("aria-current", "page");
  });
});
