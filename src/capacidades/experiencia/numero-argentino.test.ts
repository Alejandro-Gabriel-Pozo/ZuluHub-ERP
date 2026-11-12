import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import {
  canonicoDe,
  escribirNumero,
  interpretarNumeroPegado,
  mostrarNumero,
  type ReglaDeNumero,
} from "./numero-argentino";

const IMPORTE: ReglaDeNumero = { decimales: 2, enterosMaximos: 16, completarDecimales: true };
const CANTIDAD: ReglaDeNumero = { decimales: 4, enterosMaximos: 14 };
const ENTERO: ReglaDeNumero = { decimales: 0, enterosMaximos: 6 };

/** Escribe `texto` tecla por tecla sobre un campo vacío, como lo hace la persona: el cursor va al final de lo último escrito. */
function escribirTeclaPorTecla(texto: string, regla: ReglaDeNumero) {
  let actual = { texto: "", canonico: "", cursor: 0 };
  for (const tecla of texto) {
    const crudo = actual.texto.slice(0, actual.cursor) + tecla + actual.texto.slice(actual.cursor);
    actual = escribirNumero(crudo, actual.cursor + 1, regla);
  }
  return actual;
}

describe("escribirNumero: el sistema pone los miles mientras se escribe", () => {
  it.each([
    ["8500", "8.500", "8500.00"],
    ["1234,5", "1.234,5", "1234.50"],
    ["1234567,5", "1.234.567,5", "1234567.50"],
    ["0,5", "0,5", "0.50"],
    [",", "0,", "0.00"],
    ["12", "12", "12.00"],
    ["1234,56", "1.234,56", "1234.56"],
  ])("escribir «%s» muestra «%s» y entrega «%s»", (tecleado, visible, canonico) => {
    const r = escribirTeclaPorTecla(tecleado, IMPORTE);
    expect(r.texto).toBe(visible);
    expect(r.canonico).toBe(canonico);
    expect(r.cursor).toBe(visible.length);
  });

  it("la tecla «.» no escribe nada (decisión 153: el punto no se puede escribir)", () => {
    expect(escribirNumero(".", 1, IMPORTE)).toEqual({ texto: "", canonico: "", cursor: 0 });
    expect(escribirTeclaPorTecla("1.5", IMPORTE).texto).toBe("15");
    expect(escribirTeclaPorTecla("12.50", IMPORTE).texto).toBe("1.250");
    // Con un número ya escrito, el punto tampoco mueve el cursor ni cambia el valor.
    const r = escribirNumero("8.500.", 6, IMPORTE);
    expect(r).toEqual({ texto: "8.500", canonico: "8500.00", cursor: 5 });
  });

  it("una segunda coma, un tercer decimal y lo que no es dígito se ignoran al escribir", () => {
    expect(escribirTeclaPorTecla("1,2,3", IMPORTE).texto).toBe("1,23");
    expect(escribirTeclaPorTecla("1,234", IMPORTE).texto).toBe("1,23");
    expect(escribirTeclaPorTecla("a1b", IMPORTE).texto).toBe("1");
    expect(escribirTeclaPorTecla("-5", IMPORTE).texto).toBe("5");
  });

  it("sin decimales no se admite la coma", () => {
    expect(escribirTeclaPorTecla("12,5", ENTERO).texto).toBe("125");
  });

  it("los ceros a la izquierda no se cuentan y el entero se acota a lo que admite la primitiva", () => {
    expect(escribirNumero("007", 3, IMPORTE).texto).toBe("7");
    expect(escribirNumero("1".repeat(20), 20, IMPORTE).texto).toBe("1.111.111.111.111.111");
    expect(escribirNumero("1".repeat(20), 20, IMPORTE).canonico).toBe("1111111111111111.00");
  });

  it("vacío o sin dígitos no entrega nada", () => {
    expect(escribirNumero("", 0, IMPORTE)).toEqual({ texto: "", canonico: "", cursor: 0 });
    expect(escribirNumero("abc", 3, IMPORTE)).toEqual({ texto: "", canonico: "", cursor: 0 });
  });

  it("la cantidad usa los decimales de su regla (4) y no completa con ceros", () => {
    const r = escribirTeclaPorTecla("1234,56789", CANTIDAD);
    expect(r.texto).toBe("1.234,5678");
    expect(r.canonico).toBe("1234.5678");
    expect(escribirTeclaPorTecla("1234,", CANTIDAD).canonico).toBe("1234");
  });

  it("el cursor no salta: insertar un dígito en el medio deja el cursor detrás de ese dígito", () => {
    // «1.234» con el cursor entre el 1 y el punto: se escribe un 9 → «19.234».
    const r = escribirNumero("19.234", 2, IMPORTE);
    expect(r.texto).toBe("19.234");
    expect(r.cursor).toBe(2);
    // Cambia la agrupación: «9.999» + un 9 al final de «99.99» → el cursor sigue al final.
    const s = escribirNumero("9.9999", 6, IMPORTE);
    expect(s.texto).toBe("99.999");
    expect(s.cursor).toBe(6);
  });

  it("borrar un punto de miles no cambia el valor ni lo rompe", () => {
    // «8.500» con el cursor detrás del punto; Retroceso lo borra → «8500», cursor en 1.
    const r = escribirNumero("8500", 1, IMPORTE);
    expect(r.texto).toBe("8.500");
    expect(r.canonico).toBe("8500.00");
    expect(r.cursor).toBe(1);
  });

  it("para cualquier texto: nunca deja otra cosa que dígitos, puntos de miles y a lo sumo una coma; y es idempotente", () => {
    fc.assert(
      fc.property(fc.string(), (crudo) => {
        const r = escribirNumero(crudo, crudo.length, IMPORTE);
        expect(r.texto).toMatch(/^(?:|(?:0|[1-9]\d{0,2}(?:\.\d{3})*)(?:,\d{0,2})?)$/);
        const otra = escribirNumero(r.texto, r.texto.length, IMPORTE);
        expect(otra.texto).toBe(r.texto);
        expect(otra.canonico).toBe(r.canonico);
        expect(r.cursor).toBeGreaterThanOrEqual(0);
        expect(r.cursor).toBeLessThanOrEqual(r.texto.length);
      }),
    );
  });
});

