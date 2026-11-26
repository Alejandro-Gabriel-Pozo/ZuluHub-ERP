import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { IdDeDecision } from "../../src/capacidades/vocabulario/uso-y-fuente-de-texto";
import {
  arbolConRegistro,
  CUOTA,
  control,
  entrada,
  FAMILIAS,
  forma,
  MARCA,
  type Entrada,
} from "./decisiones-apoyo";

/**
 * Las decisiones POR FAMILIA (dueño, 25/11/2026): `DEC-<FAM>-<NNN>` (p. ej. `DEC-SAL-001`), un archivo por decisión y el contador POR FAMILIA, para que dos sesiones de familias distintas
 * nunca elijan el mismo número. Las `DEC-NNNN` anteriores al corte (`arquitectura/decisiones/familias.json`) siguen válidas; desde el corte toda decisión nueva lleva su familia.
 * Previene: los choques de numeración entre sesiones en paralelo, medidos el 25/11/2026 (0962/0963 y 1066/1074–1077). Cada caso de abajo es una violación inyectada.
 */
const RAIZ = join(import.meta.dirname, "../..");
const problemas = (entradas: Entrada[], familias: unknown = FAMILIAS) =>
  forma.problemasDelRegistro(entradas, familias).map((p) => p.problema);
const POR_FAMILIA = (id: string, cambios: Partial<Entrada> = {}) =>
  entrada({ id, fecha: "2026-11-26", ...cambios });

describe("el id de una decisión", () => {
  it("el heredado antes del corte y el de familia desde el corte son válidos", () => {
    expect(problemas([entrada({ id: "DEC-0001", fecha: "2026-11-25" })])).toEqual([]);
    expect(problemas([POR_FAMILIA("DEC-SAL-001")])).toEqual([]);
    expect(problemas([POR_FAMILIA("DEC-STK-014"), POR_FAMILIA("DEC-COM-999")])).toEqual([]);
    // una decisión por familia ANTES del corte también vale (una sesión puede adelantarse)
    expect(problemas([entrada({ id: "DEC-SAL-001", fecha: "2026-11-20" })])).toEqual([]);
  });

  it("VIOLACIÓN: una familia que no existe falla y dice cuáles hay", () => {
    expect(problemas([POR_FAMILIA("DEC-ZZZ-001")])).toEqual([
      "la familia ZZZ no está en familias.json (las conocidas: COM, SAL, STK).",
    ]);
    expect(problemas([POR_FAMILIA("DEC-AB-001")])[0]).toContain("la familia AB no está");
  });

  it("VIOLACIÓN: una familia con el nombre de una propiedad de objeto (toString, constructor) tampoco existe", () => {
    expect(problemas([POR_FAMILIA("DEC-TOS-001")])[0]).toContain("no está en familias.json");
    const conPrototipo = {
      corte: "2026-11-26",
      familias: Object.create({ HER: "heredada" }) as object,
    };
    expect(problemas([POR_FAMILIA("DEC-HER-001")], conPrototipo)[0]).toContain(
      "no está en familias.json",
    );
  });

  it("VIOLACIÓN: un id repetido falla (el contador de una familia no se repite)", () => {
    const dos = [POR_FAMILIA("DEC-SAL-001"), POR_FAMILIA("DEC-SAL-001")];
    expect(forma.problemasDelRegistro(dos, FAMILIAS)).toEqual([
      { id: "DEC-SAL-001", problema: "el id está repetido." },
    ]);
    expect(problemas([POR_FAMILIA("DEC-SAL-001"), POR_FAMILIA("DEC-STK-001")])).toEqual([]); // mismo número, familias distintas: no choca
  });

  it("VIOLACIÓN: un id con el formato roto falla (minúsculas, otra cantidad de letras o dígitos, sin guiones, texto de más)", () => {
    const FORMA = "id tiene la forma DEC-0001 (heredada) o DEC-SAL-001 (por familia).";
    for (const id of [
      "DEC-sal-001",
      "DEC-SAL-1",
      "DEC-SAL-01",
      "DEC-SAL-0001",
      "DEC-S-001",
      "DEC-SALON-001",
      "DEC-SAL001",
      "DEC--001",
      "DEC-SAL-",
      "DEC-SAL-001x",
      "xDEC-SAL-001",
      "DEC-SAL-001-2",
      "SAL-001",
      "DEC-S4L-001",
      " DEC-SAL-001",
      "DEC-0001-SAL",
    ]) {
      expect(problemas([POR_FAMILIA(id)]), id).toEqual([FORMA]);
    }
    expect(problemas([POR_FAMILIA(7 as unknown as string)])).toEqual([FORMA]);
    // un id que no es texto pero se ve como uno viejo (lista con el texto) no suma el aviso del corte: solo la forma
    expect(problemas([POR_FAMILIA(["DEC-1300"] as unknown as string)])).toEqual([FORMA]);
  });

  it("VIOLACIÓN: el número 000 de una familia falla (empiezan en 001)", () => {
    expect(problemas([POR_FAMILIA("DEC-SAL-000")])).toEqual([
      "el número de una decisión por familia empieza en 001.",
    ]);
  });

  it("VIOLACIÓN: una decisión NUEVA con el formato viejo, desde el día del corte, falla; el día anterior todavía vale", () => {
    const MENSAJE =
      "desde el 2026-11-26 toda decisión nueva lleva el código de su familia (DEC-SAL-001), no DEC-0001.";
    expect(problemas([entrada({ id: "DEC-1300", fecha: "2026-11-26" })])).toEqual([MENSAJE]);
    expect(problemas([entrada({ id: "DEC-1300", fecha: "2027-01-01" })])).toEqual([MENSAJE]);
    expect(problemas([entrada({ id: "DEC-1300", fecha: "2026-11-25" })])).toEqual([]);
  });

  it("una fecha inválida se dice una sola vez (sin sumar lo del corte)", () => {
    expect(problemas([entrada({ id: "DEC-1300", fecha: "mañana" })])).toEqual([
      "fecha es un día real con la forma AAAA-MM-DD.",
    ]);
  });
});

