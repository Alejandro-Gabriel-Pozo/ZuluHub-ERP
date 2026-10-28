import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  REGISTRO_DE_EJEMPLO,
  RAIZ,
  alterar,
  arbolDesdeElRepo,
  carpetaTemporal,
  escribirEn,
  leerEn,
  limpiarTemporales,
  lineaEn,
  quitarInvarianteDelCatalogo,
  quitarMutacionDelCatalogo,
  repoSanoEnDisco,
  retiroCompleto,
} from "./guardian-apoyo";

/**
 * La vigilancia de la versión anterior (`no-debilitar.cjs`): el verificador de la BASE corre contra el
 * árbol del PR y falla si algo de lo que la base exigía dejó de exigirse. Cada chequeo (a)-(h) tiene su
 * tabla de casos: el estado sano pasa, cada alteración falla con el código, el archivo y la línea EXACTOS
 * (y nada más), y los cambios legítimos (agregar, endurecer, retirar con registro) no fallan.
 *
 * Las tablas de abajo trabajan sobre instantáneas sintéticas con textos de líneas conocidas; al final, los
 * casos de punta a punta usan árboles temporales y el CLI real (con su proceso hijo) para probar que la
 * base detecta lo que un verificador debilitado del PR ya no vería.
 */

const require = createRequire(import.meta.url);

interface Hallazgo {
  codigo: string;
  archivo: string;
  linea: number;
  contrato: string | null;
  motivo: string;
  correccion: string;
}
type Seccion = Record<string, unknown>;
type Instantanea = Record<string, Seccion>;
const nd = require("../../arquitectura/contratos/no-debilitar.cjs") as {
  ARCHIVOS: Record<string, string>;
  CODIGOS_DE_FALLA: readonly string[];
  CODIGOS_DE_AVISO: readonly string[];
  DESCRIPCION_DE_CODIGOS: Record<string, string>;
  CHEQUEOS: readonly unknown[];
  ejecutaElGuardian: (linea: string) => boolean;
  chequearPaquete: (base: Instantanea, pr: Instantanea) => Array<{ codigo: string }>;
  leerCi: (texto: string) => Seccion;
  leerDeuda: (registro: string | null, configuracion: string | null) => Seccion;
  leerConstante: (texto: string | null, nombre: string) => Seccion;
  leerEvasiones: (catalogo: string | null, externos: string | null) => Seccion;
  leerPaquete: (texto: string | null) => Seccion;
  leerRetiros: (texto: string | null) => Seccion;
  extraerInvariantes: (modulo: unknown) => { ids: string[]; mutaciones: unknown[] };
  versionMayor: (nueva: unknown, vieja: unknown) => boolean;
  formatear: (h: Hallazgo) => string;
  limites: readonly string[];
  verificar: (datos: {
    base: Instantanea;
    pr: Instantanea;
    ahora?: Date;
    leerPr: (ruta: string) => string | null;
  }) => { fallas: Hallazgo[]; avisos: Hallazgo[] };
};
const guardian = require("../../arquitectura/contratos/guardian.cjs") as {
  vigilarConLaBase: (carpeta: string, raiz: string) => number;
  valorDeOpcion: (argumentos: string[], nombre: string) => string | undefined;
};

const HOY = new Date("2026-10-21T12:00:00Z");
const A = nd.ARCHIVOS;
const ARCHIVO_REGISTRO = A["registro"] ?? "";
const ARCHIVO_CODIGOS = A["codigos"] ?? "";
const ARCHIVO_CLASIFICACION = A["clasificacion"] ?? "";
const ARCHIVO_EXCEPCIONES = A["excepciones"] ?? "";
const ARCHIVO_RETIROS = A["retiros"] ?? "";
const ARCHIVO_INVARIANTES = A["invariantes"] ?? "";
const ARCHIVO_GATE = A["evaluarGate"] ?? "";
const ARCHIVO_CI = A["ci"] ?? "";
const ARCHIVO_PAQUETE = A["paquete"] ?? "";
const ARCHIVO_EVASIONES = A["evasiones"] ?? "";
const ARCHIVO_EXTERNOS = A["evasionesExternas"] ?? "";
const ARCHIVO_DEUDA = A["deudaRegistro"] ?? "";
const ARCHIVO_CONFIGURACION_DE_DEUDA = A["deudaConfiguracion"] ?? "";

// ---------------------------------------------------------------------------------------------
// Un árbol sintético sano: instantánea estructural + textos con líneas conocidas.
// ---------------------------------------------------------------------------------------------

interface Detector {
  tipo: string;
  clases: string[];
}
interface Contrato {
  id: string;
  version: string;
  fuente: Record<string, string>;
  detectores: Detector[];
  /** El motivo de «no puede haber un detector de definición» o `null` si el contrato no lo declara. */
  sinDefinicion?: string | null;
}
interface Clases {
  esperadas: string[];
  excluibles: string[];
  /** Lo permitido en cada clase excluida (`extension:.md`, `ruta:package-lock.json`); `null` = la lista no existe. */
  permitidas: Record<string, string[]> | null;
}
interface Estructura {
  registro: Contrato[];
  codigos: string[];
  clases: Clases;
  gateConGuardianCaido: Record<string, string[]>;
  invariantes: { id: string; mutaciones: string[] }[] | null;
}
interface Estado {
  estructura: Estructura;
  arbol: Record<string, string>;
}

const lineas = (...l: string[]): string => `${l.join("\n")}\n`;

/** El registro como texto: el `id` del contrato número i (desde 0) está en la línea 4 + 3 * i. */
const textoDelRegistro = (contratos: Contrato[]): string =>
  lineas(
    "/** Registro sintético. */",
    "module.exports = [",
    ...contratos.flatMap((c) => ["  {", `    id: "${c.id}",`, "  },"]),
    "];",
  );
/** Igual para la matriz: `const INVARIANTES` está en la línea 2 y el `id` del invariante i (desde 0), en la 4 + 3 * i. */
const textoDeLaMatriz = (invariantes: { id: string }[]): string =>
  lineas(
    "/** Matriz sintética. */",
    "const INVARIANTES = [",
    ...invariantes.flatMap((i) => ["  {", `    id: "${i.id}",`, "  },"]),
    "];",
    "module.exports = { INVARIANTES };",
  );
const textoDeCodigos = (codigos: string[]): string =>
  lineas(
    "/** Códigos. */",
    "",
    "const DESCRIPCION_DE_CODIGOS = {};",
    `const CODIGOS_DE_FALLA = ${JSON.stringify(codigos)};`,
  );
/** `CLASES_EXCLUIBLES` en la línea 4, `CLASES_ESPERADAS` en la 6 y `PERMITIDO_EN_CLASE_EXCLUIDA` en la 8. */
const textoDeClases = (c: Clases): string =>
  lineas(
    "/** Clasificación. */",
    "const CLASES = [];",
    "",
    `const CLASES_EXCLUIBLES = ${JSON.stringify(c.excluibles)};`,
    "",
    `const CLASES_ESPERADAS = ${JSON.stringify(c.esperadas)};`,
    "",
    c.permitidas === null
      ? "// sin lista de lo permitido"
      : `const PERMITIDO_EN_CLASE_EXCLUIDA = ${JSON.stringify(c.permitidas)};`,
  );
const textoDeExcepciones = (plazo: string, aviso: string): string =>
  lineas(
    "/** Excepciones. */",
    'const ARCHIVO = "x";',
    "",
    `const PLAZO_MAXIMO_DIAS = ${plazo};`,
    "/** Aviso. */",
    `const DIAS_DE_AVISO = ${aviso};`,
  );
/**
 * `topeDeExcepciones` en la línea 2, `bloqueaDeudaEnArchivoTocado` en la 3, `topeDeLineasPorArchivo` en la 4 y
 * `excluidosDelTope` en la 5 (cada exclusión, si hay, en su línea desde la 6).
 */
const textoDeLaConfiguracionDeDeuda = (
  tope: number,
  bloquea: boolean,
  topeDeLineas = 400,
  excluidos: string[] = [],
): string =>
  lineas(
    "{",
    `  "topeDeExcepciones": ${String(tope)},`,
    `  "bloqueaDeudaEnArchivoTocado": ${String(bloquea)},`,
    `  "topeDeLineasPorArchivo": ${String(topeDeLineas)},`,
    ...(excluidos.length === 0
      ? ['  "excluidosDelTope": []']
      : [
          '  "excluidosDelTope": [',
          ...excluidos.map(
            (ruta, i) =>
              `    { "ruta": "${ruta}", "motivo": "Datos." }${i < excluidos.length - 1 ? "," : ""}`,
          ),
          "  ]",
        ]),
    "}",
  );
const TEXTO_DEL_GATE = lineas("/** Gate. */", "", 'const OBLIGATORIOS = ["estatico", "guardian"];');
const TEXTO_DE_CI = lineas(
  "name: CI", //                                                          1
  "on:", //                                                               2
  "  pull_request:", //                                                   3
  "jobs:", //                                                             4
  "  estatico:", //                                                       5
  "    name: Estático", //                                                6
  "    runs-on: ubuntu-latest", //                                        7
  "    timeout-minutes: 15", //                                           8
  "    steps:", //                                                        9
  "      - run: npm run lint", //                                         10
  "", //                                                                  11
  "  guardian:", //                                                       12
  "    name: Guardián de contratos", //                                   13
  "    runs-on: ubuntu-latest", //                                        14
  "    timeout-minutes: 10", //                                           15
  "    steps:", //                                                       16
  "      - uses: actions/checkout@aaaa # v7", //                          17
  "      - run: node arquitectura/contratos/guardian.cjs", //             18
  "      - name: Rama base", //                                           19
  "        if: github.event_name == 'pull_request'", //                   20
  "        uses: actions/checkout@aaaa # v7", //                          21
  "        with:", //                                                     22
  "          path: base", //                                              23
  "      - name: Vigilancia", //                                          24
  "        if: github.event_name == 'pull_request'", //                   25
  "        run: node base/arquitectura/contratos/no-debilitar.cjs --arbol .", // 26
  "", //                                                                  27
  "  gate:", //                                                           28
  "    name: Gate", //                                                    29
  "    needs: [estatico, guardian]", //                                   30
  "    if: always()", //                                                  31
  "    runs-on: ubuntu-latest", //                                        32
  "    steps:", //                                                        33
  "      - run: node arquitectura/evaluar-gate.cjs", //                   34
);
const TEXTO_DE_PAQUETE = lineas(
  "{", //                                                                                  1
  '  "name": "x",', //                                                                     2
  '  "scripts": {', //                                                                     3
  '    "arquitectura": "depcruise src && npm run guardian",', //                           4
  '    "guardian": "node arquitectura/contratos/guardian.cjs",', //                        5
  '    "gate": "npm run arquitectura"', //                                                 6
  "  }", //                                                                                7
  "}",
);

const CONTRATO_COLOR: Contrato = {
  id: "color-de-separadores",
  version: "1.0.0",
  fuente: { archivo: "apps/web/ui/tokens.css", variable: "--color-separador" },
  detectores: [
    { tipo: "uso", clases: ["frontend"] },
    { tipo: "uso", clases: ["frontend"] },
    { tipo: "definicion", clases: ["frontend"] },
  ],
};
const CONTRATO_CLAVES: Contrato = {
  id: "claves-de-permisos",
  version: "1.2.0",
  fuente: { archivo: "src/capacidades/permisos/claves.ts", exportacion: "CLAVES" },
  detectores: [
    { tipo: "uso", clases: ["backend", "pruebas"] },
    { tipo: "definicion", clases: ["backend"] },
  ],
};
const MATRIZ_BASE = [
  { id: "I1", mutaciones: ["eliminacion", "alteracion"] },
  { id: "I2", mutaciones: ["eliminacion"] },
];

/** Un caso de la batería de evasión, con lo que la vigilancia compara (el resto del caso no importa acá). */
interface CasoDeEvasion {
  id: string;
  via: string;
  esperado: Record<string, unknown>;
  estado: string;
  vence?: string;
  revisar?: string;
}
const textoDeEvasiones = (casos: CasoDeEvasion[]): string => `${JSON.stringify(casos, null, 2)}\n`;
const ESPERA_RUTA = { tipo: "bloquea", codigo: "ruta-sin-clase", archivo: "x.ts" };
const EXIGE = { tipo: "exige-excepcion" };
const CATALOGO_SANO: CasoDeEvasion[] = [
  { id: "EV-001", via: "filtros", esperado: ESPERA_RUTA, estado: "exigido" },
  {
    id: "EV-002",
    via: "workflow-ci",
    esperado: EXIGE,
    estado: "brecha-abierta",
    vence: "2026-12-20",
  },
  {
    id: "EV-003",
    via: "formato-no-soportado",
    esperado: EXIGE,
    estado: "riesgo-aceptado",
    revisar: "2027-04-19",
  },
  { id: "EV-004", via: "filtros", esperado: ESPERA_RUTA, estado: "exigido" },
];
const EXTERNOS_SANO: CasoDeEvasion[] = [
  { id: "EV-047", via: "ruta-alternativa", esperado: EXIGE, estado: "externo" },
];

const copia = <T>(valor: T): T => structuredClone(valor);

function estadoSano(): Estado {
  const estructura: Estructura = {
    registro: [copia(CONTRATO_COLOR), copia(CONTRATO_CLAVES)],
    codigos: ["a-uno", "b-dos", "c-tres"],
    clases: {
      esperadas: ["frontend", "backend", "config"],
      excluibles: ["generado", "docs"],
      permitidas: {
        docs: ["extension:.md", "extension:.txt"],
        generado: ["ruta:package-lock.json", "ruta:skills-lock.json"],
      },
    },
    gateConGuardianCaido: {
      failure: ["guardian: failure"],
      skipped: ["guardian: skipped"],
      cancelled: ["guardian: cancelled"],
    },
    invariantes: copia(MATRIZ_BASE),
  };
  const arbol: Record<string, string> = {
    [ARCHIVO_REGISTRO]: textoDelRegistro(estructura.registro),
    [ARCHIVO_CODIGOS]: textoDeCodigos(estructura.codigos),
    [ARCHIVO_CLASIFICACION]: textoDeClases(estructura.clases),
    [ARCHIVO_EXCEPCIONES]: textoDeExcepciones("60", "14"),
    [ARCHIVO_RETIROS]: "[]\n",
    [ARCHIVO_GATE]: TEXTO_DEL_GATE,
    [ARCHIVO_CI]: TEXTO_DE_CI,
    [ARCHIVO_PAQUETE]: TEXTO_DE_PAQUETE,
    [ARCHIVO_INVARIANTES]: textoDeLaMatriz(MATRIZ_BASE),
    [ARCHIVO_EVASIONES]: textoDeEvasiones(CATALOGO_SANO),
    [ARCHIVO_EXTERNOS]: textoDeEvasiones(EXTERNOS_SANO),
    [ARCHIVO_DEUDA]: "[]\n",
    [ARCHIVO_CONFIGURACION_DE_DEUDA]: textoDeLaConfiguracionDeDeuda(10, true),
  };
  return { estructura, arbol };
}

