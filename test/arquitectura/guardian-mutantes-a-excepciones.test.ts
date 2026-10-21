import { describe, expect, it } from "vitest";
import { AHORA, huellaDe, huellaDelArchivo } from "./guardian-apoyo";
import {
  ARCHIVO_DE_EXCEPCIONES,
  ARCHIVO_DE_EXCLUSIONES,
  aplicarExcepciones,
  huellaDeLinea,
  json,
  procesarExclusiones,
  type Donde,
  type Hallazgo4,
} from "./guardian-mutantes-a-apoyo";

/**
 * Comportamiento exacto de `excepciones.cjs`: el texto de cada mensaje de falla y de aviso, la ubicación
 * (`donde`) de cada una, qué se considera una fecha o una huella válida y qué entradas se rechazan. Se llama
 * a las dos funciones con entradas sintéticas: cada caso arma lo mínimo y afirma el resultado completo.
 * Hoy de las pruebas: 2026-10-21 (UTC).
 */

const RUTA = "src/u/a.ts";
const LINEA = "const usado = 1;";
const HUELLA = huellaDe(LINEA);
const CONTENIDO_DE_LA_RUTA = "export const a = 1;\n";

type Entrada = Record<string, unknown>;
const excepcion = (cambios: Entrada = {}): Entrada => ({
  id: "e1",
  contrato: "c1",
  ruta: RUTA,
  huella: HUELLA,
  motivo: "Migración pendiente.",
  responsable: "Ingeniería",
  aprobadoPor: "Dueño",
  creada: "2026-10-21",
  vence: "2026-12-20",
  ...cambios,
});
const sin = (entrada: Entrada, ...campos: string[]): Entrada =>
  Object.fromEntries(Object.entries(entrada).filter(([campo]) => !campos.includes(campo)));

const hallazgo = (cambios: Partial<Hallazgo4> = {}): Hallazgo4 => ({
  codigo: "no-usa-falso",
  contrato: "c1",
  archivo: RUTA,
  linea: 3,
  huella: HUELLA,
  ...cambios,
});

function aplicar(
  lista: unknown,
  extra: { hallazgos?: Hallazgo4[]; rutas?: string[]; ids?: string[]; ahora?: unknown } = {},
) {
  const hallazgos = extra.hallazgos ?? [hallazgo()];
  const resultado = aplicarExcepciones(lista, {
    rutas: new Set(extra.rutas ?? [RUTA]),
    idsDeContratos: new Set(extra.ids ?? ["c1"]),
    ahora: "ahora" in extra ? extra.ahora : AHORA,
    hallazgos,
  });
  return { ...resultado, hallazgos };
}

/** El motivo y la corrección de un campo obligatorio que falta o está vacío. */
const faltaElCampo = (rotulo: string, campo: string, nombre: string): [string, string] => [
  `${rotulo}: el campo «${campo}» falta o está vacío.`,
  `Completá «${campo}»: toda ${nombre} lleva motivo, responsable, aprobación y vencimiento.`,
];

/** La falla de una excepción: el archivo es siempre `excepciones.json`. */
const fallaDeExcepcion = (
  codigo: string,
  motivo: string,
  correccion: string,
  donde: Donde,
  contrato: string | null = "c1",
) => ({ codigo, archivo: ARCHIVO_DE_EXCEPCIONES, contrato, motivo, correccion, donde });

