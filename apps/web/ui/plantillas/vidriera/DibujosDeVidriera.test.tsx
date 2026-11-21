import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CATALOGO_DE_MODELOS_DE_VIDRIERA } from "../../../../../src/capacidades/experiencia/vidriera/modelos";
import { temaDeLaCarta } from "../../../../../src/capacidades/experiencia/vidriera/tema-de-la-carta";
import { DIBUJOS_DE_VIDRIERA } from "./dibujos-de-vidriera";
import { TEXTOS, vidrieraDePrueba } from "./datosDePrueba";

/**
 * V1b: la identidad de la carta (cara, color, logo) llega a TODO modelo que se dibuja, por la entrada común (`IdentidadDeLaCarta.tsx`). Esta prueba falla si:
 *  - un dibujo no muestra la cara ni la placa cuando la carta eligió identidad (o los muestra cuando no eligió nada);
 *  - hay un dibujo en esta carpeta (`Plantilla*.cliente.tsx`) que no figura en `DIBUJOS_DE_VIDRIERA`;
 *  - se suma un modelo al catálogo sin anotar si tiene dibujo.
 * Hoy solo la Lista tiene dibujo; la Cuadrícula y el Libro (V3, A6) tienen elección y perilla pero ningún dibujo: cuando se construyan tienen que figurar acá y consumir la identidad.
 */
const SIN_DIBUJO_TODAVIA = ["CUADRICULA", "LIBRO"] as const;
const archivosDeDibujos = Object.keys(import.meta.glob("./Plantilla*.cliente.tsx"));

describe("dibujos de la carta: la identidad llega a todos", () => {
  it("cada modelo del catálogo figura en el registro: con dibujo o anotado como «sin dibujo todavía»", () => {
    expect(Object.keys(DIBUJOS_DE_VIDRIERA).sort()).toEqual(
      Object.keys(CATALOGO_DE_MODELOS_DE_VIDRIERA).sort(),
    );
    const sinDibujo = Object.entries(DIBUJOS_DE_VIDRIERA)
      .filter(([, dibujo]) => dibujo === null)
      .map(([modelo]) => modelo);
    expect(sinDibujo.sort()).toEqual([...SIN_DIBUJO_TODAVIA]);
  });

  it("todo dibujo que hay en la carpeta (`Plantilla*.cliente.tsx`) está en el registro", () => {
    const registrados = Object.values(DIBUJOS_DE_VIDRIERA).filter((d) => d !== null);
    expect(archivosDeDibujos).toHaveLength(registrados.length);
  });

  for (const [modelo, Dibujo] of Object.entries(DIBUJOS_DE_VIDRIERA)) {
    if (Dibujo === null) continue;

    it(`${modelo}: con identidad elegida lleva la cara y la placa con la inicial`, async () => {
      const tema = temaDeLaCarta("BOLICHE", "#1f4e79");
      if (!tema.ok) throw new Error("color válido esperado");
      const pantalla = await render(
        Dibujo({
          vista: {
            ...vidrieraDePrueba(),
            identidad: { cara: "BOLICHE", tema: tema.valor, inicial: "L", logo: null },
          },
          textos: TEXTOS,
        }),
      );
      expect(document.querySelector("main")?.getAttribute("data-cara"), modelo).toBe("BOLICHE");
      expect(document.querySelector("[data-placa]")?.textContent, modelo).toBe("L");
      await pantalla.unmount();
    });

    it(`${modelo}: sin identidad elegida no lleva cara ni placa (se ve como siempre)`, async () => {
      const pantalla = await render(Dibujo({ vista: vidrieraDePrueba(), textos: TEXTOS }));
      expect(document.querySelector("main")?.hasAttribute("data-cara"), modelo).toBe(false);
      expect(document.querySelector("[data-placa]"), modelo).toBeNull();
      await pantalla.unmount();
    });
  }
});
