import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  CONFIGURACION,
  REGISTRO,
  conMarcadores,
  correr,
  entrada,
  evaluar,
  json,
  libro,
  mundo,
} from "./guardian-deuda-apoyo";

const require = createRequire(import.meta.url);
type Problema = { campo: string; motivo: string; correccion: string };
const porDiseno = require("../../arquitectura/deuda/por-diseno.cjs") as {
  formaDePorDiseno: (entrada: object, ayudas: object) => Problema[];
  hallazgosDeTopes: (antes: object, ahora: object, ayudas: object) => object[];
  esAmpliacionAprobada: (antes: object, ahora: object, ayudas: object) => boolean;
  esDePrueba: (ruta: string) => boolean;
  problemaDeAmpliacion: (valor: unknown, ayudas: object) => string | null;
};

/**
 * La categoría «por diseño» del libro (`arquitectura/deuda/por-diseno.cjs`, decisión del dueño 2026-11-06). Cada regla
 * que impide usarla de comodín tiene acá su violación inyectada, con el texto exacto que lee quien la rompe: si se
 * quita la regla, la prueba falla.
 */

const AYUDAS = {
  esObjeto: (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v),
  esTexto: (v: unknown) => typeof v === "string" && v.trim() !== "",
};
const REVISION = {
  motivo: "Prueba negativa de tipos.",
  aprobadoPor: "Dueño, 2026-11-06",
  revisar: "2027-10-22",
};

/** Una entrada por diseño sana: `@ts-expect-error` en un archivo de prueba, con su cantidad. */
const delDiseno = (cambios: Record<string, unknown> = {}) =>
  entrada({
    id: "ts-expect-error--a-test-ts",
    archivos: ["a.test.ts"],
    creada: "2026-10-22",
    cantidad: 1,
    porDiseno: REVISION,
    ...cambios,
  });
const forma = (cambios: Record<string, unknown> = {}) =>
  porDiseno.formaDePorDiseno(delDiseno(cambios), AYUDAS);
const conRevision = (cambios: Record<string, unknown>) =>
  forma({ porDiseno: { ...REVISION, ...cambios } });

/** Un árbol con `a.test.ts` (con sus marcadores), el registro y la configuración con ese tope por diseño. */
const arbol = (
  entradas: unknown[],
  extra: Record<string, string> = {},
  tope = 5,
  archivoDePrueba = conMarcadores(1),
) => mundo({ "a.test.ts": archivoDePrueba, ...extra }, entradas, { topeDePorDiseno: tope });

describe("una entrada por diseño sana", () => {
  it("pasa, es vigente y no cuenta como excepción (no gasta el tope de excepciones)", () => {
    const { fallas, entradas } = evaluar(arbol([delDiseno()]));
    expect(fallas).toEqual([]);
    expect(entradas[0]).toMatchObject({
      porDiseno: true,
      excepcion: false,
      vigente: true,
      cantidad: 1,
      origen: null,
    });
    expect(forma()).toEqual([]);
  });

  it("vale para knip-ignora y riesgo-aceptado, sin cantidad", () => {
    for (const tipo of ["knip-ignora", "riesgo-aceptado"]) {
      expect(forma({ tipo, cantidad: undefined })).toEqual([]);
    }
  });
});

