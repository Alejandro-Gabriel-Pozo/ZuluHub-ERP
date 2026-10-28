import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { contrato, porPatron, type Contrato, type Detector } from "./guardian-apoyo";

/**
 * Registro de contratos (`registro.cjs`): el TEXTO exacto de cada problema que informa, qué campo lo
 * dispara y cuántos informa. Un contrato roto hace fallar la carga entera; quien lee el mensaje decide
 * qué arreglar a partir de ese texto, así que acá se afirma completo y con la lista entera de problemas
 * (ni uno de más: un reclamo espurio mandaría a corregir algo que está bien).
 */

type Detalle = { problema: string; contrato: string | null };
type ErrorCargado = Error & { problemas: string[]; detalles: Detalle[] };
const require = createRequire(import.meta.url);
const { cargarRegistro, ErrorDeRegistro } =
  require("../../arquitectura/contratos/registro.cjs") as {
    cargarRegistro: (lista: unknown) => { contratos: Contrato[]; porId: Map<string, Contrato> };
    ErrorDeRegistro: new (detalles: Detalle[]) => ErrorCargado;
  };

function fallaDe(lista: unknown): ErrorCargado {
  try {
    cargarRegistro(lista);
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorDeRegistro);
    return error as ErrorCargado;
  }
  throw new Error("el registro se cargó y tenía que fallar");
}
const problemasDe = (lista: unknown): string[] => fallaDe(lista).problemas;
/** Los problemas de UN contrato, con el rótulo del contrato por defecto (`color-separador`). */
const deUno = (cambios: Contrato): string[] => problemasDe([contrato(cambios)]);
/** El mismo contrato sin ese campo. */
function sin(campo: string): Contrato {
  const roto = contrato();
  delete roto[campo];
  return roto;
}
const rotulo = (id = "color-separador"): string => `Contrato «${id}»: `;
const P = (...mensajes: string[]): string[] => mensajes.map((mensaje) => rotulo() + mensaje);

const buenos = contrato()["deteccion"] as Detector[];
const reconoce = (): unknown[] => [];
/** El contrato de siempre con un tercer detector (posición 2) en lugar de ninguno: el único roto. */
const conDetector = (detector: unknown): Contrato => contrato({ deteccion: [...buenos, detector] });

const FALTA_USO =
  "«deteccion» necesita al menos un detector de tipo «uso»: sin él no se puede comprobar qué unidades lo usan";
const FALTA_DEFINICION =
  "«deteccion» necesita al menos un detector de tipo «definicion» (sin él, copiar el valor en otro archivo no falla) o declarar «sinDetectorDeDefinicion» con el motivo de por qué no puede haberlo";
const MOTIVO_INVALIDO =
  "«sinDetectorDeDefinicion» tiene que ser un texto que explique por qué no puede haber un detector de definición (mínimo 20 caracteres)";
const CONTRADICTORIO =
  "«sinDetectorDeDefinicion» y un detector de tipo «definicion» a la vez son contradictorios: dejá solo uno";
const FUENTE_NO_OBJETO = "«fuenteDeVerdad» tiene que ser un objeto {archivo, exportacion|variable}";
const FUENTE_SIN_COMODINES =
  "«fuenteDeVerdad.archivo» tiene que ser una ruta exacta relativa a la raíz, sin comodines";
const FUENTE_UNO_SOLO =
  "«fuenteDeVerdad» tiene que traer exactamente uno de «exportacion» o «variable»";
const SIN_LISTA = "«deteccion» tiene que ser una lista con al menos un detector";
const MOTIVO_VALIDO = "El valor lo calcula un servicio externo y no se escribe en ningún archivo.";

