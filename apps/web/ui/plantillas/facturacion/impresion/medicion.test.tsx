import { afterEach, describe, expect, it } from "vitest";
import { leerLasMedidas } from "./medicion";

/**
 * `leerLasMedidas` en Chromium real (hace falta layout). Previene: medir una tabla sin layout (`display: none` en `@media print`), donde
 * todos los altos dan 0 y el paginador colapsa las hojas en una sola.
 */

function tablaDeMedicion(estilo: string): HTMLElement {
  const raiz = document.createElement("div");
  raiz.style.cssText = estilo;
  raiz.innerHTML = `
    <div data-medida="encabezado" style="height: 30px">encabezado</div>
    <table>
      <thead><tr><th style="height: 20px">cabecera</th></tr></thead>
      <tbody>
        <tr data-transporte=""><td style="height: 18px">Transporte</td></tr>
        <tr data-fila=""><td style="height: 25px">uno</td></tr>
        <tr data-fila=""><td style="height: 25px">dos</td></tr>
      </tbody>
    </table>
    <div data-medida="pie" style="height: 40px">pie</div>`;
  document.body.append(raiz);
  return raiz;
}

describe("leerLasMedidas", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("con layout devuelve los altos reales de cada pieza", () => {
    const medidas = leerLasMedidas(tablaDeMedicion("position: absolute; left: -10000px"));
    expect(medidas).not.toBeNull();
    expect(medidas?.encabezadoDeLaHoja).toBe(30);
    expect(medidas?.pie).toBe(40);
    expect(medidas?.renglones).toHaveLength(2);
    expect(medidas?.renglones.every((alto) => alto >= 25)).toBe(true);
  });

  it("con la raíz en display: none devuelve null (no todos los altos en 0)", () => {
    expect(leerLasMedidas(tablaDeMedicion("display: none"))).toBeNull();
  });

  it("con un ancestro en display: none también devuelve null", () => {
    const abuelo = document.createElement("div");
    abuelo.style.display = "none";
    document.body.append(abuelo);
    const raiz = tablaDeMedicion("");
    abuelo.append(raiz);
    expect(leerLasMedidas(raiz)).toBeNull();
  });
});
