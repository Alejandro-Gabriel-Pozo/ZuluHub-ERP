import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * Comportamiento exacto de `evasiones.cjs` (catálogo de la batería de evasión): qué se acepta, qué se rechaza
 * y con qué código, en qué clave del JSON y con qué texto, cada fecha límite (plazos, vencimientos y avisos)
 * y la evaluación de un caso contra lo que pasó al correrlo. Cada decisión tiene su caso, con los bordes:
 * si una condición cambia (un `<` por un `<=`, un campo que deja de exigirse) falla alguno de estos.
 */

type Hallazgo = {
  codigo: string;
  archivo: string;
  contrato: string | null;
  motivo: string;
  correccion: string;
  donde: unknown;
};
type Caso = Record<string, unknown>;
type Observado = {
  resultado: string;
  fallas: { codigo: string; archivo: string; linea?: number }[];
};

const require = createRequire(import.meta.url);
const evasiones = require("../../arquitectura/contratos/evasiones.cjs") as {
  ARCHIVO_DEL_CATALOGO: string;
  VIAS: string[];
  ESTADOS: string[];
  SEVERIDADES: string[];
  PLANTILLAS: string[];
  OPERACIONES: string[];
  PLAZO_DE_BRECHA: number;
  PLAZO_DE_RIESGO: number;
  DIAS_DE_AVISO_DE_BRECHA: number;
  DIAS_DE_AVISO_DE_RIESGO: number;
  validarCatalogo: (
    catalogo: unknown,
    contexto: { ahora: Date },
  ) => { fallas: Hallazgo[]; avisos: Hallazgo[] };
  evaluarResultado: (caso: Caso, indice: number, observado: Observado) => Hallazgo | null;
};
const { enJson } = require("../../arquitectura/contratos/ubicacion.cjs") as {
  enJson: (...camino: (string | number)[]) => unknown;
};

const ARCHIVO = "arquitectura/contratos/evasiones.json";
const HOY = new Date("2026-10-21T12:00:00Z");

const exigido = (cambios: Caso = {}): Caso => ({
  id: "EV-001",
  via: "filtros",
  titulo: "Carpeta nueva sin regla",
  construccion: [{ op: "escribir", ruta: "x.ts", contenido: "" }],
  controlEsperado: "clasificacion.cjs",
  esperado: { tipo: "bloquea", codigo: "ruta-sin-clase", archivo: "x.ts", linea: 1 },
  estado: "exigido",
  ...cambios,
});
const brecha = (cambios: Caso = {}): Caso =>
  exigido({
    estado: "brecha-abierta",
    responsable: "agente (a pedido del dueño)",
    severidad: "alta",
    justificacion: "Pasa sin detección.",
    mitigacion: "Revisión manual.",
    creada: "2026-10-01",
    vence: "2026-11-30",
    ...cambios,
  });
const riesgo = (cambios: Caso = {}): Caso =>
  exigido({
    estado: "riesgo-aceptado",
    aprobadoPor: "Dueño del producto (§11.1)",
    motivo: "Exige editar la maquinaria.",
    creada: "2026-10-01",
    revisar: "2027-03-01",
    ...cambios,
  });

const validar = (catalogo: unknown, ahora: Date = HOY) =>
  evasiones.validarCatalogo(catalogo, { ahora });
/** Una falla esperada: el código, la clave del JSON y un fragmento del motivo y de la corrección. */
const falla = (
  codigo: string,
  indice: number,
  campo: string | undefined,
  motivo: string,
  correccion: string,
): unknown => ({
  codigo,
  archivo: ARCHIVO,
  contrato: null,
  motivo: expect.stringContaining(motivo) as unknown,
  correccion: expect.stringContaining(correccion) as unknown,
  donde: campo === undefined ? enJson(indice) : enJson(indice, campo),
});
const invalida = (indice: number, campo: string | undefined, motivo: string, correccion: string) =>
  falla("evasion-invalida", indice, campo, motivo, correccion);
const codigosDe = (catalogo: unknown, ahora: Date = HOY): string[] =>
  validar(catalogo, ahora).fallas.map((f) => f.codigo);

describe("las constantes del catálogo", () => {
  it("son exactamente estas", () => {
    expect(evasiones.ARCHIVO_DEL_CATALOGO).toBe(ARCHIVO);
    expect(evasiones.VIAS).toEqual([
      "workflow-ci",
      "filtros",
      "exclusiones",
      "renombrar-mover",
      "formato-no-soportado",
      "declaraciones-excepciones",
      "modificar-guardian",
      "ruta-alternativa",
      "no-se-pudo-interpretar",
    ]);
    expect(evasiones.ESTADOS).toEqual(["exigido", "brecha-abierta", "riesgo-aceptado"]);
    expect(evasiones.SEVERIDADES).toEqual(["baja", "media", "alta", "critica"]);
    expect(evasiones.PLANTILLAS).toEqual(["sano", "con-contrato", "con-contrato-y-pruebas"]);
    expect(evasiones.OPERACIONES).toEqual([
      "escribir",
      "reemplazar",
      "borrar",
      "renombrar",
      "symlink",
      "anexar",
      "json-poner",
      "json-agregar",
      "commit",
      "checkout",
    ]);
    expect([
      evasiones.PLAZO_DE_BRECHA,
      evasiones.DIAS_DE_AVISO_DE_BRECHA,
      evasiones.PLAZO_DE_RIESGO,
      evasiones.DIAS_DE_AVISO_DE_RIESGO,
    ]).toEqual([60, 14, 180, 30]);
  });

  it("las listas están congeladas: nadie las cambia en caliente", () => {
    for (const lista of [
      evasiones.VIAS,
      evasiones.ESTADOS,
      evasiones.SEVERIDADES,
      evasiones.PLANTILLAS,
      evasiones.OPERACIONES,
    ]) {
      expect(Object.isFrozen(lista)).toBe(true);
    }
  });
});

