import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REGISTRO_DE_DATOS } from "../../src/capacidades/datos/registro";
import {
  CATALOGO_DE_PLATAFORMA,
  PERMISOS_DE_PLATAFORMA,
} from "../../src/capacidades/permisos/plataforma";
import { FICHA_DE_PLANES_DE_CONSOLA as FICHA } from "../../src/capacidades/pantallas/ficha-de-planes-de-consola";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { TEXTOS_DE_PLATAFORMA } from "../../src/capacidades/vocabulario/textos-de-plataforma";

/**
 * La ficha de «Planes» de la consola no se desfasa de la realidad: sus archivos existen, cada texto del catálogo está declarado con sus usos (y cada uso existe y cita la clave), todo texto que cita el
 * código está en la ficha, sus acciones y sus datos existen y la consola no se mezcla con el vocabulario de las marcas. Previene: un botón, un campo o un texto que nadie aprobó, y un texto interno de la
 * plataforma ofrecido a un cliente como reemplazable.
 */

const leer = (ruta: string): string => readFileSync(ruta, "utf8");
const CLAVE = /"(plataforma\.[a-z_.]+)"/g;
const claves = (texto: string): string[] => [...texto.matchAll(CLAVE)].map((m) => m[1] ?? "");

/** Las claves de un catálogo que otro también ofrece: lo que dejaría un texto de la consola al alcance de una marca. */
const claveEnAmbos = (a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>) =>
  Object.keys(a).filter((k) => Object.hasOwn(b, k));

describe("ficha de la pantalla «Planes» de la consola", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA.archivos) expect(existsSync(archivo), archivo).toBe(true);
  });

  it("cada texto del catálogo está en la ficha y al revés, con usos que existen y que de verdad lo citan", () => {
    expect(Object.keys(FICHA.textos).sort()).toEqual(Object.keys(TEXTOS_DE_PLATAFORMA).sort());
    for (const [clave, texto] of Object.entries(FICHA.textos)) {
      expect(texto.usos.length, clave).toBeGreaterThan(0);
      for (const uso of texto.usos) {
        expect(existsSync(uso), `${clave}: ${uso}`).toBe(true);
        expect(claves(leer(uso)), `${clave} en ${uso}`).toContain(clave);
      }
      expect(texto.fuente).toEqual({ decision: "DEC-0805" });
    }
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

  it("todo texto de plataforma que cita el código de la consola está declarado en la ficha", () => {
    const citadas = new Set(
      [
        ...FICHA.archivos,
        "apps/plataforma/pantallas/armazon-de-consola.tsx",
        "apps/plataforma/logica/editor-de-plan.ts",
        "apps/plataforma/logica/errores-de-planes.ts",
      ].flatMap((a) => claves(leer(a))),
    );
    expect(citadas.size).toBeGreaterThan(10);
    for (const clave of citadas) expect(Object.keys(FICHA.textos), clave).toContain(clave);
  });

  it("cada texto del catálogo trae sus usos, su fuente (la decisión que lo acepta, que existe) y el prefijo de la consola", () => {
    for (const [clave, d] of Object.entries(TEXTOS_DE_PLATAFORMA)) {
      expect(clave).toMatch(/^plataforma\.(menu|planes)\.[a-z_]+$/);
      expect(d).toMatchObject({ usos: ["DE_FICHA"], fuente: { decision: "DEC-0805" } });
    }
    expect(existsSync("arquitectura/decisiones/registro/DEC-0805.json")).toBe(true);
  });

  it("los textos de la consola NO están en el vocabulario que una marca puede reemplazar (violación inyectada: una clave en ambos se detecta)", () => {
    expect(claveEnAmbos(TEXTOS_DE_PLATAFORMA, CATALOGO_DE_TEXTOS)).toEqual([]);
    expect(
      claveEnAmbos(
        { "plataforma.planes.titulo": 1 },
        { ...CATALOGO_DE_TEXTOS, "plataforma.planes.titulo": { porDefecto: "x" } },
      ),
    ).toEqual(["plataforma.planes.titulo"]);
  });

  it("sus acciones existen en el catálogo de plataforma, el acceso lo tienen los dos roles y escribir solo ADMIN", () => {
    const acciones = Object.values(CATALOGO_DE_PLATAFORMA).flatMap((m) => Object.keys(m.acciones));
    expect(acciones).toContain(FICHA.acceso);
    expect(PERMISOS_DE_PLATAFORMA[FICHA.acceso]).toEqual(["ADMIN", "SOPORTE"]);
    const envia = FICHA.botones.flatMap((b) => ("envia" in b.hace ? [b.hace.envia] : []));
    expect(new Set(envia)).toEqual(
      new Set(["planes.crear", "planes.editar_borrador", "planes.publicar_version"]),
    );
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
    const piden = FICHA.archivos.flatMap((a) =>
      [...leer(a).matchAll(/dato="([a-z-]+)"/g)].map((m) => m[1] ?? ""),
    );
    expect(new Set(piden)).toEqual(new Set(FICHA.campos.map((c) => c.dato)));
  });

  it("la entrada de menú está en el armazón con su ruta y su texto, y la ruta existe", () => {
    const armazon = leer("apps/plataforma/pantallas/armazon-de-consola.tsx");
    expect(armazon).toContain(`clave: "${FICHA.menu.clave}"`);
    expect(armazon).toContain(`"${FICHA.menu.texto}"`);
    expect(armazon).toContain(`href: "${FICHA.menu.href}"`);
    expect(FICHA.rutas).toContain(FICHA.menu.href);
    expect(FICHA.titulo).toBe("plataforma.planes.titulo");
  });
});
