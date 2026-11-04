import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * `verElModeloDeImpresion` (apps/web/servidor/facturacion.ts): como `verElComprobante`, solo el id viene del pedido; la empresa sale de la
 * sesión (acá un contexto fijo) y la consulta decide el permiso. La traducción de errores y el QR son de `src/composicion`
 * (`modelo-de-impresion-web.test.ts`); acá se ve el cableado de la función de servidor con el camino común real.
 */
vi.mock("server-only", () => ({}));

const ID = "11111111-1111-4111-8111-111111111111";
const mundo = vi.hoisted(
  (): { pedidos: { contexto: unknown; pedido: unknown }[]; resultado: unknown } => ({
    pedidos: [],
    resultado: null,
  }),
);

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));
vi.mock("../../apps/web/servidor/acciones", () => ({
  pedidoDeLaAccion: () => Promise.resolve({ ok: true, dato: {} }),
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {
    respuesta: { registrar: () => undefined, azar: () => new Uint8Array(4) },
  },
  sesionDelPedido: () => Promise.resolve({ sesion: {}, puerta: { marcaId: "marca-1" } }),
}));
vi.mock("../../apps/web/servidor/despacho-inmediato", () => ({
  despacharPorClavesDespuesDeConfirmar: () => undefined,
}));
vi.mock("../../src/composicion/sesion-y-empresa", () => ({
  resolverEmpresa: () =>
    Promise.resolve({ ok: true, dato: { tipo: "ENTRA", contexto: { empresaId: "empresa-1" } } }),
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeFacturacion: () => ({}),
    consultasDeFacturacion: () => ({
      modeloDeImpresion: (contexto: unknown, pedido: unknown) => {
        mundo.pedidos.push({ contexto, pedido });
        return Promise.resolve(mundo.resultado);
      },
    }),
  },
}));

import { verElModeloDeImpresion } from "../../apps/web/servidor/facturacion";

const URL_DEL_QR = "https://www.arca.gob.ar/fe/qr/?p=eyJ2ZXIiOjF9";
const MODELO = { qr: { url: URL_DEL_QR }, fiscal: { numero: "00001-00000011" } };

beforeEach(() => {
  mundo.pedidos = [];
  mundo.resultado = ok(MODELO);
});

describe("verElModeloDeImpresion", () => {
  it("con un id válido consulta con la empresa de la sesión y devuelve el modelo y el QR", async () => {
    const r = await verElModeloDeImpresion({ comprobanteId: ID });
    expect(r).toMatchObject({ ok: true, dato: { modelo: MODELO } });
    expect(r.ok ? r.dato.qrSvg.startsWith("<svg ") : false).toBe(true);
    expect(mundo.pedidos).toEqual([
      { contexto: { empresaId: "empresa-1" }, pedido: { comprobanteId: ID } },
    ]);
  });

  it.each([undefined, {}, { comprobanteId: "no-es-un-id" }, { comprobanteId: 7 }])(
    "un pedido inválido (%j) es FISCAL_DATOS_INVALIDOS y no llama a la consulta",
    async (crudo) => {
      expect(await verElModeloDeImpresion(crudo)).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_DATOS_INVALIDOS" },
      });
      expect(mundo.pedidos).toEqual([]);
    },
  );

  it("el pedido no puede cambiar de empresa ni mandar versión de representación", async () => {
    await verElModeloDeImpresion({
      comprobanteId: ID,
      empresaId: "otra-empresa",
      versionDeRepresentacion: 1,
    });
    expect(mundo.pedidos).toEqual([
      { contexto: { empresaId: "empresa-1" }, pedido: { comprobanteId: ID } },
    ]);
  });

  it.each(["SIN_PERMISO", "MODULO_NO_ACTIVO"])("%s llega tal cual", async (motivo) => {
    mundo.resultado = err(motivo);
    expect(await verElModeloDeImpresion({ comprobanteId: ID })).toMatchObject({
      ok: false,
      error: { codigo: motivo },
    });
  });

  it("un comprobante que no está es FISCAL_COMPROBANTE_NO_ENCONTRADO", async () => {
    mundo.resultado = err("COMPROBANTE_NO_ENCONTRADO");
    expect(await verElModeloDeImpresion({ comprobanteId: ID })).toEqual({
      ok: false,
      error: errorDeCodigo("FISCAL_COMPROBANTE_NO_ENCONTRADO"),
    });
  });
});
