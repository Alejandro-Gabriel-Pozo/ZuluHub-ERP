import { describe, expect, it } from "vitest";
import { campoConPosibleSecreto, type Dato } from "../../puertos/sin-secretos";
import { CATALOGO_DE_TEXTOS, type ClaveDeTexto } from "./catalogo";
import {
  clavesHuerfanas,
  diferenciaDeVocabulario,
  marcadoresDe,
  resolverVocabulario,
  resolverVocabularioContra,
  texto,
  textoContra,
  validarVocabulario,
  validarVocabularioContra,
  type CatalogoDeTextos,
} from "./vocabulario";

const CATALOGO: CatalogoDeTextos = {
  "prueba.saludo": { porDefecto: "Hola" },
  "prueba.uno": { porDefecto: "Hasta {n}", marcadores: ["n"] },
  "prueba.rango": {
    porDefecto: "De {desde} a {hasta}",
    marcadores: ["hasta", "desde"],
    largoMaximo: 40,
  },
  "prueba.corto": { porDefecto: "Corto", largoMaximo: 5 },
  "prueba.fn": { porDefecto: "Valor {toString}", marcadores: ["toString"] },
};

describe("marcadoresDe", () => {
  it("devuelve los nombres distintos de los marcadores", () => {
    expect(marcadoresDe("Hasta {n} y {n} más {m2}")).toEqual(new Set(["n", "m2"]));
    expect(marcadoresDe("sin marcadores")).toEqual(new Set());
  });

  it.each(["{ n }", "{}", "{1a}", "{a-b}", "{ñ}", "{n", "n}", "{{", "{_x}"])(
    "%s no es un marcador",
    (texto) => {
      expect(marcadoresDe(texto).size).toBe(0);
    },
  );

  it("un marcador es letra seguida de letras o dígitos", () => {
    expect(marcadoresDe("{a}{Z}{a9}{A0z}")).toEqual(new Set(["a", "Z", "a9", "A0z"]));
  });
});

