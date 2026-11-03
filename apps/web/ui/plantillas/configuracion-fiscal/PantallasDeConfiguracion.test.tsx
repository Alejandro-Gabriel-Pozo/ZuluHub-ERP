import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PERMITIDO, enArmazon, legibleYTocable, ventana } from "./ayudas-de-pruebas";
import { armarLaLista, type EstadoParaLaLista } from "./lista-de-lo-que-falta";
import { MigasDeConfiguracion } from "./MigasDeConfiguracion";
import {
  armarLaListaDePuntosDeVenta,
  type OfertaDeAccion,
  type PuntoParaConfigurar,
} from "./modelo-de-puntos-de-venta";
import { PantallaDeConfiguracionFiscal } from "./PantallaDeConfiguracionFiscal";
import { PantallaDePuntosDeVenta } from "./PantallaDePuntosDeVenta";

/**
 * Las dos listas de Configuración fiscal en Chromium, en el celular (390 px) y en escritorio (1280 px): axe como página sin
 * violaciones (contraste incluido), letra de 16 px o más, controles de 48 px o más, sin desborde lateral, filas que son enlaces
 * reales y alcanzables por teclado con el foco visible.
 */
afterEach(async () => {
  await page.viewport(390, 844);
});

const ESTADO: EstadoParaLaLista = {
  datosFiscales: { estado: "BORRADOR" },
  puntosDeVenta: { estado: "SIN_ACTIVOS", ambientesEnUso: [] },
  certificados: [{ ambiente: "HOMOLOGACION", situacion: "VIGENTE", vencido: true }],
};

const punto = (id: string, numero: number, cambios: Partial<PuntoParaConfigurar>) => ({
  id,
  numero,
  activo: true,
  ambiente: "HOMOLOGACION" as const,
  sucursal: { id: "s", nombre: "Casa central", activa: true },
  tieneDomicilio: true,
  hayNumerosUsados: false,
  version: 1,
  ...cambios,
});
const PUNTOS = [
  punto("a", 1, { ambiente: "PRODUCCION" }),
  punto("b", 2, {
    sucursal: {
      id: "t",
      nombre: "Sucursal del Norte con un nombre muy largo para ver cómo cede",
      activa: false,
    },
  }),
  punto("c", 3, { activo: false }),
];
const MIGAS = [{ texto: "Configuración fiscal", href: "/configuracion-fiscal" }];

const lista = () => (
  <PantallaDeConfiguracionFiscal
    subtitulo={texto({}, "fiscal.pantalla.config_subtitulo")}
    filas={armarLaLista(ESTADO)}
  />
);
const puntos = (items = PUNTOS, oferta: OfertaDeAccion = PERMITIDO) => (
  <PantallaDePuntosDeVenta
    migas={MIGAS}
    filas={armarLaListaDePuntosDeVenta(items)}
    vacio="Todavía no hay puntos de venta."
    ayuda="Tocá un punto de venta para editarlo, activarlo o desactivarlo."
    agregar={{
      texto: "Agregar punto de venta",
      href: "/configuracion-fiscal/puntos-de-venta/nuevo",
      oferta,
    }}
  />
);

