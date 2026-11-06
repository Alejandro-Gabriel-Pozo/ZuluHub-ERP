import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { comprobanteDePrueba, esperarLasHojas, QR_DE_PRUEBA } from "./ayudas-de-impresion";
import { ComprobanteImpreso } from "./ComprobanteImpreso.cliente";
import { ALTO_A4_MM, ANCHO_A4_MM, ANCHO_TICKET_MM } from "./geometria";

/**
 * Las medidas de la vista de impresión se aplican por CSSOM (`aplicarEstilos`), no con un atributo `style=` del servidor que la CSP real
 * bloquea. Previene: la hoja sin su ancho/alto/margen/pie y el ticket sin su ancho en producción. El HTML del servidor sin `style=` lo ata
 * `sin-estilos-en-linea.test.tsx`; acá se verifica que, ya montada la vista, las variables y la escala están puestas.
 */
const variable = (el: Element | null, nombre: string) =>
  (el as HTMLElement | null)?.style.getPropertyValue(nombre);

describe("la vista de impresión pone sus medidas por CSSOM", () => {
  it("A4: variables en la hoja y en el medidor; ancho, alto y escala de la vista previa", async () => {
    const pantalla = await render(
      <ComprobanteImpreso
        comprobante={comprobanteDePrueba({ renglones: 8 })}
        qrSvg={QR_DE_PRUEBA}
        formato="A4"
      />,
    );
    const [hoja] = await esperarLasHojas();
    expect(variable(hoja ?? null, "--hoja-ancho")).toBe(`${ANCHO_A4_MM}mm`);
    expect(variable(hoja ?? null, "--hoja-alto")).toBe(`${ALTO_A4_MM}mm`);
    expect(variable(hoja ?? null, "--pie-alto")).toMatch(/^\d+px$/);
    expect(variable(document.querySelector("[data-medidor]"), "--hoja-ancho")).toBe(
      `${ANCHO_A4_MM}mm`,
    );
    const contenido = document.querySelector<HTMLElement>("[data-escala]");
    expect(contenido?.style.transform).toMatch(/^scale\(/);
    expect(contenido?.style.width).toMatch(/^\d+(\.\d+)?px$/);
    expect(contenido?.parentElement?.style.height).toMatch(/^\d+(\.\d+)?px$/);
    await pantalla.unmount();
  });

  it("ticket: el ancho va en la variable --ticket-ancho", async () => {
    const pantalla = await render(
      <ComprobanteImpreso
        comprobante={comprobanteDePrueba({ renglones: 2 })}
        qrSvg={QR_DE_PRUEBA}
        formato="TICKET"
      />,
    );
    await expect.poll(() => document.querySelector("[data-ticket]")).not.toBeNull();
    expect(variable(document.querySelector("[data-ticket]"), "--ticket-ancho")).toBe(
      `${ANCHO_TICKET_MM}mm`,
    );
    await pantalla.unmount();
  });
});
