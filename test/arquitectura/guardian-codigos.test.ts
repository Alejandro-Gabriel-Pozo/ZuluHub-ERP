import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * Los códigos de falla y de aviso del guardián (`arquitectura/contratos/codigos.cjs`): su lista CERRADA y lo que cada uno
 * dice que comprueba. El texto de `DESCRIPCION_DE_CODIGOS` es lo que el informe publica como «reglas ejecutadas»: sin esta
 * prueba, cambiarlo (o dejarlo decir lo contrario de lo que el chequeo hace) no hacía fallar nada ni entraba a Stryker.
 * Cambiar una descripción obliga a cambiarla acá, a propósito.
 */

const require = createRequire(import.meta.url);
const codigos = require("../../arquitectura/contratos/codigos.cjs") as {
  DESCRIPCION_DE_CODIGOS: Readonly<Record<string, string>>;
  CODIGOS_DE_FALLA: readonly string[];
  CODIGOS_DE_AVISO: readonly string[];
};

const DESCRIPCIONES: readonly (readonly [string, string])[] = [
  ["sin-rutas", "el repositorio tiene rutas versionadas para analizar"],
  ["regla-de-clasificacion-invalida", "la tabla de clasificación tiene clases y globs válidos"],
  ["ruta-sin-clase", "toda ruta versionada cae en una clase; si no, falla"],
  ["clasificacion-ambigua", "dos reglas del mismo nivel que clasifican distinto fallan"],
  ["clase-sin-rutas", "una clase que el repo debe tener no puede quedar vacía"],
  [
    "codigo-en-clase-excluida",
    "una clase excluida del análisis (docs, generado) solo admite sus extensiones o rutas permitidas, nunca código",
  ],
  [
    "registro-invalido",
    "un contrato con campos faltantes, vacíos o mal formados invalida el registro",
  ],
  ["unidad-sin-declaracion", "cada unidad tiene su contratos.json"],
  ["declaracion-invalida", "el contratos.json declara usa y/o noUsa con la forma correcta"],
  ["declara-contrato-inexistente", "los ids de usa existen en el registro"],
  ["uso-sin-declarar", "la unidad que usa un contrato lo declara"],
  ["no-usa-falso", "la unidad que declara no usar nada no usa ningún contrato"],
  ["declaracion-falsa", "la unidad que declara un contrato lo usa de verdad"],
  ["definicion-fuera-de-la-fuente", "un valor de contrato solo se define en su fuente de verdad"],
  ["contrato-sin-fuente", "la fuente de verdad existe y contiene lo que dice"],
  ["ruta-ilegible", "todo archivo que un detector debe analizar se puede leer"],
  ["detector-invalido", "un detector no lanza errores y devuelve líneas reales del archivo"],
  [
    "detector-sin-rutas",
    "un detector no puede declarar una clase de la que no analizó ni un archivo",
  ],
  ["detector-en-clase-excluida", "ningún detector apunta a una clase excluida del análisis"],
  ["excepcion-invalida", "las excepciones y exclusiones traen todos sus campos, sin sobrantes"],
  ["excepcion-vencida", "ninguna excepción o exclusión está vencida"],
  [
    "excepcion-plazo-excesivo",
    "ninguna excepción o exclusión dura más de 60 días (vence - creada)",
  ],
  ["excepcion-vence-antes-de-creada", "el vencimiento no es anterior a la creación"],
  ["excepcion-creada-futura", "la fecha de creación no es futura respecto del reloj"],
  ["excepcion-ruta-no-exacta", "la ruta de una excepción es un archivo exacto, sin comodines"],
  ["excepcion-huella-cambiada", "la huella aprobada coincide con la línea (o el archivo) actual"],
  ["excepcion-obsoleta", "toda excepción o exclusión silencia algo"],
  ["excepcion-contrato-inexistente", "la excepción apunta a un contrato del registro"],
  [
    "evasion-invalida",
    "el catálogo de la batería de evasión (evasiones.json) tiene casos completos, con los campos de su estado y sin sobrantes",
  ],
  [
    "brecha-plazo-excesivo",
    "ninguna brecha abierta de la batería de evasión vence a más de 60 días de su creación",
  ],
  ["brecha-vencida", "ninguna brecha abierta de la batería de evasión está vencida"],
  [
    "riesgo-plazo-excesivo",
    "ningún riesgo aceptado de la batería de evasión se revisa a más de 180 días de su creación",
  ],
  ["riesgo-vencido", "ningún riesgo aceptado de la batería de evasión pasó su fecha de revisión"],
  [
    "evasion-no-bloqueada",
    "un caso exigido de la batería de evasión se bloquea como dice su resultado esperado",
  ],
  [
    "brecha-cerrada",
    "una brecha abierta de la batería de evasión sigue pasando sin detección: si se cerró, el caso pasa a exigido",
  ],
  [
    "riesgo-cerrado",
    "un riesgo aceptado de la batería de evasión sigue pasando sin detección: si dejó de existir, el caso pasa a exigido",
  ],
  ["falla-sin-ubicacion", "toda falla y todo aviso traen archivo y una línea entera desde 1 (M3)"],
  ["codigo-fuera-de-la-lista", "todo hallazgo usa un código de la lista cerrada del guardián"],
];

const AVISOS = [
  "declaracion-falsa",
  "excepcion-por-vencer",
  "ruta-ausente-en-disco",
  "brecha-abierta",
  "brecha-por-vencer",
  "riesgo-por-revisar",
] as const;

describe("codigos.cjs", () => {
  it("cada código de falla dice qué comprueba, con este texto y en este orden", () => {
    expect(Object.entries(codigos.DESCRIPCION_DE_CODIGOS)).toEqual(DESCRIPCIONES);
  });

  it("la lista de fallas es exactamente la de las descripciones, congelada", () => {
    expect(codigos.CODIGOS_DE_FALLA).toEqual(DESCRIPCIONES.map(([codigo]) => codigo));
    expect(Object.isFrozen(codigos.CODIGOS_DE_FALLA)).toBe(true);
    expect(Object.isFrozen(codigos.DESCRIPCION_DE_CODIGOS)).toBe(true);
  });

  it("los avisos son estos seis, en este orden, congelados, y solo uno es a la vez una falla", () => {
    expect(codigos.CODIGOS_DE_AVISO).toEqual([...AVISOS]);
    expect(Object.isFrozen(codigos.CODIGOS_DE_AVISO)).toBe(true);
    const fallas = new Set(codigos.CODIGOS_DE_FALLA);
    const compartidos = codigos.CODIGOS_DE_AVISO.filter((codigo) => fallas.has(codigo));
    expect(compartidos).toEqual(["declaracion-falsa"]);
  });

  it("ninguna descripción está vacía ni repite el código", () => {
    for (const [codigo, descripcion] of DESCRIPCIONES) {
      expect(descripcion.trim(), codigo).not.toBe("");
      expect(descripcion, codigo).not.toBe(codigo);
    }
  });
});
