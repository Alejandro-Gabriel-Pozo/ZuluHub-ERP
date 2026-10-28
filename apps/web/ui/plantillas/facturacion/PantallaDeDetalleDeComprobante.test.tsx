import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { DetalleParaMostrar } from "./modelo-del-detalle";
import { PantallaDeDetalleDeComprobante } from "./PantallaDeDetalleDeComprobante";

/**
 * El detalle de un comprobante en Chromium con el viewport del celular: axe sin violaciones (contraste incluido) y los
 * criterios de legibilidad del dueño: nada por debajo de 16 px, base de 18 px, importes de 18 px con peso 600 o más y el
 * total final de 22 px o más, sin desborde lateral.
 */
const autorizada: DetalleParaMostrar = {
  tipo: "FACTURA_B",
  estado: "AUTORIZADO",
  numero: "00001-00001234",
  fechaEmision: "2026-10-14",
  cae: "74123456789012",
  caeVence: "2026-10-24",
  importes: { total: "9000.00" },
  renglones: [
    {
      descripcion:
        "Medialunas (docena) con una descripción larga para probar el corte de línea en el celular",
      cantidad: "2.0000",
      precioUnitario: "4500.000000",
      alicuota: "21",
      importe: "9000.00",
    },
  ],
  emisor: { puntoDeVentaNumero: 1 },
  receptor: { nombre: "Panadería Sol SRL", documento: { tipo: "CUIT", numero: "30712345678" } },
  asociado: null,
  motivoDeDescarte: null,
  notasQueLoCitan: [
    {
      id: "n1",
      tipo: "NOTA_CREDITO_B",
      numero: "00001-00000045",
      total: "4500.00",
      estado: "AUTORIZADO",
    },
  ],
  acreditado: "4500.00",
  acreditacion: "PARCIAL",
  ultimoIntento: null,
};

const rechazada: DetalleParaMostrar = {
  ...autorizada,
  estado: "RECHAZADO",
  numero: null,
  fechaEmision: null,
  acreditacion: null,
  ultimoIntento: { mensajes: [{ clave: "fiscal.arca.receptor_para_a" }] },
};

const tamano = (el: Element): number => Number.parseFloat(getComputedStyle(el).fontSize);

function ancho(el: Element | null): number {
  return el === null ? 0 : el.getBoundingClientRect().width;
}

describe("detalle de un comprobante en el celular", () => {
  it.each([
    ["autorizada con notas", autorizada],
    ["rechazada", rechazada],
  ])("%s: sin violaciones de accesibilidad y sin letra de menos de 16 px", async (_n, detalle) => {
    await render(<PantallaDeDetalleDeComprobante detalle={detalle} />);
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    const chicos: string[] = [];
    for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
      const tieneTexto = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
      );
      if (tieneTexto && tamano(el) < 16) chicos.push(`${el.tagName} ${tamano(el)}px`);
    }
    expect(chicos).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    expect(document.body.querySelectorAll("button, a[href]")).toHaveLength(0);
  });

  it("importes de 18 px con peso 600 o más y total final de 22 px o más", async () => {
    await render(<PantallaDeDetalleDeComprobante detalle={autorizada} />);
    const importes = [...document.body.querySelectorAll<HTMLElement>("span, p")].filter(
      (el) => /^\$ /.test(el.textContent ?? "") && el.children.length === 0,
    );
    expect(importes.length).toBeGreaterThanOrEqual(3);
    for (const el of importes) {
      expect(tamano(el), el.textContent ?? "").toBeGreaterThanOrEqual(18);
      expect(Number(getComputedStyle(el).fontWeight), el.textContent ?? "").toBeGreaterThanOrEqual(
        600,
      );
    }
    const total = [...document.body.querySelectorAll<HTMLElement>("p")].find((p) =>
      (p.textContent ?? "").startsWith("Total"),
    );
    expect(total).toBeDefined();
    expect(tamano(total as HTMLElement)).toBeGreaterThanOrEqual(22);
    expect(ancho(document.body.querySelector("article"))).toBeLessThanOrEqual(window.innerWidth);
  });
});
