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
const armazon = vi.hoisted((): { opciones: unknown } => ({ opciones: null }));
vi.mock("../../apps/web/pantallas/operacion", () => ({
  pantallaDeOperacion: async (opciones: unknown, contenido: (d: object) => Promise<unknown>) => {
    armazon.opciones = opciones;
    return contenido({});
  },
}));

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";

// Con ruta en una variable: el `tsc` de la raíz (sin DOM) no sigue la página hasta los componentes de cliente.
const cargar = (
  ruta: string,
): Promise<{ default: (p: { params: Promise<{ id: string }> }) => Promise<unknown> }> =>
  import(/* @vite-ignore */ ruta);

async function pagina(id: string): Promise<string> {
  const { default: Pagina } = await cargar(
    "../../apps/web/app/s/app/(operacion)/facturacion/comprobantes/[id]/page",
  );
  const arbol = await Pagina({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(arbol as ReactNode).replace(/<[^>]+>/g, " ");
}

const respuesta = (r: Respuesta<unknown>): void => {
  lectura.respuesta = r;
};

describe("la página del detalle de un comprobante", () => {
  beforeEach(() => {
    lectura.llamadas = [];
  });

  it("usa la guarda de operación, con el destino de facturación", async () => {
    respuesta({ ok: true, dato: base });
    await pagina(ID);
    expect(armazon.opciones).toEqual({ titulo: "fiscal.pantalla.titulo", actual: "facturacion" });
  });

  it("con un comprobante, lo lee por su id y lo pinta", async () => {
    respuesta({ ok: true, dato: base });
    const texto = await pagina(ID);
    expect(lectura.llamadas).toEqual([{ comprobanteId: ID }]);
    expect(texto).toContain("Factura B 00001-00001234");
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
