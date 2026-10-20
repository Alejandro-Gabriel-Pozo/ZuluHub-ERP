import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El producto se llama Pedernal: el nombre anterior no vuelve a aparecer en el código, los scripts, las migraciones,
 * los workflows ni las pruebas. Falla que previene: una variable de entorno, un rol de base, una cookie o una
 * referencia de error con el nombre viejo que se cuela de un borrador o de una copia, y deja dos nombres para lo
 * mismo (una variable con el prefijo viejo que nadie configura, un rol con el prefijo viejo que la migración no crea). Se
 * cuida también la sigla vieja de dos letras (cookies, encabezados internos, referencia `XX-XXXX-XXXX`), que
 * es parte del contrato visible.
 *
 * Las palabras viejas se arman por partes a propósito: este archivo es el único lugar donde existen, y no se
 * escanea a sí mismo. Una violación inyectada (un archivo temporal con el nombre viejo) comprueba que el escáner
 * las ve, así que debilitar el escáner hace fallar esta prueba.
 */

const NOMBRE = "zulu" + "hub";
const SIGLA = "z" + "h";

/**
 * El nombre también se esconde codificado: los vectores de la firma del contexto llevan el rol en hexadecimal (y una
 * solicitud de certificado de juguete lo llevaba en base64), así que un renombre de texto los deja viejos sin que
 * nada lo muestre. Se buscan el hexadecimal y el base64 (alineado al inicio) del nombre.
 */
const EN_HEXADECIMAL = Buffer.from(NOMBRE).toString("hex");
const EN_BASE64 = Buffer.from(NOMBRE).toString("base64").slice(0, 8);

/** Nombre viejo en cualquier combinación de mayúsculas, o la sigla vieja como palabra o prefijo (`zh_`, `ZH-`, `x-zh-`). */
const PATRON_VIEJO = new RegExp(
  `${NOMBRE}|${EN_HEXADECIMAL}|${EN_BASE64}|(?<![A-Za-z0-9])${SIGLA}(?![A-Za-z])`,
  "i",
);

/**
 * Lo único permitido: el enlace al repositorio de documentos, que sigue llamándose como antes en GitHub hasta que
 * el dueño lo renombre (un enlace a un nombre que todavía no existe sería un enlace roto). Cuando el repositorio se
 * renombre, se cambia el enlace y se borra esta excepción.
 */
const EXCEPCIONES = [`github.com/Alejandro-Gabriel-Pozo/Zulu${"Hub"}-docs`];

const CARPETAS = ["src", "apps", "scripts", "migraciones", ".github", "test", "arquitectura"];
const ARCHIVOS_DE_LA_RAIZ = [
  "package.json",
  "README.md",
  "CLAUDE.md",
  ".gitleaks.toml",
  "knip.json",
  "stryker.config.json",
  "eslint.config.js",
  "tsconfig.json",
  "vitest.config.ts",
  "neon.ts",
];
const SALTAR_CARPETAS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "coverage",
  ".stryker-tmp",
]);
const BINARIOS =
  /\.(tsbuildinfo|png|jpe?g|gif|webp|avif|ico|pdf|woff2?|ttf|eot|zip|gz|pem|p12|der|csr)$/i;
const ESTE_ARCHIVO = "test/arquitectura/nombre-del-producto.test.ts";

function lineasConNombreViejo(texto: string): number[] {
  let limpio = texto;
  for (const permitido of EXCEPCIONES) limpio = limpio.replaceAll(permitido, "");
  const lineas: number[] = [];
  limpio.split("\n").forEach((linea, i) => {
    if (PATRON_VIEJO.test(linea)) lineas.push(i + 1);
  });
  return lineas;
}

function archivosDe(carpeta: string, acumulado: string[]): string[] {
  for (const nombre of readdirSync(carpeta)) {
    if (SALTAR_CARPETAS.has(nombre)) continue;
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) archivosDe(ruta, acumulado);
    else if (!BINARIOS.test(nombre)) acumulado.push(ruta);
  }
  return acumulado;
}

