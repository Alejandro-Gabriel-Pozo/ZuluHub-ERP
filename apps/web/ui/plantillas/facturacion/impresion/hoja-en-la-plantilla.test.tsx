// Trae los tipos del proveedor de Playwright: sin ellos `cdp()` no tiene `send`.
import type {} from "@vitest/browser-playwright";
import { describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../../tokens.css";
import { ArmazonDeOperacion } from "../../sesion/ArmazonDeOperacion";
import { PantallaDeImprimirComprobante } from "../PantallaDeImprimirComprobante.cliente";
import { comprobanteDePrueba, esperarLasHojas, QR_DE_PRUEBA } from "./ayudas-de-impresion";
import { ANCHO_A4_MM, mmAPx } from "./geometria";

/**
 * La hoja A4 DENTRO de la plantilla real de operación (la que usa la página de imprimir), al imprimir: 210 mm exactos pegados al borde
 * del papel (sin el `padding` de `<main>` ni el de ningún contenedor) y la barra, la cabecera y los controles ocultos. Previene: que el
 * relleno de la plantilla corra la hoja y el A4 salga cortado o con margen. Chequeo: esta prueba (la de `hoja-a4.test.tsx` usa un
 * envoltorio pelado y no lo vería).
 */
describe("hoja A4 dentro de la plantilla de operación, al imprimir", () => {
  it("mide 210 mm, empieza en el borde y no queda nada de la plantilla a la vista", async () => {
    await render(
      <ArmazonDeOperacion titulo="Imprimir" marca="Marca" empresa="Empresa">
        <PantallaDeImprimirComprobante
          comprobante={comprobanteDePrueba({ renglones: 3 })}
          qrSvg={QR_DE_PRUEBA}
        />
      </ArmazonDeOperacion>,
    );
    const hojas = await esperarLasHojas();
    const sesion = cdp();
    await sesion.send("Emulation.setEmulatedMedia", { media: "print" });
    try {
      const caja = hojas[0]?.getBoundingClientRect();
      expect(Math.abs((caja?.width ?? 0) - mmAPx(ANCHO_A4_MM))).toBeLessThanOrEqual(1);
      expect(Math.abs(caja?.left ?? 99)).toBeLessThanOrEqual(1);
      expect(Math.abs(caja?.top ?? 99)).toBeLessThanOrEqual(1);
      for (const ajeno of ["header", "footer", "fieldset", "button"]) {
        for (const el of document.querySelectorAll(ajeno)) {
          if (el.closest("[data-zona-de-impresion]")) continue;
          expect(getComputedStyle(el).display).toBe("none");
        }
      }
    } finally {
      await sesion.send("Emulation.setEmulatedMedia", { media: "" });
    }
  });
});
