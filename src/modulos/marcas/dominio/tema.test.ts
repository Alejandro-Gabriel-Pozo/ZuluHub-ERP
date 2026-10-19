import { describe, expect, it } from "vitest";
import type { SuperficieDeAspecto } from "./aspecto";
import {
  COLORES_DE_SUPERFICIE,
  CONTRASTE_MINIMO_DEL_ACENTO,
  CONTRASTE_MINIMO_DEL_TEXTO,
  TOKENS_DE_TEMA,
  contrasteSuficiente,
  esTokenDeTema,
  luminanciaRelativa,
  parDeContrasteInsuficiente,
  razonDeContraste,
  validarTema,
  type TemaCompleto,
} from "./tema";

describe("validarTema", () => {
  it("la lista de tokens es cerrada y fija", () => {
    expect(TOKENS_DE_TEMA).toEqual(["primary", "on-primary", "secondary", "accent"]);
    expect(esTokenDeTema("primary")).toBe(true);
    expect(esTokenDeTema("on-primary")).toBe(true);
    expect(esTokenDeTema("secondary")).toBe(true);
    expect(esTokenDeTema("accent")).toBe(true);
    expect(esTokenDeTema("background")).toBe(false);
    expect(esTokenDeTema("Primary")).toBe(false);
    expect(esTokenDeTema("constructor")).toBe(false);
    expect(esTokenDeTema("")).toBe(false);
  });

  it("acepta un tema vacío (todo se hereda), uno parcial y uno completo", () => {
    expect(validarTema({})).toEqual({ ok: true, valor: {} });
    expect(validarTema({ accent: "#00ff7f" })).toEqual({ ok: true, valor: { accent: "#00ff7f" } });
    const completo = {
      primary: "#1a73e8",
      "on-primary": "#ffffff",
      secondary: "#5f6368",
      accent: "#d93025",
    };
    expect(validarTema(completo)).toEqual({ ok: true, valor: completo });
  });

  it("devuelve los tokens en el orden de la lista, sea cual sea el de entrada", () => {
    const resultado = validarTema({
      accent: "#000000",
      primary: "#111111",
      "on-primary": "#222222",
    });
    expect(resultado.ok && Object.keys(resultado.valor)).toEqual([
      "primary",
      "on-primary",
      "accent",
    ]);
  });

  it("acepta todos los dígitos hexadecimales en minúsculas", () => {
    expect(validarTema({ primary: "#0123ef" }).ok).toBe(true);
    expect(validarTema({ primary: "#456789" }).ok).toBe(true);
    expect(validarTema({ primary: "#abcdef" }).ok).toBe(true);
  });

  it.each([
    ["corto", "#FFF"],
    ["corto en minúsculas", "#fff"],
    ["cuatro dígitos", "#ffff"],
    ["siete dígitos", "#1234567"],
    ["ocho dígitos (con alfa)", "#12345678"],
    ["mayúsculas", "#ABCDEF"],
    ["mezcla de mayúsculas", "#abcdeF"],
    ["sin numeral", "123456"],
    ["rgb()", "rgb(0,0,0)"],
    ["hsl()", "hsl(0, 0%, 0%)"],
    ["nombre de color", "red"],
    ["url()", "url(https://x.test/a.png)"],
    ["var()", "var(--otra)"],
    ["cierre de regla", "#123456;}"],
    ["inyección de otra propiedad", "#123456; background: red"],
    ["dígito no hexadecimal", "#12345g"],
    ["con espacio", "#123456 "],
    ["con salto de línea al final", "#123456\n"],
    ["con espacio al principio", " #123456"],
    ["vacío", ""],
  ])("rechaza el valor %s", (_nombre, valor) => {
    expect(validarTema({ primary: valor })).toEqual({
      ok: false,
      error: { codigo: "TEMA_INVALIDO", token: "primary" },
    });
  });

  it("rechaza un valor que no es texto", () => {
    for (const valor of [123456, null, undefined, true, ["#123456"], { a: 1 }]) {
      expect(validarTema({ accent: valor })).toEqual({
        ok: false,
        error: { codigo: "TEMA_INVALIDO", token: "accent" },
      });
    }
  });

  it.each([
    "background",
    "Primary",
    "ON-PRIMARY",
    "on_primary",
    "primary ",
    "--brand-primary",
    "",
    "color",
  ])("rechaza la clave %j, que no está en la lista", (clave) => {
    expect(validarTema({ [clave]: "#123456" })).toEqual({
      ok: false,
      error: { codigo: "TEMA_INVALIDO", token: clave },
    });
  });

  it("una clave propia de todo objeto o un __proto__ de JSON tampoco pasan", () => {
    for (const clave of ["constructor", "toString", "__proto__"]) {
      const entrada = JSON.parse(`{${JSON.stringify(clave)}: "#123456"}`) as Record<
        string,
        unknown
      >;
      expect(validarTema(entrada)).toEqual({
        ok: false,
        error: { codigo: "TEMA_INVALIDO", token: clave },
      });
    }
  });

  it("informa la primera clave con problema, en el orden de la entrada", () => {
    expect(validarTema({ primary: "#123456", accent: "rojo", "on-primary": "x" })).toEqual({
      ok: false,
      error: { codigo: "TEMA_INVALIDO", token: "accent" },
    });
    expect(validarTema({ "on-primary": "x", accent: "rojo" })).toEqual({
      ok: false,
      error: { codigo: "TEMA_INVALIDO", token: "on-primary" },
    });
    expect(validarTema({ otra: "#123456", accent: "rojo" })).toEqual({
      ok: false,
      error: { codigo: "TEMA_INVALIDO", token: "otra" },
    });
  });

  it("no modifica lo que recibe ni devuelve el mismo objeto", () => {
    const entrada = { accent: "#000000" };
    const resultado = validarTema(entrada);
    expect(entrada).toEqual({ accent: "#000000" });
    expect(resultado.ok && resultado.valor).not.toBe(entrada);
  });
});

