import { describe, expect, it } from "vitest";
import {
  RUTA_DE_LAS_CUENTAS_DE_FOTOS,
  armarLasCuentasDeFotos,
} from "../../apps/web/ui/plantillas/carta/modelo-de-cuentas-de-fotos";

/**
 * El modelo de vista de «Conectá tu cuenta de fotos»: solo textos del catálogo (dos propuestos, DEC-CAT-001, y el resto ya aprobados), una fila por cuenta activa con su versión y nada de permisos
 * (los decide el servidor: sin el permiso la pantalla ni se arma).
 */
const CUENTAS = [
  { id: "c-1", cuenta: "mi-hotel", version: 1 },
  { id: "c-2", cuenta: "agencia_2", version: 4 },
];

describe("armarLasCuentasDeFotos", () => {
  it("los textos salen del catálogo: título y rótulo propuestos, y «Guardar», «Quitar» y «Motivo» ya aprobados", () => {
    const m = armarLasCuentasDeFotos(CUENTAS);
    expect(m.titulo).toBe("Conectá tu cuenta de fotos");
    expect(m.declarar).toEqual({ cuenta: "Pegá el nombre de tu cuenta", guardar: "Guardar" });
    expect(m.retirar).toEqual({ motivo: "Motivo", quitar: "Quitar" });
  });

  it("una fila por cuenta, en el orden que llega, con su id y la versión que se vio", () => {
    expect(armarLasCuentasDeFotos(CUENTAS).cuentas).toEqual(CUENTAS);
  });

  it("sin cuentas, la lista queda vacía y el formulario de declarar sigue", () => {
    const m = armarLasCuentasDeFotos([]);
    expect(m.cuentas).toEqual([]);
    expect(m.declarar.guardar).toBe("Guardar");
  });

  it("la ruta es la propia, hermana de «Carta en línea»", () => {
    expect(RUTA_DE_LAS_CUENTAS_DE_FOTOS).toBe("/catalogo/carta-en-linea/cuentas-de-fotos");
  });
});
