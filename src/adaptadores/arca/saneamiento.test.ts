import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DE_TEXTO, sanearTexto, textoSeguro } from "./saneamiento";

const SECRETO = "SECRETO-0123456789";

describe("sanearTexto: los elementos que son credenciales", () => {
  it.each(["token", "sign", "in0"])("oculta el contenido de <%s>", (nombre) => {
    expect(sanearTexto(`<${nombre}>${SECRETO}</${nombre}>`)).toBe(
      `<${nombre}>[OCULTO]</${nombre}>`,
    );
  });

  it("no distingue mayúsculas de minúsculas", () => {
    expect(sanearTexto(`<Token>${SECRETO}</Token>`)).toBe("<Token>[OCULTO]</Token>");
    expect(sanearTexto(`<SIGN>${SECRETO}</SIGN>`)).toBe("<SIGN>[OCULTO]</SIGN>");
    expect(sanearTexto(`<In0>${SECRETO}</In0>`)).toBe("<In0>[OCULTO]</In0>");
  });

  it("también con prefijo de espacio de nombres (letras, dígitos, punto, guion y guion bajo)", () => {
    expect(sanearTexto(`<ar:Token>${SECRETO}</ar:Token>`)).toBe("<ar:Token>[OCULTO]</ar:Token>");
    expect(sanearTexto(`<wsaa:in0>${SECRETO}</wsaa:in0>`)).toBe("<wsaa:in0>[OCULTO]</wsaa:in0>");
    expect(sanearTexto(`<s0.A-b_C:Sign>${SECRETO}</s0.A-b_C:Sign>`)).toBe(
      "<s0.A-b_C:Sign>[OCULTO]</s0.A-b_C:Sign>",
    );
  });

  it("con atributos en la etiqueta de apertura y espacios en la de cierre", () => {
    expect(sanearTexto(`<ar:Token x="1" y='2'>${SECRETO}</ar:Token  >`)).toBe(
      `<ar:Token x="1" y='2'>[OCULTO]</ar:Token  >`,
    );
  });

  it("oculta el contenido de varias líneas", () => {
    expect(sanearTexto(`<token>\n${SECRETO}\n${SECRETO}\n</token>`)).toBe(
      "<token>[OCULTO]</token>",
    );
  });

  it("oculta todas las apariciones, de uno y de otro elemento", () => {
    const texto = `<a><Token>${SECRETO}</Token><Sign>${SECRETO}</Sign></a><Token>${SECRETO}</Token>`;
    expect(sanearTexto(texto)).toBe(
      "<a><Token>[OCULTO]</Token><Sign>[OCULTO]</Sign></a><Token>[OCULTO]</Token>",
    );
  });

  it("si la respuesta se cortó antes del cierre, oculta hasta el final", () => {
    expect(sanearTexto(`ok <Token>${SECRETO}`)).toBe("ok <Token>[OCULTO]");
    expect(sanearTexto(`ok &lt;token&gt;${SECRETO}`)).toBe("ok &lt;token&gt;[OCULTO]");
  });

  it("no toca un elemento cuyo nombre solo empieza igual", () => {
    expect(sanearTexto("<tokens>abc</tokens><signal>x</signal><in01>y</in01>")).toBe(
      "<tokens>abc</tokens><signal>x</signal><in01>y</in01>",
    );
  });
});