describe("excepciones: el reloj y la lista", () => {
  it("una excepción válida se aplica y devuelve todos sus datos", () => {
    const { fallas, avisos, aplicadas, restantes } = aplicar([excepcion()]);
    expect(fallas).toEqual([]);
    expect(avisos).toEqual([]);
    expect(restantes).toEqual([]);
    expect(aplicadas).toEqual([
      {
        id: "e1",
        contrato: "c1",
        ruta: RUTA,
        linea: 3,
        huella: HUELLA,
        creada: "2026-10-21",
        vence: "2026-12-20",
        motivo: "Migración pendiente.",
        responsable: "Ingeniería",
        aprobadoPor: "Dueño",
      },
    ]);
  });

  it.each([[{}], [null], ["texto"], [5]])(
    "un archivo de excepciones que no es una lista (%j) falla y deja todos los hallazgos",
    (lista) => {
      const { fallas, avisos, aplicadas, restantes, hallazgos } = aplicar(lista);
      expect(fallas).toEqual([
        fallaDeExcepcion(
          "excepcion-invalida",
          "El archivo de excepciones tiene que ser una lista.",
          "Dejalo como una lista JSON (vacía si no hay excepciones).",
          json(),
          null,
        ),
      ]);
      expect(avisos).toEqual([]);
      expect(aplicadas).toEqual([]);
      expect(restantes).toBe(hallazgos);
    },
  );

  it.each([["2026-10-21"], [new Date(Number.NaN)], [undefined], [20261021], [null]])(
    "un reloj que no es una fecha válida (%j) lanza un error que lo dice",
    (ahora) => {
      expect(() => aplicar([], { ahora })).toThrow(
        new Error("el reloj («ahora») tiene que ser una fecha válida"),
      );
      expect(() =>
        procesarExclusiones([], {
          rutas: new Set(),
          porRuta: new Map(),
          porClase: {},
          leer: () => null,
          ahora,
        }),
      ).toThrow(new Error("el reloj («ahora») tiene que ser una fecha válida"));
    },
  );

  it("la fecha de hoy se toma en UTC", () => {
    const tardeEnUtc = new Date("2026-10-21T23:59:59Z");
    expect(aplicar([excepcion({ creada: "2026-10-21" })], { ahora: tardeEnUtc }).fallas).toEqual(
      [],
    );
    expect(
      aplicar([excepcion({ creada: "2026-10-22" })], { ahora: tardeEnUtc }).fallas.map(
        (falla) => falla.codigo,
      ),
    ).toEqual(["excepcion-creada-futura"]);
  });
});

describe("excepciones: entradas que no son objetos", () => {
  it.each([[null], [5], ["texto"], [[]], [undefined], [true]])(
    "la entrada %j se rechaza con su posición y sin romper el resto",
    (entrada) => {
      const { fallas, avisos, aplicadas } = aplicar([
        excepcion(),
        entrada,
        excepcion({ id: "e3" }),
      ]);
      expect(fallas).toEqual([
        fallaDeExcepcion(
          "excepcion-invalida",
          "Excepción no es un objeto.",
          "Corregí el formato del archivo.",
          json(1),
          null,
        ),
        // La tercera repite la huella de la primera, que ya consumió el hallazgo.
        fallaDeExcepcion(
          "excepcion-huella-cambiada",
          "La excepción «e3» ya no calza en «src/u/a.ts»: la línea afectada cambió o ya está cubierta por otra excepción (la huella aprobada no coincide con la de ningún hallazgo del archivo).",
          "Revisá el hallazgo nuevo; si sigue justificado, pedí una nueva aprobación y actualizá la huella.",
          json(2, "huella"),
        ),
      ]);
      expect(avisos).toEqual([]);
      expect(aplicadas.map((aplicada) => aplicada.id)).toEqual(["e1"]);
    },
  );
});