describe("el error de carga: su mensaje y sus detalles", () => {
  it("junta los problemas con «\\n- » bajo un encabezado y expone la lista y los detalles", () => {
    const error = fallaDe([contrato({ protege: "", limites: "" })]);
    expect(error.name).toBe("ErrorDeRegistro");
    expect(error.problemas).toEqual(
      P("«protege» está vacío o no es texto", "«limites» está vacío o no es texto"),
    );
    expect(error.message).toBe(
      "El registro de contratos es inválido:\n" +
        "- Contrato «color-separador»: «protege» está vacío o no es texto\n" +
        "- Contrato «color-separador»: «limites» está vacío o no es texto",
    );
    expect(error.detalles).toEqual([
      { problema: error.problemas[0], contrato: "color-separador" },
      { problema: error.problemas[1], contrato: "color-separador" },
    ]);
  });

  it.each([null, "texto", 7, {}, undefined])(
    "algo que no es una lista (%j) falla con un único problema sin contrato",
    (basura) => {
      const error = fallaDe(basura);
      expect(error.problemas).toEqual(["el registro tiene que ser una lista de contratos"]);
      expect(error.detalles).toEqual([
        { problema: "el registro tiene que ser una lista de contratos", contrato: null },
      ]);
      expect(error.message).toBe(
        "El registro de contratos es inválido:\n- el registro tiene que ser una lista de contratos",
      );
    },
  );

  it("un contrato sin id válido figura con su posición (desde 1) y detalle sin contrato", () => {
    const error = fallaDe([contrato(), 7, contrato({ id: "otro-contrato" }), null]);
    expect(error.problemas).toEqual([
      "Contrato #2 (sin id válido): no es un objeto",
      "Contrato #4 (sin id válido): no es un objeto",
    ]);
    expect(error.detalles.map((d) => d.contrato)).toEqual([null, null]);
  });

  it("varios contratos sin id válido no se acusan de repetidos entre sí", () => {
    expect(problemasDe([null, 7, "x"])).toEqual([
      "Contrato #1 (sin id válido): no es un objeto",
      "Contrato #2 (sin id válido): no es un objeto",
      "Contrato #3 (sin id válido): no es un objeto",
    ]);
    expect(problemasDe([sin("id"), contrato({ id: "" })])).toEqual([
      "Contrato #1 (sin id válido): «id» falta o está vacío",
      "Contrato #2 (sin id válido): «id» falta o está vacío",
    ]);
  });

  it("los ids repetidos se acusan una vez por cada repetición, con el contrato en el detalle", () => {
    const error = fallaDe([contrato(), contrato(), contrato()]);
    expect(error.problemas).toEqual([
      "Contrato «color-separador»: el id está repetido",
      "Contrato «color-separador»: el id está repetido",
    ]);
    expect(error.detalles.map((d) => d.contrato)).toEqual(["color-separador", "color-separador"]);
  });

  it("un error que no es de forma (un campo que explota al leerlo) sale tal cual", () => {
    const explosivo = {
      get id(): string {
        throw new Error("boom del campo");
      },
    };
    expect(() => cargarRegistro([explosivo])).toThrow("boom del campo");
  });
});

