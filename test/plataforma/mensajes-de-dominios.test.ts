import { describe, expect, it } from "vitest";
import { ERRORES_DE_DOMINIO_POR_RESTRICCION } from "../../src/modulos/marcas/publico";
import {
  MENSAJES_DE_ERROR_DE_DOMINIOS,
  mensajeDeErrorDeDominios,
} from "../../src/plataforma/casos-de-uso/mensajes-de-dominios";

/**
 * Los textos para la persona (M4a): castellano, con voseo, completos y SIN nada técnico: ni nombres de
 * tablas o restricciones, ni los códigos de los errores, ni SQL.
 */

const textos = Object.entries(MENSAJES_DE_ERROR_DE_DOMINIOS);
const errorDeLaBase = [
  { tipo: "Unicidad", restriccion: "dominio_host_uk" },
  { tipo: "Superposicion", restriccion: "x" },
  { tipo: "Referencia", restriccion: "dominio_duenio_marca_id_fkey" },
  { tipo: "Check", restriccion: "dominio_verificacion_ck" },
  { tipo: "AccesoDenegado" },
  { tipo: "ConcurrenciaAgotada" },
  { tipo: "Inesperado", sqlstate: "XX000", mensaje: 'relation "dominio" does not exist' },
] as const;

describe("los mensajes de los casos de dominios", () => {
  it("tiene un texto por cada error de negocio, y el texto se devuelve tal cual", () => {
    expect(textos.length).toBeGreaterThanOrEqual(26);
    for (const [error, texto] of textos) {
      expect(mensajeDeErrorDeDominios(error as keyof typeof MENSAJES_DE_ERROR_DE_DOMINIOS)).toBe(
        texto,
      );
    }
  });

  it("cada texto es una frase completa, en castellano, sin rastro técnico", () => {
    const prohibido = [
      /dominio_/i,
      /_uk\b/i,
      /_ck\b/i,
      /fkey/i,
      /constraint/i,
      /restricci[oó]n/i,
      /\btabla\b/i,
      /\bSQL\b/,
      /postgres/i,
      /\b[A-Z]{2,}_[A-Z_]+\b/, // un código de error en mayúsculas
      /undefined|null|\[object/i,
    ];
    for (const [error, texto] of textos) {
      expect(texto.length, error).toBeGreaterThan(15);
      expect(texto.length, error).toBeLessThanOrEqual(200);
      expect(texto, error).toMatch(/^[A-ZÁÉÍÓÚÑ¿]/);
      expect(texto, error).toMatch(/[.)]$/);
      expect(texto, error).toBe(texto.trim());
      for (const regla of prohibido) expect(texto, `${error} ${regla}`).not.toMatch(regla);
    }
  });

  it("habla de vos (rioplatense), no de tú ni de usted", () => {
    const conVoseo = textos.filter(([, t]) =>
      /\b(Escribilo|Elegí|Revisá|Probá|Volvé|Actualizá|Resumilo|Desactivalo|tenés)\b/.test(t),
    );
    expect(conVoseo.length).toBeGreaterThanOrEqual(4);
    for (const [error, texto] of textos) {
      expect(texto, error).not.toMatch(
        /\b(Escríbelo|Elige|Revisa|Prueba|Vuelve|Actualiza|tienes|usted)\b/,
      );
    }
  });

  it("los errores que dependen de un dato ajeno (host ocupado, marca retirada) no repiten ningún dato", () => {
    for (const error of ["HOST_DUPLICADO", "YA_TIENE_CANONICO", "MARCA_RETIRADA"] as const) {
      expect(MENSAJES_DE_ERROR_DE_DOMINIOS[error], error).not.toMatch(/[0-9]|\.com|\.ar\b|@/);
    }
  });

  it("todo error de la base se muestra con un texto genérico que no filtra nada técnico", () => {
    for (const error of errorDeLaBase) {
      const texto = mensajeDeErrorDeDominios(error);
      expect(texto.length, error.tipo).toBeGreaterThan(15);
      expect(texto, error.tipo).not.toMatch(/dominio|relation|XX000|_uk|_ck|fkey|restricci/i);
    }
    expect(mensajeDeErrorDeDominios({ tipo: "AccesoDenegado" })).toBe(
      MENSAJES_DE_ERROR_DE_DOMINIOS.SIN_PERMISO,
    );
    expect(mensajeDeErrorDeDominios({ tipo: "ConcurrenciaAgotada" })).toMatch(/de nuevo/);
  });

  it("cada motivo al que se traduce una restricción tiene su texto propio", () => {
    const motivos = new Set(
      Object.values(ERRORES_DE_DOMINIO_POR_RESTRICCION).filter((m) => m !== "NO_TRADUCIDA"),
    );
    expect(motivos.size).toBeGreaterThanOrEqual(10);
    for (const motivo of motivos) {
      expect(Object.hasOwn(MENSAJES_DE_ERROR_DE_DOMINIOS, motivo), motivo).toBe(true);
    }
  });
});