describe("lo que impide usar «por diseño» de comodín (formaDePorDiseno)", () => {
  it("solo cuatro tipos: cualquier otro no puede ser por diseño", () => {
    for (const tipo of ["backlog", "todo", "archivo-grande", "brecha", "auditoria"]) {
      expect(forma({ tipo, cantidad: undefined })).toEqual([
        {
          campo: "tipo",
          motivo: `el tipo «${tipo}» no puede ser por diseño.`,
          correccion: "Solo: ts-expect-error, eslint-disable, knip-ignora, riesgo-aceptado.",
        },
      ]);
    }
  });

  it("un ts-expect-error o eslint-disable por diseño solo vale en un archivo de prueba", () => {
    for (const tipo of ["ts-expect-error", "eslint-disable"]) {
      for (const archivos of [["a.ts"], ["a.test.ts", "a.ts"], ["a.ts", "a.test.ts"]]) {
        expect(forma({ tipo, archivos })).toEqual([
          {
            campo: "archivos",
            motivo: `«${tipo}» solo es por diseño en un archivo de prueba (*.test.* o test/).`,
            correccion: "En código de producción es deuda con vencimiento.",
          },
        ]);
      }
      expect(forma({ tipo, archivos: ["a.test.ts"] })).toEqual([]);
    }
  });

  it("qué es un archivo de prueba: *.test.<ext> (con c/m opcional) o debajo de test/", () => {
    for (const ruta of [
      "x.test.ts",
      "x.test.tsx",
      "x.test.js",
      "x.test.jsx",
      "x.test.mts",
      "x.test.cts",
      "x.test.mjs",
      "x.test.cjs",
      "test/x.ts",
      "test/a/b.cjs",
    ]) {
      expect(porDiseno.esDePrueba(ruta), ruta).toBe(true);
    }
    for (const ruta of [
      "x.ts",
      "x.test.ts.bak",
      "x.test.tsz",
      "x.test.xts",
      "src/test/x.ts",
      "testx/x.ts",
      "x.tests.ts",
    ]) {
      expect(porDiseno.esDePrueba(ruta), ruta).toBe(false);
    }
  });

  it("un marcador por diseño lleva cantidad (entero ≥ 1), y el resto no la lleva", () => {
    for (const cantidad of [undefined, 0, -1, 1.5, "1", null]) {
      expect(forma({ cantidad })).toEqual([
        {
          campo: "cantidad",
          motivo:
            "una entrada por diseño de un marcador lleva «cantidad»: un entero (cuántos hay) desde 1.",
          correccion: "Poné cuántos marcadores tiene hoy el archivo.",
        },
      ]);
    }
    expect(forma({ cantidad: 1 })).toEqual([]);
    expect(forma({ cantidad: 7 })).toEqual([]);
    expect(forma({ tipo: "knip-ignora", cantidad: 1 })).toEqual([
      {
        campo: "cantidad",
        motivo: "un «knip-ignora» por diseño no lleva «cantidad».",
        correccion: "Sacala.",
      },
    ]);
    expect(
      porDiseno.formaDePorDiseno(entrada({ cantidad: 1, creada: "2026-10-22" }), AYUDAS),
    ).toEqual([
      {
        campo: "cantidad",
        motivo: "solo una entrada «porDiseno» lleva «cantidad».",
        correccion: "Sacala.",
      },
    ]);
  });

  it("no mezcla las dos categorías: motivo, aprobadoPor o vence de una excepción sobran", () => {
    for (const campo of ["motivo", "aprobadoPor", "vence"]) {
      expect(forma({ [campo]: "2026-11-30" })).toEqual([
        {
          campo,
          motivo: `«${campo}» es de una excepción con vencimiento: una entrada «porDiseno» no la lleva.`,
          correccion: "Una entrada es por diseño o es una excepción, no las dos.",
        },
      ]);
    }
  });

  it("porDiseno trae sus tres campos, sin sobrantes", () => {
    expect(forma({ porDiseno: "x" })).toEqual([
      {
        campo: "porDiseno",
        motivo: "«porDiseno» es `{ motivo, aprobadoPor, revisar }`.",
        correccion: "Corregí su forma.",
      },
    ]);
    expect(forma({ porDiseno: [] }).map((p) => p.campo)).toEqual(["porDiseno"]);
    expect(forma({ porDiseno: null }).map((p) => p.campo)).toEqual(["porDiseno"]);
    expect(conRevision({ extra: 1 })).toEqual([
      {
        campo: "porDiseno",
        motivo: "«porDiseno» trae «extra», que no es un campo permitido.",
        correccion: "Dejá solo: motivo, aprobadoPor, revisar.",
      },
    ]);
    for (const campo of ["motivo", "aprobadoPor"]) {
      for (const valor of [undefined, "", "  ", 5]) {
        expect(conRevision({ [campo]: valor })).toEqual([
          {
            campo: "porDiseno",
            motivo: `«porDiseno.${campo}» falta o está vacío.`,
            correccion: "Una entrada por diseño dice por qué y quién la aprobó.",
          },
        ]);
      }
    }
  });

  it("revisar es una fecha real, posterior a creada y a no más de 366 días", () => {
    const FECHA = {
      campo: "porDiseno",
      motivo: "«porDiseno.revisar» tiene que ser una fecha AAAA-MM-DD real.",
      correccion: "Poné cuándo se vuelve a revisar (como máximo un año).",
    };
    for (const revisar of [undefined, "", "mañana", "2027-02-30", 20271022]) {
      expect(conRevision({ revisar })).toEqual([FECHA]);
    }
    expect(conRevision({ revisar: "2026-10-22" })).toEqual([
      {
        campo: "porDiseno",
        motivo: "«porDiseno.revisar» no es posterior a «creada».",
        correccion: "La revisión es después de la aprobación.",
      },
    ]);
    expect(conRevision({ revisar: "2026-10-21" }).map((p) => p.motivo)).toEqual([
      "«porDiseno.revisar» no es posterior a «creada».",
    ]);
    expect(conRevision({ revisar: "2026-10-23" })).toEqual([]);
    expect(conRevision({ revisar: "2027-10-23" })).toEqual([]); // 366 días: el límite vale
    expect(conRevision({ revisar: "2027-10-24" })).toEqual([
      {
        campo: "porDiseno",
        motivo: "la revisión dura más de 366 días desde «creada».",
        correccion: "La revisión es anual.",
      },
    ]);
  });

  it("con creada ilegible no se comparan fechas contra ella (lo dice el control común)", () => {
    for (const creada of [undefined, "", "ayer", "2026-02-30"]) {
      expect(forma({ creada, origen: "2026-10-30" })).toEqual([]);
      expect(forma({ creada, porDiseno: { ...REVISION, revisar: "2020-01-01" } })).toEqual([]);
    }
  });
});

