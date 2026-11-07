import { describe, expect, it } from "vitest";
import {
  PEDERNAL_CORREO_REMITENTE,
  PEDERNAL_NOMBRE_DE_MARCA,
  PEDERNAL_RESEND_API_KEY,
  PEDERNAL_URL_BASE,
  leerConfiguracionDeCorreo,
} from "../../src/adaptadores/correo/configuracion";
import { validarNombreVisible } from "../../src/modulos/marcas/publico";

/**
 * El tope del nombre de la marca en el correo (`LARGO_MAXIMO_DE_MARCA`, `adaptadores/correo/configuracion.ts`) copia el de las marcas
 * (`LARGO_MAXIMO_DEL_NOMBRE`, `modulos/marcas/dominio/definicion.ts`, no exportado): la copia solo se admite con una prueba que falle
 * si difieren. Falla que previene: subir uno y no el otro, y que el correo diga una marca distinta de la que la plataforma aceptó.
 * Se compara el COMPORTAMIENTO (qué largos acepta cada uno), entrando a marcas solo por su `publico.ts`.
 */

const ENTORNO = {
  [PEDERNAL_RESEND_API_KEY]: "clave-de-prueba-123",
  [PEDERNAL_CORREO_REMITENTE]: "no-responder@ejemplo.test",
  [PEDERNAL_URL_BASE]: "https://app.ejemplo.test",
};

const aceptaElCorreo = (nombre: string): boolean => {
  try {
    leerConfiguracionDeCorreo({ ...ENTORNO, [PEDERNAL_NOMBRE_DE_MARCA]: nombre });
    return true;
  } catch {
    return false;
  }
};
const aceptanLasMarcas = (nombre: string): boolean => validarNombreVisible(nombre).ok;

/** Los largos de 1 a `hasta` en los que los dos no coinciden. */
const largosQueDifieren = (
  correo: (nombre: string) => boolean,
  marcas: (nombre: string) => boolean,
  hasta: number,
): number[] =>
  Array.from({ length: hasta }, (_, i) => i + 1).filter(
    (largo) => correo("x".repeat(largo)) !== marcas("x".repeat(largo)),
  );

describe("el tope del nombre de marca del correo es el de las marcas", () => {
  it("aceptan y rechazan los mismos largos (hay un tope: alguno se rechaza)", () => {
    expect(aceptanLasMarcas("x".repeat(1))).toBe(true);
    expect(aceptanLasMarcas("x".repeat(200))).toBe(false);
    expect(largosQueDifieren(aceptaElCorreo, aceptanLasMarcas, 200)).toEqual([]);
  });

  it("violación inyectada: un tope distinto en el correo se detecta", () => {
    const correoConTope = (tope: number) => (nombre: string) => nombre.length <= tope;
    expect(largosQueDifieren(correoConTope(61), aceptanLasMarcas, 200)).toEqual([61]);
    expect(largosQueDifieren(correoConTope(59), aceptanLasMarcas, 200)).toEqual([60]);
  });
});
