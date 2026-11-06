import { describe, expect, it } from "vitest";
import {
  camposDelClienteInvalidos,
  clienteInicial,
  conDocumento,
  type ClienteEscrito,
} from "../../apps/web/ui/plantillas/facturacion/eleccion-de-emision";

/**
 * Qué campos del cliente de «Emitir» se marcan al tocar «Siguiente» (dueño, 2026-11-06, Q21): los que no cumplen la regla de su dato
 * (las mismas primitivas del servidor). Previene el fallo real de la primera prueba en Preview: un CUIT escrito como nombre pasaba.
 */
const BIEN: ClienteEscrito = {
  ...clienteInicial,
  documento: "CUIT",
  numero: "30-71234567-1",
  nombre: "Distribuidora Sur SA",
  domicilio: "Av. Siempreviva 742",
  condicionIva: "RESPONSABLE_INSCRIPTO",
};
const con = (cambios: Partial<ClienteEscrito>): ClienteEscrito => ({ ...BIEN, ...cambios });
const nada = { numero: false, nombre: false, domicilio: false };

describe("camposDelClienteInvalidos", () => {
  it("un cliente bien escrito no marca nada", () => {
    expect(camposDelClienteInvalidos(BIEN)).toEqual(nada);
  });

  it("el consumidor final sin identificar no escribe nada: lo que haya quedado escrito no se mira", () => {
    const cf = conDocumento(
      { ...clienteInicial, numero: "basura <>", nombre: "12345", domicilio: "\u0007" },
      "SIN_IDENTIFICAR",
    );
    expect(camposDelClienteInvalidos(cf)).toEqual(nada);
  });

  it("DNI: con puntos de miles o sin ellos pasa; con otro separador, no", () => {
    const dni = (numero: string) => con({ documento: "DNI", numero });
    expect(camposDelClienteInvalidos(dni("12.345.678")).numero).toBe(false);
    expect(camposDelClienteInvalidos(dni("12345678")).numero).toBe(false);
    for (const mal of ["abc", "12 345 678", "12,345,678", "12.345.67", "1234.567"]) {
      expect(camposDelClienteInvalidos(dni(mal)).numero, mal).toBe(true);
    }
  });

  it("CUIT: con guiones pasa; con el dígito verificador mal o con letras, no", () => {
    expect(camposDelClienteInvalidos(con({ numero: "30712345671" })).numero).toBe(false);
    for (const mal of ["30-71234567-2", "30-7123456-71", "3071234567a", ""]) {
      expect(camposDelClienteInvalidos(con({ numero: mal })).numero, mal).toBe(true);
    }
  });

  it("pasaporte con letras (ABC123456): se marca hasta que el pasaporte con letras tenga su propio PR", () => {
    const pasaporte = (numero: string) => con({ documento: "PASAPORTE", numero });
    expect(camposDelClienteInvalidos(pasaporte("ABC123456")).numero).toBe(true);
    expect(camposDelClienteInvalidos(pasaporte("123456")).numero).toBe(false);
  });

  it("nombre: sin letras, vacío o con un CUIT adentro de solo números se marca; uno normal no", () => {
    for (const mal of ["12345", "30-71234567-1", "", "   "]) {
      expect(camposDelClienteInvalidos(con({ nombre: mal })).nombre, mal).toBe(true);
    }
    expect(camposDelClienteInvalidos(con({ nombre: "  Hotel 9 de Julio " })).nombre).toBe(false);
  });

  it("domicilio: vacío no se marca (lo decide el servidor según la condición); uno con caracteres no permitidos sí", () => {
    expect(camposDelClienteInvalidos(con({ domicilio: "   " })).domicilio).toBe(false);
    for (const mal of ["Calle <b>1</b>", "Calle\n1", "😀"]) {
      expect(camposDelClienteInvalidos(con({ domicilio: mal })).domicilio, mal).toBe(true);
    }
  });
});