describe("escribirNumero: casos exactos de borde", () => {
  it("con el cursor al principio, el cursor queda al principio", () => {
    expect(escribirNumero("8500", 0, IMPORTE)).toEqual({
      texto: "8.500",
      canonico: "8500.00",
      cursor: 0,
    });
  });

  it("si lo de delante del cursor se descarta (ceros), el cursor se acota al texto", () => {
    expect(escribirNumero("007", 3, IMPORTE).cursor).toBe(1);
    expect(escribirNumero("07", 2, IMPORTE)).toEqual({ texto: "7", canonico: "7.00", cursor: 1 });
  });

  it("la coma al principio muestra un 0: el cursor lo cuenta solo si ya pasó la coma", () => {
    expect(escribirNumero(",", 0, IMPORTE)).toEqual({ texto: "0,", canonico: "0.00", cursor: 0 });
    expect(escribirNumero(",", 1, IMPORTE)).toEqual({ texto: "0,", canonico: "0.00", cursor: 2 });
    expect(escribirNumero(",5", 1, IMPORTE).cursor).toBe(2);
    expect(escribirNumero(",5", 2, IMPORTE).cursor).toBe(3);
    // Con parte entera no hay ningún cero agregado.
    expect(escribirNumero("1,5", 2, IMPORTE).cursor).toBe(2);
    expect(escribirNumero("1,5", 3, IMPORTE).cursor).toBe(3);
  });

  it("una segunda coma no entra, no mueve el cursor y lo que sigue sigue siendo decimal", () => {
    expect(escribirNumero("1,2,3", 5, IMPORTE)).toEqual({
      texto: "1,23",
      canonico: "1.23",
      cursor: 4,
    });
    expect(escribirNumero("1,,", 3, IMPORTE)).toEqual({ texto: "1,", canonico: "1.00", cursor: 2 });
  });

  it("el último decimal admitido entra y el siguiente no, con cualquier cantidad de decimales", () => {
    expect(escribirNumero("1,23", 4, IMPORTE).texto).toBe("1,23");
    expect(escribirNumero("1,234", 5, IMPORTE).texto).toBe("1,23");
    expect(escribirNumero("1,2", 3, { decimales: 1, enterosMaximos: 5 }).texto).toBe("1,2");
    expect(escribirNumero("1,23", 4, { decimales: 1, enterosMaximos: 5 }).texto).toBe("1,2");
  });

  it("los enteros máximos: exactamente el máximo entra y uno más se descarta", () => {
    expect(escribirNumero("12345", 5, { decimales: 0, enterosMaximos: 5 }).canonico).toBe("12345");
    expect(escribirNumero("123456", 6, { decimales: 0, enterosMaximos: 5 }).canonico).toBe("12345");
  });

  it("completar decimales: con 0 decimales no hay punto; con 1 o más se completan", () => {
    expect(
      escribirNumero("5", 1, { decimales: 0, enterosMaximos: 5, completarDecimales: true })
        .canonico,
    ).toBe("5");
    expect(
      escribirNumero("5", 1, { decimales: 1, enterosMaximos: 5, completarDecimales: true })
        .canonico,
    ).toBe("5.0");
    expect(
      escribirNumero("5,2", 3, { decimales: 3, enterosMaximos: 5, completarDecimales: true })
        .canonico,
    ).toBe("5.200");
    expect(escribirNumero("5", 1, { decimales: 2, enterosMaximos: 5 }).canonico).toBe("5");
    expect(escribirNumero("5,", 2, { decimales: 2, enterosMaximos: 5 }).canonico).toBe("5");
    expect(escribirNumero("5,20", 4, { decimales: 2, enterosMaximos: 5 }).canonico).toBe("5.20");
  });
});