describe("excepciones: campos", () => {
  it("un campo de más se rechaza con el texto completo y la lista de los permitidos", () => {
    expect(aplicar([excepcion({ extra: 1 })]).fallas).toEqual([
      fallaDeExcepcion(
        "excepcion-invalida",
        "Excepción «e1»: «extra» no es un campo permitido (una ampliación escondida no vale).",
        "Dejá solo estos campos: id, contrato, ruta, huella, motivo, responsable, aprobadoPor, creada, vence.",
        json(0, "extra"),
      ),
    ]);
  });

  it("sin id, el rótulo es solo «Excepción»", () => {
    expect(aplicar([sin(excepcion({ extra: 1 }), "id")]).fallas.map((f) => f.motivo)).toEqual([
      "Excepción: «extra» no es un campo permitido (una ampliación escondida no vale).",
      "Excepción: el campo «id» falta o está vacío.",
    ]);
  });

  it("un campo que falta dice cuál es, con la corrección en minúsculas y la clave del campo", () => {
    expect(aplicar([sin(excepcion(), "motivo")]).fallas).toEqual([
      fallaDeExcepcion(
        "excepcion-invalida",
        ...faltaElCampo("Excepción «e1»", "motivo", "excepción"),
        json(0, "motivo"),
      ),
    ]);
  });

  it.each([[""], ["   "], [5], [null]])("un «responsable» con %j cuenta como vacío", (valor) => {
    expect(aplicar([excepcion({ responsable: valor })]).fallas.map((f) => f.motivo)).toEqual([
      "Excepción «e1»: el campo «responsable» falta o está vacío.",
    ]);
  });

  it.each([[""], ["  "], [5], [null], [undefined]])(
    "una excepción con «contrato» %j informa la falla sin contrato",
    (contrato) => {
      const { fallas } = aplicar([excepcion({ contrato })]);
      expect(fallas).toEqual([
        fallaDeExcepcion(
          "excepcion-invalida",
          "Excepción «e1»: el campo «contrato» falta o está vacío.",
          "Completá «contrato»: toda excepción lleva motivo, responsable, aprobación y vencimiento.",
          json(0, "contrato"),
          null,
        ),
      ]);
    },
  );

  it("una excepción con un contrato que no existe lo nombra", () => {
    expect(aplicar([excepcion({ contrato: "zzz" })]).fallas).toEqual([
      fallaDeExcepcion(
        "excepcion-contrato-inexistente",
        "La excepción «e1» apunta al contrato «zzz», que no está en el registro.",
        "Borrala o corregí el id del contrato.",
        json(0, "contrato"),
        "zzz",
      ),
    ]);
  });

  it("una ruta con comodines no es un archivo exacto", () => {
    expect(aplicar([excepcion({ ruta: "src/u/*.ts" })]).fallas).toEqual([
      fallaDeExcepcion(
        "excepcion-ruta-no-exacta",
        "Excepción «e1»: «ruta» («src/u/*.ts») no es un archivo exacto (sin comodines, sin carpetas, sin «..»).",
        "Una excepción cubre un solo archivo: escribí su ruta completa. Si son varios, una excepción por hallazgo.",
        json(0, "ruta"),
      ),
    ]);
  });

  it("sin ruta o sin huella, solo se dice que falta: no se le suma que sea inválida", () => {
    expect(aplicar([sin(excepcion(), "ruta")]).fallas.map((f) => f.motivo)).toEqual([
      "Excepción «e1»: el campo «ruta» falta o está vacío.",
    ]);
    expect(aplicar([sin(excepcion(), "huella")]).fallas.map((f) => f.motivo)).toEqual([
      "Excepción «e1»: el campo «huella» falta o está vacío.",
    ]);
  });
});

describe("excepciones: la huella", () => {
  it.each([
    ["con un carácter de más al principio", `g${HUELLA}`],
    ["con un carácter de más al final", `${HUELLA}g`],
    ["con 63 caracteres", HUELLA.slice(1)],
    ["con 65 caracteres", `${HUELLA}0`],
    ["en mayúsculas", HUELLA.toUpperCase()],
    ["que no es hexadecimal", "z".repeat(64)],
    ["con un salto de línea al final", `${HUELLA}\n`],
  ])("una huella %s se rechaza", (_nombre, huella) => {
    expect(aplicar([excepcion({ huella })]).fallas).toEqual([
      fallaDeExcepcion(
        "excepcion-invalida",
        "Excepción «e1»: «huella» no es un SHA-256 en hexadecimal minúscula (64 caracteres).",
        "Copiá la huella que imprime el guardián junto al hallazgo.",
        json(0, "huella"),
      ),
    ]);
  });

  it("la huella de una línea es la del texto sin espacios en los extremos", () => {
    expect(huellaDeLinea(`  ${LINEA}\t`)).toBe(HUELLA);
  });
});