// Las fórmulas de la norma, escritas aparte para comparar sin repetir el código.
const lineal = (canal: number) => {
  const c = canal / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

describe("luminanciaRelativa (WCAG)", () => {
  it("el negro es 0 y el blanco es 1", () => {
    expect(luminanciaRelativa("#000000")).toBe(0);
    expect(luminanciaRelativa("#ffffff")).toBeCloseTo(1, 12);
  });

  it("cada canal pesa lo que dice la norma, y se lee de su lugar", () => {
    expect(luminanciaRelativa("#ff0000")).toBeCloseTo(0.2126, 12);
    expect(luminanciaRelativa("#00ff00")).toBeCloseTo(0.7152, 12);
    expect(luminanciaRelativa("#0000ff")).toBeCloseTo(0.0722, 12);
    expect(luminanciaRelativa("#102030")).toBeCloseTo(
      0.2126 * lineal(0x10) + 0.7152 * lineal(0x20) + 0.0722 * lineal(0x30),
      12,
    );
  });

  it("los canales de dos dígitos se leen enteros (no solo el primero)", () => {
    expect(luminanciaRelativa("#ab0000")).toBeCloseTo(0.2126 * lineal(0xab), 12);
    expect(luminanciaRelativa("#00cd00")).toBeCloseTo(0.7152 * lineal(0xcd), 12);
    expect(luminanciaRelativa("#0000ef")).toBeCloseTo(0.0722 * lineal(0xef), 12);
  });

  it("el tramo recto llega hasta el canal 10 y la curva empieza en el 11", () => {
    // En el corte las dos fórmulas casi coinciden (difieren en la séptima cifra): se compara fino.
    expect(luminanciaRelativa("#0a0a0a")).toBeCloseTo(10 / 255 / 12.92, 12);
    expect(luminanciaRelativa("#0b0b0b")).toBeCloseTo(((11 / 255 + 0.055) / 1.055) ** 2.4, 12);
    expect(luminanciaRelativa("#010101")).toBeCloseTo(1 / 255 / 12.92, 12);
    expect(luminanciaRelativa("#808080")).toBeCloseTo(0.21586050011389926, 12);
  });
});

describe("razonDeContraste (WCAG)", () => {
  it("negro sobre blanco es 21; un color con sí mismo es 1", () => {
    expect(razonDeContraste("#000000", "#ffffff")).toBeCloseTo(21, 10);
    expect(razonDeContraste("#336699", "#336699")).toBe(1);
  });

  it("no depende del orden", () => {
    expect(razonDeContraste("#ffffff", "#000000")).toBe(razonDeContraste("#000000", "#ffffff"));
    expect(razonDeContraste("#1a73e8", "#ffffff")).toBe(razonDeContraste("#ffffff", "#1a73e8"));
  });

  it("valores de referencia", () => {
    expect(razonDeContraste("#767676", "#ffffff")).toBeCloseTo(4.542224959605253, 10);
    expect(razonDeContraste("#777777", "#ffffff")).toBeCloseTo(4.478089453577214, 10);
    expect(razonDeContraste("#1a73e8", "#ffffff")).toBeCloseTo(4.505031181033489, 10);
    expect(razonDeContraste("#336699", "#ffffff")).toBeCloseTo(5.997786839657083, 10);
    expect(razonDeContraste("#949494", "#ffffff")).toBeCloseTo(3.0334698257384747, 10);
  });

  it("no redondea: 4,478 no pasa por 4,5", () => {
    expect(contrasteSuficiente("#777777", "#ffffff", 4.5)).toBe(false);
    expect(contrasteSuficiente("#767676", "#ffffff", 4.5)).toBe(true);
  });
});

describe("contrasteSuficiente", () => {
  it("igual al mínimo pasa (WCAG: al menos); apenas por debajo, no", () => {
    const razon = razonDeContraste("#1a73e8", "#ffffff");
    expect(contrasteSuficiente("#1a73e8", "#ffffff", razon)).toBe(true);
    expect(contrasteSuficiente("#1a73e8", "#ffffff", razon + Number.EPSILON * 8)).toBe(false);
    expect(contrasteSuficiente("#1a73e8", "#ffffff", razon - Number.EPSILON * 8)).toBe(true);
  });
});

const tema = (cambios: Partial<TemaCompleto> = {}): TemaCompleto => ({
  primary: "#1a73e8",
  "on-primary": "#ffffff",
  secondary: "#ffffff",
  accent: "#d93025",
  ...cambios,
});

describe("parDeContrasteInsuficiente (al confirmar)", () => {
  const par = (t: TemaCompleto, superficie: SuperficieDeAspecto = "NEUTRA") =>
    parDeContrasteInsuficiente(t, superficie);

  it("los mínimos son los de la norma", () => {
    expect(CONTRASTE_MINIMO_DEL_TEXTO).toBe(4.5);
    expect(CONTRASTE_MINIMO_DEL_ACENTO).toBe(3);
  });

  it("un tema legible no tiene problema", () => {
    expect(par(tema())).toBeNull();
  });

  it("on-primary sobre primary pide 4,5:1: justo arriba pasa, justo abajo no", () => {
    // #1a73e8 con blanco da 4,505; con #1a73e9 (un poco más claro) baja de 4,5.
    expect(razonDeContraste("#1a73e8", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(razonDeContraste("#2574ea", "#ffffff")).toBeLessThan(4.5);
    expect(par(tema({ primary: "#1a73e8" }))).toBeNull();
    expect(par(tema({ primary: "#2574ea" }))).toBe("on-primary/primary");
  });

  it("el texto puede ser claro sobre oscuro o al revés", () => {
    expect(par(tema({ primary: "#ffffff", "on-primary": "#000000" }))).toBeNull();
    expect(par(tema({ primary: "#000000", "on-primary": "#ffffff" }))).toBeNull();
    expect(par(tema({ primary: "#ffffff", "on-primary": "#fefefe" }))).toBe("on-primary/primary");
  });

  it("accent sobre el fondo de la neutra (blanco) pide 3:1: #949494 llega (3,03) y #959595 no (2,995)", () => {
    expect(razonDeContraste("#949494", "#ffffff")).toBeGreaterThanOrEqual(3);
    // Sobre blanco #949494 alcanza, pero la superficie de la neutra pide un gris más oscuro.
    expect(par(tema({ accent: "#949494" }))).toBe("accent/superficie");
    expect(par(tema({ accent: "#8d8d8d" }))).toBeNull();
    expect(par(tema({ accent: "#959595" }))).toBe("accent/fondo");
    expect(par(tema({ accent: "#ffffff" }))).toBe("accent/fondo");
  });

  it("el acento se mide contra el fondo y no contra primary", () => {
    // Un acento igual al primary contrasta 1 con él, pero sobre blanco es legible.
    expect(par(tema({ accent: "#1a73e8" }))).toBeNull();
    // Un acento claro sobre un primary oscuro no se salva por contrastar con él.
    expect(par(tema({ primary: "#000000", accent: "#fafafa" }))).toBe("accent/fondo");
  });

  it("si fallan los dos pares, se informa primero el del texto", () => {
    expect(par(tema({ "on-primary": "#1a73e8", accent: "#ffffff" }))).toBe("on-primary/primary");
  });

  it("secondary no se mide", () => {
    expect(par(tema({ secondary: "#ffffff" }))).toBeNull();
    expect(par(tema({ secondary: "#000000" }))).toBeNull();
  });

  it("las tres superficies tienen los colores de los prototipos aprobados", () => {
    expect(COLORES_DE_SUPERFICIE).toEqual({
      NEUTRA: { fondo: "#ffffff", superficie: "#f3f5f7" },
      CALIDA: { fondo: "#fbf7f1", superficie: "#f3eadc" },
      FRIA: { fondo: "#f5f8fc", superficie: "#e6edf6" },
    });
  });

  // Por superficie: el gris más oscuro que NO pasa sobre el fondo, el más claro que pasa sobre la
  // superficie y el primero que no pasa sobre ella (cada uno medido con `razonDeContraste`).
  const LIMITES = [
    { s: "NEUTRA", falla: "#959595", pasaSup: "#8d8d8d", fallaSup: "#8e8e8e" },
    { s: "CALIDA", falla: "#909090", pasaSup: "#878787", fallaSup: "#888888" },
    { s: "FRIA", falla: "#909090", pasaSup: "#888888", fallaSup: "#898989" },
  ] as const;

  it.each(LIMITES)("$s: el acento se mide sobre el fondo y sobre la superficie", (caso) => {
    const colores = COLORES_DE_SUPERFICIE[caso.s];
    expect(razonDeContraste(caso.falla, colores.fondo)).toBeLessThan(3);
    expect(razonDeContraste(caso.pasaSup, colores.superficie)).toBeGreaterThanOrEqual(3);
    expect(razonDeContraste(caso.fallaSup, colores.superficie)).toBeLessThan(3);
    expect(razonDeContraste(caso.fallaSup, colores.fondo)).toBeGreaterThanOrEqual(3);
    expect(par(tema({ accent: caso.pasaSup }), caso.s)).toBeNull();
    expect(par(tema({ accent: caso.fallaSup }), caso.s)).toBe("accent/superficie");
    expect(par(tema({ accent: caso.falla }), caso.s)).toBe("accent/fondo");
  });

  it("un acento que pasa en una superficie puede no pasar en otra", () => {
    // #8d8d8d llega a 3:1 sobre la superficie neutra y no sobre la de la cálida.
    expect(par(tema({ accent: "#8d8d8d" }), "NEUTRA")).toBeNull();
    expect(par(tema({ accent: "#8d8d8d" }), "CALIDA")).toBe("accent/superficie");
    expect(par(tema({ accent: "#8d8d8d" }), "FRIA")).toBe("accent/superficie");
  });
});
