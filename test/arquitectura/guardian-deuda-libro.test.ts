import { describe, expect, it } from "vitest";
import {
  AHORA,
  CONFIGURACION,
  CONFIGURACION_SANA,
  REGISTRO,
  SIN_DEUDA,
  arbolDe,
  codigosDe,
  conMarcadores,
  entrada,
  evaluar,
  excepcion,
  json,
  libro,
  lineas,
  lugaresDe,
  marcadores,
  mundo,
} from "./guardian-deuda-apoyo";

/**
 * El libro de deuda de UN árbol (`arquitectura/deuda/libro.cjs`): qué marcadores hay (`medir`), cuánta deuda es
 * (`totales`), la configuración y el registro, y si coinciden (`evaluarArbol`). Cada falla se afirma con su
 * código, su archivo:línea y su texto completo: son lo que lee quien rompe la regla en el CI.
 */

/** La línea (desde 1) de la `n`-ésima aparición (por omisión la primera) de un texto en otro. */
function lineaDe(texto: string, buscado: string, n = 1): number {
  const apariciones = texto
    .split("\n")
    .map((renglon, i) => ({ renglon, linea: i + 1 }))
    .filter(({ renglon }) => renglon.includes(buscado));
  const encontrada = apariciones[n - 1];
  if (encontrada === undefined) throw new Error(`no hay una línea ${String(n)} con «${buscado}»`);
  return encontrada.linea;
}

/** Evalúa `a.ts` con N marcadores, su registro y su configuración; los archivos extra se suman. */
function conEntradas(
  entradas: unknown[],
  extra: Record<string, string> = {},
  configuracion: Parameters<typeof mundo>[2] = {},
  marcadoresEnA = 1,
) {
  const archivos = mundo(
    { "a.ts": conMarcadores(marcadoresEnA), ...extra },
    entradas,
    configuracion,
  );
  return { archivos, resultado: evaluar(archivos), registro: archivos[REGISTRO] as string };
}

describe("medir: qué marcadores hay y dónde", () => {
  it("agrupa por archivo y tipo (ordenados por archivo y por tipo), con sus líneas", () => {
    const medicion = libro.medir(
      arbolDe({
        "z.ts": "// TODO: z\n",
        "b.ts": lineas("// @ts-ignore", "// TODO: b", "// @ts-ignore"),
        "a.ts": "// FIXME a\n",
        "README.md": "TODO: en un md",
      }),
    );
    expect(medicion.lista).toEqual([
      { tipo: "todo", archivo: "a.ts", lineas: [1] },
      { tipo: "todo", archivo: "b.ts", lineas: [2] },
      { tipo: "ts-ignore", archivo: "b.ts", lineas: [1, 3] },
      { tipo: "todo", archivo: "z.ts", lineas: [1] },
    ]);
    expect(medicion.analizados).toBe(3);
    expect(medicion.ilegibles).toEqual([]);
    expect([...medicion.porClave.keys()]).toEqual([
      "todo\0a.ts",
      "todo\0b.ts",
      "ts-ignore\0b.ts",
      "todo\0z.ts",
    ]);
    expect(medicion.porClave.get(libro.claveDe("ts-ignore", "b.ts"))).toEqual({
      tipo: "ts-ignore",
      archivo: "b.ts",
      lineas: [1, 3],
    });
  });

  it("no lee los archivos que no analiza, y lee los demás una sola vez", () => {
    const leidos: string[] = [];
    const arbol = {
      rutas: ["x.md", "y.png", "a.ts", "b.json"],
      leer: (ruta: string) => {
        leidos.push(ruta);
        return "// TODO: x\n";
      },
    };
    const medicion = libro.medir(arbol);
    expect(leidos).toEqual(["a.ts", "b.json"]);
    expect(medicion.analizados).toBe(2);
  });

  it("lee contenido en Buffer igual que en texto", () => {
    const medicion = libro.medir(arbolDe({ "a.ts": Buffer.from("// TODO: x\n") }));
    expect(medicion.lista).toEqual([{ tipo: "todo", archivo: "a.ts", lineas: [1] }]);
  });

  it("un archivo que se debía analizar y no se puede leer queda como ilegible (línea 1) y no se cuenta como analizado", () => {
    const medicion = libro.medir({
      rutas: ["roto.ts", "a.ts"],
      leer: (ruta) => (ruta === "roto.ts" ? null : "// TODO: x\n"),
    });
    expect(medicion.ilegibles).toEqual([
      { archivo: "roto.ts", linea: 1, motivo: "no se pudo leer el archivo" },
    ]);
    expect(medicion.analizados).toBe(1);
    expect(medicion.lista).toEqual([{ tipo: "todo", archivo: "a.ts", lineas: [1] }]);
  });

  it("un archivo de datos que no es JSON válido es ilegible, con la línea del error, y sigue contando como analizado", () => {
    const medicion = libro.medir(arbolDe({ "knip.json": '{\n  "ignore": [\n' }));
    expect(medicion.ilegibles).toEqual([
      { archivo: "knip.json", linea: 2, motivo: "no es JSON válido" },
    ]);
    expect(medicion.analizados).toBe(1);
  });

  it("no modifica la lista de rutas que recibe", () => {
    const rutas = ["b.ts", "a.ts"];
    libro.medir({ rutas, leer: () => "" });
    expect(rutas).toEqual(["b.ts", "a.ts"]);
  });
});

describe("totales: cuánta deuda hay", () => {
  it("suma los marcadores y los hallazgos registrados, por tipo, y cuenta los archivos con deuda", () => {
    const { resultado } = conEntradas(
      [
        entrada({ id: "m", tipo: "todo", archivos: ["a.ts"] }),
        { ...entrada({ id: "h1", tipo: "backlog", archivos: ["a.ts"] }) },
        { ...entrada({ id: "h2", tipo: "backlog", archivos: ["a.ts"] }) },
        { ...entrada({ id: "h3", tipo: "brecha", archivos: ["a.ts"] }) },
      ],
      {},
      {},
      1,
    );
    // `a.ts` tiene un @ts-expect-error (sin entrada de ese tipo) y las entradas no cuentan marcadores propios
    expect(libro.totales(resultado)).toEqual({
      marcadores: 1,
      hallazgos: 3,
      total: 4,
      archivosConDeuda: 1,
      porTipo: { "ts-expect-error": 1, backlog: 2, brecha: 1 },
    });
  });

  it("un árbol sin nada tiene todo en cero", () => {
    expect(libro.totales(evaluar(mundo({ "a.ts": SIN_DEUDA })))).toEqual({
      marcadores: 0,
      hallazgos: 0,
      total: 0,
      archivosConDeuda: 0,
      porTipo: {},
    });
  });

  it("cuenta cada marcador (no cada archivo) y cada archivo una sola vez aunque tenga dos tipos", () => {
    const medicion = libro.medir(
      arbolDe({
        "a.ts": lineas("// TODO: a", "// @ts-ignore", "// @ts-ignore"),
        "b.ts": "// TODO: b\n",
      }),
    );
    expect(libro.totales({ medicion, entradas: [] })).toEqual({
      marcadores: 4,
      hallazgos: 0,
      total: 4,
      archivosConDeuda: 2,
      porTipo: { todo: 2, "ts-ignore": 2 },
    });
  });
});