/** Un estado con los textos que dependen de la estructura regenerados (para que las líneas calcen). */
function conEstructura(estado: Estado, cambio: (e: Estructura) => void): Estado {
  const siguiente: Estado = copia(estado);
  cambio(siguiente.estructura);
  const e = siguiente.estructura;
  siguiente.arbol[ARCHIVO_REGISTRO] = textoDelRegistro(e.registro);
  siguiente.arbol[ARCHIVO_CODIGOS] = textoDeCodigos(e.codigos);
  siguiente.arbol[ARCHIVO_CLASIFICACION] = textoDeClases(e.clases);
  if (e.invariantes === null) delete siguiente.arbol[ARCHIVO_INVARIANTES];
  else siguiente.arbol[ARCHIVO_INVARIANTES] = textoDeLaMatriz(e.invariantes);
  return siguiente;
}
const conTexto = (estado: Estado, archivo: string, texto: string | null): Estado => {
  const siguiente: Estado = copia(estado);
  if (texto === null) delete siguiente.arbol[archivo];
  else siguiente.arbol[archivo] = texto;
  return siguiente;
};
/** Reemplaza `de` por `a` en un archivo del árbol; falla si `de` no aparece exactamente una vez. */
function reemplazando(estado: Estado, archivo: string, de: string, a: string): Estado {
  const texto = estado.arbol[archivo] ?? "";
  expect(texto.split(de).length - 1, `«${de}» debe aparecer una vez en ${archivo}`).toBe(1);
  return conTexto(
    estado,
    archivo,
    texto.replace(de, () => a),
  );
}

function aInstantanea(estado: Estado): Instantanea {
  const { estructura: e, arbol } = estado;
  const ausenteSiNoHay: Seccion = { ausente: true };
  return {
    registro: { valor: e.registro },
    codigos: { valor: e.codigos },
    clases: { valor: e.clases },
    invariantes:
      e.invariantes === null
        ? ausenteSiNoHay
        : {
            valor: {
              ids: e.invariantes.map((i) => i.id),
              mutaciones: e.invariantes.flatMap((i) =>
                i.mutaciones.map((id) => ({ invariante: i.id, id })),
              ),
            },
          },
    gate: { valor: { conGuardianCaido: e.gateConGuardianCaido } },
    retiros: nd.leerRetiros(arbol[ARCHIVO_RETIROS] ?? null),
    evasiones: nd.leerEvasiones(arbol[ARCHIVO_EVASIONES] ?? null, arbol[ARCHIVO_EXTERNOS] ?? null),
    plazo: nd.leerConstante(arbol[ARCHIVO_EXCEPCIONES] ?? null, "PLAZO_MAXIMO_DIAS"),
    aviso: nd.leerConstante(arbol[ARCHIVO_EXCEPCIONES] ?? null, "DIAS_DE_AVISO"),
    ci: nd.leerCi(arbol[ARCHIVO_CI] ?? ""),
    paquete: nd.leerPaquete(arbol[ARCHIVO_PAQUETE] ?? null),
    deuda: nd.leerDeuda(
      arbol[ARCHIVO_DEUDA] ?? null,
      arbol[ARCHIVO_CONFIGURACION_DE_DEUDA] ?? null,
    ),
  };
}

function correr(base: Estado, pr: Estado, ahora: Date = HOY) {
  return nd.verificar({
    base: aInstantanea(base),
    pr: aInstantanea(pr),
    ahora,
    leerPr: (ruta) => pr.arbol[ruta] ?? null,
  });
}
const resumen = (hallazgos: Hallazgo[]): [string, string, number][] =>
  hallazgos.map((h) => [h.codigo, h.archivo, h.linea]);

// ---------------------------------------------------------------------------------------------
// Tablas de casos. `esperado` es TODO lo que tiene que fallar: código, archivo y línea, y nada más.
// ---------------------------------------------------------------------------------------------

type Esperado = [codigo: string, archivo: string, linea: number];
interface Caso {
  nombre: string;
  /** Estado de la base (por omisión, el sano). */
  base?: Estado;
  pr: Estado;
  ahora?: Date;
  /** Vacío = es un cambio legítimo (o el estado sano) y no debe fallar. */
  esperado: Esperado[];
  avisos?: Esperado[];
}
const SANO = estadoSano();
const conRetiros = (estado: Estado, retiros: unknown): Estado =>
  conTexto(estado, ARCHIVO_RETIROS, `${JSON.stringify(retiros, null, 2)}\n`);
const sinColor = conEstructura(SANO, (e) => {
  e.registro = e.registro.filter((c) => c.id !== "claves-de-permisos");
});
const sinContratos = conEstructura(SANO, (e) => {
  e.registro = [];
});
const contrato = (e: Estructura, id: string): Contrato => {
  const hallado = e.registro.find((c) => c.id === id);
  if (hallado === undefined) throw new Error(`no hay contrato ${id}`);
  return hallado;
};

const CASOS_A: Caso[] = [
  { nombre: "(a) estado sano: nada retirado, nada borrado", pr: SANO, esperado: [] },
  {
    nombre: "(a) un contrato desaparece del registro sin retiro",
    pr: sinColor,
    esperado: [["retiro-sin-registro", ARCHIVO_REGISTRO, 2]],
  },
  {
    nombre: "(a) el registro queda vacío: los dos contratos sin retiro",
    pr: sinContratos,
    esperado: [
      ["retiro-sin-registro", ARCHIVO_REGISTRO, 2],
      ["retiro-sin-registro", ARCHIVO_REGISTRO, 2],
    ],
  },
  {
    nombre: "(a) LEGÍTIMO: el contrato se retira con una entrada completa en retiros.json",
    pr: conRetiros(sinColor, [retiroCompleto("claves-de-permisos")]),
    esperado: [],
  },
  {
    nombre: "(a) el retiro cubre un contrato pero el otro sigue sin retiro",
    pr: conRetiros(sinContratos, [retiroCompleto("claves-de-permisos")]),
    esperado: [["retiro-sin-registro", ARCHIVO_REGISTRO, 2]],
  },
  {
    nombre: "(a) retiro sin motivo (vacío): inválido, en la línea del campo",
    pr: conRetiros(sinColor, [retiroCompleto("claves-de-permisos", { motivo: "" })]),
    esperado: [["retiro-invalido", ARCHIVO_RETIROS, 4]],
  },
  {
    nombre: "(a) retiro con el campo aprobadoPor ausente: inválido, en la línea del objeto",
    pr: conRetiros(sinColor, [
      Object.fromEntries(
        Object.entries(retiroCompleto("claves-de-permisos")).filter(([c]) => c !== "aprobadoPor"),
      ),
    ]),
    esperado: [["retiro-invalido", ARCHIVO_RETIROS, 2]],
  },
  {
    nombre: "(a) retiro con un campo sobrante (una ampliación escondida no vale)",
    pr: conRetiros(sinColor, [retiroCompleto("claves-de-permisos", { extra: "x" })]),
    esperado: [["retiro-invalido", ARCHIVO_RETIROS, 8]],
  },
  {
    nombre: "(a) retiro con una fecha que no existe en el calendario",
    pr: conRetiros(sinColor, [retiroCompleto("claves-de-permisos", { creada: "2026-13-45" })]),
    esperado: [["retiro-invalido", ARCHIVO_RETIROS, 7]],
  },
  {
    nombre: "(a) retiro con fecha futura respecto del reloj",
    pr: conRetiros(sinColor, [retiroCompleto("claves-de-permisos", { creada: "2026-12-01" })]),
    esperado: [["retiro-invalido", ARCHIVO_RETIROS, 7]],
  },
  {
    nombre: "(a) la misma fecha 'futura' es válida con el reloj corrido (el reloj se inyecta)",
    pr: conRetiros(sinColor, [retiroCompleto("claves-de-permisos", { creada: "2026-12-01" })]),
    ahora: new Date("2026-12-02T00:00:00Z"),
    esperado: [],
  },
  {
    nombre: "(a) dos retiros con el mismo id: el segundo es inválido",
    pr: conRetiros(sinColor, [
      retiroCompleto("claves-de-permisos"),
      retiroCompleto("claves-de-permisos"),
    ]),
    esperado: [["retiro-invalido", ARCHIVO_RETIROS, 10]],
  },
  {
    nombre: "(a) una entrada de retiros que no es un objeto",
    pr: conRetiros(sinColor, ["claves-de-permisos"]),
    // Un texto suelto no cubre al contrato: además de inválido, el contrato sigue sin retiro.
    esperado: [
      ["retiro-invalido", ARCHIVO_RETIROS, 2],
      ["retiro-sin-registro", ARCHIVO_REGISTRO, 2],
    ],
  },
  {
    nombre: "(a) un retiro registrado en la base se borra del PR",
    base: conRetiros(SANO, [retiroCompleto("contrato-viejo")]),
    pr: SANO,
    esperado: [["retiro-borrado", ARCHIVO_RETIROS, 1]],
  },
  {
    nombre: "(a) LEGÍTIMO: los retiros de la base siguen y se suma uno nuevo",
    base: conRetiros(SANO, [retiroCompleto("contrato-viejo")]),
    pr: conRetiros(sinColor, [
      retiroCompleto("contrato-viejo"),
      retiroCompleto("claves-de-permisos"),
    ]),
    esperado: [],
  },
  {
    nombre: "(a) LEGÍTIMO: un retiro de un contrato que sigue existiendo no molesta",
    pr: conRetiros(SANO, [retiroCompleto("color-de-separadores")]),
    esperado: [],
  },
  {
    nombre: "(a) retiros.json deja de ser JSON: el árbol no se puede leer",
    pr: conTexto(SANO, ARCHIVO_RETIROS, "[ {"),
    esperado: [["arbol-ilegible", ARCHIVO_RETIROS, 1]],
  },
  {
    nombre: "(a) retiros.json deja de ser una lista",
    pr: conTexto(SANO, ARCHIVO_RETIROS, "{}"),
    esperado: [["arbol-ilegible", ARCHIVO_RETIROS, 1]],
  },
  {
    nombre: "(a) LEGÍTIMO: sin retiros.json en el PR y sin retiros en la base",
    pr: conTexto(SANO, ARCHIVO_RETIROS, null),
    esperado: [],
  },
];

const CASOS_B: Caso[] = [
  { nombre: "(b) estado sano: mismos detectores, clases y fuente", pr: SANO, esperado: [] },
  {
    nombre: "(b) un contrato pierde uno de sus dos detectores de uso (mismas clases)",
    pr: conEstructura(SANO, (e) => {
      contrato(e, "color-de-separadores").detectores.splice(1, 1);
    }),
    esperado: [["detectores-perdidos", ARCHIVO_REGISTRO, 4]],
  },
  {
    nombre:
      "(b) un contrato pierde su único detector de definición: menos detectores y menos clases",
    pr: conEstructura(SANO, (e) => {
      const c = contrato(e, "color-de-separadores");
      c.detectores = c.detectores.filter((d) => d.tipo !== "definicion");
    }),
    esperado: [
      ["clases-de-detector-perdidas", ARCHIVO_REGISTRO, 4],
      ["detectores-perdidos", ARCHIVO_REGISTRO, 4],
    ],
  },
  {
    nombre: "(b) un detector de uso deja de mirar la clase pruebas",
    pr: conEstructura(SANO, (e) => {
      const d = contrato(e, "claves-de-permisos").detectores[0];
      if (d !== undefined) d.clases = ["backend"];
    }),
    esperado: [["clases-de-detector-perdidas", ARCHIVO_REGISTRO, 7]],
  },
  {
    nombre: "(b) cambia el archivo de la fuente de verdad sin subir la versión",
    pr: conEstructura(SANO, (e) => {
      contrato(e, "claves-de-permisos").fuente = {
        archivo: "src/capacidades/permisos/otras.ts",
        exportacion: "CLAVES",
      };
    }),
    esperado: [["fuente-cambiada-sin-version", ARCHIVO_REGISTRO, 7]],
  },
  {
    nombre: "(b) cambia la exportación de la fuente sin subir la versión",
    pr: conEstructura(SANO, (e) => {
      contrato(e, "claves-de-permisos").fuente = {
        archivo: "src/capacidades/permisos/claves.ts",
        exportacion: "OTRAS",
      };
    }),
    esperado: [["fuente-cambiada-sin-version", ARCHIVO_REGISTRO, 7]],
  },
  {
    nombre: "(b) pasa de variable CSS a exportación sin subir la versión",
    pr: conEstructura(SANO, (e) => {
      contrato(e, "color-de-separadores").fuente = {
        archivo: "apps/web/ui/tokens.css",
        exportacion: "color",
      };
    }),
    esperado: [["fuente-cambiada-sin-version", ARCHIVO_REGISTRO, 4]],
  },
  {
    nombre: "(b) cambia la fuente y BAJA la versión: tampoco cuenta",
    pr: conEstructura(SANO, (e) => {
      const c = contrato(e, "claves-de-permisos");
      c.fuente = { archivo: "src/otro.ts", exportacion: "CLAVES" };
      c.version = "1.1.9";
    }),
    esperado: [["fuente-cambiada-sin-version", ARCHIVO_REGISTRO, 7]],
  },
  {
    nombre: "(b) cambia la fuente y la versión queda mal escrita",
    pr: conEstructura(SANO, (e) => {
      const c = contrato(e, "claves-de-permisos");
      c.fuente = { archivo: "src/otro.ts", exportacion: "CLAVES" };
      c.version = "2";
    }),
    esperado: [["fuente-cambiada-sin-version", ARCHIVO_REGISTRO, 7]],
  },
  {
    nombre: "(b) LEGÍTIMO: la fuente cambia y la versión SUBE en el mismo PR",
    pr: conEstructura(SANO, (e) => {
      const c = contrato(e, "claves-de-permisos");
      c.fuente = { archivo: "src/otro.ts", exportacion: "CLAVES" };
      c.version = "2.0.0";
    }),
    esperado: [],
  },
  {
    nombre: "(b) LEGÍTIMO: se agrega un contrato nuevo al registro",
    pr: conEstructura(SANO, (e) => {
      e.registro.push({
        id: "contrato-nuevo",
        version: "1.0.0",
        fuente: { archivo: "x.ts", exportacion: "X" },
        detectores: [{ tipo: "uso", clases: ["backend"] }],
      });
    }),
    esperado: [],
  },
  {
    nombre: "(b) LEGÍTIMO: se agrega un detector y una clase a un detector",
    pr: conEstructura(SANO, (e) => {
      const c = contrato(e, "claves-de-permisos");
      c.detectores.push({ tipo: "uso", clases: ["frontend"] });
      const primero = c.detectores[0];
      if (primero !== undefined) primero.clases.push("scripts");
    }),
    esperado: [],
  },
  {
    nombre: "(b) LEGÍTIMO: las clases de un detector se reparten entre dos detectores",
    pr: conEstructura(SANO, (e) => {
      contrato(e, "claves-de-permisos").detectores = [
        { tipo: "uso", clases: ["backend"] },
        { tipo: "uso", clases: ["pruebas"] },
        { tipo: "definicion", clases: ["backend"] },
      ];
    }),
    esperado: [],
  },
  {
    nombre: "(b) LEGÍTIMO: solo sube la versión, sin tocar la fuente",
    pr: conEstructura(SANO, (e) => {
      contrato(e, "claves-de-permisos").version = "1.3.0";
    }),
    esperado: [],
  },
  {
    nombre: "(b) un contrato NUEVO declara que no tiene detector de definición",
    pr: conEstructura(SANO, (e) => {
      e.registro.push({
        id: "contrato-nuevo",
        version: "1.0.0",
        fuente: { archivo: "x.ts", exportacion: "X" },
        detectores: [{ tipo: "uso", clases: ["backend"] }],
        sinDefinicion: "El valor no se escribe en ningún archivo: lo calcula un servicio externo.",
      });
    }),
    esperado: [["sin-definicion-nueva", ARCHIVO_REGISTRO, 10]],
  },
  {
    nombre:
      "(b) un contrato que existía pasa a declarar sinDetectorDeDefinicion y pierde su detector de definición",
    pr: conEstructura(SANO, (e) => {
      const c = contrato(e, "color-de-separadores");
      c.detectores = c.detectores.filter((d) => d.tipo !== "definicion");
      c.sinDefinicion = "No se puede reconocer la definición con un patrón de texto simple.";
    }),
    esperado: [
      ["clases-de-detector-perdidas", ARCHIVO_REGISTRO, 4],
      ["detectores-perdidos", ARCHIVO_REGISTRO, 4],
      ["sin-definicion-nueva", ARCHIVO_REGISTRO, 4],
    ],
  },
  {
    nombre:
      "(b) un contrato que existía declara sinDetectorDeDefinicion SIN perder ningún detector",
    pr: conEstructura(SANO, (e) => {
      contrato(e, "claves-de-permisos").sinDefinicion =
        "El valor no se escribe en ningún archivo: lo calcula un servicio externo.";
    }),
    esperado: [["sin-definicion-nueva", ARCHIVO_REGISTRO, 7]],
  },
  {
    nombre: "(b) LEGÍTIMO: la base ya declaraba sinDetectorDeDefinicion y el PR lo conserva",
    base: conEstructura(SANO, (e) => {
      contrato(e, "claves-de-permisos").sinDefinicion =
        "Lo calcula un servicio externo, sin texto.";
    }),
    pr: conEstructura(SANO, (e) => {
      contrato(e, "claves-de-permisos").sinDefinicion =
        "Lo calcula un servicio externo, sin texto.";
    }),
    esperado: [],
  },
  {
    nombre:
      "(b) LEGÍTIMO: el contrato deja de declarar sinDetectorDeDefinicion (ahora tiene detector)",
    base: conEstructura(SANO, (e) => {
      contrato(e, "claves-de-permisos").sinDefinicion =
        "Lo calcula un servicio externo, sin texto.";
    }),
    pr: SANO,
    esperado: [],
  },
];

