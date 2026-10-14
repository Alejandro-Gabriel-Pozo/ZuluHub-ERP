import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AccesoGuardado,
  CertificadoGuardado,
} from "../../src/modulos/fiscal/persistencia/repositorio-de-certificados";

/**
 * «Nunca se muestra» (spec H7 facturación §B.6.3 y §B.9): la clave privada de un certificado y el ticket de acceso
 * solo los toca quien los cifra y quien los descifra. Dos reglas, cada una con su violación inyectada:
 *
 *  1. Solo el repositorio de certificados (y sus dos archivos de forma, `tablas.ts` y `esquema.ts`) nombra las columnas
 *     cifradas (`clave_*` de `certificado_arca` y `credencial_*` de `acceso_arca`). Previene que una consulta, una
 *     pantalla o un informe seleccione la clave (aun cifrada) por su cuenta. El adaptador de ARCA (F8) también puede
 *     (§B.9), por si necesita leerlas.
 *  2. Solo quien descifra llama a `obtenerClave` y `obtenerCredencial` (que devuelven el texto cifrado): el caso de
 *     uso que carga el certificado y los adaptadores de credenciales y de tickets. Previene que una consulta arme el
 *     repositorio por `publico.ts` y devuelva lo que ese método trae.
 *
 * Alcance: el texto de `src/**` sin las pruebas. Si se quita una regla, falla su violación inyectada.
 */

const COLUMNAS_CIFRADAS =
  /\b(?:clave_(?:cifrada|nonce|etiqueta|kid)|credencial_(?:cifrada|nonce|etiqueta|kid))\b/;
const LECTURA_DE_LO_CIFRADO = /\b(?:obtenerClave|obtenerCredencial)\b/;

const PUEDEN_NOMBRAR_LAS_COLUMNAS = [
  /^src\/modulos\/fiscal\/persistencia\/(?:repositorio-de-certificados|tablas|esquema)\.ts$/,
  /^src\/adaptadores\/arca\//,
];
const PUEDEN_LEER_LO_CIFRADO = [
  /^src\/modulos\/fiscal\/persistencia\/repositorio-de-certificados\.ts$/,
  /^src\/modulos\/fiscal\/casos-de-uso\/(?:contrato-de-certificados|cargar-certificado)\.ts$/,
  /^src\/adaptadores\/certificados\/(?:credenciales-de-emisor|almacen-de-tickets)\.ts$/,
  /^src\/adaptadores\/arca\//,
];

export type Violacion = Readonly<{
  regla: "columnas-cifradas" | "lectura-de-lo-cifrado";
  ruta: string;
}>;

/** Las violaciones de UN archivo (ruta relativa a la raíz, con `/`). */
export function violacionesDe(ruta: string, fuente: string): Violacion[] {
  const encontradas: Violacion[] = [];
  if (COLUMNAS_CIFRADAS.test(fuente) && !PUEDEN_NOMBRAR_LAS_COLUMNAS.some((p) => p.test(ruta))) {
    encontradas.push({ regla: "columnas-cifradas", ruta });
  }
  if (LECTURA_DE_LO_CIFRADO.test(fuente) && !PUEDEN_LEER_LO_CIFRADO.some((p) => p.test(ruta))) {
    encontradas.push({ regla: "lectura-de-lo-cifrado", ruta });
  }
  return encontradas;
}

