import { describe, expect, it } from "vitest";
import { job, lineas, nd } from "./guardian-mutantes-d-apoyo";
import type { Paso } from "./guardian-mutantes-d-apoyo";

/**
 * Vigilancia de la versión anterior, parte de LECTURA (`no-debilitar.cjs`): comparar versiones, reconocer el
 * comando del guardián, leer `ci.yml` como texto (jobs, `needs`, `if`, pasos, `continue-on-error`), las
 * constantes de rigor, `retiros.json`, `package.json` y la lista de invariantes. Cada caso arma el texto y
 * afirma lo que se lee, con líneas y mensajes exactos.
 */

describe("versionMayor: compara por tramos y no acepta lo mal formado", () => {
  it.each([
    ["1.2.4", "1.2.3", true],
    ["1.3.0", "1.2.9", true],
    ["2.0.0", "1.9.9", true],
    ["10.0.0", "9.0.0", true],
    ["1.0.5", "1.0.4", true],
    ["1.2.3", "1.2.3", false],
    ["1.2.3", "1.2.4", false],
    ["1.2.9", "1.3.0", false],
    ["1.5.0", "2.0.0", false],
    ["9.0.0", "10.0.0", false],
    ["9.1.2.3", "1.0.0", false],
    ["2.0.0", "9.1.2.3", false],
    ["x1.2.3", "1.0.0", false],
    ["2.0.0x", "1.0.0", false],
    [null, "1.0.0", false],
    ["2.0.0", undefined, false],
  ])("%s contra %s: %s", (nueva, vieja, esperado) => {
    expect(nd.versionMayor(nueva, vieja)).toBe(esperado);
  });
});

