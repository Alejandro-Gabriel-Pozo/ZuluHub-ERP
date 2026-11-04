import { describe, expect, it } from "vitest";
import {
  A,
  ciLeido,
  instantanea,
  job,
  lineas,
  nd,
  ubicacion,
  type Hallazgo,
  type Instantanea,
} from "./guardian-mutantes-d-apoyo";

/**
 * La vigilancia de la versión anterior, parte (j): la deuda técnica (`no-debilitar.cjs`). Cada pieza nueva sobre
 * instantáneas sintéticas, con el texto exacto de lo que dice, el campo `donde` o `linea` que trae y el
 * comportamiento ante secciones ausentes o ilegibles.
 */

const nuevas = nd as unknown as {
  formaDeLaDeuda: (linea: string) => string | null;
  leerDeuda: (registro: string | null, configuracion: string | null) => Record<string, unknown>;
  chequearDeuda: (
    base: Instantanea,
    pr: Instantanea,
    contexto: { leerPr: (ruta: string) => Buffer | string | null },
  ) => Hallazgo[];
};
const A_DEUDA = A as unknown as { deudaRegistro: string; deudaConfiguracion: string };
const CONFIGURACION = A_DEUDA.deudaConfiguracion;
const REGISTRO = A_DEUDA.deudaRegistro;

describe("formaDeLaDeuda: la línea que corre deuda.cjs tal cual", () => {
  it.each([
    ["node arquitectura/deuda/deuda.cjs", "sola"],
    ["  node   arquitectura/deuda/deuda.cjs  ", "sola"],
    ["run: node arquitectura/deuda/deuda.cjs", "sola"],
    ["- run: node arquitectura/deuda/deuda.cjs", "sola"],
    ["      - run:    node arquitectura/deuda/deuda.cjs", "sola"],
    ["node arquitectura/deuda/deuda.cjs --base=base", "con-base"],
    ["    node arquitectura/deuda/deuda.cjs   --base=base   ", "con-base"],
    ["- run: node arquitectura/deuda/deuda.cjs --base=base", "con-base"],
  ])("«%s» es la forma %s", (linea, forma) => {
    expect(nuevas.formaDeLaDeuda(linea)).toBe(forma);
  });

  it.each([
    "",
    "node otra.cjs",
    "node arquitectura/deuda/deuda.cjs --sin-informe",
    "node arquitectura/deuda/deuda.cjs --base=otra",
    "node arquitectura/deuda/deuda.cjs --base base",
    "node arquitectura/deuda/deuda.cjs --base=base --sin-informe",
    "node arquitectura/deuda/deuda.cjs || true",
    "node arquitectura/deuda/deuda.cjs; echo",
    "node arquitectura/deuda/deuda.cjs && echo",
    "echo node arquitectura/deuda/deuda.cjs",
    "# node arquitectura/deuda/deuda.cjs",
    "nodo arquitectura/deuda/deuda.cjs",
    "node arquitectura/deuda/deuda.cjs.bak",
    "node arquitectura/contratos/guardian.cjs",
    "if [ -d base ]; then",
  ])("«%s» no es el comando de la deuda", (linea) => {
    expect(nuevas.formaDeLaDeuda(linea)).toBeNull();
  });
});

