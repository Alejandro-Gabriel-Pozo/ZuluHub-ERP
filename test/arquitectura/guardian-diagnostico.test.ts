import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  AHORA,
  BASE,
  CODIGOS_DE_AVISO,
  CODIGOS_DE_FALLA,
  DESCRIPCION_DE_CODIGOS,
  EXCLUSIONES_BASE,
  LINEA_DE_USO,
  RAIZ,
  RAIZ_ORIGINAL,
  REGLAS_DE_LINEA,
  cargarDelRepo,
  contrato,
  contratoDeRadio,
  correr,
  ejecutar,
  formatearFalla,
  huellaDe,
  huellaDelArchivo,
  definicionInerte,
  type Falla,
  type Opciones,
  type Resultado,
} from "./guardian-apoyo";

/**
 * Diagnóstico con ubicación (M3, contratos-arquitectonicos.md §4): TODA falla y TODO aviso del guardián
 * traen archivo y línea. Una tabla con un caso por cada código de la lista cerrada (`codigos.cjs`)
 * verifica el archivo EXACTO y la línea EXACTA; las reglas de línea están en `ubicacion.cjs`.
 *
 * Diseños de los JSON de las pruebas (`JSON.stringify(valor, null, 2)`): una excepción ocupa 11
 * líneas dentro de la lista: `{` en la 2, luego id 3, contrato 4, ruta 5, huella 6, motivo 7,
 * responsable 8, aprobadoPor 9, creada 10, vence 11 y `}` en la 12; la segunda empieza en la 13.
 */

const require = createRequire(import.meta.url);
const { NIVELES } = require("../../arquitectura/contratos/clasificacion.cjs") as {
  NIVELES: { nombre: string; reglas: { clase: string; glob: string }[] }[];
};

const EXCEPCIONES = "arquitectura/contratos/excepciones.json";
const EXCLUSIONES = "arquitectura/contratos/exclusiones.json";
const REGISTRO = "arquitectura/contratos/contratos.cjs";
const CLASIFICACION = "arquitectura/contratos/clasificacion.cjs";
const GUARDIAN = "arquitectura/contratos/guardian.cjs";
const WEB = "apps/web/contratos.json";
const RUTA = "apps/web/ui/Linea.module.css";
const TOKENS_CSS = "apps/web/ui/tokens.css";

type Objeto = Record<string, unknown>;
type Ubicacion = [archivo: string, linea: number];
type Caso = {
  nombre: string;
  codigo: string;
  /** Dónde sale el hallazgo; por defecto, entre las fallas. */
  lista?: "fallas" | "avisos";
  armar: () => Resultado;
  esperado: Ubicacion[];
};

const json = (valor: unknown): string => `${JSON.stringify(valor, null, 2)}\n`;
const sin = (objeto: Objeto, campo: string): Objeto =>
  Object.fromEntries(Object.entries(objeto).filter(([clave]) => clave !== campo));

/** Un repositorio sintético sobre `BASE`, con el JSON de excepciones tal cual se escribió. */
function conExcepciones(lista: unknown, extra: Opciones & { texto?: string } = {}): Resultado {
  const { texto, ...resto } = extra;
  return correr({
    contratos: [contrato()],
    excepciones: lista,
    ...resto,
    archivos: {
      [RUTA]: `${LINEA_DE_USO}\n`,
      [EXCEPCIONES]: texto ?? json(lista),
      ...resto.archivos,
    },
  });
}

const excepcion = (cambios: Objeto = {}): Objeto => ({
  id: "exc-1",
  contrato: "color-separador",
  ruta: RUTA,
  huella: huellaDe(LINEA_DE_USO),
  motivo: "Migración pendiente: el componente viejo se reemplaza en el próximo sprint.",
  responsable: "Ingeniería",
  aprobadoPor: "Dueño",
  creada: "2026-10-21",
  vence: "2026-12-20",
  ...cambios,
});

/** Las exclusiones de siempre (generado en la entrada 0, docs en la 1) con la de docs modificada. */
function conExclusiones(lista: unknown, extra: Opciones = {}): Resultado {
  return correr({
    ...extra,
    exclusiones: lista,
    archivos: { [EXCLUSIONES]: json(lista), ...extra.archivos },
  });
}
const docsCon = (cambios: Objeto): Objeto[] => [
  EXCLUSIONES_BASE[0] as Objeto,
  { ...EXCLUSIONES_BASE[1], ...cambios },
];

/** Registro sintético: `contratos.cjs` con el id de `color-separador` en la línea 7 (y el de otro contrato antes). */
const FUENTE_DEL_REGISTRO = [
  "// registro",
  "module.exports = [",
  "  {",
  '    id: "otro-contrato",',
  "  },",
  "  {",
  '    id: "color-separador",',
  "  },",
].join("\n");
const LINEA_DEL_CONTRATO = 7;
/** Tabla sintética: la primera regla de `docs` está en la línea 4. */
const FUENTE_DE_CLASIFICACION = [
  "// tabla",
  "const NIVELES = [",
  '  { clase: "generado", glob: "package-lock.json" },',
  '  { clase: "docs", glob: "**/*.md" },',
  '  { clase: "docs", glob: ".claude/**" },',
].join("\n");

const comoDeclaracion = (nombre: string, texto: string, linea: number): Caso => ({
  nombre,
  codigo: "declaracion-invalida",
  armar: () => correr({ archivos: { [WEB]: texto } }),
  esperado: [[WEB, linea]],
});

