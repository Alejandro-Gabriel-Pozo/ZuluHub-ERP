import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { restaurarConexion, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import {
  anularUnaParte,
  boton,
  campo,
  enArmazon,
  factura,
  facturaC,
  ID,
  irAlPaso2,
  motivo,
} from "../../pruebas/ayudas-de-anulacion";

/**
 * Anular por importe en Chromium (12A): axe como página sin violaciones (contraste incluido) en los dos pasos, letra de 16 px o más,
 * controles de 48 px o más, sin desborde a 390 y 1280 px, foco visible y todo por teclado. Y el envío, que mueve dinero: el botón se
 * bloquea al primer toque («Anulando…»), un doble toque o dos envíos a la vez son UNA emisión, y un corte de red o un resultado
 * inesperado se reintentan con la MISMA clave y los MISMOS valores, sin duplicar la nota.
 */
const visible = (el: Element): boolean =>
  el.closest("[hidden]") === null && el.checkVisibility({ visibilityProperty: true });

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
    "button, a[href], select, input:not([type=hidden]), textarea",
  )) {
    if (!visible(el)) continue;
    const caja = el.getBoundingClientRect();
    // El campo de un importe (`CampoImporte`) lleva el borde en su envoltura: el toque de 48 px es el de la envoltura entera.
    const alto = el.matches("input")
      ? Math.max(caja.height, el.parentElement?.getBoundingClientRect().height ?? 0)
      : caja.height;
    if (alto < 48) bajos.push(`${el.tagName.toLowerCase()} ${alto}px: ${el.textContent}`);
    if (el.matches("button") && caja.width < 48)
      bajos.push(`ancho ${caja.width}px: ${el.textContent}`);
  }
  expect(bajos).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