describe("leerCi: el paso de la deuda se reconoce con sus dos formas en un mismo paso", () => {
  const PASO = [
    "      - name: Deuda técnica",
    "        run: |",
    "          if [ -d base ]; then",
    "            node arquitectura/deuda/deuda.cjs --base=base",
    "          else",
    "            node arquitectura/deuda/deuda.cjs",
    "          fi",
  ];
  const pasos = (...cuerpo: string[]) =>
    job(lineas("jobs:", "  guardian:", "    steps:", ...cuerpo), "guardian").pasos;

  it("un paso con las dos formas lo marca, con su rango de líneas", () => {
    expect(pasos(...PASO)).toStrictEqual([
      {
        desde: 4,
        hasta: 10,
        ejecutaGuardian: false,
        deudaSola: true,
        deudaConBase: true,
        si: undefined,
      },
    ]);
  });

  it("cada forma se marca por separado y cada paso lleva las suyas", () => {
    const [primero, segundo] = pasos(
      "      - run: node arquitectura/deuda/deuda.cjs",
      "      - run: node arquitectura/deuda/deuda.cjs --base=base",
    );
    expect([primero?.deudaSola, primero?.deudaConBase]).toEqual([true, false]);
    expect([segundo?.deudaSola, segundo?.deudaConBase]).toEqual([false, true]);
  });

  it("un paso que ejecuta el guardián y no la deuda no marca nada de la deuda, y al revés", () => {
    const [guardian, deuda] = pasos(
      "      - run: node arquitectura/contratos/guardian.cjs",
      ...PASO,
    );
    expect([guardian?.ejecutaGuardian, guardian?.deudaSola, guardian?.deudaConBase]).toEqual([
      true,
      false,
      false,
    ]);
    expect([deuda?.ejecutaGuardian, deuda?.deudaSola, deuda?.deudaConBase]).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("con `|| true` no cuenta, y las líneas de un paso anterior no se arrastran al siguiente", () => {
    const [con, sin] = pasos(
      "      - run: node arquitectura/deuda/deuda.cjs || true",
      "      - run: echo",
    );
    expect([con?.deudaSola, con?.deudaConBase, sin?.deudaSola, sin?.deudaConBase]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    const [uno, dos] = pasos("      - run: node arquitectura/deuda/deuda.cjs", "      - run: echo");
    expect([uno?.deudaSola, dos?.deudaSola]).toEqual([true, false]);
  });
});

describe("leerDeuda: el registro y la configuración, resumidos", () => {
  const registro = JSON.stringify([
    {
      id: "a",
      tipo: "todo",
      archivos: ["x.ts", 7],
      descripcion: "d",
      verificacion: { contiene: "PENDIENTE" },
    },
    { id: "b", tipo: "backlog", archivos: ["y.ts"] },
  ]);
  const configuracion = JSON.stringify({
    topeDeExcepciones: 4,
    bloqueaDeudaEnArchivoTocado: true,
    topeDeLineasPorArchivo: 250,
    excluidosDelTope: [
      { ruta: "src/datos.ts", motivo: "Datos." },
      5,
      { ruta: 7 },
      { ruta: "src/b.ts" },
    ],
  });

  it("sin ninguno de los dos archivos está ausente", () => {
    expect(nuevas.leerDeuda(null, null)).toStrictEqual({ ausente: true });
  });

  it("resume cada entrada (id, tipo, archivos en texto, verificación y posición) y trae las dos opciones", () => {
    expect(nuevas.leerDeuda(registro, configuracion)).toStrictEqual({
      valor: {
        entradas: [
          { id: "a", tipo: "todo", archivos: ["x.ts", "7"], verificacion: "PENDIENTE", indice: 0 },
          { id: "b", tipo: "backlog", archivos: ["y.ts"], verificacion: null, indice: 1 },
        ],
        tope: 4,
        bloquea: true,
        topeDeLineas: 250,
        excluidos: ["src/datos.ts", null, null, "src/b.ts"],
      },
    });
  });

  it("lo que no es de la forma esperada queda en null o vacío, sin romper", () => {
    const rara = JSON.stringify([
      6,
      null,
      "texto",
      [],
      { id: "", tipo: 3, archivos: "x.ts", verificacion: "texto" },
      { id: "c", tipo: "backlog", archivos: [], verificacion: { contiene: "" } },
      { id: "d", tipo: "backlog", verificacion: { otra: "x" } },
    ]);
    const { valor } = nuevas.leerDeuda(rara, configuracion) as {
      valor: { entradas: unknown[] };
    };
    const vacia = { id: null, tipo: null, archivos: [], verificacion: null };
    expect(valor.entradas).toStrictEqual([
      { ...vacia, indice: 0 },
      { ...vacia, indice: 1 },
      { ...vacia, indice: 2 },
      { ...vacia, indice: 3 },
      { ...vacia, indice: 4 },
      { id: "c", tipo: "backlog", archivos: [], verificacion: null, indice: 5 },
      { id: "d", tipo: "backlog", archivos: [], verificacion: null, indice: 6 },
    ]);
  });

  it("las opciones ausentes o de otro tipo se pasan tal cual (las compara el chequeo)", () => {
    const { valor } = nuevas.leerDeuda("[]", '{"topeDeExcepciones":"x"}') as {
      valor: { tope: unknown; bloquea: unknown; topeDeLineas: unknown; excluidos: unknown };
    };
    expect(valor.tope).toBe("x");
    expect(valor.bloquea).toBeUndefined();
    expect(valor.topeDeLineas).toBeUndefined();
    expect(valor.excluidos).toStrictEqual([]);
  });

  it.each([
    ["el registro no es una lista", "{}", configuracion, "el registro no es una lista"],
    ["el registro es null (falta)", null, configuracion, "el registro no es una lista"],
    ["la configuración no es un objeto", "[]", "[]", "la configuración no es un objeto"],
    ["la configuración es null (falta)", "[]", null, "la configuración no es un objeto"],
    ["la configuración es un texto", "[]", '"x"', "la configuración no es un objeto"],
  ])("%s", (_nombre, textoDelRegistro, textoDeLaConfiguracion, error) => {
    expect(nuevas.leerDeuda(textoDelRegistro, textoDeLaConfiguracion)).toStrictEqual({ error });
  });

  it("un JSON roto se explica con el motivo del analizador", () => {
    let motivo = "";
    try {
      JSON.parse("[ no");
    } catch (error) {
      motivo = (error as Error).message;
    }
    expect(nuevas.leerDeuda("[ no", configuracion)).toStrictEqual({
      error: `no es JSON válido (${motivo})`,
    });
  });
});

describe("la deuda es una sección de lectura: puede faltar en la base, no en el PR si la base la tiene", () => {
  const conDeuda = (valor: unknown): Instantanea => instantanea({ deuda: valor as never });
  const VALOR = {
    valor: { entradas: [], tope: 10, bloquea: true, topeDeLineas: 400, excluidos: [] },
  };
  const lectura = (base: unknown, pr: unknown) =>
    nd.chequearLectura(conDeuda(base), conDeuda(pr)).filter((h) => h.archivo === REGISTRO);

  it("sana en los dos: nada", () => {
    expect(lectura(VALOR, VALOR)).toEqual([]);
  });

  it("ausente en la base: es esperable (todavía no la tiene), y el PR puede tenerla o no", () => {
    expect(lectura({ ausente: true }, VALOR)).toEqual([]);
    expect(lectura({ ausente: true }, { ausente: true })).toEqual([]);
  });

  it("ausente en el PR cuando la base la tiene: el árbol no se puede mirar", () => {
    expect(lectura(VALOR, { ausente: true })).toStrictEqual([
      {
        codigo: "arbol-ilegible",
        archivo: REGISTRO,
        contrato: null,
        motivo:
          "No se pudo leer «deuda» del árbol del PR: el archivo no existe. Sin eso no se puede comprobar que no se debilitó nada.",
        correccion:
          "Dejá el archivo legible y con la forma de siempre, o corregí el error que muestra el motivo.",
        donde: ubicacion.enArchivo(),
      },
    ]);
  });

  it("con un error en el PR o en la base, se dice cuál", () => {
    expect(lectura(VALOR, { error: "boom" }).map((h) => [h.codigo, h.motivo])).toEqual([
      [
        "arbol-ilegible",
        "No se pudo leer «deuda» del árbol del PR: boom. Sin eso no se puede comprobar que no se debilitó nada.",
      ],
    ]);
    expect(lectura({ error: "boom" }, VALOR).map((h) => [h.codigo, h.motivo])).toEqual([
      ["base-ilegible", "No se pudo leer «deuda» de la base: boom. No hay con qué comparar el PR."],
    ]);
  });

  it("un error en el PR con la base ausente también se reclama", () => {
    expect(lectura({ ausente: true }, { error: "boom" }).map((h) => h.codigo)).toEqual([
      "arbol-ilegible",
    ]);
  });

  it("las demás secciones que pueden faltar (invariantes, evasiones) siguen pudiendo faltar en el PR", () => {
    const base = instantanea();
    const pr = instantanea({ invariantes: { ausente: true }, evasiones: { ausente: true } });
    expect(nd.chequearLectura(base, pr)).toEqual([]);
  });
});

describe("(j) chequearDeuda: el tope, el bloqueo y las entradas", () => {
  const entradaDe = (id: string | null, cambios: Record<string, unknown> = {}) => ({
    id,
    tipo: "todo",
    archivos: ["x.ts"],
    verificacion: null,
    indice: 0,
    ...cambios,
  });
  const deuda = (cambios: Record<string, unknown> = {}): Instantanea =>
    instantanea({
      deuda: {
        valor: {
          entradas: [],
          tope: 10,
          bloquea: true,
          topeDeLineas: 400,
          excluidos: [],
          ...cambios,
        },
      },
    });
  const sinArchivos = () => null;
  const chequear = (
    base: Instantanea,
    pr: Instantanea,
    leerPr: (ruta: string) => Buffer | string | null = sinArchivos,
  ) => nuevas.chequearDeuda(base, pr, { leerPr });

  it("sin cambios no hay nada que reclamar, ni con la deuda ausente o ilegible en un lado", () => {
    expect(chequear(deuda(), deuda())).toEqual([]);
    for (const seccion of [{ ausente: true }, { error: "x" }]) {
      const rota = instantanea({ deuda: seccion });
      expect(chequear(rota, deuda())).toEqual([]);
      expect(chequear(deuda(), rota)).toEqual([]);
    }
  });

  it("el tope sube: falla en la clave, diciendo de cuánto a cuánto", () => {
    expect(chequear(deuda({ tope: 10 }), deuda({ tope: 11 }))).toStrictEqual([
      {
        codigo: "deuda-tope-subio",
        archivo: CONFIGURACION,
        contrato: null,
        motivo:
          "El tope de excepciones de deuda subió de 10 a 11: la excepción se volvería la norma.",
        correccion: "Dejá el tope como estaba (puede bajar, no subir).",
        donde: ubicacion.enJson("topeDeExcepciones"),
      },
    ]);
    expect(chequear(deuda({ tope: 10 }), deuda({ tope: 10 }))).toEqual([]);
    expect(chequear(deuda({ tope: 10 }), deuda({ tope: 3 }))).toEqual([]);
    expect(chequear(deuda({ tope: 0 }), deuda({ tope: 1 })).map((h) => h.codigo)).toEqual([
      "deuda-tope-subio",
    ]);
  });

  it("el bloqueo pasa de true a otra cosa: falla, diciendo a qué", () => {
    const motivoDe = (bloquea: unknown) =>
      chequear(deuda({ bloquea: true }), deuda({ bloquea })).map((h) => h.motivo);
    expect(motivoDe(false)).toEqual([
      "`bloqueaDeudaEnArchivoTocado` pasó de true a false: tocar un archivo con deuda sin pagarla ya no bloquearía.",
    ]);
    expect(motivoDe(undefined)).toEqual([
      "`bloqueaDeudaEnArchivoTocado` pasó de true a null: tocar un archivo con deuda sin pagarla ya no bloquearía.",
    ]);
    expect(motivoDe("true")).toEqual([
      '`bloqueaDeudaEnArchivoTocado` pasó de true a "true": tocar un archivo con deuda sin pagarla ya no bloquearía.',
    ]);
    const [h] = chequear(deuda({ bloquea: true }), deuda({ bloquea: false }));
    expect(h).toMatchObject({
      codigo: "deuda-bloqueo-aflojado",
      archivo: CONFIGURACION,
      contrato: null,
      correccion: "Dejá la opción en true: bajarla es un debilitamiento que decide el dueño.",
      donde: ubicacion.enJson("bloqueaDeudaEnArchivoTocado"),
    });
  });

  it("false a true, true a true y false a false no son un debilitamiento", () => {
    expect(chequear(deuda({ bloquea: false }), deuda({ bloquea: true }))).toEqual([]);
    expect(chequear(deuda({ bloquea: true }), deuda({ bloquea: true }))).toEqual([]);
    expect(chequear(deuda({ bloquea: false }), deuda({ bloquea: false }))).toEqual([]);
  });

  it("el tope de líneas sube: falla en su clave, diciendo de cuánto a cuánto", () => {
    expect(chequear(deuda({ topeDeLineas: 400 }), deuda({ topeDeLineas: 401 }))).toStrictEqual([
      {
        codigo: "deuda-tope-de-lineas-subio",
        archivo: CONFIGURACION,
        contrato: null,
        motivo:
          "El tope de líneas por archivo subió de 400 a 401: archivos más grandes dejarían de ser deuda.",
        correccion: "Dejá el tope como estaba (puede bajar, no subir).",
        donde: ubicacion.enJson("topeDeLineasPorArchivo"),
      },
    ]);
    expect(chequear(deuda({ topeDeLineas: 400 }), deuda({ topeDeLineas: 400 }))).toEqual([]);
    expect(chequear(deuda({ topeDeLineas: 400 }), deuda({ topeDeLineas: 300 }))).toEqual([]);
  });

  it("un tope de líneas ausente o que no es número en la base no se reclama", () => {
    expect(chequear(deuda({ topeDeLineas: undefined }), deuda({ topeDeLineas: 400 }))).toEqual([]);
    expect(chequear(deuda({ topeDeLineas: "x" }), deuda({ topeDeLineas: 400 }))).toEqual([]);
  });

  it("una exclusión nueva del tope falla en la ruta de esa exclusión, con su texto", () => {
    expect(
      chequear(deuda({ excluidos: ["src/a.ts"] }), deuda({ excluidos: ["src/a.ts", "src/b.ts"] })),
    ).toStrictEqual([
      {
        codigo: "deuda-exclusion-nueva",
        archivo: CONFIGURACION,
        contrato: null,
        motivo:
          "«src/b.ts» pasó a las exclusiones del tope de líneas y la base no lo excluía: un archivo grande dejaría de contar.",
        correccion: "Sacá la exclusión: la lista de excluidos no crece sin decisión del dueño.",
        donde: ubicacion.enJson("excluidosDelTope", 1, "ruta"),
      },
    ]);
  });

  it("las exclusiones que ya estaban, las que se sacan, las reordenadas y las ilegibles no se reclaman", () => {
    expect(chequear(deuda({ excluidos: ["a", "b"] }), deuda({ excluidos: ["b", "a"] }))).toEqual(
      [],
    );
    expect(chequear(deuda({ excluidos: ["a", "b"] }), deuda({ excluidos: ["a"] }))).toEqual([]);
    expect(chequear(deuda({ excluidos: ["a"] }), deuda({ excluidos: [] }))).toEqual([]);
    expect(chequear(deuda({ excluidos: [] }), deuda({ excluidos: [null] }))).toEqual([]);
    expect(chequear(deuda({ excluidos: undefined }), deuda({ excluidos: [] }))).toEqual([]);
  });

  it("varias exclusiones nuevas dan un hallazgo por cada una, cada una en su posición", () => {
    const hallazgos = chequear(deuda({ excluidos: ["a"] }), deuda({ excluidos: ["x", "a", "y"] }));
    expect(hallazgos.map((h) => h.donde)).toEqual([
      ubicacion.enJson("excluidosDelTope", 0, "ruta"),
      ubicacion.enJson("excluidosDelTope", 2, "ruta"),
    ]);
  });

  it("sin la lista de exclusiones en el PR no se rompe", () => {
    expect(chequear(deuda({ excluidos: ["a"] }), deuda({ excluidos: undefined }))).toEqual([]);
  });

  describe("una entrada de archivo-grande borrada mientras el archivo sigue sobre el tope", () => {
    const grande = {
      id: "g",
      tipo: "archivo-grande",
      archivos: ["src/g.ts"],
      verificacion: null,
      indice: 0,
    };
    const deLineas = (n: number) => Buffer.from("export const x = 1;\n".repeat(n));
    const borrada = (base: Record<string, unknown>, tamano: number, ruta = "src/g.ts") =>
      chequear(deuda({ entradas: [grande], ...base }), deuda(base), (r) =>
        r === ruta ? deLineas(tamano) : null,
      ).map((h) => [h.codigo, h.archivo, h.linea]);

    it("falla en la línea siguiente al tope de la base", () => {
      expect(borrada({}, 450)).toEqual([["deuda-entrada-borrada-sin-pagar", "src/g.ts", 401]]);
      expect(borrada({ topeDeLineas: 10 }, 12)).toEqual([
        ["deuda-entrada-borrada-sin-pagar", "src/g.ts", 11],
      ]);
    });

    it("si el archivo bajó del tope de la base, borrar la entrada es pagar", () => {
      expect(borrada({}, 400)).toEqual([]);
      expect(borrada({ topeDeLineas: 10 }, 10)).toEqual([]);
    });

    it("si la base excluía el archivo, no hay deuda que se haya borrado", () => {
      expect(borrada({ excluidos: ["src/g.ts"] }, 450)).toEqual([]);
      expect(borrada({ excluidos: [null, "otro.ts"] }, 450)).toEqual([
        ["deuda-entrada-borrada-sin-pagar", "src/g.ts", 401],
      ]);
    });

    it("un tope de la base que no es un entero se reemplaza por el de arranque (400)", () => {
      expect(borrada({ topeDeLineas: "x" }, 401)).toEqual([
        ["deuda-entrada-borrada-sin-pagar", "src/g.ts", 401],
      ]);
      expect(borrada({ topeDeLineas: undefined }, 400)).toEqual([]);
      expect(borrada({ topeDeLineas: 1.5 }, 401)).toEqual([
        ["deuda-entrada-borrada-sin-pagar", "src/g.ts", 401],
      ]);
    });
  });

  it("una entrada de un marcador que desaparece mientras el marcador sigue: falla en el marcador, con su línea", () => {
    const base = deuda({ entradas: [entradaDe("todo--x")] });
    const pr = deuda({ entradas: [] });
    const leerPr = (ruta: string) => (ruta === "x.ts" ? Buffer.from("a;\nb; // TODO: y\n") : null);
    expect(chequear(base, pr, leerPr)).toStrictEqual([
      {
        codigo: "deuda-entrada-borrada-sin-pagar",
        archivo: "x.ts",
        contrato: null,
        motivo:
          "La entrada «todo--x» del registro de deuda de la base ya no está y el problema sigue acá (según el detector de la base): se borró la deuda sin pagarla.",
        correccion: "Devolvé la entrada al registro, o resolvé el problema.",
        linea: 2,
      },
    ]);
  });

  it("solo cuenta el tipo de la entrada: otro tipo de marcador en el archivo no la mantiene", () => {
    const base = deuda({ entradas: [entradaDe("todo--x")] });
    const leerPr = () => "// @ts-ignore\n";
    expect(chequear(base, deuda(), leerPr)).toEqual([]);
  });

  it("si el marcador ya no está, o el archivo ya no existe, borrar la entrada es pagar", () => {
    const base = deuda({ entradas: [entradaDe("todo--x")] });
    expect(chequear(base, deuda(), () => "export {};\n")).toEqual([]);
    expect(chequear(base, deuda(), () => null)).toEqual([]);
  });

  it("una entrada que sigue en el PR (aunque cambie otra cosa) no se reclama", () => {
    const base = deuda({ entradas: [entradaDe("todo--x")] });
    const pr = deuda({ entradas: [entradaDe("todo--x", { indice: 3 })] });
    expect(chequear(base, pr, () => "// TODO: y\n")).toEqual([]);
  });

  it("una entrada de la base sin id no se puede seguir: se ignora", () => {
    const base = deuda({ entradas: [entradaDe(null)] });
    expect(chequear(base, deuda(), () => "// TODO: y\n")).toEqual([]);
  });

  it("un hallazgo con verificación: falla en el archivo y la línea donde está su texto", () => {
    const hallazgo = entradaDe("h", {
      tipo: "backlog",
      archivos: ["x.ts", "y.ts"],
      verificacion: "PENDIENTE",
    });
    const base = deuda({ entradas: [hallazgo] });
    const leerPr = (ruta: string) =>
      ruta === "y.ts" ? "a;\nb;\n// PENDIENTE\r\n" : "export {};\n";
    const [h, ...resto] = chequear(base, deuda(), leerPr);
    expect(resto).toEqual([]);
    expect(h).toMatchObject({
      codigo: "deuda-entrada-borrada-sin-pagar",
      archivo: "y.ts",
      linea: 3,
    });
    // sin el texto en ningún archivo: se pagó
    expect(chequear(base, deuda(), () => "export {};\n")).toEqual([]);
    // un archivo ilegible no cuenta como que tiene el texto
    expect(chequear(base, deuda(), () => null)).toEqual([]);
  });

  it("un hallazgo sin verificación no se puede comprobar: borrarlo no se reclama", () => {
    const base = deuda({ entradas: [entradaDe("h", { tipo: "backlog" })] });
    expect(chequear(base, deuda(), () => "// TODO: y\n")).toEqual([]);
  });

  it("una entrada de marcador con verificación (rara) se verifica por su texto, no por el detector", () => {
    const base = deuda({ entradas: [entradaDe("h", { verificacion: "texto raro" })] });
    expect(chequear(base, deuda(), () => "// TODO: y\n")).toEqual([]);
    expect(chequear(base, deuda(), () => "algo\ntexto raro\n").map((h) => h.linea)).toEqual([2]);
  });

  it("el primer archivo con el problema es el que se reclama, y los ilegibles se saltean", () => {
    const base = deuda({
      entradas: [entradaDe("t", { archivos: ["a.ts", "b.ts", "c.ts"] })],
    });
    const leerPr = (ruta: string) =>
      ruta === "a.ts" ? null : ruta === "b.ts" ? "export {};\n" : "// FIXME x\n";
    expect(chequear(base, deuda(), leerPr).map((h) => [h.archivo, h.linea])).toEqual([["c.ts", 1]]);
  });

  it("varias entradas borradas dan un hallazgo por cada una, en el orden de la base", () => {
    const base = deuda({
      entradas: [
        entradaDe("uno", { archivos: ["a.ts"] }),
        entradaDe("dos", { archivos: ["b.ts"] }),
      ],
    });
    const hallazgos = chequear(base, deuda(), () => "// TODO: x\n");
    expect(hallazgos.map((h) => [h.archivo, /«([^»]+)»/.exec(h.motivo)?.[1]])).toEqual([
      ["a.ts", "uno"],
      ["b.ts", "dos"],
    ]);
  });
});

describe("(j) chequearCi: el paso de la deuda lo exige la base, y no gana saltos", () => {
  const PASO = [
    "      - name: Deuda",
    "        run: |",
    "          node arquitectura/deuda/deuda.cjs --base=base",
    "          node arquitectura/deuda/deuda.cjs",
  ];
  const ci = (...pasos: string[]) =>
    ciLeido(
      lineas("jobs:", "  guardian:", "    steps:", ...pasos, "  gate:", "    needs: [guardian]"),
    );
  const conCi = (valor: ReturnType<typeof ciLeido>): Instantanea => instantanea({ ci: valor });
  const hallazgos = (base: string[], pr: string[]) =>
    nd.chequearCi(conCi(ci(...base)), conCi(ci(...pr)));
  const GUARDIAN = "      - run: node arquitectura/contratos/guardian.cjs";

  it("la base lo tenía y el PR también: nada", () => {
    expect(hallazgos([GUARDIAN, ...PASO], [GUARDIAN, ...PASO])).toEqual([]);
  });

  it("la base no lo tenía: nada que no se pueda quitar", () => {
    expect(hallazgos([GUARDIAN], [GUARDIAN])).toEqual([]);
    expect(hallazgos([GUARDIAN], [GUARDIAN, ...PASO])).toEqual([]);
  });

  it("la base sin job guardian tampoco lo exigía", () => {
    const sinJob = ciLeido(lineas("jobs:", "  gate:", "    needs: [guardian]"));
    expect(nd.chequearCi(conCi(sinJob), conCi(ci(GUARDIAN)))).toEqual([]);
  });

  it("el PR lo quitó: falla en la línea del job guardian", () => {
    expect(hallazgos([GUARDIAN, ...PASO], [GUARDIAN])).toStrictEqual([
      {
        codigo: "ci-sin-paso-de-deuda",
        archivo: A.ci,
        contrato: null,
        motivo:
          "El job guardian ya no ejecuta `node arquitectura/deuda/deuda.cjs` y `node arquitectura/deuda/deuda.cjs --base=base` tal cual en un mismo paso, y la base sí: la deuda técnica no se controlaría en la CI.",
        correccion: "Devolvé el paso de la deuda al job guardian.",
        linea: 2,
      },
    ]);
  });

  it("con una sola de las dos formas, o con las dos en pasos distintos, ya no es el paso", () => {
    const sola = ["      - run: node arquitectura/deuda/deuda.cjs"];
    const conBase = ["      - run: node arquitectura/deuda/deuda.cjs --base=base"];
    for (const pr of [sola, conBase, [...sola, ...conBase]]) {
      expect(hallazgos([GUARDIAN, ...PASO], [GUARDIAN, ...pr]).map((h) => h.codigo)).toEqual([
        "ci-sin-paso-de-deuda",
      ]);
    }
  });

  it("un continue-on-error nuevo DENTRO del paso falla, en su línea; uno de otro paso no cuenta", () => {
    const pr = ["      - name: Deuda", "        continue-on-error: true", ...PASO.slice(1)];
    expect(hallazgos([GUARDIAN, ...PASO], [GUARDIAN, ...pr])).toStrictEqual([
      {
        codigo: "ci-deuda-con-salto",
        archivo: A.ci,
        contrato: null,
        motivo:
          "El paso de la deuda tiene `continue-on-error`, que la base no tenía: un fallo suyo se podría saltear.",
        correccion:
          "Sacá la línea: el control de deuda tiene que correr siempre y su fallo tiene que frenar el Gate.",
        linea: 6,
      },
    ]);
    const deOtro = [GUARDIAN, "        continue-on-error: true", ...PASO];
    expect(
      hallazgos([GUARDIAN, ...PASO], deOtro).filter((h) => h.codigo === "ci-deuda-con-salto"),
    ).toEqual([]);
    const despues = [GUARDIAN, ...PASO, "      - run: echo", "        continue-on-error: true"];
    expect(
      hallazgos([GUARDIAN, ...PASO], despues).filter((h) => h.codigo === "ci-deuda-con-salto"),
    ).toEqual([]);
  });

  it("un continue-on-error en la primera o en la última línea del paso también cuenta", () => {
    const primera = ["      - continue-on-error: true", "        name: Deuda", ...PASO.slice(1)];
    expect(
      hallazgos([GUARDIAN, ...PASO], [GUARDIAN, ...primera]).map((h) => [h.codigo, h.linea]),
    ).toEqual([["ci-deuda-con-salto", 5]]);
    const ultima = [...PASO, "        continue-on-error: true"];
    expect(
      hallazgos([GUARDIAN, ...PASO], [GUARDIAN, ...ultima]).map((h) => [h.codigo, h.linea]),
    ).toEqual([["ci-deuda-con-salto", 9]]);
  });

  it("un continue-on-error que la base ya tenía en el paso no se reclama; uno más, sí", () => {
    const con = (cuantos: number) => [
      "      - name: Deuda",
      ...Array.from({ length: cuantos }, () => "        continue-on-error: true"),
      ...PASO.slice(1),
    ];
    expect(hallazgos([GUARDIAN, ...con(1)], [GUARDIAN, ...con(1)])).toEqual([]);
    expect(hallazgos([GUARDIAN, ...con(1)], [GUARDIAN, ...con(2)]).map((h) => h.linea)).toEqual([
      7,
    ]);
    expect(hallazgos([GUARDIAN, ...con(2)], [GUARDIAN, ...con(1)])).toEqual([]);
  });

  it("un if nuevo en el paso falla con su texto y su línea; el que la base ya tenía no", () => {
    const conIf = (valor: string) => [
      "      - name: Deuda",
      `        if: ${valor}`,
      ...PASO.slice(1),
    ];
    expect(hallazgos([GUARDIAN, ...PASO], [GUARDIAN, ...conIf("false")])).toStrictEqual([
      {
        codigo: "ci-deuda-con-salto",
        archivo: A.ci,
        contrato: null,
        motivo:
          "El paso de la deuda tiene `if: false`, que la base no tenía: un fallo suyo se podría saltear.",
        correccion:
          "Sacá la línea: el control de deuda tiene que correr siempre y su fallo tiene que frenar el Gate.",
        linea: 6,
      },
    ]);
    expect(hallazgos([GUARDIAN, ...conIf("a")], [GUARDIAN, ...conIf("a")])).toEqual([]);
    expect(
      hallazgos([GUARDIAN, ...conIf("a")], [GUARDIAN, ...conIf("b")]).map((h) => h.linea),
    ).toEqual([6]);
    expect(hallazgos([GUARDIAN, ...conIf("a")], [GUARDIAN, ...PASO])).toEqual([]);
  });

  it("el paso de la deuda de la base se busca entre todos sus pasos, no solo en el primero", () => {
    const base = [GUARDIAN, "      - run: echo", ...PASO];
    expect(hallazgos(base, [GUARDIAN, "      - run: echo"]).map((h) => h.codigo)).toEqual([
      "ci-sin-paso-de-deuda",
    ]);
    expect(hallazgos(base, [GUARDIAN, "      - run: echo", ...PASO])).toEqual([]);
  });
});

describe("(j) chequearPaquete: los scripts de la deuda los exige la base", () => {
  const scripts = (cambios: Record<string, unknown>): Instantanea =>
    instantanea({
      paquete: {
        valor: {
          arquitectura: "depcruise src && npm run guardian && npm run deuda",
          guardian: "node arquitectura/contratos/guardian.cjs",
          deuda: "node arquitectura/deuda/deuda.cjs",
          ...cambios,
        },
      },
    });
  const motivos = (base: Instantanea, pr: Instantanea) =>
    nd.chequearPaquete(base, pr).map((h) => [h.codigo, h.motivo]);

  it("sin cambios o sin lo que la base exigía no se reclama nada", () => {
    expect(nd.chequearPaquete(scripts({}), scripts({}))).toEqual([]);
    const sinDeuda = scripts({
      arquitectura: "depcruise src && npm run guardian",
      deuda: undefined,
    });
    expect(nd.chequearPaquete(sinDeuda, sinDeuda)).toEqual([]);
    expect(nd.chequearPaquete(sinDeuda, scripts({}))).toEqual([]);
    expect(nd.chequearPaquete(sinDeuda, scripts({ deuda: "algo" }))).toEqual([]);
  });

  it("la base sin paquete legible no exige nada de la deuda", () => {
    const sinPaquete = instantanea({ paquete: { ausente: true } });
    const roto = scripts({ arquitectura: "echo", deuda: "echo" });
    expect(nd.chequearPaquete(sinPaquete, roto).map((h) => h.codigo)).toEqual([
      "script-arquitectura-desviado",
    ]);
  });

  it("arquitectura deja de encadenar la deuda: falla en la clave del script", () => {
    const [h, ...resto] = nd.chequearPaquete(
      scripts({}),
      scripts({ arquitectura: "depcruise src && npm run guardian" }),
    );
    expect(resto).toEqual([]);
    expect(h).toStrictEqual({
      codigo: "script-arquitectura-sin-deuda",
      archivo: A.paquete,
      contrato: null,
      motivo:
        'El script «arquitectura» ("depcruise src && npm run guardian") ya no encadena `&& npm run deuda`: `npm run gate` no controlaría la deuda técnica.',
      correccion: "Devolvé `&& npm run deuda` al final del script arquitectura.",
      donde: ubicacion.enJson("scripts", "arquitectura"),
    });
  });

  it("encadenar la deuda es un paso entero del script: `npm run deuda2` o `|| npm run deuda` no valen", () => {
    for (const arquitectura of [
      "depcruise src && npm run guardian && npm run deuda2",
      "depcruise src && npm run guardian && xnpm run deuda",
      "depcruise src && npm run guardian",
      undefined,
      6,
    ]) {
      expect(
        motivos(scripts({}), scripts({ arquitectura })).map(([codigo]) => codigo),
        String(arquitectura),
      ).toContain("script-arquitectura-sin-deuda");
    }
    expect(
      nd.chequearPaquete(
        scripts({}),
        scripts({ arquitectura: "depcruise src  &&  npm run guardian  &&  npm run deuda  " }),
      ),
    ).toEqual([]);
    expect(
      nd.chequearPaquete(
        scripts({}),
        scripts({ arquitectura: "npm run deuda && depcruise src && npm run guardian" }),
      ),
    ).toEqual([]);
  });

  it("el script deuda se desvía: falla, mostrando el valor", () => {
    const [h, ...resto] = nd.chequearPaquete(scripts({}), scripts({ deuda: "node otra.cjs" }));
    expect(resto).toEqual([]);
    expect(h).toStrictEqual({
      codigo: "script-deuda-desviado",
      archivo: A.paquete,
      contrato: null,
      motivo:
        'El script «deuda» ("node otra.cjs") ya no ejecuta `node arquitectura/deuda/deuda.cjs`: `npm run deuda` no analizaría nada.',
      correccion: "Devolvé el script deuda a `node arquitectura/deuda/deuda.cjs`.",
      donde: ubicacion.enJson("scripts", "deuda"),
    });
    expect(motivos(scripts({}), scripts({ deuda: undefined }))[0]?.[1]).toContain("(null)");
  });

  it("el script deuda admite opciones (`--sin-informe`) pero no operadores ni otro comando", () => {
    expect(
      nd.chequearPaquete(
        scripts({}),
        scripts({ deuda: "node arquitectura/deuda/deuda.cjs --sin-informe" }),
      ),
    ).toEqual([]);
    expect(
      nd.chequearPaquete(scripts({}), scripts({ deuda: "  node arquitectura/deuda/deuda.cjs  " })),
    ).toEqual([]);
    for (const deuda of [
      "node arquitectura/deuda/deuda.cjs || true",
      "node arquitectura/deuda/deuda.cjs; echo",
      "node arquitectura/contratos/guardian.cjs",
      "",
      6,
    ]) {
      expect(
        motivos(scripts({}), scripts({ deuda })).map(([c]) => c),
        String(deuda),
      ).toContain("script-deuda-desviado");
    }
  });
});

describe("verificar: el chequeo (j) y su aviso de punta a punta", () => {
  const instantaneaConDeuda = (deuda: unknown): Instantanea =>
    instantanea({ deuda: deuda as never });

  it("completa la línea de una entrada borrada con la del marcador y lee el PR con `leerPr`", () => {
    const base = instantaneaConDeuda({
      valor: {
        entradas: [{ id: "t", tipo: "todo", archivos: ["x.ts"], verificacion: null, indice: 0 }],
        tope: 10,
        bloquea: true,
      },
    });
    const pr = instantaneaConDeuda({
      valor: { entradas: [], tope: 10, bloquea: true, topeDeLineas: 400, excluidos: [] },
    });
    const pedidos: string[] = [];
    const { fallas, avisos } = nd.verificar({
      base,
      pr,
      ahora: new Date("2026-10-22T12:00:00Z"),
      leerPr: (ruta) => {
        pedidos.push(ruta);
        return ruta === "x.ts" ? "\n\n// HACK: y\n" : null;
      },
    });
    expect(avisos).toEqual([]);
    expect(fallas.map((h) => [h.codigo, h.archivo, h.linea])).toEqual([
      ["deuda-entrada-borrada-sin-pagar", "x.ts", 3],
    ]);
    expect(pedidos).toContain("x.ts");
  });

  it("la base sin deuda avisa que se saltea el chequeo, en la línea 1 del registro", () => {
    const { fallas, avisos } = nd.verificar({
      base: instantaneaConDeuda({ ausente: true }),
      pr: instantaneaConDeuda({ ausente: true }),
      ahora: new Date("2026-10-22T12:00:00Z"),
      leerPr: () => null,
    });
    expect(fallas).toEqual([]);
    expect(avisos).toStrictEqual([
      {
        codigo: "deuda-sin-base",
        archivo: REGISTRO,
        contrato: null,
        motivo:
          "La base no trae el registro de deuda técnica (arquitectura/deuda): se saltea el chequeo (j). Es esperable solo hasta que el control de deuda entre a la rama principal.",
        correccion: "Nada por ahora; cuando la base lo tenga, el chequeo (j) se activa solo.",
        linea: 1,
      },
    ]);
  });

  it("una base sin la sección de la deuda (ni ausente ni leída) no avisa ni se rompe", () => {
    const { avisos } = nd.verificar({
      base: instantanea({ deuda: undefined }),
      pr: instantanea({ deuda: undefined }),
      ahora: new Date("2026-10-22T12:00:00Z"),
      leerPr: () => null,
    });
    expect(avisos.map((a) => a.codigo)).not.toContain("deuda-sin-base");
  });

  it("una base con deuda legible no avisa", () => {
    const { avisos } = nd.verificar({
      base: instantaneaConDeuda({
        valor: { entradas: [], tope: 10, bloquea: true, topeDeLineas: 400, excluidos: [] },
      }),
      pr: instantaneaConDeuda({
        valor: { entradas: [], tope: 10, bloquea: true, topeDeLineas: 400, excluidos: [] },
      }),
      ahora: new Date("2026-10-22T12:00:00Z"),
      leerPr: () => null,
    });
    expect(avisos).toEqual([]);
  });

  it("los códigos nuevos están en la lista cerrada de fallas y de avisos, cada uno con su descripción", () => {
    for (const codigo of [
      "ci-sin-paso-de-deuda",
      "ci-deuda-con-salto",
      "script-arquitectura-sin-deuda",
      "script-deuda-desviado",
      "deuda-tope-subio",
      "deuda-bloqueo-aflojado",
      "deuda-entrada-borrada-sin-pagar",
    ]) {
      expect(nd.CODIGOS_DE_FALLA, codigo).toContain(codigo);
      expect(nd.DESCRIPCION_DE_CODIGOS[codigo]?.startsWith("(j) "), codigo).toBe(true);
    }
    expect(nd.CODIGOS_DE_AVISO).toContain("deuda-sin-base");
  });
});