describe("la configuración (configuracion.json)", () => {
  const leerConfiguracion = (texto: string | null) =>
    libro.leerConfiguracion((ruta) => (ruta === CONFIGURACION ? texto : null));
  const CORRECCION =
    "Dejá un objeto con `topeDeExcepciones` (entero ≥ 0), `bloqueaDeudaEnArchivoTocado` (true o false), `topeDeLineasPorArchivo` (entero ≥ 1) y `excluidosDelTope` (lista de { ruta, motivo }).";
  const POR_DEFECTO = {
    topeDeExcepciones: 10,
    bloqueaDeudaEnArchivoTocado: false,
    topeDeLineasPorArchivo: 400,
    excluidosDelTope: [],
  };
  /** Una configuración entera con esos cambios (en el orden de las claves de siempre). */
  const con = (cambios: Record<string, unknown> = {}) => ({
    topeDeExcepciones: 4,
    bloqueaDeudaEnArchivoTocado: true,
    topeDeLineasPorArchivo: 400,
    excluidosDelTope: [],
    ...cambios,
  });
  const falla = (motivo: string, camino: unknown[]) => ({
    codigo: "deuda-configuracion-invalida",
    archivo: CONFIGURACION,
    contrato: "deuda",
    motivo,
    correccion: CORRECCION,
    donde: { tipo: "json", camino },
  });

  it("una configuración sana se lee tal cual, sin fallas", () => {
    const excluido = { ruta: "src/datos.ts", motivo: "Datos declarativos." };
    expect(
      leerConfiguracion(
        json(
          con({ topeDeExcepciones: 3, topeDeLineasPorArchivo: 250, excluidosDelTope: [excluido] }),
        ),
      ),
    ).toEqual({
      configuracion: {
        topeDeExcepciones: 3,
        bloqueaDeudaEnArchivoTocado: true,
        topeDeLineasPorArchivo: 250,
        excluidosDelTope: [excluido],
      },
      fallas: [],
    });
    expect(
      leerConfiguracion(json(con({ topeDeExcepciones: 0, bloqueaDeudaEnArchivoTocado: false })))
        .configuracion,
    ).toEqual(con({ topeDeExcepciones: 0, bloqueaDeudaEnArchivoTocado: false }));
    expect(leerConfiguracion(json(con({ topeDeLineasPorArchivo: 1 }))).fallas).toEqual([]);
  });

  it("si no existe, falla (línea 1 del archivo) y se sigue con los valores por defecto", () => {
    expect(leerConfiguracion(null)).toEqual({
      configuracion: POR_DEFECTO,
      fallas: [
        {
          ...falla("", []),
          motivo:
            "No existe configuracion.json: sin él no hay tope de excepciones, regla de bloqueo ni tope de líneas.",
        },
      ],
    });
  });

  it("si no es JSON válido, falla con el motivo del analizador", () => {
    let motivo = "";
    try {
      JSON.parse("{ no");
    } catch (error) {
      motivo = (error as Error).message;
    }
    const { fallas, configuracion } = leerConfiguracion("{ no");
    expect(configuracion).toEqual(POR_DEFECTO);
    expect(fallas).toEqual([falla(`configuracion.json no es JSON válido (${motivo}).`, [])]);
  });

  it.each(["[]", "5", "null", '"texto"'])("%s no es un objeto", (texto) => {
    const { fallas, configuracion } = leerConfiguracion(texto);
    expect(configuracion).toEqual(POR_DEFECTO);
    expect(fallas.map((f) => f.motivo)).toEqual(["configuracion.json tiene que ser un objeto."]);
  });

  it("una opción desconocida falla en su propia clave, sin cambiar lo demás", () => {
    const { fallas, configuracion } = leerConfiguracion(json({ ...CONFIGURACION_SANA, extra: 1 }));
    expect(configuracion).toEqual(CONFIGURACION_SANA);
    expect(fallas).toEqual([falla("«extra» no es una opción de configuracion.json.", ["extra"])]);
  });

  it.each([-1, 1.5, "10", null, true, [], {}])("el tope %j no es un entero ≥ 0", (tope) => {
    const { fallas, configuracion } = leerConfiguracion(
      JSON.stringify(con({ topeDeExcepciones: tope })),
    );
    expect(configuracion).toEqual(con({ topeDeExcepciones: 10 }));
    expect(fallas).toHaveLength(1);
    expect(fallas[0]).toMatchObject({
      motivo: "`topeDeExcepciones` tiene que ser un entero mayor o igual que 0.",
      donde: { tipo: "json", camino: ["topeDeExcepciones"] },
    });
  });

  it.each(["true", 1, 0, null, "false", []])(
    "la opción de bloqueo %j no es un booleano",
    (valor) => {
      const { fallas, configuracion } = leerConfiguracion(
        JSON.stringify(con({ bloqueaDeudaEnArchivoTocado: valor })),
      );
      expect(configuracion).toEqual(con({ bloqueaDeudaEnArchivoTocado: false }));
      expect(fallas).toHaveLength(1);
      expect(fallas[0]).toMatchObject({
        motivo: "`bloqueaDeudaEnArchivoTocado` tiene que ser true o false.",
        donde: { tipo: "json", camino: ["bloqueaDeudaEnArchivoTocado"] },
      });
    },
  );

  it.each([0, -5, 1.5, "400", null, true, [], {}])(
    "el tope de líneas %j no es un entero ≥ 1",
    (valor) => {
      const { fallas, configuracion } = leerConfiguracion(
        JSON.stringify(con({ topeDeLineasPorArchivo: valor })),
      );
      expect(configuracion).toEqual(con({ topeDeLineasPorArchivo: 400 }));
      expect(fallas).toEqual([
        falla("`topeDeLineasPorArchivo` tiene que ser un entero mayor o igual que 1.", [
          "topeDeLineasPorArchivo",
        ]),
      ]);
    },
  );

  it.each([undefined, null, {}, "src/a.ts", 5])("las exclusiones %j no son una lista", (valor) => {
    const { fallas, configuracion } = leerConfiguracion(
      JSON.stringify(con({ excluidosDelTope: valor })),
    );
    expect(configuracion).toEqual(con({ excluidosDelTope: [] }));
    expect(fallas).toEqual([
      falla(
        "`excluidosDelTope` tiene que ser una lista de { ruta, motivo } (vacía si no hay exclusiones).",
        ["excluidosDelTope"],
      ),
    ]);
  });

  describe("cada exclusión del tope", () => {
    const BUENA = { ruta: "src/datos.ts", motivo: "Datos." };
    const leerExcluidos = (excluidos: unknown[]) =>
      leerConfiguracion(JSON.stringify(con({ excluidosDelTope: excluidos })));

    it("sana: se conserva, en su orden", () => {
      const otra = { ruta: "src/otros.ts", motivo: "Otros datos." };
      expect(leerExcluidos([BUENA, otra]).configuracion.excluidosDelTope).toEqual([BUENA, otra]);
    });

    it("que no es un objeto falla en su posición y no se cuenta", () => {
      for (const elemento of [5, "src/a.ts", null, []]) {
        const { fallas, configuracion } = leerExcluidos([BUENA, elemento]);
        expect(configuracion.excluidosDelTope).toEqual([BUENA]);
        expect(fallas).toEqual([
          falla("La exclusión 2 no es un objeto { ruta, motivo }.", ["excluidosDelTope", 1]),
        ]);
      }
    });

    it("con un campo que no es suyo falla en ese campo, pero se cuenta si lo demás está bien", () => {
      const { fallas, configuracion } = leerExcluidos([{ ...BUENA, extra: 1 }]);
      expect(configuracion.excluidosDelTope).toEqual([BUENA]);
      expect(fallas).toEqual([
        falla("La exclusión 1 trae «extra», que no es un campo permitido.", [
          "excluidosDelTope",
          0,
          "extra",
        ]),
      ]);
    });

    it.each([undefined, "", "   ", 5, "src/*.ts", "src/", "../a.ts"])(
      "con la ruta %j falla en la ruta y no se cuenta",
      (ruta) => {
        const { fallas, configuracion } = leerExcluidos([{ ruta, motivo: "Datos." }]);
        expect(configuracion.excluidosDelTope).toEqual([]);
        expect(fallas).toEqual([
          falla(
            "La exclusión 1 tiene que nombrar un archivo con su ruta exacta (sin comodines ni carpetas).",
            ["excluidosDelTope", 0, "ruta"],
          ),
        ]);
      },
    );

    it.each([undefined, "", "   ", 5, null])(
      "con el motivo %j falla en el motivo y no se cuenta",
      (motivo) => {
        const { fallas, configuracion } = leerExcluidos([{ ruta: "src/datos.ts", motivo }]);
        expect(configuracion.excluidosDelTope).toEqual([]);
        expect(fallas).toEqual([
          falla("La exclusión 1 no dice su motivo.", ["excluidosDelTope", 0, "motivo"]),
        ]);
      },
    );

    it("repetida falla en la segunda, y solo se cuenta una vez", () => {
      const { fallas, configuracion } = leerExcluidos([BUENA, { ...BUENA, motivo: "Otra vez." }]);
      expect(configuracion.excluidosDelTope).toEqual([BUENA]);
      expect(fallas).toEqual([
        falla("La exclusión 2 repite «src/datos.ts».", ["excluidosDelTope", 1, "ruta"]),
      ]);
    });

    it("sin ruta ni motivo da las dos fallas, cada una en su campo", () => {
      const { fallas } = leerExcluidos([{}]);
      expect(fallas.map((f) => f.donde)).toEqual([
        { tipo: "json", camino: ["excluidosDelTope", 0, "ruta"] },
        { tipo: "json", camino: ["excluidosDelTope", 0, "motivo"] },
      ]);
    });
  });

  it("un objeto vacío falla por las cuatro opciones", () => {
    const { fallas } = leerConfiguracion("{}");
    expect(fallas.map((f) => f.donde)).toEqual([
      { tipo: "json", camino: ["topeDeExcepciones"] },
      { tipo: "json", camino: ["bloqueaDeudaEnArchivoTocado"] },
      { tipo: "json", camino: ["topeDeLineasPorArchivo"] },
      { tipo: "json", camino: ["excluidosDelTope"] },
    ]);
  });

  it("evaluarArbol la reporta con la línea de la clave ofensora", () => {
    const archivos = mundo({ "a.ts": SIN_DEUDA });
    archivos[CONFIGURACION] = json(con({ topeDeExcepciones: -2 }));
    const { fallas } = evaluar(archivos);
    // `evaluarArbol` deja el descriptor `donde` para que `deuda.cjs` lo resuelva con ubicacion.cjs
    expect(fallas.map((f) => [f.codigo, f.archivo, f.donde])).toEqual([
      [
        "deuda-configuracion-invalida",
        CONFIGURACION,
        { tipo: "json", camino: ["topeDeExcepciones"] },
      ],
    ]);
  });
});