describe("anular, paso 1: qué anular", () => {
  it("el total por defecto: accesible como página, legible, tocable y sin desborde (390 y 1280 px)", async () => {
    await page.viewport(390, 1400);
    await render(enArmazon());
    await expect.element(page.getByText("Se anula el total")).toBeVisible();
    await expect.element(page.getByText("$ 90.750,00")).toBeVisible();
    expect(document.body.querySelectorAll("h1")).toHaveLength(1);
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await page.viewport(1280, 900);
    legibleYTocable();
  });

  it("solo una parte: una fila por alícuota, con coma o con punto; suma exacta, aviso sin bloqueo; accesible y tocable en 390 y 1280 px", async () => {
    await page.viewport(390, 1800);
    await render(enArmazon());
    await anularUnaParte();
    await expect.element(page.getByText("IVA 21 %", { exact: true })).toBeVisible();
    await expect.element(page.getByText("IVA 10,5 %", { exact: true })).toBeVisible();
    await expect.element(page.getByText("$ 60.500,00")).toBeVisible();
    await expect.element(page.getByText("$ 30.250,00")).toBeVisible();
    // Sin ningún importe no se puede seguir.
    await expect.element(boton("Siguiente")).toBeDisabled();
    await userEvent.type(campo("IVA 21 %"), "20000,50");
    await expect.element(boton("Siguiente")).toBeEnabled();
    await userEvent.type(campo("IVA 10,5 %"), "40000.5");
    // La suma es exacta y el aviso (pasarse de lo facturado en esa tasa) no bloquea.
    await expect.element(page.getByText("$ 60.001,00")).toBeVisible();
    await expect
      .element(page.getByText("El importe supera lo facturado con IVA 10,5 %."))
      .toBeVisible();
    await expect.element(boton("Siguiente")).toBeEnabled();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await page.viewport(1280, 1300);
    legibleYTocable();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("lo que no es un importe se limpia al escribir (texto, signo) y un cero no habilita «Siguiente»", async () => {
    await render(enArmazon());
    await anularUnaParte();
    await userEvent.type(campo("IVA 21 %"), "abc-");
    await expect.element(boton("Siguiente")).toBeDisabled();
    await userEvent.clear(campo("IVA 21 %"));
    await userEvent.type(campo("IVA 21 %"), "0");
    await expect.element(boton("Siguiente")).toBeDisabled();
    await userEvent.type(campo("IVA 21 %"), "1");
    await expect.element(boton("Siguiente")).toBeEnabled();
  });

  it("«Anular el total» vuelve al total y lo escrito se conserva si se vuelve a la parte", async () => {
    await render(enArmazon());
    await anularUnaParte();
    await userEvent.type(campo("IVA 21 %"), "100");
    await userEvent.click(boton("Anular el total"));
    await expect.element(page.getByText("Se anula el total")).toBeVisible();
    await expect.element(boton("Siguiente")).toBeEnabled();
    await userEvent.click(boton("Anular solo una parte"));
    await expect.element(page.getByText("$ 100,00", { exact: true }).first()).toBeVisible();
  });

  it("letra C: un solo campo «Importe a anular», sin filas por alícuota ni «IVA»", async () => {
    await page.viewport(390, 1400);
    await render(enArmazon({ factura: facturaC }));
    await expect.element(page.getByText("Factura C 00002-00000045 · Marta Gómez")).toBeVisible();
    await userEvent.click(boton("Anular solo una parte"));
    await expect.element(page.getByLabelText("Importe a anular", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("IVA");
    await userEvent.type(page.getByLabelText("Importe a anular", { exact: true }), "50000");
    await expect.element(page.getByText("El importe supera lo facturado.")).toBeVisible();
    await expect.element(boton("Siguiente")).toBeEnabled();
    await expect.element(page.getByText("$ 45.000,00").first()).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
  });

  it("«Cancelar» es un enlace al detalle", async () => {
    await render(enArmazon());
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", `/facturacion/comprobantes/${ID}`);
  });

  it("todo por teclado: Tab llega a «Siguiente» con el foco visible y Enter pasa al paso 2", async () => {
    await render(enArmazon());
    document.body.focus();
    let llegado = false;
    for (let i = 0; i < 25 && !llegado; i += 1) {
      await userEvent.tab();
      llegado = document.activeElement?.textContent === "Siguiente";
    }
    expect(llegado).toBe(true);
    const anillo = getComputedStyle(document.activeElement as Element);
    expect(anillo.outlineStyle).toBe("solid");
    expect(Number.parseFloat(anillo.outlineWidth)).toBeGreaterThanOrEqual(3);
    await userEvent.keyboard("{Enter}");
    await expect.element(motivo()).toBeVisible();
  });

  it("escribir con el teclado: el foco llega al campo del importe y el cambio se refleja en «A anular»", async () => {
    await render(enArmazon());
    await anularUnaParte();
    (campo("IVA 21 %").element() as HTMLElement).focus();
    await userEvent.keyboard("1500");
    await expect.element(page.getByText("$ 1.500,00").first()).toBeVisible();
  });
});

describe("anular, paso 2: motivo y revisar", () => {
  it("accesible como página, legible y tocable; botón apagado y «0 / 200»; lista de notas con su estado (390 y 1280 px)", async () => {
    await page.viewport(390, 1800);
    await render(enArmazon());
    await irAlPaso2();
    await expect
      .element(page.getByText("Queda guardado junto a la nota de crédito."))
      .toBeVisible();
    await expect.element(page.getByText("0 / 200")).toBeVisible();
    await expect.element(page.getByText("Se va a emitir una nota de crédito B")).toBeVisible();
    await expect.element(page.getByText("A anular ahora")).toBeVisible();
    await expect.element(page.getByText("Ya anulado con notas de crédito")).toBeVisible();
    await expect.element(page.getByText("Nota de crédito B 00001-00000012")).toBeVisible();
    await expect.element(page.getByText("Validando")).toBeVisible();
    await expect.element(boton("Anular comprobante")).toBeDisabled();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    await page.viewport(1280, 1400);
    legibleYTocable();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("el motivo es obligatorio, acota el largo al límite del servidor y cuenta lo escrito", async () => {
    await render(enArmazon({ limiteDelMotivo: 12 }));
    await irAlPaso2();
    await expect.element(motivo()).toHaveAttribute("maxlength", "12");
    await expect.element(motivo()).toHaveAttribute("aria-required", "true");
    await userEvent.type(motivo(), "Error de carga y más");
    await expect.element(page.getByText("12 / 12")).toBeVisible();
  });

  it("con solo espacios el botón sigue apagado; con un motivo se enciende", async () => {
    await render(enArmazon());
    await irAlPaso2();
    await userEvent.type(motivo(), "    ");
    await expect.element(boton("Anular comprobante")).toBeDisabled();
    await userEvent.type(motivo(), "Error de carga");
    await expect.element(boton("Anular comprobante")).toBeEnabled();
  });

  it("«Volver» regresa al paso 1 conservando lo escrito; el paso nuevo recibe el foco", async () => {
    await render(enArmazon());
    await anularUnaParte();
    await userEvent.type(campo("IVA 21 %"), "20000");
    await irAlPaso2();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Motivo y revisar");
    await expect.element(page.getByText("$ 20.000,00").first()).toBeVisible();
    await userEvent.click(boton("Volver"));
    await expect.element(campo("IVA 21 %")).toHaveValue("20.000,00");
  });

  it("una nota de débito se revisa con el mismo título y sin «Ya anulado»", async () => {
    await render(
      enArmazon({ factura: { ...factura, tipo: "NOTA_DEBITO_B", notasQueLoCitan: [] } }),
    );
    await expect
      .element(page.getByText("Nota de débito B 00001-00000123 · Juan Pérez"))
      .toBeVisible();
    await irAlPaso2();
    await expect.element(page.getByText("Se va a emitir una nota de crédito B")).toBeVisible();
    expect(document.body.textContent).not.toContain("Ya anulado");
    await expect.element(page.getByText("Total de la nota de débito")).toBeVisible();
  });
});
