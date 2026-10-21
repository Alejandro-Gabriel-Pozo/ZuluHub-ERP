import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { contrato, correr, porPatron, type Contrato } from "./guardian-apoyo";

/**
 * Registro de contratos: el esquema se valida al cargar. Un contrato con algún campo faltante o
 * vacío hace fallar la carga entera y el mensaje dice cuál contrato y cuál campo.
 */

type Registro = { contratos: Contrato[]; porId: Map<string, Contrato> };
const require = createRequire(import.meta.url);
const { cargarRegistro, ErrorDeRegistro } =
  require("../../arquitectura/contratos/registro.cjs") as {
    cargarRegistro: (lista: unknown) => Registro;
    ErrorDeRegistro: new (problemas: string[]) => Error & { problemas: string[] };
  };
const real = require("../../arquitectura/contratos/contratos.cjs") as unknown[];

function problemasDe(lista: unknown): string[] {
  try {
    cargarRegistro(lista);
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorDeRegistro);
    return (error as { problemas: string[] }).problemas;
  }
  throw new Error("el registro se cargó y tenía que fallar");
}

describe("registro de contratos", () => {
  it("el registro real de producción arranca vacío y es válido", () => {
    expect(real).toEqual([]);
    expect(cargarRegistro(real).contratos).toEqual([]);
  });

  it("un contrato completo carga y se indexa por id", () => {
    const registro = cargarRegistro([contrato(), contrato({ id: "otro-contrato" })]);
    expect(registro.contratos).toHaveLength(2);
    expect([...registro.porId.keys()]).toEqual(["color-separador", "otro-contrato"]);
  });

  it.each([
    "id",
    "protege",
    "alcance",
    "fuenteDeVerdad",
    "incumplimiento",
    "deteccion",
    "limites",
    "version",
    "politicaDeCambio",
    "bloqueaDeclaracionFalsa",
  ])("falta el campo «%s»: el registro falla y nombra el contrato", (campo) => {
    const roto = contrato();
    delete roto[campo];
    const problemas = problemasDe([roto]);
    expect(problemas.length).toBeGreaterThan(0);
    if (campo === "id") expect(problemas[0]).toContain("sin id válido");
    else {
      expect(problemas[0]).toContain("«color-separador»");
      expect(problemas.join("\n")).toContain(campo);
    }
  });

  it.each(["id", "protege", "alcance", "incumplimiento", "limites", "version", "politicaDeCambio"])(
    "el campo «%s» vacío o con solo espacios falla",
    (campo) => {
      for (const vacio of ["", "   "]) {
        const problemas = problemasDe([contrato({ [campo]: vacio })]);
        expect(problemas.length).toBeGreaterThan(0);
        expect(problemas.join("\n")).toContain(campo);
      }
    },
  );

  it.each([
    ["una lista vacía de detectores", { deteccion: [] }],
    ["detectores que no son una lista", { deteccion: "uso" }],
    [
      "solo detectores de definición (no se puede comprobar el uso)",
      {
        deteccion: [porPatron({ tipo: "definicion", clases: ["frontend"], patron: /x/ })],
      },
    ],
    [
      "un detector con tipo desconocido",
      {
        deteccion: [{ tipo: "otro", clases: ["frontend"], reconoce: () => [] }],
      },
    ],
    ["un detector sin clases", { deteccion: [{ tipo: "uso", clases: [], reconoce: () => [] }] }],
    [
      "un detector con una clase inexistente",
      {
        deteccion: [{ tipo: "uso", clases: ["inventada"], reconoce: () => [] }],
      },
    ],
    [
      "un detector con una clase repetida",
      {
        deteccion: [{ tipo: "uso", clases: ["frontend", "frontend"], reconoce: () => [] }],
      },
    ],
    ["un detector sin función reconoce", { deteccion: [{ tipo: "uso", clases: ["frontend"] }] }],
    [
      "un detector con un campo de más",
      {
        deteccion: [{ tipo: "uso", clases: ["frontend"], reconoce: () => [], regex: "x" }],
      },
    ],
    ["una fuente sin archivo", { fuenteDeVerdad: { variable: "--x" } }],
    ["una fuente con archivo vacío", { fuenteDeVerdad: { archivo: " ", variable: "--x" } }],
    [
      "una fuente con comodines",
      { fuenteDeVerdad: { archivo: "apps/**/tokens.css", variable: "--x" } },
    ],
    ["una fuente sin exportación ni variable", { fuenteDeVerdad: { archivo: "a.ts" } }],
    [
      "una fuente con exportación y variable a la vez",
      {
        fuenteDeVerdad: { archivo: "a.ts", exportacion: "A", variable: "--a" },
      },
    ],
    ["una fuente con la variable vacía", { fuenteDeVerdad: { archivo: "a.ts", variable: "" } }],
    ["una fuente que no es un objeto", { fuenteDeVerdad: "tokens.css" }],
    ["una versión sin forma MAYOR.MENOR.PARCHE", { version: "1" }],
    ["bloqueaDeclaracionFalsa que no es booleano", { bloqueaDeclaracionFalsa: "si" }],
    ["un id con mayúsculas", { id: "ColorSeparador" }],
    ["un campo que no es del esquema", { regla: "x" }],
  ])("falla con %s", (_nombre, cambios) => {
    const problemas = problemasDe([contrato(cambios)]);
    expect(problemas.length).toBeGreaterThan(0);
    expect(problemas.every((p) => p.startsWith("Contrato"))).toBe(true);
  });

  it("dos contratos con el mismo id fallan", () => {
    const problemas = problemasDe([contrato(), contrato()]);
    expect(problemas.join("\n")).toContain("el id está repetido");
  });

  it("un contrato roto invalida todo el registro aunque los demás estén bien", () => {
    const problemas = problemasDe([contrato(), contrato({ id: "roto", protege: "" })]);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("«roto»");
  });

  it.each([null, "texto", 7, {}, [null], [[]], ["contrato"]])(
    "algo que no es una lista de objetos (%j) falla",
    (basura) => {
      expect(problemasDe(basura).length).toBeGreaterThan(0);
    },
  );

  it("informa todos los problemas de un contrato juntos, no de a uno", () => {
    const problemas = problemasDe([contrato({ protege: "", limites: "", version: "x" })]);
    expect(problemas).toHaveLength(3);
  });

  it("en el guardián, un registro roto aparece como falla con el id del contrato", () => {
    const resultado = correr({ contratos: [contrato({ limites: "" })] });
    const falla = resultado.fallas.find((f) => f.codigo === "registro-invalido");
    expect(falla?.motivo).toContain("«color-separador»");
    expect(falla?.motivo).toContain("limites");
    expect(falla?.archivo).toBe("arquitectura/contratos/contratos.cjs");
    expect(resultado.informe.resultado).toBe("falla");
  });

  it("el detector de texto reconoce con número de línea y no guarda estado entre archivos", () => {
    const detector = porPatron({ tipo: "uso", clases: ["frontend"], patron: /var\(--x\)/g });
    const texto = "a\nb: var(--x)\r\nc: var(--x)\nd";
    const esperado = [
      { linea: 2, texto: "b: var(--x)" },
      { linea: 3, texto: "c: var(--x)" },
    ];
    expect(detector.reconoce(texto, "a.css")).toEqual(esperado);
    expect(detector.reconoce(texto, "a.css")).toEqual(esperado);
    expect(detector.reconoce("sin nada", "a.css")).toEqual([]);
  });
});
