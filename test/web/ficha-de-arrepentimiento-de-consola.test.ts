import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REGISTRO_DE_DATOS } from "../../src/capacidades/datos/registro";
import {
  CATALOGO_DE_PLATAFORMA,
  PERMISOS_DE_PLATAFORMA,
} from "../../src/capacidades/permisos/plataforma";
import { FICHA_DE_ARREPENTIMIENTO_DE_CONSOLA as FICHA } from "../../src/capacidades/pantallas/ficha-de-arrepentimiento-de-consola";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { TEXTOS_DE_PLATAFORMA } from "../../src/capacidades/vocabulario/textos-de-plataforma";

/**
 * La ficha de lo que H-14b suma a «Plan de una empresa» (deshacer por arrepentimiento y fecha mínima dictada por el servidor) no se desfasa de la realidad: sus archivos existen, cada texto propio del catálogo está
 * declarado con sus usos (y cada uso existe y cita la clave), todo texto que cita el código nuevo está en la ficha, sus acciones y datos existen y escribir es solo ADMIN. Previene: un botón, un campo o un texto
 * que nadie aprobó, y una ruta o un archivo que se mueve sin que la ficha lo note.
 */

const leer = (ruta: string): string => readFileSync(ruta, "utf8");
const CLAVE = /"(plataforma\.[a-z_.]+)"/g;
const claves = (texto: string): string[] => [...texto.matchAll(CLAVE)].map((m) => m[1] ?? "");
const PROPIAS = /^plataforma\.arrepentir\./;

describe("ficha de lo que H-14b suma a «Plan de una empresa»", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA.archivos) expect(existsSync(archivo), archivo).toBe(true);
  });

  it("cada texto propio del catálogo está en la ficha, con usos que existen y que de verdad lo citan, y la fuente es la decisión de esta pantalla", () => {
    const propios = Object.keys(TEXTOS_DE_PLATAFORMA).filter((k) => PROPIAS.test(k));
    expect(
      Object.keys(FICHA.textos)
        .filter((k) => PROPIAS.test(k))
        .sort(),
    ).toEqual(propios.sort());
    for (const [clave, texto] of Object.entries(FICHA.textos)) {
      expect(texto.usos.length, clave).toBeGreaterThan(0);
      for (const uso of texto.usos) {
        expect(existsSync(uso), `${clave}: ${uso}`).toBe(true);
        expect(claves(leer(uso)), `${clave} en ${uso}`).toContain(clave);
      }
      expect(texto.fuente, clave).toEqual({
        decision: PROPIAS.test(clave) ? "DEC-0817" : "DEC-0805",
      });
    }
    expect(existsSync("arquitectura/decisiones/registro/DEC-0817.json")).toBe(true);
  });

  it("los textos reusados de «Planes» existen en el catálogo de la consola", () => {
    for (const clave of Object.keys(FICHA.textos).filter((k) => !PROPIAS.test(k)))
      expect(Object.keys(TEXTOS_DE_PLATAFORMA), clave).toContain(clave);
  });

  it("los textos del núcleo que reusa existen en el catálogo común y el código los pide", () => {
    for (const clave of FICHA.textosDelNucleo) {
      expect(Object.keys(CATALOGO_DE_TEXTOS), clave).toContain(clave);
      expect(
        FICHA.archivos.some((a) => leer(a).includes(`"${clave}"`)),
        clave,
      ).toBe(true);
    }
  });

  it("todo texto de plataforma que cita el código nuevo está declarado en la ficha", () => {
    const citadas = new Set(
      [
        ...FICHA.archivos,
        "apps/plataforma/logica/arrepentimiento.ts",
        "apps/plataforma/logica/errores-de-cambio-de-plan.ts",
      ].flatMap((a) => claves(leer(a))),
    );
    expect(citadas.size).toBeGreaterThan(10);
    for (const clave of citadas) expect(Object.keys(FICHA.textos), clave).toContain(clave);
  });

  it("sus acciones existen en el catálogo de plataforma, el acceso lo tienen los dos roles y escribir solo ADMIN", () => {
    const acciones = Object.values(CATALOGO_DE_PLATAFORMA).flatMap((m) => Object.keys(m.acciones));
    expect(acciones).toContain(FICHA.acceso);
    expect(PERMISOS_DE_PLATAFORMA[FICHA.acceso]).toEqual(["ADMIN", "SOPORTE"]);
    const envia = FICHA.botones.flatMap((b) => ("envia" in b.hace ? [b.hace.envia] : []));
    expect(envia).toEqual(["planes.arrepentir"]);
    for (const accion of envia) {
      expect(acciones).toContain(accion);
      expect(PERMISOS_DE_PLATAFORMA[accion]).toEqual(["ADMIN"]);
    }
    for (const b of FICHA.botones) expect(Object.keys(TEXTOS_DE_PLATAFORMA)).toContain(b.texto);
    for (const m of FICHA.modales)
      for (const id of m.botones) expect(FICHA.botones.map((b) => b.id)).toContain(id);
  });

  it("cada campo pide un dato registrado de la consola, que lo declara como consumidor y que el archivo realmente pide", () => {
    for (const { dato, archivo } of FICHA.campos) {
      const definicion = REGISTRO_DE_DATOS[dato];
      expect(definicion.ambito, dato).toBe("PLATAFORMA");
      expect(definicion.consumidores as readonly string[], dato).toContain(archivo);
      expect(leer(archivo), `${dato} en ${archivo}`).toContain(`dato="${dato}"`);
    }
  });

  it("la ruta existe y el panel monta el bloque", () => {
    expect(existsSync("apps/plataforma/app/empresas/[id]/plan/page.tsx")).toBe(true);
    expect(leer("apps/plataforma/pantallas/panel-de-plan.cliente.tsx")).toContain(
      "<Arrepentimiento",
    );
  });
});
