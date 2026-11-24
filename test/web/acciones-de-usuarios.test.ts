import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de «Usuarios» (`apps/web/app/s/app/acciones-de-usuarios.ts`, tramo U2): fino a propósito. Exporta funciones asíncronas y delega en `servidor/usuarios.ts`.
 * El id de la invitación llega del `.bind` (Next lo cifra), NO del formulario: aunque el formulario traiga otro, se usa el ligado. Ninguna acción redirige.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ llamadas: [] as unknown[][] }));
vi.mock("../../apps/web/servidor/usuarios", () => ({
  invitarAUnUsuario: (...args: unknown[]) => {
    delegadas.llamadas.push(["invitar", ...args]);
    return Promise.resolve({ estado: "HECHO" });
  },
  reenviarUnaInvitacion: (...args: unknown[]) => {
    delegadas.llamadas.push(["reenviar", ...args]);
    return Promise.resolve({ estado: "HECHO", ruta: "/cuenta/usuarios/invitaciones/nueva" });
  },
  revocarUnaInvitacion: (...args: unknown[]) => {
    delegadas.llamadas.push(["revocar", ...args]);
    return Promise.resolve({ estado: "HECHO", ruta: "/cuenta/usuarios" });
  },
  guardarLasSucursalesDeUnEmpleado: (...args: unknown[]) => {
    delegadas.llamadas.push(["sucursales", ...args]);
    return Promise.resolve({ error: null });
  },
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("ninguna acción de Usuarios redirige");
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-usuarios";

const INICIAL = { estado: "INICIAL" } as const;

describe("las acciones de servidor de «Usuarios» expuestas a Next", () => {
  it("exporta solo las cuatro (tramos U2 y U4), asíncronas", () => {
    expect(Object.keys(acciones).sort()).toEqual([
      "asignarSucursalesAccion",
      "invitarUsuarioAccion",
      "reenviarInvitacionAccion",
      "revocarInvitacionAccion",
    ]);
    for (const f of Object.values(acciones)) expect(f.constructor.name).toBe("AsyncFunction");
  });

  it("invitar delega con el formulario tal cual (la lista blanca está en la composición)", async () => {
    const datos = new FormData();
    datos.set("email", "a@x.test");
    datos.set("empresaId", "otra");
    delegadas.llamadas.length = 0;
    expect(await acciones.invitarUsuarioAccion(INICIAL, datos)).toEqual({ estado: "HECHO" });
    expect(delegadas.llamadas).toEqual([["invitar", datos]]);
  });

  it("reenviar y revocar usan el id ligado con `.bind`, no uno que venga en el formulario", async () => {
    const datos = new FormData();
    datos.set("invitacionId", "el-del-formulario");
    delegadas.llamadas.length = 0;
    const reenviar = acciones.reenviarInvitacionAccion.bind(null, "el-ligado");
    const revocar = acciones.revocarInvitacionAccion.bind(null, "el-ligado");
    expect(await reenviar(INICIAL, datos)).toEqual({
      estado: "HECHO",
      ruta: "/cuenta/usuarios/invitaciones/nueva",
    });
    expect(await revocar(INICIAL, datos)).toEqual({ estado: "HECHO", ruta: "/cuenta/usuarios" });
    expect(delegadas.llamadas).toEqual([
      ["reenviar", "el-ligado"],
      ["revocar", "el-ligado"],
    ]);
  });

  it("U4: guardar las sucursales usa la persona ligada con `.bind` y el formulario tal cual, sin redirigir", async () => {
    const datos = new FormData();
    datos.append("sucursales", "s-1");
    datos.set("personaId", "la-del-formulario");
    delegadas.llamadas.length = 0;
    const guardar = acciones.asignarSucursalesAccion.bind(null, "la-ligada");
    expect(await guardar({ error: null }, datos)).toEqual({ error: null });
    expect(delegadas.llamadas).toEqual([["sucursales", "la-ligada", datos]]);
  });
});
