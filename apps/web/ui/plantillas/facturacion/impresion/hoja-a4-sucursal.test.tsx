import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import {
  comprobanteDePrueba,
  esperarLasHojas,
  QR_DE_PRUEBA,
  type OpcionesDelComprobante,
} from "./ayudas-de-impresion";
import { ComprobanteImpreso } from "./ComprobanteImpreso.cliente";
import { armarLaHoja } from "./modelo-de-la-hoja";
import { EncabezadoDeHoja } from "./PiezasDeLaHoja";

/**
 * El nombre de la sucursal (D-114) en el A4 y en el ticket, en Chromium real: arriba de las filas del emisor (la razón social queda
 * debajo), sin rótulo, tal cual, con el mismo estilo del título del emisor y dentro de lo medido. Un nombre largo no se sale.
 */

const NOMBRE = "  Sucursal  Ñandú Centro  ";
const MARCA = "La Panadería de Zulu";
const LARGO = "Sucursal".padEnd(100, "x");

async function dibujarA4(opciones: OpcionesDelComprobante) {
  const pantalla = await render(
    <div style={{ width: 360 }}>
      <ComprobanteImpreso
        comprobante={comprobanteDePrueba(opciones)}
        qrSvg={QR_DE_PRUEBA}
        formato="A4"
      />
    </div>,
  );
  return { hojas: await esperarLasHojas(), pantalla };
}

async function dibujarTicket(opciones: OpcionesDelComprobante) {
  const pantalla = await render(
    <div style={{ width: 360 }}>
      <ComprobanteImpreso
        comprobante={comprobanteDePrueba(opciones)}
        qrSvg={QR_DE_PRUEBA}
        formato="TICKET"
      />
    </div>,
  );
  await expect.poll(() => document.querySelector("[data-ticket]")).not.toBeNull();
  await expect
    .poll(() => document.querySelector("style[data-estilo-de-pagina]")?.textContent)
    .toMatch(/@page\{size:80mm \d+mm;margin:0\}/);
  const ticket = document.querySelector<HTMLElement>("[data-ticket]");
  if (ticket === null) throw new Error("no hay ticket");
  return { ticket, pantalla };
}

/** El elemento de la fila «Razón social»: el que contiene el texto de la razón social del comprobante de prueba. */
const filaRazonSocial = (raiz: Element): Element => {
  const fila = [...raiz.querySelectorAll("div")].find(
    (d) => d.children.length <= 1 && (d.textContent ?? "").includes("Panadería Zulu SRL"),
  );
  if (fila === undefined) throw new Error("no hay fila de razón social");
  return fila;
};

const antes = (a: Element, b: Element): boolean =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

/** Primera línea del bloque del emisor: la marca (el comprobante de prueba la trae) y recién después la sucursal. */
function expectMarcaYDespuesSucursal(s: Element): void {
  const marca = s.previousElementSibling;
  expect(marca?.textContent).toBe(MARCA);
  expect(marca?.previousElementSibling).toBeNull();
  expect(marca?.className).toBe(s.className);
}