describe("el registro como archivo", () => {
  const sinRegistro = (texto: string | null) => {
    const archivos = mundo({ "a.ts": SIN_DEUDA });
    if (texto === null) delete archivos[REGISTRO];
    else archivos[REGISTRO] = texto;
    return evaluar(archivos).fallas;
  };

  it("un registro vacío y sano no tiene fallas ni entradas", () => {
    const resultado = evaluar(mundo({ "a.ts": SIN_DEUDA }));
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toEqual([]);
    expect(resultado.entradas).toEqual([]);
    expect(resultado.configuracion).toEqual(CONFIGURACION_SANA);
  });

  it("si no existe, falla: sin registro no hay a qué comparar los marcadores", () => {
    expect(sinRegistro(null)).toEqual([
      {
        codigo: "deuda-entrada-invalida",
        archivo: REGISTRO,
        contrato: "deuda",
        motivo: "No existe el registro de deuda: sin él no hay a qué comparar los marcadores.",
        correccion: "Dejalo como una lista JSON (vacía si no hay deuda).",
        donde: { tipo: "json", camino: [] },
      },
    ]);
  });

  it("si no es JSON válido, falla con el motivo del analizador", () => {
    let motivo = "";
    try {
      JSON.parse("[ no");
    } catch (error) {
      motivo = (error as Error).message;
    }
    const [falla, ...resto] = sinRegistro("[ no");
    expect(resto).toEqual([]);
    expect(falla?.motivo).toBe(`El registro de deuda no es JSON válido (${motivo}).`);
    expect(falla?.codigo).toBe("deuda-entrada-invalida");
  });

  it.each(["{}", "5", '"x"', "null"])("%s no es una lista", (texto) => {
    expect(sinRegistro(texto).map((f) => f.motivo)).toEqual([
      "El registro de deuda tiene que ser una lista.",
    ]);
  });

  it("una entrada que no es un objeto falla en su posición (desde 1 en el texto)", () => {
    const [falla, ...resto] = sinRegistro('[\n  "texto"\n]\n');
    expect(resto).toEqual([]);
    expect(falla).toEqual({
      codigo: "deuda-entrada-invalida",
      archivo: REGISTRO,
      contrato: "deuda",
      motivo: "La entrada 1 del registro no es un objeto.",
      correccion: "Corregí el formato.",
      donde: { tipo: "json", camino: [0] },
    });
    expect(sinRegistro("[null, 5]").map((f) => f.motivo)).toEqual([
      "La entrada 1 del registro no es un objeto.",
      "La entrada 2 del registro no es un objeto.",
    ]);
    expect(sinRegistro("[[]]").map((f) => f.motivo)).toEqual([
      "La entrada 1 del registro no es un objeto.",
    ]);
  });
});