describe("contrato: forma general e id", () => {
  it.each([null, "contrato", 7, true, []])("%j no es un objeto", (basura) => {
    expect(problemasDe([basura])).toEqual(["Contrato #1 (sin id válido): no es un objeto"]);
  });

  it("un campo fuera del esquema se nombra, uno por uno y en orden", () => {
    expect(deUno({ regla: "x" })).toEqual(P("«regla» no es un campo del esquema"));
    expect(deUno({ regla: "x", otra: 1 })).toEqual(
      P("«regla» no es un campo del esquema", "«otra» no es un campo del esquema"),
    );
  });

  it.each([
    ["falta", undefined],
    ["vacío", ""],
    ["solo espacios", "   "],
    ["un número", 5],
    ["null", null],
  ])("el id %s", (_nombre, id) => {
    const roto = contrato({ id });
    if (id === undefined) delete roto["id"];
    expect(problemasDe([roto])).toEqual(["Contrato #1 (sin id válido): «id» falta o está vacío"]);
  });

  it.each([
    "ColorSeparador",
    "abc!",
    "abc_def",
    "-abc",
    "abc-",
    "a--b",
    "a b",
    " abc",
    "abc ",
    "ñandú",
  ])("el id «%s» no respeta minúsculas, números y guiones", (id) => {
    expect(deUno({ id })).toEqual([
      `Contrato «${id}»: «id» tiene que ser minúsculas, números y guiones (p. ej. «color-de-separadores»)`,
    ]);
  });

  it.each(["a", "abc-1", "1-2-3", "color-de-separadores", "0"])("el id «%s» es válido", (id) => {
    expect(cargarRegistro([contrato({ id })]).porId.has(id)).toBe(true);
  });

  it.each(["protege", "alcance", "incumplimiento", "limites", "politicaDeCambio"])(
    "el campo de texto «%s»: falta, vacío o con otro tipo se distinguen",
    (campo) => {
      expect(problemasDe([sin(campo)])).toEqual(P(`falta «${campo}»`));
      for (const vacio of ["", "   ", 7, null, false, {}]) {
        expect(deUno({ [campo]: vacio })).toEqual(P(`«${campo}» está vacío o no es texto`));
      }
    },
  );

  it("los problemas de varios campos salen juntos: primero los de texto, después la versión", () => {
    expect(deUno({ version: "x", limites: "", protege: "" })).toEqual(
      P(
        "«protege» está vacío o no es texto",
        "«limites» está vacío o no es texto",
        "«version» tiene que ser texto con forma MAYOR.MENOR.PARCHE (p. ej. «1.0.0»)",
      ),
    );
  });
});

describe("contrato: versión y declaración falsa", () => {
  const FORMA = "«version» tiene que ser texto con forma MAYOR.MENOR.PARCHE (p. ej. «1.0.0»)";

  it("sin versión se dice que falta", () => {
    expect(problemasDe([sin("version")])).toEqual(P("falta «version»"));
  });

  it.each([
    "",
    " ",
    "1",
    "1.0",
    "1.0.0.0",
    "x1.0.0",
    "1.0.0x",
    "v1.0.0",
    " 1.0.0",
    "1.0.0 ",
    "1..0",
    "1.a.0",
    "1.0.0-beta",
    1,
    null,
  ])("la versión %j no tiene forma MAYOR.MENOR.PARCHE", (version) => {
    expect(deUno({ version })).toEqual(P(FORMA));
  });

  it.each(["0.0.0", "1.0.0", "10.20.30", "123.456.789"])(
    "la versión «%s» es válida (cada tramo puede tener varios dígitos)",
    (version) => {
      expect(cargarRegistro([contrato({ version })]).contratos).toHaveLength(1);
    },
  );

  it("bloqueaDeclaracionFalsa: falta, no es booleano o es booleano", () => {
    expect(problemasDe([sin("bloqueaDeclaracionFalsa")])).toEqual(
      P("falta «bloqueaDeclaracionFalsa»"),
    );
    for (const raro of ["si", 1, 0, null, "true", {}]) {
      expect(deUno({ bloqueaDeclaracionFalsa: raro })).toEqual(
        P("«bloqueaDeclaracionFalsa» tiene que ser verdadero o falso"),
      );
    }
    for (const valido of [true, false]) {
      expect(
        cargarRegistro([contrato({ bloqueaDeclaracionFalsa: valido })]).contratos,
      ).toHaveLength(1);
    }
  });
});