const CASOS_C: Caso[] = [
  { nombre: "(c) estado sano: todos los códigos siguen", pr: SANO, esperado: [] },
  {
    nombre: "(c) se borra un código de falla (un chequeo)",
    pr: conEstructura(SANO, (e) => {
      e.codigos = ["a-uno", "c-tres"];
    }),
    esperado: [["chequeo-borrado", ARCHIVO_CODIGOS, 4]],
  },
  {
    nombre: "(c) se borran todos los códigos: uno por cada chequeo",
    pr: conEstructura(SANO, (e) => {
      e.codigos = [];
    }),
    esperado: [
      ["chequeo-borrado", ARCHIVO_CODIGOS, 4],
      ["chequeo-borrado", ARCHIVO_CODIGOS, 4],
      ["chequeo-borrado", ARCHIVO_CODIGOS, 4],
    ],
  },
  {
    nombre: "(c) un código se renombra: el viejo falta",
    pr: conEstructura(SANO, (e) => {
      e.codigos = ["a-uno", "b-dos-nuevo", "c-tres"];
    }),
    esperado: [["chequeo-borrado", ARCHIVO_CODIGOS, 4]],
  },
  {
    nombre: "(c) LEGÍTIMO: se agrega un chequeo nuevo",
    pr: conEstructura(SANO, (e) => {
      e.codigos = [...e.codigos, "d-cuatro"];
    }),
    esperado: [],
  },
];

const CASOS_D: Caso[] = [
  { nombre: "(d) estado sano: 60 días de tope y 14 de aviso", pr: SANO, esperado: [] },
  {
    nombre: "(d) el tope de las excepciones SUBE de 60 a 61",
    pr: conTexto(SANO, ARCHIVO_EXCEPCIONES, textoDeExcepciones("61", "14")),
    esperado: [["tope-de-excepciones-subio", ARCHIVO_EXCEPCIONES, 4]],
  },
  {
    nombre: "(d) el tope sube a 365",
    pr: conTexto(SANO, ARCHIVO_EXCEPCIONES, textoDeExcepciones("365", "14")),
    esperado: [["tope-de-excepciones-subio", ARCHIVO_EXCEPCIONES, 4]],
  },
  {
    nombre: "(d) el aviso previo BAJA de 14 a 13 días",
    pr: conTexto(SANO, ARCHIVO_EXCEPCIONES, textoDeExcepciones("60", "13")),
    esperado: [["aviso-de-excepciones-bajo", ARCHIVO_EXCEPCIONES, 6]],
  },
  {
    nombre: "(d) las dos empeoran a la vez",
    pr: conTexto(SANO, ARCHIVO_EXCEPCIONES, textoDeExcepciones("90", "1")),
    esperado: [
      ["tope-de-excepciones-subio", ARCHIVO_EXCEPCIONES, 4],
      ["aviso-de-excepciones-bajo", ARCHIVO_EXCEPCIONES, 6],
    ],
  },
  {
    nombre: "(d) LEGÍTIMO: el tope BAJA (más rigor)",
    pr: conTexto(SANO, ARCHIVO_EXCEPCIONES, textoDeExcepciones("45", "14")),
    esperado: [],
  },
  {
    nombre: "(d) LEGÍTIMO: el aviso SUBE (se avisa antes)",
    pr: conTexto(SANO, ARCHIVO_EXCEPCIONES, textoDeExcepciones("60", "21")),
    esperado: [],
  },
  {
    nombre: "(d) la constante pasa a una cuenta que no se puede leer (30 + 40): ilegible",
    pr: conTexto(SANO, ARCHIVO_EXCEPCIONES, textoDeExcepciones("30 + 40", "14")),
    esperado: [["arbol-ilegible", ARCHIVO_EXCEPCIONES, 4]],
  },
  {
    nombre: "(d) la constante se borra del archivo: ilegible, en la línea 1",
    pr: conTexto(SANO, ARCHIVO_EXCEPCIONES, lineas("/** Excepciones. */", "module.exports = {};")),
    esperado: [
      ["arbol-ilegible", ARCHIVO_EXCEPCIONES, 1],
      ["arbol-ilegible", ARCHIVO_EXCEPCIONES, 1],
    ],
  },
];

const CASOS_E: Caso[] = [
  { nombre: "(e) estado sano: las clases no cambian", pr: SANO, esperado: [] },
  {
    nombre: "(e) una clase esperada deja de esperarse",
    pr: conEstructura(SANO, (e) => {
      e.clases.esperadas = ["frontend", "backend"];
    }),
    esperado: [["clases-esperadas-reducidas", ARCHIVO_CLASIFICACION, 6]],
  },
  {
    nombre: "(e) la lista de clases esperadas queda vacía",
    pr: conEstructura(SANO, (e) => {
      e.clases.esperadas = [];
    }),
    esperado: [["clases-esperadas-reducidas", ARCHIVO_CLASIFICACION, 6]],
  },
  {
    nombre: "(e) se puede excluir una clase más (backend)",
    pr: conEstructura(SANO, (e) => {
      e.clases.excluibles = ["generado", "docs", "backend"];
    }),
    esperado: [["clases-excluibles-ampliadas", ARCHIVO_CLASIFICACION, 4]],
  },
  {
    nombre: "(e) las dos cosas a la vez",
    pr: conEstructura(SANO, (e) => {
      e.clases.esperadas = ["frontend"];
      e.clases.excluibles = ["generado", "docs", "config"];
    }),
    esperado: [
      ["clases-excluibles-ampliadas", ARCHIVO_CLASIFICACION, 4],
      ["clases-esperadas-reducidas", ARCHIVO_CLASIFICACION, 6],
    ],
  },
  {
    nombre: "(e) LEGÍTIMO: se espera una clase más",
    pr: conEstructura(SANO, (e) => {
      e.clases.esperadas = [...e.clases.esperadas, "scripts"];
    }),
    esperado: [],
  },
  {
    nombre: "(e) LEGÍTIMO: se puede excluir menos (docs deja de ser excluible)",
    pr: conEstructura(SANO, (e) => {
      e.clases.excluibles = ["generado"];
    }),
    esperado: [],
  },
  {
    nombre: "(e) la clase docs admite una extensión más (.ts): se podría esconder código ahí",
    pr: conEstructura(SANO, (e) => {
      e.clases.permitidas = {
        ...e.clases.permitidas,
        docs: ["extension:.md", "extension:.txt", "extension:.ts"],
      };
    }),
    esperado: [["extensiones-permitidas-ampliadas", ARCHIVO_CLASIFICACION, 8]],
  },
  {
    nombre: "(e) la clase generado admite una ruta más",
    pr: conEstructura(SANO, (e) => {
      e.clases.permitidas = {
        ...e.clases.permitidas,
        generado: ["ruta:package-lock.json", "ruta:skills-lock.json", "ruta:scripts/cargador.mjs"],
      };
    }),
    esperado: [["extensiones-permitidas-ampliadas", ARCHIVO_CLASIFICACION, 8]],
  },
  {
    nombre: "(e) una clase nueva con tipos permitidos cuenta como ampliación",
    pr: conEstructura(SANO, (e) => {
      e.clases.permitidas = { ...e.clases.permitidas, config: ["extension:.json"] };
    }),
    esperado: [["extensiones-permitidas-ampliadas", ARCHIVO_CLASIFICACION, 8]],
  },
  {
    nombre: "(e) LEGÍTIMO: lo permitido en una clase excluida se reduce",
    pr: conEstructura(SANO, (e) => {
      e.clases.permitidas = { docs: ["extension:.md"], generado: ["ruta:package-lock.json"] };
    }),
    esperado: [],
  },
  {
    nombre: "(e) el PR borra la lista de lo permitido que la base tenía: ya no tiene lo vigilado",
    pr: conEstructura(SANO, (e) => {
      e.clases.permitidas = null;
    }),
    esperado: [["arbol-ilegible", ARCHIVO_CLASIFICACION, 1]],
  },
  {
    nombre:
      "(e) LEGÍTIMO: la base todavía no traía la lista de lo permitido: no hay con qué comparar",
    base: conEstructura(SANO, (e) => {
      e.clases.permitidas = null;
    }),
    pr: SANO,
    esperado: [],
  },
];

const sinLineas = (estado: Estado, desde: number, hasta: number): Estado =>
  conTexto(
    estado,
    ARCHIVO_CI,
    TEXTO_DE_CI.split("\n")
      .filter((_, i) => i + 1 < desde || i + 1 > hasta)
      .join("\n"),
  );
const CASOS_F: Caso[] = [
  { nombre: "(f) estado sano: job, needs, gate y pasos como en la base", pr: SANO, esperado: [] },
  {
    nombre: "(f) se borra el job guardian (el gate sigue listándolo)",
    pr: sinLineas(SANO, 12, 27),
    esperado: [["ci-sin-job-guardian", ARCHIVO_CI, 4]],
  },
  {
    nombre: "(f) se borra el job guardian Y su mención en needs",
    pr: reemplazando(sinLineas(SANO, 12, 27), ARCHIVO_CI, "[estatico, guardian]", "[estatico]"),
    esperado: [
      ["ci-gate-no-espera-guardian", ARCHIVO_CI, 14],
      ["ci-sin-job-guardian", ARCHIVO_CI, 4],
    ],
  },
  {
    nombre: "(f) el job guardian se renombra",
    pr: reemplazando(SANO, ARCHIVO_CI, "  guardian:\n", "  guardian-v2:\n"),
    esperado: [["ci-sin-job-guardian", ARCHIVO_CI, 4]],
  },
  {
    nombre: "(f) el gate ya no espera al guardián (needs en lista de flujo)",
    pr: reemplazando(SANO, ARCHIVO_CI, "[estatico, guardian]", "[estatico]"),
    esperado: [["ci-gate-no-espera-guardian", ARCHIVO_CI, 30]],
  },
  {
    nombre: "(f) el gate ya no espera al guardián (needs en lista de bloque)",
    pr: reemplazando(
      SANO,
      ARCHIVO_CI,
      "    needs: [estatico, guardian]\n",
      "    needs:\n      - estatico\n",
    ),
    esperado: [["ci-gate-no-espera-guardian", ARCHIVO_CI, 30]],
  },
  {
    nombre: "(f) el gate ya no tiene needs",
    pr: reemplazando(SANO, ARCHIVO_CI, "    needs: [estatico, guardian]\n", ""),
    esperado: [["ci-gate-no-espera-guardian", ARCHIVO_CI, 28]],
  },
  {
    nombre: "(f) se borra el job gate",
    pr: sinLineas(SANO, 28, 34),
    esperado: [["ci-gate-no-espera-guardian", ARCHIVO_CI, 4]],
  },
  {
    nombre: "(f) LEGÍTIMO: el gate espera a un job más y reordena la lista",
    pr: reemplazando(SANO, ARCHIVO_CI, "[estatico, guardian]", "[guardian, estatico]"),
    esperado: [],
  },
  {
    nombre: "(f) evaluar-gate deja pasar un guardián caído (ya no es obligatorio)",
    pr: conEstructura(SANO, (e) => {
      e.gateConGuardianCaido = { failure: [], skipped: [], cancelled: [] };
    }),
    esperado: [["gate-no-exige-guardian", ARCHIVO_GATE, 3]],
  },
  {
    nombre: "(f) evaluar-gate solo deja pasar un guardián saltado",
    pr: conEstructura(SANO, (e) => {
      e.gateConGuardianCaido = { ...e.gateConGuardianCaido, skipped: ["pruebas: failure"] };
    }),
    esperado: [["gate-no-exige-guardian", ARCHIVO_GATE, 3]],
  },
  {
    nombre: "(f) continue-on-error en el job guardian",
    pr: reemplazando(
      SANO,
      ARCHIVO_CI,
      "    timeout-minutes: 10\n",
      "    timeout-minutes: 10\n    continue-on-error: true\n",
    ),
    esperado: [["ci-guardian-con-salto", ARCHIVO_CI, 16]],
  },
  {
    nombre: "(f) continue-on-error en el paso que corre el guardián",
    pr: reemplazando(
      SANO,
      ARCHIVO_CI,
      "      - run: node arquitectura/contratos/guardian.cjs\n",
      "      - run: node arquitectura/contratos/guardian.cjs\n        continue-on-error: true\n",
    ),
    esperado: [["ci-guardian-con-salto", ARCHIVO_CI, 19]],
  },
  {
    nombre: "(f) continue-on-error atado a una expresión",
    pr: reemplazando(
      SANO,
      ARCHIVO_CI,
      "    timeout-minutes: 10\n",
      "    timeout-minutes: 10\n    continue-on-error: ${{ github.event_name == 'push' }}\n",
    ),
    esperado: [["ci-guardian-con-salto", ARCHIVO_CI, 16]],
  },
  {
    nombre: "(f) if: false en el job guardian",
    pr: reemplazando(
      SANO,
      ARCHIVO_CI,
      "    timeout-minutes: 10\n",
      "    timeout-minutes: 10\n    if: false\n",
    ),
    esperado: [["ci-guardian-con-salto", ARCHIVO_CI, 16]],
  },
  {
    nombre: "(f) un if que la base no tenía en el paso que corre el guardián",
    pr: reemplazando(
      SANO,
      ARCHIVO_CI,
      "      - run: node arquitectura/contratos/guardian.cjs\n",
      "      - if: github.event_name == 'push'\n        run: node arquitectura/contratos/guardian.cjs\n",
    ),
    esperado: [["ci-guardian-con-salto", ARCHIVO_CI, 18]],
  },
  {
    nombre: "(f) el paso que corre el guardián se reemplaza por `|| true`",
    pr: reemplazando(
      SANO,
      ARCHIVO_CI,
      "      - run: node arquitectura/contratos/guardian.cjs\n",
      "      - run: node arquitectura/contratos/guardian.cjs || true\n",
    ),
    esperado: [["ci-guardian-sin-ejecutar", ARCHIVO_CI, 12]],
  },
  {
    nombre: "(f) el paso que corre el guardián se reemplaza por un echo",
    pr: reemplazando(
      SANO,
      ARCHIVO_CI,
      "      - run: node arquitectura/contratos/guardian.cjs\n",
      "      - run: echo guardian\n",
    ),
    esperado: [["ci-guardian-sin-ejecutar", ARCHIVO_CI, 12]],
  },
  {
    nombre: "(f) el comando solo queda en un comentario",
    pr: reemplazando(
      SANO,
      ARCHIVO_CI,
      "      - run: node arquitectura/contratos/guardian.cjs\n",
      "      # node arquitectura/contratos/guardian.cjs\n      - run: echo nada\n",
    ),
    esperado: [["ci-guardian-sin-ejecutar", ARCHIVO_CI, 12]],
  },
  {
    nombre: "(f) LEGÍTIMO: el guardián corre con una opción más y hay un paso nuevo sin if",
    pr: reemplazando(
      SANO,
      ARCHIVO_CI,
      "      - run: node arquitectura/contratos/guardian.cjs\n",
      "      - run: node arquitectura/contratos/guardian.cjs --sin-informe\n      - run: echo listo\n",
    ),
    esperado: [],
  },
  {
    nombre:
      "(f) LEGÍTIMO: un paso nuevo con if y continue-on-error que no corre el guardián (subir el informe)",
    pr: reemplazando(
      SANO,
      ARCHIVO_CI,
      "      - name: Vigilancia\n",
      "      - name: Subir informe\n        if: always()\n        continue-on-error: true\n        run: echo informe\n      - name: Vigilancia\n",
    ),
    esperado: [],
  },
  {
    nombre: "(f) LEGÍTIMO: un job nuevo en ci.yml que no es el guardián",
    pr: conTexto(
      SANO,
      ARCHIVO_CI,
      TEXTO_DE_CI.replace(
        "\n  gate:\n",
        "\n  otro:\n    runs-on: ubuntu-latest\n    if: github.event_name == 'push'\n\n  gate:\n",
      ),
    ),
    esperado: [],
  },
  {
    nombre: "(f) ci.yml deja de entenderse (sin sección jobs)",
    pr: conTexto(SANO, ARCHIVO_CI, "name: CI\non: push\n"),
    esperado: [["arbol-ilegible", ARCHIVO_CI, 1]],
  },
  {
    nombre: "(f) ci.yml con dos jobs del mismo nombre",
    pr: reemplazando(SANO, ARCHIVO_CI, "\n  gate:\n", "\n  estatico:\n    runs-on: x\n\n  gate:\n"),
    esperado: [["arbol-ilegible", ARCHIVO_CI, 1]],
  },
  {
    nombre: "(f) ci.yml desaparece del PR",
    pr: conTexto(SANO, ARCHIVO_CI, null),
    esperado: [["arbol-ilegible", ARCHIVO_CI, 1]],
  },
];