describe.each([390, 1280])("a %i px", (ancho) => {
  it("la lista de lo que falta: accesible, legible y tocable, sin desborde; los carteles se dicen con texto", async () => {
    await ventana(ancho);
    await render(enArmazon("Configuración fiscal", lista()));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    for (const cartel of ["Pendiente", "Ninguno activo", "Vencido"]) {
      await expect.element(page.getByText(cartel, { exact: true })).toBeVisible();
    }
  });

  it("la lista de puntos de venta: accesible, legible y tocable, sin desborde, con todos (también el no activo)", async () => {
    await ventana(ancho);
    await render(enArmazon("Puntos de venta", puntos()));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await expect.element(page.getByText("No activo", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Producción", { exact: true })).toBeVisible();
    await expect.element(page.getByText("· Cerrada", { exact: false })).toBeVisible();
  });
});

describe("las filas y el teclado", () => {
  it("datos fiscales y puntos de venta son enlaces; el certificado, no", async () => {
    await render(lista());
    const enlaces = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
    expect(enlaces).toEqual([
      "/configuracion-fiscal/datos-fiscales",
      "/configuracion-fiscal/puntos-de-venta",
    ]);
    await expect.element(page.getByRole("link", { name: /Datos fiscales/ })).toBeVisible();
    await expect.element(page.getByText("Certificado de ARCA")).toBeVisible();
    expect(page.getByRole("link", { name: /Certificado de ARCA/ }).elements()).toHaveLength(0);
  });

  it("Tab llega a la fila con enlace con el foco visible", async () => {
    await render(lista());
    const enlace = document.querySelector<HTMLElement>("a[href]") as HTMLElement;
    await verificarFoco(enlace);
  });

  it("cada punto de venta es un enlace a su pantalla y «Agregar punto de venta» al alta; el foco se ve en ambos", async () => {
    await render(puntos());
    const enlaces = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
    expect(enlaces).toEqual([
      "/configuracion-fiscal",
      "/configuracion-fiscal/puntos-de-venta/a",
      "/configuracion-fiscal/puntos-de-venta/b",
      "/configuracion-fiscal/puntos-de-venta/c",
      "/configuracion-fiscal/puntos-de-venta/nuevo",
    ]);
    const migas = document.querySelector<HTMLElement>("a[href]") as HTMLElement;
    await verificarFoco(migas);
    await userEvent.tab();
    expect(document.activeElement?.getAttribute("href")).toBe(
      "/configuracion-fiscal/puntos-de-venta/a",
    );
    expect(getComputedStyle(document.activeElement as Element).outlineStyle).toBe("solid");
    const agregar = page
      .getByRole("link", { name: "Agregar punto de venta" })
      .element() as HTMLElement;
    agregar.focus();
    expect(getComputedStyle(agregar).outlineStyle).toBe("solid");
  });

  it("sin puntos de venta: «Todavía no hay puntos de venta.» y «Agregar punto de venta» debajo, sin la ayuda de tocar uno", async () => {
    await render(puntos([]));
    const vacio = page.getByText("Todavía no hay puntos de venta.");
    await expect.element(vacio).toBeVisible();
    const agregar = page.getByRole("link", { name: "Agregar punto de venta" });
    await expect.element(agregar).toBeVisible();
    expect(
      vacio.element().compareDocumentPosition(agregar.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("Tocá un punto de venta");
  });

  it("si el servidor no deja agregar: «Agregar punto de venta» sale apagado con su motivo a la vista, sin enlace al alta", async () => {
    await ventana(390);
    await render(
      enArmazon(
        "Puntos de venta",
        puntos(PUNTOS, { permitida: false, motivo: "No tiene permiso para hacer esto." }),
      ),
    );
    const agregar = page.getByRole("button", { name: "Agregar punto de venta" });
    await expect.element(agregar).toBeDisabled();
    await expect.element(page.getByText("No tiene permiso para hacer esto.")).toBeVisible();
    expect(page.getByRole("link", { name: "Agregar punto de venta" }).elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("con puntos de venta no se dice que no hay", async () => {
    await render(puntos());
    expect(document.body.textContent).not.toContain("Todavía no hay");
  });

  it("cada punto de venta lleva los rótulos «Estado» y «Ambiente» a la vista; el aviso solo en los de pruebas", async () => {
    await ventana(390);
    await render(enArmazon("Puntos de venta", puntos()));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    expect(page.getByText("Estado", { exact: true }).elements()).toHaveLength(3);
    expect(page.getByText("Ambiente", { exact: true }).elements()).toHaveLength(3);
    // El 1 es de producción; el 2 y el 3, de pruebas.
    expect(
      page.getByText("Las facturas de pruebas no tienen valor fiscal.").elements(),
    ).toHaveLength(2);
    const primera = document.querySelector("li") as HTMLElement;
    expect(primera.textContent).not.toContain("valor fiscal");
  });

  it("las migas son un enlace por tramo, separados por un símbolo que el lector de pantalla no lee", async () => {
    await render(
      <MigasDeConfiguracion
        tramos={[
          { texto: "Configuración fiscal", href: "/configuracion-fiscal" },
          { texto: "Puntos de venta", href: "/configuracion-fiscal/puntos-de-venta" },
        ]}
      />,
    );
    expect(page.getByRole("link").elements()).toHaveLength(2);
    expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });
});