describe("excepciones: las fechas", () => {
  it.each([
    ["creada", "2026-02-30"],
    ["creada", "2026-10-21x"],
    ["creada", "x2026-10-21"],
    ["creada", "0026-10-21"],
    ["vence", "2026-04-31"],
    ["vence", "2026-13-01"],
    ["vence", "2026-00-10"],
    ["vence", "2026-12-00"],
    ["vence", "2026-1-5"],
    ["vence", "20261220"],
  ])("«%s» con «%s» no es una fecha válida", (campo, valor) => {
    expect(aplicar([excepcion({ [campo]: valor })]).fallas).toEqual([
      fallaDeExcepcion(
        "excepcion-invalida",
        `Excepción «e1»: «${campo}» («${valor}») no es una fecha válida AAAA-MM-DD.`,
        "Poné una fecha real con el formato AAAA-MM-DD.",
        json(0, campo),
      ),
    ]);
  });

  it("el 29 de febrero vale solo en año bisiesto", () => {
    const ahora = new Date("2028-02-20T00:00:00Z");
    expect(
      aplicar([excepcion({ creada: "2028-02-20", vence: "2028-02-29" })], { ahora }).fallas,
    ).toEqual([]);
    expect(
      aplicar([excepcion({ creada: "2026-10-21", vence: "2027-02-29" })]).fallas.map(
        (f) => f.motivo,
      ),
    ).toEqual(["Excepción «e1»: «vence» («2027-02-29») no es una fecha válida AAAA-MM-DD."]);
  });
});

describe("excepciones: los avisos de vencimiento", () => {
  it("avisa con el texto completo y la línea del id", () => {
    const { avisos, fallas, aplicadas } = aplicar([excepcion({ vence: "2026-10-31" })]);
    expect(fallas).toEqual([]);
    expect(aplicadas).toHaveLength(1);
    expect(avisos).toEqual([
      {
        codigo: "excepcion-por-vencer",
        archivo: ARCHIVO_DE_EXCEPCIONES,
        contrato: "c1",
        motivo: "Excepción «e1»: vence el 2026-10-31 (faltan 10 días; hoy es 2026-10-21).",
        correccion:
          "Renovala con nueva aprobación y un vencimiento próximo, o corregí lo que silencia: al vencer, bloquea la integración.",
        donde: json(0, "id"),
      },
    ]);
  });

  it.each([
    ["el mismo día", "2026-10-21", 0],
    ["a los 14 días", "2026-11-04", 14],
    ["a los 15 días", "2026-11-05", null],
    ["ayer", "2026-10-20", null],
  ])("vence %s (%s)", (_nombre, vence, faltan) => {
    const { avisos } = aplicar([excepcion({ creada: "2026-10-01", vence })]);
    expect(avisos.map((aviso) => aviso.motivo)).toEqual(
      faltan === null
        ? []
        : [`Excepción «e1»: vence el ${vence} (faltan ${faltan} días; hoy es 2026-10-21).`],
    );
  });

  it("avisa aunque la excepción tenga otra falla, y sin id ni contrato lo dice sin ellos", () => {
    const { avisos, fallas } = aplicar([
      sin(excepcion({ extra: 1, vence: "2026-10-31" }), "id", "contrato"),
    ]);
    expect(avisos).toEqual([
      expect.objectContaining({
        contrato: null,
        motivo: "Excepción: vence el 2026-10-31 (faltan 10 días; hoy es 2026-10-21).",
        donde: json(0, "id"),
      }),
    ]);
    expect(fallas.length).toBeGreaterThan(0);
  });

  it.each([[""], ["2026-02-30"], [5], [null]])(
    "una fecha de vencimiento ausente o mal escrita (%j) no avisa",
    (vence) => {
      expect(aplicar([excepcion({ vence })]).avisos).toEqual([]);
    },
  );
});

describe("excepciones: el id y el contrato de la entrada", () => {
  it("un id repetido se rechaza en la segunda entrada, con su posición", () => {
    const { fallas, aplicadas } = aplicar([excepcion(), excepcion(), excepcion()]);
    expect(aplicadas.map((a) => a.id)).toEqual(["e1"]);
    expect(fallas).toEqual([
      fallaDeExcepcion(
        "excepcion-invalida",
        "Excepción «e1»: el id está repetido.",
        "Cada excepción lleva un id propio.",
        json(1, "id"),
      ),
      fallaDeExcepcion(
        "excepcion-invalida",
        "Excepción «e1»: el id está repetido.",
        "Cada excepción lleva un id propio.",
        json(2, "id"),
      ),
    ]);
  });

  it("dos entradas sin id no se toman por repetidas: cada una dice que le falta el id", () => {
    const { fallas } = aplicar([sin(excepcion(), "id"), sin(excepcion(), "id")]);
    expect(fallas.map((falla) => [falla.motivo, falla.donde])).toEqual([
      ["Excepción: el campo «id» falta o está vacío.", json(0, "id")],
      ["Excepción: el campo «id» falta o está vacío.", json(1, "id")],
    ]);
  });
});