const CASOS_G: Caso[] = [
  {
    nombre: "(g) estado sano: arquitectura encadena guardian y guardian lo ejecuta",
    pr: SANO,
    esperado: [],
  },
  {
    nombre: "(g) el script arquitectura ya no encadena `&& npm run guardian`",
    pr: reemplazando(SANO, ARCHIVO_PAQUETE, "depcruise src && npm run guardian", "depcruise src"),
    esperado: [["script-arquitectura-desviado", ARCHIVO_PAQUETE, 4]],
  },
  {
    nombre: "(g) el script arquitectura lo encadena con `||` (solo correría si falla lo anterior)",
    pr: reemplazando(
      SANO,
      ARCHIVO_PAQUETE,
      "depcruise src && npm run guardian",
      "depcruise src || npm run guardian",
    ),
    esperado: [["script-arquitectura-desviado", ARCHIVO_PAQUETE, 4]],
  },
  {
    nombre: "(g) el script arquitectura sale de package.json",
    pr: reemplazando(
      SANO,
      ARCHIVO_PAQUETE,
      '    "arquitectura": "depcruise src && npm run guardian",\n',
      "",
    ),
    esperado: [["script-arquitectura-desviado", ARCHIVO_PAQUETE, 3]],
  },
  {
    nombre: "(g) el script guardian ya no apunta al guardián",
    pr: reemplazando(SANO, ARCHIVO_PAQUETE, "node arquitectura/contratos/guardian.cjs", "echo ok"),
    esperado: [["script-guardian-desviado", ARCHIVO_PAQUETE, 5]],
  },
  {
    nombre: "(g) el script guardian traga el error con `|| true`",
    pr: reemplazando(SANO, ARCHIVO_PAQUETE, 'guardian.cjs"', 'guardian.cjs || true"'),
    esperado: [["script-guardian-desviado", ARCHIVO_PAQUETE, 5]],
  },
  {
    nombre: "(g) el script guardian apunta a otro archivo",
    pr: reemplazando(
      SANO,
      ARCHIVO_PAQUETE,
      "arquitectura/contratos/guardian.cjs",
      "arquitectura/contratos/ligero.cjs",
    ),
    esperado: [["script-guardian-desviado", ARCHIVO_PAQUETE, 5]],
  },
  {
    nombre: "(g) los dos scripts desaparecen",
    pr: conTexto(SANO, ARCHIVO_PAQUETE, lineas("{", '  "name": "x",', '  "scripts": {}', "}")),
    esperado: [
      ["script-arquitectura-desviado", ARCHIVO_PAQUETE, 3],
      ["script-guardian-desviado", ARCHIVO_PAQUETE, 3],
    ],
  },
  {
    nombre: "(g) package.json deja de ser JSON",
    pr: conTexto(SANO, ARCHIVO_PAQUETE, "{ roto"),
    esperado: [["arbol-ilegible", ARCHIVO_PAQUETE, 1]],
  },
  {
    nombre: "(g) LEGÍTIMO: arquitectura suma pasos y guardian recibe opciones",
    pr: reemplazando(
      reemplazando(
        SANO,
        ARCHIVO_PAQUETE,
        "depcruise src && npm run guardian",
        "depcruise src && npm run otro && npm run guardian",
      ),
      ARCHIVO_PAQUETE,
      'guardian.cjs"',
      'guardian.cjs --sin-informe"',
    ),
    esperado: [],
  },
];

const conMatriz = (estado: Estado, matriz: { id: string; mutaciones: string[] }[] | null): Estado =>
  conEstructura(estado, (e) => {
    e.invariantes = matriz;
  });
const CASOS_H: Caso[] = [
  { nombre: "(h) estado sano: la matriz de la base sigue completa", pr: SANO, esperado: [] },
  {
    nombre: "(h) se borra un invariante entero (con sus mutaciones)",
    pr: conMatriz(SANO, [{ id: "I1", mutaciones: ["eliminacion", "alteracion"] }]),
    esperado: [["invariante-borrada", ARCHIVO_INVARIANTES, 2]],
  },
  {
    nombre: "(h) se borra una mutación de un invariante que sigue",
    pr: conMatriz(SANO, [
      { id: "I1", mutaciones: ["eliminacion"] },
      { id: "I2", mutaciones: ["eliminacion"] },
    ]),
    esperado: [["mutacion-borrada", ARCHIVO_INVARIANTES, 4]],
  },
  {
    nombre: "(h) un invariante queda sin ninguna mutación",
    pr: conMatriz(SANO, [
      { id: "I1", mutaciones: ["eliminacion", "alteracion"] },
      { id: "I2", mutaciones: [] },
    ]),
    esperado: [["mutacion-borrada", ARCHIVO_INVARIANTES, 7]],
  },
  {
    nombre: "(h) la matriz entera desaparece del PR",
    pr: conMatriz(SANO, null),
    esperado: [["invariante-borrada", ARCHIVO_INVARIANTES, 1]],
  },
  {
    nombre: "(h) LEGÍTIMO: se agrega un invariante y una mutación",
    pr: conMatriz(SANO, [
      { id: "I1", mutaciones: ["eliminacion", "alteracion", "duplicacion"] },
      { id: "I2", mutaciones: ["eliminacion"] },
      { id: "I3", mutaciones: ["exclusion"] },
    ]),
    esperado: [],
  },
  {
    nombre: "(h) la base NO trae la matriz: el chequeo se saltea con un aviso explícito",
    base: conMatriz(SANO, null),
    pr: conMatriz(SANO, [{ id: "I1", mutaciones: [] }]),
    esperado: [],
    avisos: [["invariantes-sin-base", ARCHIVO_INVARIANTES, 1]],
  },
  {
    nombre: "(h) la base no trae la matriz y el PR tampoco: aviso y nada más",
    base: conMatriz(SANO, null),
    pr: conMatriz(SANO, null),
    esperado: [],
    avisos: [["invariantes-sin-base", ARCHIVO_INVARIANTES, 1]],
  },
];

// Los casos con una sección entera rota se arman sobre la instantánea (no hay texto que las rompa).
const SECCIONES_ROTAS: {
  nombre: string;
  quien: "pr" | "base";
  seccion: string;
  valor: Seccion;
  esperado: Esperado;
}[] = [
  {
    nombre: "el registro del PR lanza al cargarse",
    quien: "pr",
    seccion: "registro",
    valor: { error: "boom" },
    esperado: ["arbol-ilegible", ARCHIVO_REGISTRO, 1],
  },
  {
    nombre: "los códigos del PR no se pueden cargar",
    quien: "pr",
    seccion: "codigos",
    valor: { error: "no es una lista" },
    esperado: ["arbol-ilegible", ARCHIVO_CODIGOS, 1],
  },
  {
    nombre: "la clasificación del PR ya no existe",
    quien: "pr",
    seccion: "clases",
    valor: { ausente: true },
    esperado: ["arbol-ilegible", ARCHIVO_CLASIFICACION, 1],
  },
  {
    nombre: "evaluar-gate del PR lanza al cargarse",
    quien: "pr",
    seccion: "gate",
    valor: { error: "boom" },
    esperado: ["arbol-ilegible", ARCHIVO_GATE, 1],
  },
  {
    nombre: "la matriz del PR lanza al cargarse (no es lo mismo que no existir)",
    quien: "pr",
    seccion: "invariantes",
    valor: { error: "boom" },
    esperado: ["arbol-ilegible", ARCHIVO_INVARIANTES, 1],
  },
  {
    nombre: "los códigos de la base no se pueden cargar: no hay con qué comparar",
    quien: "base",
    seccion: "codigos",
    valor: { error: "boom" },
    esperado: ["base-ilegible", ARCHIVO_CODIGOS, 1],
  },
  {
    nombre: "el registro de la base no se puede cargar",
    quien: "base",
    seccion: "registro",
    valor: { error: "boom" },
    esperado: ["base-ilegible", ARCHIVO_REGISTRO, 1],
  },
  {
    nombre: "la matriz de la base lanza al cargarse",
    quien: "base",
    seccion: "invariantes",
    valor: { error: "boom" },
    esperado: ["base-ilegible", ARCHIVO_INVARIANTES, 1],
  },
];

// (i) La batería de evasión: el catálogo (`evasiones.json`) y los casos externos (`evasiones-github.json`).
/** El estado con el catálogo y los casos externos dados (`null` borra el archivo). */
const conEvasiones = (
  estado: Estado,
  casos: CasoDeEvasion[] | null,
  externos: CasoDeEvasion[] | null = EXTERNOS_SANO,
): Estado =>
  conTexto(
    conTexto(estado, ARCHIVO_EVASIONES, casos === null ? null : textoDeEvasiones(casos)),
    ARCHIVO_EXTERNOS,
    externos === null ? null : textoDeEvasiones(externos),
  );
/** La línea (desde 1) de la clave `clave` del caso `id` en el texto del catálogo de ese estado. */
function lineaDeEvasion(archivo: string, estado: Estado, id: string, clave: string): number {
  const lineas = (estado.arbol[archivo] ?? "").split("\n");
  const inicio = lineas.findIndex((linea) => linea === `    "id": "${id}",`);
  const relativa = lineas.slice(inicio).findIndex((linea) => linea.startsWith(`    "${clave}":`));
  expect(inicio, `el caso ${id} está en ${archivo}`).toBeGreaterThan(0);
  expect(relativa, `${id} tiene «${clave}»`).toBeGreaterThanOrEqual(0);
  return inicio + relativa + 1;
}
/** El catálogo sano, cambiando algunos casos (por id) o agregando otros. */
const catalogo = (
  cambios: Record<string, Partial<CasoDeEvasion>> = {},
  quitar: string[] = [],
  agregar: CasoDeEvasion[] = [],
): CasoDeEvasion[] => [
  ...CATALOGO_SANO.filter((c) => !quitar.includes(c.id)).map((c) => ({
    ...c,
    ...cambios[c.id],
  })),
  ...agregar,
];
const sinCaso = (id: string): CasoDeEvasion[] => catalogo({}, [id]);
const sinCasos = (...ids: string[]): CasoDeEvasion[] => catalogo({}, ids);
const prConCatalogo = (casos: CasoDeEvasion[], externos?: CasoDeEvasion[] | null): Estado =>
  conEvasiones(SANO, casos, externos);
const evasion = (id: string, clave: string, estado: Estado, archivo = ARCHIVO_EVASIONES): number =>
  lineaDeEvasion(archivo, estado, id, clave);
const NUEVO_EXIGIDO: CasoDeEvasion = {
  id: "EV-050",
  via: "filtros",
  esperado: EXIGE,
  estado: "exigido",
};
const NUEVO_RIESGO: CasoDeEvasion = {
  id: "EV-051",
  via: "filtros",
  esperado: EXIGE,
  estado: "riesgo-aceptado",
  revisar: "2027-04-19",
};
const NUEVA_BRECHA: CasoDeEvasion = {
  id: "EV-052",
  via: "filtros",
  esperado: EXIGE,
  estado: "brecha-abierta",
  vence: "2026-12-20",
};
const conRetirosDeCasos = (estado: Estado, ...ids: string[]): Estado =>
  conRetiros(
    estado,
    ids.map((id) => retiroCompleto(id)),
  );

