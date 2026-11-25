import { describe, expect, it } from "vitest";
import { errorDePolitica } from "../../apps/plataforma/logica/errores-de-politica";
import {
  diasConUnidad,
  entradaDeDefinirPolitica,
  fechaDeLaVersion,
  formularioInicial,
  pieDeLaVersion,
  resumenDelCambio,
  validarFormularioDePolitica,
  type FormularioDePolitica,
  type VersionDePolitica,
} from "../../apps/plataforma/logica/politica-de-plan";

const BIEN: FormularioDePolitica = {
  suba: "3",
  baja: "10",
  arrepentimiento: "15",
  motivo: "Acuerdo",
};
const CLAVE = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d";
const FALTA_DIAS = "Ingresá un número entero de días entre 0 y 365.";

describe("validarFormularioDePolitica", () => {
  it("con datos buenos devuelve los días como números y el motivo recortado", () => {
    expect(validarFormularioDePolitica({ ...BIEN, motivo: "  Acuerdo  " })).toEqual({
      ok: true,
      dias: { suba: 3, baja: 10, arrepentimiento: 15 },
      motivo: "Acuerdo",
    });
  });

  it("acepta los bordes: 0 y 365", () => {
    const r = validarFormularioDePolitica({
      ...BIEN,
      suba: "0",
      baja: "365",
      arrepentimiento: "0",
    });
    expect(r.ok).toBe(true);
  });

  it.each(["", "  ", "-1", "1.5", "1,5", "366", "1000", "abc", "1e2", "+3", "0x10", "٣"])(
    "rechaza %j como número de días",
    (malo) => {
      const r = validarFormularioDePolitica({ ...BIEN, baja: malo });
      expect(r).toEqual({ ok: false, faltas: { baja: FALTA_DIAS } });
    },
  );

  it.each(["suba", "arrepentimiento"] as const)(
    "rechaza un número inválido en %s y solo en él",
    (campo) => {
      expect(validarFormularioDePolitica({ ...BIEN, [campo]: "x" })).toStrictEqual({
        ok: false,
        faltas: { [campo]: FALTA_DIAS },
      });
    },
  );

  it("recorta los espacios del número: ' 3 ' es 3", () => {
    expect(validarFormularioDePolitica({ ...BIEN, suba: " 3 " })).toMatchObject({
      ok: true,
      dias: { suba: 3 },
    });
  });

  it("rechaza el motivo vacío y el de 501, y acepta el de 500 con espacios alrededor", () => {
    expect(validarFormularioDePolitica({ ...BIEN, motivo: "   " })).toEqual({
      ok: false,
      faltas: { motivo: "Falta el motivo." },
    });
    expect(validarFormularioDePolitica({ ...BIEN, motivo: "a".repeat(501) })).toEqual({
      ok: false,
      faltas: { motivo: "El motivo es demasiado largo." },
    });
    expect(validarFormularioDePolitica({ ...BIEN, motivo: ` ${"a".repeat(500)} ` }).ok).toBe(true);
  });

  it("junta todas las faltas a la vez", () => {
    expect(
      validarFormularioDePolitica({ suba: "x", baja: "", arrepentimiento: "-2", motivo: "" }),
    ).toEqual({
      ok: false,
      faltas: {
        suba: FALTA_DIAS,
        baja: FALTA_DIAS,
        arrepentimiento: FALTA_DIAS,
        motivo: "Falta el motivo.",
      },
    });
  });
});

describe("textos que arma la lógica", () => {
  const version: VersionDePolitica = {
    version: 2,
    suba: 3,
    baja: 10,
    arrepentimiento: 15,
    motivo: "Acuerdo con el dueño",
    definidaPor: "ana@pedernal.test",
    // 02:30 UTC del 21/11 es el 20/11 a las 23:30 en Argentina: el día argentino, no el UTC.
    creadoEn: "2026-11-21T02:30:00.000Z",
  };

  it("día / días en singular y plural", () => {
    expect(diasConUnidad(0)).toBe("0 días");
    expect(diasConUnidad(1)).toBe("1 día");
    expect(diasConUnidad(2)).toBe("2 días");
  });

  it("precarga los vigentes y deja el motivo vacío", () => {
    expect(formularioInicial(version)).toEqual({
      suba: "3",
      baja: "10",
      arrepentimiento: "15",
      motivo: "",
    });
  });

  it("el resumen dice antes y después con los tres números", () => {
    expect(
      resumenDelCambio(
        { suba: 1, baja: 1, arrepentimiento: 0 },
        { suba: 3, baja: 10, arrepentimiento: 15 },
      ),
    ).toBe(
      "Antes: Anticipación de una suba: 1 día · Anticipación de una baja: 1 día · Plazo de arrepentimiento: 0 días. Después: Anticipación de una suba: 3 días · Anticipación de una baja: 10 días · Plazo de arrepentimiento: 15 días.",
    );
  });

  it("el pie y la fecha usan el día de Argentina", () => {
    expect(fechaDeLaVersion(version)).toBe("20/11/2026");
    expect(pieDeLaVersion(version)).toBe(
      "Definida por ana@pedernal.test el 20/11/2026. Motivo: Acuerdo con el dueño",
    );
  });
});