describe("origen: la fecha real de la deuda", () => {
  it("es una fecha real y no es posterior a creada", () => {
    for (const origen of ["", "ayer", "2026-02-30", 5, null]) {
      expect(forma({ origen })).toEqual([
        {
          campo: "origen",
          motivo: "«origen» tiene que ser una fecha AAAA-MM-DD real.",
          correccion: "Poné la fecha en que nació la deuda.",
        },
      ]);
    }
    expect(forma({ origen: "2026-10-23" })).toEqual([
      {
        campo: "origen",
        motivo: "«origen» es posterior a «creada».",
        correccion:
          "El origen es la fecha real de la deuda: no puede ser después de la aprobación.",
      },
    ]);
    expect(forma({ origen: "2026-10-22" })).toEqual([]);
    expect(forma({ origen: "2026-09-01" })).toEqual([]);
    expect(porDiseno.formaDePorDiseno(entrada({ origen: "2026-10-01" }), AYUDAS)).toEqual([]);
  });

  it("la antigüedad del informe se mide desde el origen cuando existe, y desde creada si no", () => {
    const conOrigen = correr(arbol([delDiseno({ origen: "2026-10-02" })]));
    expect(conOrigen.informe.antiguedad.masVieja).toEqual({
      id: "ts-expect-error--a-test-ts",
      dias: 20,
    });
    const sinOrigen = correr(arbol([delDiseno()]));
    expect(sinOrigen.informe.antiguedad.masVieja).toEqual({
      id: "ts-expect-error--a-test-ts",
      dias: 0,
    });
  });
});

