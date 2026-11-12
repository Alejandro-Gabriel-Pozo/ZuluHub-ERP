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

/**
 * Caso real de «Emitir factura» (4,43 contra 4,5, intermitente): un botón que se habilita (fondo gris a azul) y a mitad de camino recibe otro cambio de fondo (el `:hover` del
 * clic) CANCELA su transición y la reemplaza otra. Esperar solo las transiciones que había al empezar daba por terminado lo que seguía corriendo y se medía con el fondo
 * claro. La ayuda tiene que esperar también a la que reemplaza.
 */
it("espera también a la transición que reemplaza a otra (el fondo a medio camino no se mide)", async () => {
  await render(
    <button
      type="button"
      data-prueba="reemplazo"
      style={{
        color: "#ffffff",
        background: "#e5e7eb",
        transition: "background-color 400ms linear",
        border: 0,
        fontSize: "18px",
      }}
    >
      Emitir
    </button>,
  );
  const boton = document.querySelector<HTMLButtonElement>('[data-prueba="reemplazo"]');
  if (boton === null) throw new Error("falta el botón");
  await new Promise((r) => setTimeout(r, 50));
  // La primera transición (gris a azul) ya corre cuando la ayuda empieza a esperar; a los 100 ms el destino cambia un poco y la CANCELA: la que la reemplaza arranca desde el color de ese instante.
  boton.style.background = "#1f4e78";
  const pendiente = violacionesDeAccesibilidad();
  await new Promise((r) => setTimeout(r, 100));
  boton.style.background = "#1f4e79";
  const violaciones = await pendiente;
  expect(violaciones.filter((v) => v.startsWith("color-contrast"))).toEqual([]);
  expect(getComputedStyle(boton).backgroundColor).toBe("rgb(31, 78, 121)");
});

it("no cuelga esperando una animación infinita: mide igual", async () => {
  await render(
    <p style={{ animation: "latido-de-prueba 100ms infinite alternate" }}>
      <style>{"@keyframes latido-de-prueba { from { opacity: 1 } to { opacity: 1 } }"}</style>
      Texto
    </p>,
  );
  const inicio = performance.now();
  await violacionesDeAccesibilidad();
  expect(performance.now() - inicio).toBeLessThan(1500);
});
