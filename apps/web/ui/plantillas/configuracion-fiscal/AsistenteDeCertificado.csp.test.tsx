import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AsistenteDeCertificado, PasosNumerados } from "./AsistenteDeCertificado.cliente";
import type { ArranqueDelAmbiente } from "./modelo-de-certificado";

/**
 * La CSP (`style-src 'self' 'nonce-…'`, sin `unsafe-inline`) bloquea todo `style="…"` y todo `<style>` sin nonce que salga en el HTML del
 * servidor: los tres pasos se acomodaban distinto a como se diseñaron. Falla si el asistente vuelve a emitir alguno. El paso 2 solo aparece
 * tras generar el pedido (estado de cliente): se verifica con los pasos numerados, que son lo único que cambia entre pasos.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const SIN_ESTILO_EN_LINEA = /\sstyle\s*=|<style[\s>]/i;
const GENERAR: ArranqueDelAmbiente = { vista: "generar", aliasInicial: "" };
const CARGAR: ArranqueDelAmbiente = {
  vista: "cargar",
  certificadoId: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  datos: [],
};

const asistente = (arranque: ArranqueDelAmbiente) =>
  renderToStaticMarkup(
    <AsistenteDeCertificado
      emisorId="2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d"
      ambiente="PRODUCCION"
      arranque={arranque}
      generar={vi.fn()}
      cargar={vi.fn()}
      rutaALaLista="/configuracion-fiscal/certificado-de-arca"
    />,
  );

describe("AsistenteDeCertificado: sin estilos en línea en el HTML del servidor", () => {
  it("paso 1 (generar el pedido)", () => {
    const html = asistente(GENERAR);
    expect(html).toContain('aria-current="step"');
    expect(html).not.toMatch(SIN_ESTILO_EN_LINEA);
  });

  it("paso 3 (cargar el certificado)", () => {
    const html = asistente(CARGAR);
    expect(html).toContain('aria-current="step"');
    expect(html).not.toMatch(SIN_ESTILO_EN_LINEA);
  });

  it.each([1, 2, 3] as const)("los pasos numerados con el paso %i actual", (actual) => {
    const html = renderToStaticMarkup(<PasosNumerados actual={actual} />);
    expect(html.match(/<li[ >]/g)).toHaveLength(3);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).not.toMatch(SIN_ESTILO_EN_LINEA);
  });
});
