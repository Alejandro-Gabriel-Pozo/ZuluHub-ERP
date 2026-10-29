import { describe, expect, it, vi } from "vitest";

/**
 * La barra de módulos (D-13): «Comprobantes» se muestra hoy a TODAS las empresas, sin mirar `comprobantes.ver` ni si facturación está
 * habilitada. Es una limitación conocida: la composición de la web (`armarWeb`) todavía no expone los permisos efectivos de la persona ni
 * los módulos de la empresa. Pendiente del tramo T-D del backend (mensaje del backend del 2026-10-29). Esta prueba lo documenta: cuando
 * T-D entregue la consulta, la entrada se filtra en `destinosDeModulos` y esta prueba se reemplaza por una que la oculte sin permiso.
 */
vi.mock("server-only", () => ({}));

const RUTA = "../../apps/web/servidor/modulos";
// Ruta en una variable: el tipado de la raíz no arrastra los archivos del navegador que importa la barra.
const cargar = (ruta: string): Promise<{ destinosDeModulos: () => readonly { clave: string }[] }> =>
  import(/* @vite-ignore */ ruta);

describe("destinosDeModulos (pendiente de T-D)", () => {
  it("declara «Comprobantes» sin filtrar por permiso ni por módulo habilitado; el servidor rechaza lo que no corresponde", async () => {
    const { destinosDeModulos } = await cargar(RUTA);
    expect(destinosDeModulos().map((d) => d.clave)).toEqual(["comprobantes"]);
  });
});
