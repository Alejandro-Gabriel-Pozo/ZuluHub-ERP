import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { restaurarConexion, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import {
  alPaso2,
  boton,
  campo,
  enArmazon,
  escribirRenglon,
  legibleYTocable,
  llegarARevisar,
  PUNTO_1,
  PUNTO_2_PRUEBAS,
} from "../../pruebas/ayudas-de-emision";

/**
 * Emitir una factura (8B, por pasos) en Chromium: axe como página sin violaciones (contraste incluido) en los tres pasos, letra de 16 px o
 * más, controles de 48 px o más, sin desborde a 390 y 1280 px, el foco que sigue a la persona de un paso al otro y todo por teclado.
 * El envío (doble toque, corte de red, errores) está en `PantallaDeEmitirFactura.envio.test.tsx`.
 */

afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

/** Accesible y tocable en el celular y en el escritorio. */
async function enLosDosAnchos(alto = 1600): Promise<void> {
  await page.viewport(390, alto);
  expect(document.body.querySelectorAll("h1")).toHaveLength(1);
  expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  legibleYTocable();
  await page.viewport(1280, 1100);
  expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  legibleYTocable();
}

/** Pega `texto` sin tocar el portapapeles real: lanza el evento `paste` y, si el campo no lo cancela, lo inserta como lo haría el navegador. */
async function pegarEn(destino: ReturnType<typeof campo>, texto: string): Promise<void> {
  const datos = new DataTransfer();
  datos.setData("text/plain", texto);
  const evento = new ClipboardEvent("paste", {
    clipboardData: datos,
    bubbles: true,
    cancelable: true,
  });
  destino.element().dispatchEvent(evento);
  if (!evento.defaultPrevented) await userEvent.fill(destino, texto);
}

describe("paso 1: cliente", () => {
  it("el consumidor final por defecto: un solo selector, «Siguiente» siempre ofrecido; accesible y tocable (390 y 1280 px)", async () => {
    await render(enArmazon());
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Emitir factura");
    await expect.element(campo("Documento")).toHaveValue("SIN_IDENTIFICAR");
    // Los tres pasos, el primero marcado como el actual, con número y texto (no solo color).
    const pasos = page.getByRole("listitem").elements();
    expect(pasos.map((p) => p.textContent.trim()).slice(0, 3)).toEqual([
      "1 Cliente",
      "2 Renglones",
      "3 Revisar",
    ]);
    expect(pasos[0]?.getAttribute("aria-current")).toBe("step");
    // Sin documento no se pide número, nombre ni condición.
    expect(document.body.querySelectorAll("input")).toHaveLength(0);
    await expect.element(boton("Siguiente")).toBeEnabled();
    await expect.element(boton("Volver")).not.toBeInTheDocument();
    await enLosDosAnchos();
  });

  it("con un documento pide su número (rotulado con el tipo), el nombre y la condición frente al IVA; accesible y tocable", async () => {
    await render(enArmazon());
    await userEvent.selectOptions(campo("Documento"), "CUIT");
    await expect.element(campo("CUIT")).toBeVisible();
    await expect.element(campo("Nombre o razón social")).toBeVisible();
    await expect.element(campo("Condición frente al IVA")).toBeVisible();
    // La condición arranca sin elegir y ofrece las once de ARCA.
    await expect.element(campo("Condición frente al IVA")).toHaveValue("");
    expect(campo("Condición frente al IVA").element().querySelectorAll("option")).toHaveLength(12);
    // Cambiar el tipo cambia el rótulo del número y LIMPIA lo escrito: cada tipo tiene su forma y no se adivina (un CUIT recortado a DNI
    // sería un documento válido pero equivocado).
    await userEvent.type(campo("CUIT"), "30712345678");
    await expect.element(campo("CUIT")).toHaveValue("30-71234567-8");
    await userEvent.selectOptions(campo("Documento"), "DNI");
    await expect.element(campo("DNI")).toHaveValue("");
    await enLosDosAnchos();
  });

  it("el número del documento se formatea mientras se escribe: guiones del CUIT, puntos del DNI y el pasaporte en mayúsculas", async () => {
    await render(enArmazon());
    await userEvent.selectOptions(campo("Documento"), "CUIT");
    await userEvent.type(campo("CUIT"), "30-7123.4567 8x");
    await expect.element(campo("CUIT")).toHaveValue("30-71234567-8");
    await userEvent.selectOptions(campo("Documento"), "DNI");
    await userEvent.type(campo("DNI"), "0");
    await expect.element(campo("DNI")).toHaveValue("");
    await userEvent.type(campo("DNI"), "12345678");
    await expect.element(campo("DNI")).toHaveValue("12.345.678");
    await expect.element(campo("DNI")).toHaveAttribute("inputmode", "numeric");
    await userEvent.selectOptions(campo("Documento"), "PASAPORTE");
    await userEvent.type(campo("Pasaporte"), "abc-123 456");
    await expect.element(campo("Pasaporte")).toHaveValue("ABC123456");
    await expect.element(campo("Pasaporte")).toHaveAttribute("inputmode", "text");
  });

  it("pegar: con o sin guiones entra; lo que no es del tipo no cambia el campo", async () => {
    await render(enArmazon());
    await userEvent.selectOptions(campo("Documento"), "CUIT");
    const cuit = campo("CUIT");
    await userEvent.click(cuit);
    await pegarEn(cuit, "20123456786");
    await expect.element(cuit).toHaveValue("20-12345678-6");
    await userEvent.clear(cuit);
    await pegarEn(cuit, "20-12345678-6");
    await expect.element(cuit).toHaveValue("20-12345678-6");
    await userEvent.clear(cuit);
    for (const rechazado of ["20.12345678.6", "20 12345678 6", "abc", "2012345678600"]) {
      await pegarEn(cuit, rechazado);
      await expect.element(cuit).toHaveValue("");
    }
  });

  it("el cursor no salta al formatear y borrar un guion no cambia el número", async () => {
    await render(enArmazon());
    await userEvent.selectOptions(campo("Documento"), "CUIT");
    const cuit = campo("CUIT");
    const el = cuit.element() as HTMLInputElement;
    await userEvent.type(cuit, "2012");
    await expect.element(cuit).toHaveValue("20-12");
    // Un dígito en el medio: el cursor queda detrás de él, no al final.
    el.setSelectionRange(1, 1);
    await userEvent.keyboard("9");
    await expect.element(cuit).toHaveValue("29-012");
    expect(el.selectionStart).toBe(2);
    // Retroceso con el cursor detrás del guion: el número no cambia.
    el.setSelectionRange(3, 3);
    await userEvent.keyboard("{Backspace}");
    await expect.element(cuit).toHaveValue("29-012");
  });

  it("volver a «Consumidor final» esconde los campos", async () => {
    await render(enArmazon());
    await userEvent.selectOptions(campo("Documento"), "DNI");
    await expect.element(campo("DNI")).toBeVisible();
    await userEvent.selectOptions(campo("Documento"), "SIN_IDENTIFICAR");
    expect(document.body.querySelectorAll("input")).toHaveLength(0);
  });
});

describe("paso 2: renglones", () => {
  it("un renglón con IVA: descripción, cantidad (1), «Precio con IVA» e «IVA»; «Siguiente» espera un precio; accesible y tocable", async () => {
    await render(enArmazon());
    await alPaso2();
    const grupo = page.getByRole("group", { name: "Renglón 1" });
    await expect.element(grupo.getByLabelText("Cantidad")).toHaveValue("1");
    await expect.element(grupo.getByLabelText(/^Precio con IVA/)).toBeVisible();
    await expect.element(grupo.getByLabelText("IVA", { exact: true })).toBeVisible();
    // Con un solo renglón no hay nada que quitar.
    await expect.element(page.getByRole("button", { name: /^Quitar/ })).not.toBeInTheDocument();
    await expect.element(boton("Siguiente")).toBeDisabled();
    await userEvent.type(grupo.getByLabelText(/^Precio con IVA/), "4500");
    await expect.element(boton("Siguiente")).toBeEnabled();
    await enLosDosAnchos();
  });

  it("sin IVA (letra C): ni «IVA» ni «con IVA»", async () => {
    await render(enArmazon({ discriminaIva: false }));
    await alPaso2();
    const grupo = page.getByRole("group", { name: "Renglón 1" });
    await expect.element(grupo.getByLabelText("Precio", { exact: true })).toBeVisible();
    await expect.element(grupo.getByLabelText("IVA", { exact: true })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("con IVA");
  });

  it("la cantidad se limpia al escribir (coma decimal, nada de letras) y una cantidad vacía no deja seguir", async () => {
    await render(enArmazon());
    await alPaso2();
    const grupo = page.getByRole("group", { name: "Renglón 1" });
    const cantidad = grupo.getByLabelText("Cantidad");
    await userEvent.type(grupo.getByLabelText(/^Precio con IVA/), "100");
    await userEvent.clear(cantidad);
    await expect.element(boton("Siguiente")).toBeDisabled();
    await userEvent.type(cantidad, "2,5abc");
    await expect.element(cantidad).toHaveValue("2,5");
    await expect.element(boton("Siguiente")).toBeEnabled();
  });

  it("agregar y quitar renglones: cada uno se numera, «Quitar» aparece con más de uno y no hay tope de la pantalla", async () => {
    await render(enArmazon());
    await alPaso2();
    await userEvent.click(boton("+ Agregar renglón"));
    await expect.element(page.getByRole("group", { name: "Renglón 2" })).toBeVisible();
    await escribirRenglon(2, { descripcion: "Café", precio: "1000" });
    await expect.element(boton("Quitar renglón 1")).toBeVisible();
    await userEvent.click(boton("Quitar renglón 1"));
    // Queda el segundo, renumerado como «Renglón 1», con lo que se escribió.
    await expect.element(page.getByRole("group", { name: "Renglón 2" })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("group", { name: "Renglón 1" }).getByLabelText("Descripción"))
      .toHaveValue("Café");
    await expect.element(boton("Quitar renglón 1")).not.toBeInTheDocument();
  });

  it("con varios renglones, accesible y tocable", async () => {
    await render(enArmazon());
    await alPaso2();
    await userEvent.click(boton("+ Agregar renglón"));
    await userEvent.click(boton("+ Agregar renglón"));
    await enLosDosAnchos(2600);
  });
});

describe("paso 3: revisar", () => {
  it("el cliente, el renglón con su cuenta, el IVA y su importe, el total y el punto de venta; sin la letra; accesible y tocable", async () => {
    await render(enArmazon());
    await llegarARevisar("dni");
    const texto = document.body.textContent;
    for (const esperado of [
      "Revisá y emití",
      "Juan Pérez",
      "DNI 27.345.678",
      "Medialunas (docena)",
      "2 × $ 4.500,00 · IVA 21 %",
      "$ 9.000,00",
      "Total",
      "Punto de venta",
      "00001",
    ]) {
      expect(texto).toContain(esperado);
    }
    expect(texto).not.toMatch(/Factura [ABC]|letra/i);
    // El único punto de venta se usa solo: no hay selector. No es de pruebas: sin marca ni aviso.
    expect(document.body.querySelectorAll("select")).toHaveLength(0);
    expect(texto).not.toContain("Pruebas");
    await expect.element(boton("Emitir factura")).toBeEnabled();
    await enLosDosAnchos();
  });

  it("el consumidor final se ve como «Consumidor final», sin documento", async () => {
    await render(enArmazon());
    await llegarARevisar("consumidor");
    const tarjeta = page.getByRole("region", { name: "Cliente" });
    await expect.element(tarjeta).toBeVisible();
    expect(tarjeta.element().textContent).toContain("Consumidor final");
    expect(tarjeta.element().textContent).not.toMatch(/DNI|CUIT/);
  });

  it("un punto de venta de pruebas se marca y avisa que la factura no tiene valor fiscal (D-87); accesible y tocable", async () => {
    await render(enArmazon({ puntosDeVenta: [PUNTO_2_PRUEBAS] }));
    await llegarARevisar();
    await expect.element(page.getByText("00002 · Pruebas")).toBeVisible();
    await expect
      .element(page.getByText("Las facturas de pruebas no tienen valor fiscal."))
      .toBeVisible();
    await enLosDosAnchos();
  });

  it("varios puntos de venta: se eligen (no se toma el primero), «Emitir» espera la elección y el de pruebas se marca al elegirlo", async () => {
    await render(enArmazon({ puntosDeVenta: [PUNTO_1, PUNTO_2_PRUEBAS] }));
    await llegarARevisar();
    const selector = page.getByRole("combobox", { name: "Punto de venta" });
    await expect.element(selector).toHaveValue("");
    await expect.element(boton("Emitir factura")).toBeDisabled();
    expect([...selector.element().querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Punto de venta",
      "00001",
      "00002 · Pruebas",
    ]);
    await userEvent.selectOptions(selector, PUNTO_1.id);
    await expect.element(boton("Emitir factura")).toBeEnabled();
    expect(document.body.textContent).not.toContain("no tienen valor fiscal");
    await userEvent.selectOptions(selector, PUNTO_2_PRUEBAS.id);
    await expect
      .element(page.getByText("Las facturas de pruebas no tienen valor fiscal."))
      .toBeVisible();
    await enLosDosAnchos();
  });

  it("ningún punto de venta activo: «Ninguno activo» y no se puede emitir", async () => {
    await render(enArmazon({ puntosDeVenta: [] }));
    await llegarARevisar();
    await expect.element(page.getByText("Ninguno activo")).toBeVisible();
    await expect.element(boton("Emitir factura")).toBeDisabled();
    await enLosDosAnchos();
  });
});

describe("navegar entre pasos", () => {
  it("«Siguiente» y «Volver» llevan el foco a la sección del paso nuevo y no pierden lo escrito", async () => {
    await render(enArmazon());
    await userEvent.selectOptions(campo("Documento"), "DNI");
    await userEvent.type(campo("DNI"), "27345678");
    await userEvent.type(campo("Nombre o razón social"), "Juan Pérez");
    await userEvent.selectOptions(campo("Condición frente al IVA"), "CONSUMIDOR_FINAL");
    await alPaso2();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Renglones");
    await escribirRenglon(1, { descripcion: "Café", precio: "1000", iva: "21" });
    await userEvent.click(boton("Siguiente"));
    await expect.element(page.getByText("Revisá y emití")).toBeVisible();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Revisar");
    await userEvent.click(boton("Volver"));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Renglones");
    await expect
      .element(page.getByRole("group", { name: "Renglón 1" }).getByLabelText("Descripción"))
      .toHaveValue("Café");
    await userEvent.click(boton("Volver"));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Cliente");
    await expect.element(campo("Nombre o razón social")).toHaveValue("Juan Pérez");
    await expect.element(campo("DNI")).toHaveValue("27.345.678");
  });

  it("todo se hace con el teclado: Tab llega a cada control, Enter avanza y retrocede", async () => {
    await render(enArmazon());
    const siguiente = boton("Siguiente").element() as HTMLElement;
    // En el paso 1 sin documento hay un solo campo y después, «Siguiente».
    (campo("Documento").element() as HTMLElement).focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(siguiente);
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("region", { name: "Renglones" })).toBeVisible();
    // En el paso 2 se escribe sin ratón: Tab pasa de la descripción a la cantidad, al precio y al IVA.
    const grupo = page.getByRole("group", { name: "Renglón 1" });
    (grupo.getByLabelText("Descripción").element() as HTMLElement).focus();
    await userEvent.keyboard("Café");
    await userEvent.tab();
    expect(document.activeElement).toBe(grupo.getByLabelText("Cantidad").element());
    await userEvent.tab();
    expect(document.activeElement).toBe(grupo.getByLabelText(/^Precio con IVA/).element());
    await userEvent.keyboard("1000");
    await userEvent.tab();
    expect(document.activeElement).toBe(grupo.getByLabelText("IVA", { exact: true }).element());
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.tab();
    // Siguiente botón: «+ Agregar renglón», luego «Siguiente».
    expect(document.activeElement?.textContent).toBe("+ Agregar renglón");
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Volver");
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Siguiente");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("Revisá y emití")).toBeVisible();
  });
});
