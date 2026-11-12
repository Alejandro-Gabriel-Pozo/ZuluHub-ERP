import { describe, expect, it } from "vitest";
import { soloCaracteresPermitidos, textoDeUnaLineaDesdeTexto } from "./texto-de-una-linea";

/** Las reglas de un dato que no exige letra (como el domicilio): lo que se prueba acá es la regla común. */
const con = (maximo: number) => ({ maximo, exigirUnaLetra: false });

const valido = (texto: string, esperado: string) =>
  expect(textoDeUnaLineaDesdeTexto(texto, con(200)), JSON.stringify(texto)).toEqual({
    ok: true,
    valor: esperado,
  });
const invalido = (texto: string, motivo: string, maximo = 200) =>
  expect(textoDeUnaLineaDesdeTexto(texto, con(maximo)), JSON.stringify(texto)).toEqual({
    ok: false,
    error: motivo,
  });

describe("textoDeUnaLineaDesdeTexto: lo que acepta", () => {
  it("texto común: acentos, ñ, signos de razón social y números; conserva las mayúsculas", () => {
    for (const texto of [
      "Distribuidora Sur SA",
      "Pérez & Hijos S.A.",
      "D'Angelo",
      "La 5ta. SRL",
      "Cía. Ñandú (Mendoza)",
      "Gómez y/o Sosa",
      'Nº 5 — "El Gaucho"',
      "Coca-Cola® Argentina",
      "PEREZ E HIJOS",
    ]) {
      valido(texto, texto);
    }
  });

  it("recorta los extremos y colapsa los blancos repetidos, también el espacio de no corte", () => {
    valido("  Juan   Pérez  ", "Juan Pérez");
    valido("Juan  Pérez", "Juan Pérez");
  });

  it("pasa a NFC: «é» de una o de dos piezas es el mismo texto", () => {
    valido("José", "José");
  });

  it("el tope exacto entra y uno más no", () => {
    valido("a".repeat(200), "a".repeat(200));
    invalido("a".repeat(201), "DEMASIADO_LARGO");
    expect(textoDeUnaLineaDesdeTexto("ñ".repeat(5), con(5)).ok).toBe(true);
    invalido("ñ".repeat(6), "DEMASIADO_LARGO", 5);
  });

  it("el largo se mide después de normalizar y colapsar", () => {
    expect(textoDeUnaLineaDesdeTexto("a    b", con(3)).ok).toBe(true);
  });
});

describe("recorte de extremos y arranque con signo de fórmula", () => {
  it("los saltos de línea y tabuladores en los extremos se recortan: «Juan\\n» queda «Juan»", () => {
    for (const texto of ["Juan\n", "Juan\t", "\nJuan", "\tJuan", " \r\n Juan \t "]) {
      valido(texto, "Juan");
    }
  });

  it("adentro del texto esos mismos caracteres se rechazan", () => {
    for (const texto of ["Ju\nan", "Ju\tan", "Ju\ran"]) invalido(texto, "CARACTER_PROHIBIDO");
  });

  it("no puede empezar con `+` ni `-` (inyección de fórmulas), ni siquiera después del recorte", () => {
    for (const texto of ["+54 11", "-Juan", "- Juan", "+", "-", "  -Juan", "\n+1"]) {
      invalido(texto, "CARACTER_PROHIBIDO");
    }
  });

  it("un `+` o `-` inicial se informa como carácter prohibido, no como falta de letras, aunque se exija una letra", () => {
    const exige = { maximo: 200, exigirUnaLetra: true };
    for (const texto of ["-", "+", "-1234", "+54 11", "- 9"]) {
      expect(textoDeUnaLineaDesdeTexto(texto, exige), texto).toEqual({
        ok: false,
        error: "CARACTER_PROHIBIDO",
      });
    }
  });

  it("un `+` o `-` inicial se informa antes que el largo, también con exceso de largo", () => {
    const corto = { maximo: 5, exigirUnaLetra: false };
    for (const texto of ["+123456", "-abcdefg", "+" + "a".repeat(300)]) {
      expect(textoDeUnaLineaDesdeTexto(texto, corto), texto).toEqual({
        ok: false,
        error: "CARACTER_PROHIBIDO",
      });
    }
    // Sin el signo inicial, el mismo exceso de largo sí se informa como largo.
    expect(textoDeUnaLineaDesdeTexto("123456", corto)).toEqual({
      ok: false,
      error: "DEMASIADO_LARGO",
    });
  });

  it("`=` y `@` quedan afuera en cualquier posición, también al principio (los frena la lista de permitidos)", () => {
    for (const texto of ["=SUMA(A1)", "@usuario", "a=b", "a@b", "Juan =1"]) {
      invalido(texto, "CARACTER_PROHIBIDO");
    }
  });

  it("`+` y `-` en el medio o al final entran: «Coca-Cola», «Hotel 9-A», «Juan +»", () => {
    for (const texto of ["Coca-Cola", "Hotel 9-A", "Pérez-Gómez", "Juan +", "Juan -", "A+B"]) {
      valido(texto, texto);
    }
  });
});

