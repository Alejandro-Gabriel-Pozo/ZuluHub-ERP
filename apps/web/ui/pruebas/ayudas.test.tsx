import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { violacionesDeAccesibilidad } from "./ayudas";

/**
 * La ayuda de accesibilidad tiene que detectar de verdad: si algún día deja de mirar el contraste o el
 * nombre de los controles, todas las pruebas de axe pasarían en falso. Acá se le muestra lo malo.
 */
it("detecta un botón sin nombre accesible", async () => {
  await render(<button type="button" />);
  const violaciones = await violacionesDeAccesibilidad();
  expect(violaciones.some((v) => v.startsWith("button-name"))).toBe(true);
});

it("detecta texto con contraste insuficiente (navegador real)", async () => {
  await render(<p style={{ color: "#cccccc", background: "#ffffff" }}>Poco contraste</p>);
  const violaciones = await violacionesDeAccesibilidad();
  expect(violaciones.some((v) => v.startsWith("color-contrast"))).toBe(true);
});

it("detecta un campo sin etiqueta", async () => {
  await render(<input type="text" />);
  const violaciones = await violacionesDeAccesibilidad();
  expect(violaciones.some((v) => v.startsWith("label"))).toBe(true);
});

it("no se queja de lo correcto", async () => {
  await render(
    <label>
      Nombre <input type="text" />
    </label>,
  );
  expect(await violacionesDeAccesibilidad()).toEqual([]);
});
