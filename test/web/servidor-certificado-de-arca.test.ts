import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";

/**
 * `apps/web/servidor/certificado-de-arca.ts`: resuelve la empresa y el emisor DEL SERVIDOR (nunca del navegador) y delega. Lo que hace cada
 * caso de uso (permiso, idempotencia, aislamiento) está probado con la base real en `test/integracion/fiscal-certificados-web.test.ts` y
 * en `test/integracion/fiscal-certificado-pantalla.test.ts`.
 */
vi.mock("server-only", () => ({}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: { casosDeUsoDeCertificados: () => ({}), consultasDeFacturacion: () => ({}) },
}));
const registro = vi.hoisted((): { registrado: string[] } => ({ registrado: [] }));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: { respuesta: { registrar: (x: string) => registro.registrado.push(x) } },
}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => unknown) => hacer(CONTEXTO),
}));
const composicion = vi.hoisted(
  (): {
    llamadas: { nombre: string; contexto: unknown; entrada: unknown }[];
    resultado: unknown;
    estado: unknown;
    certificados: unknown;
  } => ({ llamadas: [], resultado: null, estado: null, certificados: null }),
);
vi.mock("../../apps/web/servidor/configuracion-fiscal", () => ({
  cargarElEstadoDeLaConfiguracion: (contexto: unknown) => {
    composicion.llamadas.push({ nombre: "estado", contexto, entrada: undefined });
    return Promise.resolve(composicion.estado);
  },
}));
vi.mock("../../src/composicion/certificado-de-arca-web", () => {
  const delegada = (nombre: string) => (_d: unknown, contexto: unknown, entrada?: unknown) => {
    composicion.llamadas.push({ nombre, contexto, entrada });
    return Promise.resolve(composicion.resultado ?? { ok: true, dato: nombre });
  };
  return {
    generarPedidoDeCertificado: delegada("generarPedidoDeCertificado"),
    cargarCertificado: delegada("cargarCertificado"),
    estadoDeCertificados: (_d: unknown, contexto: unknown, entrada: unknown) => {
      composicion.llamadas.push({ nombre: "certificados", contexto, entrada });
      return Promise.resolve(composicion.certificados);
    },
  };
});

import {
  cargarElCertificado,
  cargarLosCertificados,
  generarElPedidoDeCertificado,
} from "../../apps/web/servidor/certificado-de-arca";

beforeEach(() => {
  composicion.llamadas = [];
  composicion.resultado = null;
  registro.registrado = [];
});

describe("las acciones del certificado de ARCA del servidor", () => {
  it.each([
    ["generarPedidoDeCertificado", generarElPedidoDeCertificado],
    ["cargarCertificado", cargarElCertificado],
  ] as const)(
    "%s corre con el contexto de la sesión y el pedido tal cual",
    async (nombre, accion) => {
      const pedido = { id: "x", empresaId: "otra-empresa-que-manda-el-navegador" };
      expect(await accion(pedido)).toEqual({ ok: true, dato: nombre });
      expect(composicion.llamadas).toEqual([{ nombre, contexto: CONTEXTO, entrada: pedido }]);
    },
  );
});

describe("el mismo id con otros datos en las acciones del certificado", () => {
  it.each([
    ["generarPedidoDeCertificado", generarElPedidoDeCertificado],
    ["cargarCertificado", cargarElCertificado],
  ] as const)(
    "%s: sale el mensaje genérico con su referencia, no el de «comprobante»",
    async (_nombre, accion) => {
      composicion.resultado = { ok: false, error: errorDeCodigo("FISCAL_PEDIDO_REPETIDO") };
      const r = await accion({ id: "x" });
      expect(r).toMatchObject({
        ok: false,
        error: {
          codigo: "ERROR_INTERNO",
          presentacion: "INESPERADO",
          referencia: expect.stringMatching(/^PD-/) as string,
        },
      });
      expect(JSON.stringify(r)).not.toContain("pedido_repetido");
      expect(registro.registrado).toHaveLength(1);
    },
  );

  it("otros errores de la acción pasan tal cual", async () => {
    composicion.resultado = { ok: false, error: errorDeCodigo("SIN_PERMISO") };
    expect(await cargarElCertificado({})).toEqual(composicion.resultado);
    expect(registro.registrado).toHaveLength(0);
  });
});

describe("la lectura del certificado de ARCA", () => {
  it("el emisor sale del estado de la configuración (D-47), no del navegador", async () => {
    composicion.estado = { ok: true, dato: { emisorId: "emisor-principal" } };
    composicion.certificados = { ok: true, dato: [{ ambiente: "HOMOLOGACION" }] };
    expect(await cargarLosCertificados(CONTEXTO as never)).toEqual({
      ok: true,
      dato: { emisorId: "emisor-principal", certificados: [{ ambiente: "HOMOLOGACION" }] },
    });
    expect(composicion.llamadas).toEqual([
      { nombre: "estado", contexto: CONTEXTO, entrada: undefined },
      { nombre: "certificados", contexto: CONTEXTO, entrada: { emisorId: "emisor-principal" } },
    ]);
  });

  it("si el estado falla (sin permiso), responde ese error y no pide los certificados", async () => {
    composicion.estado = { ok: false, error: errorDeCodigo("SIN_PERMISO") };
    expect(await cargarLosCertificados(CONTEXTO as never)).toEqual(composicion.estado);
    expect(composicion.llamadas.map((l) => l.nombre)).toEqual(["estado"]);
  });

  it("si la consulta de certificados falla, responde ese error", async () => {
    composicion.estado = { ok: true, dato: { emisorId: "e" } };
    composicion.certificados = { ok: false, error: errorDeCodigo("SIN_PERMISO") };
    expect(await cargarLosCertificados(CONTEXTO as never)).toEqual(composicion.certificados);
  });

  it("una excepción sale como error inesperado con su referencia", async () => {
    composicion.estado = { ok: true, dato: { emisorId: "e" } };
    composicion.certificados = undefined;
    const r = await cargarLosCertificados(CONTEXTO as never);
    expect(r).toMatchObject({
      ok: false,
      error: { presentacion: "INESPERADO", referencia: expect.stringMatching(/^PD-/) as string },
    });
    expect(registro.registrado).toHaveLength(1);
  });
});