describe("la forma de cada entrada", () => {
  /** Una entrada de a.ts con ese cambio, evaluada: las fallas con su lugar (línea resuelta) y su texto. */
  function fallasDe(cambios: Record<string, unknown>, extra: Record<string, string> = {}) {
    const { resultado, registro } = conEntradas([entrada(cambios)], extra);
    return { fallas: resultado.fallas, registro, resultado };
  }
  const forma = (falla: { codigo: string; motivo: string; donde?: unknown }) => [
    falla.codigo,
    falla.motivo,
    falla.donde,
  ];

  it("una entrada sana se normaliza y no falla", () => {
    const { resultado } = conEntradas([entrada()]);
    expect(resultado.fallas).toEqual([]);
    expect(resultado.entradas).toEqual([
      {
        indice: 0,
        id: "ts-expect-error--a-ts",
        tipo: "ts-expect-error",
        archivos: ["a.ts"],
        excepcion: false,
        vigente: false,
        verificacion: null,
        tamano: null,
        creada: "2026-10-01",
        vence: null,
      },
    ]);
  });

  it("un campo que no está permitido falla en su clave", () => {
    const { fallas } = fallasDe({ sobrante: 1 });
    expect(fallas.map(forma)).toEqual([
      [
        "deuda-entrada-invalida",
        "Entrada «ts-expect-error--a-ts»: «sobrante» no es un campo permitido.",
        { tipo: "json", camino: [0, "sobrante"] },
      ],
    ]);
    expect(fallas[0]?.correccion).toBe(
      "Dejá solo: id, archivos, descripcion, tipo, responsable, creada, verificacion, tamano, motivo, aprobadoPor, vence.",
    );
  });

  it("sin descripción (o vacía) falla en el campo", () => {
    for (const descripcion of [undefined, "", "   ", 5]) {
      const { fallas } = fallasDe({ descripcion });
      expect(fallas.map(forma)).toEqual([
        [
          "deuda-entrada-invalida",
          "Entrada «ts-expect-error--a-ts»: falta la descripción (qué es la deuda).",
          { tipo: "json", camino: [0, "descripcion"] },
        ],
      ]);
      expect(fallas[0]?.correccion).toBe("Escribí qué es y por qué se acepta.");
    }
  });

  it("un tipo que no existe falla, y la entrada no registra nada", () => {
    const { fallas, resultado } = fallasDe({ tipo: "inventado" });
    expect(fallas[0]?.donde).toEqual({ tipo: "json", camino: [0, "tipo"] });
    expect(fallas.map((f) => [f.codigo, f.motivo])).toEqual([
      ["deuda-entrada-invalida", "Entrada «ts-expect-error--a-ts»: el tipo «inventado» no existe."],
      [
        "deuda-sin-registrar",
        "Marcador «ts-expect-error» sin registrar: no hay una entrada del registro para ese tipo en este archivo.",
      ],
    ]);
    expect(fallas[0]?.correccion).toBe(`Elegí uno de: ${libro.TIPOS.join(", ")}.`);
    expect(resultado.entradas).toEqual([]);
  });

  it("sin tipo, el motivo lo dice", () => {
    const { fallas } = fallasDe({ tipo: undefined });
    expect(fallas[0]?.motivo).toBe(
      "Entrada «ts-expect-error--a-ts»: el tipo «undefined» no existe.",
    );
  });

  it.each([
    [undefined],
    [[]],
    ["a.ts"],
    [[""]],
    [["a.ts", 5]],
    [["carpeta/"]],
    [["*.ts"]],
    [["../a.ts"]],
  ])("«archivos» %j no es una lista de rutas exactas", (archivos) => {
    const { fallas, resultado } = fallasDe({ archivos });
    expect(fallas[0]).toMatchObject({
      codigo: "deuda-entrada-invalida",
      motivo:
        "Entrada «ts-expect-error--a-ts»: «archivos» tiene que ser una lista de rutas exactas (archivos, sin carpetas ni comodines).",
      correccion: "Listá los archivos con su ruta completa desde la raíz.",
      donde: { tipo: "json", camino: [0, "archivos"] },
    });
    expect(resultado.entradas).toEqual([]);
  });

  it("repetir un archivo falla, y la entrada no registra nada", () => {
    const { fallas, resultado } = fallasDe({ tipo: "backlog", archivos: ["a.ts", "a.ts"] });
    expect(fallas.filter((f) => f.codigo === "deuda-entrada-invalida").map(forma)).toEqual([
      [
        "deuda-entrada-invalida",
        "Entrada «ts-expect-error--a-ts»: «archivos» repite un archivo.",
        { tipo: "json", camino: [0, "archivos"] },
      ],
    ]);
    expect(fallas[0]?.correccion).toBe("Listá cada archivo una sola vez.");
    expect(resultado.entradas).toEqual([]);
  });

  it("un marcador se registra por archivo: dos archivos en una entrada de marcador falla", () => {
    const { fallas, resultado } = fallasDe({ archivos: ["a.ts", "b.ts"] }, { "b.ts": SIN_DEUDA });
    expect(fallas[0]).toMatchObject({
      codigo: "deuda-entrada-invalida",
      motivo:
        "Entrada «ts-expect-error--a-ts»: un marcador «ts-expect-error» se registra por archivo: la entrada lleva exactamente uno.",
      correccion: "Una entrada por tipo y archivo.",
      donde: { tipo: "json", camino: [0, "archivos"] },
    });
    expect(resultado.entradas).toEqual([]);
  });

  it("un hallazgo sí puede llevar varios archivos", () => {
    const { resultado } = conEntradas(
      [entrada({ id: "h", tipo: "backlog", archivos: ["a.ts", "b.ts"] })],
      { "b.ts": SIN_DEUDA },
    );
    expect(resultado.fallas.map((f) => f.codigo)).toEqual(["deuda-sin-registrar"]);
    expect(resultado.entradas.map((e) => e.archivos)).toEqual([["a.ts", "b.ts"]]);
  });

  it("«verificacion» solo va en un hallazgo y tiene la forma { contiene }", () => {
    const enMarcador = fallasDe({ verificacion: { contiene: "x" } });
    expect(enMarcador.fallas.map((f) => f.motivo)).toEqual([
      "Entrada «ts-expect-error--a-ts»: solo un hallazgo lleva «verificacion»: un marcador lo verifica el detector.",
    ]);
    expect(enMarcador.fallas[0]?.correccion).toBe("Sacala.");
    expect(enMarcador.fallas[0]?.donde).toEqual({ tipo: "json", camino: [0, "verificacion"] });
    const malFormada = conEntradas([entrada({ tipo: "backlog", verificacion: "texto" })]);
    expect(malFormada.resultado.fallas[0]?.correccion).toBe("Corregí su forma.");
    for (const verificacion of [
      "texto",
      { contiene: "" },
      { contiene: 5 },
      { otra: "x" },
      { contiene: "x", otra: "y" },
      [],
      null,
    ]) {
      const { fallas } = conEntradas([entrada({ tipo: "backlog", verificacion })]).resultado;
      expect(
        fallas.filter((f) => f.codigo === "deuda-entrada-invalida").map(forma),
        JSON.stringify(verificacion),
      ).toEqual([
        [
          "deuda-entrada-invalida",
          'Entrada «ts-expect-error--a-ts»: «verificacion» es `{ "contiene": "texto" }`.',
          { tipo: "json", camino: [0, "verificacion"] },
        ],
      ]);
    }
  });

  it("un id repetido falla en el id de la segunda entrada", () => {
    const { resultado, registro } = conEntradas([entrada(), entrada({ tipo: "todo" })]);
    expect(
      resultado.fallas.filter((f) => f.codigo === "deuda-entrada-invalida").map(forma),
    ).toEqual([
      [
        "deuda-entrada-invalida",
        "Entrada «ts-expect-error--a-ts»: el id «ts-expect-error--a-ts» está repetido.",
        { tipo: "json", camino: [1, "id"] },
      ],
    ]);
    expect(lineaDe(registro, '"id"', 2)).toBe(13);
    expect(resultado.fallas[0]?.correccion).toBe("Cada entrada lleva un id propio.");
  });

  it("las entradas sin id (o con un id que no es texto) no se cuentan como repetidas entre sí", () => {
    for (const id of [undefined, 5, "", "  "]) {
      const { resultado } = conEntradas([
        entrada({ id, tipo: "backlog" }),
        entrada({ id, tipo: "todo" }),
      ]);
      expect(
        resultado.fallas.filter((f) => f.motivo.includes("repetido")),
        String(id),
      ).toEqual([]);
    }
  });

  it("una entrada sin id se nombra por su posición en los mensajes", () => {
    const { resultado } = conEntradas([entrada({ id: undefined, descripcion: "" })]);
    const motivos = resultado.fallas.map((f) => f.motivo);
    expect(motivos).toContain("Entrada 1: falta la descripción (qué es la deuda).");
    expect(motivos).toContain("Deuda: el campo «id» falta o está vacío.");
  });

  it("las fallas de forma de dos entradas se ubican cada una en la suya", () => {
    const { resultado } = conEntradas([entrada({ a: 1 }), entrada({ id: "otra", b: 1 })]);
    expect(resultado.fallas.map((f) => f.donde)).toEqual([
      { tipo: "json", camino: [0, "a"] },
      { tipo: "json", camino: [1, "b"] },
    ]);
  });
});

