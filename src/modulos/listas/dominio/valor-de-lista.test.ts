import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DEL_NOMBRE_DE_VALOR,
  LISTAS_DEL_SISTEMA,
  decidirActivo,
  decidirNuevoNombre,
  listaDesdeTexto,
  nombreDeValorDesdeTexto,
  type ValorDeLista,
} from "./valor-de-lista";

const valor = (cambios: Partial<ValorDeLista> = {}): ValorDeLista => ({
  id: "11111111-1111-4111-8111-111111111111",
  lista: "MARCAS_DE_TARJETA",
  nombre: "Visa",
  activo: true,
  fija: false,
  version: 3,
  ...cambios,
});

describe("las listas del sistema", () => {
  it("son exactamente las dos de la decisión 130", () => {
    expect(LISTAS_DEL_SISTEMA).toEqual(["MARCAS_DE_TARJETA", "MOTIVOS_DE_RECHAZO"]);
  });

  it("listaDesdeTexto acepta las declaradas y rechaza todo lo demás", () => {
    expect(listaDesdeTexto("MARCAS_DE_TARJETA")).toEqual({ ok: true, valor: "MARCAS_DE_TARJETA" });
    expect(listaDesdeTexto("MOTIVOS_DE_RECHAZO")).toEqual({
      ok: true,
      valor: "MOTIVOS_DE_RECHAZO",
    });
    for (const malo of [
      "",
      "marcas_de_tarjeta",
      "OTRA",
      " MARCAS_DE_TARJETA",
      null,
      undefined,
      7,
    ]) {
      expect(listaDesdeTexto(malo), String(malo)).toEqual({ ok: false, error: "LISTA_INVALIDA" });
    }
  });
});

describe("nombreDeValorDesdeTexto", () => {
  it("deja el nombre recortado, compuesto (NFC) y con los espacios repetidos en uno", () => {
    expect(nombreDeValorDesdeTexto("  Naranja   X ")).toEqual({ ok: true, valor: "Naranja X" });
    // «é» en dos piezas (e + acento combinante) es el mismo texto que «é» de una.
    expect(nombreDeValorDesdeTexto("Envase dañado é")).toEqual({
      ok: true,
      valor: "Envase dañado é",
    });
  });

  it("acepta de 1 a 40 caracteres y rechaza 41", () => {
    expect(nombreDeValorDesdeTexto("A")).toEqual({ ok: true, valor: "A" });
    const justo = "a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_VALOR);
    expect(nombreDeValorDesdeTexto(justo)).toEqual({ ok: true, valor: justo });
    expect(nombreDeValorDesdeTexto(`${justo}a`)).toEqual({ ok: false, error: "NOMBRE_INVALIDO" });
    expect(LARGO_MAXIMO_DEL_NOMBRE_DE_VALOR).toBe(40);
  });

  it("rechaza vacío, solo blancos, lo que no es texto y todo lo que está fuera de la lista de permitidos", () => {
    for (const malo of [
      "",
      "   ",
      "\t",
      "a\nb",
      "a\tb",
      "<b>",
      "a​b",
      "😀",
      "a\u0000b",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(nombreDeValorDesdeTexto(malo), JSON.stringify(malo)).toEqual({
        ok: false,
        error: "NOMBRE_INVALIDO",
      });
    }
  });
});

describe("decidirNuevoNombre", () => {
  it("con la versión que vio quien corrige y otro nombre, cambia", () => {
    expect(decidirNuevoNombre(valor(), "VISA", 3)).toEqual({ ok: true, valor: { cambia: true } });
  });

  it("el mismo nombre, tal cual, no cambia nada", () => {
    expect(decidirNuevoNombre(valor(), "Visa", 3)).toEqual({ ok: true, valor: { cambia: false } });
  });

  it("solo mayúsculas o acentos distintos SÍ es un cambio", () => {
    expect(decidirNuevoNombre(valor({ nombre: "Envase danado" }), "Envase dañado", 3)).toEqual({
      ok: true,
      valor: { cambia: true },
    });
    expect(decidirNuevoNombre(valor(), "visa", 3)).toEqual({ ok: true, valor: { cambia: true } });
  });

  it("con otra versión (más vieja o más nueva) es VERSION_DESACTUALIZADA", () => {
    for (const vista of [2, 4]) {
      expect(decidirNuevoNombre(valor(), "VISA", vista)).toEqual({
        ok: false,
        error: "VERSION_DESACTUALIZADA",
      });
    }
  });

  it("un valor fijo no se renombra, ni siquiera con la versión correcta ni con otra", () => {
    const otra = valor({ nombre: "Otra", fija: true });
    expect(decidirNuevoNombre(otra, "Cualquiera", 3)).toEqual({ ok: false, error: "VALOR_FIJO" });
    expect(decidirNuevoNombre(otra, "Cualquiera", 1)).toEqual({ ok: false, error: "VALOR_FIJO" });
    expect(decidirNuevoNombre(otra, "Otra", 3)).toEqual({ ok: false, error: "VALOR_FIJO" });
  });
});

describe("decidirActivo", () => {
  it("desactiva un valor activo y reactiva uno inactivo con la versión que se vio", () => {
    expect(decidirActivo(valor(), false, 3)).toEqual({ ok: true, valor: { cambia: true } });
    expect(decidirActivo(valor({ activo: false }), true, 3)).toEqual({
      ok: true,
      valor: { cambia: true },
    });
  });

  it("con otra versión y algo que cambiar es VERSION_DESACTUALIZADA", () => {
    expect(decidirActivo(valor(), false, 2)).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    expect(decidirActivo(valor({ activo: false }), true, 4)).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
  });

  it("lo que ya está en el estado pedido es éxito sin cambios, sin mirar la versión", () => {
    expect(decidirActivo(valor({ activo: false }), false, 1)).toEqual({
      ok: true,
      valor: { cambia: false },
    });
    expect(decidirActivo(valor(), true, 1)).toEqual({ ok: true, valor: { cambia: false } });
  });

  it("un valor fijo no se desactiva (con cualquier versión) y reactivarlo no cambia nada", () => {
    const otra = valor({ nombre: "Otra", fija: true });
    expect(decidirActivo(otra, false, 3)).toEqual({ ok: false, error: "VALOR_FIJO" });
    expect(decidirActivo(otra, false, 1)).toEqual({ ok: false, error: "VALOR_FIJO" });
    expect(decidirActivo(otra, true, 1)).toEqual({ ok: true, valor: { cambia: false } });
  });
});