describe("familias.json", () => {
  const BUENA = { corte: "2026-11-26", familias: { SAL: "Salón", CI: "Arquitectura y CI" } };

  it("una lista bien formada no tiene problemas, con las claves en cualquier orden", () => {
    expect(forma.problemasDeLasFamilias(BUENA)).toEqual([]);
    expect(forma.problemasDeLasFamilias({ familias: BUENA.familias, corte: BUENA.corte })).toEqual(
      [],
    );
  });

  it("VIOLACIÓN: forma rota (claves de más o de menos, corte que no es un día, lista vacía)", () => {
    expect(forma.problemasDeLasFamilias(null)).toEqual([
      "familias.json lleva exactamente: corte, familias.",
    ]);
    expect(forma.problemasDeLasFamilias({ corte: "2026-11-26" })).toEqual([
      "familias.json lleva exactamente: corte, familias.",
    ]);
    expect(forma.problemasDeLasFamilias({ ...BUENA, extra: 1 })).toEqual([
      "familias.json lleva exactamente: corte, familias.",
    ]);
    for (const corte of ["2026-02-30", "26/11/2026", "", 5, null]) {
      expect(forma.problemasDeLasFamilias({ ...BUENA, corte }), String(corte)).toEqual([
        "corte es un día real con la forma AAAA-MM-DD.",
      ]);
    }
    for (const familias of [{}, [], "SAL", null]) {
      expect(forma.problemasDeLasFamilias({ corte: BUENA.corte, familias })).toEqual([
        "familias es un objeto con al menos una familia.",
      ]);
    }
  });

  it("VIOLACIÓN: un código de familia que no son 2 a 4 mayúsculas, o un nombre inválido, falla", () => {
    for (const codigo of ["sal", "S", "SALON", "S1", "SA-L", "Sal"]) {
      expect(
        forma.problemasDeLasFamilias({ ...BUENA, familias: { [codigo]: "Salón" } }),
        codigo,
      ).toEqual([`la familia «${codigo}» son de 2 a 4 letras mayúsculas.`]);
    }
    expect(forma.problemasDeLasFamilias({ ...BUENA, familias: { SAL: 5 } })[0]).toBe(
      "familias.SAL tiene que ser un texto.",
    );
    expect(forma.problemasDeLasFamilias({ ...BUENA, familias: { SAL: "ab" } })[0]).toContain(
      "familias.SAL tiene que tener entre 3 y 100 caracteres.",
    );
    expect(
      forma.problemasDeLasFamilias({ ...BUENA, familias: { SAL: "x".repeat(101) } })[0],
    ).toContain("entre 3 y 100 caracteres");
    expect(forma.problemasDeLasFamilias({ ...BUENA, familias: { SAL: "Sa  lón" } })[0]).toContain(
      "admite letras, números y los signos de una frase",
    );
  });

  it("el archivo real trae las familias del dueño y es válido", () => {
    const real = JSON.parse(readFileSync(join(RAIZ, control.ARCHIVO_DE_LAS_FAMILIAS), "utf8")) as {
      corte: string;
      familias: Record<string, string>;
    };
    expect(forma.problemasDeLasFamilias(real)).toEqual([]);
    expect(Object.keys(real.familias).sort()).toEqual(
      ["ANO", "CAT", "CCL", "CI", "COM", "DOM", "FIS", "IDE", "PRO", "SAL", "STK", "VEN"].sort(),
    );
    expect(real.corte).toBe("2026-11-26");
  });
});