describe("excepciones: contra los hallazgos", () => {
  it("una ruta que ya no es un archivo versionado es obsoleta aunque haya un hallazgo igual", () => {
    const { fallas, aplicadas, restantes } = aplicar([excepcion()], { rutas: [] });
    expect(aplicadas).toEqual([]);
    expect(restantes).toHaveLength(1);
    expect(fallas).toEqual([
      fallaDeExcepcion(
        "excepcion-obsoleta",
        "La excepción «e1» apunta a «src/u/a.ts», que ya no es un archivo versionado.",
        "Borrá la excepción (el archivo se movió o se eliminó).",
        json(0, "id"),
      ),
    ]);
  });

  it("una excepción sin hallazgos en su archivo es obsoleta y lo explica", () => {
    expect(aplicar([excepcion()], { hallazgos: [] }).fallas).toEqual([
      fallaDeExcepcion(
        "excepcion-obsoleta",
        "La excepción «e1» no silencia ningún hallazgo: «src/u/a.ts» ya no tiene el problema.",
        "Borrá la excepción: las excepciones que no se usan quedan como puertas abiertas.",
        json(0, "id"),
      ),
    ]);
  });

  it("un hallazgo sin huella no cuenta como del archivo: la excepción es obsoleta, no «cambiada»", () => {
    const sinHuella = sin(hallazgo(), "huella") as unknown as Hallazgo4;
    const { fallas, restantes } = aplicar([excepcion()], { hallazgos: [sinHuella] });
    expect(fallas.map((falla) => [falla.codigo, falla.donde])).toEqual([
      ["excepcion-obsoleta", json(0, "id")],
    ]);
    expect(restantes).toEqual([sinHuella]);
  });

  it("si la huella no coincide con ningún hallazgo del archivo, dice que la línea cambió", () => {
    const { fallas, restantes } = aplicar([excepcion()], {
      hallazgos: [hallazgo({ huella: huellaDe("otra línea") })],
    });
    expect(restantes).toHaveLength(1);
    expect(fallas).toEqual([
      fallaDeExcepcion(
        "excepcion-huella-cambiada",
        "La excepción «e1» ya no calza en «src/u/a.ts»: la línea afectada cambió o ya está cubierta por otra excepción (la huella aprobada no coincide con la de ningún hallazgo del archivo).",
        "Revisá el hallazgo nuevo; si sigue justificado, pedí una nueva aprobación y actualizá la huella.",
        json(0, "huella"),
      ),
    ]);
  });

  it("un hallazgo de otro contrato o de otro archivo no cuenta", () => {
    const { fallas } = aplicar([excepcion()], {
      hallazgos: [hallazgo({ contrato: "c2" }), hallazgo({ archivo: "src/u/b.ts" })],
    });
    expect(fallas.map((falla) => falla.codigo)).toEqual(["excepcion-obsoleta"]);
  });
});

// --- Exclusiones --------------------------------------------------------------------------------------------

const exclusionDeClase = (cambios: Entrada = {}): Entrada => ({
  id: "x1",
  alcance: "clase",
  clase: "docs",
  motivo: "Documentación para leer.",
  responsable: "Ingeniería",
  aprobadoPor: "Dueño",
  creada: "2026-10-21",
  vence: "2026-12-20",
  ...cambios,
});
const exclusionDeRuta = (cambios: Entrada = {}): Entrada => ({
  id: "x1",
  alcance: "ruta",
  ruta: RUTA,
  huella: huellaDelArchivo(CONTENIDO_DE_LA_RUTA),
  motivo: "Archivo escrito por una herramienta.",
  responsable: "Ingeniería",
  aprobadoPor: "Dueño",
  creada: "2026-10-21",
  vence: "2026-12-20",
  ...cambios,
});