describe("validarCatalogo: la forma del catálogo y de cada caso", () => {
  it.each([
    ["un objeto", { casos: [] }],
    ["null", null],
    ["un texto", "[]"],
    ["un número", 3],
  ])("si el catálogo es %s y no una lista, falla una sola vez en la raíz", (_nombre, catalogo) => {
    expect(validar(catalogo)).toStrictEqual({
      fallas: [
        {
          codigo: "evasion-invalida",
          archivo: ARCHIVO,
          contrato: null,
          motivo: "El catálogo de evasión tiene que ser una lista de casos.",
          correccion: "Dejalo como una lista JSON de casos.",
          donde: enJson(),
        },
      ],
      avisos: [],
    });
  });

  it("un catálogo vacío es válido y no avisa nada", () => {
    expect(validar([])).toStrictEqual({ fallas: [], avisos: [] });
  });

  it("un caso exigido válido no falla ni avisa; una brecha y un riesgo válidos solo avisan o callan", () => {
    expect(validar([exigido()])).toStrictEqual({ fallas: [], avisos: [] });
    const conTodo = validar([exigido(), brecha({ id: "EV-002" }), riesgo({ id: "EV-003" })]);
    expect(conTodo.fallas).toEqual([]);
    expect(conTodo.avisos.map((a) => a.codigo)).toEqual(["brecha-abierta"]);
  });

  it("los campos opcionales válidos (plantilla, construccionBase, reloj, sinGit) se aceptan", () => {
    for (const plantilla of evasiones.PLANTILLAS) {
      expect(codigosDe([exigido({ plantilla })]), plantilla).toEqual([]);
    }
    const completo = exigido({
      construccionBase: [{ op: "commit" }],
      reloj: 165,
      sinGit: true,
      plantilla: "con-contrato",
    });
    expect(codigosDe([completo])).toEqual([]);
    expect(codigosDe([exigido({ reloj: 0, sinGit: false, construccionBase: [] })])).toEqual([]);
    expect(codigosDe([exigido({ construccion: [] })])).toEqual([]);
  });

  it.each([[5], [null], [[]], ["texto"]])(
    "un caso que no es un objeto (%j) falla en su entrada",
    (caso) => {
      expect(validar([exigido(), caso]).fallas).toStrictEqual([
        invalida(1, undefined, "El caso no es un objeto.", "objeto JSON"),
      ]);
    },
  );

  it.each([["tal vez"], [undefined], [5], [null]])(
    "un estado que no es uno de los tres (%j) es el único problema del caso, en la clave «estado»",
    (estado) => {
      expect(validar([exigido({ estado, via: "no-existe" })]).fallas).toStrictEqual([
        invalida(
          0,
          "estado",
          "no es uno de exigido, brecha-abierta, riesgo-aceptado",
          "«exigido», «brecha-abierta» o «riesgo-aceptado»",
        ),
      ]);
    },
  );

  it("el motivo del estado inválido nombra el valor que no vale", () => {
    expect(validar([exigido({ estado: "tal vez" })]).fallas[0]?.motivo).toContain("«tal vez»");
    expect(validar([exigido({ estado: undefined })]).fallas[0]?.motivo).toContain("«undefined»");
  });

  it.each([["EV-1"], ["ev-001"], ["EV-0001"], ["XEV-001"], ["EV-001x"], [""], [undefined], [1]])(
    "un id que no tiene la forma EV-000 (%j) falla en la clave «id»",
    (id) => {
      expect(validar([exigido({ id })]).fallas).toStrictEqual([
        invalida(0, "id", "El id no tiene la forma EV-000.", "Usá EV- y tres dígitos."),
      ]);
    },
  );

  it("una vía que no está en la lista falla en la clave «via» y dice cuáles hay", () => {
    expect(validar([exigido({ via: "otra" })]).fallas).toStrictEqual([
      invalida(0, "via", "La vía («otra»)", "workflow-ci, filtros, exclusiones"),
    ]);
    expect(codigosDe([exigido({ via: undefined })])).toEqual(["evasion-invalida"]);
    for (const via of evasiones.VIAS) expect(codigosDe([exigido({ via })]), via).toEqual([]);
  });

  it.each([["titulo"], ["controlEsperado"]])(
    "el campo %s falta, está vacío, tiene solo espacios o no es texto",
    (campo) => {
      for (const valor of [undefined, "", "   ", 7]) {
        expect(validar([exigido({ [campo]: valor })]).fallas, String(valor)).toStrictEqual([
          invalida(
            0,
            campo,
            `El campo «${campo}» falta o está vacío.`,
            `Todo caso dice su «${campo}».`,
          ),
        ]);
      }
    },
  );

  it.each([["construccion"], ["construccionBase"]])(
    "%s tiene que ser una lista de operaciones que son objetos",
    (campo) => {
      for (const valor of ["x", { op: "commit" }, null, [1], [null], [[]]]) {
        expect(validar([exigido({ [campo]: valor })]).fallas, JSON.stringify(valor)).toStrictEqual([
          invalida(
            0,
            campo,
            `«${campo}» tiene que ser una lista de operaciones (objetos).`,
            "vacía si el caso no cambia nada",
          ),
        ]);
      }
    },
  );

  it.each([["construccion"], ["construccionBase"]])(
    "una operación desconocida en %s se nombra, una por una, con la lista de las que valen",
    (campo) => {
      const malas = [{ op: "inventada" }, { op: "commit" }, { sinOp: 1 }];
      expect(validar([exigido({ [campo]: malas })]).fallas).toStrictEqual([
        invalida(
          0,
          campo,
          `«${campo}» trae una operación desconocida («inventada»).`,
          "escribir, reemplazar, borrar",
        ),
        invalida(
          0,
          campo,
          `«${campo}» trae una operación desconocida («undefined»).`,
          "json-agregar, commit, checkout",
        ),
      ]);
    },
  );

  it("cada operación conocida se acepta", () => {
    for (const op of evasiones.OPERACIONES) {
      expect(codigosDe([exigido({ construccion: [{ op }] })]), op).toEqual([]);
    }
  });

  it("una plantilla que no existe falla en «plantilla» y dice cuáles hay", () => {
    for (const plantilla of ["otra", 5, null]) {
      expect(validar([exigido({ plantilla })]).fallas, String(plantilla)).toStrictEqual([
        invalida(
          0,
          "plantilla",
          `La plantilla («${String(plantilla)}») no existe.`,
          "sano, con-contrato, con-contrato-y-pruebas",
        ),
      ]);
    }
  });

  it("«reloj» es un entero de días desde 0", () => {
    for (const reloj of [-1, 1.5, "3", null, NaN]) {
      expect(validar([exigido({ reloj })]).fallas, String(reloj)).toStrictEqual([
        invalida(
          0,
          "reloj",
          "«reloj» tiene que ser un entero de días desde 0.",
          "Poné los días que se adelanta.",
        ),
      ]);
    }
    for (const reloj of [0, 1, 165])
      expect(codigosDe([exigido({ reloj })]), String(reloj)).toEqual([]);
  });

  it("«sinGit» es verdadero o falso", () => {
    for (const sinGit of ["si", 1, null, 0]) {
      expect(validar([exigido({ sinGit })]).fallas, String(sinGit)).toStrictEqual([
        invalida(0, "sinGit", "«sinGit» tiene que ser verdadero o falso.", "Poné true o false."),
      ]);
    }
    for (const sinGit of [true, false]) expect(codigosDe([exigido({ sinGit })])).toEqual([]);
  });

  it("todos los problemas de un caso salen juntos y en el orden de los campos", () => {
    const roto = {
      id: "x",
      via: "y",
      titulo: "",
      controlEsperado: "",
      construccion: "z",
      construccionBase: "w",
      plantilla: "p",
      reloj: -1,
      sinGit: "s",
      esperado: 1,
      estado: "exigido",
    };
    const campos = validar([roto]).fallas.map((f) => (f.donde as { camino: unknown[] }).camino);
    expect(campos).toEqual([
      [0, "id"],
      [0, "via"],
      [0, "titulo"],
      [0, "controlEsperado"],
      [0, "construccion"],
      [0, "construccionBase"],
      [0, "plantilla"],
      [0, "reloj"],
      [0, "sinGit"],
      [0, "esperado"],
    ]);
  });
});

