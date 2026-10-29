import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";

/**
 * `apps/web/servidor/configuracion-fiscal.ts`: resuelve el emisor y la empresa DEL SERVIDOR (nunca del navegador) y delega. Lo que hace
 * cada caso de uso está probado con la base real en `test/integracion/fiscal-configuracion-web.test.ts`.
 */
vi.mock("server-only", () => ({}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: { casosDeUsoDeConfiguracionFiscal: () => ({}), consultasDeFacturacion: () => ({}) },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({ dependenciasDeSesion: { respuesta: {} } }));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
vi.mock("../../apps/web/servidor/facturacion", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => unknown) => hacer(CONTEXTO),
}));
const composicion = vi.hoisted(
  (): {
    llamadas: { nombre: string; contexto: unknown; entrada: unknown }[];
    estado: unknown;
    puntos: unknown;
  } => ({ llamadas: [], estado: null, puntos: null }),
);

vi.mock("../../src/composicion/configuracion-fiscal-web", () => {
  const delegada = (nombre: string) => (_d: unknown, contexto: unknown, entrada?: unknown) => {
    composicion.llamadas.push({ nombre, contexto, entrada });
    return Promise.resolve({ ok: true, dato: nombre });
  };
  return {
    crearPuntoDeVenta: delegada("crearPuntoDeVenta"),
    editarPuntoDeVenta: delegada("editarPuntoDeVenta"),
    activarPuntoDeVenta: delegada("activarPuntoDeVenta"),
    desactivarPuntoDeVenta: delegada("desactivarPuntoDeVenta"),
    estadoDeLaConfiguracionFiscal: (_d: unknown, contexto: unknown) => {
      composicion.llamadas.push({ nombre: "estado", contexto, entrada: undefined });
      return Promise.resolve(composicion.estado);
    },
    puntosDeVentaDelEmisor: (_d: unknown, contexto: unknown, entrada: unknown) => {
      composicion.llamadas.push({ nombre: "puntos", contexto, entrada });
      return Promise.resolve(composicion.puntos);
    },
  };
});

import {
  activarElPuntoDeVenta,
  cargarElEstadoDeLaConfiguracion,
  cargarLosPuntosDeVenta,
  crearElPuntoDeVenta,
  desactivarElPuntoDeVenta,
  editarElPuntoDeVenta,
} from "../../apps/web/servidor/configuracion-fiscal";

beforeEach(() => {
  composicion.llamadas = [];
});

describe("las acciones de Puntos de venta del servidor", () => {
  it.each([
    ["crearPuntoDeVenta", crearElPuntoDeVenta],
    ["editarPuntoDeVenta", editarElPuntoDeVenta],
    ["activarPuntoDeVenta", activarElPuntoDeVenta],
    ["desactivarPuntoDeVenta", desactivarElPuntoDeVenta],
  ] as const)(
    "%s corre con el contexto de la sesión y el pedido tal cual",
    async (nombre, accion) => {
      const pedido = { id: "x", empresaId: "otra-empresa-que-manda-el-navegador" };
      expect(await accion(pedido)).toEqual({ ok: true, dato: nombre });
      expect(composicion.llamadas).toEqual([{ nombre, contexto: CONTEXTO, entrada: pedido }]);
    },
  );
});

describe("las lecturas de Puntos de venta", () => {
  it("el emisor sale del estado de la configuración (D-47), no del navegador", async () => {
    composicion.estado = { ok: true, dato: { emisorId: "emisor-principal" } };
    composicion.puntos = { ok: true, dato: { emisorId: "emisor-principal", items: [] } };
    expect(await cargarLosPuntosDeVenta(CONTEXTO as never)).toEqual(composicion.puntos);
    expect(composicion.llamadas).toEqual([
      { nombre: "estado", contexto: CONTEXTO, entrada: undefined },
      { nombre: "puntos", contexto: CONTEXTO, entrada: { emisorId: "emisor-principal" } },
    ]);
  });

  it("si el estado falla (sin permiso), responde ese error y no pide los puntos de venta", async () => {
    composicion.estado = { ok: false, error: errorDeCodigo("SIN_PERMISO") };
    expect(await cargarLosPuntosDeVenta(CONTEXTO as never)).toEqual(composicion.estado);
    expect(composicion.llamadas.map((l) => l.nombre)).toEqual(["estado"]);
  });

  it("el estado de la configuración se pide con el contexto de la página", async () => {
    composicion.estado = { ok: true, dato: { emisorId: "e" } };
    expect(await cargarElEstadoDeLaConfiguracion(CONTEXTO as never)).toEqual(composicion.estado);
    expect(composicion.llamadas).toEqual([
      { nombre: "estado", contexto: CONTEXTO, entrada: undefined },
    ]);
  });
});