describe("en el libro: tope, cantidad y revisión", () => {
  it("el tope de entradas por diseño: la que sobra falla en su id", () => {
    const dos = [delDiseno(), delDiseno({ id: "otra", archivos: ["b.test.ts"] })];
    const extra = { "b.test.ts": conMarcadores(1) };
    const { fallas } = evaluar(arbol(dos, extra, 1));
    expect(fallas).toEqual([
      {
        codigo: "deuda-tope-de-excepciones",
        archivo: REGISTRO,
        contrato: "deuda",
        motivo:
          "Hay 2 entradas por diseño y el tope es 1: «por diseño» no puede volverse un comodín.",
        correccion:
          "Pagá deuda (que una entrada deje de hacer falta) antes de abrir otra; el tope solo baja.",
        donde: { tipo: "json", camino: [1, "id"] },
      },
    ]);
    expect(evaluar(arbol(dos, extra, 2)).fallas).toEqual([]);
  });

  it("sin la clave en la configuración el tope es 0: nada es por diseño hasta declararlo", () => {
    const sinClave = mundo({ "a.test.ts": conMarcadores(1) }, [delDiseno()], null);
    sinClave[CONFIGURACION] = json({
      topeDeExcepciones: 10,
      bloqueaDeudaEnArchivoTocado: true,
      topeDeLineasPorArchivo: 400,
      excluidosDelTope: [],
    });
    const leida = evaluar(sinClave);
    expect(leida.configuracion.topeDePorDiseno).toBe(0);
    expect(leida.fallas.map((f) => f.codigo)).toEqual(["deuda-tope-de-excepciones"]);
  });

  it("la cantidad es un trinquete: un marcador más falla; uno menos pide bajar el número", () => {
    const mas = evaluar(arbol([delDiseno()], {}, 5, conMarcadores(2)));
    expect(mas.fallas).toEqual([
      {
        codigo: "deuda-archivo-crece",
        archivo: REGISTRO,
        contrato: "deuda",
        motivo:
          "«ts-expect-error--a-test-ts» registra 1 y el archivo tiene 2 marcadores: un marcador por diseño no puede crecer sin pasar por el registro.",
        correccion:
          "Sacá el marcador, o registrá el nuevo con el dueño (el tope de entradas por diseño solo baja).",
        donde: { tipo: "json", camino: [0, "cantidad"] },
      },
    ]);
    const menos = evaluar(arbol([delDiseno({ cantidad: 3 })], {}, 5, conMarcadores(2)));
    expect(menos.fallas).toEqual([]);
    expect(menos.avisos).toEqual([
      {
        codigo: "deuda-tamano-desactualizado",
        archivo: REGISTRO,
        contrato: "deuda",
        motivo:
          "«ts-expect-error--a-test-ts» registra 3 y el archivo tiene 2 marcadores: el trinquete tiene que bajar con él.",
        correccion: 'Poné "cantidad": 2 en la entrada.',
        donde: { tipo: "json", camino: [0, "cantidad"] },
      },
    ]);
    expect(evaluar(arbol([delDiseno({ cantidad: 2 })], {}, 5, conMarcadores(2)))).toMatchObject({
      fallas: [],
      avisos: [],
    });
  });

  it("sin cantidad válida no se compara (la forma ya lo dice), y sin marcadores en el archivo, tampoco", () => {
    const sinCantidad = evaluar(arbol([delDiseno({ cantidad: undefined })]));
    expect(sinCantidad.fallas.map((f) => f.codigo)).toEqual(["deuda-entrada-invalida"]);
    expect(sinCantidad.avisos).toEqual([]);
    const sinMarcadores = evaluar(arbol([delDiseno()], {}, 5, "export const a = 1;\n"));
    expect(sinMarcadores.fallas).toEqual([]);
    expect(sinMarcadores.avisos.map((a) => a.codigo)).toEqual(["deuda-resuelta"]);
  });

  it("la revisión vencida FALLA (cierra) y deja de ser vigente", () => {
    const vencida = evaluar(
      arbol([
        delDiseno({ creada: "2025-01-01", porDiseno: { ...REVISION, revisar: "2025-12-31" } }),
      ]),
    );
    expect(vencida.fallas).toEqual([
      {
        codigo: "excepcion-vencida",
        archivo: REGISTRO,
        contrato: "deuda",
        motivo:
          "La entrada «ts-expect-error--a-test-ts» (por diseño) tenía que revisarse el 2025-12-31 (hoy es 2026-10-22).",
        correccion:
          "Revisala con el dueño: si sigue siendo por diseño, nueva revisión a un año; si no, pagala o dale vencimiento.",
        donde: { tipo: "json", camino: [0, "porDiseno"] },
      },
    ]);
    expect(vencida.entradas[0]?.vigente).toBe(false);
  });

  it("el día de la revisión todavía vale y avisa; a 14 días o menos avisa; a 15 no", () => {
    const con = (revisar: string) =>
      evaluar(arbol([delDiseno({ creada: "2026-01-01", porDiseno: { ...REVISION, revisar } })]));
    const hoy = con("2026-10-22");
    expect(hoy.fallas).toEqual([]);
    expect(hoy.entradas[0]?.vigente).toBe(true);
    expect(hoy.avisos.map((a) => a.codigo)).toEqual(["excepcion-por-vencer"]);
    expect(con("2026-11-05").avisos.map((a) => a.codigo)).toEqual(["excepcion-por-vencer"]);
    expect(con("2026-11-05").avisos[0]?.motivo).toBe(
      "Revisión por diseño «ts-expect-error--a-test-ts»: vence el 2026-11-05 (faltan 14 días; hoy es 2026-10-22).",
    );
    expect(con("2026-11-06").avisos).toEqual([]);
  });

  it("una revisión ilegible no rompe la lectura (la forma la rechaza)", () => {
    for (const revisar of [undefined, 5, "2027-02-30", "2020-02-30", null]) {
      const { fallas, avisos } = evaluar(
        arbol([delDiseno({ porDiseno: { ...REVISION, revisar } })]),
      );
      expect(fallas.map((f) => f.codigo)).toEqual(["deuda-entrada-invalida"]);
      expect(avisos).toEqual([]);
    }
  });
});