/** Un caso por cada código de falla (y de aviso) del guardián. */
function casos(): Caso[] {
  return [
    // ---- (e) alcance global: clasificación.cjs
    {
      nombre: "sin rutas: la línea de la tabla",
      codigo: "sin-rutas",
      armar: () =>
        ejecutar({
          rutas: [],
          leer: (ruta) => (ruta === CLASIFICACION ? "// tabla\nconst NIVELES = [\n" : null),
          contratos: [],
          excepciones: [],
          exclusiones: [],
          ahora: AHORA,
        }),
      esperado: [[CLASIFICACION, 2]],
    },
    {
      nombre: "sin rutas y sin poder leer la tabla: 1",
      codigo: "sin-rutas",
      armar: () =>
        ejecutar({
          rutas: [],
          leer: () => null,
          contratos: [],
          excepciones: [],
          exclusiones: [],
          ahora: AHORA,
        }),
      esperado: [[CLASIFICACION, 1]],
    },
    {
      nombre: "clase inexistente en la regla: la línea de esa regla",
      codigo: "regla-de-clasificacion-invalida",
      armar: () =>
        correr({
          niveles: [
            {
              nombre: "inventado",
              reglas: [
                { clase: "generado", glob: "package-lock.json" },
                { clase: "inventada", glob: "x/**" },
              ],
            },
          ],
          archivos: {
            [CLASIFICACION]:
              '// tabla\nconst NIVELES = [\n  [\n  { clase: "inventada", glob: "x/**" },\n',
          },
        }),
      esperado: [[CLASIFICACION, 4]],
    },
    {
      nombre: "glob inválido: la línea de esa regla",
      codigo: "regla-de-clasificacion-invalida",
      armar: () =>
        correr({
          niveles: [{ nombre: "roto", reglas: [{ clase: "backend", glob: "src/{a,b}/**" }] }],
          archivos: {
            [CLASIFICACION]:
              '// tabla\n// otra\n// más\n// y más\n{ clase: "backend", glob: "src/{a,b}/**" },\n',
          },
        }),
      esperado: [[CLASIFICACION, 5]],
    },
    {
      nombre: "regla inválida que la tabla ya no contiene: 1",
      codigo: "regla-de-clasificacion-invalida",
      armar: () =>
        correr({
          niveles: [{ nombre: "roto", reglas: [{ clase: "inventada", glob: "x/**" }] }],
        }),
      esperado: [[CLASIFICACION, 1]],
    },
    {
      nombre: "una clase esperada queda vacía: la primera regla de esa clase",
      codigo: "clase-sin-rutas",
      armar: () =>
        correr({ archivos: { "README.md": null, [CLASIFICACION]: FUENTE_DE_CLASIFICACION } }),
      esperado: [[CLASIFICACION, 4]],
    },
    {
      nombre: "una clase esperada queda vacía y la tabla no la menciona: 1",
      codigo: "clase-sin-rutas",
      armar: () => correr({ archivos: { "README.md": null } }),
      esperado: [[CLASIFICACION, 1]],
    },

    // ---- (c) ruta sin clase o ambigua: la ruta, línea 1
    {
      nombre: "ruta vacía sin clase",
      codigo: "ruta-sin-clase",
      armar: () => correr({ archivos: { "herramienta/x.ts": "" } }),
      esperado: [["herramienta/x.ts", 1]],
    },
    {
      nombre: "ruta binaria sin clase",
      codigo: "ruta-sin-clase",
      armar: () => correr({ archivos: { "herramienta/foto.png": "\u0000\u0001\u0002" } }),
      esperado: [["herramienta/foto.png", 1]],
    },
    {
      nombre: "ruta con texto de varias líneas sin clase: igual la línea 1",
      codigo: "ruta-sin-clase",
      armar: () => correr({ archivos: { "herramienta/y.ts": "a\nb\nc\nd\n" } }),
      esperado: [["herramienta/y.ts", 1]],
    },
    {
      nombre: "dos reglas del mismo nivel con clases distintas",
      codigo: "clasificacion-ambigua",
      armar: () =>
        correr({
          niveles: [
            {
              nombre: "ambiguo",
              reglas: [
                { clase: "scripts", glob: "herramienta/**" },
                { clase: "config", glob: "herramienta/*.ts" },
              ],
            },
            ...NIVELES,
          ],
          archivos: { "herramienta/x.ts": "export {};\n\n\n" },
        }),
      esperado: [["herramienta/x.ts", 1]],
    },
    {
      nombre: "código ejecutable en una clase excluida (docs): la ruta, línea 1",
      codigo: "codigo-en-clase-excluida",
      armar: () => correr({ archivos: { ".claude/hooks/ejecutar.sh": "echo hola\n\n\n" } }),
      esperado: [[".claude/hooks/ejecutar.sh", 1]],
    },
    {
      nombre:
        "las migraciones reclasificadas como generado (un .sql y un .json fuera de lo permitido): cada ruta, línea 1",
      codigo: "codigo-en-clase-excluida",
      armar: () =>
        correr({
          niveles: [
            { nombre: "mal", reglas: [{ clase: "generado", glob: "migraciones/**" }] },
            ...NIVELES,
          ],
        }),
      esperado: [
        ["migraciones/0001_base.sql", 1],
        ["migraciones/contratos.json", 1],
      ],
    },
    {
      nombre: "archivo ilegible",
      codigo: "ruta-ilegible",
      armar: () =>
        ejecutar({
          rutas: Object.keys(BASE),
          leer: (ruta) => (ruta === "apps/web/ui/Caja.module.css" ? null : (BASE[ruta] ?? null)),
          contratos: [contrato()],
          excepciones: [],
          exclusiones: EXCLUSIONES_BASE,
          ahora: AHORA,
        }),
      esperado: [["apps/web/ui/Caja.module.css", 1]],
    },

    // ---- (d) registro de contratos: contratos.cjs
    {
      nombre: "contrato con un campo vacío: la línea de su id",
      codigo: "registro-invalido",
      armar: () =>
        correr({
          contratos: [contrato({ limites: "" })],
          archivos: { [REGISTRO]: FUENTE_DEL_REGISTRO },
        }),
      esperado: [[REGISTRO, LINEA_DEL_CONTRATO]],
    },
    {
      nombre: "contrato con un campo vacío y el registro sin leer: 1",
      codigo: "registro-invalido",
      armar: () => correr({ contratos: [contrato({ limites: "" })] }),
      esperado: [[REGISTRO, 1]],
    },
    {
      nombre: "contrato sin id válido: 1",
      codigo: "registro-invalido",
      armar: () =>
        correr({
          contratos: [contrato({ id: "" })],
          archivos: { [REGISTRO]: FUENTE_DEL_REGISTRO },
        }),
      esperado: [[REGISTRO, 1]],
    },
    {
      nombre: "el registro no es una lista: 1",
      codigo: "registro-invalido",
      armar: () => correr({ contratos: {}, archivos: { [REGISTRO]: FUENTE_DEL_REGISTRO } }),
      esperado: [[REGISTRO, 1]],
    },
    {
      nombre: "el id de otro contrato no se confunde con el ofensor",
      codigo: "registro-invalido",
      armar: () =>
        correr({
          contratos: [contrato({ id: "otro", limites: "" })],
          archivos: { [REGISTRO]: '// x\nid: "otro-contrato",\n// y\nid: "otro",\n' },
        }),
      esperado: [[REGISTRO, 4]],
    },
    {
      nombre: "detector que lanza un error: el contrato dueño en el registro",
      codigo: "detector-invalido",
      armar: () =>
        correr({
          contratos: [
            contrato({
              deteccion: [
                {
                  tipo: "uso",
                  clases: ["pruebas"],
                  nombre: "explota",
                  reconoce: () => {
                    throw new Error("boom");
                  },
                },
                definicionInerte(),
              ],
            }),
          ],
          archivos: { [REGISTRO]: FUENTE_DEL_REGISTRO },
        }),
      esperado: [[REGISTRO, LINEA_DEL_CONTRATO]],
    },
    {
      nombre: "detector que devuelve una línea fuera del archivo",
      codigo: "detector-invalido",
      armar: () =>
        correr({
          contratos: [
            contrato({
              deteccion: [
                {
                  tipo: "uso",
                  clases: ["pruebas"],
                  nombre: "roto",
                  reconoce: () => [{ linea: 99, texto: "x" }],
                },
                definicionInerte(),
              ],
            }),
          ],
          archivos: { [REGISTRO]: FUENTE_DEL_REGISTRO },
        }),
      esperado: [[REGISTRO, LINEA_DEL_CONTRATO]],
    },
    {
      nombre: "detector que declara una clase de la que no analizó ni un archivo",
      codigo: "detector-sin-rutas",
      armar: () =>
        correr({
          contratos: [
            contrato({
              deteccion: [
                {
                  tipo: "uso",
                  clases: ["frontend"],
                  nombre: "mira el frontend",
                  reconoce: () => [],
                },
                definicionInerte(),
              ],
            }),
          ],
          exclusiones: [
            ...EXCLUSIONES_BASE,
            ...["apps/web/ui/tokens.css", "apps/web/ui/Caja.module.css"].map((ruta, i) => ({
              id: `excl-${i}`,
              alcance: "ruta",
              ruta,
              huella: huellaDelArchivo(BASE[ruta] ?? ""),
              motivo: "Prueba",
              responsable: "Ingeniería",
              aprobadoPor: "Dueño",
              creada: "2026-10-21",
              vence: "2026-12-20",
            })),
          ],
          archivos: { [REGISTRO]: FUENTE_DEL_REGISTRO },
        }),
      esperado: [[REGISTRO, LINEA_DEL_CONTRATO]],
    },
    {
      nombre: "detector que apunta a una clase excluida",
      codigo: "detector-en-clase-excluida",
      armar: () =>
        correr({
          contratos: [
            contrato({
              deteccion: [
                { tipo: "uso", clases: ["docs"], nombre: "en docs", reconoce: () => [] },
                definicionInerte(),
              ],
            }),
          ],
          archivos: { [REGISTRO]: FUENTE_DEL_REGISTRO },
        }),
      esperado: [[REGISTRO, LINEA_DEL_CONTRATO]],
    },

    // ---- (b) declaración ausente o fuente que falta: el archivo que habría que crear, línea 1
    {
      nombre: "la unidad no tiene contratos.json",
      codigo: "unidad-sin-declaracion",
      armar: () => correr({ archivos: { [WEB]: null } }),
      esperado: [[WEB, 1]],
    },
    {
      nombre: "un módulo nuevo no tiene contratos.json",
      codigo: "unidad-sin-declaracion",
      armar: () => correr({ archivos: { "src/modulos/nuevo/dominio/x.ts": "export {};" } }),
      esperado: [["src/modulos/nuevo/contratos.json", 1]],
    },
    {
      nombre: "el archivo de la fuente de verdad no existe",
      codigo: "contrato-sin-fuente",
      armar: () => correr({ contratos: [contrato()], archivos: { [TOKENS_CSS]: null } }),
      esperado: [[TOKENS_CSS, 1]],
    },
    {
      nombre: "el archivo existe pero no contiene la variable",
      codigo: "contrato-sin-fuente",
      armar: () =>
        correr({
          contratos: [contrato()],
          archivos: { [TOKENS_CSS]: ":root {\n  --otra: 1;\n}\n" },
        }),
      esperado: [[TOKENS_CSS, 1]],
    },

    // ---- (a) declaración contratos.json
    comoDeclaracion("JSON con coma colgante", '{\n  "usa": [\n    "a",\n  ]\n}\n', 4),
    comoDeclaracion("JSON con basura al final", '{\n  "usa": [],\n  "noUsa": "x"\n}\nbasura\n', 5),
    comoDeclaracion(
      "JSON con una cadena sin cerrar",
      '{\n  "usa": [],\n  "noUsa": "sin cerrar\n}\n',
      3,
    ),
    comoDeclaracion(
      "JSON cortado a la mitad: la última línea con contenido",
      '{\n  "usa": [\n\n\n',
      2,
    ),
    comoDeclaracion("archivo vacío", "", 1),
    comoDeclaracion("archivo con solo espacios y saltos", "\n\n  \n", 1),
    comoDeclaracion("escape inválido en una cadena", '{\n  "noUsa": "\\x"\n}\n', 2),
    comoDeclaracion("número con cero a la izquierda", '{\n  "usa": 01\n}\n', 2),
    comoDeclaracion("literal mal escrito", '{\n  "usa": tru\n}\n', 2),
    comoDeclaracion("falta los dos puntos", '{\n  "usa" []\n}\n', 2),
    comoDeclaracion("clave sin comillas", "{\n  usa: []\n}\n", 2),
    comoDeclaracion("no es un objeto: una lista (con líneas en blanco antes)", "\n\n[]\n", 3),
    comoDeclaracion("no es un objeto: un número", "7\n", 1),
    comoDeclaracion("falta «usa» y «noUsa»: la línea del objeto", "\n{\n}\n", 2),
    {
      nombre: "campos sobrantes después de estructuras complejas: la línea de cada clave",
      codigo: "declaracion-invalida",
      armar: () =>
        correr({
          archivos: {
            [WEB]: [
              "{",
              '  "usa": [],',
              '  "noUsa": "con \\"comillas\\", \\\\ y \\u00e9 y \\n",',
              '  "anidado": {',
              '    "lista": [1, -2.5e+3, true, false, null, "x"],',
              '    "vacio": {},',
              '    "otra": [ [], {} ]',
              "  },",
              '  "ultimo": 1',
              "}",
              "",
            ].join("\n"),
          },
        }),
      esperado: [
        [WEB, 4],
        [WEB, 9],
      ],
    },
    comoDeclaracion("«usa» no es una lista", json({ usa: "x", noUsa: "y" }), 2),
    comoDeclaracion("«usa» con ids que no son texto", json({ usa: [1], noUsa: "y" }), 2),
    comoDeclaracion("«usa» repite un id", json({ usa: ["a", "a"] }), 2),
    comoDeclaracion("«noUsa» vacío", json({ usa: [], noUsa: "" }), 3),
    comoDeclaracion("«usa» vacío y sin «noUsa»", json({ usa: [] }), 2),
    comoDeclaracion(
      "«usa» y «noUsa» a la vez: la línea de «noUsa»",
      json({ usa: ["color-separador"], noUsa: "x" }),
      5,
    ),
    comoDeclaracion(
      "una clave escrita con escapes se reconoce igual",
      '{\n  "us\\u0061": "x"\n}\n',
      2,
    ),
    {
      nombre: "un id inexistente: la línea de ese id dentro de «usa»",
      codigo: "declara-contrato-inexistente",
      armar: () =>
        correr({
          contratos: [contrato()],
          archivos: { [WEB]: json({ usa: ["color-separador", "fantasma"] }) },
        }),
      esperado: [[WEB, 4]],
    },
    {
      nombre: "declaración falsa que bloquea: la línea del id dentro de «usa»",
      codigo: "declaracion-falsa",
      armar: () =>
        correr({
          contratos: [contrato()],
          archivos: { [WEB]: json({ usa: ["color-separador"] }) },
        }),
      esperado: [[WEB, 3]],
    },
    {
      nombre: "declaración falsa que solo avisa: también la línea del id",
      codigo: "declaracion-falsa",
      lista: "avisos",
      armar: () =>
        correr({
          contratos: [contrato({ bloqueaDeclaracionFalsa: false })],
          archivos: { [WEB]: json({ usa: ["otro", "color-separador"] }) },
        }),
      esperado: [[WEB, 4]],
    },

    // ---- (f) hallazgos del código analizado: la línea real
    {
      nombre: "uso sin declarar",
      codigo: "uso-sin-declarar",
      armar: () =>
        correr({
          contratos: [contrato(), contratoDeRadio()],
          archivos: {
            [WEB]: json({ usa: ["radio-unico"] }),
            [RUTA]: ".a { margin: 0; }\n.b { border-color: var(--color-separador); }\n",
            "apps/web/ui/Radio.module.css": ".r { border-radius: var(--radio); }\n",
          },
        }),
      esperado: [[RUTA, 2]],
    },
    {
      nombre: "«noUsa» falso",
      codigo: "no-usa-falso",
      armar: () =>
        correr({
          contratos: [contrato()],
          archivos: { [RUTA]: ".a {}\n.b {}\n.c { border-color: var(--color-separador); }\n" },
        }),
      esperado: [[RUTA, 3]],
    },
    {
      nombre: "definición fuera de la fuente",
      codigo: "definicion-fuera-de-la-fuente",
      armar: () =>
        correr({
          contratos: [contrato()],
          archivos: { "apps/web/ui/Copia.module.css": ":root {\n  --color-separador: red;\n}\n" },
        }),
      esperado: [["apps/web/ui/Copia.module.css", 2]],
    },

    // ---- (a) excepciones.json
    {
      nombre: "excepción sin un campo: la línea del objeto",
      codigo: "excepcion-invalida",
      armar: () => conExcepciones([sin(excepcion(), "motivo")]),
      esperado: [[EXCEPCIONES, 2]],
    },
    {
      nombre: "excepción con un campo vacío: la línea de la clave",
      codigo: "excepcion-invalida",
      armar: () => conExcepciones([excepcion({ motivo: "" })]),
      esperado: [[EXCEPCIONES, 7]],
    },
    {
      nombre: "excepción con un campo de más: la línea de la clave sobrante",
      codigo: "excepcion-invalida",
      armar: () => conExcepciones([excepcion({ rutas: ["a.css"] })]),
      esperado: [[EXCEPCIONES, 12]],
    },
    {
      nombre: "un elemento que no es un objeto: la línea del elemento",
      codigo: "excepcion-invalida",
      armar: () => conExcepciones(["exc-1"]),
      esperado: [[EXCEPCIONES, 2]],
    },
    {
      nombre: "id repetido: la línea del id de la segunda",
      codigo: "excepcion-invalida",
      armar: () => conExcepciones([excepcion(), excepcion()]),
      esperado: [[EXCEPCIONES, 14]],
    },
    {
      nombre: "fecha que no existe: la línea de la clave",
      codigo: "excepcion-invalida",
      armar: () => conExcepciones([excepcion({ creada: "2026-13-45" })]),
      esperado: [[EXCEPCIONES, 10]],
    },
    {
      nombre: "huella que no es un SHA-256: la línea de la clave",
      codigo: "excepcion-invalida",
      armar: () => conExcepciones([excepcion({ huella: "abc" })]),
      esperado: [[EXCEPCIONES, 6]],
    },
    {
      nombre: "el archivo no es una lista: la línea donde empieza el valor",
      codigo: "excepcion-invalida",
      armar: () => conExcepciones({}, { texto: "\n\n{}\n" }),
      esperado: [[EXCEPCIONES, 3]],
    },
    {
      nombre: "excepciones.json no es JSON (leído del repo): la línea del error",
      codigo: "excepcion-invalida",
      armar: () =>
        enRepoTemporal({ [EXCEPCIONES]: '[\n  {\n    "id": "exc-1",\n  }\n]\n' }, (carpeta) =>
          ejecutar({ ...cargarDelRepo(carpeta), ahora: AHORA }),
        ),
      esperado: [[EXCEPCIONES, 4]],
    },
    {
      nombre: "exclusión con un campo vacío: la línea de la clave en exclusiones.json",
      codigo: "excepcion-invalida",
      armar: () => conExclusiones(docsCon({ motivo: "" })),
      esperado: [[EXCLUSIONES, 16]],
    },
    {
      nombre: "exclusión de una clase que no se puede excluir: la línea de «clase»",
      codigo: "excepcion-invalida",
      armar: () => conExclusiones(docsCon({ clase: "backend" })),
      esperado: [[EXCLUSIONES, 15]],
    },
    {
      nombre: "exclusión con un alcance inválido: la línea de «alcance»",
      codigo: "excepcion-invalida",
      armar: () => conExclusiones(docsCon({ alcance: "todo" })),
      esperado: [[EXCLUSIONES, 14]],
    },
    {
      nombre: "exclusiones.json no es una lista: la línea del valor",
      codigo: "excepcion-invalida",
      armar: () => conExclusiones({}),
      esperado: [[EXCLUSIONES, 1]],
    },
    {
      nombre: "excepción vencida: la línea de «vence»",
      codigo: "excepcion-vencida",
      armar: () => conExcepciones([excepcion({ creada: "2026-09-01", vence: "2026-10-01" })]),
      esperado: [[EXCEPCIONES, 11]],
    },
    {
      nombre: "exclusión vencida: la línea de «vence»",
      codigo: "excepcion-vencida",
      armar: () => conExclusiones(docsCon({ creada: "2026-09-01", vence: "2026-10-01" })),
      esperado: [[EXCLUSIONES, 20]],
    },
    {
      nombre: "excepción de más de 60 días: la línea de «vence»",
      codigo: "excepcion-plazo-excesivo",
      armar: () => conExcepciones([excepcion({ vence: "2027-06-01" })]),
      esperado: [[EXCEPCIONES, 11]],
    },
    {
      nombre: "excepción que vence antes de crearse: la línea de «vence»",
      codigo: "excepcion-vence-antes-de-creada",
      armar: () => conExcepciones([excepcion({ creada: "2026-10-10", vence: "2026-10-01" })]),
      esperado: [[EXCEPCIONES, 11]],
    },
    {
      nombre: "excepción creada en el futuro: la línea de «creada»",
      codigo: "excepcion-creada-futura",
      armar: () => conExcepciones([excepcion({ creada: "2026-11-01" })]),
      esperado: [[EXCEPCIONES, 10]],
    },
    {
      nombre: "ruta con comodín: la línea de «ruta»",
      codigo: "excepcion-ruta-no-exacta",
      armar: () => conExcepciones([excepcion({ ruta: "apps/web/**" })]),
      esperado: [[EXCEPCIONES, 5]],
    },
    {
      nombre: "la huella ya no coincide: la línea de «huella»",
      codigo: "excepcion-huella-cambiada",
      armar: () =>
        conExcepciones([excepcion()], {
          archivos: { [RUTA]: `${LINEA_DE_USO.replaceAll("}", "margin: 1px; }")}\n` },
        }),
      esperado: [[EXCEPCIONES, 6]],
    },
    {
      nombre: "exclusión de un archivo que cambió: la línea de «huella»",
      codigo: "excepcion-huella-cambiada",
      armar: () =>
        conExclusiones([
          ...EXCLUSIONES_BASE,
          {
            id: "excl-caja",
            alcance: "ruta",
            ruta: "apps/web/ui/Caja.module.css",
            huella: huellaDelArchivo("otro contenido"),
            motivo: "Prueba",
            responsable: "Ingeniería",
            aprobadoPor: "Dueño",
            creada: "2026-10-21",
            vence: "2026-12-20",
          },
        ]),
      esperado: [[EXCLUSIONES, 26]],
    },
    {
      nombre: "excepción obsoleta (el archivo ya no tiene el problema): la línea del id",
      codigo: "excepcion-obsoleta",
      armar: () => conExcepciones([excepcion()], { archivos: { [RUTA]: ".caja {}\n" } }),
      esperado: [[EXCEPCIONES, 3]],
    },
    {
      nombre: "excepción obsoleta (el archivo ya no existe): la línea del id de la segunda",
      codigo: "excepcion-obsoleta",
      armar: () =>
        conExcepciones([excepcion(), excepcion({ id: "exc-2", ruta: "apps/web/ui/Nada.css" })]),
      esperado: [[EXCEPCIONES, 14]],
    },
    {
      nombre: "exclusión de una clase sin archivos: la línea del id",
      codigo: "excepcion-obsoleta",
      armar: () => conExclusiones(EXCLUSIONES_BASE, { archivos: { "README.md": null } }),
      esperado: [[EXCLUSIONES, 13]],
    },
    {
      nombre: "excepción que apunta a un contrato que no existe: la línea de «contrato»",
      codigo: "excepcion-contrato-inexistente",
      armar: () => conExcepciones([excepcion({ contrato: "fantasma" })]),
      esperado: [[EXCEPCIONES, 4]],
    },

    // ---- la autocomprobación del propio guardián
    {
      nombre: "un hallazgo sin línea: el archivo ofensor, línea 1, y nombra el código",
      codigo: "falla-sin-ubicacion",
      armar: () =>
        correr({
          previas: {
            fallas: [
              {
                codigo: "excepcion-invalida",
                archivo: EXCEPCIONES,
                contrato: null,
                motivo: "Un chequeo olvidó la línea.",
                correccion: "Ponésela.",
              },
            ],
          },
        }),
      esperado: [[EXCEPCIONES, 1]],
    },
    {
      nombre: "un hallazgo sin archivo ni línea: el guardián, línea 1",
      codigo: "falla-sin-ubicacion",
      armar: () =>
        correr({
          previas: {
            fallas: [{ codigo: "ruta-sin-clase", contrato: null, motivo: "x", correccion: "y" }],
          },
        }),
      esperado: [[GUARDIAN, 1]],
    },
    ...[0, -3, 1.5, "7", null].map((linea): Caso => ({
      nombre: `un hallazgo con línea ${JSON.stringify(linea)} no es una línea válida`,
      codigo: "falla-sin-ubicacion",
      armar: () =>
        correr({
          previas: {
            fallas: [
              {
                codigo: "ruta-sin-clase",
                archivo: "a.ts",
                linea,
                contrato: null,
                motivo: "x",
                correccion: "y",
              },
            ],
          },
        }),
      esperado: [["a.ts", 1]],
    })),
    {
      nombre: "un hallazgo con el archivo vacío",
      codigo: "falla-sin-ubicacion",
      armar: () =>
        correr({
          previas: {
            fallas: [
              {
                codigo: "ruta-sin-clase",
                archivo: "",
                linea: 4,
                contrato: null,
                motivo: "x",
                correccion: "y",
              },
            ],
          },
        }),
      esperado: [[GUARDIAN, 1]],
    },
    {
      nombre: "un aviso sin línea también hace fallar",
      codigo: "falla-sin-ubicacion",
      armar: () =>
        correr({
          previas: {
            avisos: [
              {
                codigo: "ruta-ausente-en-disco",
                archivo: "b.ts",
                contrato: null,
                motivo: "x",
                correccion: "y",
              },
            ],
          },
        }),
      esperado: [["b.ts", 1]],
    },
    {
      nombre: "una falla con un código fuera de la lista",
      codigo: "codigo-fuera-de-la-lista",
      armar: () =>
        correr({
          previas: {
            fallas: [
              {
                codigo: "inventada",
                archivo: "c.ts",
                linea: 5,
                contrato: null,
                motivo: "x",
                correccion: "y",
              },
            ],
          },
        }),
      esperado: [["c.ts", 1]],
    },
    {
      nombre: "un aviso con un código que es de falla",
      codigo: "codigo-fuera-de-la-lista",
      armar: () =>
        correr({
          previas: {
            avisos: [
              {
                codigo: "excepcion-vencida",
                archivo: "d.ts",
                linea: 2,
                contrato: null,
                motivo: "x",
                correccion: "y",
              },
            ],
          },
        }),
      esperado: [["d.ts", 1]],
    },

    // ---- aviso de una ruta que git lista y ya no está en el disco: la ruta, línea 1
    {
      nombre: "ruta versionada borrada del disco sin registrar el borrado",
      codigo: "ruta-ausente-en-disco",
      lista: "avisos",
      armar: () =>
        enRepoTemporal({}, (carpeta) => {
          spawnSync("git", ["add", "."], { cwd: carpeta });
          rmSync(join(carpeta, "scripts/migrar.ts"));
          return ejecutar({ ...cargarDelRepo(carpeta), ahora: AHORA });
        }),
      esperado: [["scripts/migrar.ts", 1]],
    },

    // ---- avisos de vencimiento próximo
    {
      nombre: "excepción que vence en 14 días: la línea del id",
      codigo: "excepcion-por-vencer",
      lista: "avisos",
      armar: () => conExcepciones([excepcion({ vence: "2026-11-04" })]),
      esperado: [[EXCEPCIONES, 3]],
    },
    {
      nombre: "excepción que vence hoy: la línea del id",
      codigo: "excepcion-por-vencer",
      lista: "avisos",
      armar: () => conExcepciones([excepcion({ vence: "2026-10-21" })]),
      esperado: [[EXCEPCIONES, 3]],
    },
    {
      nombre: "la segunda excepción es la que vence: la línea de su id",
      codigo: "excepcion-por-vencer",
      lista: "avisos",
      armar: () => conExcepciones([excepcion(), excepcion({ id: "exc-2", vence: "2026-10-25" })]),
      esperado: [[EXCEPCIONES, 14]],
    },
    {
      nombre: "exclusión que vence en pocos días: la línea de su id en exclusiones.json",
      codigo: "excepcion-por-vencer",
      lista: "avisos",
      armar: () => conExclusiones(docsCon({ vence: "2026-11-01" })),
      esperado: [[EXCLUSIONES, 13]],
    },
  ];
}