describe("contrato: la fuente de verdad", () => {
  it("sin fuente se dice que falta, sin otro reclamo", () => {
    expect(problemasDe([sin("fuenteDeVerdad")])).toEqual(P("falta «fuenteDeVerdad»"));
  });

  it.each([["tokens.css"], [null], [["a"]], [7], [true]])(
    "una fuente que no es un objeto (%j) se rechaza con un único mensaje",
    (fuente) => {
      expect(deUno({ fuenteDeVerdad: fuente })).toEqual(P(FUENTE_NO_OBJETO));
    },
  );

  it("cada campo de más se nombra, y los permitidos no se reclaman", () => {
    expect(deUno({ fuenteDeVerdad: { archivo: "a.ts", variable: "--x", extra: 1 } })).toEqual(
      P("«fuenteDeVerdad.extra» no es un campo del esquema (archivo, exportacion o variable)"),
    );
    expect(
      deUno({
        fuenteDeVerdad: { archivo: "a.ts", exportacion: "A", variable: "--x", uno: 1, dos: 2 },
      }),
    ).toEqual(
      P(
        "«fuenteDeVerdad.uno» no es un campo del esquema (archivo, exportacion o variable)",
        "«fuenteDeVerdad.dos» no es un campo del esquema (archivo, exportacion o variable)",
        FUENTE_UNO_SOLO,
      ),
    );
  });

  it.each([
    [{ variable: "--x" }],
    [{ archivo: "", variable: "--x" }],
    [{ archivo: "   ", variable: "--x" }],
    [{ archivo: 7, variable: "--x" }],
  ])("una fuente con el archivo ausente o vacío (%j)", (fuente) => {
    expect(deUno({ fuenteDeVerdad: fuente })).toEqual(
      P("«fuenteDeVerdad.archivo» falta o está vacío"),
    );
  });

  it.each([
    "apps/*.css",
    "apps/**/tokens.css",
    "a?.css",
    "a{b}.css",
    "a}.css",
    "a\\b.css",
    "/etc/tokens.css",
    "../tokens.css",
    "a/../b.css",
    "a..b.css",
  ])("el archivo «%s» no es una ruta exacta relativa a la raíz", (archivo) => {
    expect(deUno({ fuenteDeVerdad: { archivo, variable: "--x" } })).toEqual(
      P(FUENTE_SIN_COMODINES),
    );
  });

  it.each(["apps/web/ui/tokens.css", "a.ts", "src/capacidades/a-b_c.d.ts", "dir/"])(
    "el archivo «%s» es una ruta exacta válida",
    (archivo) => {
      expect(
        cargarRegistro([contrato({ fuenteDeVerdad: { archivo, variable: "--x" } })]).contratos,
      ).toHaveLength(1);
    },
  );

  it("exactamente uno de exportación o variable: los dos o ninguno se rechazan igual", () => {
    expect(deUno({ fuenteDeVerdad: { archivo: "a.ts" } })).toEqual(P(FUENTE_UNO_SOLO));
    expect(
      deUno({ fuenteDeVerdad: { archivo: "a.ts", exportacion: "A", variable: "--a" } }),
    ).toEqual(P(FUENTE_UNO_SOLO));
    expect(
      cargarRegistro([contrato({ fuenteDeVerdad: { archivo: "a.ts", exportacion: "A" } })])
        .contratos,
    ).toHaveLength(1);
  });

  it.each([
    ["exportacion", ""],
    ["exportacion", "  "],
    ["variable", ""],
    ["variable", "  "],
    ["exportacion", 5],
    ["variable", null],
  ])("la %s de la fuente vacía o sin texto (%j) dice cuál es", (campo, valor) => {
    expect(deUno({ fuenteDeVerdad: { archivo: "a.ts", [campo]: valor } })).toEqual(
      P(`«fuenteDeVerdad.${campo}» está vacío`),
    );
  });
});

