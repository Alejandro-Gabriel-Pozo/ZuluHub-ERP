import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` del facturador (`apps/web/app/s/app/acciones-de-facturacion.ts`): lo que expone a Next. Es fino a
 * propósito: la directiva va PRIMERO (si no, Next no lo trata como acciones de servidor), solo exporta funciones asíncronas
 * (Next rechaza cualquier otra cosa en ese archivo) y cada una delega en su par de `servidor/facturacion.ts` con el pedido
 * tal cual, sin decidir nada. Lo que hace cada una está probado con la base real en `test/integracion/web-facturacion.test.ts`.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ llamadas: [] as { nombre: string; entrada: unknown }[] }));
vi.mock("../../apps/web/servidor/facturacion", () => {
  const delegada = (nombre: string) => (entrada?: unknown) => {
    delegadas.llamadas.push({ nombre, entrada });
    return Promise.resolve({ ok: true, dato: nombre });
  };
  return {
    emitirLaFactura: delegada("emitirLaFactura"),
    emitirLaNotaDeCredito: delegada("emitirLaNotaDeCredito"),
    emitirLaNotaDeDebito: delegada("emitirLaNotaDeDebito"),
    descartarElComprobante: delegada("descartarElComprobante"),
    reintentarElComprobante: delegada("reintentarElComprobante"),
    resincronizarLaSerie: delegada("resincronizarLaSerie"),
    cambiarElAmbiente: delegada("cambiarElAmbiente"),
    listarLosComprobantes: delegada("listarLosComprobantes"),
    verElComprobante: delegada("verElComprobante"),
  };
});

import * as acciones from "../../apps/web/app/s/app/acciones-de-facturacion";

const ARCHIVO = "apps/web/app/s/app/acciones-de-facturacion.ts";

const ESPERADAS = {
  emitirFacturaAccion: "emitirLaFactura",
  emitirNotaDeCreditoAccion: "emitirLaNotaDeCredito",
  emitirNotaDeDebitoAccion: "emitirLaNotaDeDebito",
  descartarComprobanteAccion: "descartarElComprobante",
  reintentarComprobanteAccion: "reintentarElComprobante",
  resincronizarSerieAccion: "resincronizarLaSerie",
  cambiarAmbienteAccion: "cambiarElAmbiente",
  listarComprobantesAccion: "listarLosComprobantes",
  verComprobanteAccion: "verElComprobante",
} as const;

describe("las acciones de servidor del facturador expuestas a Next", () => {
  it("la directiva «use server» es lo primero del archivo", () => {
    const codigo = readFileSync(ARCHIVO, "utf8");
    expect(codigo.startsWith('"use server";')).toBe(true);
  });

  it("exporta exactamente las nueve acciones, todas funciones asíncronas", () => {
    expect(Object.keys(acciones).sort()).toEqual(Object.keys(ESPERADAS).sort());
    for (const accion of Object.values(acciones)) {
      expect(accion.constructor.name).toBe("AsyncFunction");
    }
  });

  it.each(Object.entries(ESPERADAS))(
    "%s delega en %s con el pedido tal cual",
    async (nombre, par) => {
      delegadas.llamadas.length = 0;
      const entrada = { cualquier: "cosa", empresaId: "no-se-toca-acá" };
      const accion = acciones[nombre as keyof typeof ESPERADAS] as (
        e?: unknown,
      ) => Promise<unknown>;
      const r = await accion(entrada);
      expect(r).toEqual({ ok: true, dato: par });
      expect(delegadas.llamadas).toEqual([{ nombre: par, entrada }]);
    },
  );
});