describe("la lista de permitidos", () => {
  it("cada carácter declarado entra, uno por uno", () => {
    const permitidos =
      "ABCXYZabcxyz0123456789 .,&-'/()°+:;\"#ºª’“”–—«»®™¿¡?!%$ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿŠšŒœŽžŸ";
    for (const caracter of permitidos) {
      expect(soloCaracteresPermitidos(`a${caracter}b`), caracter).toBe(true);
    }
  });

  it("lo que no está declarado se rechaza: otros alfabetos, letras latinas extendidas, símbolos y números de otros sistemas", () => {
    for (const texto of [
      "Łódź Importaciones",
      "Ørsted\u0141",
      "小林商事",
      "בנק",
      "مصرف",
      "Иван",
      "Αθήνα",
      "Juan ١٢٣",
      "Juan ×2",
      "Juan ÷2",
      "5 € ",
      "Juan @ casa",
      "Juan = 3",
      "a_b",
      "a|b",
      "a\\b",
      "a[b]",
      "a{b}",
      "a~b",
      "a`b",
      "a^b",
      "a*b",
    ]) {
      invalido(texto, "CARACTER_PROHIBIDO");
    }
  });

  it("`¿ ¡ ? ! % $` entran (dueño, Q3 del 12/11/2026): los nombres reales de una carta, en cualquier posición", () => {
    for (const texto of [
      "¿Querés papas?",
      "¡Promo!",
      "Combo 2x1 50% $500",
      "50% off",
      "$ 100",
      "a!b",
      "a?b",
      "$500",
      "%",
      "?",
      "¡",
    ]) {
      valido(texto, texto);
    }
  });

  it("lo que el pedido de la carta NO ensancha sigue afuera: `_ | \\ [ ] { } ~ ` ^ * = @ < > € × ÷` y los de otros alfabetos", () => {
    for (const texto of [
      "a_b",
      "a|b",
      "a\\b",
      "a[b]",
      "a{b}",
      "a~b",
      "a`b",
      "a^b",
      "a*b",
      "a=b",
      "a@b",
      "a<b",
      "a>b",
      "5 €",
      "a×b",
      "a÷b",
      "‽",
      "¿¡¿" + "😀",
    ]) {
      invalido(texto, "CARACTER_PROHIBIDO");
    }
  });

  it("los nuevos no abren una fórmula: el arranque con `+` o `-` sigue rechazado y y `¿ +` adentro del texto pasa", () => {
    invalido("+¿Querés?", "CARACTER_PROHIBIDO");
    invalido("-$500", "CARACTER_PROHIBIDO");
    valido("¿+1?", "¿+1?");
  });

  it("los signos que se pegan desde un procesador de texto entran: comillas y guiones tipográficos", () => {
    valido("Hnos. O’Higgins – “Cía.” —", "Hnos. O’Higgins – “Cía.” —");
  });

  it("los espacios tipográficos y de no corte son espacio; los de control no", () => {
    valido("a\u2003b\u202fc\u3000d", "a b c d");
    invalido("a\u0009b", "CARACTER_PROHIBIDO");
  });

  it("exigirUnaLetra: solo cuentan las letras latinas; dígitos, signos, º y ª no", () => {
    const exige = { maximo: 200, exigirUnaLetra: true };
    for (const texto of ["a", "Ñ", "1 ü", "Œ", "5º A"]) {
      expect(textoDeUnaLineaDesdeTexto(texto, exige), texto).toEqual({ ok: true, valor: texto });
    }
    for (const texto of ["123", "5º", "1ª", "20-12345678-6", "&&&"]) {
      expect(textoDeUnaLineaDesdeTexto(texto, exige), texto).toEqual({
        ok: false,
        error: "SIN_LETRAS",
      });
    }
  });

  it("sin exigirUnaLetra un texto de solo números entra (un domicilio como «1234»)", () => {
    valido("1234", "1234");
    valido("9 de Julio 1234", "9 de Julio 1234");
  });

  it("el orden de los motivos: vacío, carácter prohibido, largo y, al final, la falta de letras", () => {
    const exige = { maximo: 5, exigirUnaLetra: true };
    expect(textoDeUnaLineaDesdeTexto("  ", exige)).toEqual({ ok: false, error: "VACIO" });
    expect(textoDeUnaLineaDesdeTexto("😀😀😀😀😀😀", exige)).toEqual({
      ok: false,
      error: "CARACTER_PROHIBIDO",
    });
    expect(textoDeUnaLineaDesdeTexto("123456", exige)).toEqual({
      ok: false,
      error: "DEMASIADO_LARGO",
    });
    expect(textoDeUnaLineaDesdeTexto("12345", exige)).toEqual({ ok: false, error: "SIN_LETRAS" });
  });
});

