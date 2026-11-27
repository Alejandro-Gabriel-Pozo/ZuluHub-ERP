import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PantallaDeCartaEnLinea } from "./PantallaDeCartaEnLinea";
import { armarLaCartaEnLinea, type CartaEnLineaDeLaPantalla } from "./modelo-de-carta-en-linea";

/**
 * «Carta en línea» en Chromium (maqueta `carta-en-linea.html`): el estado y su botón, los tres campos y la identidad (cara, color y logo), la dirección con «Copiar» y «Descargar QR», el contador y los motivos; lo que pasa al tocar, el
 * doble toque (un solo envío), el error debajo, sin permiso, axe, tamaños y sin desborde en 390 y 1280 px.
 */
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';
const dato = (extra: Partial<CartaEnLineaDeLaPantalla> = {}): CartaEnLineaDeLaPantalla => ({
  carta: {
    id: "c-1",
    nombre: "Parador",
    rubro: "Parrilla",
    lugar: "Huinganco",
    estado: "FUERA_DE_LINEA",
    version: 3,
    cara: null,
    colorPropio: null,
    logo: null,
  },
  direccion: "https://app.ejemplo.test/CODIGO",
  qrSvg: SVG,
  salen: 12,
  faltan: { sinPrecio: 2, sinSeccion: 0, desactivados: 1, ocultos: 0 },
  ...extra,
});
const TODO = { guardar: true, poner: true, sacar: true };
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const pantalla = (
  d = dato(),
  oferta = TODO,
  guardar: AccionDeFormulario = ok,
  estado: AccionDeFormulario | null = ok,
) => (
  <PantallaDeCartaEnLinea
    carta={armarLaCartaEnLinea(d, oferta)}
    accionDeGuardar={guardar}
    accionDeEstado={d.carta === null ? null : estado}
  />
);

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("PantallaDeCartaEnLinea", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(pantalla());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("muestra el estado, «Poner en línea», los campos con sus valores, la dirección, «Descargar QR» (un SVG), el contador y los motivos", async () => {
    await render(pantalla());
    await expect.element(page.getByText("Fuera de línea")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Poner en línea" })).toBeEnabled();
    await expect.element(page.getByLabelText("Nombre")).toHaveValue("Parador");
    await expect.element(page.getByLabelText("Rubro")).toHaveValue("Parrilla");
    await expect.element(page.getByLabelText("Lugar")).toHaveValue("Huinganco");
    await expect.element(page.getByText("https://app.ejemplo.test/CODIGO")).toBeVisible();
    const descargar = page.getByRole("link", { name: "Descargar QR" });
    await expect.element(descargar).toHaveAttribute("download", "qr-de-la-carta.svg");
    expect(descargar.element().getAttribute("href")).toMatch(/^data:image\/svg\+xml/);
    await expect.element(page.getByText("Salen 12 productos")).toBeVisible();
    expect(document.body.textContent).toContain("Sin precio · 2");
    expect(document.body.textContent).toContain("No disponible");
    expect(document.querySelector("img[data-qr]")).not.toBeNull();
  });

  it("«Poner en línea» manda el envío; el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const envio = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(pantalla(dato(), TODO, ok, envio));
    const boton = page.getByRole("button", { name: "Poner en línea" });
    tocar(boton);
    await expect.element(boton).toHaveAttribute("aria-busy", "true");
    tocar(boton);
    tocar(boton);
    await vi.waitFor(() => expect(envio).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(boton).not.toHaveAttribute("aria-busy", "true");
    expect(envio).toHaveBeenCalledTimes(1);
  });

  it("el error de la acción sale debajo del botón y el de «Falta el nombre» sobre el campo", async () => {
    const rechazo: AccionDeFormulario = () =>
      Promise.resolve({
        error: {
          codigo: "CATALOGO_ACCION_NO_PERMITIDA",
          clave: "catalogo.error.accion_no_permitida",
          presentacion: "AVISO",
        },
      });
    await render(pantalla(dato(), TODO, ok, rechazo));
    await userEvent.click(page.getByRole("button", { name: "Poner en línea" }));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
  });

  it("sin permiso los botones salen apagados; con la carta en línea dice «Sacar de línea» y sin «No disponible»", async () => {
    const { unmount } = await render(
      pantalla(dato(), { guardar: false, poner: false, sacar: false }),
    );
    await expect.element(page.getByRole("button", { name: "Poner en línea" })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
    await unmount();
    await render(
      pantalla(
        dato({
          carta: {
            id: "c-1",
            nombre: "Parador",
            rubro: null,
            lugar: null,
            estado: "EN_LINEA",
            version: 4,
            cara: null,
            colorPropio: null,
            logo: null,
          },
        }),
      ),
    );
    await expect.element(page.getByRole("button", { name: "Sacar de línea" })).toBeEnabled();
    expect(document.body.textContent).not.toContain("No disponible");
  });

  it("sin carta: solo el formulario (sin estado, sin botón de línea y sin dirección)", async () => {
    await render(pantalla(dato({ carta: null, direccion: null, qrSvg: null })));
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(document.body.textContent).not.toContain("Poner en línea");
    expect(document.body.textContent).not.toContain("Dirección pública");
    await userEvent.fill(page.getByLabelText("Nombre"), "Mi carta");
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  it("«Copiar» avisa «Enlace copiado» solo si se pudo copiar", async () => {
    await render(pantalla());
    const copia = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: copia },
      configurable: true,
    });
    await userEvent.click(page.getByRole("button", { name: "Copiar" }));
    await vi.waitFor(() => expect(copia).toHaveBeenCalledWith("https://app.ejemplo.test/CODIGO"));
    await expect.element(page.getByText("Enlace copiado")).toBeVisible();
  });

  describe("modelo: Lista o Libro (DEC-CAT-004)", () => {
    it("ofrece Lista y Libro, parte del guardado y guardar manda el elegido", async () => {
      const envio = vi.fn((_previo: unknown, datos: FormData) => {
        void datos;
        return Promise.resolve({ error: null });
      });
      await render(pantalla(dato(), TODO, envio));
      await expect.element(page.getByRole("radio", { name: "Lista" })).toBeChecked();
      await expect.element(page.getByRole("radio", { name: "Libro" })).not.toBeChecked();
      await userEvent.click(page.getByRole("radio", { name: "Libro" }));
      await userEvent.click(page.getByRole("button", { name: "Guardar" }));
      await vi.waitFor(() => expect(envio).toHaveBeenCalledTimes(1));
      expect(envio.mock.calls[0]?.[1]?.get("modelo")).toBe("LIBRO");
    });

    it("sin permiso de editar el modelo sale apagado", async () => {
      await render(pantalla(dato(), { ...TODO, guardar: false }));
      await expect.element(page.getByRole("radio", { name: "Lista" })).toBeDisabled();
      await expect.element(page.getByRole("radio", { name: "Libro" })).toBeDisabled();
    });
  });

  describe("identidad: cara, color y logo", () => {
    const LOGO = "https://res.cloudinary.com/demo/image/upload/v1700000000/logos/parador.png";
    const conCarta = (extra: Partial<NonNullable<CartaEnLineaDeLaPantalla["carta"]>> = {}) =>
      dato({ carta: { ...dato().carta!, ...extra } });

    it("sin elegir: la cara de siempre, «Usar lo de la empresa» y el logo vacío; elegida: sus valores", async () => {
      const { unmount } = await render(pantalla());
      await expect.element(page.getByRole("radio", { name: "Día" })).toBeChecked();
      await expect.element(page.getByLabelText("Colores")).toHaveValue("");
      await expect.element(page.getByLabelText("Dirección de la imagen")).toHaveValue("");
      expect(document.body.textContent).not.toContain("Quitar");
      await unmount();
      await render(pantalla(conCarta({ cara: "BOLICHE", colorPropio: "#17562f", logo: LOGO })));
      await expect.element(page.getByRole("radio", { name: "Boliche" })).toBeChecked();
      await expect.element(page.getByLabelText("Colores")).toHaveValue("#17562f");
      await expect.element(page.getByLabelText("Dirección de la imagen")).toHaveValue(LOGO);
      await expect.element(page.getByRole("button", { name: "Quitar" })).toBeVisible();
    });

    it("un color que no es de las paletas se ve como «Otro color» con su valor", async () => {
      await render(pantalla(conCarta({ colorPropio: "#0e7490" })));
      await expect.element(page.getByLabelText("Colores")).toHaveValue("otro");
      await expect
        .element(page.getByLabelText("Otro color", { exact: true }))
        .toHaveValue("#0e7490");
    });

    it("«Otro color» mal escrito avisa «Escribí el color como #0e7490» y no deja guardar; bien escrito sí", async () => {
      await render(pantalla(conCarta()));
      await userEvent.selectOptions(page.getByLabelText("Colores"), "otro");
      const otro = page.getByLabelText("Otro color", { exact: true });
      await userEvent.fill(otro, "#12345");
      await expect.element(page.getByText("Escribí el color como #0e7490")).toBeVisible();
      await expect.element(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
      await userEvent.fill(otro, "#0e7490");
      expect(document.body.textContent).not.toContain("Escribí el color como #0e7490");
      await expect.element(page.getByRole("button", { name: "Guardar" })).toBeEnabled();
    });

    it("un color claro avisa «El texto no se lee bien sobre este color» y deja guardar (se guarda como se eligió)", async () => {
      await render(pantalla(conCarta()));
      await userEvent.selectOptions(page.getByLabelText("Colores"), "otro");
      await userEvent.fill(page.getByLabelText("Otro color", { exact: true }), "#808080");
      await expect
        .element(page.getByText("El texto no se lee bien sobre este color"))
        .toBeVisible();
      await expect.element(page.getByRole("button", { name: "Guardar" })).toBeEnabled();
      await userEvent.selectOptions(page.getByLabelText("Colores"), "#1f4e79");
      expect(document.body.textContent).not.toContain("El texto no se lee bien");
    });

    it("una dirección de logo que no sirve avisa «La dirección no sirve» y no deja guardar; «Quitar» la vacía", async () => {
      await render(pantalla(conCarta()));
      const campo = page.getByLabelText("Dirección de la imagen");
      await userEvent.fill(campo, "https://ejemplo.com/logo.png");
      await expect.element(page.getByText("La dirección no sirve")).toBeVisible();
      await expect.element(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
      await userEvent.click(page.getByRole("button", { name: "Quitar" }));
      await expect.element(campo).toHaveValue("");
      expect(document.body.textContent).not.toContain("La dirección no sirve");
      await expect.element(page.getByRole("button", { name: "Guardar" })).toBeEnabled();
    });

    it("sin permiso de editar los tres controles salen apagados", async () => {
      await render(
        pantalla(conCarta({ logo: LOGO }), { guardar: false, poner: false, sacar: false }),
      );
      await expect.element(page.getByRole("radio", { name: "Día" })).toBeDisabled();
      await expect.element(page.getByLabelText("Colores")).toBeDisabled();
      await expect.element(page.getByLabelText("Dirección de la imagen")).toBeDisabled();
      await expect.element(page.getByRole("button", { name: "Quitar" })).toBeDisabled();
    });

    it("guardar manda la cara, la paleta, el color propio y el logo elegidos", async () => {
      const envio = vi.fn((_previo: unknown, datos: FormData) => {
        void datos;
        return Promise.resolve({ error: null });
      });
      await render(pantalla(conCarta(), TODO, envio));
      await userEvent.click(page.getByRole("radio", { name: "Noche" }));
      await userEvent.selectOptions(page.getByLabelText("Colores"), "otro");
      await userEvent.fill(page.getByLabelText("Otro color", { exact: true }), "#0e7490");
      await userEvent.fill(page.getByLabelText("Dirección de la imagen"), LOGO);
      await userEvent.click(page.getByRole("button", { name: "Guardar" }));
      await vi.waitFor(() => expect(envio).toHaveBeenCalledTimes(1));
      const datos = envio.mock.calls[0]?.[1];
      expect(datos?.get("cara")).toBe("NOCHE");
      expect(datos?.get("paleta")).toBe("otro");
      expect(datos?.get("colorPropio")).toBe("#0e7490");
      expect(datos?.get("logo")).toBe(LOGO);
    });
  });
});
