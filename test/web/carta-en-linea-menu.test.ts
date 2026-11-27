import { describe, expect, it } from "vitest";
import { armarElMenu, FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";

/**
 * La entrada «Carta en línea» del menú (Catálogo, grupo «Carta»): sale solo con `vidrieras.ver`, el módulo `vidriera` activo o en solo lectura y la
 * perilla `vidriera_por_qr` encendida y leída. Es solo la ayuda: la pantalla vuelve a decidir con su guard. «Cuentas de fotos» no tiene entrada (DEC-CAT-002).
 */
const permisos = (
  acciones: string[],
  activos: string[],
  funcionesEncendidas?: string[],
  enSoloLectura: string[] = [],
) => ({
  acciones,
  modulos: { activos, enSoloLectura },
  ...(funcionesEncendidas === undefined ? {} : { funcionesEncendidas }),
});
const entradas = (p: ReturnType<typeof permisos> | null) =>
  armarElMenu(FILAS_DEL_MENU, p, null)
    .flatMap((area) => area.grupos)
    .flatMap((grupo) => grupo.items)
    .filter((item) => item.clave === "carta-en-linea");

describe("la entrada «Carta en línea» del menú", () => {
  it("con vidrieras.ver, el módulo activo y la perilla encendida: la fila, con su dirección y su texto aprobado", () => {
    expect(entradas(permisos(["vidrieras.ver"], ["vidriera"], ["vidriera_por_qr"]))).toEqual([
      {
        tipo: "pantalla",
        clave: "carta-en-linea",
        etiqueta: "catalogo.carta.titulo",
        href: "/catalogo/carta-en-linea",
      },
    ]);
  });

  it("con el módulo en solo lectura también se ofrece", () => {
    expect(
      entradas(permisos(["vidrieras.ver"], [], ["vidriera_por_qr"], ["vidriera"])),
    ).toHaveLength(1);
  });

  it("sin la perilla encendida no se ofrece", () => {
    expect(entradas(permisos(["vidrieras.ver"], ["vidriera"], []))).toEqual([]);
    expect(entradas(permisos(["vidrieras.ver"], ["vidriera"], ["salon"]))).toEqual([]);
  });

  it("con la perilla sin leer no se ofrece (cierra, no abre)", () => {
    expect(entradas(permisos(["vidrieras.ver"], ["vidriera"]))).toEqual([]);
  });

  it("sin vidrieras.ver no se ofrece", () => {
    expect(entradas(permisos(["productos.ver"], ["vidriera"], ["vidriera_por_qr"]))).toEqual([]);
  });

  it("con el módulo apagado no se ofrece, aunque haya acción y perilla", () => {
    expect(entradas(permisos(["vidrieras.ver"], ["caja"], ["vidriera_por_qr"]))).toEqual([]);
  });

  it("si no se pudieron leer los permisos, no se ofrece", () => {
    expect(entradas(null)).toEqual([]);
  });

  it("vive en Catálogo, grupo Carta, y «Cuentas de fotos» no tiene fila", () => {
    expect(FILAS_DEL_MENU.find((f) => f.clave === "carta-en-linea")).toMatchObject({
      area: "catalogo",
      grupo: "carta",
      modulo: "vidriera",
      accion: "vidrieras.ver",
      perilla: "vidriera_por_qr",
      departamento: null,
    });
    expect(
      FILAS_DEL_MENU.some((f) => f.tipo === "pantalla" && f.href.includes("cuentas-de-fotos")),
    ).toBe(false);
  });
});