describe("contra la base: una entrada por diseño vigente permite su marcador", () => {
  const base = mundo({ "z.ts": "export const z = 1;\n" }, [], { topeDePorDiseno: 5 });
  it("un archivo de prueba nuevo con su entrada por diseño pasa; sin la entrada, no", () => {
    const con = correr(arbol([delDiseno()], { "z.ts": "export const z = 1;\n" }), base);
    expect(con.fallas).toEqual([]);
    const sin = correr(arbol([], { "z.ts": "export const z = 1;\n" }), base);
    expect(sin.fallas.map((f) => f.codigo)).toContain("deuda-sin-registrar");
  });

  it("un riesgo-aceptado nuevo sin excepción falla; por diseño y vigente, pasa; por diseño vencido, falla", () => {
    const nueva = (cambios: Record<string, unknown>) =>
      entrada({
        id: "riesgo",
        tipo: "riesgo-aceptado",
        archivos: ["z.ts"],
        creada: "2026-10-22",
        ...cambios,
      });
    const pr = (entradas: unknown[]) =>
      correr(mundo({ "z.ts": "export const z = 1;\n" }, entradas, { topeDePorDiseno: 5 }), base);
    expect(pr([nueva({})]).fallas.map((f) => f.codigo)).toEqual(["deuda-nueva-sin-excepcion"]);
    expect(pr([nueva({ porDiseno: REVISION })]).fallas).toEqual([]);
    const vencida = pr([
      nueva({ creada: "2025-01-01", porDiseno: { ...REVISION, revisar: "2025-12-31" } }),
    ]);
    expect(vencida.fallas.map((f) => f.codigo).sort()).toEqual([
      "deuda-nueva-sin-excepcion",
      "excepcion-vencida",
    ]);
  });
});

describe("la configuración: ampliacionDelTope y topeDePorDiseno", () => {
  const AMPLIACION = { desde: 10, aprobadoPor: "Dueño, 2026-11-06", fecha: "2026-11-06" };
  const leer = (resto: Record<string, unknown>) =>
    libro.leerConfiguracion((ruta) =>
      ruta === CONFIGURACION
        ? json({
            topeDeExcepciones: 41,
            bloqueaDeudaEnArchivoTocado: true,
            topeDeLineasPorArchivo: 400,
            excluidosDelTope: [],
            ...resto,
          })
        : null,
    );

  it("una ampliación bien formada se acepta; una mal formada falla en su clave", () => {
    expect(leer({ ampliacionDelTope: AMPLIACION }).fallas).toEqual([]);
    expect(leer({ ampliacionDelTope: { ...AMPLIACION, desde: 0 } }).fallas).toEqual([]);
    for (const mala of [
      "x",
      [],
      null,
      { desde: 10, aprobadoPor: "x" },
      { aprobadoPor: "x", desde: 10, fecha: "2026-11-06" },
      { ...AMPLIACION, desde: -1 },
      { ...AMPLIACION, desde: 1.5 },
      { ...AMPLIACION, aprobadoPor: " " },
      { ...AMPLIACION, fecha: "2026-13-01" },
      { ...AMPLIACION, fecha: undefined },
      { ...AMPLIACION, extra: 1 },
    ]) {
      const { fallas } = leer({ ampliacionDelTope: mala });
      expect(fallas).toHaveLength(1);
      expect(fallas[0]).toMatchObject({
        codigo: "deuda-configuracion-invalida",
        motivo:
          "`ampliacionDelTope` es `{ desde (entero), aprobadoPor (texto), fecha (AAAA-MM-DD) }`, en ese orden.",
        donde: { tipo: "json", camino: ["ampliacionDelTope"] },
      });
    }
  });

  it("topeDePorDiseno es un entero ≥ 0 (0 y ausente valen)", () => {
    for (const malo of [-1, 1.5, "5", null, true]) {
      expect(leer({ topeDePorDiseno: malo }).fallas.map((f) => f.motivo)).toEqual([
        "`topeDePorDiseno` tiene que ser un entero mayor o igual que 0.",
      ]);
    }
    expect(leer({ topeDePorDiseno: 0 }).fallas).toEqual([]);
    expect(leer({ topeDePorDiseno: 27 }).configuracion.topeDePorDiseno).toBe(27);
    expect(leer({}).configuracion.topeDePorDiseno).toBe(0);
    expect(leer({ topeDePorDiseno: -1 }).configuracion.topeDePorDiseno).toBe(0);
  });
});