describe("el control (a): las citas heredadas y por familia", () => {
  const registro = [entrada({ id: "DEC-0001", fecha: "2026-11-25" }), POR_FAMILIA("DEC-SAL-001")];
  const con = (linea: string, reg: Entrada[] = registro) =>
    control
      .evaluar({ pr: arbolConRegistro(reg, { "src/a.ts": `${linea}\n` }) })
      .fallas.map((f) => f.motivo);

  it("un marcador con su cita por familia registrada pasa, igual que con la heredada", () => {
    expect(con(`// ${MARCA} (DEC-SAL-001)`)).toEqual([]);
    expect(con(`// ${MARCA} (DEC-0001)`)).toEqual([]);
  });

  it("VIOLACIÓN: una cita por familia que no está registrada falla, con o sin marcador, y dice cómo agregarla por familia", () => {
    const sinRegistrar = con("// ver DEC-SAL-002");
    expect(sinRegistrar).toHaveLength(1);
    expect(sinRegistrar[0]).toContain(
      "cita DEC-SAL-002, que no está en arquitectura/decisiones/registro/.",
    );
    expect(sinRegistrar[0]).toContain(
      "el siguiente número libre de ESA familia (DEC-SAL-001, DEC-SAL-002…",
    );
    expect(sinRegistrar[0]).toContain("arquitectura/decisiones/familias.json");
    expect(con(`// ${MARCA} (DEC-ZZZ-001)`)[0]).toContain("cita DEC-ZZZ-001, que no está");
  });

  it("una cita con el formato roto no cuenta como cita (un marcador con ella sigue sin cita)", () => {
    expect(con(`// ${MARCA} (DEC-SAL-1)`)[0]).toContain("SUPUESTO sin decisión registrada");
  });

  it("varias citas en una línea se miran todas (mezcla de formatos)", () => {
    expect(con("// DEC-0001 y DEC-SAL-001 y DEC-STK-001")).toHaveLength(1);
    expect(con("// DEC-0001 y DEC-SAL-001")).toEqual([]);
  });
});