const RAIZ = join(import.meta.dirname, "../..");
const fuentes = readdirSync(join(RAIZ, "src"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => `src/${f.split("\\").join("/")}`);
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

describe("lo cifrado (la clave privada y el ticket de acceso) lo tocan solo quien lo cifra y quien lo descifra", () => {
  it("encuentra los archivos a revisar (y no mira pruebas)", () => {
    expect(fuentes.length).toBeGreaterThan(200);
    expect(fuentes).toContain("src/modulos/fiscal/persistencia/repositorio-de-certificados.ts");
    expect(fuentes.some((f) => f.endsWith(".test.ts"))).toBe(false);
    expect(relative(RAIZ, join(RAIZ, fuentes[0] ?? ""))).toBe(fuentes[0]);
  });

  it("ningún archivo de src viola las dos reglas", () => {
    expect(fuentes.flatMap((f) => violacionesDe(f, leer(f)))).toEqual([]);
  });

  it("las listas de permitidos no están muertas: cada archivo permitido nombra lo que se le permite", () => {
    const repositorio = leer("src/modulos/fiscal/persistencia/repositorio-de-certificados.ts");
    expect(COLUMNAS_CIFRADAS.test(repositorio)).toBe(true);
    expect(LECTURA_DE_LO_CIFRADO.test(repositorio)).toBe(true);
    for (const ruta of [
      "src/modulos/fiscal/persistencia/tablas.ts",
      "src/modulos/fiscal/persistencia/esquema.ts",
    ]) {
      expect(COLUMNAS_CIFRADAS.test(leer(ruta)), ruta).toBe(true);
    }
    for (const ruta of [
      "src/modulos/fiscal/casos-de-uso/contrato-de-certificados.ts",
      "src/modulos/fiscal/casos-de-uso/cargar-certificado.ts",
      "src/adaptadores/certificados/credenciales-de-emisor.ts",
      "src/adaptadores/certificados/almacen-de-tickets.ts",
    ]) {
      expect(LECTURA_DE_LO_CIFRADO.test(leer(ruta)), ruta).toBe(true);
    }
  });

  describe("violaciones inyectadas", () => {
    it("una consulta que selecciona la clave cifrada, o la credencial, o sus partes", () => {
      for (const columna of [
        "clave_cifrada",
        "clave_nonce",
        "clave_etiqueta",
        "clave_kid",
        "credencial_cifrada",
        "credencial_nonce",
        "credencial_etiqueta",
        "credencial_kid",
      ]) {
        const consulta = `const f = await db.selectFrom("certificado_arca").select(["${columna}"]).execute();`;
        expect(
          violacionesDe("src/modulos/fiscal/consultas/ver-certificados.ts", consulta),
          columna,
        ).toEqual([
          { regla: "columnas-cifradas", ruta: "src/modulos/fiscal/consultas/ver-certificados.ts" },
        ]);
      }
    });

    it("una consulta, un caso de uso o un adaptador cualquiera que lee la clave o la credencial cifradas", () => {
      for (const llamada of [
        "tx.certificados.obtenerClave(e, id)",
        "accesos.obtenerCredencial(e, c, s)",
      ]) {
        for (const ruta of [
          "src/modulos/fiscal/consultas/ver-certificados.ts",
          "src/modulos/fiscal/casos-de-uso/listar-certificados.ts",
          "src/modulos/ventas/consultas/c.ts",
          "src/adaptadores/postgres/informe.ts",
          "src/plataforma/consultas/soporte.ts",
        ]) {
          expect(violacionesDe(ruta, `const x = await ${llamada};`), `${ruta} ${llamada}`).toEqual([
            { regla: "lectura-de-lo-cifrado", ruta },
          ]);
        }
      }
    });

    it("un archivo que cumple las dos reglas, o que solo habla de claves en general, no viola nada", () => {
      expect(
        violacionesDe(
          "src/modulos/fiscal/consultas/c.ts",
          "const clave = 1; // la clave del cliente",
        ),
      ).toEqual([]);
      expect(
        violacionesDe(
          "src/modulos/fiscal/consultas/c.ts",
          'select(["clave_fiscal", "credencial"])',
        ),
      ).toEqual([]);
      expect(
        violacionesDe(
          "src/modulos/fiscal/persistencia/repositorio-de-certificados.ts",
          'select(["clave_cifrada"]); obtenerClave();',
        ),
      ).toEqual([]);
      expect(
        violacionesDe(
          "src/adaptadores/certificados/credenciales-de-emisor.ts",
          "tx.certificados.obtenerClave(e, id)",
        ),
      ).toEqual([]);
      expect(
        violacionesDe(
          "src/adaptadores/arca/credenciales.ts",
          'select(["clave_cifrada"]); obtenerCredencial();',
        ),
      ).toEqual([]);
    });
  });
});

describe("ninguna forma que se muestra lleva la clave ni el ticket (los tipos de lo guardado)", () => {
  type Prohibido =
    `${string}${"clave" | "cifrad" | "nonce" | "etiqueta" | "token" | "firma" | "sign"}${string}`;

  it("un certificado y un acceso guardados no tienen ninguna propiedad de clave, cifrado, token o firma", () => {
    expectTypeOf<Extract<keyof CertificadoGuardado, Prohibido>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof AccesoGuardado, Prohibido>>().toEqualTypeOf<never>();
    // Lo que SÍ dice del acceso es si hay credencial, no cuál es.
    expectTypeOf<AccesoGuardado["tieneCredencial"]>().toEqualTypeOf<boolean>();
  });

  it("el detector de tipos es real: una forma con una propiedad así sí la nombra", () => {
    type Mala = { claveCifrada: string; alias: string };
    expectTypeOf<Extract<keyof Mala, Prohibido>>().not.toEqualTypeOf<never>();
  });
});
