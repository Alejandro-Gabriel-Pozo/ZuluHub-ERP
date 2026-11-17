import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import {
  comprobanteDePrueba,
  QR_DE_PRUEBA,
  reglaDePaginaAdoptada,
  reglasAdoptadas,
  type OpcionesDelComprobante,
} from "./ayudas-de-impresion";
import { ComprobanteImpreso } from "./ComprobanteImpreso.cliente";
import { ANCHO_TICKET_MM, mmAPx, pxAMm } from "./geometria";

/**
 * El ticket de 80 mm en Chromium real: sin hojas, 80 mm de ancho, con su alto medido y puesto en `@page` (Chromium no respeta `size: 80mm
 * auto`), con el título de transparencia del rollo y el QR entero. No se prueba una impresora térmica: ver el informe.
 */

async function dibujar(opciones: OpcionesDelComprobante = {}) {
  const pantalla = await render(
    <div style={{ width: 360 }}>
      <ComprobanteImpreso
        comprobante={comprobanteDePrueba(opciones)}
        qrSvg={QR_DE_PRUEBA}
        formato="TICKET"
      />
    </div>,
  );
  await expect.poll(reglaDePaginaAdoptada).toMatch(/@page \{ size: 80mm \d+mm; margin: 0px; \}/);
  const ticket = document.querySelector<HTMLElement>("[data-ticket]");
  if (ticket === null) throw new Error("no hay ticket");
  return { ticket, pantalla };
}