describe("validarCatalogo: lo esperado (`esperado`)", () => {
  it.each([
    [undefined],
    [null],
    ["bloquea"],
    [[]],
    [{}],
    [{ tipo: "nada" }],
    [{ tipo: undefined }],
  ])("si «esperado» es %j falla una sola vez, en «esperado», con ejemplos", (esperado) => {
    expect(validar([exigido({ esperado })]).fallas).toStrictEqual([
      invalida(
        0,
        "esperado",
        "«esperado» tiene que ser un objeto con «tipo» bloquea o exige-excepcion.",
        '"tipo": "exige-excepcion"',
      ),
    ]);
  });

  it("un esperado de tipo exige-excepcion no lleva nada más", () => {
    expect(codigosDe([exigido({ esperado: { tipo: "exige-excepcion" } })])).toEqual([]);
    expect(
      validar([exigido({ esperado: { tipo: "exige-excepcion", codigo: "x" } })]).fallas,
    ).toStrictEqual([
      invalida(
        0,
        "esperado",
        "«esperado» trae «codigo», que no corresponde al tipo «exige-excepcion».",
        "Dejá en «esperado» solo: tipo.",
      ),
    ]);
  });

  it("un esperado de tipo bloquea acepta código y archivo, con o sin línea, y nada más", () => {
    const base = { tipo: "bloquea", codigo: "ruta-sin-clase", archivo: "x.ts" };
    expect(codigosDe([exigido({ esperado: base })])).toEqual([]);
    expect(codigosDe([exigido({ esperado: { ...base, linea: 1 } })])).toEqual([]);
    expect(codigosDe([exigido({ esperado: { ...base, linea: 220003 } })])).toEqual([]);
    expect(validar([exigido({ esperado: { ...base, nota: "x" } })]).fallas).toStrictEqual([
      invalida(
        0,
        "esperado",
        "«esperado» trae «nota», que no corresponde al tipo «bloquea».",
        "Dejá en «esperado» solo: tipo, codigo, archivo, linea.",
      ),
    ]);
  });

  it.each([["codigo"], ["archivo"]])(
    "un esperado de tipo bloquea sin %s (ausente, vacío o no texto) falla",
    (campo) => {
      const base = { tipo: "bloquea", codigo: "c", archivo: "a.ts" };
      for (const valor of [undefined, "", "  ", 3]) {
        expect(
          validar([exigido({ esperado: { ...base, [campo]: valor } })]).fallas,
          String(valor),
        ).toStrictEqual([
          invalida(
            0,
            "esperado",
            `«esperado» de tipo «bloquea» no tiene «${campo}» (falta o está vacío).`,
            `Decí qué ${campo} tiene que tener la falla`,
          ),
        ]);
      }
    },
  );

  it("la línea esperada es un entero desde 1: 0, negativa, decimal o texto fallan", () => {
    const base = { tipo: "bloquea", codigo: "c", archivo: "a.ts" };
    for (const linea of [0, -1, 1.5, "1", null]) {
      expect(
        validar([exigido({ esperado: { ...base, linea } })]).fallas,
        String(linea),
      ).toStrictEqual([
        invalida(
          0,
          "esperado",
          "«esperado.linea» tiene que ser un entero desde 1 (o no estar).",
          "sacá «linea»",
        ),
      ]);
    }
  });

  it("una línea con los dos problemas (campo sobrante y línea inválida) los da juntos", () => {
    const esperado = { tipo: "bloquea", codigo: "c", archivo: "a.ts", linea: 0 };
    expect(validar([exigido({ esperado: { ...esperado, otra: 1 } })]).fallas).toHaveLength(2);
  });
});

