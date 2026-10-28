import { describe, expect, it } from "vitest";
import { retiroCompleto } from "./guardian-apoyo";
import {
  A,
  ciLeido,
  contratoResumido,
  instantanea,
  lineas,
  nd,
  ubicacion,
} from "./guardian-mutantes-d-apoyo";
import type { Hallazgo, Instantanea } from "./guardian-mutantes-d-apoyo";

/**
 * Vigilancia de la versión anterior, parte de CHEQUEOS (`no-debilitar.cjs`): cada chequeo (a)-(h) sobre
 * instantáneas sintéticas, con el texto exacto de lo que dice, el campo `donde` o `linea` que trae y el
 * comportamiento ante secciones ausentes o ilegibles. Los textos de los mensajes son contrato para quien los
 * lee en la CI: se afirman completos.
 */

const HOY = new Date("2026-10-21T12:00:00Z");
const CORRECCION_DE_RETIRO =
  "Cada retiro lleva exactamente: id, motivo, responsable, aprobadoPor y creada (AAAA-MM-DD, no futura).";

// ---------------------------------------------------------------------------------------------
// (a) retiros
// ---------------------------------------------------------------------------------------------

describe("(a) retiros.json: cada entrada dice qué le pasa, con el texto y el lugar exactos", () => {
  const retirosDelPr = (retiros: unknown[]): Hallazgo[] =>
    nd.chequearRetiros(instantanea(), instantanea({ retiros: { valor: retiros } }), { ahora: HOY });
  const motivos = (retiros: unknown[]): string[] => retirosDelPr(retiros).map((h) => h.motivo);

  it("una entrada que no es un objeto se rechaza en su posición", () => {
    for (const entrada of [null, "texto", 5, ["x"]]) {
      const [h, ...resto] = retirosDelPr([entrada]);
      expect(resto).toEqual([]);
      expect(h).toStrictEqual({
        codigo: "retiro-invalido",
        archivo: A.retiros,
        contrato: null,
        motivo: "La entrada 1 de retiros.json no es un objeto.",
        correccion: CORRECCION_DE_RETIRO,
        donde: ubicacion.enJson(0),
      });
    }
  });

  it("el número de entrada que se informa es el de su posición, desde 1", () => {
    expect(motivos([retiroCompleto("a"), null])).toEqual([
      "La entrada 2 de retiros.json no es un objeto.",
    ]);
  });

  it("un campo vacío, solo con espacios o ausente es «falta o está vacío», y el lugar es el campo", () => {
    const [vacio] = retirosDelPr([retiroCompleto("x", { motivo: "   " })]);
    expect(vacio?.motivo).toBe(
      "La entrada 1 de retiros.json no tiene «motivo» (falta o está vacío).",
    );
    expect(vacio?.donde).toStrictEqual(ubicacion.enJson(0, "motivo"));
    // Sin `creada`: UN solo problema (no hay fecha que validar).
    const { creada: _creada, ...sinCreada } = retiroCompleto("x");
    void _creada;
    const falta = retirosDelPr([sinCreada]);
    expect(falta.map((h) => h.motivo)).toEqual([
      "La entrada 1 de retiros.json no tiene «creada» (falta o está vacío).",
    ]);
    expect(falta[0]?.donde).toStrictEqual(ubicacion.enJson(0, "creada"));
  });

  it("un campo que no es de los permitidos es un problema, en la línea de ese campo", () => {
    const [h, ...resto] = retirosDelPr([retiroCompleto("x", { extra: "y" })]);
    expect(resto).toEqual([]);
    expect(h?.motivo).toBe(
      "La entrada 1 de retiros.json trae «extra», que no es un campo permitido.",
    );
    expect(h?.donde).toStrictEqual(ubicacion.enJson(0, "extra"));
  });

  it.each([
    "2026-13-45",
    "ayer",
    "2026-10-011",
    "12026-10-01",
    "2026-02-30",
    "2023-02-29",
    "0050-06-15",
  ])("la fecha «%s» no es una fecha AAAA-MM-DD real", (creada) => {
    expect(motivos([retiroCompleto("x", { creada })])).toEqual([
      `La entrada 1 de retiros.json tiene «creada» («${creada}») que no es una fecha AAAA-MM-DD real.`,
    ]);
  });

  it.each(["2026-02-28", "2024-02-29", "2000-01-01", "2026-10-21"])(
    "la fecha «%s» es válida (y hoy mismo no es futura)",
    (creada) => {
      expect(motivos([retiroCompleto("x", { creada })])).toEqual([]);
    },
  );

  it("una fecha posterior a hoy dice cuál es hoy (solo el día)", () => {
    const [h] = retirosDelPr([retiroCompleto("x", { creada: "2026-10-22" })]);
    expect(h?.motivo).toBe(
      "La entrada 1 de retiros.json tiene «creada» (2026-10-22) posterior a hoy (2026-10-21).",
    );
    expect(h?.donde).toStrictEqual(ubicacion.enJson(0, "creada"));
  });

  it("un id repetido se señala en la segunda entrada; sin id no se compara con nada", () => {
    expect(motivos([retiroCompleto("x"), retiroCompleto("y"), retiroCompleto("x")])).toEqual([
      "La entrada 3 de retiros.json repite el id «x».",
    ]);
    const sinId = (): Record<string, unknown> => {
      const { id: _id, ...resto } = retiroCompleto("x");
      void _id;
      return resto;
    };
    expect(motivos([sinId(), sinId()])).toEqual([
      "La entrada 1 de retiros.json no tiene «id» (falta o está vacío).",
      "La entrada 2 de retiros.json no tiene «id» (falta o está vacío).",
    ]);
  });

  it("un contrato de la base que ya no está, sin retiro, dice cuál (y uno sin id no cuenta)", () => {
    const base = instantanea({
      registro: { valor: [contratoResumido("a"), contratoResumido(null)] },
    });
    const pr = instantanea({ registro: { valor: [] } });
    expect(nd.chequearRetiros(base, pr, { ahora: HOY })).toStrictEqual([
      {
        codigo: "retiro-sin-registro",
        archivo: A.registro,
        contrato: "a",
        motivo:
          "El contrato «a» estaba en el registro de la base y ya no está, y no hay un retiro registrado: sería quitar un contrato en silencio.",
        correccion:
          "Si el retiro es una decisión, agregá a retiros.json { id, motivo, responsable, aprobadoPor, creada }; si no, devolvé el contrato.",
        donde: ubicacion.enTexto("module.exports"),
      },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// (b) contratos
// ---------------------------------------------------------------------------------------------

describe("(b) contratos: lo que se dice de detectores, clases y fuente", () => {
  const registro = (...contratos: Record<string, unknown>[]): Instantanea =>
    instantanea({ registro: { valor: contratos } });

  it("un contrato sin id que declara sinDetectorDeDefinicion no se vigila (no hay a quién nombrar)", () => {
    const pr = registro(contratoResumido(null, { sinDefinicion: "motivo" }));
    expect(nd.chequearContratos(registro(), pr)).toEqual([]);
  });

  it("las clases que dejó de mirar un detector se listan ordenadas y separadas por coma", () => {
    const con = (clases: string[]) =>
      registro(contratoResumido("c1", { detectores: [{ tipo: "uso", clases }] }));
    const [h, ...resto] = nd.chequearContratos(
      con(["pruebas", "frontend", "backend"]),
      con(["frontend"]),
    );
    expect(resto).toEqual([]);
    expect(h).toStrictEqual({
      codigo: "clases-de-detector-perdidas",
      archivo: A.registro,
      contrato: "c1",
      motivo:
        "Los detectores de tipo «uso» del contrato «c1» dejaron de mirar las clases: backend, pruebas. Un uso ahí ya no se vería.",
      correccion: "Devolvé las clases al detector (se puede agregar clases, no quitarlas).",
      donde: ubicacion.enTexto('id: "c1"'),
    });
  });

  it("cambiar la fuente sin subir la versión dice las dos versiones (o que no tiene ninguna)", () => {
    const fuente = (archivo: string, version: string | null) =>
      registro(contratoResumido("c1", { version, fuente: { archivo, variable: "--x" } }));
    const motivoCon = (version: string | null): string | undefined =>
      nd.chequearContratos(fuente("a.css", version), fuente("b.css", version))[0]?.motivo;
    expect(motivoCon(null)).toBe(
      "El contrato «c1» cambió su fuente de verdad pero su versión sigue en (ninguna) (la base: (ninguna)): un cambio de fuente es un cambio de contrato.",
    );
    expect(motivoCon("1.0.0")).toBe(
      "El contrato «c1» cambió su fuente de verdad pero su versión sigue en 1.0.0 (la base: 1.0.0): un cambio de fuente es un cambio de contrato.",
    );
    expect(nd.chequearContratos(fuente("a.css", "1.0.0"), fuente("b.css", "1.1.0"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// (c) y (d): qué trae cada hallazgo
// ---------------------------------------------------------------------------------------------

describe("(c) y (d): un hallazgo trae `donde` o `linea`, no los dos ni uno vacío", () => {
  it("el chequeo de códigos dice dónde buscar y no trae línea", () => {
    const [h] = nd.chequearCodigos(
      instantanea({ codigos: { valor: ["a", "b"] } }),
      instantanea({ codigos: { valor: ["a"] } }),
    );
    expect(Object.keys(h ?? {}).sort()).toEqual([
      "archivo",
      "codigo",
      "contrato",
      "correccion",
      "donde",
      "motivo",
    ]);
    expect(h?.donde).toStrictEqual(ubicacion.enTexto("const CODIGOS_DE_FALLA"));
    expect(h?.motivo).toBe(
      "El código de falla «b» existía en la base y ya no: se borró un chequeo del guardián.",
    );
  });

  it("el chequeo de rigor trae la línea de la constante y no trae `donde`", () => {
    const hallazgos = nd.chequearRigor(
      instantanea(),
      instantanea({ plazo: { valor: 90, linea: 4 }, aviso: { valor: 7, linea: 6 } }),
    );
    expect(hallazgos.map((h) => Object.keys(h).sort())).toEqual([
      ["archivo", "codigo", "contrato", "correccion", "linea", "motivo"],
      ["archivo", "codigo", "contrato", "correccion", "linea", "motivo"],
    ]);
    expect(hallazgos.map((h) => [h.codigo, h.archivo, h.linea, h.motivo])).toEqual([
      [
        "tope-de-excepciones-subio",
        A.excepciones,
        4,
        "El tope de las excepciones subió de 60 a 90 días: las excepciones durarían más que lo que decidió el dueño.",
      ],
      [
        "aviso-de-excepciones-bajo",
        A.excepciones,
        6,
        "El aviso previo al vencimiento bajó de 14 a 7 días: avisaría más tarde.",
      ],
    ]);
  });

  it("el rigor que mejora, o que queda igual, no es un hallazgo", () => {
    expect(
      nd.chequearRigor(
        instantanea(),
        instantanea({ plazo: { valor: 30, linea: 4 }, aviso: { valor: 21, linea: 6 } }),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Secciones que faltan: cada chequeo se saltea lo que no tiene, sin romperse
// ---------------------------------------------------------------------------------------------

describe("cada chequeo tolera que falten secciones de la instantánea", () => {
  const completa = instantanea();
  const vacia: Instantanea = {};

  it("con una instantánea vacía (o a medias) ninguno falla ni se cae", () => {
    expect(nd.chequearRetiros(vacia, vacia, { ahora: HOY })).toEqual([]);
    expect(nd.chequearContratos(vacia, vacia)).toEqual([]);
    expect(nd.chequearCodigos(vacia, vacia)).toEqual([]);
    expect(nd.chequearRigor(vacia, vacia)).toEqual([]);
    expect(nd.chequearClases(vacia, vacia)).toEqual([]);
    expect(nd.chequearCi(vacia, vacia)).toEqual([]);
    expect(nd.chequearGate(vacia, vacia)).toEqual([]);
    expect(nd.chequearPaquete(vacia, vacia)).toEqual([]);
    expect(nd.chequearInvariantes(vacia, vacia)).toEqual([]);
  });

  it("falta la sección de la base, o la del PR, y el chequeo no inventa nada", () => {
    const conPlazo = instantanea({ plazo: { valor: 90, linea: 4 } });
    expect(nd.chequearRigor(vacia, conPlazo)).toEqual([]);
    expect(nd.chequearRigor(completa, vacia)).toEqual([]);
    expect(nd.chequearRigor({ ...completa, plazo: undefined }, conPlazo)).toEqual([]);
    expect(nd.chequearRigor({ ...completa, plazo: { error: "x" } }, conPlazo)).toEqual([]);
    expect(nd.chequearCi(vacia, completa)).toEqual([]);
    expect(
      nd.chequearInvariantes(
        instantanea({ invariantes: { valor: { ids: ["I1"], mutaciones: [] } } }),
        {},
      ),
    ).toEqual([]);
  });

  it("falta la matriz del PR por completo (no es lo mismo que «ausente»): sin hallazgo", () => {
    const base = instantanea({ invariantes: { valor: { ids: ["I1"], mutaciones: [] } } });
    expect(nd.chequearInvariantes(base, { ...completa, invariantes: undefined })).toEqual([]);
    expect(nd.chequearInvariantes(base, { ...completa, invariantes: { error: "x" } })).toEqual([]);
  });

  it("la matriz que la base tenía y el PR ya no tiene es un hallazgo del archivo entero", () => {
    const base = instantanea({ invariantes: { valor: { ids: ["I1"], mutaciones: [] } } });
    const [h, ...resto] = nd.chequearInvariantes(
      base,
      instantanea({ invariantes: { ausente: true } }),
    );
    expect(resto).toEqual([]);
    expect(h).toStrictEqual({
      codigo: "invariante-borrada",
      archivo: A.invariantes,
      contrato: null,
      motivo:
        "La matriz de invariantes (invariantes.cjs) existía en la base y ya no existe en el PR.",
      correccion: "Devolvé la matriz: se pueden agregar invariantes y mutaciones, no quitarlas.",
      donde: ubicacion.enArchivo(),
    });
  });
});

// ---------------------------------------------------------------------------------------------
// (e) clases
// ---------------------------------------------------------------------------------------------

describe("(e) clases: los mensajes listan lo que cambió, separado por comas", () => {
  const clases = (valor: Record<string, unknown>): Instantanea =>
    instantanea({
      clases: { valor: { esperadas: [], excluibles: [], permitidas: {}, ...valor } },
    });

  it("clases esperadas quitadas, excluibles ampliadas y extensiones permitidas nuevas", () => {
    const base = clases({
      esperadas: ["frontend", "backend"],
      excluibles: ["generado", "docs"],
      permitidas: { docs: ["extension:.md"] },
    });
    const pr = clases({
      esperadas: [],
      excluibles: ["generado", "docs", "a", "b"],
      permitidas: {
        docs: ["extension:.md", "extension:.txt", "ruta:LICENSE"],
        nueva: ["ruta:x"],
      },
    });
    const hallazgos = nd.chequearClases(base, pr);
    expect(hallazgos.map((h) => [h.codigo, h.archivo, h.motivo])).toEqual([
      [
        "clases-esperadas-reducidas",
        A.clasificacion,
        "Dejaron de esperarse las clases: frontend, backend. Si quedaran sin rutas, el guardián diría «pasó» sin haber mirado nada de ellas.",
      ],
      [
        "clases-excluibles-ampliadas",
        A.clasificacion,
        "Ahora se pueden excluir del análisis las clases: a, b. Era una decisión cerrada a «generado, docs».",
      ],
      [
        "extensiones-permitidas-ampliadas",
        A.clasificacion,
        "Una clase excluida del análisis ahora admite más tipos de archivo que en la base: docs → extension:.txt, docs → ruta:LICENSE, nueva → ruta:x. Código u otros archivos nuevos podrían quedar fuera del análisis.",
      ],
    ]);
  });

  it("si el PR ya no define lo permitido, el hallazgo es del archivo entero", () => {
    const [h, ...resto] = nd.chequearClases(
      clases({ permitidas: {} }),
      clases({ permitidas: null }),
    );
    expect(resto).toEqual([]);
    expect(h?.codigo).toBe("arbol-ilegible");
    expect(h?.archivo).toBe(A.clasificacion);
    expect(h?.motivo).toBe(
      "La clasificación del PR ya no define PERMITIDO_EN_CLASE_EXCLUIDA, que la base usaba para limitar qué puede haber en las clases excluidas del análisis.",
    );
    expect(h?.donde).toStrictEqual(ubicacion.enArchivo());
  });

  it("si la base todavía no tenía lo permitido, no hay con qué comparar", () => {
    expect(
      nd.chequearClases(
        clases({ permitidas: null }),
        clases({ permitidas: { docs: ["extension:.md"] } }),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// (f) ci.yml
// ---------------------------------------------------------------------------------------------

const PASO_DEL_GUARDIAN = "run: node arquitectura/contratos/guardian.cjs";
/** Un ci.yml con el job guardian (cuerpo dado, desde la línea 3) y el gate, que lo espera. */
const ciConGuardian = (...cuerpo: string[]) =>
  ciLeido(lineas("jobs:", "  guardian:", ...cuerpo, "  gate:", "    needs: [guardian]"));
const conCi = (ci: ReturnType<typeof ciLeido>): Instantanea => instantanea({ ci });
const SIN_GUARDIAN = ciLeido(lineas("jobs:", "  gate:", "    needs: [guardian]"));
const SALTO = "un fallo suyo, o el job entero, se podría saltear.";

describe("(f) el job guardian: lo que la base ya tenía no es un debilitamiento, lo nuevo sí", () => {
  it("si la base no tenía el job, todo continue-on-error del PR es nuevo (también el único)", () => {
    const pr = ciConGuardian(
      "    steps:",
      `      - ${PASO_DEL_GUARDIAN}`,
      "        continue-on-error: true",
    );
    expect(nd.chequearCi(conCi(SIN_GUARDIAN), conCi(pr))).toStrictEqual([
      {
        codigo: "ci-guardian-con-salto",
        archivo: A.ci,
        contrato: null,
        motivo: `El job guardian tiene \`continue-on-error\`, que la base no tenía: ${SALTO}`,
        correccion:
          "Sacá la línea: el guardián tiene que correr siempre y su fallo tiene que frenar el Gate.",
        linea: 5,
      },
    ]);
  });

  it("lo que la base ya tenía (continue-on-error, if del job y if del paso) no se reclama", () => {
    const igual = ciConGuardian(
      "    if: github.event_name == 'pull_request'",
      "    steps:",
      "      - if: always()",
      `        ${PASO_DEL_GUARDIAN}`,
      "        continue-on-error: true",
    );
    expect(nd.chequearCi(conCi(igual), conCi(igual))).toEqual([]);
  });

  it("un continue-on-error más que la base se reclama, solo el que sobra", () => {
    const con = (...extra: string[]) =>
      ciConGuardian(
        "    steps:",
        `      - ${PASO_DEL_GUARDIAN}`,
        "        continue-on-error: true",
        ...extra,
      );
    const hallazgos = nd.chequearCi(conCi(con()), conCi(con("        continue-on-error: true")));
    expect(hallazgos.map((h) => h.linea)).toEqual([6]);
  });

  it("un if del job o del paso que la base no tenía (o tenía distinto) se reclama con su texto y su línea", () => {
    const base = ciConGuardian(
      "    if: W",
      "    steps:",
      "      - if: V",
      `        ${PASO_DEL_GUARDIAN}`,
    );
    const pr = ciConGuardian(
      "    if: X",
      "    steps:",
      "      - if: Y",
      `        ${PASO_DEL_GUARDIAN}`,
    );
    expect(nd.chequearCi(conCi(base), conCi(pr)).map((h) => [h.codigo, h.linea, h.motivo])).toEqual(
      [
        [
          "ci-guardian-con-salto",
          3,
          `El job guardian tiene \`if: X\`, que la base no tenía: ${SALTO}`,
        ],
        [
          "ci-guardian-con-salto",
          5,
          `El job guardian tiene \`if: Y\` en el paso que corre guardian.cjs, que la base no tenía: ${SALTO}`,
        ],
      ],
    );
    // Sin esos if en la base, también.
    const sinIf = ciConGuardian("    steps:", `      - ${PASO_DEL_GUARDIAN}`);
    expect(nd.chequearCi(conCi(sinIf), conCi(pr)).map((h) => h.linea)).toEqual([3, 5]);
  });

  it("quitar un if que la base tenía no es un debilitamiento", () => {
    const base = ciConGuardian(
      "    if: W",
      "    steps:",
      "      - if: V",
      `        ${PASO_DEL_GUARDIAN}`,
    );
    const pr = ciConGuardian("    steps:", `      - ${PASO_DEL_GUARDIAN}`);
    expect(nd.chequearCi(conCi(base), conCi(pr))).toEqual([]);
  });

  it("un continue-on-error de OTRO paso no cuenta, esté en su primera o en su última línea", () => {
    const pr = ciConGuardian(
      "    steps:",
      "      - continue-on-error: true",
      `      - ${PASO_DEL_GUARDIAN}`,
      "      - name: Subir",
      "        uses: x",
      "        continue-on-error: true",
    );
    expect(nd.chequearCi(conCi(SIN_GUARDIAN), conCi(pr))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// (f) evaluar-gate, (g) package.json
// ---------------------------------------------------------------------------------------------

describe("(f) el Gate: se prueba qué hace con un guardián caído", () => {
  const conGuardianCaido = (valor: Record<string, string[]>): Instantanea =>
    instantanea({ gate: { valor: { conGuardianCaido: valor } } });

  it("lista, entre comillas y separados por coma, los resultados que deja pasar", () => {
    const [h, ...resto] = nd.chequearGate(
      instantanea(),
      conGuardianCaido({ failure: ["guardian: failure"] }),
    );
    expect(resto).toEqual([]);
    expect(h).toStrictEqual({
      codigo: "gate-no-exige-guardian",
      archivo: A.evaluarGate,
      contrato: null,
      motivo:
        "evaluarGate deja pasar un guardián «skipped», «cancelled»: ya no lo trata como un job obligatorio.",
      correccion: "Devolvé «guardian» a OBLIGATORIOS en evaluar-gate.cjs.",
      donde: ubicacion.enTexto("const OBLIGATORIOS"),
    });
    expect(
      nd.chequearGate(instantanea(), conGuardianCaido({ failure: ["gate: otro"] }))[0]?.motivo,
    ).toBe(
      "evaluarGate deja pasar un guardián «failure», «skipped», «cancelled»: ya no lo trata como un job obligatorio.",
    );
    expect(nd.chequearGate(instantanea(), instantanea())).toEqual([]);
  });
});

describe("(g) package.json: lo que dicen los scripts se muestra tal cual", () => {
  const scripts = (arquitectura: unknown, guardian: unknown): Instantanea =>
    instantanea({ paquete: { valor: { arquitectura, guardian } } });
  const motivos = (arquitectura: unknown, guardian: unknown): string[] =>
    nd.chequearPaquete(instantanea(), scripts(arquitectura, guardian)).map((h) => h.motivo);

  it("sin scripts dice (null); con texto lo cita entre comillas", () => {
    expect(motivos(undefined, undefined)).toEqual([
      "El script «arquitectura» (null) ya no encadena `&& npm run guardian`: `npm run gate` no correría el guardián.",
      "El script «guardian» (null) ya no ejecuta `node arquitectura/contratos/guardian.cjs`: `npm run guardian` no analizaría nada.",
    ]);
    expect(motivos("echo", "echo ok")).toEqual([
      'El script «arquitectura» ("echo") ya no encadena `&& npm run guardian`: `npm run gate` no correría el guardián.',
      'El script «guardian» ("echo ok") ya no ejecuta `node arquitectura/contratos/guardian.cjs`: `npm run guardian` no analizaría nada.',
    ]);
  });

  it("los espacios de los extremos del script no lo desvían", () => {
    expect(
      motivos("a && npm run guardian", "  node arquitectura/contratos/guardian.cjs  "),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Lectura: qué sección no se pudo leer, de la base o del PR
// ---------------------------------------------------------------------------------------------

type SeccionEsperada = {
  nombre: string;
  archivo: string;
  /** La base la necesita para comparar. */
  enBase: boolean;
  /** Dónde se ubica un problema: un texto concreto, o el archivo entero (línea 1). */
  texto?: string;
  /** «Ausente» no es ilegible. */
  puedeFaltar?: boolean;
};
const SECCIONES: SeccionEsperada[] = [
  { nombre: "registro", archivo: A.registro, enBase: true },
  { nombre: "codigos", archivo: A.codigos, enBase: true },
  { nombre: "clases", archivo: A.clasificacion, enBase: true },
  { nombre: "retiros", archivo: A.retiros, enBase: true },
  { nombre: "plazo", archivo: A.excepciones, enBase: true, texto: "PLAZO_MAXIMO_DIAS" },
  { nombre: "aviso", archivo: A.excepciones, enBase: true, texto: "DIAS_DE_AVISO" },
  { nombre: "gate", archivo: A.evaluarGate, enBase: false },
  { nombre: "ci", archivo: A.ci, enBase: false },
  { nombre: "paquete", archivo: A.paquete, enBase: false },
  { nombre: "invariantes", archivo: A.invariantes, enBase: true, puedeFaltar: true },
];
const ROTURAS: [
  descripcion: string,
  seccion: Record<string, unknown> | undefined,
  motivo: string,
][] = [
  ["con un error", { error: "boom" }, "boom"],
  ["ausente", { ausente: true }, "el archivo no existe"],
  ["sin leer", undefined, "no se leyó"],
];

describe("lectura: lo que no se pudo leer es una falla con su archivo, su lugar y su motivo", () => {
  for (const s of SECCIONES) {
    const donde = s.texto === undefined ? ubicacion.enArchivo() : ubicacion.enTexto(s.texto);
    for (const [descripcion, rota, motivo] of ROTURAS) {
      const sinHallazgo = s.puedeFaltar === true && rota?.["ausente"] === true;

      it(`«${s.nombre}» ${descripcion} en el PR`, () => {
        const pr: Instantanea = { ...instantanea(), [s.nombre]: rota };
        expect(nd.chequearLectura(instantanea(), pr)).toStrictEqual(
          sinHallazgo
            ? []
            : [
                {
                  codigo: "arbol-ilegible",
                  archivo: s.archivo,
                  contrato: null,
                  motivo: `No se pudo leer «${s.nombre}» del árbol del PR: ${motivo}. Sin eso no se puede comprobar que no se debilitó nada.`,
                  correccion:
                    "Dejá el archivo legible y con la forma de siempre, o corregí el error que muestra el motivo.",
                  donde,
                },
              ],
        );
      });

      it(`«${s.nombre}» ${descripcion} en la base`, () => {
        const base: Instantanea = { ...instantanea(), [s.nombre]: rota };
        expect(nd.chequearLectura(base, instantanea())).toStrictEqual(
          sinHallazgo || !s.enBase
            ? []
            : [
                {
                  codigo: "base-ilegible",
                  archivo: s.archivo,
                  contrato: null,
                  motivo: `No se pudo leer «${s.nombre}» de la base: ${motivo}. No hay con qué comparar el PR.`,
                  correccion:
                    "Corregí la base (rama principal) o ejecutá este verificador desde una base sana.",
                  donde,
                },
              ],
        );
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------
// verificar: líneas completas y orden
// ---------------------------------------------------------------------------------------------

describe("verificar: toda falla sale con una línea entera y positiva, y ordenadas", () => {
  const sinArchivos = (): string | null => null;

  it.each([
    [7, 7],
    [1, 1],
    [0, 1],
    [-3, 1],
    [2.5, 1],
    [Number.NaN, 1],
    [undefined, 1],
  ])("una línea %s sale como %s", (dada, esperada) => {
    const pr = instantanea({ plazo: { valor: 90, linea: dada } });
    const { fallas } = nd.verificar({ base: instantanea(), pr, ahora: HOY, leerPr: sinArchivos });
    expect(fallas.map((h) => [h.codigo, h.linea])).toEqual([
      ["tope-de-excepciones-subio", esperada],
    ]);
  });

  it("ordena por archivo y, dentro de un archivo, por línea (aunque los chequeos los den en otro orden)", () => {
    const base = instantanea({
      codigos: { valor: ["a", "b"] },
      clases: { valor: { esperadas: ["x"], excluibles: [], permitidas: {} } },
    });
    const ci = ciLeido(
      lineas(
        "jobs:", //                                                1
        "  gate:", //                                              2
        "    needs: [estatico]", //                                3
        "  guardian:", //                                          4
        "    steps:", //                                           5
        `      - ${PASO_DEL_GUARDIAN}`, //                          6
        "        continue-on-error: true", //                      7
        "        continue-on-error: true", //                      8
      ),
    );
    const pr = instantanea({
      codigos: { valor: ["a"] },
      plazo: { valor: 90, linea: 9 },
      clases: { valor: { esperadas: [], excluibles: [], permitidas: {} } },
      ci,
      paquete: { valor: { arquitectura: "echo", guardian: "echo" } },
    });
    const textos: Record<string, string> = {
      [A.codigos]: "// x\nconst CODIGOS_DE_FALLA = [];\n",
      [A.clasificacion]: "// x\n// y\nconst CLASES_ESPERADAS = [];\n",
      [A.paquete]: lineas(
        "{",
        '  "scripts": {',
        '    "arquitectura": "echo",',
        '    "guardian": "echo"',
        "  }",
        "}",
      ),
    };
    const { fallas } = nd.verificar({
      base,
      pr,
      ahora: HOY,
      leerPr: (ruta) => textos[ruta] ?? null,
    });
    expect(fallas.map((h) => [h.archivo, h.linea, h.codigo])).toEqual([
      [A.ci, 3, "ci-gate-no-espera-guardian"],
      [A.ci, 7, "ci-guardian-con-salto"],
      [A.ci, 8, "ci-guardian-con-salto"],
      [A.clasificacion, 3, "clases-esperadas-reducidas"],
      [A.codigos, 2, "chequeo-borrado"],
      [A.excepciones, 9, "tope-de-excepciones-subio"],
      [A.paquete, 3, "script-arquitectura-desviado"],
      [A.paquete, 4, "script-guardian-desviado"],
    ]);
  });

  it("el aviso de «la base no trae la matriz» sale con su texto y en la línea 1, y solo si está ausente", () => {
    const { fallas, avisos } = nd.verificar({
      base: instantanea({ invariantes: { ausente: true } }),
      pr: instantanea(),
      ahora: HOY,
      leerPr: sinArchivos,
    });
    expect(fallas).toEqual([]);
    expect(avisos).toStrictEqual([
      {
        codigo: "invariantes-sin-base",
        archivo: A.invariantes,
        contrato: null,
        motivo:
          "La base no trae la matriz de invariantes (invariantes.cjs): se saltea el chequeo (h). Es esperable solo hasta que la matriz entre a la rama principal.",
        correccion: "Nada por ahora; cuando la base la tenga, el chequeo (h) se activa solo.",
        linea: 1,
      },
    ]);
    // Una base que ni siquiera informó la sección no es una base «sin matriz»: eso es ilegible, no un aviso.
    const sinInformar = nd.verificar({
      base: instantanea({ invariantes: undefined }),
      pr: instantanea(),
      ahora: HOY,
      leerPr: sinArchivos,
    });
    expect(sinInformar.avisos).toEqual([]);
    expect(sinInformar.fallas.map((h) => h.codigo)).toEqual(["base-ilegible"]);
  });
});
