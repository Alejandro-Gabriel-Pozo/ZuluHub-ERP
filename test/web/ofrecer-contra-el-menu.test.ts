import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../propiedades/configuracion";
import { seOfrece } from "../../src/capacidades/integracion/ofrecer";
import { CATALOGO_DE_MODULOS, type ClaveModulo } from "../../src/capacidades/modulos/catalogo";
import { FILAS_DEL_MENU } from "../../apps/web/ui/navegacion/menu";

/**
 * `seOfrece` es la regla única que usa el menú: para toda fila real del menú y toda combinación de permisos da lo mismo que la
 * expresión vieja de `armarElMenu` (copiada abajo como oráculo). Previene que el menú cambie de comportamiento al compartir la regla.
 */
const viejo = (
  f: { modulo: ClaveModulo; accion: string },
  p: {
    acciones: readonly string[];
    modulos: { activos: readonly string[]; enSoloLectura: readonly string[] };
  },
): boolean =>
  CATALOGO_DE_MODULOS[f.modulo].estado === "disponible" &&
  p.acciones.includes(f.accion) &&
  (p.modulos.activos.includes(f.modulo) || p.modulos.enSoloLectura.includes(f.modulo));

const FILAS = FILAS_DEL_MENU.flatMap((f) =>
  f.tipo === "accion" ? [] : [{ modulo: f.modulo, accion: f.accion }],
);

describe("seOfrece contra la expresión vieja del menú", () => {
  it("el menú real tiene filas con módulo", () => {
    expect(FILAS.length).toBeGreaterThan(0);
  });
  it("coinciden para toda fila y toda combinación de permisos", () => {
    const sub = (xs: readonly string[]) => fc.subarray([...xs]);
    const acciones = FILAS.map((f) => f.accion);
    const modulos = Object.keys(CATALOGO_DE_MODULOS);
    fc.assert(
      fc.property(
        fc.constantFrom(...FILAS),
        sub(acciones),
        sub(modulos),
        sub(modulos),
        (fila, a, activos, enSoloLectura) => {
          const permisos = { acciones: a, modulos: { activos, enSoloLectura } };
          expect(seOfrece(CATALOGO_DE_MODULOS, permisos, fila)).toBe(viejo(fila, permisos));
        },
      ),
    );
  });
});