describe("validarCatalogo: los campos de cada estado", () => {
  it("un caso exigido no admite campos de brecha ni de riesgo, y dice que no lleva ninguno", () => {
    for (const campo of [
      "responsable",
      "severidad",
      "justificacion",
      "mitigacion",
      "creada",
      "vence",
      "aprobadoPor",
      "motivo",
      "revisar",
      "otro",
    ]) {
      expect(validar([exigido({ [campo]: "x" })]).fallas, campo).toStrictEqual([
        invalida(
          0,
          campo,
          `«${campo}» no es un campo permitido en un caso «exigido».`,
          "solo estos campos propios: ninguno",
        ),
      ]);
    }
  });

  it("una brecha no admite campos de riesgo (ni sobrantes); un riesgo, tampoco los de brecha", () => {
    expect(validar([brecha({ aprobadoPor: "x" })]).fallas).toStrictEqual([
      invalida(
        0,
        "aprobadoPor",
        "«aprobadoPor» no es un campo permitido en un caso «brecha-abierta».",
        "responsable, severidad, justificacion, mitigacion, creada, vence",
      ),
    ]);
    expect(validar([riesgo({ severidad: "alta" })]).fallas).toStrictEqual([
      invalida(
        0,
        "severidad",
        "«severidad» no es un campo permitido en un caso «riesgo-aceptado».",
        "aprobadoPor, motivo, creada, revisar",
      ),
    ]);
    expect(codigosDe([brecha({ revisar: "2027-01-01" })])).toEqual(["evasion-invalida"]);
    expect(codigosDe([riesgo({ vence: "2026-12-01" })])).toEqual(["evasion-invalida"]);
  });

  it("los campos comunes y opcionales no cuentan como sobrantes en ningún estado", () => {
    for (const hacer of [exigido, brecha, riesgo]) {
      expect(
        codigosDe([hacer({ plantilla: "sano", reloj: 5, sinGit: true, construccionBase: [] })]),
      ).toEqual([]);
    }
  });

  it("cada campo propio de la brecha es obligatorio, no puede estar vacío ni ser solo espacios", () => {
    for (const campo of ["responsable", "justificacion", "mitigacion"]) {
      for (const valor of [undefined, "", "  "]) {
        expect(
          validar([brecha({ [campo]: valor })]).fallas,
          `${campo}=${String(valor)}`,
        ).toStrictEqual([
          invalida(
            0,
            campo,
            `El campo «${campo}» falta o está vacío.`,
            `Un caso «brecha-abierta» lleva «${campo}».`,
          ),
        ]);
      }
    }
  });

  it("cada campo propio del riesgo es obligatorio", () => {
    for (const campo of ["aprobadoPor", "motivo"]) {
      for (const valor of [undefined, "", "  "]) {
        expect(
          validar([riesgo({ [campo]: valor })]).fallas,
          `${campo}=${String(valor)}`,
        ).toStrictEqual([
          invalida(
            0,
            campo,
            `El campo «${campo}» falta o está vacío.`,
            `Un caso «riesgo-aceptado» lleva «${campo}».`,
          ),
        ]);
      }
    }
  });

  it("las fechas ausentes también son campos faltantes (y no se revisan como fechas)", () => {
    expect(validar([brecha({ creada: undefined })]).fallas).toStrictEqual([
      invalida(0, "creada", "El campo «creada» falta o está vacío.", "lleva «creada»"),
    ]);
    expect(validar([brecha({ vence: undefined })]).fallas).toStrictEqual([
      invalida(0, "vence", "El campo «vence» falta o está vacío.", "lleva «vence»"),
    ]);
    expect(validar([riesgo({ revisar: undefined })]).fallas).toStrictEqual([
      invalida(0, "revisar", "El campo «revisar» falta o está vacío.", "lleva «revisar»"),
    ]);
  });

  it("la severidad es una de las cuatro, y el motivo nombra la que no vale", () => {
    for (const severidad of evasiones.SEVERIDADES) {
      expect(codigosDe([brecha({ severidad })]), severidad).toEqual([]);
    }
    expect(validar([brecha({ severidad: "grave" })]).fallas).toStrictEqual([
      invalida(
        0,
        "severidad",
        "La severidad («grave») no es una de baja, media, alta, critica.",
        "Elegí una severidad: baja, media, alta, critica.",
      ),
    ]);
    // sin severidad: falta el campo, y la severidad tampoco vale
    expect(codigosDe([brecha({ severidad: undefined })])).toEqual([
      "evasion-invalida",
      "evasion-invalida",
    ]);
    // el riesgo no tiene severidad
    expect(codigosDe([riesgo()])).toEqual([]);
  });
});