describe("los campos comunes (id, responsable, creada) de una entrada que no es excepción", () => {
  const motivos = (cambios: Record<string, unknown>) =>
    conEntradas([entrada(cambios)]).resultado.fallas.map((f) => [f.codigo, f.motivo, f.donde]);

  it("sin responsable falla, con el código de la deuda y no el de las excepciones", () => {
    expect(motivos({ responsable: "" })).toEqual([
      [
        "deuda-entrada-invalida",
        "Deuda «ts-expect-error--a-ts»: el campo «responsable» falta o está vacío.",
        { tipo: "json", camino: [0, "responsable"] },
      ],
    ]);
  });

  it("una creada que no es una fecha, o que es futura, falla como entrada de deuda", () => {
    expect(motivos({ creada: "ayer" })).toEqual([
      [
        "deuda-entrada-invalida",
        "Deuda «ts-expect-error--a-ts»: «creada» («ayer») no es una fecha válida AAAA-MM-DD.",
        { tipo: "json", camino: [0, "creada"] },
      ],
    ]);
    expect(motivos({ creada: "2026-10-23" })).toEqual([
      [
        "deuda-entrada-invalida",
        "Deuda «ts-expect-error--a-ts»: «creada» (2026-10-23) es posterior a hoy (2026-10-22).",
        { tipo: "json", camino: [0, "creada"] },
      ],
    ]);
  });

  it("la creada de hoy y la vieja son válidas (la antigüedad de la deuda no vence)", () => {
    expect(motivos({ creada: "2026-10-22" })).toEqual([]);
    expect(motivos({ creada: "2020-01-01" })).toEqual([]);
  });
});

describe("las excepciones (motivo, aprobadoPor y vence) usan el control de las del guardián", () => {
  const dePrueba = (cambios: Record<string, unknown>) => {
    const { resultado, registro } = conEntradas([excepcion(cambios)]);
    return { resultado, registro };
  };

  it("una excepción sana es vigente, no falla y se normaliza con su vencimiento", () => {
    const { resultado } = dePrueba({});
    expect(resultado.fallas).toEqual([]);
    expect(resultado.entradas).toEqual([
      expect.objectContaining({
        excepcion: true,
        vigente: true,
        creada: HOY_DE_LA_EXCEPCION,
        vence: "2026-11-21",
      }),
    ]);
  });

  it("vencida: falla en la línea de «vence» con el código del guardián y deja de ser vigente", () => {
    const { resultado, registro } = dePrueba({ creada: "2026-08-01", vence: "2026-09-30" });
    expect(resultado.fallas.map((f) => [f.codigo, f.motivo])).toEqual([
      [
        "excepcion-vencida",
        "Excepción de deuda «ts-expect-error--a-ts»: venció el 2026-09-30 (hoy es 2026-10-22).",
      ],
    ]);
    expect(resultado.fallas[0]?.donde).toEqual({ tipo: "json", camino: [0, "vence"] });
    expect(resultado.fallas[0]?.correccion).toBe(
      "Corregí lo que silenciaba, o renovala con nueva aprobación y un vencimiento próximo.",
    );
    expect(resultado.entradas[0]?.vigente).toBe(false);
    expect(lineaDe(registro, '"vence"')).toBe(13);
  });

  it("vence hoy: todavía vale (falla recién el día siguiente) y avisa", () => {
    const { resultado } = dePrueba({ creada: "2026-09-22", vence: "2026-10-22" });
    expect(resultado.fallas).toEqual([]);
    expect(resultado.entradas[0]?.vigente).toBe(true);
    expect(resultado.avisos.map((a) => a.codigo)).toEqual(["excepcion-por-vencer"]);
  });

  it("de más de 60 días entre creada y vence: falla", () => {
    const { resultado } = dePrueba({ creada: "2026-10-22", vence: "2026-12-22" });
    expect(resultado.fallas.map((f) => [f.codigo, f.motivo])).toEqual([
      [
        "excepcion-plazo-excesivo",
        "Excepción de deuda «ts-expect-error--a-ts»: dura 61 días (de 2026-10-22 a 2026-12-22) y el máximo es 60.",
      ],
    ]);
    expect(resultado.entradas[0]?.vigente).toBe(false);
  });

  it("de exactamente 60 días: vale", () => {
    const { resultado } = dePrueba({ creada: "2026-10-22", vence: "2026-12-21" });
    expect(resultado.fallas).toEqual([]);
    expect(resultado.entradas[0]?.vigente).toBe(true);
  });

  it("vence antes de la creación: falla (y, como ya pasó, también está vencida)", () => {
    const { resultado } = dePrueba({ creada: "2026-10-22", vence: "2026-10-21" });
    expect(resultado.fallas.map((f) => f.codigo)).toEqual([
      "excepcion-vence-antes-de-creada",
      "excepcion-vencida",
    ]);
  });

  it("creada en el futuro: falla con el código de las excepciones", () => {
    const { resultado } = dePrueba({ creada: "2026-10-23", vence: "2026-11-21" });
    expect(resultado.fallas.map((f) => [f.codigo, f.donde])).toEqual([
      ["excepcion-creada-futura", { tipo: "json", camino: [0, "creada"] }],
    ]);
  });

  it.each(["motivo", "aprobadoPor", "vence"])(
    "un «%s» vacío es una excepción inválida",
    (campo) => {
      const { resultado } = dePrueba({ [campo]: "" });
      expect(resultado.fallas.map((f) => [f.codigo, f.motivo, f.donde])).toEqual([
        [
          "excepcion-invalida",
          `Excepción de deuda «ts-expect-error--a-ts»: el campo «${campo}» falta o está vacío.`,
          { tipo: "json", camino: [0, campo] },
        ],
      ]);
      expect(resultado.entradas[0]?.vigente).toBe(false);
    },
  );

  it("con solo una parte de los campos de excepción, falla por los que faltan (todo o nada)", () => {
    const { resultado } = conEntradas([entrada({ motivo: "Solo el motivo." })]);
    expect(resultado.fallas.map((f) => [f.codigo, f.motivo])).toEqual([
      [
        "excepcion-invalida",
        "Excepción de deuda «ts-expect-error--a-ts»: el campo «aprobadoPor» falta o está vacío.",
      ],
      [
        "excepcion-invalida",
        "Excepción de deuda «ts-expect-error--a-ts»: el campo «vence» falta o está vacío.",
      ],
    ]);
    expect(resultado.entradas[0]).toMatchObject({
      excepcion: true,
      vigente: false,
      vence: undefined,
    });
  });

  it("una fecha mal escrita en una excepción es inválida, no vencida", () => {
    const { resultado } = dePrueba({ vence: "mañana" });
    expect(resultado.fallas.map((f) => [f.codigo, f.motivo])).toEqual([
      [
        "excepcion-invalida",
        "Excepción de deuda «ts-expect-error--a-ts»: «vence» («mañana») no es una fecha válida AAAA-MM-DD.",
      ],
    ]);
  });

  it("una excepción con un campo de forma inválida no es vigente aunque sus fechas estén bien", () => {
    const { resultado } = conEntradas([excepcion({ sobrante: 1 })]);
    expect(resultado.fallas.map((f) => f.codigo)).toEqual(["deuda-entrada-invalida"]);
    expect(resultado.entradas[0]?.vigente).toBe(false);
  });

  it("avisa desde 14 días antes del vencimiento, con el aviso del guardián en la línea del id", () => {
    const aviso = (vence: string) =>
      conEntradas([excepcion({ creada: "2026-09-01", vence })]).resultado.avisos;
    expect(aviso("2026-11-06")).toEqual([]);
    expect(aviso("2026-11-05")).toEqual([
      {
        codigo: "excepcion-por-vencer",
        archivo: REGISTRO,
        contrato: "deuda",
        motivo:
          "Excepción de deuda «ts-expect-error--a-ts»: vence el 2026-11-05 (faltan 14 días; hoy es 2026-10-22).",
        correccion:
          "Renovala con nueva aprobación y un vencimiento próximo, o corregí lo que silencia: al vencer, bloquea la integración.",
        donde: { tipo: "json", camino: [0, "id"] },
      },
    ]);
    expect(aviso("2026-10-23").map((a) => a.motivo)).toEqual([
      "Excepción de deuda «ts-expect-error--a-ts»: vence el 2026-10-23 (faltan 1 días; hoy es 2026-10-22).",
    ]);
  });
});

