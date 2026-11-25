import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` del directorio (`apps/web/app/s/app/acciones-de-directorio.ts`): fino a propósito. La clave de creación, la parte y la versión llegan ligadas por la página (`.bind`)
 * y no del formulario; los roles salen SOLO de las dos casillas; ninguna acción redirige. Delega en `servidor/directorio.ts`, que acá es falso.
 * Previene: que el navegador fije la clave de idempotencia, la parte o la versión; que un `roles` escrito a mano en el formulario dé un rol que ninguna casilla marcó; que una acción corte con un `redirect`.
 */
vi.mock("server-only", () => ({}));
const redirige = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect: redirige }));
const delegadas = vi.hoisted(() => ({
  guardar: [] as { parteId: string | null; version: number | null; datos: FormData }[],
  estado: [] as unknown[][],
}));
vi.mock("../../apps/web/servidor/directorio", () => ({
  guardarLaParteDelFormulario: (
    parteId: string | null,
    version: number | null,
    datos: FormData,
  ) => {
    delegadas.guardar.push({ parteId, version, datos });
    return Promise.resolve({ error: null, guardada: true, duplicados: [] });
  },
  desactivarLaParteDelDirectorio: (parteId: string) => {
    delegadas.estado.push(["desactivar", parteId]);
    return Promise.resolve({ error: null });
  },
  reactivarLaParteDelDirectorio: (parteId: string) => {
    delegadas.estado.push(["reactivar", parteId]);
    return Promise.resolve({ error: null });
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-directorio";

const PREVIO = { error: null, guardada: false, duplicados: [] };
const formulario = (campos: Record<string, string> = {}): FormData => {
  const datos = new FormData();
  for (const [k, v] of Object.entries(campos)) datos.set(k, v);
  return datos;
};
const ultimo = () => {
  const u = delegadas.guardar.at(-1);
  if (u === undefined) throw new Error("no se delegó nada");
  return u;
};

describe("las acciones de servidor del directorio expuestas a Next", () => {
  it("exporta solo las cuatro acciones, asíncronas", () => {
    expect(Object.keys(acciones).sort()).toEqual([
      "crearParteAccion",
      "desactivarParteAccion",
      "editarParteAccion",
      "reactivarParteAccion",
    ]);
    for (const accion of Object.values(acciones)) {
      expect(accion.constructor.name).toBe("AsyncFunction");
    }
  });

  it("el alta lleva la clave ligada, que pisa cualquier `idempotencia` del formulario, y no lleva parte ni versión", async () => {
    const r = await acciones.crearParteAccion(
      "clave-de-la-pagina",
      PREVIO,
      formulario({ nombre: "Ana", idempotencia: "clave-del-navegador", parteId: "otra" }),
    );
    expect(r).toEqual({ error: null, guardada: true, duplicados: [] });
    expect(ultimo()).toMatchObject({ parteId: null, version: null });
    expect(ultimo().datos.get("idempotencia")).toBe("clave-de-la-pagina");
    expect(ultimo().datos.get("nombre")).toBe("Ana");
  });

  it("los roles salen SOLO de las dos casillas: un `roles` escrito a mano se descarta", async () => {
    const datos = formulario({ rolCliente: "on" });
    datos.append("roles", "PROVEEDOR");
    datos.append("roles", "EMPLEADO");
    await acciones.crearParteAccion("c", PREVIO, datos);
    expect(ultimo().datos.getAll("roles")).toEqual(["CUSTOMER"]);

    await acciones.crearParteAccion(
      "c",
      PREVIO,
      formulario({ rolCliente: "on", rolProveedor: "on" }),
    );
    expect(ultimo().datos.getAll("roles")).toEqual(["CUSTOMER", "PROVEEDOR"]);

    await acciones.crearParteAccion("c", PREVIO, formulario({ rolProveedor: "on" }));
    expect(ultimo().datos.getAll("roles")).toEqual(["PROVEEDOR"]);

    await acciones.crearParteAccion("c", PREVIO, formulario());
    expect(ultimo().datos.getAll("roles")).toEqual([]);
  });

  it("una casilla que no vale exactamente «on» no marca el rol", async () => {
    await acciones.crearParteAccion(
      "c",
      PREVIO,
      formulario({ rolCliente: "1", rolProveedor: "true" }),
    );
    expect(ultimo().datos.getAll("roles")).toEqual([]);
  });

  it("editar lleva la parte y la versión que se vio, ligadas, y la clave de envío ligada; los roles igual que el alta", async () => {
    await acciones.editarParteAccion(
      "parte-1",
      7,
      "clave-de-envio",
      PREVIO,
      formulario({ idempotencia: "x", rolProveedor: "on", versionEsperada: "99", parteId: "otra" }),
    );
    expect(ultimo()).toMatchObject({ parteId: "parte-1", version: 7 });
    expect(ultimo().datos.get("idempotencia")).toBe("clave-de-envio");
    expect(ultimo().datos.getAll("roles")).toEqual(["PROVEEDOR"]);
  });

  it("desactivar y reactivar llevan la parte ligada, sin el estado anterior", async () => {
    expect(await acciones.desactivarParteAccion("parte-2", { error: null })).toEqual({
      error: null,
    });
    expect(await acciones.reactivarParteAccion("parte-3", { error: null })).toEqual({
      error: null,
    });
    expect(delegadas.estado).toEqual([
      ["desactivar", "parte-2"],
      ["reactivar", "parte-3"],
    ]);
  });

  it("ninguna acción redirige", async () => {
    await acciones.crearParteAccion("c", PREVIO, formulario());
    await acciones.editarParteAccion("p", 1, "c", PREVIO, formulario());
    await acciones.desactivarParteAccion("p", { error: null });
    await acciones.reactivarParteAccion("p", { error: null });
    expect(redirige).not.toHaveBeenCalled();
  });
});