describe("textoDeUnaLineaDesdeTexto: lo que rechaza", () => {
  it("vacío o solo blancos", () => {
    for (const texto of ["", "   ", "  "]) invalido(texto, "VACIO");
  });

  it("saltos de línea, tabuladores y otros caracteres de control", () => {
    for (const texto of ["a\nb", "a\rb", "a\tb", "a\u0000b", "a\u007fb", "a\u0085b", "a\u009fb"]) {
      invalido(texto, "CARACTER_PROHIBIDO");
    }
  });

  it("separadores de línea y de párrafo de Unicode", () => {
    for (const texto of ["a b", "a b"]) invalido(texto, "CARACTER_PROHIBIDO");
  });

  it("invisibles y marcas de dirección de texto (bidi): ancho cero, guion blando, RLO, LRI, BOM interno", () => {
    for (const texto of ["a​b", "a‍b", "a­b", "a‮b", "a⁦b", "a‏b", "a﻿b", "a⁠b"]) {
      invalido(texto, "CARACTER_PROHIBIDO");
    }
  });

  it("un invisible en el borde no se pierde con el recorte: se rechaza igual", () => {
    invalido("​Juan", "CARACTER_PROHIBIDO");
    invalido("Juan‮", "CARACTER_PROHIBIDO");
  });

  it("etiquetas: `<` y `>`", () => {
    for (const texto of ["<b>Juan</b>", "a<b", "a>b", "<script>x</script>"]) {
      invalido(texto, "CARACTER_PROHIBIDO");
    }
  });

  it("emojis, solos o con selector de emoji o unidos", () => {
    for (const texto of ["Juan 😀", "☎️", "👨‍👩", "🏨 Hotel"]) {
      invalido(texto, "CARACTER_PROHIBIDO");
    }
  });

  it("sustitutos sueltos (texto que la base no guarda)", () => {
    invalido("a\ud800b", "CARACTER_PROHIBIDO");
  });

  it("devuelve el motivo de lo prohibido antes que el del largo", () => {
    invalido("a\n".repeat(300), "CARACTER_PROHIBIDO");
  });
});