const HOY_DE_LA_EXCEPCION = "2026-10-22";

describe("los archivos de una entrada y si el problema sigue", () => {
  it("un archivo que no está versionado falla en «archivos», nombrándolos", () => {
    const { resultado, registro } = conEntradas(
      [entrada({ id: "h", tipo: "backlog", archivos: ["a.ts", "no-esta.ts", "tampoco.ts"] })],
      {},
      {},
      0,
    );
    expect(resultado.fallas.map((f) => [f.codigo, f.motivo, f.donde, f.correccion])).toEqual(
      [
        [
          "deuda-archivo-inexistente",
          "La entrada «h» apunta a «no-esta.ts», «tampoco.ts», que no es un archivo versionado.",
          { tipo: "json", camino: [0, "archivos"] },
          "Corregí la ruta, o borrá la entrada si el archivo ya no existe.",
        ],
        expect.anything(),
      ].slice(0, 1),
    );
    expect(lineaDe(registro, '"archivos"')).toBe(4);
  });

  it("un marcador cuyo archivo no existe falla por inexistente, no por resuelto", () => {
    const { resultado } = conEntradas([entrada({ archivos: ["x.ts"] })]);
    expect(resultado.fallas.map((f) => f.codigo)).toEqual([
      "deuda-archivo-inexistente",
      "deuda-sin-registrar",
    ]);
    expect(resultado.avisos).toEqual([]);
  });

  it("una entrada de marcador que ya no tiene el marcador avisa que la deuda se pagó (no falla)", () => {
    const { resultado } = conEntradas([entrada({ tipo: "todo" })]);
    expect(resultado.avisos).toEqual([
      {
        codigo: "deuda-resuelta",
        archivo: REGISTRO,
        contrato: "deuda",
        motivo:
          "La entrada «ts-expect-error--a-ts» ya no tiene el problema: el detector (o su verificación) no lo encuentra.",
        correccion: "Borrala del registro: la deuda se pagó.",
        donde: { tipo: "json", camino: [0, "id"] },
      },
    ]);
    expect(resultado.fallas.map((f) => f.codigo)).toEqual(["deuda-sin-registrar"]);
  });

  it("una excepción que ya no cubre nada falla como obsoleta (una puerta abierta)", () => {
    const { resultado } = conEntradas([excepcion({ tipo: "todo" })]);
    expect(resultado.fallas.filter((f) => f.codigo === "excepcion-obsoleta")).toEqual([
      {
        codigo: "excepcion-obsoleta",
        archivo: REGISTRO,
        contrato: "deuda",
        motivo: "La excepción «ts-expect-error--a-ts» no cubre nada: el problema ya se resolvió.",
        correccion: "Borrala: una excepción que no se usa queda como una puerta abierta.",
        donde: { tipo: "json", camino: [0, "id"] },
      },
    ]);
    expect(resultado.avisos.map((a) => a.codigo)).not.toContain("deuda-resuelta");
  });

  it("un hallazgo con verificación sigue abierto mientras alguno de sus archivos contenga el texto", () => {
    const abierta = entrada({
      id: "h",
      tipo: "backlog",
      archivos: ["a.ts", "b.ts"],
      verificacion: { contiene: "PENDIENTE" },
    });
    const conTexto = conEntradas([abierta], { "b.ts": "// PENDIENTE de extraer\n" }).resultado;
    expect(conTexto.fallas.map((f) => f.codigo)).toEqual(["deuda-sin-registrar"]);
    expect(conTexto.avisos).toEqual([]);
    const sinTexto = conEntradas([abierta], { "b.ts": SIN_DEUDA }).resultado;
    expect(sinTexto.avisos.map((a) => a.codigo)).toEqual(["deuda-resuelta"]);
    // un archivo que no se puede leer cuenta como que no tiene el texto
    const archivos = mundo({ "a.ts": SIN_DEUDA, "b.ts": SIN_DEUDA }, [abierta]);
    const leer = (ruta: string) => (ruta === "b.ts" ? null : (archivos[ruta] ?? null));
    const ilegible = libro.evaluarArbol({
      arbol: { rutas: Object.keys(archivos), leer },
      ahora: AHORA,
    });
    expect(ilegible.avisos.map((a) => a.codigo)).toEqual(["deuda-resuelta"]);
  });

  it("un hallazgo sin verificación se da por abierto: la máquina no sabe si se resolvió", () => {
    const { resultado } = conEntradas([entrada({ id: "h", tipo: "intermitente" })], {}, {}, 0);
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toEqual([]);
  });

  it("una excepción de un hallazgo con verificación que ya no se cumple también es obsoleta", () => {
    const { resultado } = conEntradas(
      [excepcion({ id: "e", tipo: "backlog", verificacion: { contiene: "NO ESTA" } })],
      {},
      {},
      0,
    );
    expect(resultado.fallas.map((f) => [f.codigo, f.motivo])).toEqual([
      ["excepcion-obsoleta", "La excepción «e» no cubre nada: el problema ya se resolvió."],
    ]);
  });
});

describe("el tope de excepciones abiertas", () => {
  const varias = (cuantas: number, tope: number) => {
    const entradas = Array.from({ length: cuantas }, (_, i) =>
      excepcion({ id: `e${String(i)}`, tipo: "backlog", archivos: ["a.ts"] }),
    );
    return conEntradas(entradas, {}, { topeDeExcepciones: tope }, 0);
  };

  it("dentro del tope (incluso justo en el tope) no falla", () => {
    expect(varias(3, 3).resultado.fallas).toEqual([]);
    expect(varias(0, 0).resultado.fallas).toEqual([]);
    expect(varias(2, 3).resultado.fallas).toEqual([]);
  });

  it("pasado el tope falla en el id de la primera que sobra, diciendo cuántas hay", () => {
    const { resultado, registro } = varias(4, 3);
    expect(resultado.fallas).toEqual([
      {
        codigo: "deuda-tope-de-excepciones",
        archivo: REGISTRO,
        contrato: "deuda",
        motivo:
          "Hay 4 excepciones abiertas y el tope es 3: la excepción no puede volverse la norma.",
        correccion: "Pagá deuda (que la excepción deje de hacer falta) antes de abrir otra.",
        donde: { tipo: "json", camino: [3, "id"] },
      },
    ]);
    expect(lineaDe(registro, '"id"', 4)).toBe(42);
  });

  it("con tope 0 cualquier excepción sobra", () => {
    const { resultado } = varias(1, 0);
    expect(resultado.fallas.map((f) => [f.codigo, f.donde])).toEqual([
      ["deuda-tope-de-excepciones", { tipo: "json", camino: [0, "id"] }],
    ]);
  });

  it("solo cuentan las excepciones, no la deuda común", () => {
    const entradas = [
      entrada({ id: "p1", tipo: "backlog" }),
      entrada({ id: "p2", tipo: "backlog" }),
      excepcion({ id: "e1", tipo: "backlog" }),
    ];
    expect(conEntradas(entradas, {}, { topeDeExcepciones: 1 }, 0).resultado.fallas).toEqual([]);
  });
});