describe("validarCatalogo: ids repetidos", () => {
  it("el segundo caso con el mismo id falla en su «id»; el primero no", () => {
    expect(validar([exigido(), exigido({ titulo: "otro" })]).fallas).toStrictEqual([
      invalida(
        1,
        "id",
        "El id EV-001 está repetido en el catálogo.",
        "Cada caso lleva un id propio.",
      ),
    ]);
  });

  it("tres con el mismo id dan dos fallas; ids distintos no dan ninguna", () => {
    expect(codigosDe([exigido(), exigido(), exigido()])).toEqual([
      "evasion-invalida",
      "evasion-invalida",
    ]);
    expect(codigosDe([exigido(), exigido({ id: "EV-002" }), exigido({ id: "EV-003" })])).toEqual(
      [],
    );
  });

  it("los casos sin id (vacío o ausente) o que no son objetos no cuentan como repetidos entre sí", () => {
    const sinId = [exigido({ id: "" }), exigido({ id: "" })];
    expect(validar(sinId).fallas.map((f) => (f.donde as { camino: unknown[] }).camino)).toEqual([
      [0, "id"],
      [1, "id"],
    ]);
    const ausentes = [exigido({ id: undefined }), exigido({ id: undefined }), 5, 5];
    expect(validar(ausentes).fallas).toHaveLength(4);
    expect(validar(ausentes).fallas.some((f) => f.motivo.includes("repetido"))).toBe(false);
  });

  it("un id repetido con un caso inválido en el medio igual se detecta", () => {
    const fallas = validar([exigido(), 5, exigido()]).fallas;
    expect(fallas.map((f) => (f.donde as { camino: unknown[] }).camino)).toEqual([[1], [2, "id"]]);
  });
});