type OpcionesDeExclusion = {
  rutas?: string[];
  porRuta?: Record<string, string>;
  porClase?: Record<string, string[]>;
  contenido?: string | null;
};
function excluir(lista: unknown, opciones: OpcionesDeExclusion = {}) {
  return procesarExclusiones(lista, {
    rutas: new Set(opciones.rutas ?? [RUTA]),
    porRuta: new Map(Object.entries(opciones.porRuta ?? { [RUTA]: "backend" })),
    porClase: opciones.porClase ?? { docs: ["LEEME.md"], generado: ["package-lock.json"] },
    leer: () => ("contenido" in opciones ? (opciones.contenido ?? null) : CONTENIDO_DE_LA_RUTA),
    ahora: AHORA,
  });
}

/** La falla de una exclusión: el archivo es `exclusiones.json` y el contrato, «exclusión». */
const fallaDeExclusion = (codigo: string, motivo: string, correccion: string, donde: Donde) => ({
  codigo,
  archivo: ARCHIVO_DE_EXCLUSIONES,
  contrato: "exclusión",
  motivo,
  correccion,
  donde,
});

describe("exclusiones: la lista y las entradas", () => {
  it.each([[{}], [null], ["texto"]])("un archivo que no es una lista (%j) falla", (lista) => {
    const { fallas, avisos, clases, archivos } = excluir(lista);
    expect(fallas).toEqual([
      {
        codigo: "excepcion-invalida",
        archivo: ARCHIVO_DE_EXCLUSIONES,
        contrato: null,
        motivo: "El archivo de exclusiones tiene que ser una lista.",
        correccion: "Dejalo como una lista JSON.",
        donde: json(),
      },
    ]);
    expect(avisos).toEqual([]);
    expect(clases.size + archivos.size).toBe(0);
  });

  it.each([[null], [5], ["texto"], [[]]])("la entrada %j no es un objeto", (entrada) => {
    const { fallas, avisos, clases } = excluir([entrada, exclusionDeClase()]);
    expect(fallas).toEqual([
      fallaDeExclusion(
        "excepcion-invalida",
        "Exclusión no es un objeto.",
        "Corregí el formato del archivo.",
        json(0),
      ),
    ]);
    expect(avisos).toEqual([]);
    expect([...clases.keys()]).toEqual(["docs"]);
  });

  it("un alcance que no es «clase» ni «ruta» se rechaza", () => {
    expect(excluir([exclusionDeClase({ alcance: "todo" })]).fallas).toEqual([
      fallaDeExclusion(
        "excepcion-invalida",
        "Exclusión: «alcance» tiene que ser «clase» o «ruta».",
        "Indicá si excluye una clase (generado o docs) o un archivo exacto.",
        json(0, "alcance"),
      ),
    ]);
  });

  it("sin alcance, dice que falta y que tiene que ser uno de los dos", () => {
    expect(excluir([sin(exclusionDeClase(), "alcance")]).fallas.map((f) => f.motivo)).toEqual([
      "Exclusión «x1»: el campo «alcance» falta o está vacío.",
      "Exclusión: «alcance» tiene que ser «clase» o «ruta».",
    ]);
  });

  it("un campo que falta lleva el rótulo y la corrección de una exclusión", () => {
    expect(excluir([sin(exclusionDeClase(), "motivo")]).fallas).toEqual([
      fallaDeExclusion(
        "excepcion-invalida",
        ...faltaElCampo("Exclusión «x1»", "motivo", "exclusión"),
        json(0, "motivo"),
      ),
    ]);
  });

  it("una exclusión de clase no admite «huella» ni «ruta», y no se las juzga como válidas o no", () => {
    const campos = "id, alcance, motivo, responsable, aprobadoPor, creada, vence, clase";
    for (const campo of ["huella", "ruta"]) {
      expect(excluir([exclusionDeClase({ [campo]: "basura/*" })]).fallas).toEqual([
        fallaDeExclusion(
          "excepcion-invalida",
          `Exclusión «x1»: «${campo}» no es un campo permitido (una ampliación escondida no vale).`,
          `Dejá solo estos campos: ${campos}.`,
          json(0, campo),
        ),
      ]);
    }
  });

  it("una exclusión de ruta sin ruta o sin huella solo dice que falta", () => {
    expect(excluir([sin(exclusionDeRuta(), "ruta")]).fallas.map((f) => f.motivo)).toEqual([
      "Exclusión «x1»: el campo «ruta» falta o está vacío.",
    ]);
    expect(excluir([sin(exclusionDeRuta(), "huella")]).fallas.map((f) => f.motivo)).toEqual([
      "Exclusión «x1»: el campo «huella» falta o está vacío.",
    ]);
  });

  it("una exclusión de ruta con una huella mal formada o una ruta inexacta lo dice", () => {
    expect(excluir([exclusionDeRuta({ huella: "abc" })]).fallas.map((f) => f.motivo)).toEqual([
      "Exclusión «x1»: «huella» no es un SHA-256 en hexadecimal minúscula (64 caracteres).",
    ]);
    expect(excluir([exclusionDeRuta({ ruta: "src/**" })]).fallas.map((f) => f.motivo)).toEqual([
      "Exclusión «x1»: «ruta» («src/**») no es un archivo exacto (sin comodines, sin carpetas, sin «..»).",
    ]);
  });

  it("un id repetido se rechaza en la segunda entrada", () => {
    const { fallas, clases } = excluir([
      exclusionDeClase(),
      exclusionDeClase({ clase: "generado" }),
      exclusionDeClase({ clase: "generado" }),
    ]);
    expect([...clases.keys()]).toEqual(["docs"]);
    expect(fallas).toEqual([
      fallaDeExclusion(
        "excepcion-invalida",
        "Exclusión «x1»: el id está repetido.",
        "Cada exclusión lleva un id propio.",
        json(1, "id"),
      ),
      fallaDeExclusion(
        "excepcion-invalida",
        "Exclusión «x1»: el id está repetido.",
        "Cada exclusión lleva un id propio.",
        json(2, "id"),
      ),
    ]);
  });

  it("dos entradas sin id no se toman por repetidas", () => {
    const { fallas } = excluir([sin(exclusionDeClase(), "id"), sin(exclusionDeClase(), "id")]);
    expect(fallas.map((falla) => [falla.motivo, falla.donde])).toEqual([
      ["Exclusión: el campo «id» falta o está vacío.", json(0, "id")],
      ["Exclusión: el campo «id» falta o está vacío.", json(1, "id")],
    ]);
  });

  it("avisa del vencimiento con el contrato «exclusión» y el rótulo de exclusión", () => {
    const { avisos, clases } = excluir([exclusionDeClase({ vence: "2026-10-31" })]);
    expect([...clases.keys()]).toEqual(["docs"]);
    expect(avisos).toEqual([
      {
        codigo: "excepcion-por-vencer",
        archivo: ARCHIVO_DE_EXCLUSIONES,
        contrato: "exclusión",
        motivo: "Exclusión «x1»: vence el 2026-10-31 (faltan 10 días; hoy es 2026-10-21).",
        correccion:
          "Renovala con nueva aprobación y un vencimiento próximo, o corregí lo que silencia: al vencer, bloquea la integración.",
        donde: json(0, "id"),
      },
    ]);
  });
});