const PR_SIN_EV001 = prConCatalogo(sinCaso("EV-001"));
const PR_EXIGIDO_A_BRECHA = prConCatalogo(
  catalogo({ "EV-001": { estado: "brecha-abierta", vence: "2026-12-20" } }),
);
const PR_EXIGIDO_A_RIESGO = prConCatalogo(
  catalogo({ "EV-001": { estado: "riesgo-aceptado", revisar: "2027-04-19" } }),
);
const PR_BRECHA_A_RIESGO = prConCatalogo(
  catalogo({ "EV-002": { estado: "riesgo-aceptado", revisar: "2027-04-19" } }),
);
const PR_BRECHA_MAS_TARDE = prConCatalogo(catalogo({ "EV-002": { vence: "2026-12-21" } }));
const PR_RIESGO_MAS_TARDE = prConCatalogo(catalogo({ "EV-003": { revisar: "2027-04-20" } }));
const PR_ESPERADO_CAMBIADO = prConCatalogo(
  catalogo({ "EV-001": { esperado: { ...ESPERA_RUTA, codigo: "otro-codigo" } } }),
);
const PR_EV001_EN_LOS_EXTERNOS = prConCatalogo(sinCaso("EV-001"), [
  ...EXTERNOS_SANO,
  { id: "EV-001", via: "filtros", esperado: ESPERA_RUTA, estado: "externo" },
]);

const CASOS_I: Caso[] = [
  { nombre: "(i) estado sano: el catálogo de la base sigue completo", pr: SANO, esperado: [] },
  {
    nombre: "(i) se borra un caso del catálogo sin registrar su retiro",
    pr: PR_SIN_EV001,
    esperado: [["evasion-borrada", ARCHIVO_EVASIONES, 1]],
  },
  {
    nombre: "(i) se borran dos casos de una misma vía sin retiro: dos faltas y la vía perdida",
    pr: prConCatalogo(sinCasos("EV-001", "EV-004")),
    esperado: [
      ["evasion-borrada", ARCHIVO_EVASIONES, 1],
      ["evasion-borrada", ARCHIVO_EVASIONES, 1],
      ["evasion-via-perdida", ARCHIVO_EVASIONES, 1],
    ],
  },
  {
    nombre: "(i) LEGÍTIMO: el caso se retira con una entrada en retiros.json con su id",
    pr: conRetirosDeCasos(PR_SIN_EV001, "EV-001"),
    esperado: [],
  },
  {
    nombre: "(i) un retiro de otro id no cubre el caso borrado",
    pr: conRetirosDeCasos(PR_SIN_EV001, "EV-999"),
    esperado: [["evasion-borrada", ARCHIVO_EVASIONES, 1]],
  },
  {
    nombre: "(i) se retiran con registro los dos casos de una vía: la vía deja de probarse",
    pr: conRetirosDeCasos(prConCatalogo(sinCasos("EV-001", "EV-004")), "EV-001", "EV-004"),
    esperado: [["evasion-via-perdida", ARCHIVO_EVASIONES, 1]],
  },
  {
    nombre: "(i) se borra el único caso de una vía sin retiro: la falta y la vía perdida",
    pr: prConCatalogo(sinCaso("EV-002")),
    esperado: [
      ["evasion-borrada", ARCHIVO_EVASIONES, 1],
      ["evasion-via-perdida", ARCHIVO_EVASIONES, 1],
    ],
  },
  {
    nombre: "(i) el catálogo entero desaparece del PR: cada caso sin retiro y las vías perdidas",
    pr: conEvasiones(SANO, null),
    esperado: [
      ["evasion-borrada", ARCHIVO_EVASIONES, 1],
      ["evasion-borrada", ARCHIVO_EVASIONES, 1],
      ["evasion-borrada", ARCHIVO_EVASIONES, 1],
      ["evasion-borrada", ARCHIVO_EVASIONES, 1],
      // Sin el catálogo no queda ningún caso, tampoco los externos que siguen en su archivo.
      ["evasion-borrada", ARCHIVO_EXTERNOS, 1],
      ["evasion-via-perdida", ARCHIVO_EVASIONES, 1],
      ["evasion-via-perdida", ARCHIVO_EVASIONES, 1],
      ["evasion-via-perdida", ARCHIVO_EVASIONES, 1],
      ["evasion-via-perdida", ARCHIVO_EVASIONES, 1],
    ],
  },
  {
    nombre: "(i) se borran los casos externos del PR: faltan sin retiro (y se pierde su vía)",
    pr: conEvasiones(SANO, CATALOGO_SANO, null),
    esperado: [
      ["evasion-borrada", ARCHIVO_EXTERNOS, 1],
      ["evasion-via-perdida", ARCHIVO_EVASIONES, 1],
    ],
  },
  {
    nombre: "(i) un caso cambia lo que espera (otro código de falla)",
    pr: PR_ESPERADO_CAMBIADO,
    esperado: [
      [
        "evasion-esperado-cambiado",
        ARCHIVO_EVASIONES,
        evasion("EV-001", "esperado", PR_ESPERADO_CAMBIADO),
      ],
    ],
  },
  {
    nombre: "(i) un caso agrega una línea a lo que espera",
    pr: prConCatalogo(catalogo({ "EV-001": { esperado: { ...ESPERA_RUTA, linea: 1 } } })),
    esperado: [
      [
        "evasion-esperado-cambiado",
        ARCHIVO_EVASIONES,
        evasion(
          "EV-001",
          "esperado",
          prConCatalogo(catalogo({ "EV-001": { esperado: { ...ESPERA_RUTA, linea: 1 } } })),
        ),
      ],
    ],
  },
  {
    nombre: "(i) un caso de tipo bloquea pasa a exige-excepcion",
    pr: prConCatalogo(catalogo({ "EV-001": { esperado: EXIGE } })),
    esperado: [
      [
        "evasion-esperado-cambiado",
        ARCHIVO_EVASIONES,
        evasion("EV-001", "esperado", prConCatalogo(catalogo({ "EV-001": { esperado: EXIGE } }))),
      ],
    ],
  },
  {
    nombre: "(i) LEGÍTIMO: las claves de lo esperado cambian de orden y dicen lo mismo",
    pr: prConCatalogo(
      catalogo({
        "EV-001": { esperado: { archivo: "x.ts", codigo: "ruta-sin-clase", tipo: "bloquea" } },
      }),
    ),
    esperado: [],
  },
  {
    nombre: "(i) un caso exigido pasa a brecha abierta",
    pr: PR_EXIGIDO_A_BRECHA,
    esperado: [
      ["evasion-degradada", ARCHIVO_EVASIONES, evasion("EV-001", "estado", PR_EXIGIDO_A_BRECHA)],
    ],
  },
  {
    nombre: "(i) un caso exigido pasa a riesgo aceptado",
    pr: PR_EXIGIDO_A_RIESGO,
    esperado: [
      ["evasion-degradada", ARCHIVO_EVASIONES, evasion("EV-001", "estado", PR_EXIGIDO_A_RIESGO)],
    ],
  },
  {
    nombre: "(i) una brecha abierta pasa a riesgo aceptado (plazo de 180 en vez de 60)",
    pr: PR_BRECHA_A_RIESGO,
    esperado: [
      ["evasion-degradada", ARCHIVO_EVASIONES, evasion("EV-002", "estado", PR_BRECHA_A_RIESGO)],
    ],
  },
  {
    nombre: "(i) un caso exigido desconocido (estado raro) cuenta como degradado",
    pr: prConCatalogo(catalogo({ "EV-001": { estado: "tal vez" } })),
    esperado: [
      [
        "evasion-degradada",
        ARCHIVO_EVASIONES,
        evasion("EV-001", "estado", prConCatalogo(catalogo({ "EV-001": { estado: "tal vez" } }))),
      ],
    ],
  },
  {
    nombre: "(i) el vencimiento de una brecha se mueve un día más tarde",
    pr: PR_BRECHA_MAS_TARDE,
    esperado: [
      ["evasion-degradada", ARCHIVO_EVASIONES, evasion("EV-002", "vence", PR_BRECHA_MAS_TARDE)],
    ],
  },
  {
    nombre: "(i) la revisión de un riesgo aceptado se mueve un día más tarde",
    pr: PR_RIESGO_MAS_TARDE,
    esperado: [
      ["evasion-degradada", ARCHIVO_EVASIONES, evasion("EV-003", "revisar", PR_RIESGO_MAS_TARDE)],
    ],
  },
  {
    nombre: "(i) LEGÍTIMO: el vencimiento de una brecha se adelanta",
    pr: prConCatalogo(catalogo({ "EV-002": { vence: "2026-12-19" } })),
    esperado: [],
  },
  {
    nombre: "(i) LEGÍTIMO: la revisión de un riesgo aceptado se adelanta",
    pr: prConCatalogo(catalogo({ "EV-003": { revisar: "2027-01-01" } })),
    esperado: [],
  },
  {
    nombre: "(i) LEGÍTIMO: un riesgo aceptado pasa a brecha abierta (más estricto)",
    pr: prConCatalogo(catalogo({ "EV-003": { estado: "brecha-abierta", vence: "2026-12-20" } })),
    esperado: [],
  },
  {
    nombre: "(i) LEGÍTIMO: una brecha abierta se cierra y pasa a exigido",
    pr: prConCatalogo(catalogo({ "EV-002": { estado: "exigido" } })),
    esperado: [],
  },
  {
    nombre: "(i) un caso exigido se muda a los casos externos: deja de correr",
    pr: PR_EV001_EN_LOS_EXTERNOS,
    esperado: [
      [
        "evasion-degradada",
        ARCHIVO_EXTERNOS,
        evasion("EV-001", "estado", PR_EV001_EN_LOS_EXTERNOS, ARCHIVO_EXTERNOS),
      ],
    ],
  },
  {
    nombre: "(i) LEGÍTIMO: se agrega un caso exigido (sin aviso)",
    pr: prConCatalogo(catalogo({}, [], [NUEVO_EXIGIDO])),
    esperado: [],
  },
  {
    nombre: "(i) un riesgo aceptado NUEVO no falla, pero se avisa en la línea de su estado",
    pr: prConCatalogo(catalogo({}, [], [NUEVO_RIESGO])),
    esperado: [],
    avisos: [
      [
        "evasion-riesgo-nuevo",
        ARCHIVO_EVASIONES,
        evasion("EV-051", "estado", prConCatalogo(catalogo({}, [], [NUEVO_RIESGO]))),
      ],
    ],
  },
  {
    nombre: "(i) una brecha abierta NUEVA no falla, pero se avisa en la línea de su estado",
    pr: prConCatalogo(catalogo({}, [], [NUEVA_BRECHA])),
    esperado: [],
    avisos: [
      [
        "evasion-riesgo-nuevo",
        ARCHIVO_EVASIONES,
        evasion("EV-052", "estado", prConCatalogo(catalogo({}, [], [NUEVA_BRECHA]))),
      ],
    ],
  },
  {
    nombre: "(i) un caso externo NUEVO no avisa (no acepta ningún riesgo del repositorio)",
    pr: prConCatalogo(CATALOGO_SANO, [
      ...EXTERNOS_SANO,
      { id: "EV-048", via: "ruta-alternativa", esperado: EXIGE, estado: "externo" },
    ]),
    esperado: [],
  },
  {
    nombre: "(i) un riesgo aceptado que la base ya tenía no se avisa de nuevo",
    base: prConCatalogo(catalogo({}, [], [NUEVO_RIESGO])),
    pr: prConCatalogo(catalogo({}, [], [NUEVO_RIESGO])),
    esperado: [],
  },
  {
    nombre: "(i) entradas que no son un caso (basura en la lista) no rompen la comparación",
    pr: conTexto(
      SANO,
      ARCHIVO_EVASIONES,
      `${JSON.stringify([...CATALOGO_SANO, 5, null, { sin: "id" }], null, 2)}\n`,
    ),
    esperado: [],
  },
  {
    nombre: "(i) un caso de la base sin id no se puede seguir: se ignora",
    base: conTexto(
      SANO,
      ARCHIVO_EVASIONES,
      `${JSON.stringify([...CATALOGO_SANO, { via: "filtros" }], null, 2)}\n`,
    ),
    pr: SANO,
    esperado: [],
  },
  {
    nombre: "(i) el catálogo del PR no es JSON válido: no se puede mirar",
    pr: conTexto(SANO, ARCHIVO_EVASIONES, "{ roto\n"),
    esperado: [["arbol-ilegible", ARCHIVO_EVASIONES, 1]],
  },
  {
    nombre: "(i) el catálogo del PR no es una lista",
    pr: conTexto(SANO, ARCHIVO_EVASIONES, '{ "casos": [] }\n'),
    esperado: [["arbol-ilegible", ARCHIVO_EVASIONES, 1]],
  },
  {
    nombre: "(i) los casos externos del PR no son JSON válido: tampoco se puede mirar",
    pr: conTexto(SANO, ARCHIVO_EXTERNOS, "[ roto\n"),
    esperado: [["arbol-ilegible", ARCHIVO_EVASIONES, 1]],
  },
  {
    nombre: "(i) los casos externos del PR no son una lista",
    pr: conTexto(SANO, ARCHIVO_EXTERNOS, '{ "casos": [] }\n'),
    esperado: [["arbol-ilegible", ARCHIVO_EVASIONES, 1]],
  },
  {
    nombre: "(i) el catálogo de la base no se puede leer: no hay con qué comparar",
    base: conTexto(SANO, ARCHIVO_EVASIONES, "{ roto\n"),
    pr: SANO,
    esperado: [["base-ilegible", ARCHIVO_EVASIONES, 1]],
  },
  {
    nombre: "(i) la base NO trae el catálogo: el chequeo se saltea con un aviso explícito",
    base: conEvasiones(SANO, null),
    pr: SANO,
    esperado: [],
    avisos: [["evasiones-sin-base", ARCHIVO_EVASIONES, 1]],
  },
  {
    nombre: "(i) ni la base ni el PR traen el catálogo: no falla, y se avisa",
    base: conEvasiones(SANO, null),
    pr: conEvasiones(SANO, null),
    esperado: [],
    avisos: [["evasiones-sin-base", ARCHIVO_EVASIONES, 1]],
  },
  {
    nombre: "(i) la base trae los externos pero no el catálogo: el catálogo no está, se avisa",
    base: conEvasiones(SANO, null, EXTERNOS_SANO),
    pr: conEvasiones(SANO, CATALOGO_SANO, null),
    esperado: [],
    avisos: [["evasiones-sin-base", ARCHIVO_EVASIONES, 1]],
  },
];

// --- (j) la deuda técnica -------------------------------------------------------------------------------------