describe("validarCatalogo: las fechas de una brecha", () => {
  const fechas = (cambios: Caso, ahora: Date = HOY) => validar([brecha(cambios)], ahora);

  it.each([["creada"], ["vence"]])(
    "%s con una fecha que no existe o mal escrita falla en esa clave",
    (campo) => {
      for (const valor of ["2026-13-45", "ayer", "2026-2-3", "2026-02-30", "2026-10-21T10:00"]) {
        expect(fechas({ [campo]: valor }).fallas, `${campo}=${valor}`).toStrictEqual([
          invalida(
            0,
            campo,
            `«${campo}» («${valor}») no es una fecha válida AAAA-MM-DD.`,
            "fecha real con el formato AAAA-MM-DD",
          ),
        ]);
      }
    },
  );

  it("una fecha mal escrita no dispara además los chequeos de orden, plazo y vencimiento", () => {
    expect(fechas({ vence: "mañana" }).avisos).toEqual([]);
    expect(codigosDe([brecha({ creada: "ayer" })])).toEqual(["evasion-invalida"]);
    // con la creada rota, no hay plazo que medir aunque el vencimiento esté lejos
    expect(fechas({ creada: "ayer", vence: "2027-12-31" }).fallas.map((f) => f.codigo)).toEqual([
      "evasion-invalida",
    ]);
  });

  it("«creada» no puede ser futura; hoy y ayer sí", () => {
    expect(fechas({ creada: "2026-10-22", vence: "2026-12-01" }).fallas).toStrictEqual([
      invalida(
        0,
        "creada",
        "«creada» (2026-10-22) es posterior a hoy (2026-10-21).",
        "no una futura",
      ),
    ]);
    expect(fechas({ creada: "2026-10-21", vence: "2026-12-01" }).fallas).toEqual([]);
    expect(fechas({ creada: "2026-10-20", vence: "2026-12-01" }).fallas).toEqual([]);
  });

  it("«vence» no puede ser anterior a «creada» (y, como creada no es futura, además ya venció); el mismo día vale", () => {
    expect(fechas({ creada: "2026-10-10", vence: "2026-10-09" }).fallas).toStrictEqual([
      invalida(
        0,
        "vence",
        "«vence» (2026-10-09) es anterior a «creada» (2026-10-10).",
        "igual o posterior a «creada»",
      ),
      falla("brecha-vencida", 0, "vence", "la brecha venció el 2026-10-09", "Cerrala"),
    ]);
    expect(fechas({ creada: "2026-10-21", vence: "2026-10-21" }).fallas).toEqual([]);
  });

  it("el plazo máximo es de 60 días: 60 vale y 61 falla, con los días en el motivo", () => {
    expect(fechas({ creada: "2026-10-01", vence: "2026-11-30" }).fallas).toEqual([]);
    expect(fechas({ creada: "2026-10-01", vence: "2026-12-01" }).fallas).toStrictEqual([
      falla(
        "brecha-plazo-excesivo",
        0,
        "vence",
        "«vence» está a 61 días de «creada» (de 2026-10-01 a 2026-12-01) y el máximo es 60.",
        "como mucho 60 días desde «creada». No se extiende",
      ),
    ]);
    expect(
      fechas({ creada: "2026-08-01", vence: "2026-12-01" }).fallas.map((f) => f.codigo),
    ).toEqual(["brecha-plazo-excesivo"]);
  });

  it("vencida: el día siguiente al «vence» falla; el mismo día todavía no", () => {
    expect(fechas({ vence: "2026-10-20" }).fallas).toStrictEqual([
      falla(
        "brecha-vencida",
        0,
        "vence",
        "la brecha venció el 2026-10-20 (hoy es 2026-10-21).",
        "Cerrala (pasá el caso a «exigido»",
      ),
    ]);
    expect(fechas({ vence: "2026-10-21" }).fallas).toEqual([]);
    expect(fechas({ vence: "2026-10-20" }).avisos).toEqual([]);
  });

  it("el reloj es el que se le pasa: la misma brecha vence con otro «ahora»", () => {
    const ultimoDia = fechas({}, new Date("2026-11-30T23:59:59Z"));
    expect(ultimoDia.fallas).toEqual([]);
    expect(ultimoDia.avisos.map((a) => a.codigo)).toEqual(["brecha-por-vencer"]);
    const alDiaSiguiente = fechas({}, new Date("2026-12-01T00:00:00Z"));
    expect(alDiaSiguiente.fallas.map((f) => f.codigo)).toEqual(["brecha-vencida"]);
    expect(alDiaSiguiente.avisos).toEqual([]);
  });

  it("se reporta en cada corrida: con más de 14 días es «brecha-abierta», con 14 o menos «brecha-por-vencer»", () => {
    expect(fechas({ vence: "2026-11-05" }).avisos.map((a) => a.codigo)).toEqual(["brecha-abierta"]); // 15 días
    expect(fechas({ vence: "2026-11-04" }).avisos.map((a) => a.codigo)).toEqual([
      "brecha-por-vencer",
    ]); // 14
    expect(fechas({ vence: "2026-10-22" }).avisos.map((a) => a.codigo)).toEqual([
      "brecha-por-vencer",
    ]); // 1
    expect(fechas({ vence: "2026-10-21" }).avisos.map((a) => a.codigo)).toEqual([
      "brecha-por-vencer",
    ]); // hoy
    expect(fechas({ vence: "2026-11-30" }).avisos.map((a) => a.codigo)).toEqual(["brecha-abierta"]); // 40
  });

  it("el aviso trae el id, la severidad, el responsable, los días que faltan y está en la clave «vence»", () => {
    expect(fechas({ vence: "2026-11-04" }).avisos).toStrictEqual([
      {
        codigo: "brecha-por-vencer",
        archivo: ARCHIVO,
        contrato: null,
        motivo:
          "EV-001 («Carpeta nueva sin regla»): brecha abierta de severidad alta, vence el 2026-11-04 (responsable: agente (a pedido del dueño)); faltan 14 días (hoy es 2026-10-21).",
        correccion:
          "Cerrala antes de que venza: pasá el caso a «exigido» cuando el guardián lo bloquee.",
        donde: enJson(0, "vence"),
      },
    ]);
  });

  it("una brecha con el plazo excedido además se reporta (la falla y el aviso son independientes)", () => {
    const r = fechas({ creada: "2026-08-01", vence: "2026-12-01" });
    expect(r.fallas.map((f) => f.codigo)).toEqual(["brecha-plazo-excesivo"]);
    expect(r.avisos.map((a) => a.codigo)).toEqual(["brecha-abierta"]);
  });

  it("el índice del caso ubica la falla y el aviso en su entrada", () => {
    const r = validar([
      exigido(),
      brecha({ id: "EV-002", vence: "2026-10-20" }),
      brecha({ id: "EV-003" }),
    ]);
    expect(r.fallas.map((f) => f.donde)).toEqual([enJson(1, "vence")]);
    expect(r.avisos.map((a) => a.donde)).toEqual([enJson(2, "vence")]);
  });

  it("un caso exigido con fechas no se revisa como brecha: solo falla por tener campos que no le tocan", () => {
    const r = validar([exigido({ creada: "2026-10-01", vence: "2026-10-02" })]);
    expect(r.fallas.map((f) => f.codigo)).toEqual(["evasion-invalida", "evasion-invalida"]);
    expect(r.avisos).toEqual([]);
  });
});