describe("exclusiones de clase", () => {
  it("una clase que no se puede excluir lista las que sí", () => {
    expect(excluir([exclusionDeClase({ clase: "backend" })]).fallas).toEqual([
      fallaDeExclusion(
        "excepcion-invalida",
        "La exclusión «x1» saca la clase «backend» del análisis, y solo se pueden excluir: generado, docs.",
        "Borrala: el código de aplicación, de pruebas y de configuración siempre se analiza.",
        json(0, "clase"),
      ),
    ]);
  });

  it("la misma clase excluida dos veces se rechaza en la segunda", () => {
    const { fallas, clases } = excluir([exclusionDeClase(), exclusionDeClase({ id: "x2" })]);
    expect(clases.get("docs")?.["id"]).toBe("x1");
    expect(fallas).toEqual([
      fallaDeExclusion(
        "excepcion-invalida",
        "La clase «docs» ya está excluida por otra entrada (la «x2» la repite).",
        "Dejá una sola exclusión por clase.",
        json(1, "clase"),
      ),
    ]);
  });

  it.each([
    ["sin archivos", { docs: [] as string[] }],
    ["que ni figura", {}],
  ])("una clase %s no saca nada del análisis", (_nombre, porClase) => {
    const { fallas, clases } = excluir([exclusionDeClase()], { porClase });
    expect(clases.size).toBe(0);
    expect(fallas).toEqual([
      fallaDeExclusion(
        "excepcion-obsoleta",
        "La exclusión «x1» no saca nada del análisis: la clase «docs» no tiene archivos.",
        "Borrala.",
        json(0, "id"),
      ),
    ]);
  });

  it("una exclusión de clase válida deja la entrada en el mapa de clases", () => {
    const entrada = exclusionDeClase({ clase: "generado" });
    const { fallas, clases, archivos } = excluir([entrada]);
    expect(fallas).toEqual([]);
    expect([...clases.entries()]).toEqual([["generado", entrada]]);
    expect(archivos.size).toBe(0);
  });
});

