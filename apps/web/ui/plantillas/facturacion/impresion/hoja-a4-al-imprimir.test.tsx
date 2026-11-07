// Trae los tipos del proveedor de Playwright: sin ellos `cdp()` no tiene `send`.
import type {} from "@vitest/browser-playwright";
import { describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-react";
import { comprobanteDePrueba, esperarLasHojas, QR_DE_PRUEBA } from "./ayudas-de-impresion";
import { ComprobanteImpreso } from "./ComprobanteImpreso.cliente";

/**
 * Al pasar a `print` la tabla de medición queda `display: none`: el reparto en hojas ya calculado tiene que conservarse. Previene:
 * re-medir con altos en 0 y colapsar las 60 renglones en UNA hoja al imprimir (intermitente según cuándo dispare el ResizeObserver).
 */
describe("hoja A4: el reparto sobrevive al medio print", () => {
  it("con print emulado se siguen mostrando las MISMAS hojas", async () => {
    await render(
      <ComprobanteImpreso
        comprobante={comprobanteDePrueba({ renglones: 60 })}
        qrSvg={QR_DE_PRUEBA}
        formato="A4"
      />,
    );
    const antes = await esperarLasHojas();
    expect(antes.length).toBeGreaterThan(1);
    const sesion = cdp();
    await sesion.send("Emulation.setEmulatedMedia", { media: "print" });
    try {
      // Espera a que rija print (el medidor pasa a display: none) y recién ahí compara; luego deja pasar el ResizeObserver y re-compara.
      await expect
        .poll(() => getComputedStyle(document.querySelector("[data-medidor]") as Element).display, {
          timeout: 5000,
        })
        .toBe("none");
      await new Promise((resolver) => setTimeout(resolver, 500));
      const ahora = [...document.querySelectorAll<HTMLElement>("[data-hoja]")];
      expect(ahora).toHaveLength(antes.length);
      expect(ahora.every((hoja, i) => hoja === antes[i] && hoja.isConnected)).toBe(true);
    } finally {
      await sesion.send("Emulation.setEmulatedMedia", { media: "" });
    }
  });
});
