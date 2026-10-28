import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { base } from "../utilidades/detalle-de-comprobante";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página del detalle de un comprobante: valida la forma del id ANTES de preguntar, llama a la lectura del servidor
 * solo con ese id (la empresa y el permiso los decide el servidor) y pinta cada error con su texto, sin el código crudo.
 */
vi.mock("server-only", () => ({}));
const lectura = vi.hoisted((): { llamadas: unknown[]; respuesta: unknown } => ({
  llamadas: [],
  respuesta: null,
}));
vi.mock("../../apps/web/servidor/facturacion", () => ({
  verElComprobante: (entrada: unknown) => {
    lectura.llamadas.push(entrada);
    return Promise.resolve(lectura.respuesta);
  },
}));
// La guarda real (`pantallaDeOperacion`) y el armazón real: solo se simula lo externo, la sesión, la puerta y la empresa.
vi.mock("../../apps/web/servidor/sesion", () => ({
  empresaDelPedido: () =>
    Promise.resolve({
      puerta: { marca: { nombre: "Marca de prueba" } },
      entrada: {
        ok: true,
        dato: {
          tipo: "ENTRA",
          empresa: { nombre: "Empresa de prueba" },
          contexto: {},
        },
      },
    }),
}));

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";

// Con ruta en una variable: el `tsc` de la raíz (sin DOM) no sigue la página hasta los componentes de cliente.
const cargar = (
  ruta: string,
): Promise<{ default: (p: { params: Promise<{ id: string }> }) => Promise<unknown> }> =>
  import(/* @vite-ignore */ ruta);

async function html(id: string): Promise<string> {
  const { default: Pagina } = await cargar(
    "../../apps/web/app/s/app/(operacion)/facturacion/comprobantes/[id]/page",
  );
  const arbol = await Pagina({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(arbol as ReactNode);
}

const titulos = (marcado: string): string[] =>
  [...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1] as string);

const pagina = async (id: string): Promise<string> => (await html(id)).replace(/<[^>]+>/g, " ");

const respuesta = (r: Respuesta<unknown>): void => {
  lectura.respuesta = r;
};

describe("la página del detalle de un comprobante", () => {
  beforeEach(() => {
    lectura.llamadas = [];
  });

  it("con un comprobante, lo lee por su id y lo pinta", async () => {
    respuesta({ ok: true, dato: base });
    const texto = await pagina(ID);
    expect(lectura.llamadas).toEqual([{ comprobanteId: ID }]);
    expect(texto).toContain("Factura B 00001-00001234");
  });

  it("con un comprobante hay UN solo h1, con el título real", async () => {
    respuesta({ ok: true, dato: base });
    const marcado = await html(ID);
    expect(titulos(marcado)).toEqual(["Factura B 00001-00001234"]);
  });

  it("sin comprobante (id inválido o error) el único h1 es el genérico «Comprobante»", async () => {
    respuesta({ ok: false, error: errorDeCodigo("FISCAL_COMPROBANTE_NO_ENCONTRADO") });
    for (const id of ["no-es-un-id", ID]) expect(titulos(await html(id))).toEqual(["Comprobante"]);
  });

  it.each(["no-es-un-id", "0B9F6A1E-2C3D-4E5F-8A7B-9C0D1E2F3A4B", `${ID}x`, "1; drop table"])(
    "un id con otra forma («%s») es «no encontrado» y no llega al servidor",
    async (id) => {
      const texto = await pagina(id);
      expect(texto).toContain("No encontramos ese comprobante.");
      expect(lectura.llamadas).toEqual([]);
    },
  );

  it.each([
    ["FISCAL_COMPROBANTE_NO_ENCONTRADO", "No encontramos ese comprobante."],
    ["SIN_PERMISO", "No tiene permiso para hacer esto."],
    ["MODULO_EN_DESARROLLO", "Esta función todavía está en desarrollo."],
    ["SESION_VENCIDA", "Tu sesión venció"],
  ] as const)("el error %s se ve con su texto y sin el código", async (codigo, esperado) => {
    respuesta({ ok: false, error: errorDeCodigo(codigo) });
    const texto = await pagina(ID);
    expect(texto).toContain(esperado);
    expect(texto).not.toContain(codigo);
  });

  it("un error inesperado muestra la referencia y nada técnico", async () => {
    respuesta({
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    });
    const texto = await pagina(ID);
    expect(texto).toContain("PD-ABC123");
    expect(texto).not.toContain("ERROR_INTERNO");
  });
});