describe("exclusiones de archivo", () => {
  it("una exclusión de archivo válida deja la entrada en el mapa de archivos", () => {
    const entrada = exclusionDeRuta();
    const { fallas, clases, archivos } = excluir([entrada]);
    expect(fallas).toEqual([]);
    expect([...archivos.entries()]).toEqual([[RUTA, entrada]]);
    expect(clases.size).toBe(0);
  });

  const OBSOLETA_POR_NO_VERSIONADA = fallaDeExclusion(
    "excepcion-obsoleta",
    "La exclusión «x1» apunta a «src/u/a.ts», que no es un archivo versionado y clasificado.",
    "Borrala (el archivo se movió o se eliminó).",
    json(0, "id"),
  );

  it("un archivo que no está clasificado, aunque se lea y la huella calce, es obsoleto", () => {
    const { fallas, archivos } = excluir([exclusionDeRuta()], { porRuta: {} });
    expect(archivos.size).toBe(0);
    expect(fallas).toEqual([OBSOLETA_POR_NO_VERSIONADA]);
  });

  it("un archivo clasificado que no está versionado, o que no se puede leer, es obsoleto", () => {
    expect(excluir([exclusionDeRuta()], { rutas: [] }).fallas).toEqual([
      OBSOLETA_POR_NO_VERSIONADA,
    ]);
    expect(excluir([exclusionDeRuta()], { contenido: null }).fallas).toEqual([
      OBSOLETA_POR_NO_VERSIONADA,
    ]);
  });

  it("un archivo de una clase que ya se excluye por clase es innecesario", () => {
    const { fallas, archivos } = excluir([exclusionDeRuta()], { porRuta: { [RUTA]: "docs" } });
    expect(archivos.size).toBe(0);
    expect(fallas).toEqual([
      fallaDeExclusion(
        "excepcion-obsoleta",
        "La exclusión «x1» es innecesaria: «src/u/a.ts» es de la clase «docs», que ya se excluye por clase.",
        "Borrala.",
        json(0, "id"),
      ),
    ]);
  });

  it("el mismo archivo excluido dos veces se rechaza en la segunda entrada", () => {
    const { fallas, archivos } = excluir([exclusionDeRuta(), exclusionDeRuta({ id: "x2" })]);
    expect(archivos.get(RUTA)?.["id"]).toBe("x1");
    expect(fallas).toEqual([
      fallaDeExclusion(
        "excepcion-invalida",
        "«src/u/a.ts» ya está excluido por otra entrada (la «x2» lo repite).",
        "Dejá una sola exclusión por archivo.",
        json(1, "ruta"),
      ),
    ]);
  });

  it("si el archivo cambió desde que se aprobó, la huella ya no calza", () => {
    const { fallas, archivos } = excluir([exclusionDeRuta()], { contenido: "otro contenido\n" });
    expect(archivos.size).toBe(0);
    expect(fallas).toEqual([
      fallaDeExclusion(
        "excepcion-huella-cambiada",
        "La exclusión «x1» ya no calza: «src/u/a.ts» cambió desde que se aprobó.",
        "Revisá el archivo; si sigue justificado, pedí una nueva aprobación y actualizá la huella.",
        json(0, "huella"),
      ),
    ]);
  });
});