describe("mostrarNumero: bordes", () => {
  it("exactamente los enteros máximos se muestran y uno más se rechaza", () => {
    expect(mostrarNumero("9".repeat(16), IMPORTE)).toBe("9.999.999.999.999.999,00");
    expect(mostrarNumero("9".repeat(17), IMPORTE)).toBe("");
    expect(mostrarNumero("12345", { decimales: 0, enterosMaximos: 5 })).toBe("12.345");
    expect(mostrarNumero("123456", { decimales: 0, enterosMaximos: 5 })).toBe("");
  });

  it("completar decimales: 0 decimales no agrega coma; 1 o más completan con ceros", () => {
    expect(mostrarNumero("5", { decimales: 0, enterosMaximos: 5, completarDecimales: true })).toBe(
      "5",
    );
    expect(mostrarNumero("5", { decimales: 1, enterosMaximos: 5, completarDecimales: true })).toBe(
      "5,0",
    );
    expect(
      mostrarNumero("5.2", { decimales: 3, enterosMaximos: 5, completarDecimales: true }),
    ).toBe("5,200");
    expect(mostrarNumero("5.2", { decimales: 3, enterosMaximos: 5 })).toBe("5,2");
    expect(mostrarNumero("5.2", { decimales: 1, enterosMaximos: 5 })).toBe("5,2");
    expect(mostrarNumero("5.23", { decimales: 1, enterosMaximos: 5 })).toBe("");
  });
});