/** Arma un repositorio git temporal con esos archivos, corre `accion` y lo borra. */
function enRepoTemporal<T>(archivos: Record<string, string>, accion: (carpeta: string) => T): T {
  const carpeta = mkdtempSync(join(tmpdir(), "guardian-diag-"));
  try {
    const todos: Record<string, string> = {
      ...BASE,
      [EXCEPCIONES]: "[]\n",
      [EXCLUSIONES]: json(EXCLUSIONES_BASE),
      ...archivos,
    };
    for (const [ruta, contenido] of Object.entries(todos)) {
      mkdirSync(dirname(join(carpeta, ruta)), { recursive: true });
      writeFileSync(join(carpeta, ruta), contenido);
    }
    spawnSync("git", ["init", "-q"], { cwd: carpeta });
    return accion(carpeta);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

const todas = (resultado: Resultado): Falla[] => [...resultado.fallas, ...resultado.avisos];
const tieneUbicacion = (hallazgo: Falla): boolean =>
  typeof hallazgo.archivo === "string" &&
  hallazgo.archivo !== "" &&
  Number.isInteger(hallazgo.linea) &&
  (hallazgo.linea ?? 0) >= 1;

describe("la lista cerrada de códigos", () => {
  it("cada código de falla tiene su regla de línea, su descripción y al menos un caso en la tabla", () => {
    expect(new Set(CODIGOS_DE_FALLA).size).toBe(CODIGOS_DE_FALLA.length);
    expect(Object.keys(REGLAS_DE_LINEA).sort()).toEqual([...CODIGOS_DE_FALLA].sort());
    expect(Object.keys(DESCRIPCION_DE_CODIGOS)).toEqual([...CODIGOS_DE_FALLA]);
    const cubiertos = new Set(casos().map((caso) => caso.codigo));
    const sinCaso = [...CODIGOS_DE_FALLA, ...CODIGOS_DE_AVISO].filter((c) => !cubiertos.has(c));
    expect(sinCaso).toEqual([]);
    expect(
      [...cubiertos].filter((c) => !CODIGOS_DE_FALLA.includes(c) && !CODIGOS_DE_AVISO.includes(c)),
    ).toEqual([]);
  });

  it("los avisos son una lista cerrada que no se repite", () => {
    expect([...CODIGOS_DE_AVISO].sort()).toEqual([
      "declaracion-falsa",
      "excepcion-por-vencer",
      "ruta-ausente-en-disco",
    ]);
  });

  it("el informe publica los códigos de falla en orden, con su regla de línea", () => {
    const { chequeos } = correr().informe.reglasEjecutadas;
    expect(chequeos.map((c) => c.codigo)).toEqual([...CODIGOS_DE_FALLA]);
    for (const chequeo of chequeos) {
      expect(chequeo.descripcion, chequeo.codigo).toBe(DESCRIPCION_DE_CODIGOS[chequeo.codigo]);
      expect(chequeo.reglaDeLinea, chequeo.codigo).toBe(REGLAS_DE_LINEA[chequeo.codigo]);
    }
  });

  it('todo código que el código fuente del guardián escribe como `codigo: "…"` está en la lista', () => {
    const carpeta = join(RAIZ_ORIGINAL, "arquitectura/contratos");
    const escritos = new Set<string>();
    for (const archivo of readdirSync(carpeta).filter((a) => a.endsWith(".cjs"))) {
      // `invariantes.cjs` es el catálogo de la matriz: cita códigos en cada `esperado`, no los emite.
      if (archivo === "codigos.cjs" || archivo === "invariantes.cjs") continue;
      const texto = readFileSync(join(carpeta, archivo), "utf8");
      for (const [, codigo] of texto.matchAll(/codigo: "([a-z-]+)"/g))
        escritos.add(codigo as string);
    }
    const conocidos = new Set([...CODIGOS_DE_FALLA, ...CODIGOS_DE_AVISO]);
    expect([...escritos].filter((c) => !conocidos.has(c))).toEqual([]);
    // y no sobra ninguno: todo código de la lista lo emite algún chequeo
    expect([...CODIGOS_DE_FALLA].filter((c) => !escritos.has(c))).toEqual([]);
  });
});

describe("cada código de falla trae archivo y línea exactos", () => {
  const tabla = casos().map((caso) => [`${caso.codigo} · ${caso.nombre}`, caso] as const);

  it.each(tabla)("%s", (_nombre, caso) => {
    const resultado = caso.armar();
    const lista = caso.lista === "avisos" ? resultado.avisos : resultado.fallas;
    const propios = lista.filter((hallazgo) => hallazgo.codigo === caso.codigo);
    expect(propios.map((h) => [h.archivo, h.linea])).toEqual(caso.esperado);
    for (const hallazgo of propios) {
      expect(formatearFalla(hallazgo).startsWith(`${hallazgo.archivo}:${hallazgo.linea} · `)).toBe(
        true,
      );
    }
    // y nada de lo que salió en esa corrida quedó sin ubicación
    for (const hallazgo of todas(resultado)) {
      expect(tieneUbicacion(hallazgo), JSON.stringify(hallazgo)).toBe(true);
    }
  });
});

describe("autocomprobación de ubicación (M3)", () => {
  const sinLinea = {
    codigo: "excepcion-invalida",
    archivo: EXCEPCIONES,
    contrato: null,
    motivo: "Un chequeo olvidó la línea.",
    correccion: "Ponésela.",
  };

  it("un hallazgo sin línea hace fallar al guardián con un hallazgo propio que nombra el código", () => {
    const resultado = correr({ previas: { fallas: [sinLinea] } });
    expect(resultado.informe.resultado).toBe("falla");
    expect(resultado.fallas).toHaveLength(1);
    expect(resultado.fallas[0]).toMatchObject({ codigo: "falla-sin-ubicacion", linea: 1 });
    expect(resultado.fallas[0]?.motivo).toContain("«excepcion-invalida»");
    expect(resultado.fallas[0]?.motivo).toContain("Un chequeo olvidó la línea.");
  });

  it("el hallazgo sin línea no se imprime: lo reemplaza la falla propia", () => {
    const resultado = correr({ previas: { fallas: [sinLinea] } });
    expect(resultado.fallas.map((f) => f.codigo)).toEqual(["falla-sin-ubicacion"]);
    expect(resultado.informe.fallas.map((f) => f.codigo)).toEqual(["falla-sin-ubicacion"]);
  });

  it("un hallazgo con archivo y línea válidos no dispara nada", () => {
    const resultado = correr({ previas: { fallas: [{ ...sinLinea, linea: 3 }] } });
    expect(resultado.fallas.map((f) => [f.codigo, f.archivo, f.linea])).toEqual([
      ["excepcion-invalida", EXCEPCIONES, 3],
    ]);
  });

  it("un hallazgo con dos defectos (sin línea y con código ajeno) da las dos fallas", () => {
    const resultado = correr({ previas: { fallas: [{ ...sinLinea, codigo: "inventada" }] } });
    expect(resultado.fallas.map((f) => f.codigo).sort()).toEqual([
      "codigo-fuera-de-la-lista",
      "falla-sin-ubicacion",
    ]);
  });

  it("un aviso válido sigue siendo un aviso y no falla", () => {
    const resultado = correr({
      previas: {
        avisos: [
          {
            codigo: "ruta-ausente-en-disco",
            archivo: "e.ts",
            linea: 1,
            contrato: null,
            motivo: "x",
            correccion: "y",
          },
        ],
      },
    });
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos.map((a) => a.archivo)).toEqual(["e.ts"]);
  });

  it("el código de un hallazgo sin contrato se conserva como `null`", () => {
    const resultado = correr({ previas: { fallas: [sinLinea] } });
    expect(resultado.fallas[0]?.contrato).toBeNull();
    const conContrato = correr({
      previas: { fallas: [{ ...sinLinea, contrato: "color-separador" }] },
    });
    expect(conContrato.fallas[0]?.contrato).toBe("color-separador");
  });
});

describe("el aviso de vencimiento próximo", () => {
  it.each([
    ["14 días", "2026-11-04", 1],
    ["hoy", "2026-10-21", 1],
    ["15 días", "2026-11-05", 0],
    ["60 días", "2026-12-20", 0],
    ["ayer", "2026-10-20", 0],
  ])("una excepción que vence en %s (%s) da %i aviso(s)", (_nombre, vence, avisos) => {
    const resultado = conExcepciones([excepcion({ vence, creada: "2026-10-01" })]);
    expect(resultado.avisos.filter((a) => a.codigo === "excepcion-por-vencer")).toHaveLength(
      avisos,
    );
  });

  it("avisa sin bloquear: el guardián pasa y la excepción sigue silenciando", () => {
    const resultado = conExcepciones([excepcion({ vence: "2026-10-30" })]);
    expect(resultado.fallas).toEqual([]);
    expect(resultado.informe.resultado).toBe("pasa");
    expect(resultado.informe.excepcionesAplicadas.map((e) => e.id)).toEqual(["exc-1"]);
    expect(resultado.avisos).toHaveLength(1);
    expect(resultado.avisos[0]).toMatchObject({
      codigo: "excepcion-por-vencer",
      archivo: EXCEPCIONES,
      linea: 3,
      contrato: "color-separador",
    });
    expect(resultado.avisos[0]?.motivo).toContain("«exc-1»");
    expect(resultado.avisos[0]?.motivo).toContain("2026-10-30");
    expect(resultado.avisos[0]?.motivo).toContain("faltan 9 días");
    expect(resultado.informe.totales["avisos"]).toBe(1);
  });

  it("una excepción vencida falla y ya no avisa", () => {
    const resultado = conExcepciones([excepcion({ creada: "2026-09-01", vence: "2026-10-20" })]);
    expect(resultado.fallas.map((f) => f.codigo)).toContain("excepcion-vencida");
    expect(resultado.avisos).toEqual([]);
  });

  it("una fecha de vencimiento mal escrita no avisa (falla por inválida)", () => {
    const resultado = conExcepciones([excepcion({ vence: "2026-10-3x" })]);
    expect(resultado.avisos).toEqual([]);
    expect(resultado.fallas.map((f) => f.codigo)).toContain("excepcion-invalida");
  });

  it("una exclusión por vencer avisa con el contrato «exclusión» y no bloquea", () => {
    const resultado = conExclusiones(docsCon({ vence: "2026-10-28" }));
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toHaveLength(1);
    expect(resultado.avisos[0]).toMatchObject({
      codigo: "excepcion-por-vencer",
      archivo: EXCLUSIONES,
      linea: 13,
      contrato: "exclusión",
    });
    expect(resultado.avisos[0]?.motivo).toContain("Exclusión «excl-docs»");
  });

  it("dos entradas por vencer dan dos avisos, cada uno en la línea de su id", () => {
    const resultado = conExcepciones([
      excepcion({ vence: "2026-10-22" }),
      excepcion({ id: "exc-2", vence: "2026-10-23" }),
    ]);
    expect(resultado.avisos.map((a) => [a.archivo, a.linea])).toEqual([
      [EXCEPCIONES, 3],
      [EXCEPCIONES, 14],
    ]);
  });
});

describe("el informe y la salida impresa", () => {
  it("cada falla y cada aviso del informe trae `linea` entera desde 1", () => {
    const resultado = correr({
      contratos: [contrato({ bloqueaDeclaracionFalsa: false })],
      excepciones: [excepcion({ vence: "2026-10-30" })],
      archivos: {
        [WEB]: json({ usa: ["color-separador"] }),
        [EXCEPCIONES]: json([excepcion({ vence: "2026-10-30" })]),
        "herramienta/x.ts": "",
        "src/modulos/nuevo/dominio/x.ts": "export {};",
      },
    });
    expect(resultado.informe.fallas.length).toBeGreaterThan(1);
    expect(resultado.informe.avisos.length).toBeGreaterThan(0);
    for (const hallazgo of [...resultado.informe.fallas, ...resultado.informe.avisos]) {
      expect(Number.isInteger(hallazgo.linea), hallazgo.codigo).toBe(true);
      expect(hallazgo.linea, hallazgo.codigo).toBeGreaterThanOrEqual(1);
      expect(Object.keys(hallazgo), hallazgo.codigo).not.toContain("donde");
    }
  });

  it("toda falla se imprime como `archivo:línea · contrato|- · motivo · corrección`", () => {
    const resultado = correr({
      archivos: { [WEB]: null, "herramienta/x.ts": "" },
    });
    expect(resultado.fallas.length).toBe(2);
    const lineas = resultado.fallas.map((falla) => formatearFalla(falla));
    expect(lineas).toEqual([
      expect.stringMatching(/^apps\/web\/contratos\.json:1 · - · La unidad «apps\/web» no tiene /),
      expect.stringMatching(/^herramienta\/x\.ts:1 · - · La ruta versionada no calza /),
    ]);
    for (const linea of lineas) expect(linea.split(" · ")).toHaveLength(4);
  });
});

describe("CLI: node arquitectura/contratos/guardian.cjs sobre un repositorio roto", () => {
  /** Un repositorio git temporal con una copia del guardián (que mira el repo donde vive). */
  function conGuardian(archivos: Record<string, string>, accion: (carpeta: string) => void): void {
    enRepoTemporal(archivos, (carpeta) => {
      const origen = join(RAIZ, "arquitectura/contratos");
      mkdirSync(join(carpeta, "arquitectura/contratos"), { recursive: true });
      for (const archivo of readdirSync(origen).filter((a) => a.endsWith(".cjs"))) {
        copyFileSync(join(origen, archivo), join(carpeta, "arquitectura/contratos", archivo));
      }
      accion(carpeta);
    });
  }
  const correrCli = (carpeta: string) =>
    spawnSync(process.execPath, ["arquitectura/contratos/guardian.cjs", "--sin-informe"], {
      cwd: carpeta,
      encoding: "utf8",
    });
  const dia = (sumarDias: number): string =>
    new Date(Date.now() + sumarDias * 86_400_000).toISOString().slice(0, 10);
  const exclusionesDeHoy = (venceDocs: number): string =>
    json(
      EXCLUSIONES_BASE.map((entrada, indice) => ({
        ...entrada,
        creada: dia(0),
        vence: dia(indice === 1 ? venceDocs : 50),
      })),
    );

  it("una falla sale por stderr con `archivo:línea`, termina en 1 y cuenta las fallas", () => {
    conGuardian({ [EXCLUSIONES]: exclusionesDeHoy(50), "herramienta/x.ts": "" }, (carpeta) => {
      const corrida = correrCli(carpeta);
      expect(corrida.status, corrida.stdout + corrida.stderr).toBe(1);
      expect(corrida.stderr).toMatch(
        /^FALLA herramienta\/x\.ts:1 · - · La ruta versionada no calza con ninguna clase .* · Agregá su regla/m,
      );
      const impresas = corrida.stderr.split("\n").filter((linea) => linea.startsWith("FALLA "));
      expect(impresas).toHaveLength(1);
      for (const linea of impresas) expect(linea).toMatch(/^FALLA \S+:\d+ · /);
      expect(corrida.stderr).toContain("Guardián de contratos: 1 fallas, 0 avisos");
    });
  });

  it("una exclusión por vencer sale como AVISO con `archivo:línea` y el guardián termina en 0", () => {
    conGuardian({ [EXCLUSIONES]: exclusionesDeHoy(5) }, (carpeta) => {
      const corrida = correrCli(carpeta);
      expect(corrida.status, corrida.stdout + corrida.stderr).toBe(0);
      expect(corrida.stdout).toMatch(
        /^AVISO arquitectura\/contratos\/exclusiones\.json:13 · exclusión · Exclusión «excl-docs»: vence el \d{4}-\d{2}-\d{2} \(faltan [45] días;/m,
      );
      expect(corrida.stdout).toContain("1 avisos");
    });
  });

  it("un excepciones.json que no es JSON falla con la línea del error", () => {
    conGuardian(
      { [EXCLUSIONES]: exclusionesDeHoy(50), [EXCEPCIONES]: '[\n  {\n    "id": "x",\n  }\n]\n' },
      (carpeta) => {
        const corrida = correrCli(carpeta);
        expect(corrida.status, corrida.stdout + corrida.stderr).toBe(1);
        expect(corrida.stderr).toMatch(
          /^FALLA arquitectura\/contratos\/excepciones\.json:4 · - · No se pudo leer el archivo como JSON/m,
        );
      },
    );
  });
});
