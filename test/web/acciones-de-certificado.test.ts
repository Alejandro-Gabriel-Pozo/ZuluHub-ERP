import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` del certificado de ARCA (`apps/web/app/s/app/acciones-de-certificado.ts`; que la directiva sea lo primero no se
 * lee acá como texto —leer apps/ obliga a declarar la prueba en `planificar-mutacion.cjs`—: lo exige `next build`): solo
 * exporta las dos funciones asíncronas y cada una delega en su par de `servidor/certificado-de-arca.ts` con el pedido tal cual, sin decidir
 * nada (el permiso `certificados.gestionar` lo exige cada caso de uso dentro de su transacción).
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ llamadas: [] as { nombre: string; entrada: unknown }[] }));
vi.mock("../../apps/web/servidor/certificado-de-arca", () => {
  const delegada = (nombre: string) => (entrada?: unknown) => {
    delegadas.llamadas.push({ nombre, entrada });
    return Promise.resolve({ ok: true, dato: nombre });
  };
  return {
    generarElPedidoDeCertificado: delegada("generarElPedidoDeCertificado"),
    cargarElCertificado: delegada("cargarElCertificado"),
  };
});

import * as acciones from "../../apps/web/app/s/app/acciones-de-certificado";

const ESPERADAS = {
  generarPedidoDeCertificadoAccion: "generarElPedidoDeCertificado",
  cargarCertificadoAccion: "cargarElCertificado",
} as const;

describe("las acciones de servidor del certificado de ARCA expuestas a Next", () => {
  it("exporta exactamente las dos acciones, ambas funciones asíncronas", () => {
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