describe("entradaDeDefinirPolitica (forma de lo que manda el navegador)", () => {
  const BUENA = {
    claveDeIdempotencia: CLAVE,
    versionEsperada: 1,
    diasDeAnticipacionDeSuba: 3,
    diasDeAnticipacionDeBaja: 10,
    diasDeArrepentimiento: 15,
    motivo: "Acuerdo",
  };

  it("el motivo de 2000 (el tope de la forma: 4 veces el del dominio) pasa; el servidor decide el de 500", () => {
    expect(entradaDeDefinirPolitica({ ...BUENA, motivo: "a".repeat(2000) }).ok).toBe(true);
  });

  it("deja pasar una entrada buena y descarta las claves que sobran", () => {
    expect(entradaDeDefinirPolitica({ ...BUENA, rol: "ADMIN" })).toEqual({
      ok: true,
      valor: BUENA,
    });
  });

  it.each([
    ["es nulo", null],
    ["no está", undefined],
    ["es un número", 5],
    ["clave con algo antes", { ...BUENA, claveDeIdempotencia: `x${CLAVE}` }],
    ["clave con algo después", { ...BUENA, claveDeIdempotencia: `${CLAVE}x` }],
    ["clave que no es texto", { ...BUENA, claveDeIdempotencia: 5 }],
    ["motivo de 2001", { ...BUENA, motivo: "a".repeat(2001) }],
    ["no es un objeto", "x"],
    ["es una lista", [BUENA]],
    ["clave que no es UUID", { ...BUENA, claveDeIdempotencia: "abc" }],
    ["versión 0", { ...BUENA, versionEsperada: 0 }],
    ["versión decimal", { ...BUENA, versionEsperada: 1.5 }],
    ["versión como texto", { ...BUENA, versionEsperada: "1" }],
    ["días decimales", { ...BUENA, diasDeAnticipacionDeSuba: 1.5 }],
    ["días como texto", { ...BUENA, diasDeAnticipacionDeBaja: "10" }],
    ["días ausentes", { ...BUENA, diasDeArrepentimiento: undefined }],
    ["motivo que no es texto", { ...BUENA, motivo: 5 }],
    ["motivo absurdo", { ...BUENA, motivo: "a".repeat(5000) }],
  ])("rechaza: %s", (_nombre, entrada) => {
    expect(entradaDeDefinirPolitica(entrada)).toEqual({ ok: false });
  });
});

describe("errorDePolitica", () => {
  it("VERSION_DESACTUALIZADA es el aviso de que otra persona la cambió (T-18)", () => {
    expect(errorDePolitica({ codigo: "VERSION_DESACTUALIZADA" })).toEqual({
      tipo: "PANTALLA_VIEJA",
      texto: "Otra persona cambió la política mientras tanto. Volvé a cargarla.",
    });
  });

  it("los motivos y los días se dicen con su texto aprobado", () => {
    expect(errorDePolitica({ codigo: "MOTIVO_OBLIGATORIO" })).toEqual({
      tipo: "CAMPO",
      campo: "motivo",
      texto: "Falta el motivo.",
    });
    expect(errorDePolitica("MOTIVO_DEMASIADO_LARGO")).toEqual({
      tipo: "CAMPO",
      campo: "motivo",
      texto: "El motivo es demasiado largo.",
    });
    expect(errorDePolitica("DIAS_DE_POLITICA_INVALIDOS")).toEqual({
      tipo: "GENERAL",
      texto: FALTA_DIAS,
    });
  });

  it("una versión esperada inválida es una pantalla vieja, con el texto que la consola ya tenía (T-38)", () => {
    expect(errorDePolitica("VERSION_ESPERADA_INVALIDA")).toEqual({
      tipo: "PANTALLA_VIEJA",
      texto: "La pantalla quedó vieja. Volvé a abrirla y probá de nuevo.",
    });
  });

  it("lee el código de un texto y de un objeto con `codigo`, y no de lo demás", () => {
    expect(errorDePolitica({ codigo: "MOTIVO_OBLIGATORIO" })).toMatchObject({ campo: "motivo" });
    expect(errorDePolitica(null)).toEqual({ tipo: "INESPERADO" });
    expect(errorDePolitica({ otro: "MOTIVO_OBLIGATORIO" })).toEqual({ tipo: "INESPERADO" });
    expect(errorDePolitica(7)).toEqual({ tipo: "INESPERADO" });
  });

  it("sin permiso, segundo factor y lo desconocido salen por el traductor de la consola", () => {
    expect(errorDePolitica("SIN_PERMISO")).toEqual({ tipo: "OCULTAR_ACCION" });
    expect(errorDePolitica("segundo_factor_reciente_requerido")).toEqual({
      tipo: "SEGUNDO_FACTOR",
    });
    expect(errorDePolitica("ALGO_QUE_NADIE_PENSO")).toEqual({ tipo: "INESPERADO" });
    expect(errorDePolitica(new Error("boom"))).toEqual({ tipo: "INESPERADO" });
  });
});