describe("validarCatalogo: las fechas de un riesgo aceptado", () => {
  const fechas = (cambios: Caso, ahora: Date = HOY) => validar([riesgo(cambios)], ahora);

  it.each([["creada"], ["revisar"]])("%s con una fecha mal escrita falla en esa clave", (campo) => {
    expect(fechas({ [campo]: "2026-13-45" }).fallas).toStrictEqual([
      invalida(
        0,
        campo,
        `«${campo}» («2026-13-45») no es una fecha válida AAAA-MM-DD.`,
        "AAAA-MM-DD",
      ),
    ]);
  });

  it("«creada» no puede ser futura", () => {
    expect(fechas({ creada: "2026-10-22", revisar: "2027-01-01" }).fallas).toStrictEqual([
      invalida(
        0,
        "creada",
        "«creada» (2026-10-22) es posterior a hoy (2026-10-21).",
        "no una futura",
      ),
    ]);
  });

  it("«revisar» no puede ser anterior a «creada» (y, como creada no es futura, además ya pasó)", () => {
    expect(fechas({ creada: "2026-10-10", revisar: "2026-10-09" }).fallas).toStrictEqual([
      invalida(
        0,
        "revisar",
        "«revisar» (2026-10-09) es anterior a «creada» (2026-10-10).",
        "igual o posterior a «creada»",
      ),
      falla("riesgo-vencido", 0, "revisar", "era el 2026-10-09", "volver a decidir"),
    ]);
  });

  it("el plazo máximo es de 180 días: 180 vale y 181 falla", () => {
    expect(fechas({ creada: "2026-10-01", revisar: "2027-03-30" }).fallas).toEqual([]);
    expect(fechas({ creada: "2026-10-01", revisar: "2027-03-31" }).fallas).toStrictEqual([
      falla(
        "riesgo-plazo-excesivo",
        0,
        "revisar",
        "«revisar» está a 181 días de «creada» (de 2026-10-01 a 2027-03-31) y el máximo es 180.",
        "como mucho 180 días desde «creada»",
      ),
    ]);
  });

  it("pasada la fecha de revisión falla; el mismo día todavía no", () => {
    expect(fechas({ revisar: "2026-10-20" }).fallas).toStrictEqual([
      falla(
        "riesgo-vencido",
        0,
        "revisar",
        "la revisión del riesgo aceptado era el 2026-10-20 (hoy es 2026-10-21).",
        "El dueño tiene que volver a decidir",
      ),
    ]);
    expect(fechas({ revisar: "2026-10-21" }).fallas).toEqual([]);
  });

  it("solo avisa desde 30 días antes: 30 avisa, 31 no; vencido no avisa", () => {
    expect(fechas({ revisar: "2026-11-20" }).avisos.map((a) => a.codigo)).toEqual([
      "riesgo-por-revisar",
    ]); // 30
    expect(fechas({ revisar: "2026-11-21" }).avisos).toEqual([]); // 31
    expect(fechas({ revisar: "2026-10-21" }).avisos.map((a) => a.codigo)).toEqual([
      "riesgo-por-revisar",
    ]); // hoy
    expect(fechas({ revisar: "2026-10-20" }).avisos).toEqual([]);
    expect(fechas({}).avisos).toEqual([]);
  });

  it("el aviso trae el id, quién lo aprobó y los días que faltan, en la clave «revisar»", () => {
    expect(fechas({ revisar: "2026-11-20" }).avisos).toStrictEqual([
      {
        codigo: "riesgo-por-revisar",
        archivo: ARCHIVO,
        contrato: null,
        motivo:
          "EV-001 («Carpeta nueva sin regla»): riesgo aceptado por Dueño del producto (§11.1), a revisar el 2026-11-20; faltan 30 días (hoy es 2026-10-21).",
        correccion:
          "Revisalo con el dueño antes de la fecha: vuelve a decidirse o se cierra el hueco.",
        donde: enJson(0, "revisar"),
      },
    ]);
  });
});

