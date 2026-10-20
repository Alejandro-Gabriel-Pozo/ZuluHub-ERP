import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import {
  CODIGOS_PUBLICOS,
  errorDeCodigo,
  type CodigoPublico,
} from "../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../src/capacidades/vocabulario/vocabulario";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { ErrorDeRespuesta } from "./ErrorDeRespuesta";

/** Cada código público se ve con el patrón que le toca, con su texto del catálogo, y sin violaciones. */
const codigos = Object.keys(CODIGOS_PUBLICOS) as CodigoPublico[];

describe("ErrorDeRespuesta", () => {
  it.each(codigos)("%s: su texto, su código a la vista y accesible", async (codigo) => {
    const error =
      codigo === "ERROR_INTERNO" || codigo === "NO_DISPONIBLE"
        ? { ...errorDeCodigo(codigo), referencia: "PD-ABCD-0123" }
        : errorDeCodigo(codigo);
    await render(<ErrorDeRespuesta error={error} />);
    await expect.element(page.getByText(texto({}, error.clave))).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("lo inesperado muestra la referencia; sin referencia (un fallo solo del navegador) no inventa una", async () => {
    const { rerender, container } = await render(
      <ErrorDeRespuesta
        error={{ ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABCD-0123" }}
      />,
    );
    await expect.element(page.getByText("Referencia: PD-ABCD-0123")).toBeVisible();
    await rerender(<ErrorDeRespuesta error={errorDeCodigo("ERROR_INTERNO")} />);
    expect(container.textContent).not.toContain("Referencia");
  });

  it("la marca cambia la redacción, nunca el código", async () => {
    await render(
      <ErrorDeRespuesta
        error={errorDeCodigo("YA_ES_MIEMBRO")}
        diccionario={{ "error.ya_es_miembro": "Ya sos del equipo." }}
      />,
    );
    await expect.element(page.getByText("Ya sos del equipo.")).toBeVisible();
    await expect.element(page.getByText("YA_ES_MIEMBRO")).toBeVisible();
  });

  it("el estado de una empresa que no opera se explica con su texto", async () => {
    await render(
      <ErrorDeRespuesta
        error={{ ...errorDeCodigo("EMPRESA_NO_OPERA"), clave: "motivo.empresa.empresa_en_baja" }}
      />,
    );
    await expect.element(page.getByText("La empresa se está dando de baja.")).toBeVisible();
  });
});
