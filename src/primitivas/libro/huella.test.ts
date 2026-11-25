import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decidirPorHuella, huellaDeCampos, huellaDeComando, type CampoDeHuella } from "./huella";

/**
 * Vectores dorados: los sha256 se calcularon UNA vez con `huellaDeCampos` de caja y `huellaDeComando` de stock (20/11/2026) y se
 * pegaron acá como literales. No se importan esos módulos (la regla de módulos lo prohíbe): si esta copia cambiara una sola letra del
 * formato, los reintentos de lo ya guardado darían una falsa CLAVE_REUTILIZADA.
 */
const DORADOS_DE_CAMPOS: ReadonlyArray<readonly [string, readonly CampoDeHuella[], string]> = [
  ["lista vacía", [], "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"],
  ["un null", [null], "1d8fc6ceb1f94c6326d6d5483d258fcb2e179e9869325b245d105c2219bf69fd"],
  [
    "acentos y comillas",
    ['Habitación «doble» "vista"', "ñandú"],
    "ae4c512895e9749899a9b5ab0972c724315f45833e6ca1d592eafa61c5db8e4a",
  ],
  ["enteros", [42, 0, -7], "0f1f9a1da344dcc1bfadc8d15d5c9ec3397dfd465ee35b0224f8dd23d4982297"],
  [
    "importe como texto decimal",
    ["ARS", "1500.00", null, "x"],
    "a4cfad65c39e8fb83c750ca29b250dca790da00fe8f79f047117b67b0480610c",
  ],
];

describe("huellaDeCampos (igual a la de caja, bit a bit)", () => {
  it.each(DORADOS_DE_CAMPOS)("%s", (_nombre, campos, esperada) => {
    expect(huellaDeCampos(campos)).toBe(esperada);
  });
});

describe("huellaDeComando (igual a la de stock, bit a bit)", () => {
  const A = [
    ["art1", "10.0000"],
    ["art2", "2.5000"],
  ];
  const B = [
    ["art2", "2.5000"],
    ["art1", "10.0000"],
  ];
  const ORDENADA = "3941878030d6cce0bbdf45714d0034171b0ad7b8b54a896a38b56b16a1918410";

  it("sin renglones", () => {
    expect(huellaDeComando("OP", [], [])).toBe(
      "6e656e9bb4cc460d73335ea1ef349e50acebc4db7834079a03934c4467851595",
    );
  });

  it("renglones en distinto orden dan la misma huella dorada", () => {
    expect(huellaDeComando("INGRESO", ["dep1", null], A)).toBe(ORDENADA);
    expect(huellaDeComando("INGRESO", ["dep1", null], B)).toBe(ORDENADA);
  });

  it("acentos, comillas, número y null", () => {
    expect(huellaDeComando("Ajuste «ñ»", ['Cabecera "x"'], [["Pé", 1, null]])).toBe(
      "4c66e238afe3e3789842a40c9c96c902d2e7e7f5e90ccf26ba8566ee3f9ea4c3",
    );
  });

  it("la operación y la cabecera cambian la huella", () => {
    expect(huellaDeComando("EGRESO", ["dep1", null], A)).not.toBe(ORDENADA);
    expect(huellaDeComando("INGRESO", ["dep2", null], A)).not.toBe(ORDENADA);
  });
});

describe("propiedades de la huella", () => {
  const campo = fc.oneof(fc.string(), fc.integer(), fc.constant(null));
  const renglon = fc.array(campo, { maxLength: 4 });

  it("misma entrada, misma huella (idempotencia)", () => {
    fc.assert(
      fc.property(
        fc.array(campo),
        (campos) => huellaDeCampos(campos) === huellaDeCampos([...campos]),
      ),
    );
  });

  it("el orden de los renglones no cambia la huella", () => {
    fc.assert(
      fc.property(fc.string(), fc.array(campo), fc.array(renglon), (op, cab, renglones) => {
        const invertidos = [...renglones].reverse();
        return huellaDeComando(op, cab, renglones) === huellaDeComando(op, cab, invertidos);
      }),
    );
  });

  it("un campo distinto cambia la huella", () => {
    fc.assert(
      fc.property(fc.array(campo, { minLength: 1 }), fc.nat(), fc.string(), (campos, i, texto) => {
        const k = i % campos.length;
        fc.pre(campos[k] !== texto);
        const otros = campos.map((c, j) => (j === k ? texto : c));
        return huellaDeCampos(campos) !== huellaDeCampos(otros);
      }),
    );
  });

  it("un renglón distinto cambia la huella del comando", () => {
    expect(huellaDeComando("OP", [], [["a"]])).not.toBe(huellaDeComando("OP", [], [["b"]]));
    expect(huellaDeComando("OP", [], [["a"]])).not.toBe(huellaDeComando("OP", [], []));
  });
});

describe("decidirPorHuella", () => {
  it("sin huella guardada es NUEVA", () => {
    expect(decidirPorHuella(null, "abc")).toBe("NUEVA");
  });

  it("la misma huella es REPETIDA", () => {
    expect(decidirPorHuella("abc", "abc")).toBe("REPETIDA");
  });

  it("otra huella es CLAVE_REUTILIZADA", () => {
    expect(decidirPorHuella("abc", "abd")).toBe("CLAVE_REUTILIZADA");
  });

  it("una huella guardada vacía no es 'sin guardar'", () => {
    expect(decidirPorHuella("", "abc")).toBe("CLAVE_REUTILIZADA");
  });
});