describe("evaluarResultado: lo que pasó al correr el caso contra lo que su estado exige", () => {
  const pasa: Observado = { resultado: "pasa", fallas: [] };
  const bloqueaCon = (...fallas: Observado["fallas"]): Observado => ({
    resultado: "bloquea",
    fallas,
  });
  const LA_ESPERADA = { codigo: "ruta-sin-clase", archivo: "x.ts", linea: 1 };

  it("un caso exigido que se bloquea como dice «esperado» está en regla", () => {
    expect(evasiones.evaluarResultado(exigido(), 0, bloqueaCon(LA_ESPERADA))).toBeNull();
    // entre otras fallas, alcanza con que esté la esperada
    const otra = { codigo: "otra", archivo: "y.ts", linea: 9 };
    expect(evasiones.evaluarResultado(exigido(), 0, bloqueaCon(otra, LA_ESPERADA))).toBeNull();
  });

  it("sin línea en «esperado» alcanza con el código y el archivo, y sin fallas con línea también", () => {
    const sinLinea = exigido({
      esperado: { tipo: "bloquea", codigo: "ruta-sin-clase", archivo: "x.ts" },
    });
    expect(
      evasiones.evaluarResultado(sinLinea, 0, bloqueaCon({ ...LA_ESPERADA, linea: 77 })),
    ).toBeNull();
    expect(
      evasiones.evaluarResultado(
        sinLinea,
        0,
        bloqueaCon({ codigo: "ruta-sin-clase", archivo: "x.ts" }),
      ),
    ).toBeNull();
  });

  it("una falla con otra línea, otro archivo o otro código no cuenta como la esperada", () => {
    for (const falsa of [
      { ...LA_ESPERADA, linea: 2 },
      { ...LA_ESPERADA, archivo: "y.ts" },
      { ...LA_ESPERADA, codigo: "otro" },
    ]) {
      const r = evasiones.evaluarResultado(exigido(), 0, bloqueaCon(falsa));
      expect(r?.codigo, JSON.stringify(falsa)).toBe("evasion-no-bloqueada");
    }
  });

  it("un exigido que se bloquea pero no como dice: el motivo dice qué esperaba y qué se dijo", () => {
    const r = evasiones.evaluarResultado(
      exigido(),
      3,
      bloqueaCon(
        { codigo: "otro", archivo: "y.ts", linea: 2 },
        { codigo: "uno", archivo: "z.ts", linea: 5 },
      ),
    );
    expect(r).toStrictEqual({
      codigo: "evasion-no-bloqueada",
      archivo: ARCHIVO,
      contrato: null,
      motivo:
        "EV-001 («Carpeta nueva sin regla») se bloqueó (otro en y.ts:2; uno en z.ts:5) y tenía que bloquearse con ruta-sin-clase en x.ts (estado «exigido»).",
      correccion:
        "Arreglá el control que tiene que detectarlo; si no se puede ahora, registralo como brecha abierta (o riesgo aceptado por el dueño) con su plazo. «esperado» no se afloja para que el caso pase.",
      donde: enJson(3, "estado"),
    });
  });

  it("un exigido que PASA falla; sin fallas el motivo lo dice", () => {
    expect(evasiones.evaluarResultado(exigido(), 0, pasa)).toStrictEqual({
      codigo: "evasion-no-bloqueada",
      archivo: ARCHIVO,
      contrato: null,
      motivo:
        "EV-001 («Carpeta nueva sin regla») pasó sin detección (ninguna falla localizada) y tenía que bloquearse con ruta-sin-clase en x.ts (estado «exigido»).",
      correccion: expect.stringContaining("brecha abierta") as unknown,
      donde: enJson(0, "estado"),
    });
  });

  it("un exigido que exige excepción: se bloquea con cualquier falla (o sin falla localizada) y está en regla", () => {
    const exige = exigido({ esperado: { tipo: "exige-excepcion" } });
    expect(evasiones.evaluarResultado(exige, 0, bloqueaCon())).toBeNull();
    expect(
      evasiones.evaluarResultado(exige, 0, bloqueaCon({ codigo: "x", archivo: "y", linea: 1 })),
    ).toBeNull();
    const r = evasiones.evaluarResultado(exige, 0, pasa);
    expect(r?.codigo).toBe("evasion-no-bloqueada");
    expect(r?.motivo).toContain("tenía que bloquearse con una falla que exija excepción");
  });

  it("una brecha abierta que sigue pasando está en regla; si se bloquea, la brecha se cerró", () => {
    expect(evasiones.evaluarResultado(brecha(), 0, pasa)).toBeNull();
    expect(evasiones.evaluarResultado(brecha(), 2, bloqueaCon(LA_ESPERADA))).toStrictEqual({
      codigo: "brecha-cerrada",
      archivo: ARCHIVO,
      contrato: null,
      motivo:
        "EV-001 («Carpeta nueva sin regla») se bloqueó (ruta-sin-clase en x.ts:1) y tenía que seguir pasando sin detección (estado «brecha-abierta»).",
      correccion:
        "La brecha se cerró: pasá el caso a «exigido» (sin campos de brecha) para que el bloqueo quede protegido.",
      donde: enJson(2, "estado"),
    });
    expect(evasiones.evaluarResultado(brecha(), 0, bloqueaCon())?.codigo).toBe("brecha-cerrada");
  });

  it("un riesgo aceptado que sigue pasando está en regla; si se bloquea, el riesgo dejó de existir", () => {
    expect(evasiones.evaluarResultado(riesgo(), 0, pasa)).toBeNull();
    expect(evasiones.evaluarResultado(riesgo(), 1, bloqueaCon(LA_ESPERADA))).toStrictEqual({
      codigo: "riesgo-cerrado",
      archivo: ARCHIVO,
      contrato: null,
      motivo:
        "EV-001 («Carpeta nueva sin regla») se bloqueó (ruta-sin-clase en x.ts:1) y tenía que seguir pasando sin detección (estado «riesgo-aceptado»).",
      correccion:
        "El riesgo dejó de existir: pasá el caso a «exigido» (sin campos de riesgo) para que el bloqueo quede protegido.",
      donde: enJson(1, "estado"),
    });
  });

  it("para una brecha o un riesgo, lo que «esperado» dice no cambia nada: solo importa si pasa", () => {
    for (const hacer of [brecha, riesgo]) {
      const exige = hacer({ esperado: { tipo: "exige-excepcion" } });
      expect(evasiones.evaluarResultado(exige, 0, pasa)).toBeNull();
      expect(evasiones.evaluarResultado(exige, 0, bloqueaCon())).not.toBeNull();
    }
  });
});