describe("los marcadores sin registrar", () => {
  it("cada marcador sin entrada falla en su archivo y su línea", () => {
    const { resultado } = conEntradas([], { "b.ts": lineas("x;", "// TODO: y") }, {}, 2);
    const [primera, segunda, tercera, ...resto] = resultado.fallas;
    expect(resto).toEqual([]);
    expect(primera).toEqual({
      codigo: "deuda-sin-registrar",
      archivo: "a.ts",
      linea: 1,
      contrato: "deuda",
      motivo:
        "Marcador «ts-expect-error» sin registrar: no hay una entrada del registro para ese tipo en este archivo.",
      correccion: `Resolvelo, o registralo en ${REGISTRO} con su excepción (motivo, aprobadoPor y vence, como máximo 60 días).`,
    });
    expect(segunda).toMatchObject({ archivo: "a.ts", linea: 2 });
    expect(tercera).toMatchObject({ archivo: "b.ts", linea: 2 });
    expect(tercera?.motivo).toContain("«todo»");
  });

  it("registrar un tipo no registra los demás tipos del archivo, ni el mismo tipo en otro archivo", () => {
    const { resultado } = conEntradas(
      [entrada()],
      { "b.ts": "// @ts-expect-error x\n", "c.ts": "// TODO: y\n" },
      {},
      1,
    );
    expect(lugaresDe(resultado.fallas)).toEqual(["b.ts:1", "c.ts:1"]);
  });

  it("un hallazgo del mismo archivo y tipo no registra marcadores (los tipos no se mezclan)", () => {
    const { resultado } = conEntradas([entrada({ tipo: "backlog" })]);
    expect(codigosDe(resultado.fallas)).toEqual(["deuda-sin-registrar"]);
  });

  it("una entrada cubre TODOS los marcadores de su tipo y archivo, sin importar cuántos", () => {
    expect(conEntradas([entrada()], {}, {}, 5).resultado.fallas).toEqual([]);
  });

  it("una entrada de excepción también registra", () => {
    expect(conEntradas([excepcion()], {}, {}, 2).resultado.fallas).toEqual([]);
  });

  it("una entrada mal formada en otro campo igual registra (no se suman fallas en cascada)", () => {
    const { resultado } = conEntradas([entrada({ sobrante: 1 })]);
    expect(codigosDe(resultado.fallas)).toEqual(["deuda-entrada-invalida"]);
  });
});