describe("contrato: la lista de detectores", () => {
  const unUso = (): Detector =>
    porPatron({ tipo: "uso", clases: ["frontend"], patron: /var\(--x\)/, nombre: "uso" });
  const unaDefinicion = (): Detector =>
    porPatron({ tipo: "definicion", clases: ["frontend"], patron: /--x:/, nombre: "definición" });

  it("sin «deteccion» se dice que falta y nada más", () => {
    expect(problemasDe([sin("deteccion")])).toEqual(P("falta «deteccion»"));
  });

  it.each([["uso"], [7], [{ tipo: "uso" }], [null], [true]])(
    "una «deteccion» que no es una lista (%j) se rechaza con un único mensaje",
    (deteccion) => {
      expect(deUno({ deteccion })).toEqual(P(SIN_LISTA));
    },
  );

  it("una lista vacía se rechaza con un único mensaje, también con la ausencia declarada", () => {
    expect(deUno({ deteccion: [] })).toEqual(P(SIN_LISTA));
    expect(deUno({ deteccion: [], sinDetectorDeDefinicion: MOTIVO_VALIDO })).toEqual(P(SIN_LISTA));
  });

  it("sin detector de uso se dice, aunque haya de definición", () => {
    expect(deUno({ deteccion: [unaDefinicion()] })).toEqual(P(FALTA_USO));
  });

  it("sin detector de definición ni ausencia declarada se dice cómo salir", () => {
    expect(deUno({ deteccion: [unUso()] })).toEqual(P(FALTA_DEFINICION));
  });

  it.each([["uso"], [null], [7], [[]]])(
    "un detector que no es un objeto (%j) en la posición 2 se nombra por su posición",
    (detector) => {
      expect(problemasDe([conDetector(detector)])).toEqual(
        P("«deteccion[2]» tiene que ser un objeto"),
      );
    },
  );

  it("el rótulo lleva la posición del detector roto, no siempre la misma", () => {
    const roto = { tipo: "otro", clases: ["frontend"], reconoce };
    expect(deUno({ deteccion: [roto, ...buenos] })).toEqual(
      P("«deteccion[0].tipo» tiene que ser «uso» o «definicion»"),
    );
    expect(deUno({ deteccion: [buenos[0], roto, buenos[1]] })).toEqual(
      P("«deteccion[1].tipo» tiene que ser «uso» o «definicion»"),
    );
  });

  it("un campo de más del detector se nombra, y los permitidos no se reclaman", () => {
    expect(
      problemasDe([
        conDetector({ tipo: "uso", clases: ["backend"], reconoce, nombre: "x", regla: "y" }),
      ]),
    ).toEqual(
      P("«deteccion[2].regla» no es un campo del detector (tipo, clases, reconoce, nombre)"),
    );
  });

  it.each([["otro"], [undefined], [7], ["Uso"]])(
    "el tipo %j no es «uso» ni «definicion»",
    (tipo) => {
      expect(problemasDe([conDetector({ tipo, clases: ["backend"], reconoce })])).toEqual(
        P("«deteccion[2].tipo» tiene que ser «uso» o «definicion»"),
      );
    },
  );

  it.each([[undefined], [[]], ["frontend"], [null]])(
    "las clases ausentes, vacías o que no son una lista (%j) se rechazan",
    (clases) => {
      expect(problemasDe([conDetector({ tipo: "uso", clases, reconoce })])).toEqual(
        P("«deteccion[2].clases» falta o está vacío"),
      );
    },
  );

  it("cada clase inexistente se nombra, en orden y con su valor tal cual", () => {
    expect(
      problemasDe([conDetector({ tipo: "uso", clases: ["frontend", "inventada", 5], reconoce })]),
    ).toEqual(
      P(
        "«deteccion[2].clases» menciona la clase «inventada», que no existe",
        "«deteccion[2].clases» menciona la clase «5», que no existe",
      ),
    );
  });

  it("una clase repetida se rechaza; si además no existe se dicen las dos cosas", () => {
    expect(
      problemasDe([conDetector({ tipo: "uso", clases: ["frontend", "frontend"], reconoce })]),
    ).toEqual(P("«deteccion[2].clases» repite una clase"));
    expect(
      problemasDe([conDetector({ tipo: "uso", clases: ["inventada", "inventada"], reconoce })]),
    ).toEqual(
      P(
        "«deteccion[2].clases» menciona la clase «inventada», que no existe",
        "«deteccion[2].clases» menciona la clase «inventada», que no existe",
        "«deteccion[2].clases» repite una clase",
      ),
    );
  });

  it.each([[undefined], ["reconoce"], [null], [{}]])(
    "«reconoce» que no es una función (%j) se rechaza",
    (valor) => {
      expect(
        problemasDe([conDetector({ tipo: "uso", clases: ["backend"], reconoce: valor })]),
      ).toEqual(
        P("«deteccion[2].reconoce» tiene que ser una función (contenido, ruta) → [{linea, texto}]"),
      );
    },
  );

  it.each([[""], ["   "], [5], [null]])("un nombre %j no es un texto: se rechaza", (nombre) => {
    expect(
      problemasDe([conDetector({ tipo: "uso", clases: ["backend"], reconoce, nombre })]),
    ).toEqual(P("«deteccion[2].nombre» está vacío"));
  });

  it("el nombre es opcional: un detector sin nombre, o con uno, carga", () => {
    const sinNombre = { tipo: "uso", clases: ["backend"], reconoce };
    const conNombre = { tipo: "uso", clases: ["backend"], reconoce, nombre: "mira el backend" };
    expect(cargarRegistro([conDetector(sinNombre)]).contratos).toHaveLength(1);
    expect(cargarRegistro([conDetector(conNombre)]).contratos).toHaveLength(1);
  });

  it("un detector con varios problemas los informa todos, en el orden de los campos", () => {
    expect(problemasDe([conDetector({ tipo: "otro", clases: [], regla: 1, nombre: "" })])).toEqual(
      P(
        "«deteccion[2].regla» no es un campo del detector (tipo, clases, reconoce, nombre)",
        "«deteccion[2].tipo» tiene que ser «uso» o «definicion»",
        "«deteccion[2].clases» falta o está vacío",
        "«deteccion[2].reconoce» tiene que ser una función (contenido, ruta) → [{linea, texto}]",
        "«deteccion[2].nombre» está vacío",
      ),
    );
  });

  it("los detectores rotos no suman reclamos de uso/definición cuando los otros alcanzan", () => {
    expect(deUno({ deteccion: [unUso(), unaDefinicion(), "roto"] })).toEqual(
      P("«deteccion[2]» tiene que ser un objeto"),
    );
  });
});