describe("ejecutaElGuardian: solo el comando tal cual, con opciones sueltas", () => {
  const GUARDIAN = "node arquitectura/contratos/guardian.cjs";
  it.each([
    GUARDIAN,
    `- ${GUARDIAN}`,
    `- run: ${GUARDIAN} --base=x`,
    `run: ${GUARDIAN} -v --base=ruta/a.b`,
    // Una opción que termina en guion deja un «- » adentro de la línea: no es un paso en lista.
    `run: ${GUARDIAN} --base- --x`,
  ])("lo reconoce: %s", (linea) => {
    expect(nd.ejecutaElGuardian(linea)).toBe(true);
  });

  it.each([
    "node",
    "node arquitectura/contratos",
    "",
    `${GUARDIAN} || true`,
    `${GUARDIAN} foo--bar`,
    `${GUARDIAN} --base&&echo`,
    `${GUARDIAN} --base;x`,
    `${GUARDIAN} - x`,
    `run: ${GUARDIAN} - x`,
    `echo ${GUARDIAN}`,
  ])("no lo reconoce: %s", (linea) => {
    expect(nd.ejecutaElGuardian(linea)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// leerCi
// ---------------------------------------------------------------------------------------------

const CI_LARGO = lineas(
  "name: CI", //                                                                     1
  "on: push", //                                                                     2
  "jobs:", //                                                                        3
  "# comentario en la columna cero", //                                              4
  "  # comentario sangrado", //                                                      5
  "  guardian:", //                                                                  6
  "    name: Guardián", //                                                           7
  "    if: github.ref == 'refs/heads/main' # solo main", //                          8
  "    needs:", //                                                                   9
  "      - estatico # primero", //                                                  10
  '      - "pruebas"', //                                                           11
  "    steps:", //                                                                  12
  "      - uses: actions/checkout@v7", //                                           13
  "      - name: Guardián", //                                                      14
  "        if: always()", //                                                        15
  "        run: node arquitectura/contratos/guardian.cjs", //                       16
  "        continue-on-error: true", //                                             17
  "", //                                                                            18
  "  estatico:", //                                                                 19
  '    needs: [a, "b" , c]', //                                                     20
  "    steps:", //                                                                  21
  "      - run: echo", //                                                           22
);

describe("leerCi: lee jobs, needs, if, pasos y continue-on-error con su línea", () => {
  it("un ci.yml con comentarios, comillas y comentarios al final de línea", () => {
    const leido = nd.leerCi(CI_LARGO);
    if (!("valor" in leido)) throw new Error(leido.error);
    expect(leido.lineaDeJobs).toBe(3);
    expect([...leido.valor.keys()]).toEqual(["guardian", "estatico"]);
    expect(leido.valor.get("guardian")).toStrictEqual({
      id: "guardian",
      linea: 6,
      needs: ["estatico", "pruebas"],
      lineaNeeds: 9,
      si: "github.ref == 'refs/heads/main'",
      lineaSi: 8,
      continuaConError: [17],
      pasos: [
        { desde: 13, hasta: 13, ejecutaGuardian: false, si: undefined },
        { desde: 14, hasta: 17, ejecutaGuardian: true, si: { valor: "always()", linea: 15 } },
      ],
    });
    expect(leido.valor.get("estatico")).toStrictEqual({
      id: "estatico",
      linea: 19,
      needs: ["a", "b", "c"],
      lineaNeeds: 20,
      si: undefined,
      lineaSi: undefined,
      continuaConError: [],
      pasos: [{ desde: 22, hasta: 22, ejecutaGuardian: false, si: undefined }],
    });
  });

  it("con saltos de línea de Windows se lee igual que con saltos simples", () => {
    // Incluye un `if` del job (su regex termina en `$` y un «\r» suelto lo haría fallar).
    const conWindows = CI_LARGO.replaceAll("\n", "\r\n");
    expect(nd.leerCi(conWindows)).toStrictEqual(nd.leerCi(CI_LARGO));
    expect(job(conWindows, "guardian").si).toBe("github.ref == 'refs/heads/main'");
  });

  it("un valor con comentario: el # pegado al texto no es un comentario, el precedido de espacio sí", () => {
    const texto = lineas(
      "jobs:",
      "  a:",
      "    if: x#y # nota",
      "    steps:",
      "      - if: 'a' # uno",
    );
    expect(job(texto, "a").si).toBe("x#y");
    expect(job(texto, "a").pasos[0]?.si).toStrictEqual({ valor: "a", linea: 5 });
    // Con tabuladores y varios espacios antes del #.
    expect(job(lineas("jobs:", "  a:", "    if: p \t  # nota"), "a").si).toBe("p");
  });

  it("las comillas se quitan solo si envuelven el valor entero", () => {
    const texto = lineas("jobs:", "  a:", '    if: "a" == "b"', '    needs: "x"y', "");
    expect(job(texto, "a").si).toBe('"a" == "b"');
    expect(job(texto, "a").needs).toEqual(['"x"y']);
    expect(job(lineas("jobs:", "  a:", "    if: 'a'"), "a").si).toBe("a");
  });

  it("el encabezado «jobs:» tiene que estar solo en su línea", () => {
    expect(nd.leerCi("name: x\n")).toStrictEqual({ error: "no hay una sección `jobs:`" });
    expect(nd.leerCi("jobs: {}\n")).toStrictEqual({ error: "no hay una sección `jobs:`" });
    expect(nd.leerCi("jobs:x\n  a:\n    runs-on: x\n")).toStrictEqual({
      error: "no hay una sección `jobs:`",
    });
    // Una línea que solo CONTIENE «jobs:» no es el encabezado: el verdadero es el de la línea 2.
    const leido = nd.leerCi("xjobs:\njobs:\n  a:\n    runs-on: x\n");
    if (!("valor" in leido)) throw new Error(leido.error);
    expect(leido.lineaDeJobs).toBe(2);
    expect([...leido.valor.keys()]).toEqual(["a"]);
    // Los espacios al final del encabezado y del nombre de un job no molestan.
    const conEspacios = nd.leerCi("jobs:  \n  a:  \n    runs-on: x\n");
    if (!("valor" in conEspacios)) throw new Error(conEspacios.error);
    expect([...conEspacios.valor.keys()]).toEqual(["a"]);
  });

  it("lo que no entiende lo rechaza con el motivo escrito", () => {
    expect(nd.leerCi("jobs:\n")).toStrictEqual({ error: "la sección `jobs:` no tiene ningún job" });
    expect(nd.leerCi("jobs:\n  a:\n    runs-on: x\n  a:\n")).toStrictEqual({
      error: "el job «a» está duplicado",
    });
    expect(nd.leerCi("jobs:\n  a:\n    steps: []\n  name: algo\n")).toStrictEqual({
      error: "línea inesperada en el nivel de los jobs: «name: algo»",
    });
    expect(nd.leerCi("jobs:\n  a:\n   x\n")).toStrictEqual({
      error: "línea inesperada en el nivel de los jobs: «x»",
    });
    expect(nd.leerCi("jobs:\n  a:x\n")).toStrictEqual({
      error: "línea inesperada en el nivel de los jobs: «a:x»",
    });
    expect(nd.leerCi("jobs:\n    steps: x\n")).toStrictEqual({
      error: "contenido antes del primer job: «steps: x»",
    });
    expect(nd.leerCi("jobs:\n  a:\n    needs: [b\n")).toStrictEqual({
      error: "job «a»: la lista `needs` no cierra",
    });
  });

  it("una línea en blanco (con o sin espacios) antes del primer job se salta, y una en un job queda en él", () => {
    const leido = nd.leerCi("jobs:\n   \n\n  a:\n    runs-on: x\n   \n    needs: b\n");
    if (!("valor" in leido)) throw new Error(leido.error);
    expect(leido.valor.get("a")?.needs).toEqual(["b"]);
    expect(leido.valor.get("a")?.lineaNeeds).toBe(7);
  });

  it("la sección jobs termina en la primera línea sin sangría y lo que sigue no cuenta", () => {
    const texto = lineas(
      "jobs:",
      "  a:",
      "    runs-on: x",
      "env:",
      "  continue-on-error: si",
      "  b:",
      "    runs-on: y",
    );
    const leido = nd.leerCi(texto);
    if (!("valor" in leido)) throw new Error(leido.error);
    expect([...leido.valor.keys()]).toEqual(["a"]);
    expect(leido.valor.get("a")?.continuaConError).toEqual([]);
  });

  it("los comentarios no cuentan: ni un continue-on-error ni un if comentados", () => {
    const texto = lineas(
      "jobs:",
      "  a:",
      "    # continue-on-error: true",
      "    # if: false",
      "    steps:",
      "      # - if: nunca",
      "      - run: x",
    );
    const a = job(texto, "a");
    expect(a.continuaConError).toEqual([]);
    expect(a.si).toBeUndefined();
    expect(a.pasos).toStrictEqual([{ desde: 7, hasta: 7, ejecutaGuardian: false, si: undefined }]);
  });
});

describe("leerCi: los pasos de steps", () => {
  const pasosDe = (...cuerpo: string[]): Paso[] =>
    job(lineas("jobs:", "  a:", ...cuerpo), "a").pasos;
  const paso = (desde: number, hasta: number, extra: Partial<Paso> = {}): Paso => ({
    desde,
    hasta,
    ejecutaGuardian: false,
    si: undefined,
    ...extra,
  });

  it("sin haber pasado por «steps:» no hay pasos, aunque haya líneas que parezcan uno", () => {
    expect(pasosDe("      - run: node arquitectura/contratos/guardian.cjs")).toEqual([]);
    expect(pasosDe("    needs:", "      - b", "    steps:", "      - run: x")).toEqual([
      paso(6, 6),
    ]);
  });

  it("«steps:» tiene que ser la propiedad entera: ni inline, ni en medio de una línea", () => {
    expect(pasosDe("    steps: []", "      - run: x")).toEqual([]);
    expect(pasosDe("    steps:x", "      - run: x")).toEqual([]);
    expect(pasosDe("    nota: a    steps:", "      - run: x")).toEqual([]);
    expect(pasosDe("    steps:  ", "      - run: x")).toEqual([paso(4, 4)]);
  });

  it("cada «- » a seis espacios abre un paso; la lista anidada y el guion solo se tratan bien", () => {
    expect(
      pasosDe(
        "    steps:",
        "      - name: x",
        "        with:",
        "          lista:",
        "            - uno",
        "            - dos",
        "      -",
        "        run: node arquitectura/contratos/guardian.cjs",
      ),
    ).toEqual([paso(4, 8), paso(9, 10, { ejecutaGuardian: true })]);
  });

  it("una línea antes del primer paso no lo rompe", () => {
    expect(pasosDe("    steps:", "        run: x", "      - run: y")).toEqual([paso(5, 5)]);
  });

  it("una línea en blanco con espacios dentro de un paso no alarga su rango", () => {
    expect(pasosDe("    steps:", "      - run: x", "      ", "      - run: y")).toEqual([
      paso(4, 4),
      paso(6, 6),
    ]);
  });

  it("el if de un paso: en su línea de guion o en la propia, con o sin valor, el primero manda", () => {
    expect(pasosDe("    steps:", "      - if: a")).toEqual([
      paso(4, 4, { si: { valor: "a", linea: 4 } }),
    ]);
    expect(pasosDe("    steps:", "      -   if: b")).toEqual([
      paso(4, 4, { si: { valor: "b", linea: 4 } }),
    ]);
    expect(pasosDe("    steps:", "      - if:c")).toEqual([
      paso(4, 4, { si: { valor: "c", linea: 4 } }),
    ]);
    expect(pasosDe("    steps:", "      - run: x", "        if:")).toEqual([
      paso(4, 5, { si: { valor: "", linea: 5 } }),
    ]);
    expect(pasosDe("    steps:", "      - run: x", "        if:d")).toEqual([
      paso(4, 5, { si: { valor: "d", linea: 5 } }),
    ]);
    expect(pasosDe("    steps:", "      - if: primero", "        if: segundo")).toEqual([
      paso(4, 5, { si: { valor: "primero", linea: 4 } }),
    ]);
  });

  it("un if que no es del paso (anidado, o escrito dentro de otro texto) no cuenta", () => {
    expect(
      pasosDe("    steps:", "      - run: echo      - if: x", "        with:", "          if: y"),
    ).toEqual([paso(4, 6)]);
    expect(pasosDe("    steps:", "      - run: x", "        env: {}        if: z")).toEqual([
      paso(4, 5),
    ]);
  });
});

describe("leerCi: needs en todas sus formas", () => {
  const needsDe = (...cuerpo: string[]) => {
    const j = job(lineas("jobs:", "  a:", ...cuerpo), "a");
    return [j.needs, j.lineaNeeds] as const;
  };

  it("sin needs: lista vacía y sin línea", () => {
    expect(needsDe("    runs-on: x")).toStrictEqual([[], undefined]);
  });

  it("un needs escrito dentro de otra línea no es el needs del job", () => {
    expect(needsDe("    steps:", "      - run: echo    needs: bogus")).toStrictEqual([
      [],
      undefined,
    ]);
  });

  it("needs sin valor al final del job, o con la lista de flujo en la línea de abajo", () => {
    // Sin salto de línea al final: «needs:» es de verdad la última línea del archivo.
    const alFinal = nd.leerCi("jobs:\n  a:\n    needs:");
    if (!("valor" in alFinal)) throw new Error(alFinal.error);
    expect(alFinal.valor.get("a")?.needs).toEqual([]);
    expect(alFinal.valor.get("a")?.lineaNeeds).toBe(3);
    expect(needsDe("    needs:")).toStrictEqual([[], 3]);
    expect(needsDe("    needs:", "      [a, b] # nota")).toStrictEqual([["a", "b"], 3]);
    expect(needsDe("    needs: # nota", "      [a]")).toStrictEqual([["a"], 3]);
  });

  it("un needs con valor no toma una lista que casualmente empiece abajo", () => {
    expect(needsDe("    needs: guardian # nota", "    [x]")).toStrictEqual([["guardian"], 3]);
  });

  it("la lista de bloque termina en la primera línea que no es un elemento", () => {
    expect(
      needsDe("    needs:", "      - a", "      -   b # c", "    note: z     - y"),
    ).toStrictEqual([["a", "b"], 3]);
    expect(needsDe("    needs:", "      - a", "", "      - b")).toStrictEqual([["a"], 3]);
  });

  it("la lista de flujo puede seguir en varias líneas", () => {
    expect(needsDe("    needs: [a,", "      b, # nota", "      c]")).toStrictEqual([
      ["a", "b", "c"],
      3,
    ]);
  });
});

describe("leerCi: continue-on-error del job y de cada paso", () => {
  it("anota la línea de cada mención, en el job o en cualquier paso", () => {
    const texto = lineas(
      "jobs:",
      "  a:",
      "    continue-on-error: true",
      "    steps:",
      "      - run: x",
      "        continue-on-error: true",
    );
    expect(job(texto, "a").continuaConError).toEqual([3, 6]);
  });
});

// ---------------------------------------------------------------------------------------------
// Constantes, retiros y paquete
// ---------------------------------------------------------------------------------------------

describe("leerConstante, leerRetiros y leerPaquete", () => {
  const mensajeDeJson = (texto: string): string => {
    try {
      JSON.parse(texto);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("el texto de la prueba es JSON válido");
  };

  it("leerConstante: valor y línea, también en la última línea y con CRLF o comentario", () => {
    expect(nd.leerConstante(null, "A")).toStrictEqual({ ausente: true });
    expect(nd.leerConstante("// x\nconst A = 60;", "A")).toStrictEqual({ valor: 60, linea: 2 });
    expect(nd.leerConstante("x\r\nconst A = 7; // tope\r\nconst B = 8;\r\n", "A")).toStrictEqual({
      valor: 7,
      linea: 2,
    });
    expect(nd.leerConstante("const A = 60;\nconst B = 14;", "B")).toStrictEqual({
      valor: 14,
      linea: 2,
    });
    expect(nd.leerConstante("const A = 6.5;\n", "A")).toStrictEqual({
      error: "no hay una línea «const A = <entero>;»",
    });
  });

  it("leerRetiros: sin archivo es una lista vacía; lo demás se explica", () => {
    expect(nd.leerRetiros(null)).toStrictEqual({ valor: [] });
    expect(nd.leerRetiros('[{"id":"x"}]')).toStrictEqual({ valor: [{ id: "x" }] });
    expect(nd.leerRetiros("{}")).toStrictEqual({ error: "no es una lista" });
    expect(nd.leerRetiros("[ {")).toStrictEqual({
      error: `no es JSON válido (${mensajeDeJson("[ {")})`,
    });
  });

  it("leerPaquete: solo los dos scripts vigilados, y los errores se explican", () => {
    expect(nd.leerPaquete(null)).toStrictEqual({ ausente: true });
    expect(
      nd.leerPaquete('{"scripts":{"arquitectura":"a","guardian":"g","gate":"z"}}'),
    ).toStrictEqual({ valor: { arquitectura: "a", guardian: "g" } });
    const sinScripts = { valor: { arquitectura: undefined, guardian: undefined } };
    expect(nd.leerPaquete("null")).toStrictEqual(sinScripts);
    expect(nd.leerPaquete("[]")).toStrictEqual(sinScripts);
    expect(nd.leerPaquete('{"scripts":5}')).toStrictEqual(sinScripts);
    expect(nd.leerPaquete('{"scripts":[]}')).toStrictEqual(sinScripts);
    expect(nd.leerPaquete("{")).toStrictEqual({
      error: `no es JSON válido (${mensajeDeJson("{")})`,
    });
  });
});

describe("extraerInvariantes: tolerante a lo que trae la matriz", () => {
  it("salta lo que no es un invariante con id y da un id a las mutaciones sin él", () => {
    const lista = [
      null,
      5,
      { id: "I1" },
      { id: "  " },
      {
        id: "I2",
        mutaciones: [null, {}, { tipo: "a" }, { tipo: "a" }, { tipo: "b", id: "M" }, { id: " " }],
      },
    ];
    expect(nd.extraerInvariantes(lista)).toStrictEqual({
      ids: ["I1", "I2"],
      mutaciones: [
        { invariante: "I2", id: "?#1" },
        { invariante: "I2", id: "?#2" },
        { invariante: "I2", id: "a#1" },
        { invariante: "I2", id: "a#2" },
        { invariante: "I2", id: "M" },
        { invariante: "I2", id: "?#3" },
      ],
    });
  });

  it("sin lista en la exportación explica qué falta, incluso si no exporta nada", () => {
    const mensaje = /^no encuentro la lista de invariantes en la exportación$/;
    expect(() => nd.extraerInvariantes({})).toThrow(mensaje);
    expect(() => nd.extraerInvariantes(null)).toThrow(mensaje);
    expect(() => nd.extraerInvariantes(undefined)).toThrow(mensaje);
  });
});

describe("formatear y límites", () => {
  it("la línea es archivo:línea · contrato · motivo · corrección, con «-» si no hay contrato", () => {
    const base = { archivo: "a.ts", linea: 3, motivo: "m", correccion: "c" };
    expect(nd.formatear({ ...base, contrato: null })).toBe("a.ts:3 · - · m · c");
    expect(nd.formatear({ ...base, contrato: "x" })).toBe("a.ts:3 · x · m · c");
  });

  it("los límites son los cuatro que se dicen", () => {
    expect(nd.limites).toEqual([
      "un PR que quita el job y el paso que corre el verificador no lo ejecuta: lo cubre exigir los checks en la protección de main (G4)",
      "compara cantidades, clases, versiones y constantes, no la lógica de cada detector",
      "un PR que vacía este archivo se ve recién cuando es la base del PR siguiente",
      "los demás jobs de ci.yml los cubre gate-coincide-con-ci.test.ts",
    ]);
  });
});