describe("el control: las familias en el árbol", () => {
  it("VIOLACIÓN: sin familias.json el control falla (no se juzga a ciegas)", () => {
    const sinFamilias = arbolConRegistro([entrada({ id: "DEC-0001", fecha: "2026-11-25" })]);
    const pr = {
      rutas: sinFamilias.rutas.filter((r) => r !== control.ARCHIVO_DE_LAS_FAMILIAS),
      leer: (ruta: string) =>
        ruta === control.ARCHIVO_DE_LAS_FAMILIAS ? null : sinFamilias.leer(ruta),
    };
    expect(control.evaluar({ pr }).fallas).toEqual([
      { archivo: control.ARCHIVO_DE_LAS_FAMILIAS, linea: 1, motivo: "no existe." },
    ]);
  });

  it("VIOLACIÓN: un familias.json inválido falla con su archivo y se corta (ni el registro ni la cuota se juzgan con una lista rota)", () => {
    const cuotaConExcepcion = {
      ...CUOTA,
      excepciones: [
        { id: "DEC-ZZZ-001", fecha: "2026-11-26", fuente: "Mensaje del dueño 26/11/2026" },
      ],
    };
    const pr = arbolConRegistro(
      [POR_FAMILIA("DEC-ZZZ-001"), POR_FAMILIA("DEC-SAL-1")],
      {},
      undefined,
      cuotaConExcepcion,
      { corte: "mal", familias: { SAL: "Salón" } },
    );
    expect(control.evaluar({ pr }).fallas).toEqual([
      {
        archivo: control.ARCHIVO_DE_LAS_FAMILIAS,
        linea: 1,
        motivo: "corte es un día real con la forma AAAA-MM-DD.",
      },
    ]);
  });

  it("con familias bien formadas y la cuota con una excepción por familia, el control no falla", () => {
    const cuota = {
      ...CUOTA,
      excepciones: [
        { id: "DEC-SAL-001", fecha: "2026-11-26", fuente: "Mensaje del dueño 26/11/2026" },
      ],
    };
    const pr = arbolConRegistro([POR_FAMILIA("DEC-SAL-001")], {}, undefined, cuota);
    expect(control.evaluar({ pr }).fallas).toEqual([]);
  });

  it("la base se juzga con las familias del cambio: una familia NUEVA no deja «inválidas» las decisiones de la base", () => {
    const conNueva = { ...FAMILIAS, familias: { ...FAMILIAS.familias, NUE: "Nueva" } };
    const base = arbolConRegistro([POR_FAMILIA("DEC-NUE-001")], {}, undefined, CUOTA, conNueva);
    const pr = arbolConRegistro(
      [
        POR_FAMILIA("DEC-NUE-001"),
        POR_FAMILIA("DEC-NUE-002", { tipo: "SIN_DECISION", motivo: "técnico puro" }),
      ],
      {},
      undefined,
      CUOTA,
      conNueva,
    );
    expect(control.evaluar({ pr, base }).fallas).toEqual([]);
  });

  it("la cuota acepta ids por familia en sus excepciones y rechaza una familia que no existe", () => {
    const excepcion = (id: string) => ({
      ...CUOTA,
      excepciones: [{ id, fecha: "2026-11-26", fuente: "Mensaje del dueño 26/11/2026" }],
    });
    expect(forma.problemasDeLaCuota(excepcion("DEC-SAL-001"))).toEqual([]);
    expect(forma.problemasDeLaCuota(excepcion("DEC-0700"))).toEqual([]);
    expect(forma.problemasDeLaCuota(excepcion("DEC-ZZZ-001"))).toEqual([
      "excepciones[0]: la familia ZZZ no está en familias.json (las conocidas: COM, SAL, STK).",
    ]);
    expect(forma.problemasDeLaCuota(excepcion("DEC-SAL-1"))).toEqual([
      "excepciones[0]: id tiene la forma DEC-0001 (heredada) o DEC-SAL-001 (por familia).",
    ]);
    const repetida = {
      ...CUOTA,
      excepciones: [
        { id: "DEC-SAL-001", fecha: "2026-11-26", fuente: "Mensaje del dueño" },
        { id: "DEC-SAL-001", fecha: "2026-11-26", fuente: "Mensaje del dueño" },
      ],
    };
    expect(forma.problemasDeLaCuota(repetida)).toEqual([
      "excepciones[1]: el id DEC-SAL-001 está repetido.",
    ]);
  });
});

describe("el repositorio real", () => {
  it("todos los archivos del registro son «DEC-NNNN.json» (heredadas) o «DEC-FAM-NNN.json» (por familia)", () => {
    const archivos = readdirSync(join(RAIZ, control.CARPETA_DEL_REGISTRO));
    expect(archivos.length).toBeGreaterThan(100);
    for (const archivo of archivos) {
      expect(archivo, archivo).toMatch(/^DEC-(?:\d{4}|[A-Z]{2,4}-\d{3})\.json$/);
    }
  });

  it("el tipo de TypeScript de una decisión acepta ambos formatos y rechaza lo que no es una decisión (se comprueba al compilar)", () => {
    type Acepta<T extends string> = T extends IdDeDecision ? true : false;
    const resultados: [
      Acepta<"DEC-0001">,
      Acepta<"DEC-SAL-001">,
      Acepta<"DEC-STK-014">,
      Acepta<"DEC-sal-001">,
      Acepta<"DEC-SAL-">,
      Acepta<"SAL-001">,
    ] = [true, true, true, false, false, false];
    expect(resultados).toEqual([true, true, true, false, false, false]);
  });
});
