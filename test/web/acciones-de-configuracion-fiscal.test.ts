import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de Puntos de venta (`apps/web/app/s/app/acciones-de-configuracion-fiscal.ts`): lo que expone a Next. Fino a
 * propósito: la directiva va PRIMERO, solo exporta funciones asíncronas y cada una delega en su par de
 * `servidor/configuracion-fiscal.ts` con el pedido tal cual, sin decidir nada.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ llamadas: [] as { nombre: string; entrada: unknown }[] }));
vi.mock("../../apps/web/servidor/configuracion-fiscal", () => {
  const delegada = (nombre: string) => (entrada?: unknown) => {
    delegadas.llamadas.push({ nombre, entrada });
    return Promise.resolve({ ok: true, dato: nombre });
  };
  return {
    crearElPuntoDeVenta: delegada("crearElPuntoDeVenta"),
    editarElPuntoDeVenta: delegada("editarElPuntoDeVenta"),
    activarElPuntoDeVenta: delegada("activarElPuntoDeVenta"),
    desactivarElPuntoDeVenta: delegada("desactivarElPuntoDeVenta"),
  };
});

import * as acciones from "../../apps/web/app/s/app/acciones-de-configuracion-fiscal";

const ARCHIVO = "apps/web/app/s/app/acciones-de-configuracion-fiscal.ts";

const ESPERADAS = {
  crearPuntoDeVentaAccion: "crearElPuntoDeVenta",
  editarPuntoDeVentaAccion: "editarElPuntoDeVenta",
  activarPuntoDeVentaAccion: "activarElPuntoDeVenta",
  desactivarPuntoDeVentaAccion: "desactivarElPuntoDeVenta",
} as const;

describe("las acciones de servidor de Puntos de venta expuestas a Next", () => {
  it("la directiva «use server» es lo primero del archivo", () => {
    expect(readFileSync(ARCHIVO, "utf8").startsWith('"use server";')).toBe(true);
  });

  it("exporta exactamente las cuatro acciones, todas funciones asíncronas", () => {
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
      expect(await accion(entrada)).toEqual({ ok: true, dato: par });
      expect(delegadas.llamadas).toEqual([{ nombre: par, entrada }]);
    },
  );
});