describe("ticket de 80 mm", () => {
  it("leyenda de la condición del receptor: sale en el rollo, sin rótulo y tal cual", async () => {
    const LEYENDA = "LEYENDA DE CONDICIÓN DE PRUEBA";
    const { ticket, pantalla } = await dibujar({
      letra: "A",
      consumidorFinal: false,
      leyendaDeCondicion: LEYENDA,
    });
    const filas = [...ticket.querySelectorAll("div")].filter((d) => d.textContent === LEYENDA);
    expect(filas.length).toBeGreaterThan(0);
    await pantalla.unmount();
  });

  it("leyenda legal: texto normal después del aviso de homologación, fuera de su recuadro, tal cual y dentro del alto medido; sin ella no hay nada extra", async () => {
    const LEGAL = "  Texto legal de prueba (ficticio).  ";
    const medido = () => Number(/size: 80mm (\d+)mm/.exec(reglaDePaginaAdoptada())?.[1]);
    const sin = await dibujar({ leyendas: ["HOMOLOGACIÓN — SIN VALIDEZ FISCAL"] });
    expect(sin.ticket.querySelectorAll("[data-leyenda-legal]")).toHaveLength(0);
    const altoSin = medido();
    const pxSin = sin.ticket.offsetHeight;
    await sin.pantalla.unmount();
    const { ticket, pantalla } = await dibujar({
      leyendas: ["HOMOLOGACIÓN — SIN VALIDEZ FISCAL"],
      leyendasLegales: [LEGAL],
    });
    const legal = ticket.querySelector<HTMLElement>("[data-leyenda-legal]");
    expect(legal?.textContent).toBe(LEGAL);
    const recuadro = [...ticket.children].find((e) =>
      (e.textContent ?? "").includes("HOMOLOGACIÓN"),
    );
    expect(recuadro?.contains(legal ?? null)).toBe(false);
    expect(recuadro?.nextElementSibling).toBe(legal);
    const estilo = getComputedStyle(legal as Element);
    expect(estilo.borderTopWidth).toBe("0px");
    expect(Number(estilo.fontWeight)).toBeLessThan(600);
    expect(ticket.offsetHeight).toBeGreaterThan(pxSin);
    const rT = ticket.getBoundingClientRect();
    const rL = (legal as Element).getBoundingClientRect();
    expect(rL.bottom).toBeLessThanOrEqual(rT.bottom);
    await expect.poll(medido).toBeGreaterThanOrEqual(pxAMm(ticket.offsetHeight));
    expect(medido()).toBeGreaterThanOrEqual(altoSin);
    await pantalla.unmount();
  });

  it("sin hojas, de 80 mm de ancho y con su alto medido en @page (más largo que el contenido, nunca `auto`)", async () => {
    const { ticket, pantalla } = await dibujar({ renglones: 40, descripcionesLargas: true });
    expect(document.querySelectorAll("[data-hoja]")).toHaveLength(0);
    expect(document.querySelector("[data-medidor]")).toBeNull();
    expect(Math.abs(ticket.offsetWidth - mmAPx(ANCHO_TICKET_MM))).toBeLessThanOrEqual(1);
    const regla = reglaDePaginaAdoptada();
    expect(regla).not.toContain("auto");
    expect(regla).not.toContain("A4");
    const alto = Number(/size: 80mm (\d+)mm/.exec(regla)?.[1]);
    expect(alto).toBeGreaterThanOrEqual(pxAMm(ticket.offsetHeight));
    expect(alto).toBeLessThanOrEqual(pxAMm(ticket.offsetHeight) + 4);
    // El contenido crece con los renglones: el alto de @page también.
    await pantalla.unmount();
    const corto = await dibujar({ renglones: 2 });
    const altoCorto = Number(/size: 80mm (\d+)mm/.exec(reglaDePaginaAdoptada())?.[1]);
    expect(altoCorto).toBeLessThan(alto);
    await corto.pantalla.unmount();
  });

  it("factura B a consumidor final: título de transparencia del rollo y una fila de IVA contenido por alícuota", async () => {
    const { ticket } = await dibujar({ letra: "B" });
    const bloque = ticket.querySelector("[data-transparencia]");
    expect(bloque?.textContent).toContain("TRANSPARENCIA FISCAL");
    expect(bloque?.textContent).not.toContain("Régimen");
    expect(bloque?.textContent).toContain("IVA Contenido 21 %");
    expect(bloque?.textContent).toContain("Otros Impuestos Nacionales Indirectos");
    expect(ticket.textContent).toContain("A CONSUMIDOR FINAL");
    expect(ticket.textContent).toContain("COD. 006");
  });

  it("la A lleva el neto por alícuota y la C no lleva transparencia", async () => {
    const a = await dibujar({ letra: "A" });
    expect(a.ticket.textContent).toContain("Neto gravado 21 %");
    expect(a.ticket.querySelector("[data-transparencia]")).toBeNull();
    await a.pantalla.unmount();
    const c = await dibujar({ letra: "C" });
    expect(c.ticket.querySelector("[data-transparencia]")).toBeNull();
    expect(c.ticket.textContent).toContain("COD. 011");
  });

  it("el CAE con su vencimiento y el QR enteros dentro del ticket; una nota de crédito dice a qué corresponde", async () => {
    const { ticket } = await dibujar({
      notaDeCredito: true,
      leyendas: ["HOMOLOGACIÓN — SIN VALIDEZ FISCAL"],
      contacto: true,
    });
    const qr = ticket.querySelector("img[data-qr]");
    const rTicket = ticket.getBoundingClientRect();
    const rQr = (qr as Element).getBoundingClientRect();
    expect(rQr.left).toBeGreaterThanOrEqual(rTicket.left);
    expect(rQr.right).toBeLessThanOrEqual(rTicket.right);
    expect(rQr.bottom).toBeLessThanOrEqual(rTicket.bottom);
    expect(ticket.scrollWidth).toBeLessThanOrEqual(ticket.clientWidth);
    expect(ticket.textContent).toContain("70417054367476 · vence 23/10/2026");
    expect(ticket.textContent).toContain("Corresponde a FACTURA B 00001-00000007 del 01/10/2026");
    expect(ticket.textContent).toContain("HOMOLOGACIÓN — SIN VALIDEZ FISCAL");
    expect(ticket.textContent).toContain("011 5555-0100 · hola@zulu.example · www.zulu.example");
  });

  it("axe sin violaciones y la hoja de estilos de @page se quita al desmontar", async () => {
    const { pantalla } = await dibujar({ renglones: 10 });
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    await pantalla.unmount();
    expect(reglasAdoptadas()).toBe("");
    expect(document.adoptedStyleSheets).toHaveLength(0);
  });
});