describe("validarVocabularioContra", () => {
  it("un vocabulario vacío es válido", () => {
    expect(validarVocabularioContra(CATALOGO, {})).toEqual({ ok: true, valor: {} });
  });

  it("devuelve cada texto recortado y en NFC", () => {
    expect(
      validarVocabularioContra(CATALOGO, {
        "prueba.saludo": "  Buenas  ",
        "prueba.corto": "éé",
      }),
    ).toEqual({ ok: true, valor: { "prueba.saludo": "Buenas", "prueba.corto": "éé" } });
  });

  it("una clave que el catálogo no tiene es CLAVE_DE_TEXTO_DESCONOCIDA y nombra el texto", () => {
    expect(validarVocabularioContra(CATALOGO, { "prueba.otro": "x" })).toEqual({
      ok: false,
      error: { codigo: "CLAVE_DE_TEXTO_DESCONOCIDA", texto: "prueba.otro" },
    });
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"])(
    "%s no es una clave del catálogo aunque todo objeto la tenga",
    (clave) => {
      const vocabulario = JSON.parse(`{${JSON.stringify(clave)}: "x"}`) as Record<string, string>;
      expect(validarVocabularioContra(CATALOGO, vocabulario)).toEqual({
        ok: false,
        error: { codigo: "CLAVE_DE_TEXTO_DESCONOCIDA", texto: clave },
      });
    },
  );

  it("un texto inválido es TEXTO_INVALIDO con el motivo, y nombra el texto", () => {
    expect(validarVocabularioContra(CATALOGO, { "prueba.saludo": "<b>Hola</b>" })).toEqual({
      ok: false,
      error: { codigo: "TEXTO_INVALIDO", texto: "prueba.saludo", motivo: "CARACTER_PROHIBIDO" },
    });
    expect(validarVocabularioContra(CATALOGO, { "prueba.saludo": "  " })).toEqual({
      ok: false,
      error: { codigo: "TEXTO_INVALIDO", texto: "prueba.saludo", motivo: "VACIO" },
    });
  });

  it("el máximo por defecto es 80 y el de la clave, si lo declara, manda", () => {
    expect(validarVocabularioContra(CATALOGO, { "prueba.saludo": "a".repeat(80) }).ok).toBe(true);
    expect(validarVocabularioContra(CATALOGO, { "prueba.saludo": "a".repeat(81) })).toEqual({
      ok: false,
      error: { codigo: "TEXTO_INVALIDO", texto: "prueba.saludo", motivo: "DEMASIADO_LARGO" },
    });
    expect(validarVocabularioContra(CATALOGO, { "prueba.corto": "abcde" }).ok).toBe(true);
    expect(validarVocabularioContra(CATALOGO, { "prueba.corto": "abcdef" })).toEqual({
      ok: false,
      error: { codigo: "TEXTO_INVALIDO", texto: "prueba.corto", motivo: "DEMASIADO_LARGO" },
    });
    // Un máximo mayor al de 80 también se respeta.
    expect(
      validarVocabularioContra(CATALOGO, { "prueba.rango": `{desde}{hasta}${"a".repeat(26)}` }).ok,
    ).toBe(true);
    expect(
      validarVocabularioContra(CATALOGO, { "prueba.rango": `{desde}{hasta}${"a".repeat(27)}` }).ok,
    ).toBe(false);
  });

  it("exige exactamente los mismos marcadores que el texto por defecto", () => {
    const distintos = { codigo: "MARCADORES_DISTINTOS" } as const;
    // Falta el marcador.
    expect(validarVocabularioContra(CATALOGO, { "prueba.uno": "Sin tope" })).toEqual({
      ok: false,
      error: { ...distintos, texto: "prueba.uno" },
    });
    // Sobra uno.
    expect(validarVocabularioContra(CATALOGO, { "prueba.uno": "Hasta {n} y {m}" })).toEqual({
      ok: false,
      error: { ...distintos, texto: "prueba.uno" },
    });
    // Otro nombre.
    expect(validarVocabularioContra(CATALOGO, { "prueba.uno": "Hasta {m}" })).toEqual({
      ok: false,
      error: { ...distintos, texto: "prueba.uno" },
    });
    // Una clave sin marcadores no admite ninguno.
    expect(validarVocabularioContra(CATALOGO, { "prueba.saludo": "Hola {n}" })).toEqual({
      ok: false,
      error: { ...distintos, texto: "prueba.saludo" },
    });
    // Falta uno de dos.
    expect(validarVocabularioContra(CATALOGO, { "prueba.rango": "Desde {desde}" })).toEqual({
      ok: false,
      error: { ...distintos, texto: "prueba.rango" },
    });
  });

  it("repetir los marcadores o cambiarlos de lugar no importa, y un texto que parece marcador sin serlo es común", () => {
    expect(
      validarVocabularioContra(CATALOGO, { "prueba.rango": "{hasta} {hasta} y {desde}" }).ok,
    ).toBe(true);
    expect(validarVocabularioContra(CATALOGO, { "prueba.uno": "{n}{n}" }).ok).toBe(true);
    expect(validarVocabularioContra(CATALOGO, { "prueba.saludo": "{ n } {} {1}" }).ok).toBe(true);
  });

  it("informa el primer problema en el orden de las claves", () => {
    expect(
      validarVocabularioContra(CATALOGO, { "prueba.otro": "x", "prueba.saludo": "<" }),
    ).toEqual({
      ok: false,
      error: { codigo: "CLAVE_DE_TEXTO_DESCONOCIDA", texto: "prueba.otro" },
    });
    expect(
      validarVocabularioContra(CATALOGO, { "prueba.saludo": "<", "prueba.otro": "x" }),
    ).toEqual({
      ok: false,
      error: { codigo: "TEXTO_INVALIDO", texto: "prueba.saludo", motivo: "CARACTER_PROHIBIDO" },
    });
  });

  it("un texto inválido gana a unos marcadores distintos", () => {
    expect(validarVocabularioContra(CATALOGO, { "prueba.uno": "<{m}" })).toEqual({
      ok: false,
      error: { codigo: "TEXTO_INVALIDO", texto: "prueba.uno", motivo: "CARACTER_PROHIBIDO" },
    });
  });

  it("no modifica lo que recibe", () => {
    const entrada = { "prueba.saludo": "  Buenas " };
    validarVocabularioContra(CATALOGO, entrada);
    expect(entrada).toEqual({ "prueba.saludo": "  Buenas " });
  });
});

describe("validarVocabulario (el catálogo real)", () => {
  it("acepta un reemplazo válido de una clave del catálogo", () => {
    expect(validarVocabulario({ "rol.gerente.nombre": "Encargado" })).toEqual({
      ok: true,
      valor: { "rol.gerente.nombre": "Encargado" },
    });
  });

  it("respeta los marcadores y el largo propio del catálogo", () => {
    expect(validarVocabulario({ "error.limite_del_plan": "Tope alcanzado: {limite}." }).ok).toBe(
      true,
    );
    expect(validarVocabulario({ "error.limite_del_plan": "Tope alcanzado." })).toEqual({
      ok: false,
      error: { codigo: "MARCADORES_DISTINTOS", texto: "error.limite_del_plan" },
    });
    expect(validarVocabulario({ "rol.gerente.nombre": "a".repeat(81) }).ok).toBe(false);
    expect(validarVocabulario({ "motivo.sin_permiso": "a".repeat(160) }).ok).toBe(true);
    expect(validarVocabulario({ "motivo.sin_permiso": "a".repeat(161) }).ok).toBe(false);
  });

  it("el texto por defecto de cada clave es un reemplazo válido de sí misma", () => {
    const todos = Object.fromEntries(
      Object.entries(CATALOGO_DE_TEXTOS).map(([clave, d]) => [clave, d.porDefecto]),
    );
    expect(validarVocabulario(todos)).toEqual({ ok: true, valor: todos });
  });

  it("una clave inventada es desconocida", () => {
    expect(validarVocabulario({ "reservas.estadia.singular": "Turno" })).toEqual({
      ok: false,
      error: { codigo: "CLAVE_DE_TEXTO_DESCONOCIDA", texto: "reservas.estadia.singular" },
    });
  });
});

describe("clavesHuerfanas", () => {
  it("lista las claves que el catálogo ya no tiene, en el orden guardado", () => {
    expect(
      clavesHuerfanas({
        "rol.gerente.nombre": "Encargado",
        "vieja.clave.uno": "x",
        "otra.vieja.dos": "y",
      }),
    ).toEqual(["vieja.clave.uno", "otra.vieja.dos"]);
    expect(clavesHuerfanas({})).toEqual([]);
    expect(clavesHuerfanas({ "rol.gerente.nombre": "x" })).toEqual([]);
  });
});

describe("resolverVocabularioContra", () => {
  it("gana la marca, después el padre, después el abuelo", () => {
    expect(
      resolverVocabularioContra(CATALOGO, [
        { "prueba.saludo": "Marca" },
        { "prueba.saludo": "Padre", "prueba.corto": "Padre" },
        { "prueba.saludo": "Abuelo", "prueba.corto": "Abuelo", "prueba.uno": "Hasta {n}!" },
      ]),
    ).toEqual({ "prueba.saludo": "Marca", "prueba.corto": "Padre", "prueba.uno": "Hasta {n}!" });
  });

  it("sin eslabones, o con eslabones vacíos, no define nada (queda el texto por defecto)", () => {
    expect(resolverVocabularioContra(CATALOGO, [])).toEqual({});
    expect(resolverVocabularioContra(CATALOGO, [{}, {}, {}])).toEqual({});
  });

  it("ignora las claves huérfanas y las propias de todo objeto", () => {
    const hueco = JSON.parse('{"__proto__": "x", "constructor": "y"}') as Record<string, string>;
    expect(
      resolverVocabularioContra(CATALOGO, [
        { "vieja.clave": "x", ...hueco },
        { "prueba.saludo": "ok" },
      ]),
    ).toEqual({ "prueba.saludo": "ok" });
  });

  it("un reemplazo que ya no es válido deja pasar al siguiente eslabón (y no se pierde el resto)", () => {
    expect(
      resolverVocabularioContra(CATALOGO, [
        { "prueba.saludo": "<b>", "prueba.uno": "Sin marcador", "prueba.corto": "ok" },
        { "prueba.saludo": "Padre", "prueba.uno": "Hasta {n}" },
      ]),
    ).toEqual({ "prueba.saludo": "Padre", "prueba.uno": "Hasta {n}", "prueba.corto": "ok" });
  });

  it("si ningún eslabón trae un reemplazo válido, la clave no aparece", () => {
    expect(
      resolverVocabularioContra(CATALOGO, [{ "prueba.saludo": "" }, { "prueba.saludo": "<" }]),
    ).toEqual({});
  });

  it("devuelve los textos recortados y en NFC", () => {
    expect(resolverVocabularioContra(CATALOGO, [{ "prueba.saludo": "  Holá " }])).toEqual({
      "prueba.saludo": "Holá".normalize("NFC"),
    });
  });

  it("no modifica sus entradas", () => {
    const cadena = [{ "prueba.saludo": " A " }, { "prueba.corto": "B" }];
    resolverVocabularioContra(CATALOGO, cadena);
    expect(cadena).toEqual([{ "prueba.saludo": " A " }, { "prueba.corto": "B" }]);
  });

  it("con el catálogo real: resuelve los roles y deja el resto al catálogo", () => {
    expect(
      resolverVocabulario([
        { "rol.gerente.nombre": "Encargado" },
        { "rol.operador.nombre": "Mozo" },
      ]),
    ).toEqual({ "rol.gerente.nombre": "Encargado", "rol.operador.nombre": "Mozo" });
  });
});

describe("textoContra", () => {
  it("sin reemplazo, el texto por defecto", () => {
    expect(textoContra(CATALOGO, {}, "prueba.saludo")).toBe("Hola");
  });

  it("con reemplazo, el de la marca", () => {
    expect(textoContra(CATALOGO, { "prueba.saludo": "Buenas" }, "prueba.saludo")).toBe("Buenas");
  });

  it("inserta los valores como texto, también los números y el cero", () => {
    expect(textoContra(CATALOGO, {}, "prueba.uno", { n: 5 })).toBe("Hasta 5");
    expect(textoContra(CATALOGO, {}, "prueba.uno", { n: 0 })).toBe("Hasta 0");
    expect(textoContra(CATALOGO, {}, "prueba.uno", { n: "tres" })).toBe("Hasta tres");
    expect(textoContra(CATALOGO, {}, "prueba.rango", { desde: 1, hasta: 9 })).toBe("De 1 a 9");
    expect(
      textoContra(CATALOGO, { "prueba.rango": "{hasta}-{desde}-{hasta}" }, "prueba.rango", {
        desde: 1,
        hasta: 9,
      }),
    ).toBe("9-1-9");
  });

  it("un marcador sin valor queda a la vista, y un valor de más se ignora", () => {
    expect(textoContra(CATALOGO, {}, "prueba.uno")).toBe("Hasta {n}");
    expect(textoContra(CATALOGO, {}, "prueba.uno", {})).toBe("Hasta {n}");
    expect(textoContra(CATALOGO, {}, "prueba.rango", { desde: 1 })).toBe("De 1 a {hasta}");
    expect(textoContra(CATALOGO, {}, "prueba.saludo", { n: 1 })).toBe("Hola");
  });

  it("los valores se insertan como texto: no se vuelven a expandir ni interpretan patrones", () => {
    expect(textoContra(CATALOGO, {}, "prueba.rango", { desde: "{hasta}", hasta: "x" })).toBe(
      "De {hasta} a x",
    );
    expect(textoContra(CATALOGO, {}, "prueba.uno", { n: "$&" })).toBe("Hasta $&");
    expect(textoContra(CATALOGO, {}, "prueba.uno", { n: "$1$$" })).toBe("Hasta $1$$");
    expect(textoContra(CATALOGO, {}, "prueba.uno", { n: "<b>x</b>" })).toBe("Hasta <b>x</b>");
  });

  it("un marcador con el nombre de algo que todo objeto trae no toma esa propiedad", () => {
    expect(textoContra(CATALOGO, {}, "prueba.fn", {})).toBe("Valor {toString}");
    expect(textoContra(CATALOGO, {}, "prueba.fn", { toString: "ok" })).toBe("Valor ok");
  });

  it("un diccionario con una clave que todo objeto trae no la confunde con un reemplazo", () => {
    const diccionario = JSON.parse('{"constructor": "mal"}') as Record<string, string>;
    expect(textoContra(CATALOGO, diccionario, "prueba.saludo")).toBe("Hola");
  });

  it("un reemplazo que queda en blanco cae al texto por defecto, también con valores", () => {
    expect(textoContra(CATALOGO, { "prueba.saludo": "" }, "prueba.saludo")).toBe("Hola");
    expect(textoContra(CATALOGO, { "prueba.saludo": "   " }, "prueba.saludo")).toBe("Hola");
    expect(textoContra(CATALOGO, { "prueba.uno": "{n}" }, "prueba.uno", { n: "" })).toBe("Hasta ");
    expect(textoContra(CATALOGO, { "prueba.uno": "{n}" }, "prueba.uno", { n: " " })).toBe(
      "Hasta  ",
    );
    expect(textoContra(CATALOGO, { "prueba.uno": "{n}" }, "prueba.uno", { n: "ok" })).toBe("ok");
  });

  it("con el catálogo real, por tipo la clave existe y el texto sale", () => {
    expect(texto({}, "rol.gerente.nombre")).toBe("Gerente");
    expect(texto({ "rol.gerente.nombre": "Encargado" }, "rol.gerente.nombre")).toBe("Encargado");
    expect(texto({}, "error.limite_del_plan", { limite: 3 })).toBe(
      "El plan de la empresa llegó a su límite: 3.",
    );
  });
});

describe("diferenciaDeVocabulario", () => {
  it("lista agregados, quitados y cambiados como pares, ordenados por texto", () => {
    expect(
      diferenciaDeVocabulario(
        { "b.cambia": "uno", "c.sale": "x", "d.igual": "i" },
        { "b.cambia": "dos", "a.entra": "y", "d.igual": "i" },
      ),
    ).toEqual([
      { texto: "a.entra", antes: null, despues: "y" },
      { texto: "b.cambia", antes: "uno", despues: "dos" },
      { texto: "c.sale", antes: "x", despues: null },
    ]);
  });

  it("dos vocabularios iguales no tienen diferencia; vaciar un texto no es quitarlo", () => {
    expect(diferenciaDeVocabulario({}, {})).toEqual([]);
    expect(diferenciaDeVocabulario({ "a.b": "x" }, { "a.b": "x" })).toEqual([]);
    expect(diferenciaDeVocabulario({ "a.b": "x" }, { "a.b": "" })).toEqual([
      { texto: "a.b", antes: "x", despues: "" },
    ]);
    expect(diferenciaDeVocabulario({ "a.b": "" }, {})).toEqual([
      { texto: "a.b", antes: "", despues: null },
    ]);
  });

  it("una clave como las propias de todo objeto no se toma por existente", () => {
    expect(
      diferenciaDeVocabulario({}, JSON.parse('{"constructor": "x"}') as Record<string, string>),
    ).toEqual([{ texto: "constructor", antes: null, despues: "x" }]);
  });

  it("se puede auditar: ningún nombre de campo parece un secreto (el texto va como valor, no como campo)", () => {
    const cambios = diferenciaDeVocabulario(
      { "rol.gerente.nombre": "Gerente" },
      { "rol.gerente.nombre": "Encargado", "rol.operador.nombre": "Mozo" },
    );
    expect(campoConPosibleSecreto(cambios as unknown as Dato)).toBeNull();
  });
});

describe("tipos del catálogo real", () => {
  it("una clave inexistente no compila", () => {
    // @ts-expect-error esa clave no está en el catálogo
    const clave: ClaveDeTexto = "reservas.estadia.singular";
    expect(texto({}, "rol.gerente.nombre")).toBeTypeOf("string");
    expect(clave in CATALOGO_DE_TEXTOS).toBe(false);
  });
});