const PASO_DE_LA_DEUDA = [
  "      - name: Deuda técnica", //                                     27
  "        run: |", //                                                  28
  "          if [ -d base ]; then", //                                  29
  "            node arquitectura/deuda/deuda.cjs --base=base", //       30
  "          else", //                                                 31
  "            node arquitectura/deuda/deuda.cjs", //                   32
  "          fi", //                                                   33
];
/** El ci.yml sano con el paso de la deuda al final del job guardian (el gate pasa a la línea 35). */
const TEXTO_DE_CI_CON_DEUDA = lineas(
  ...TEXTO_DE_CI.split("\n").slice(0, 26),
  ...PASO_DE_LA_DEUDA,
  ...TEXTO_DE_CI.split("\n").slice(26, -1),
);
const TEXTO_DE_PAQUETE_CON_DEUDA = lineas(
  "{", //                                                                                  1
  '  "name": "x",', //                                                                     2
  '  "scripts": {', //                                                                     3
  '    "arquitectura": "depcruise src && npm run guardian && npm run deuda",', //          4
  '    "guardian": "node arquitectura/contratos/guardian.cjs",', //                        5
  '    "deuda": "node arquitectura/deuda/deuda.cjs",', //                                  6
  '    "gate": "npm run arquitectura"', //                                                 7
  "  }", //                                                                                8
  "}",
);
const ENTRADA_DE_X = {
  id: "todo--x-ts",
  tipo: "todo",
  archivos: ["x.ts"],
};
const ENTRADA_DE_Y = {
  id: "backlog-y",
  tipo: "backlog",
  archivos: ["y.ts"],
  verificacion: { contiene: "PENDIENTE" },
};
const registroDeDeuda = (...entradas: unknown[]): string =>
  `${JSON.stringify(entradas, null, 2)}\n`;
/** Un estado sano con la deuda: el paso de CI, los scripts, una entrada (un TODO en x.ts) y otra con verificación (y.ts). */
const CON_DEUDA: Estado = [
  [ARCHIVO_CI, TEXTO_DE_CI_CON_DEUDA],
  [ARCHIVO_PAQUETE, TEXTO_DE_PAQUETE_CON_DEUDA],
  [ARCHIVO_DEUDA, registroDeDeuda(ENTRADA_DE_X, ENTRADA_DE_Y)],
  ["x.ts", "// TODO: arreglar\n"],
  ["y.ts", "// PENDIENTE de extraer\nexport {};\n"],
].reduce((estado, [archivo, texto]) => conTexto(estado, archivo as string, texto as string), SANO);
const LINEA_DEL_JOB_GUARDIAN = 12;

const CASOS_J: Caso[] = [
  {
    nombre: "(j) estado sano: con el paso, los scripts y las entradas no hay nada que reclamar",
    base: CON_DEUDA,
    pr: CON_DEUDA,
    esperado: [],
  },
  {
    nombre: "(j) el tope de excepciones SUBE: debilita (en la línea de la clave)",
    base: CON_DEUDA,
    pr: conTexto(
      CON_DEUDA,
      ARCHIVO_CONFIGURACION_DE_DEUDA,
      textoDeLaConfiguracionDeDeuda(11, true),
    ),
    esperado: [["deuda-tope-subio", ARCHIVO_CONFIGURACION_DE_DEUDA, 2]],
  },
  {
    nombre: "(j) el tope de líneas por archivo SUBE: debilita (en la línea de la clave)",
    base: CON_DEUDA,
    pr: conTexto(
      CON_DEUDA,
      ARCHIVO_CONFIGURACION_DE_DEUDA,
      textoDeLaConfiguracionDeDeuda(10, true, 401),
    ),
    esperado: [["deuda-tope-de-lineas-subio", ARCHIVO_CONFIGURACION_DE_DEUDA, 4]],
  },
  {
    nombre: "(j) LEGÍTIMO: el tope de líneas BAJA",
    base: CON_DEUDA,
    pr: conTexto(
      CON_DEUDA,
      ARCHIVO_CONFIGURACION_DE_DEUDA,
      textoDeLaConfiguracionDeDeuda(10, true, 300),
    ),
    esperado: [],
  },
  {
    nombre: "(j) una exclusión NUEVA del tope de líneas: debilita (en la ruta de esa exclusión)",
    base: CON_DEUDA,
    pr: conTexto(
      CON_DEUDA,
      ARCHIVO_CONFIGURACION_DE_DEUDA,
      textoDeLaConfiguracionDeDeuda(10, true, 400, ["src/datos.ts"]),
    ),
    esperado: [["deuda-exclusion-nueva", ARCHIVO_CONFIGURACION_DE_DEUDA, 6]],
  },
  {
    nombre: "(j) LEGÍTIMO: se saca una exclusión, o la lista no cambia",
    base: conTexto(
      CON_DEUDA,
      ARCHIVO_CONFIGURACION_DE_DEUDA,
      textoDeLaConfiguracionDeDeuda(10, true, 400, ["src/datos.ts", "src/otros.ts"]),
    ),
    pr: conTexto(
      CON_DEUDA,
      ARCHIVO_CONFIGURACION_DE_DEUDA,
      textoDeLaConfiguracionDeDeuda(10, true, 400, ["src/datos.ts"]),
    ),
    esperado: [],
  },
  {
    nombre: "(j) LEGÍTIMO: el tope BAJA",
    base: CON_DEUDA,
    pr: conTexto(CON_DEUDA, ARCHIVO_CONFIGURACION_DE_DEUDA, textoDeLaConfiguracionDeDeuda(3, true)),
    esperado: [],
  },
  {
    nombre: "(j) el bloqueo en archivo tocado pasa de true a false: debilita",
    base: CON_DEUDA,
    pr: conTexto(
      CON_DEUDA,
      ARCHIVO_CONFIGURACION_DE_DEUDA,
      textoDeLaConfiguracionDeDeuda(10, false),
    ),
    esperado: [["deuda-bloqueo-aflojado", ARCHIVO_CONFIGURACION_DE_DEUDA, 3]],
  },
  {
    nombre: "(j) LEGÍTIMO: el bloqueo pasa de false a true, o sigue en false",
    base: conTexto(
      CON_DEUDA,
      ARCHIVO_CONFIGURACION_DE_DEUDA,
      textoDeLaConfiguracionDeDeuda(10, false),
    ),
    pr: CON_DEUDA,
    esperado: [],
  },
  {
    nombre: "(j) se borra la entrada de un marcador que sigue en el archivo: en el marcador",
    base: CON_DEUDA,
    pr: conTexto(CON_DEUDA, ARCHIVO_DEUDA, registroDeDeuda(ENTRADA_DE_Y)),
    esperado: [["deuda-entrada-borrada-sin-pagar", "x.ts", 1]],
  },
  {
    nombre: "(j) LEGÍTIMO: se borra la entrada y el marcador ya no está (se pagó)",
    base: CON_DEUDA,
    pr: conTexto(
      conTexto(CON_DEUDA, ARCHIVO_DEUDA, registroDeDeuda(ENTRADA_DE_Y)),
      "x.ts",
      "export {};\n",
    ),
    esperado: [],
  },
  {
    nombre: "(j) LEGÍTIMO: se borra la entrada y el archivo ya no existe",
    base: CON_DEUDA,
    pr: conTexto(conTexto(CON_DEUDA, ARCHIVO_DEUDA, registroDeDeuda(ENTRADA_DE_Y)), "x.ts", null),
    esperado: [],
  },
  {
    nombre: "(j) se borra la entrada de un hallazgo cuyo texto sigue: en la línea del texto",
    base: CON_DEUDA,
    pr: conTexto(CON_DEUDA, ARCHIVO_DEUDA, registroDeDeuda(ENTRADA_DE_X)),
    esperado: [["deuda-entrada-borrada-sin-pagar", "y.ts", 1]],
  },
  {
    nombre: "(j) LEGÍTIMO: la entrada de un hallazgo se borra cuando su texto ya no está",
    base: CON_DEUDA,
    pr: conTexto(
      conTexto(CON_DEUDA, ARCHIVO_DEUDA, registroDeDeuda(ENTRADA_DE_X)),
      "y.ts",
      "export {};\n",
    ),
    esperado: [],
  },
  {
    nombre: "(j) el job guardian ya no ejecuta el paso de la deuda: debilita, en la línea del job",
    base: CON_DEUDA,
    pr: conTexto(CON_DEUDA, ARCHIVO_CI, TEXTO_DE_CI),
    esperado: [["ci-sin-paso-de-deuda", ARCHIVO_CI, LINEA_DEL_JOB_GUARDIAN]],
  },
  {
    nombre: "(j) el paso solo ejecuta una de las dos formas: ya no es el paso de la deuda",
    base: CON_DEUDA,
    pr: reemplazando(
      CON_DEUDA,
      ARCHIVO_CI,
      "            node arquitectura/deuda/deuda.cjs --base=base\n",
      "            echo base\n",
    ),
    esperado: [["ci-sin-paso-de-deuda", ARCHIVO_CI, LINEA_DEL_JOB_GUARDIAN]],
  },
  {
    nombre:
      "(j) LEGÍTIMO: la base todavía no tenía el paso de la deuda (la primera vez que se incorpora)",
    base: SANO,
    pr: CON_DEUDA,
    esperado: [],
  },
  {
    nombre: "(j) el paso de la deuda gana un continue-on-error: debilita, en esa línea",
    base: CON_DEUDA,
    pr: reemplazando(
      CON_DEUDA,
      ARCHIVO_CI,
      "      - name: Deuda técnica\n",
      "      - name: Deuda técnica\n        continue-on-error: true\n",
    ),
    esperado: [["ci-deuda-con-salto", ARCHIVO_CI, 28]],
  },
  {
    nombre: "(j) el paso de la deuda gana un if: debilita, en la línea del if",
    base: CON_DEUDA,
    pr: reemplazando(
      CON_DEUDA,
      ARCHIVO_CI,
      "      - name: Deuda técnica\n",
      "      - name: Deuda técnica\n        if: false\n",
    ),
    esperado: [["ci-deuda-con-salto", ARCHIVO_CI, 28]],
  },
  {
    nombre: "(j) un continue-on-error o un if que la base ya tenía en el paso no se reclama",
    base: reemplazando(
      CON_DEUDA,
      ARCHIVO_CI,
      "      - name: Deuda técnica\n",
      "      - name: Deuda técnica\n        if: false\n        continue-on-error: true\n",
    ),
    pr: reemplazando(
      CON_DEUDA,
      ARCHIVO_CI,
      "      - name: Deuda técnica\n",
      "      - name: Deuda técnica\n        if: false\n        continue-on-error: true\n",
    ),
    esperado: [],
  },
  {
    nombre:
      "(j) el script arquitectura ya no encadena `npm run deuda`: debilita, en la línea del script",
    base: CON_DEUDA,
    pr: reemplazando(CON_DEUDA, ARCHIVO_PAQUETE, " && npm run deuda", ""),
    esperado: [["script-arquitectura-sin-deuda", ARCHIVO_PAQUETE, 4]],
  },
  {
    nombre: "(j) el script deuda se desvía: debilita",
    base: CON_DEUDA,
    pr: reemplazando(
      CON_DEUDA,
      ARCHIVO_PAQUETE,
      'node arquitectura/deuda/deuda.cjs"',
      'node otra.cjs"',
    ),
    esperado: [["script-deuda-desviado", ARCHIVO_PAQUETE, 6]],
  },
  {
    nombre: "(j) LEGÍTIMO: la base no tenía los scripts de la deuda",
    base: SANO,
    pr: CON_DEUDA,
    esperado: [],
  },
  {
    nombre: "(j) el PR borra el registro de deuda que la base tenía: el árbol no se puede mirar",
    base: CON_DEUDA,
    pr: conTexto(CON_DEUDA, ARCHIVO_DEUDA, null),
    esperado: [["arbol-ilegible", ARCHIVO_DEUDA, 1]],
  },
  {
    nombre: "(j) el PR borra los dos archivos de la deuda que la base tenía: tampoco",
    base: CON_DEUDA,
    pr: conTexto(conTexto(CON_DEUDA, ARCHIVO_DEUDA, null), ARCHIVO_CONFIGURACION_DE_DEUDA, null),
    esperado: [["arbol-ilegible", ARCHIVO_DEUDA, 1]],
  },
  {
    nombre: "(j) la configuración del PR no es un objeto: no se puede mirar",
    base: CON_DEUDA,
    pr: conTexto(CON_DEUDA, ARCHIVO_CONFIGURACION_DE_DEUDA, "[]\n"),
    esperado: [["arbol-ilegible", ARCHIVO_DEUDA, 1]],
  },
  {
    nombre: "(j) la base no trae la deuda: el chequeo se saltea con un aviso explícito",
    base: conTexto(conTexto(SANO, ARCHIVO_DEUDA, null), ARCHIVO_CONFIGURACION_DE_DEUDA, null),
    pr: CON_DEUDA,
    esperado: [],
    avisos: [["deuda-sin-base", ARCHIVO_DEUDA, 1]],
  },
  {
    nombre: "(j) ni la base ni el PR traen la deuda: no falla, y se avisa",
    base: conTexto(conTexto(SANO, ARCHIVO_DEUDA, null), ARCHIVO_CONFIGURACION_DE_DEUDA, null),
    pr: conTexto(conTexto(SANO, ARCHIVO_DEUDA, null), ARCHIVO_CONFIGURACION_DE_DEUDA, null),
    esperado: [],
    avisos: [["deuda-sin-base", ARCHIVO_DEUDA, 1]],
  },
  {
    nombre: "(j) el registro de la base no se puede leer: no hay con qué comparar",
    base: conTexto(CON_DEUDA, ARCHIVO_DEUDA, "{ roto\n"),
    pr: CON_DEUDA,
    esperado: [["base-ilegible", ARCHIVO_DEUDA, 1]],
  },
];

const TABLAS: [string, Caso[]][] = [
  ["a: contratos retirados y retiros", CASOS_A],
  ["b: detectores, clases y fuente de verdad", CASOS_B],
  ["c: chequeos (códigos de falla)", CASOS_C],
  ["d: constantes de rigor de las excepciones", CASOS_D],
  ["e: clases esperadas y excluibles", CASOS_E],
  ["f: job guardian, gate y evaluar-gate", CASOS_F],
  ["g: scripts de package.json", CASOS_G],
  ["h: matriz de invariantes y mutaciones", CASOS_H],
  ["i: batería de evasión", CASOS_I],
  ["j: deuda técnica", CASOS_J],
];

describe.each(TABLAS)("chequeo %s", (_titulo, casos) => {
  it.each(casos)("$nombre", ({ base, pr, ahora, esperado, avisos }) => {
    const { fallas, avisos: avisosDados } = correr(base ?? SANO, pr, ahora);
    const dadas = resumen(fallas);
    expect(
      [...dadas].sort(),
      `fallas dadas:\n${fallas.map((h) => nd.formatear(h)).join("\n")}`,
    ).toEqual([...esperado].sort());
    expect(resumen(avisosDados)).toEqual(avisos ?? []);
    // Toda falla trae una línea real y un motivo y una corrección escritos (M3).
    for (const h of [...fallas, ...avisosDados]) {
      expect(Number.isInteger(h.linea) && h.linea >= 1).toBe(true);
      expect(h.archivo).not.toBe("");
      expect(h.motivo.length).toBeGreaterThan(10);
      expect(h.correccion.length).toBeGreaterThan(10);
    }
  });
});

