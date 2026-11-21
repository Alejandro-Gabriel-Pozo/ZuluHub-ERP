import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PapelDelTicket, type PapelDeTicket } from "./PapelDelTicket.cliente";
import { TicketDelCliente } from "./TicketDelCliente.cliente";
import { textosDeCobrar } from "./textos-de-cobrar";

/**
 * Mismo contrato que `facturacion/impresion/sin-estilos-en-linea.test.tsx` para el ticket del cliente del mostrador: ningún `style=` ni `<style>` en el HTML del servidor (la política de seguridad real los bloquea y React no
 * los vuelve a poner al hidratar). El ancho va por CSSOM (`aplicarEstilos`) y la `@page`, en una hoja construida (`EstiloDePagina`).
 */
const PAPEL: PapelDeTicket = {
  ancho: 80,
  lineas: [
    { texto: "Ticket N.º 12", estilo: "NEGRITA" },
    { texto: "", estilo: "SEPARADOR" },
    { texto: "Total  3.000,00", estilo: "NEGRITA" },
  ],
};

const violaciones = (html: string): string[] => [
  ...[...html.matchAll(/<[a-z][^>]*?\sstyle\s*=/gi)].map((m) => `style= en ${m[0]}`),
  ...[...html.matchAll(/<style\b[^>]*>/gi)].map((m) => `<style> en ${m[0]}`),
];

describe("el ticket del cliente y la política de seguridad", () => {
  it("el papel no lleva `style=` ni `<style>`", () => {
    const html = renderToStaticMarkup(
      <PapelDelTicket papel={PAPEL} textos={textosDeCobrar()} alMedirElAlto={() => undefined} />,
    );
    expect(html).toContain("Ticket N.º 12");
    expect(violaciones(html)).toEqual([]);
  });

  it("la vista completa tampoco", () => {
    const html = renderToStaticMarkup(
      <TicketDelCliente papel={PAPEL} textos={textosDeCobrar()} alVolver={() => undefined} />,
    );
    expect(html).toContain("data-zona-de-impresion");
    expect(violaciones(html)).toEqual([]);
  });
});
