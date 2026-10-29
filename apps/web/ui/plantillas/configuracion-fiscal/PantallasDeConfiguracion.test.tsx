import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { enArmazon, legibleYTocable, ventana } from "./ayudas-de-pruebas";
import { armarLaLista, type EstadoParaLaLista } from "./lista-de-lo-que-falta";
import { MigasDeConfiguracion } from "./MigasDeConfiguracion";
import { armarLaListaDePuntosDeVenta, type PuntoParaConfigurar } from "./modelo-de-puntos-de-venta";
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
const puntos = (items = PUNTOS) => (
  <PantallaDePuntosDeVenta
    migas={MIGAS}
    filas={armarLaListaDePuntosDeVenta(items)}
    ayuda="Tocá un punto de venta para editarlo, activarlo o desactivarlo."
    agregar={{
      texto: "Agregar punto de venta",
      href: "/configuracion-fiscal/puntos-de-venta/nuevo",
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
    await expect.element(page.getByText("Certificado de ARCA")).toBeVisible();
    expect(page.getByRole("link", { name: /Certificado de ARCA/ }).elements()).toHaveLength(0);
  });

  it("Tab recorre las filas con enlace en orden con el foco visible", async () => {
    await render(lista());
    const [primera, segunda] = [...document.querySelectorAll<HTMLElement>("a[href]")];
    await verificarFoco(primera as HTMLElement);
    await userEvent.tab();
    expect(document.activeElement).toBe(segunda);
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

  it("sin puntos de venta: solo «Agregar punto de venta», sin la ayuda de tocar uno", async () => {
    await render(puntos([]));
    await expect.element(page.getByRole("link", { name: "Agregar punto de venta" })).toBeVisible();
    expect(document.body.textContent).not.toContain("Tocá un punto de venta");
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