describe("lectura: lo que no se puede mirar es una falla, no un «pasa»", () => {
  it.each(SECCIONES_ROTAS)("$nombre", ({ quien, seccion, valor, esperado }) => {
    const roto = (estado: Estado): Instantanea => ({ ...aInstantanea(estado), [seccion]: valor });
    const { fallas } = nd.verificar({
      base: quien === "base" ? roto(SANO) : aInstantanea(SANO),
      pr: quien === "pr" ? roto(SANO) : aInstantanea(SANO),
      ahora: HOY,
      leerPr: (ruta) => SANO.arbol[ruta] ?? null,
    });
    expect(resumen(fallas)).toEqual([esperado]);
  });

  it("el motivo de lectura dice qué pasó (el error del módulo, o que el archivo no existe)", () => {
    const pr: Instantanea = { ...aInstantanea(SANO), registro: { error: "boom explosivo" } };
    const { fallas } = nd.verificar({
      base: aInstantanea(SANO),
      pr,
      ahora: HOY,
      leerPr: () => null,
    });
    expect(fallas[0]?.motivo).toContain("boom explosivo");
    const ausente: Instantanea = { ...aInstantanea(SANO), registro: { ausente: true } };
    const otra = nd.verificar({
      base: aInstantanea(SANO),
      pr: ausente,
      ahora: HOY,
      leerPr: () => null,
    });
    expect(otra.fallas[0]?.motivo).toContain("el archivo no existe");
  });

  it("con una sección ilegible no se inventan otros hallazgos sobre ella", () => {
    const pr: Instantanea = { ...aInstantanea(SANO), registro: { error: "boom" } };
    const { fallas } = nd.verificar({
      base: aInstantanea(SANO),
      pr,
      ahora: HOY,
      leerPr: () => null,
    });
    expect(fallas.map((h) => h.codigo)).toEqual(["arbol-ilegible"]);
  });
});

describe("la lista cerrada de códigos", () => {
  const todos = [...TABLAS.flatMap(([, casos]) => casos), ...SECCIONES_ROTAS.map((s) => s)];
  const emitidos = new Set<string>();
  for (const [, casos] of TABLAS) {
    for (const caso of casos) for (const [codigo] of caso.esperado) emitidos.add(codigo);
  }
  for (const rota of SECCIONES_ROTAS) emitidos.add(rota.esperado[0]);

  it("cada código tiene al menos un caso que lo emite con su archivo y línea", () => {
    expect(todos.length).toBeGreaterThan(50);
    expect([...emitidos].sort()).toEqual([...nd.CODIGOS_DE_FALLA].sort());
  });

  it("cada código tiene una descripción escrita y no hay códigos de aviso entre los de falla", () => {
    for (const codigo of nd.CODIGOS_DE_FALLA) {
      expect(nd.DESCRIPCION_DE_CODIGOS[codigo]?.length ?? 0).toBeGreaterThan(15);
    }
    expect(nd.CODIGOS_DE_AVISO.filter((c) => nd.CODIGOS_DE_FALLA.includes(c))).toEqual([]);
  });

  it("los avisos que emiten los casos son de la lista de avisos", () => {
    const avisos = TABLAS.flatMap(([, casos]) => casos.flatMap((c) => c.avisos ?? []));
    expect(avisos.length).toBeGreaterThan(0);
    for (const [codigo] of avisos) expect(nd.CODIGOS_DE_AVISO).toContain(codigo);
  });

  it("los doce chequeos están conectados (quitar uno de la lista no pasa inadvertido)", () => {
    expect(nd.CHEQUEOS).toHaveLength(12);
  });
});

describe("formato y límites", () => {
  it("formatea como archivo:línea · contrato · motivo · corrección", () => {
    const { fallas } = correr(SANO, sinColor);
    expect(nd.formatear(fallas[0] as Hallazgo)).toMatch(
      /^arquitectura\/contratos\/contratos\.cjs:2 · claves-de-permisos · El contrato «claves-de-permisos» .+ · Si el retiro es una decisión/,
    );
  });

  it("los límites se dicen (no se presenta como garantía total)", () => {
    expect(nd.limites.length).toBeGreaterThanOrEqual(4);
  });

  it("las fallas salen ordenadas por archivo y línea", () => {
    const { fallas } = correr(
      SANO,
      conTexto(
        conEstructura(SANO, (e) => {
          e.codigos = [];
          e.clases.esperadas = [];
        }),
        ARCHIVO_EXCEPCIONES,
        textoDeExcepciones("90", "1"),
      ),
    );
    const clave = fallas.map((h) => `${h.archivo}:${String(h.linea).padStart(4, "0")}`);
    expect(clave).toEqual([...clave].sort());
    expect(fallas.length).toBeGreaterThan(4);
  });
});