describe("el tamaño de los archivos (archivo-grande): medirlo y el trinquete", () => {
  /** Un archivo de código de `n` líneas (cada una en la suya, con salto final). */
  const deLineas = (n: number): string =>
    lineas(...Array.from({ length: n }, (_, i) => `export const x${String(i)} = ${String(i)};`));
  const GRANDE = (tamano: number, cambios: Record<string, unknown> = {}) =>
    entrada({
      id: "archivo-grande--src-a-ts",
      tipo: "archivo-grande",
      archivos: ["src/a.ts"],
      tamano,
      ...cambios,
    });
  const sinRegistrar = (archivo: string, linea: number) => ({
    codigo: "deuda-sin-registrar",
    archivo,
    linea,
    contrato: "deuda",
    motivo:
      "Marcador «archivo-grande» sin registrar: no hay una entrada del registro para ese tipo en este archivo.",
    correccion: `Resolvelo, o registralo en ${REGISTRO} con su excepción (motivo, aprobadoPor y vence, como máximo 60 días).`,
  });

  it("medir: un archivo que pasa del tope es un grupo con la primera línea de más y su tamaño", () => {
    const medicion = libro.medir(arbolDe({ "src/a.ts": deLineas(450), "src/b.ts": deLineas(400) }));
    expect(medicion.lista).toEqual([
      { tipo: "archivo-grande", archivo: "src/a.ts", lineas: [401], tamano: 450 },
    ]);
    expect(medicion.porClave.get(libro.claveDe("archivo-grande", "src/a.ts"))?.tamano).toBe(450);
    expect(libro.medir(arbolDe({ "src/a.ts": deLineas(401) })).lista[0]).toEqual({
      tipo: "archivo-grande",
      archivo: "src/a.ts",
      lineas: [401],
      tamano: 401,
    });
  });

  it("medir: los demás marcadores del mismo archivo siguen sin tamaño", () => {
    const texto = `// TODO: x\n${deLineas(450)}`;
    expect(libro.medir(arbolDe({ "src/a.ts": texto })).lista).toEqual([
      { tipo: "archivo-grande", archivo: "src/a.ts", lineas: [401], tamano: 451 },
      { tipo: "todo", archivo: "src/a.ts", lineas: [1] },
    ]);
  });

  it("medir: con opciones usa su tope y sus exclusiones", () => {
    const arbol = arbolDe({ "src/a.ts": deLineas(12), "src/b.ts": deLineas(12) });
    const opciones = { topeDeLineas: 10, excluidos: new Set(["src/b.ts"]) };
    expect(libro.medir(arbol, opciones).lista).toEqual([
      { tipo: "archivo-grande", archivo: "src/a.ts", lineas: [11], tamano: 12 },
    ]);
    expect(libro.medir(arbol).lista).toEqual([]);
  });

  it("opcionesDeMedicion toma el tope y las rutas excluidas de la configuración", () => {
    const opciones = libro.opcionesDeMedicion({
      ...CONFIGURACION_SANA,
      topeDeLineasPorArchivo: 123,
      excluidosDelTope: [
        { ruta: "src/a.ts", motivo: "Datos." },
        { ruta: "src/b.ts", motivo: "Datos." },
      ],
    });
    expect(opciones.topeDeLineas).toBe(123);
    expect([...opciones.excluidos]).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("evaluarArbol mide con el tope y las exclusiones de la configuración", () => {
    const archivos = mundo({ "src/a.ts": deLineas(12), "src/b.ts": deLineas(12) }, [], {
      topeDeLineasPorArchivo: 10,
      excluidosDelTope: [{ ruta: "src/b.ts", motivo: "Datos." }],
    });
    const { fallas, medicion } = evaluar(archivos);
    expect(fallas).toEqual([sinRegistrar("src/a.ts", 11)]);
    expect(medicion.lista.map((g) => g.archivo)).toEqual(["src/a.ts"]);
  });

  it("un archivo grande sin registrar falla UNA vez, en la línea siguiente al tope", () => {
    const { resultado } = conEntradas([], { "src/a.ts": deLineas(900) }, {}, 0);
    expect(resultado.fallas).toEqual([sinRegistrar("src/a.ts", 401)]);
  });

  it("registrado con su tamaño: pasa; el libro lo cuenta como un marcador de ese tipo", () => {
    const { resultado } = conEntradas([GRANDE(450)], { "src/a.ts": deLineas(450) }, {}, 0);
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toEqual([]);
    expect(resultado.entradas[0]).toMatchObject({ tipo: "archivo-grande", tamano: 450 });
    expect(libro.totales(resultado)).toMatchObject({
      marcadores: 1,
      total: 1,
      archivosConDeuda: 1,
      porTipo: { "archivo-grande": 1 },
    });
  });

  it("el trinquete: crecer sobre lo registrado falla en la primera línea de más, con su texto", () => {
    const { resultado } = conEntradas([GRANDE(450)], { "src/a.ts": deLineas(455) }, {}, 0);
    expect(resultado.fallas).toEqual([
      {
        codigo: "deuda-archivo-crece",
        archivo: "src/a.ts",
        linea: 451,
        contrato: "deuda",
        motivo:
          "El archivo mide 455 líneas y el libro registra 450 («archivo-grande--src-a-ts»): un archivo sobre el tope de 400 líneas no puede crecer.",
        correccion:
          "Achicá el archivo (el trinquete solo baja), o pedí una excepción (motivo, aprobadoPor y vence ≤ 60 días) en el registro.",
      },
    ]);
  });

  it("el trinquete usa el tope de la configuración en su mensaje", () => {
    const archivos = mundo({ "src/a.ts": deLineas(15) }, [GRANDE(12)], {
      topeDeLineasPorArchivo: 10,
    });
    expect(evaluar(archivos).fallas.map((f) => f.motivo)).toEqual([
      "El archivo mide 15 líneas y el libro registra 12 («archivo-grande--src-a-ts»): un archivo sobre el tope de 10 líneas no puede crecer.",
    ]);
  });

  it("achicarse (sin bajar del tope) avisa que el tamaño registrado tiene que bajar, en la clave tamano", () => {
    const { resultado } = conEntradas([GRANDE(450)], { "src/a.ts": deLineas(420) }, {}, 0);
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toEqual([
      {
        codigo: "deuda-tamano-desactualizado",
        archivo: REGISTRO,
        contrato: "deuda",
        motivo:
          "La entrada «archivo-grande--src-a-ts» registra 450 líneas y el archivo mide 420: el trinquete tiene que bajar con él.",
        correccion: 'Poné "tamano": 420 en la entrada.',
        donde: { tipo: "json", camino: [0, "tamano"] },
      },
    ]);
  });

  it("bajar del tope: la entrada se pagó y avisa que se borre", () => {
    const { resultado } = conEntradas([GRANDE(450)], { "src/a.ts": deLineas(400) }, {}, 0);
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos.map((a) => a.codigo)).toEqual(["deuda-resuelta"]);
  });

  it("un tamaño registrado que no es un entero ≥ 1 falla en la clave y no se compara", () => {
    for (const tamano of [undefined, 0, -3, 1.5, "450", null]) {
      const { resultado } = conEntradas(
        [GRANDE(1, { tamano })],
        { "src/a.ts": deLineas(900) },
        {},
        0,
      );
      expect(
        resultado.fallas.map((f) => [f.codigo, f.donde ?? f.archivo]),
        String(tamano),
      ).toEqual([["deuda-entrada-invalida", { tipo: "json", camino: [0, "tamano"] }]]);
      expect(resultado.fallas[0]?.motivo).toBe(
        "Entrada «archivo-grande--src-a-ts»: un «archivo-grande» registra su tamaño: «tamano» es un entero (líneas) mayor o igual que 1.",
      );
      expect(resultado.fallas[0]?.correccion).toBe("Poné las líneas que mide hoy el archivo.");
      expect(resultado.entradas[0]?.tamano).toBeNull();
    }
  });

  it("un tamaño de 1 línea es un entero válido (el mínimo)", () => {
    const { resultado } = conEntradas([GRANDE(1)], { "src/a.ts": deLineas(450) }, {}, 0);
    expect(resultado.entradas[0]?.tamano).toBe(1);
    expect(resultado.fallas.map((f) => f.codigo)).toEqual(["deuda-archivo-crece"]);
  });

  it("los marcadores que no son archivo-grande no traen la clave tamano", () => {
    const medicion = libro.medir(arbolDe({ "a.ts": "// TODO: x\n", "src/b.ts": deLineas(450) }));
    const [todo, grande] = medicion.lista;
    expect(todo).toBeDefined();
    expect(Object.keys(todo ?? {})).toEqual(["tipo", "archivo", "lineas"]);
    expect(Object.keys(grande ?? {})).toEqual(["tipo", "archivo", "lineas", "tamano"]);
  });

  it("«tamano» solo va en un archivo-grande", () => {
    const { resultado } = conEntradas([entrada({ tamano: 5 })], {}, {}, 1);
    expect(resultado.fallas.map((f) => [f.codigo, f.motivo, f.donde])).toEqual([
      [
        "deuda-entrada-invalida",
        "Entrada «ts-expect-error--a-ts»: solo un «archivo-grande» lleva «tamano».",
        { tipo: "json", camino: [0, "tamano"] },
      ],
    ]);
    expect(resultado.fallas[0]?.correccion).toBe("Sacalo.");
    expect(resultado.entradas[0]?.tamano).toBeNull();
  });

  it("una excepción vigente de archivo-grande admite crecer si actualiza el tamaño", () => {
    const e = excepcion({
      id: "archivo-grande--src-a-ts",
      tipo: "archivo-grande",
      archivos: ["src/a.ts"],
      tamano: 460,
    });
    const { resultado } = conEntradas([e], { "src/a.ts": deLineas(460) }, {}, 0);
    expect(resultado.fallas).toEqual([]);
    expect(resultado.entradas[0]).toMatchObject({ excepcion: true, vigente: true, tamano: 460 });
  });
});

describe("los archivos ilegibles se reportan como fallas", () => {
  it("un archivo que se debía analizar y no se pudo leer falla en él mismo, línea 1", () => {
    const archivos = mundo({ "a.ts": SIN_DEUDA, "roto.ts": SIN_DEUDA });
    const leer = (ruta: string) => (ruta === "roto.ts" ? null : (archivos[ruta] ?? null));
    const { fallas } = libro.evaluarArbol({
      arbol: { rutas: Object.keys(archivos), leer },
      ahora: AHORA,
    });
    expect(fallas).toEqual([
      {
        codigo: "deuda-archivo-ilegible",
        archivo: "roto.ts",
        linea: 1,
        contrato: "deuda",
        motivo:
          "No se pudo analizar el archivo: no se pudo leer el archivo. Sin eso no se sabe si tiene deuda.",
        correccion: "Dejalo legible y con la forma de siempre.",
      },
    ]);
  });

  it("un knip.json roto falla con la línea del error del analizador", () => {
    const { fallas } = evaluar(mundo({ "knip.json": '{\n  "ignore": [\n' }));
    expect(fallas.map((f) => [f.codigo, f.archivo, f.linea, f.motivo])).toEqual([
      [
        "deuda-archivo-ilegible",
        "knip.json",
        2,
        "No se pudo analizar el archivo: no es JSON válido. Sin eso no se sabe si tiene deuda.",
      ],
    ]);
  });
});

describe("el catálogo de tipos y de códigos", () => {
  it("los tipos son los marcadores y los hallazgos", () => {
    expect(libro.TIPOS).toEqual([...marcadores.TIPOS_DE_MARCADOR, ...libro.TIPOS_DE_HALLAZGO]);
    expect(libro.TIPOS_DE_HALLAZGO).toEqual([
      "auditoria",
      "backlog",
      "intermitente",
      "riesgo-aceptado",
      "brecha",
    ]);
    expect(libro.ARCHIVO_DEL_REGISTRO).toBe("arquitectura/deuda/registro.json");
    expect(libro.ARCHIVO_DE_LA_CONFIGURACION).toBe("arquitectura/deuda/configuracion.json");
    expect(libro.CONTRATO).toBe("deuda");
  });

  it("delRegistro arma una falla del registro con el descriptor de línea", () => {
    expect(libro.delRegistro("deuda-resuelta", "m", "c", { tipo: "archivo" })).toEqual({
      codigo: "deuda-resuelta",
      archivo: REGISTRO,
      contrato: "deuda",
      motivo: "m",
      correccion: "c",
      donde: { tipo: "archivo" },
    });
  });

  it("lineaCon da la primera línea con el texto, o null", () => {
    expect(libro.lineaCon("a\nb\nc b\n", "b")).toBe(2);
    expect(libro.lineaCon("a\nb\n", "z")).toBeNull();
    expect(libro.lineaCon("", "z")).toBeNull();
  });

  it("textoDe lee un archivo como texto (de un Buffer o de un string) y da null si no se puede leer", () => {
    const leer = (ruta: string) => ({ "a.ts": "uno", "b.ts": Buffer.from("dos") })[ruta] ?? null;
    expect(libro.textoDe(leer, "a.ts")).toBe("uno");
    expect(libro.textoDe(leer, "b.ts")).toBe("dos");
    expect(libro.textoDe(leer, "c.ts")).toBeNull();
  });

  it("claveDe separa tipo y archivo con un carácter nulo", () => {
    expect(libro.claveDe("todo", "a.ts")).toBe("todo\0a.ts");
  });
});
