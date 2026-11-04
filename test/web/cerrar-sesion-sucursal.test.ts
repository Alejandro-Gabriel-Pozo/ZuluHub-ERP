import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cerrar sesión borra también la sucursal del listado (D-34): la persona que use después el mismo celular no hereda la elección.
 * Se vence con los mismos atributos con que se fijó: una cookie `__Host-` exige `Secure` y `Path=/`, y un borrado por nombre no los
 * manda. Previene: heredar la sucursal de otra persona. Chequeo: esta prueba (y `test/integracion/web-acciones.test.ts` con base).
 */
vi.mock("server-only", () => ({}));

const estado = vi.hoisted(() => ({
  escrituras: [] as { nombre: string; valor: string; opciones: Record<string, unknown> }[],
  borrados: [] as string[],
}));

class Redireccion extends Error {
  constructor(readonly destino: string) {
    super(destino);
  }
}

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      set: (nombre: string, valor: string, opciones: Record<string, unknown> = {}) => {
        estado.escrituras.push({ nombre, valor, opciones });
      },
      delete: (nombre: string) => {
        estado.borrados.push(nombre);
      },
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Redireccion(destino);
  },
}));
vi.mock("../../apps/web/servidor/pedido", () => ({
  exigirPuerta: () => Promise.resolve({ host: "app.ejemplo.test" }),
}));
vi.mock("../../src/capacidades/experiencia/origen", () => ({ origenEsPropio: () => true }));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: { respuesta: { registrar: () => undefined } },
  sesionDelPedido: () => Promise.resolve({ sesion: {}, puerta: {} }),
}));
vi.mock("../../src/composicion/sesion-y-empresa", () => ({
  cerrarSesion: () => Promise.resolve({ ok: true, dato: { cookies: [] } }),
  elegirEmpresa: () => undefined,
  iniciarIngresoConGoogle: () => undefined,
  aceptarInvitacionDeLaSesion: () => undefined,
}));

beforeEach(() => {
  estado.escrituras = [];
  estado.borrados = [];
});

describe("cerrar sesión y la sucursal del listado", () => {
  it("vence la cookie de sucursal con los atributos de cuando se fijó, y vuelve a /ingreso", async () => {
    const { cerrarLaSesion } = await import("../../apps/web/servidor/acciones");
    await expect(cerrarLaSesion()).rejects.toMatchObject({ destino: "/ingreso" });
    const sucursal = estado.escrituras.filter((e) => e.nombre === "__Host-pd_sucursal");
    expect(sucursal).toEqual([
      {
        nombre: "__Host-pd_sucursal",
        valor: "",
        opciones: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 },
      },
    ]);
    // Ninguna `__Host-` se borra por nombre: la empresa y la invitación también se vencen con `set` (el detalle: cerrar-sesion-cookies.test.ts).
    expect(estado.borrados).toEqual([]);
  });
});