describe("sanearTexto: el ticket escapado dentro de loginCmsReturn", () => {
  it("oculta el contenido de &lt;token&gt; y &lt;sign&gt;", () => {
    expect(
      sanearTexto(
        `&lt;credentials&gt;&lt;token&gt;${SECRETO}&lt;/token&gt;&lt;sign&gt;${SECRETO}&lt;/sign&gt;&lt;/credentials&gt;`,
      ),
    ).toBe(
      "&lt;credentials&gt;&lt;token&gt;[OCULTO]&lt;/token&gt;&lt;sign&gt;[OCULTO]&lt;/sign&gt;&lt;/credentials&gt;",
    );
  });

  it("con prefijo, atributos escapados y mayúsculas", () => {
    expect(
      sanearTexto(`&lt;ns.a-b_1:Token id=&quot;1&quot;&gt;${SECRETO}&lt;/ns.a-b_1:Token  &gt;`),
    ).toBe("&lt;ns.a-b_1:Token id=&quot;1&quot;&gt;[OCULTO]&lt;/ns.a-b_1:Token  &gt;");
  });

  it("no toca los elementos que no son credenciales", () => {
    const texto = "&lt;header&gt;&lt;uniqueId&gt;123&lt;/uniqueId&gt;&lt;/header&gt;";
    expect(sanearTexto(texto)).toBe(texto);
  });
});

describe("sanearTexto: PEM y tiras de base64", () => {
  it("oculta un bloque PEM de clave privada, de certificado y de pedido", () => {
    for (const tipo of ["PRIVATE KEY", "RSA PRIVATE KEY", "CERTIFICATE", "CERTIFICATE REQUEST"]) {
      const pem = `-----BEGIN ${tipo}-----\nMIIEvQIBADAN\n${SECRETO}\n-----END ${tipo}-----`;
      expect(sanearTexto(`antes ${pem} después`)).toBe("antes [PEM OCULTO] después");
    }
  });

  it("oculta todos los bloques PEM", () => {
    const pem = (n: string) => `-----BEGIN PRIVATE KEY-----\n${n}\n-----END PRIVATE KEY-----`;
    expect(sanearTexto(`${pem("a")} y ${pem("b")}`)).toBe("[PEM OCULTO] y [PEM OCULTO]");
  });

  it("un PEM cortado (sin el cierre) se oculta hasta el final", () => {
    expect(sanearTexto(`x -----BEGIN PRIVATE KEY-----\nMIIEvQ${SECRETO}`)).toBe("x [PEM OCULTO]");
  });

  it("oculta una tira larga de base64 (80 o más caracteres) con su relleno", () => {
    expect(sanearTexto(`x ${"A".repeat(80)} y`)).toBe("x [OCULTO] y");
    expect(sanearTexto(`x ${"Ab+/9".repeat(30)}== y`)).toBe("x [OCULTO] y");
  });

  it("deja pasar una tira de 79 caracteres y las palabras comunes", () => {
    const tira = "A".repeat(79);
    expect(sanearTexto(tira)).toBe(tira);
    expect(sanearTexto("El numero o fecha del comprobante no se corresponde")).toBe(
      "El numero o fecha del comprobante no se corresponde",
    );
  });

  it("un texto sin nada que ocultar no cambia", () => {
    const texto = "No existen datos en nuestros registros para los parametros ingresados.";
    expect(sanearTexto(texto)).toBe(texto);
  });
});

describe("textoSeguro", () => {
  it("sanea y acota a 500 caracteres", () => {
    expect(LARGO_MAXIMO_DE_TEXTO).toBe(500);
    const palabras = (n: number) => "ab ".repeat(n);
    expect(textoSeguro(palabras(300))).toBe(palabras(300).slice(0, 500));
    expect(textoSeguro(palabras(300))).toHaveLength(500);
    expect(textoSeguro(palabras(166).slice(0, 500))).toHaveLength(498);
    expect(textoSeguro("x".repeat(70).padEnd(499, " "))).toHaveLength(499);
    expect(textoSeguro("x".repeat(70).padEnd(500, " "))).toHaveLength(500);
    expect(textoSeguro("x".repeat(70).padEnd(501, " "))).toHaveLength(500);
  });

  it("sanea ANTES de acotar: un secreto que empieza antes del corte no se filtra", () => {
    const relleno = "ab ".repeat(163).slice(0, 490);
    const seguro = textoSeguro(`${relleno}<Token>${SECRETO}</Token>`);
    expect(seguro).not.toContain("SECRETO");
    expect(seguro).toBe(`${relleno}<Token>[OCULTO]</Token>`.slice(0, 500));
  });
});