describe("hoja A4: nombre de la sucursal", () => {
  it("aparece en el encabezado medido de CADA hoja, arriba de la razón social, tal cual y sin rótulo", async () => {
    const { hojas, pantalla } = await dibujarA4({ sucursal: NOMBRE, renglones: 60 });
    expect(hojas.length).toBeGreaterThan(1);
    for (const hoja of hojas) {
      const encabezado = hoja.querySelector<HTMLElement>('[data-medida="encabezado"]');
      const sucursales = encabezado?.querySelectorAll<HTMLElement>("[data-sucursal]") ?? [];
      expect(sucursales).toHaveLength(1);
      const s = sucursales[0] as HTMLElement;
      expect(s.textContent).toBe(NOMBRE);
      expect(antes(s, filaRazonSocial(encabezado as Element))).toBe(true);
      // Primera línea del bloque del emisor, con el estilo del título.
      expectMarcaYDespuesSucursal(s);
      expect(Number(getComputedStyle(s).fontWeight)).toBeGreaterThanOrEqual(600);
      // Sin rótulo: el bloque no suma ningún texto fuera de la razón social y el nombre.
      expect(s.children).toHaveLength(0);
      const rE = (encabezado as Element).getBoundingClientRect();
      const rS = s.getBoundingClientRect();
      expect(rS.top).toBeGreaterThanOrEqual(rE.top - 0.5);
      expect(rS.bottom).toBeLessThanOrEqual(rE.bottom + 0.5);
    }
    await pantalla.unmount();
  });

  it("sin sucursal no hay nada extra y el alto del encabezado es menor", async () => {
    const sin = await dibujarA4({ renglones: 8 });
    expect(sin.hojas[0]?.querySelectorAll("[data-sucursal]")).toHaveLength(0);
    const altoSin = sin.hojas[0]?.querySelector<HTMLElement>("header")?.offsetHeight ?? 0;
    await sin.pantalla.unmount();
    const con = await dibujarA4({ sucursal: NOMBRE, renglones: 8 });
    const altoCon = con.hojas[0]?.querySelector<HTMLElement>("header")?.offsetHeight ?? 0;
    expect(altoCon).toBeGreaterThan(altoSin);
    await con.pantalla.unmount();
  });

  it("con nombre de fantasía y sucursal (hoy la vista no dibuja la marca): primero la marca, después la sucursal, después la razón social", async () => {
    const armada = {
      ...armarLaHoja({}, comprobanteDePrueba({ sucursal: NOMBRE }), "A4"),
      nombreDeFantasia: "Marca de prueba",
    };
    const pantalla = await render(<EncabezadoDeHoja a={armada} />);
    const encabezado = document.querySelector('[data-medida="encabezado"]') as Element;
    const s = encabezado.querySelector("[data-sucursal]") as Element;
    const marca = s.previousElementSibling;
    expect(marca?.textContent).toBe("Marca de prueba");
    expect(s.parentElement?.firstElementChild).toBe(marca);
    expect(antes(s, filaRazonSocial(encabezado))).toBe(true);
    await pantalla.unmount();
  });

  it("un nombre de 100 caracteres sin espacios no se sale de la hoja", async () => {
    const { hojas, pantalla } = await dibujarA4({ sucursal: LARGO, renglones: 8 });
    for (const hoja of hojas) {
      expect(hoja.scrollWidth).toBeLessThanOrEqual(hoja.clientWidth);
      expect(hoja.scrollHeight).toBeLessThanOrEqual(hoja.clientHeight);
      const s = hoja.querySelector<HTMLElement>("[data-sucursal]") as HTMLElement;
      expect(s.textContent).toBe(LARGO);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
      expect(getComputedStyle(s).overflowWrap).toBe("anywhere");
    }
    await pantalla.unmount();
  });

  it("axe sin violaciones", async () => {
    const { pantalla } = await dibujarA4({ sucursal: NOMBRE, renglones: 26 });
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    await pantalla.unmount();
  });
});

describe("ticket: nombre de la sucursal", () => {
  it("arriba de la razón social, tal cual, sin rótulo; sin sucursal no hay nada extra", async () => {
    const sin = await dibujarTicket({});
    expect(sin.ticket.querySelectorAll("[data-sucursal]")).toHaveLength(0);
    const pxSin = sin.ticket.offsetHeight;
    await sin.pantalla.unmount();
    const { ticket, pantalla } = await dibujarTicket({ sucursal: NOMBRE });
    const s = ticket.querySelector<HTMLElement>("[data-sucursal]") as HTMLElement;
    expect(s.textContent).toBe(NOMBRE);
    expect(s.children).toHaveLength(0);
    expectMarcaYDespuesSucursal(s);
    expect(antes(s, filaRazonSocial(ticket))).toBe(true);
    expect(Number(getComputedStyle(s).fontWeight)).toBeGreaterThanOrEqual(600);
    expect(ticket.offsetHeight).toBeGreaterThan(pxSin);
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    await pantalla.unmount();
  });

  it("un nombre de 100 caracteres sin espacios no se sale del ticket", async () => {
    const { ticket, pantalla } = await dibujarTicket({ sucursal: LARGO });
    const s = ticket.querySelector<HTMLElement>("[data-sucursal]") as HTMLElement;
    expect(ticket.scrollWidth).toBeLessThanOrEqual(ticket.clientWidth);
    expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
    expect(getComputedStyle(s).overflowWrap).toBe("anywhere");
    await pantalla.unmount();
  });
});