describe("interpretarNumeroPegado: sin adivinar", () => {
  it.each([
    ["1.234,56", "1.234,56", "1234.56"],
    ["1234,56", "1.234,56", "1234.56"],
    ["0,5", "0,5", "0.50"],
    ["14.000,50", "14.000,50", "14000.50"],
    ["  1234,5 ", "1.234,5", "1234.50"],
    ["1234", "1.234", "1234.00"],
    ["1.234", "1.234", "1234.00"],
  ])("pegar «%s» entra como «%s» (%s)", (pegado, visible, canonico) => {
    const r = interpretarNumeroPegado(pegado, IMPORTE);
    expect(r).toMatchObject({ ok: true, texto: visible, canonico });
  });

  it.each([
    // Un punto que no separa miles bien: se rechaza, nunca se adivina.
    ["1234.56", "PUNTO_MAL_PUESTO"],
    ["2.5", "PUNTO_MAL_PUESTO"],
    ["1.2.3", "PUNTO_MAL_PUESTO"],
    ["12.34,5", "PUNTO_MAL_PUESTO"],
    ["1,234.5", "PUNTO_MAL_PUESTO"],
    ["1.234,5.6", "PUNTO_MAL_PUESTO"],
    ["1234,567", "DECIMALES_DE_MAS"],
    ["1,2,3", "FORMA_INVALIDA"],
    ["abc", "FORMA_INVALIDA"],
    ["-5", "FORMA_INVALIDA"],
    ["1e3", "FORMA_INVALIDA"],
    ["", "FORMA_INVALIDA"],
    ["5,", "FORMA_INVALIDA"],
    ["007", "FORMA_INVALIDA"],
    ["12345678901234567", "FORMA_INVALIDA"],
  ])("pegar «%s» se rechaza (%s)", (pegado, motivo) => {
    expect(interpretarNumeroPegado(pegado, IMPORTE)).toEqual({ ok: false, motivo });
  });

  it("la cantidad admite hasta 4 decimales con coma; con punto sigue rechazándose", () => {
    expect(interpretarNumeroPegado("1234,5678", CANTIDAD)).toMatchObject({
      ok: true,
      canonico: "1234.5678",
    });
    expect(interpretarNumeroPegado("1234.5678", CANTIDAD)).toEqual({
      ok: false,
      motivo: "PUNTO_MAL_PUESTO",
    });
    expect(interpretarNumeroPegado("1,25", CANTIDAD)).toMatchObject({ ok: true, canonico: "1.25" });
  });

  it("sin decimales, una coma se rechaza", () => {
    expect(interpretarNumeroPegado("12,5", ENTERO)).toEqual({
      ok: false,
      motivo: "DECIMALES_DE_MAS",
    });
    expect(interpretarNumeroPegado("12", ENTERO)).toMatchObject({ ok: true, canonico: "12" });
  });

  it("lo que muestra el sistema se puede volver a pegar y conserva el valor", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 99 }),
        (e, d) => {
          const visible = mostrarNumero(`${e}.${String(d).padStart(2, "0")}`, IMPORTE);
          const r = interpretarNumeroPegado(visible, IMPORTE);
          expect(r).toMatchObject({ ok: true, canonico: `${e}.${String(d).padStart(2, "0")}` });
        },
      ),
    );
  });

  it("para cualquier texto: o se acepta con un canónico bien formado, o se rechaza con motivo", () => {
    fc.assert(
      fc.property(fc.string(), (crudo) => {
        const r = interpretarNumeroPegado(crudo, IMPORTE);
        if (r.ok) expect(r.canonico).toMatch(/^(?:0|[1-9]\d{0,15})\.\d{2}$/);
        else expect(["PUNTO_MAL_PUESTO", "DECIMALES_DE_MAS", "FORMA_INVALIDA"]).toContain(r.motivo);
      }),
    );
  });
});

describe("mostrarNumero y canonicoDe", () => {
  it.each([
    ["1234.5", "1.234,50"],
    ["0", "0,00"],
    ["1234567.89", "1.234.567,89"],
    ["", ""],
    ["1,5", ""],
    ["-1", ""],
    ["1.234", ""],
    ["1234.567", ""],
    ["12345678901234567", ""],
  ])("mostrar «%s» da «%s»", (canonico, visible) => {
    expect(mostrarNumero(canonico, IMPORTE)).toBe(visible);
  });

  it("sin completar decimales, muestra lo que hay", () => {
    expect(mostrarNumero("1234.5", CANTIDAD)).toBe("1.234,5");
    expect(mostrarNumero("1234", CANTIDAD)).toBe("1.234");
  });

  it("canonicoDe devuelve el valor de lo que hay en el campo", () => {
    expect(canonicoDe("1.234,5", IMPORTE)).toBe("1234.50");
    expect(canonicoDe("", IMPORTE)).toBe("");
  });
});