describe("no-debilitar: los topes entre la base y el PR (hallazgosDeTopes)", () => {
  const ayudas = {
    ...AYUDAS,
    archivo: "arquitectura/deuda/configuracion.json",
    enJson: (...camino: string[]) => ({ camino }),
    hallazgo: (
      codigo: string,
      archivo: string,
      motivo: string,
      correccion: string,
      extra: object,
    ) => ({ codigo, archivo, motivo, correccion, ...extra }),
  };
  const AMPLIACION = { desde: 10, aprobadoPor: "Dueño, 2026-11-06", fecha: "2026-11-06" };
  const topes = (antes: object, ahora: object) => porDiseno.hallazgosDeTopes(antes, ahora, ayudas);
  const SUBIO = {
    codigo: "deuda-tope-subio",
    archivo: "arquitectura/deuda/configuracion.json",
    motivo: "El tope de excepciones de deuda subió de 10 a 11: la excepción se volvería la norma.",
    correccion: "Dejá el tope como estaba (puede bajar, no subir).",
    donde: { camino: ["topeDeExcepciones"] },
  };

  it("sin cambios, o bajando los topes, no dice nada", () => {
    expect(topes({ tope: 10 }, { tope: 10 })).toEqual([]);
    expect(
      topes({ tope: 41, ampliacion: AMPLIACION }, { tope: 30, ampliacion: AMPLIACION }),
    ).toEqual([]);
    expect(topes({ tope: 10, topePorDiseno: 27 }, { tope: 10, topePorDiseno: 27 })).toEqual([]);
    expect(topes({ tope: 10, topePorDiseno: 27 }, { tope: 10, topePorDiseno: 20 })).toEqual([]);
  });

  it("subir el tope de excepciones sin ampliación aprobada falla, con el mismo texto de siempre", () => {
    expect(topes({ tope: 10 }, { tope: 11 })).toEqual([SUBIO]);
  });

  it("subirlo UNA vez con la ampliación aprobada (desde = tope de la base) pasa", () => {
    expect(topes({ tope: 10 }, { tope: 41, ampliacion: AMPLIACION })).toEqual([]);
    expect(topes({ tope: 10, ampliacion: null }, { tope: 41, ampliacion: AMPLIACION })).toEqual([]);
  });

  it("la ampliación no vale si: ya hubo una en la base, 'desde' no es el tope de la base o está mal formada", () => {
    const ya = { tope: 41, ampliacion: AMPLIACION };
    expect(topes(ya, { tope: 42, ampliacion: { ...AMPLIACION, desde: 41 } })).toHaveLength(1);
    for (const mala of [
      { ...AMPLIACION, desde: 9 },
      { ...AMPLIACION, desde: 11 },
      { ...AMPLIACION, fecha: "mañana" },
      undefined,
      "ok",
      null,
    ]) {
      expect(topes({ tope: 10 }, { tope: 41, ampliacion: mala })).toHaveLength(1);
    }
  });

  it("el tope de entradas por diseño no sube nunca; si la base no lo tenía, puede nacer", () => {
    expect(topes({ tope: 10, topePorDiseno: 27 }, { tope: 10, topePorDiseno: 28 })).toEqual([
      {
        codigo: "deuda-tope-subio",
        archivo: "arquitectura/deuda/configuracion.json",
        motivo:
          "El tope de entradas por diseño subió de 27 a 28: «por diseño» se volvería un comodín.",
        correccion: "Dejá el tope como estaba (solo baja).",
        donde: { camino: ["topeDePorDiseno"] },
      },
    ]);
    expect(topes({ tope: 10 }, { tope: 10, topePorDiseno: 27 })).toEqual([]);
    expect(topes({ tope: 10, topePorDiseno: 0 }, { tope: 10, topePorDiseno: 1 })).toHaveLength(1);
  });

  it("esAmpliacionAprobada exige que el tope realmente suba", () => {
    const aprobada = (antes: object, ahora: object) =>
      porDiseno.esAmpliacionAprobada(antes, ahora, AYUDAS);
    expect(aprobada({ tope: 10 }, { tope: 10, ampliacion: AMPLIACION })).toBe(false);
    expect(aprobada({ tope: 10 }, { tope: 9, ampliacion: AMPLIACION })).toBe(false);
    expect(aprobada({ tope: 10 }, { tope: 11, ampliacion: AMPLIACION })).toBe(true);
    expect(porDiseno.problemaDeAmpliacion(AMPLIACION, AYUDAS)).toBeNull();
  });
});