/** Devuelve `ruta:línea` de cada aparición del nombre viejo bajo `raiz` (rutas relativas, con `/`). */
function escanear(raiz: string, carpetas: string[], archivos: string[]): string[] {
  const rutas: string[] = [];
  for (const carpeta of carpetas) {
    try {
      archivosDe(join(raiz, carpeta), rutas);
    } catch {
      // Una carpeta que no existe no tiene nada que escanear.
    }
  }
  for (const archivo of archivos) rutas.push(join(raiz, archivo));
  const hallazgos: string[] = [];
  for (const ruta of rutas) {
    const relativa = relative(raiz, ruta).split("\\").join("/");
    if (relativa === ESTE_ARCHIVO) continue;
    let texto: string;
    try {
      texto = readFileSync(ruta, "utf8");
    } catch {
      continue;
    }
    for (const n of lineasConNombreViejo(texto)) hallazgos.push(`${relativa}:${n}`);
  }
  return hallazgos.sort();
}

const RAIZ = join(import.meta.dirname, "../..");

describe("el nombre anterior del producto no vuelve", () => {
  it("ningún archivo del código, scripts, migraciones, workflows ni pruebas lo nombra", () => {
    expect(escanear(RAIZ, CARPETAS, ARCHIVOS_DE_LA_RAIZ)).toEqual([]);
  });

  it.each([
    ["el nombre en minúscula", `const x = "${NOMBRE}_app";`],
    ["el nombre en mayúscula", `${NOMBRE.toUpperCase()}_DB_APP=1`],
    ["el nombre con la forma de marca", "Zulu" + "Hub: ERP"],
    ["una cookie con la sigla", `__Host-${SIGLA}_emp.session_token`],
    ["un encabezado interno con la sigla", `x-${SIGLA}-nonce`],
    ["la referencia con la sigla", `${SIGLA.toUpperCase()}-ABCD-0123`],
    [
      "el nombre en hexadecimal (vector de firma)",
      `u":"${Buffer.from(NOMBRE).toString("hex")}5f617070`,
    ],
    ["el nombre en base64", `${Buffer.from(NOMBRE).toString("base64")}x`],
    ["la sigla suelta", `la referencia ${SIGLA.toUpperCase()} derivada`],
  ])("detecta %s", (_nombre, texto) => {
    expect(lineasConNombreViejo(`limpio\n${texto}\nlimpio`)).toEqual([2]);
  });

  it.each([
    ["el nombre nuevo", "Pedernal, PEDERNAL_DB_APP, pedernal_app"],
    ["las siglas nuevas", "pd_emp, PD-ABCD-0123, x-pd-nonce"],
    ["letras que contienen la sigla dentro de otra palabra", `${SIGLA}ang, a${SIGLA}b`],
  ])("no marca %s", (_nombre, texto) => {
    expect(lineasConNombreViejo(texto)).toEqual([]);
  });

  it("deja pasar solo el enlace al repositorio de documentos, y nada más en la misma línea", () => {
    const enlace = `https://${EXCEPCIONES[0] ?? ""}`;
    expect(lineasConNombreViejo(`[docs](${enlace})`)).toEqual([]);
    expect(lineasConNombreViejo(`[docs](${enlace}) ${NOMBRE}`)).toEqual([1]);
  });

  it("violación inyectada: un archivo con el nombre viejo, en cualquier carpeta cuidada, se encuentra", () => {
    const raiz = mkdtempSync(join(tmpdir(), "nombre-del-producto-"));
    try {
      mkdirSync(join(raiz, "src/modulo"), { recursive: true });
      mkdirSync(join(raiz, ".github/workflows"), { recursive: true });
      mkdirSync(join(raiz, "src/node_modules/paquete"), { recursive: true });
      writeFileSync(join(raiz, "src/modulo/limpio.ts"), "export const x = 1;\n");
      writeFileSync(join(raiz, "src/modulo/sucio.ts"), `export const x = "${NOMBRE}";\n`);
      writeFileSync(join(raiz, ".github/workflows/ci.yml"), `a: 1\nb: ${NOMBRE.toUpperCase()}_X\n`);
      writeFileSync(join(raiz, "src/node_modules/paquete/index.js"), `${NOMBRE}\n`);
      writeFileSync(join(raiz, "README.md"), `${NOMBRE}\n`);
      expect(escanear(raiz, ["src", ".github", "no-existe"], ["README.md"])).toEqual([
        ".github/workflows/ci.yml:2",
        "README.md:1",
        "src/modulo/sucio.ts:1",
      ]);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});
