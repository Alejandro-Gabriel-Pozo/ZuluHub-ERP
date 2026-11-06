import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { base } from "../utilidades/detalle-de-comprobante";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página de imprimir un comprobante: valida la forma del id ANTES de preguntar, pide el modelo de impresión solo con ese id y pinta
 * cada error por el camino común del detalle (texto del catálogo, sin código crudo; el inesperado con su referencia). Y el botón
 * «Imprimir» del detalle: aparece solo con el comprobante Autorizado y lleva a esta página.
 */
vi.mock("server-only", () => ({}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () =>
        Promise.resolve({
          ok: true,
          valor: {
            acciones: ["comprobantes.ver"],
            modulos: { activos: ["facturacion"], enSoloLectura: [] },
          },
        }),
    }),
  },
}));
const lectura = vi.hoisted((): { llamadas: unknown[]; respuesta: unknown } => ({
  llamadas: [],
  respuesta: null,
}));
vi.mock("../../apps/web/servidor/facturacion", () => ({
  verElModeloDeImpresion: (entrada: unknown) => {
    lectura.llamadas.push(entrada);
    return Promise.resolve(lectura.respuesta);
  },
  verElComprobante: () => Promise.resolve(lectura.respuesta),
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  empresaDelPedido: () =>
    Promise.resolve({
      puerta: { marca: { nombre: "Marca de prueba" } },
      entrada: {
        ok: true,
        dato: { tipo: "ENTRA", empresa: { nombre: "Empresa de prueba" }, contexto: {} },
      },
    }),
}));

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
type Pagina = { default: (p: { params: Promise<{ id: string }> }) => Promise<unknown> };
const cargar = (ruta: string): Promise<Pagina> => import(/* @vite-ignore */ ruta);
const RUTA = "../../apps/web/app/s/app/(operacion)/facturacion/comprobantes/[id]";

async function html(ruta: string, id: string): Promise<string> {
  const { default: Pagina } = await cargar(ruta);
  return renderToStaticMarkup((await Pagina({ params: Promise.resolve({ id }) })) as ReactNode);
}
const texto = async (id: string): Promise<string> =>
  (await html(`${RUTA}/imprimir/page`, id)).replace(/<[^>]+>/g, " ");

const modelo = {
  fiscal: {
    rotulo: "FACTURA",
    letra: "B",
    codigoDelTipo: "006",
    numero: "00001-00000011",
    fecha: "2026-10-13",
    cae: "70417054367476",
    caeVence: "2026-10-23",
    emisor: {
      cuit: "20-11111111-2",
      razonSocial: "Zulu SA",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      domicilioFiscal: "Av. Corrientes 1234, Rosario",
      domicilioDelPuntoDeVenta: "Av. Corrientes 1234, Rosario",
      iibbNumero: null,
      inicioDeActividades: "2019-03-01",
    },
  },
  receptor: {
    nombre: null,
    documento: { tipo: "SIN_IDENTIFICAR" },
    condicionIva: "CONSUMIDOR_FINAL",
    domicilio: null,
  },
  renglones: [],
  totales: { letra: "B", total: "1210.00", ivaContenido: [] },
  asociado: null,
  leyendas: [],
};

const respuesta = (r: Respuesta<unknown>): void => {
  lectura.respuesta = r;
};

describe("la página de imprimir un comprobante", () => {
  beforeEach(() => {
    lectura.llamadas = [];
  });

  it("con el modelo, lo pide por su id y pinta la vista previa (A4 al abrir)", async () => {
    respuesta({ ok: true, dato: { modelo, qrSvg: "<svg></svg>" } });
    const marcado = await html(`${RUTA}/imprimir/page`, ID);
    expect(lectura.llamadas).toEqual([{ comprobanteId: ID }]);
    expect(marcado).toContain("A4");
    expect(marcado).toContain("Ticket");
    expect(marcado.match(/<h1\b/g)).toHaveLength(1);
    // «Descargar PDF»: un enlace a la ruta del PDF de ESTE comprobante, armado con el id ya validado.
    expect(marcado).toContain(`href="/facturacion/comprobantes/${ID}/pdf"`);
    expect(marcado).toContain("Descargar PDF");
  });

  it("si no hay modelo no se ofrece la descarga", async () => {
    respuesta({ ok: false, error: errorDeCodigo("SIN_PERMISO") });
    const marcado = await html(`${RUTA}/imprimir/page`, ID);
    expect(marcado).not.toContain("Descargar PDF");
    expect(marcado).not.toContain("/pdf");
  });

  it.each(["no-es-un-id", "0B9F6A1E-2C3D-4E5F-8A7B-9C0D1E2F3A4B", `${ID}x`, "1; drop table"])(
    "un id con otra forma («%s») es «no encontrado» y no llega al servidor",
    async (id) => {
      expect(await texto(id)).toContain("No encontramos ese comprobante.");
      expect(lectura.llamadas).toEqual([]);
    },
  );

  it.each([
    ["FISCAL_COMPROBANTE_NO_ENCONTRADO", "No encontramos ese comprobante."],
    ["SIN_PERMISO", "No tiene permiso para hacer esto."],
    ["MODULO_EN_DESARROLLO", "Esta función todavía está en desarrollo."],
  ] as const)("el error %s se ve con su texto y sin el código", async (codigo, esperado) => {
    respuesta({ ok: false, error: errorDeCodigo(codigo) });
    const t = await texto(ID);
    expect(t).toContain(esperado);
    expect(t).not.toContain(codigo);
  });

  it("un error inesperado muestra la referencia y nada técnico", async () => {
    respuesta({ ok: false, error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" } });
    const t = await texto(ID);
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});

describe("el detalle: el botón «Imprimir»", () => {
  const detalle = (estado: string) => {
    respuesta({ ok: true, dato: { ...base, id: ID, estado } });
    return html(`${RUTA}/page`, ID);
  };

  it("con el comprobante Autorizado aparece y lleva a la vista previa", async () => {
    const marcado = await detalle("AUTORIZADO");
    expect(marcado).toContain(`href="/facturacion/comprobantes/${ID}/imprimir"`);
  });

  it.each(["PENDIENTE", "EN_VALIDACION", "RECHAZADO", "INCIERTO", "CONFLICTO", "DESCARTADO"])(
    "con el comprobante %s no se ofrece",
    async (estado) => {
      expect(await detalle(estado)).not.toContain("/imprimir");
    },
  );
});
