import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Escapado de los metadatos de la carta (spec SEO §11, «Texto escapado»): un nombre, rubro o lugar con `<script>`, comillas o `&` sale como TEXTO en
 * `title`, `description` y Open Graph, nunca como marcado. Previene: que un comerciante (o un dato mal cargado) inyecte etiquetas en el `<head>` de la carta.
 * Se prueba sobre lo que emite el adaptador `metadatosDeLaCarta` y su escritura en el `<head>` con el mismo React que usa Next para emitirlos.
 */
vi.mock("server-only", () => ({}));
vi.mock("../../apps/web/servidor/pedido", () => ({ puertaEsIndexable: () => false }));

import { metadatosDeLaCarta } from "../../apps/web/servidor/metadatos-de-carta";
import type { PuertaResuelta } from "../../src/capacidades/experiencia/puerta";

const PUERTA: PuertaResuelta = {
  host: "carta.x.test",
  superficie: "CARTA",
  marcaId: "m1",
  duenio: { tipo: "MARCA" },
  marca: { nombre: 'Marca "A" & Cía', tema: {}, hostDeApp: null },
};

const HOSTIL = `<script>alert("x")</script> & 'q'`;

/** El `<head>` que resulta de los metadatos: lo mínimo que Next emite de ellos, con el escapado de React. */
function cabezaDe(m: ReturnType<typeof metadatosDeLaCarta>): string {
  const og = m.openGraph as { title: string; description: string; siteName: string };
  return renderToStaticMarkup(
    createElement(
      "head",
      null,
      createElement("title", null, m.title as string),
      createElement("meta", { name: "description", content: m.description as string }),
      createElement("meta", { property: "og:title", content: og.title }),
      createElement("meta", { property: "og:description", content: og.description }),
      createElement("meta", { property: "og:site_name", content: og.siteName }),
    ),
  );
}

describe("metadatos de la carta: texto hostil", () => {
  const m = metadatosDeLaCarta(
    PUERTA,
    { tipo: "CARTA", nombre: HOSTIL, rubro: HOSTIL, lugar: HOSTIL },
    "/q7H2xk9Pq7H2xk9Pq7H2xk",
  );

  it("el adaptador entrega el texto tal cual, como dato, sin armar marcado", () => {
    expect(m.title).toContain(HOSTIL.slice(0, 20));
    expect(m.description).toContain(HOSTIL.slice(0, 20));
    expect(m.alternates?.canonical).toBe("https://carta.x.test/q7H2xk9Pq7H2xk9Pq7H2xk");
  });

  it("en el <head> no queda ninguna etiqueta del dato y todo sale escapado", () => {
    const cabeza = cabezaDe(m);
    expect(cabeza).not.toContain("<script");
    expect(cabeza).not.toContain("</script");
    expect(cabeza).toContain("&lt;script&gt;");
    expect(cabeza).toContain("&quot;");
    expect(cabeza).toContain("&amp;");
    expect(cabeza).toContain("&#x27;");
  });

  it("el nombre de la marca (el sitio) también sale escapado", () => {
    expect(cabezaDe(m)).toContain("Marca &quot;A&quot; &amp; Cía");
  });

  it("el producto con texto hostil sale escapado igual", () => {
    const p = metadatosDeLaCarta(
      PUERTA,
      { tipo: "PRODUCTO", nombreDelProducto: HOSTIL, nombreDeLaCarta: HOSTIL },
      "/q7H2xk9Pq7H2xk9Pq7H2xk/milanesa-1a2b3c4d",
    );
    expect(renderToStaticMarkup(createElement("title", null, p.title as string))).not.toContain(
      "<script",
    );
  });
});
