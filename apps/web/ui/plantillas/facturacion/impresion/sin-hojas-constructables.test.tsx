import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { comprobanteDePrueba, esperarLasHojas, QR_DE_PRUEBA } from "./ayudas-de-impresion";
import { ComprobanteImpreso } from "./ComprobanteImpreso.cliente";

/**
 * Safari < 16.4 y Firefox < 101 no tienen `adoptedStyleSheets`: la vista se muestra igual y se imprime con el tamaño de página del
 * navegador. Previene: vista en blanco (TypeError al montar `EstiloDePagina`) en navegadores sin hojas constructables.
 */
async function sinHojasConstructables<T>(prueba: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(Document.prototype, "adoptedStyleSheets");
  if (original === undefined) throw new Error("Chromium debería tener adoptedStyleSheets");
  Reflect.deleteProperty(Document.prototype, "adoptedStyleSheets");
  try {
    expect("adoptedStyleSheets" in document).toBe(false);
    return await prueba();
  } finally {
    Object.defineProperty(Document.prototype, "adoptedStyleSheets", original);
  }
}

describe("la vista de impresión sin hojas constructables", () => {
  it("A4: monta sin lanzar y muestra sus hojas", async () => {
    await sinHojasConstructables(async () => {
      const pantalla = await render(
        <ComprobanteImpreso
          comprobante={comprobanteDePrueba({ renglones: 8 })}
          qrSvg={QR_DE_PRUEBA}
          formato="A4"
        />,
      );
      expect((await esperarLasHojas()).length).toBeGreaterThan(0);
      await pantalla.unmount();
    });
  });

  it("ticket: monta sin lanzar y muestra el ticket", async () => {
    await sinHojasConstructables(async () => {
      const pantalla = await render(
        <ComprobanteImpreso
          comprobante={comprobanteDePrueba({ renglones: 2 })}
          qrSvg={QR_DE_PRUEBA}
          formato="TICKET"
        />,
      );
      await expect.poll(() => document.querySelector("[data-ticket]")).not.toBeNull();
      await pantalla.unmount();
    });
  });
});
