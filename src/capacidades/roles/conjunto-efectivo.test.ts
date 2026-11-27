import { describe, expect, it } from "vitest";
import { conjuntoEfectivo, type FuentesDelConjunto } from "./conjunto-efectivo";

const CATALOGO = new Set(["ventas.ver", "ventas.crear", "caja.abrir", "usuarios.invitar"]);

function fuentes(sobre: Partial<FuentesDelConjunto> = {}): FuentesDelConjunto {
  return {
    catalogo: CATALOGO,
    plantilla: (clave) =>
      clave === "ADMINISTRADOR" ? ["ventas.ver", "ventas.crear"] : ["ventas.ver"],
    rolPropio: { activo: true, acciones: ["caja.abrir"] },
    ...sobre,
  };
}

const como = (rol: Parameters<typeof conjuntoEfectivo>[0], f = fuentes()) =>
  [...conjuntoEfectivo(rol, f)].sort();

describe("conjunto efectivo", () => {
  it("el gerente tiene todo el catálogo, sin leer plantilla ni rol propio", () => {
    const f = fuentes({
      plantilla: () => {
        throw new Error("el gerente no lee plantilla");
      },
      rolPropio: null,
    });
    expect(como("GERENTE", f)).toEqual([...CATALOGO].sort());
  });

  it("el conjunto del gerente es una copia: modificarlo no toca el catálogo", () => {
    const copia = conjuntoEfectivo("GERENTE", fuentes()) as Set<string>;
    copia.delete("ventas.ver");
    expect(CATALOGO.has("ventas.ver")).toBe(true);
  });

  it("administrador y operador siguen su plantilla vigente", () => {
    expect(como("ADMINISTRADOR")).toEqual(["ventas.crear", "ventas.ver"]);
    expect(como("OPERADOR")).toEqual(["ventas.ver"]);
  });

  it("un rol propio activo tiene las acciones de su versión vigente", () => {
    expect(como("PROPIO")).toEqual(["caja.abrir"]);
  });

  it("una clave que ya no está en el catálogo no otorga nada y no bloquea las demás (S10)", () => {
    const f = fuentes({
      plantilla: () => ["ventas.ver", "retirada.accion"],
      rolPropio: { activo: true, acciones: ["retirada.accion", "caja.abrir"] },
    });
    expect(como("OPERADOR", f)).toEqual(["ventas.ver"]);
    expect(como("PROPIO", f)).toEqual(["caja.abrir"]);
  });

  it("nace cerrado: sin rol, sin plantilla legible, sin rol propio o archivado, el conjunto es vacío", () => {
    expect(como(null)).toEqual([]);
    expect(como("ADMINISTRADOR", fuentes({ plantilla: () => null }))).toEqual([]);
    expect(como("OPERADOR", fuentes({ plantilla: () => null }))).toEqual([]);
    expect(como("PROPIO", fuentes({ rolPropio: null }))).toEqual([]);
    expect(
      como("PROPIO", fuentes({ rolPropio: { activo: false, acciones: ["caja.abrir"] } })),
    ).toEqual([]);
  });

  it("un rol que no existe da vacío, aunque haya datos para los demás", () => {
    expect(como("SUPERUSUARIO" as never)).toEqual([]);
  });
});