describe("ejecutaElGuardian: análisis lineal de la línea que corre el guardián", () => {
  const COMANDO = "node arquitectura/contratos/guardian.cjs";

  it.each([
    COMANDO,
    `${COMANDO} --base=x`,
    `${COMANDO} --base=origin/main -v`,
    `- ${COMANDO}`,
    `- run: ${COMANDO}`,
    `run: ${COMANDO}`,
    `run:${COMANDO}`,
    `      - run: ${COMANDO} --base=origin/main  `,
    `        ${COMANDO} --formato=json`,
    `node  arquitectura/contratos/guardian.cjs\t--base=x`,
  ])("acepta %j", (linea) => {
    expect(nd.ejecutaElGuardian(linea)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "- run:",
    `${COMANDO} || true`,
    `${COMANDO} --base x || true`,
    `${COMANDO} && otro`,
    `${COMANDO}; otro`,
    `${COMANDO} ;otro`,
    `${COMANDO} > /dev/null`,
    `${COMANDO} 2>&1`,
    `${COMANDO} | tee salida`,
    `${COMANDO} $(otro)`,
    `${COMANDO} base`,
    // Comportamiento de siempre: una opción con el valor suelto (`--base x`) no es una opción sola.
    `${COMANDO} --base x`,
    `${COMANDO} -`,
    `${COMANDO}x`,
    `-${COMANDO}`,
    `- run: node otro.cjs --base x`,
    "- run: npm run guardian",
    "node arquitectura/contratos/otro.cjs",
    `echo ${COMANDO}`,
    `# ${COMANDO}`,
    "--base x",
  ])("rechaza %j", (linea) => {
    expect(nd.ejecutaElGuardian(linea)).toBe(false);
  });

  // La expresión anterior, `(?:\s+--?[\w=./-]+)*`, era ambigua: `-` está en la clase, así que `-- -- -` se
  // parte de muchas maneras. El texto lo controla quien abre el PR; esto es el tope de rendimiento.
  const adversariales: ReadonlyArray<[string, string, boolean]> = [
    // `-` suelto no es una opción: la línea es inválida, pero tiene que decirlo enseguida.
    ["50.000 repeticiones de « -- -»", " -- -".repeat(50_000), false],
    ["50.000 repeticiones de « -- -» y un cierre inválido", `${" -- -".repeat(50_000)} !`, false],
    ["50.000 repeticiones de « --a»", " --a".repeat(50_000), true],
    ["50.000 repeticiones de « --a» y un cierre inválido", `${" --a".repeat(50_000)} ;`, false],
    ["50.000 repeticiones de « --» (todo opciones)", " --".repeat(50_000), true],
    ["50.000 espacios entre opciones", ` --a${" ".repeat(50_000)}--b`, true],
  ];

  it.each(adversariales)("se resuelve rápido con %s", (_nombre, cola, esperado) => {
    const linea = `- run: ${COMANDO}${cola}`;
    const inicio = performance.now();
    const resultado = nd.ejecutaElGuardian(linea);
    const duracion = performance.now() - inicio;
    expect(duracion).toBeLessThan(200);
    expect(resultado).toBe(esperado);
  });

  it("el script «guardian» de package.json usa el mismo análisis (y sigue exigiendo espacios simples)", () => {
    const cola = " -- -".repeat(50_000);
    const inicio = performance.now();
    const hallazgos = nd.chequearPaquete(
      {},
      {
        paquete: {
          valor: { arquitectura: "x && npm run guardian", guardian: `${COMANDO}${cola} ;` },
        },
      },
    );
    expect(performance.now() - inicio).toBeLessThan(200);
    expect(hallazgos.map((h) => h.codigo)).toEqual(["script-guardian-desviado"]);
  });
});

describe("funciones de apoyo", () => {
  it("versionMayor compara por tramos numéricos y rechaza lo mal escrito", () => {
    expect(nd.versionMayor("1.0.1", "1.0.0")).toBe(true);
    expect(nd.versionMayor("1.1.0", "1.0.9")).toBe(true);
    expect(nd.versionMayor("2.0.0", "1.99.99")).toBe(true);
    expect(nd.versionMayor("1.10.0", "1.9.0")).toBe(true);
    expect(nd.versionMayor("1.0.0", "1.0.0")).toBe(false);
    expect(nd.versionMayor("1.0.0", "1.0.1")).toBe(false);
    expect(nd.versionMayor("0.9.9", "1.0.0")).toBe(false);
    expect(nd.versionMayor("2", "1.0.0")).toBe(false);
    expect(nd.versionMayor("2.0.0", "uno")).toBe(false);
    expect(nd.versionMayor(null, "1.0.0")).toBe(false);
    expect(nd.versionMayor("1.0.0-beta", "0.1.0")).toBe(false);
  });

  it("leerCi ubica cada cosa en su línea (jobs, needs, ifs, continue-on-error)", () => {
    const ci = nd.leerCi(TEXTO_DE_CI) as unknown as {
      valor: Map<string, Record<string, unknown>>;
      lineaDeJobs: number;
    };
    expect(ci.lineaDeJobs).toBe(4);
    expect([...ci.valor.keys()]).toEqual(["estatico", "guardian", "gate"]);
    const guardianJob = ci.valor.get("guardian");
    expect(guardianJob?.["linea"]).toBe(12);
    expect(guardianJob?.["pasos"]).toEqual([
      { desde: 17, hasta: 17, ejecutaGuardian: false, deudaSola: false, deudaConBase: false },
      { desde: 18, hasta: 18, ejecutaGuardian: true, deudaSola: false, deudaConBase: false },
      {
        desde: 19,
        hasta: 23,
        ejecutaGuardian: false,
        deudaSola: false,
        deudaConBase: false,
        si: { valor: "github.event_name == 'pull_request'", linea: 20 },
      },
      {
        desde: 24,
        hasta: 26,
        ejecutaGuardian: false,
        deudaSola: false,
        deudaConBase: false,
        si: { valor: "github.event_name == 'pull_request'", linea: 25 },
      },
    ]);
    const gateJob = ci.valor.get("gate");
    expect(gateJob?.["needs"]).toEqual(["estatico", "guardian"]);
    expect(gateJob?.["lineaNeeds"]).toBe(30);
    expect(gateJob?.["si"]).toBe("always()");
    expect(gateJob?.["lineaSi"]).toBe(31);
  });

  it("leerCi entiende needs en varias líneas, entre comillas y con la lista en la línea de abajo", () => {
    const texto = lineas(
      "jobs:",
      "  a:",
      "    needs:",
      "      [",
      "        x, # comentario",
      '        "y",',
      "      ]",
      "  b:",
      "    needs: solo",
      "  c:",
      "    needs:",
      "      - uno # c",
      '      - "dos"',
    );
    const ci = nd.leerCi(texto) as unknown as { valor: Map<string, { needs: string[] }> };
    expect(ci.valor.get("a")?.needs).toEqual(["x", "y"]);
    expect(ci.valor.get("b")?.needs).toEqual(["solo"]);
    expect(ci.valor.get("c")?.needs).toEqual(["uno", "dos"]);
  });

  it("leerCi rechaza lo que no entiende en vez de ignorarlo", () => {
    expect(nd.leerCi("name: x\n")["error"]).toContain("jobs");
    expect(nd.leerCi("jobs:\n")["error"]).toContain("ningún job");
    expect(nd.leerCi("jobs:\n  a:\n    needs: [x\n")["error"]).toContain("needs");
    expect(nd.leerCi("jobs:\n x:\n")["error"]).toContain("inesperada");
    expect(nd.leerCi("jobs:\n    suelto: 1\n")["error"]).toContain("antes del primer job");
  });

  it("leerConstante exige un entero literal y devuelve su línea", () => {
    expect(nd.leerConstante("a\nconst X = 7;\n", "X")).toEqual({ valor: 7, linea: 2 });
    expect(nd.leerConstante("const X = 7; // nota\n", "X")).toEqual({ valor: 7, linea: 1 });
    expect(nd.leerConstante("const X = 7 + 1;\n", "X")["error"]).toContain("const X");
    expect(nd.leerConstante("let X = 7;\n", "X")["error"]).toBeDefined();
    expect(nd.leerConstante(null, "X")).toEqual({ ausente: true });
  });

  it("leerRetiros: sin archivo es una lista vacía; JSON inválido o un objeto es un error", () => {
    expect(nd.leerRetiros(null)).toEqual({ valor: [] });
    expect(nd.leerRetiros("[]")).toEqual({ valor: [] });
    expect(nd.leerRetiros("{")["error"]).toContain("JSON");
    expect(nd.leerRetiros("{}")["error"]).toContain("lista");
  });

  it("extraerInvariantes acepta una lista, INVARIANTES o la primera lista exportada", () => {
    const lista = [
      {
        id: "I1",
        mutaciones: [
          { id: "m1", tipo: "eliminacion" },
          { tipo: "alteracion" },
          { tipo: "alteracion" },
        ],
      },
      { id: "I2" },
      { sinId: true },
    ];
    const esperado = {
      ids: ["I1", "I2"],
      mutaciones: [
        { invariante: "I1", id: "m1" },
        { invariante: "I1", id: "alteracion#1" },
        { invariante: "I1", id: "alteracion#2" },
      ],
    };
    expect(nd.extraerInvariantes(lista)).toEqual(esperado);
    expect(nd.extraerInvariantes({ INVARIANTES: lista })).toEqual(esperado);
    expect(nd.extraerInvariantes({ invariantes: lista })).toEqual(esperado);
    expect(nd.extraerInvariantes({ otra: 1, matriz: lista })).toEqual(esperado);
    expect(() => nd.extraerInvariantes({})).toThrow("invariantes");
    expect(() => nd.extraerInvariantes(null)).toThrow("invariantes");
  });
});

// ---------------------------------------------------------------------------------------------
// De punta a punta: árboles temporales, el CLI real y el proceso hijo que carga el código del PR.
// ---------------------------------------------------------------------------------------------

afterAll(limpiarTemporales);

const VERIFICADOR = "arquitectura/contratos/no-debilitar.cjs";
function vigilar(base: string, arbol: string, verificador: string = base) {
  const r = spawnSync(process.execPath, [join(verificador, VERIFICADOR), "--arbol", arbol], {
    encoding: "utf8",
    timeout: 120_000,
  });
  return { estado: r.status, salida: r.stdout, error: r.stderr };
}
const CI_REAL = ".github/workflows/ci.yml";
const lineaDelNeedsDelGate = (raiz: string): number =>
  lineaEn(
    raiz,
    CI_REAL,
    (l) => /^ {4}needs:/.test(l),
    lineaEn(raiz, CI_REAL, (l) => l === "  gate:"),
  );

describe("de punta a punta: el verificador de la base sobre el árbol del PR (CLI real)", () => {
  it("el repositorio real contra sí mismo no tiene debilitamientos", () => {
    const r = vigilar(RAIZ, RAIZ);
    expect(r.error).toBe("");
    expect(r.estado).toBe(0);
    expect(r.salida).toContain("OK");
  });

  it("una copia sana de la base como PR pasa", () => {
    const base = arbolDesdeElRepo();
    const pr = arbolDesdeElRepo();
    const r = vigilar(base, pr);
    expect(r.estado).toBe(0);
    expect(r.error).toBe("");
    // La base trae la matriz de invariantes: el chequeo (h) corre y no se saltea con un aviso.
    expect(existsSync(join(base, ARCHIVO_INVARIANTES))).toBe(true);
    expect(r.salida).not.toContain(`AVISO ${ARCHIVO_INVARIANTES}:1`);
  });

  it("falla con el archivo y la línea EXACTOS: gate sin guardian en needs, tope de 90 días y script desviado", () => {
    const base = arbolDesdeElRepo();
    const pr = arbolDesdeElRepo();
    alterar(pr, CI_REAL, /^( {8})guardian,\n/m, "");
    alterar(
      pr,
      ARCHIVO_EXCEPCIONES,
      "const PLAZO_MAXIMO_DIAS = 60;",
      "const PLAZO_MAXIMO_DIAS = 90;",
    );
    alterar(
      pr,
      ARCHIVO_PAQUETE,
      '"guardian": "node arquitectura/contratos/guardian.cjs"',
      '"guardian": "echo ok"',
    );
    const r = vigilar(base, pr);
    expect(r.estado).toBe(1);
    const necesidades = lineaDelNeedsDelGate(pr);
    const tope = lineaEn(pr, ARCHIVO_EXCEPCIONES, (l) => l.startsWith("const PLAZO_MAXIMO_DIAS"));
    const script = lineaEn(pr, ARCHIVO_PAQUETE, (l) => l.includes('"guardian": "echo ok"'));
    expect(r.error).toContain(
      `FALLA ${CI_REAL}:${necesidades} · - · El job gate ya no espera a «guardian»`,
    );
    expect(r.error).toContain(
      `FALLA ${ARCHIVO_EXCEPCIONES}:${tope} · - · El tope de las excepciones subió de 60 a 90`,
    );
    expect(r.error).toContain(
      `FALLA ${ARCHIVO_PAQUETE}:${script} · - · El script «guardian» ("echo ok")`,
    );
    expect(r.error).toContain("3 debilitamientos");
  });

  it("falla si el PR borra el job guardian de ci.yml, o su prueba del Gate en evaluar-gate", () => {
    const base = arbolDesdeElRepo();
    const pr = arbolDesdeElRepo();
    alterar(pr, "arquitectura/evaluar-gate.cjs", '  "guardian",\n', "");
    const r = vigilar(base, pr);
    const obligatorios = lineaEn(pr, "arquitectura/evaluar-gate.cjs", (l) =>
      l.startsWith("const OBLIGATORIOS"),
    );
    expect(r.estado).toBe(1);
    expect(r.error).toContain(
      `FALLA arquitectura/evaluar-gate.cjs:${obligatorios} · - · evaluarGate deja pasar un guardián «failure», «skipped», «cancelled»`,
    );

    const sinJob = arbolDesdeElRepo();
    const texto = leerEn(sinJob, CI_REAL);
    const inicio = texto.indexOf("  guardian:\n");
    const fin = texto.indexOf("  pruebas:\n");
    escribirEn(sinJob, CI_REAL, texto.slice(0, inicio) + texto.slice(fin));
    const r2 = vigilar(base, sinJob);
    expect(r2.estado).toBe(1);
    expect(r2.error).toContain(
      `FALLA ${CI_REAL}:${lineaEn(sinJob, CI_REAL, (l) => l === "jobs:")} · - · ci.yml no tiene el job «guardian»`,
    );
  });

  it("con el invariantes.cjs REAL como base: borrar una mutación o un invariante falla con archivo:línea (la forma real del catálogo)", () => {
    const base = arbolDesdeElRepo();
    expect(existsSync(join(base, ARCHIVO_INVARIANTES))).toBe(true);
    const pr = arbolDesdeElRepo();
    quitarMutacionDelCatalogo(pr, "I1-quitar-la-regla-de-una-carpeta");
    quitarInvarianteDelCatalogo(pr, "I7");
    const r = vigilar(base, pr);
    expect(r.estado).toBe(1);
    const lineaDeI1 = lineaEn(pr, ARCHIVO_INVARIANTES, (l) => l.includes('id: "I1",'));
    const lineaDeLaTabla = lineaEn(pr, ARCHIVO_INVARIANTES, (l) =>
      l.startsWith("const INVARIANTES"),
    );
    expect(r.error).toContain(
      `FALLA ${ARCHIVO_INVARIANTES}:${lineaDeI1} · - · La mutación «I1-quitar-la-regla-de-una-carpeta» del invariante «I1» estaba en la base y ya no`,
    );
    expect(r.error).toContain(
      `FALLA ${ARCHIVO_INVARIANTES}:${lineaDeLaTabla} · - · El invariante «I7» de la matriz de la base ya no está`,
    );
    // Y sin alterar nada, la matriz real contra sí misma pasa y no avisa que la base no la trae.
    const sano = vigilar(base, arbolDesdeElRepo());
    expect(sano.estado).toBe(0);
    expect(sano.salida).not.toContain("invariantes-sin-base");
    expect(sano.salida).not.toContain("AVISO");
  });

  it("el PR quita un detector del registro y cambia su fuente sin subir la versión: falla en la línea del id", () => {
    const base = arbolDesdeElRepo();
    escribirEn(base, ARCHIVO_REGISTRO, REGISTRO_DE_EJEMPLO);
    const pr = arbolDesdeElRepo();
    escribirEn(pr, ARCHIVO_REGISTRO, REGISTRO_DE_EJEMPLO);
    alterar(
      pr,
      ARCHIVO_REGISTRO,
      /\n {6}porPatron\(\{ tipo: "uso", clases: \["frontend"\], patron: \/separador\/ \}\),/,
      "",
    );
    alterar(pr, ARCHIVO_REGISTRO, 'variable: "--color-separador" }', 'variable: "--otro" }');
    const r = vigilar(base, pr);
    const id = lineaEn(pr, ARCHIVO_REGISTRO, (l) => l.includes('id: "color-de-separadores"'));
    expect(r.estado).toBe(1);
    expect(r.error).toContain(
      `FALLA ${ARCHIVO_REGISTRO}:${id} · color-de-separadores · El contrato «color-de-separadores» tenía 2 detectores de tipo «uso» y ahora tiene 1`,
    );
    expect(r.error).toContain(
      `FALLA ${ARCHIVO_REGISTRO}:${id} · color-de-separadores · El contrato «color-de-separadores» cambió su fuente de verdad`,
    );
  });

  it("LEGÍTIMO: un PR que agrega un contrato, un código, endurece el rigor y retira otro contrato con registro pasa", () => {
    const base = arbolDesdeElRepo();
    escribirEn(base, ARCHIVO_REGISTRO, REGISTRO_DE_EJEMPLO);
    const pr = arbolDesdeElRepo();
    escribirEn(
      pr,
      ARCHIVO_REGISTRO,
      REGISTRO_DE_EJEMPLO.replace("color-de-separadores", "contrato-reemplazante"),
    );
    escribirEn(
      pr,
      ARCHIVO_RETIROS,
      `${JSON.stringify(
        [retiroCompleto("color-de-separadores", { creada: new Date().toISOString().slice(0, 10) })],
        null,
        2,
      )}\n`,
    );
    alterar(
      pr,
      ARCHIVO_EXCEPCIONES,
      "const PLAZO_MAXIMO_DIAS = 60;",
      "const PLAZO_MAXIMO_DIAS = 45;",
    );
    alterar(pr, ARCHIVO_EXCEPCIONES, "const DIAS_DE_AVISO = 14;", "const DIAS_DE_AVISO = 21;");
    alterar(
      pr,
      "arquitectura/contratos/codigos.cjs",
      '  "sin-rutas":',
      '  "un-chequeo-nuevo": "otro",\n  "sin-rutas":',
    );
    const r = vigilar(base, pr);
    expect(r.error).toBe("");
    expect(r.estado).toBe(0);
  });

  it.each([
    ["lanza al cargarse", 'throw new Error("boom del PR");'],
    ["sale 0 en el medio del require", 'console.log("ruido"); process.exit(0);'],
    [
      "imprime ruido y cuelga el código de salida",
      'console.log("@@NO-DEBILITAR@@{}"); module.exports = 5;',
    ],
  ])(
    "el código del PR %s: se informa como árbol ilegible y no tumba al verificador",
    (_nombre, codigo) => {
      const base = arbolDesdeElRepo();
      const pr = arbolDesdeElRepo();
      escribirEn(pr, ARCHIVO_REGISTRO, `${codigo}\n`);
      const r = vigilar(base, pr);
      expect(r.estado).toBe(1);
      expect(r.error).toContain(
        `FALLA ${ARCHIVO_REGISTRO}:1 · - · No se pudo leer «registro» del árbol del PR`,
      );
    },
  );

  it("sin --arbol, o con una carpeta que no existe, es un error de uso (salida 2)", () => {
    const sin = spawnSync(process.execPath, [join(RAIZ, VERIFICADOR)], { encoding: "utf8" });
    expect(sin.status).toBe(2);
    expect(sin.stderr).toContain("Uso:");
    const inexistente = spawnSync(
      process.execPath,
      [join(RAIZ, VERIFICADOR), "--arbol", join(RAIZ, "no-existe")],
      { encoding: "utf8" },
    );
    expect(inexistente.status).toBe(2);
    expect(inexistente.stderr).toContain("no es una carpeta");
    const sinValor = spawnSync(process.execPath, [join(RAIZ, VERIFICADOR), "--arbol"], {
      encoding: "utf8",
    });
    expect(sinValor.status).toBe(2);
    const igual = spawnSync(process.execPath, [join(RAIZ, VERIFICADOR), `--arbol=${RAIZ}`], {
      encoding: "utf8",
    });
    expect(igual.status).toBe(0);
  });
});

describe("el PR debilita el verificador mismo", () => {
  it("el verificador del PR, vaciado, ya no vería nada; el de la base sí lo ve", () => {
    const base = arbolDesdeElRepo();
    const pr = arbolDesdeElRepo();
    // El PR debilita el gate, baja el aviso y, para que nadie lo note, deja un verificador que no mira nada.
    alterar(pr, CI_REAL, /^( {8})guardian,\n/m, "");
    alterar(pr, ARCHIVO_EXCEPCIONES, "const DIAS_DE_AVISO = 14;", "const DIAS_DE_AVISO = 1;");
    escribirEn(
      pr,
      VERIFICADOR,
      "// Verificador vaciado: no compara nada.\nprocess.exitCode = 0;\n",
    );

    const delPr = vigilar(base, pr, pr);
    expect(delPr.estado, "el verificador vaciado del PR da el visto bueno").toBe(0);

    const delaBase = vigilar(base, pr, base);
    expect(delaBase.estado, "el verificador de la base lo detecta").toBe(1);
    expect(delaBase.error).toContain(
      `FALLA ${CI_REAL}:${lineaDelNeedsDelGate(pr)} · - · El job gate ya no espera a «guardian»`,
    );
    expect(delaBase.error).toContain(
      `FALLA ${ARCHIVO_EXCEPCIONES}:${lineaEn(pr, ARCHIVO_EXCEPCIONES, (l) => l.startsWith("const DIAS_DE_AVISO"))} · - · El aviso previo al vencimiento bajó de 14 a 1 días`,
    );
  });

  it("el verificador del PR, intacto, también lo detecta: el vaciado era lo único que lo callaba", () => {
    const base = arbolDesdeElRepo();
    const pr = arbolDesdeElRepo();
    alterar(pr, CI_REAL, /^( {8})guardian,\n/m, "");
    expect(vigilar(base, pr, pr).estado).toBe(1);
  });
});

describe("guardian.cjs --base: la vigilancia con la base en un solo comando", () => {
  const crearBase = (contenido: string | null): string => {
    const carpeta = carpetaTemporal("base-falsa-");
    if (contenido !== null) escribirEn(carpeta, VERIFICADOR, contenido);
    return carpeta;
  };

  it("lee --base en las dos formas (con espacio y con igual) y no la confunde con otras opciones", () => {
    expect(guardian.valorDeOpcion(["--base", "../base"], "--base")).toBe("../base");
    expect(guardian.valorDeOpcion(["--sin-informe", "--base=../base"], "--base")).toBe("../base");
    expect(guardian.valorDeOpcion(["--sin-informe"], "--base")).toBeUndefined();
    expect(guardian.valorDeOpcion(["--base"], "--base")).toBe("");
  });

  it("pasa si el verificador de la base sale 0, y le pasa el árbol actual en --arbol", () => {
    const base = crearBase(
      'const i = process.argv.indexOf("--arbol");\nprocess.exit(process.argv[i + 1] === process.env.ESPERADO ? 0 : 7);\n',
    );
    process.env["ESPERADO"] = RAIZ;
    try {
      expect(guardian.vigilarConLaBase(base, RAIZ)).toBe(0);
      expect(guardian.vigilarConLaBase(base, join(RAIZ, "otra"))).toBe(7);
    } finally {
      delete process.env["ESPERADO"];
    }
  });

  it("falla si el verificador de la base detecta un debilitamiento", () => {
    const base = crearBase("process.exit(1);\n");
    expect(guardian.vigilarConLaBase(base, RAIZ)).toBe(1);
  });

  it("avisa y sigue si la base todavía no trae el verificador (primera incorporación)", () => {
    const base = crearBase(null);
    expect(guardian.vigilarConLaBase(base, RAIZ)).toBe(0);
  });

  it("falla si la carpeta de la base no existe o viene vacía", () => {
    expect(guardian.vigilarConLaBase(join(tmpdir(), "no-existe-base-xyz"), RAIZ)).toBe(2);
    expect(guardian.vigilarConLaBase("", RAIZ)).toBe(2);
  });

  // Sobre un repositorio git sintético en disco (el guardián real copiado + los archivos de `BASE`), no
  // sobre el repo real: así no depende de que haya `.git` aquí y NUNCA se saltea (el sandbox de la
  // mutación no lo tiene).
  it("el CLI sale ≠ 0 si la vigilancia falla aunque el guardián pase, y 0 si ambos pasan", () => {
    const repo = repoSanoEnDisco();
    const guardianCli = join(repo, "arquitectura/contratos/guardian.cjs");
    const corre = (...args: string[]) =>
      spawnSync(process.execPath, [guardianCli, "--sin-informe", ...args], {
        encoding: "utf8",
        cwd: repo,
      });
    const sola = corre();
    expect(sola.stderr).toBe("");
    expect(sola.status).toBe(0);
    expect(corre("--base", crearBase("process.exit(0);\n")).status).toBe(0);
    const falla = corre(`--base=${crearBase("process.exit(1);\n")}`);
    expect(falla.status).toBe(1);
    expect(falla.stdout).toContain("Guardián de contratos: OK");
  });

  it("el guardián del repo sintético falla (y la base no lo tapa) si el repositorio está roto", () => {
    const repo = repoSanoEnDisco();
    escribirEn(repo, "herramienta-sin-clase/x.ts", "export {};\n");
    const corrida = spawnSync(
      process.execPath,
      [
        join(repo, "arquitectura/contratos/guardian.cjs"),
        "--sin-informe",
        "--base",
        crearBase("process.exit(0);\n"),
      ],
      { encoding: "utf8", cwd: repo },
    );
    expect(corrida.status).toBe(1);
    expect(corrida.stderr).toContain("FALLA herramienta-sin-clase/x.ts:1 · ");
  });
});
