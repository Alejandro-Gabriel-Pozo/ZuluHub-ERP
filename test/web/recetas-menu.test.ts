import { describe, expect, it } from "vitest";
import { armarElMenu, FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";

/**
 * La entrada «Recetas» del menú sale solo si la persona tiene `stock.ver` (gerente, administrador y operador) y el módulo `stock` está activo o en solo lectura. Previene: ofrecer la
 * pantalla a quien el servidor va a rechazar, con el módulo apagado, o si no se pudieron leer los permisos («todo nace cerrado»). Es solo la ayuda: la consulta vuelve a pasar por el guard.
 */
const permisos = (acciones: string[], activos: string[], enSoloLectura: string[] = []) => ({
  acciones,
  modulos: { activos, enSoloLectura },
});
const entradasDeRecetas = (p: ReturnType<typeof permisos> | null) =>
  armarElMenu(FILAS_DEL_MENU, p, null)
    .flatMap((area) => area.grupos)
    .flatMap((grupo) => grupo.items)
    .filter((item) => item.clave === "recetas");

describe("la entrada «Recetas» del menú", () => {
  it("con stock.ver y el módulo activo: la fila, con su dirección y su texto aprobado", () => {
    expect(entradasDeRecetas(permisos(["stock.ver"], ["stock"]))).toEqual([
      {
        tipo: "pantalla",
        clave: "recetas",
        etiqueta: "receta.pantalla.recetas",
        href: "/catalogo/recetas",
      },
    ]);
  });

  it("con el módulo en solo lectura también se ofrece (solo consulta)", () => {
    expect(entradasDeRecetas(permisos(["stock.ver"], [], ["stock"]))).toHaveLength(1);
  });

  it("sin stock.ver no se ofrece", () => {
    expect(
      entradasDeRecetas(permisos(["productos.ver", "composiciones.editar"], ["stock"])),
    ).toEqual([]);
  });

  it("con el módulo apagado no se ofrece, aunque la persona tenga la acción", () => {
    expect(entradasDeRecetas(permisos(["stock.ver"], ["caja"]))).toEqual([]);
  });

  it("si no se pudieron leer los permisos, no se ofrece (cierra, no abre)", () => {
    expect(entradasDeRecetas(null)).toEqual([]);
  });

  it("la fila vive en el área Catálogo, grupo Producción, y no pide perilla ni departamento", () => {
    const fila = FILAS_DEL_MENU.find((f) => f.clave === "recetas");
    expect(fila).toMatchObject({
      area: "catalogo",
      grupo: "produccion",
      modulo: "stock",
      accion: "stock.ver",
      perilla: null,
      departamento: null,
    });
  });
});