describe("contrato: ausencia declarada del detector de definición", () => {
  const soloUso = (): Detector[] => [
    porPatron({ tipo: "uso", clases: ["frontend"], patron: /var\(--x\)/, nombre: "uso" }),
  ];

  it("la ausencia declarada con un motivo de 20 o más caracteres (sin contar los bordes) carga", () => {
    for (const motivo of [MOTIVO_VALIDO, "x".repeat(20), `  ${"x".repeat(20)}  `]) {
      const registro = cargarRegistro([
        contrato({ deteccion: soloUso(), sinDetectorDeDefinicion: motivo }),
      ]);
      expect(registro.contratos[0]?.["sinDetectorDeDefinicion"]).toBe(motivo);
    }
  });

  it.each([
    [""],
    ["     "],
    ["n/a"],
    ["x".repeat(19)],
    ["corto".padEnd(40)],
    [`${" ".repeat(10)}${"x".repeat(19)}${" ".repeat(10)}`],
    [true],
    [7],
    [null],
    [{ motivo: MOTIVO_VALIDO }],
  ])("el motivo %j se rechaza con su mensaje y sin otro reclamo", (motivo) => {
    expect(deUno({ deteccion: soloUso(), sinDetectorDeDefinicion: motivo })).toEqual(
      P(MOTIVO_INVALIDO),
    );
  });

  it("declarar la ausencia y tener un detector de definición es contradictorio", () => {
    expect(deUno({ sinDetectorDeDefinicion: MOTIVO_VALIDO })).toEqual(P(CONTRADICTORIO));
  });

  it("un motivo inválido se reclama aunque haya detector de definición (sin decir «contradictorio»)", () => {
    expect(deUno({ sinDetectorDeDefinicion: "n/a" })).toEqual(P(MOTIVO_INVALIDO));
  });
});
