import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AHORA,
  BASE,
  CODIGOS_DE_FALLA,
  DESCRIPCION_DE_CODIGOS,
  EXCLUSIONES_BASE,
  LINEA_DE_USO,
  RAIZ_ORIGINAL,
  REGLAS_DE_LINEA,
  contrato,
  contratoDeRadio,
  correr,
  definicionInerte,
  ejecutar,
  huellaDe,
  huellaDelArchivo,
  porPatron,
  type Falla,
} from "./guardian-apoyo";

/**
 * Núcleo del guardián (`guardian.cjs`) sobre árboles en memoria: el orden de la salida, la
 * autocomprobación de ubicaciones, qué se informa cuando no se pudo analizar todo y cómo se cuenta lo
 * que sí se analizó. Cada valor esperado está escrito a mano, a partir del repositorio mínimo `BASE`.
 */

const GUARDIAN = "arquitectura/contratos/guardian.cjs";
const REGLAS = "arquitectura/contratos/clasificacion.cjs";

/** Todas las formas de ordenar una lista (para que ningún orden de entrada acierte por casualidad). */
function permutaciones<T>(lista: T[]): T[][] {
  if (lista.length <= 1) return [lista];
  return lista.flatMap((elemento, i) =>
    permutaciones([...lista.slice(0, i), ...lista.slice(i + 1)]).map((resto) => [
      elemento,
      ...resto,
    ]),
  );
}

type Previa = Partial<Falla> & { codigo: string };
const previa = (cambios: Previa): Falla => ({
  archivo: "a.ts",
  linea: 1,
  contrato: null,
  motivo: "m",
  correccion: "c",
  ...cambios,
});
const clave = (f: Falla): unknown[] => [f.archivo, f.linea, f.codigo, f.contrato, f.motivo];

describe("el orden de la salida", () => {
  /** Corre con esas fallas previas en cada orden posible y exige SIEMPRE el mismo resultado ordenado. */
  function exigeOrden(esperadas: Falla[], lista: "fallas" | "avisos" = "fallas"): void {
    for (const entrada of permutaciones(esperadas)) {
      const resultado = correr({ previas: { [lista]: entrada } });
      expect(
        resultado[lista].map(clave),
        `entrada ${entrada.map((f) => clave(f).join("/")).join(" | ")}`,
      ).toEqual(esperadas.map(clave));
    }
  }

  it("primero por archivo, en orden alfabético", () => {
    exigeOrden(
      ["a.ts", "a/x.ts", "ab.ts", "b.ts"].map((archivo) =>
        previa({ codigo: "ruta-sin-clase", archivo }),
      ),
    );
  });

  it("después por línea, como número (la 10 va después de la 9)", () => {
    exigeOrden([2, 9, 10, 33].map((linea) => previa({ codigo: "ruta-sin-clase", linea })));
  });

  it("después por código", () => {
    exigeOrden(
      ["clasificacion-ambigua", "ruta-sin-clase", "unidad-sin-declaracion"].map((codigo) =>
        previa({ codigo }),
      ),
    );
  });

  it("después por contrato, con el que no tiene contrato primero", () => {
    exigeOrden(
      [null, "1-x", "a-b", "b-c"].map((contrato) => previa({ codigo: "ruta-sin-clase", contrato })),
    );
  });

  it("al final por motivo", () => {
    exigeOrden(["a", "b", "c"].map((motivo) => previa({ codigo: "ruta-sin-clase", motivo })));
  });

  it("cada criterio manda sobre el siguiente", () => {
    exigeOrden([
      previa({
        codigo: "unidad-sin-declaracion",
        archivo: "a.ts",
        linea: 5,
        contrato: "z",
        motivo: "z",
      }),
      previa({
        codigo: "clasificacion-ambigua",
        archivo: "a.ts",
        linea: 6,
        contrato: null,
        motivo: "a",
      }),
      previa({ codigo: "ruta-sin-clase", archivo: "b.ts", linea: 1, contrato: null, motivo: "a" }),
    ]);
    exigeOrden([
      previa({ codigo: "ruta-sin-clase", archivo: "a.ts", linea: 7, contrato: "a", motivo: "z" }),
      previa({ codigo: "ruta-sin-clase", archivo: "a.ts", linea: 7, contrato: "z", motivo: "z" }),
      previa({
        codigo: "unidad-sin-declaracion",
        archivo: "a.ts",
        linea: 7,
        contrato: null,
        motivo: "a",
      }),
    ]);
  });

  it("dos fallas idénticas salen las dos", () => {
    const igual = previa({ codigo: "ruta-sin-clase" });
    expect(correr({ previas: { fallas: [igual, { ...igual }] } }).fallas).toHaveLength(2);
  });

  it("los avisos se ordenan igual", () => {
    exigeOrden(
      [
        previa({ codigo: "ruta-ausente-en-disco", archivo: "a.ts", linea: 3 }),
        previa({ codigo: "excepcion-por-vencer", archivo: "a.ts", linea: 12 }),
        previa({ codigo: "ruta-ausente-en-disco", archivo: "a.ts", linea: 12 }),
        previa({ codigo: "excepcion-por-vencer", archivo: "b.ts", linea: 1 }),
      ],
      "avisos",
    );
  });
});

describe("la autocomprobación de ubicaciones (M3)", () => {
  const CORRECCION_DE_UBICACION =
    "Hacé que el chequeo diga el archivo y la línea (o cómo calcularla en ubicacion.cjs): M3 exige archivo:línea en toda falla.";
  const CORRECCION_DE_CODIGO =
    "Agregá el código a codigos.cjs (con su regla de línea en ubicacion.cjs) o usá uno existente.";

  it("una falla sin archivo ni línea se reemplaza por una falla propia en el guardián, línea 1", () => {
    const {
      archivo: _archivo,
      linea: _linea,
      ...sinUbicacion
    } = previa({ codigo: "ruta-sin-clase", motivo: "m1" });
    void _archivo;
    void _linea;
    const resultado = correr({ previas: { fallas: [sinUbicacion] } });
    expect(resultado.fallas).toStrictEqual([
      {
        codigo: "falla-sin-ubicacion",
        archivo: GUARDIAN,
        linea: 1,
        contrato: null,
        motivo:
          "Un falla con código «ruta-sin-clase» salió sin ubicación completa (archivo: undefined, línea: undefined): m1",
        correccion: CORRECCION_DE_UBICACION,
      },
    ]);
  });

  it.each([
    ["una línea 0", { linea: 0 }, '(archivo: "a.ts", línea: 0)'],
    ["una línea negativa", { linea: -3 }, '(archivo: "a.ts", línea: -3)'],
    ["una línea fraccionaria", { linea: 1.5 }, '(archivo: "a.ts", línea: 1.5)'],
    ["una línea de texto", { linea: "2" }, '(archivo: "a.ts", línea: "2")'],
  ])(
    "%s: la falla propia dice en qué archivo estaba y la cuenta mal ubicada",
    (_nombre, cambios, detalle) => {
      const resultado = correr({
        previas: {
          fallas: [
            previa({
              codigo: "ruta-sin-clase",
              motivo: "mm",
              contrato: "x-y",
              ...(cambios as object),
            }),
          ],
        },
      });
      expect(resultado.fallas).toStrictEqual([
        {
          codigo: "falla-sin-ubicacion",
          archivo: "a.ts",
          linea: 1,
          contrato: "x-y",
          motivo: `Un falla con código «ruta-sin-clase» salió sin ubicación completa ${detalle}: mm`,
          correccion: CORRECCION_DE_UBICACION,
        },
      ]);
    },
  );

  it("un archivo vacío cuenta como sin archivo: la falla propia va al guardián", () => {
    const resultado = correr({
      previas: { fallas: [previa({ codigo: "ruta-sin-clase", archivo: "" })] },
    });
    expect(resultado.fallas.map((f) => [f.codigo, f.archivo, f.linea])).toEqual([
      ["falla-sin-ubicacion", GUARDIAN, 1],
    ]);
    expect(resultado.fallas[0]?.motivo).toContain('(archivo: "", línea: 1)');
  });

  it("un código fuera de la lista cerrada se reemplaza por una falla propia que lo nombra", () => {
    const resultado = correr({
      previas: {
        fallas: [
          previa({ codigo: "inventado", archivo: "d.ts", linea: 3, contrato: "z-w", motivo: "mm" }),
        ],
      },
    });
    expect(resultado.fallas).toStrictEqual([
      {
        codigo: "codigo-fuera-de-la-lista",
        archivo: "d.ts",
        linea: 1,
        contrato: "z-w",
        motivo:
          "Un falla con código «inventado» usa un código que no está en la lista cerrada de fallas del guardián: mm",
        correccion: CORRECCION_DE_CODIGO,
      },
    ]);
  });

  it("un aviso con código de falla (o inventado) también se reemplaza, y la falla propia es una falla", () => {
    const resultado = correr({
      previas: {
        avisos: [
          previa({ codigo: "ruta-sin-clase", archivo: "d.ts", linea: 2, motivo: "x" }),
          previa({ codigo: "excepcion-por-vencer", archivo: "e.ts", linea: 2, motivo: "y" }),
        ],
      },
    });
    expect(resultado.avisos.map((a) => [a.codigo, a.archivo])).toEqual([
      ["excepcion-por-vencer", "e.ts"],
    ]);
    expect(resultado.fallas).toStrictEqual([
      {
        codigo: "codigo-fuera-de-la-lista",
        archivo: "d.ts",
        linea: 1,
        contrato: null,
        motivo:
          "Un aviso con código «ruta-sin-clase» usa un código que no está en la lista cerrada de avisos del guardián: x",
        correccion: CORRECCION_DE_CODIGO,
      },
    ]);
  });

  it("una falla con un código de AVISO tampoco pasa: la lista de fallas y la de avisos no se mezclan", () => {
    const resultado = correr({
      previas: { fallas: [previa({ codigo: "excepcion-por-vencer", motivo: "z" })] },
    });
    expect(resultado.fallas.map((f) => [f.codigo, f.motivo])).toEqual([
      [
        "codigo-fuera-de-la-lista",
        "Un falla con código «excepcion-por-vencer» usa un código que no está en la lista cerrada de fallas del guardián: z",
      ],
    ]);
  });

  it("un aviso sin ubicación se reemplaza por una falla propia que lo llama aviso", () => {
    const resultado = correr({
      previas: {
        avisos: [
          previa({ codigo: "excepcion-por-vencer", archivo: "e.ts", linea: 0, motivo: "mv" }),
        ],
      },
    });
    expect(resultado.avisos).toEqual([]);
    expect(resultado.fallas.map((f) => [f.codigo, f.archivo, f.linea, f.motivo])).toEqual([
      [
        "falla-sin-ubicacion",
        "e.ts",
        1,
        'Un aviso con código «excepcion-por-vencer» salió sin ubicación completa (archivo: "e.ts", línea: 0): mv',
      ],
    ]);
  });

  it("un hallazgo con los dos problemas da las dos fallas propias, la de ubicación primero", () => {
    const resultado = correr({
      previas: {
        fallas: [previa({ codigo: "inventado", archivo: "d.ts", linea: 0, motivo: "mm" })],
      },
    });
    expect(resultado.fallas.map((f) => [f.codigo, f.archivo, f.linea])).toEqual([
      ["codigo-fuera-de-la-lista", "d.ts", 1],
      ["falla-sin-ubicacion", "d.ts", 1],
    ]);
  });

  it("lo bien ubicado y con código válido pasa tal cual, sin duplicarse", () => {
    const buena = previa({
      codigo: "ruta-sin-clase",
      archivo: "d.ts",
      linea: 4,
      contrato: "z-w",
      motivo: "ok",
    });
    const resultado = correr({ previas: { fallas: [buena] } });
    expect(resultado.fallas).toEqual([buena]);
    expect(resultado.informe.totales["fallas"]).toBe(1);
  });
});

describe("cuando no hay nada que analizar", () => {
  const sinRutas = () =>
    ejecutar({
      rutas: [],
      leer: () => null,
      contratos: [],
      excepciones: [],
      exclusiones: [],
      ahora: AHORA,
    });

  it("la falla dice qué pasó, cómo corregirlo y apunta a la tabla de clasificación", () => {
    const { fallas } = sinRutas();
    expect(fallas).toStrictEqual([
      {
        codigo: "sin-rutas",
        archivo: REGLAS,
        linea: 1,
        contrato: null,
        motivo:
          "No hay ninguna ruta versionada para analizar: «pasó» no significa nada si no se miró nada.",
        correccion: "Corré el guardián dentro de un repositorio git con archivos versionados.",
      },
    ]);
  });

  it("la línea es la de la tabla `const NIVELES` cuando el archivo se puede leer", () => {
    const texto = readFileSync(join(RAIZ_ORIGINAL, REGLAS), "utf8");
    const linea = texto.split("\n").findIndex((renglon) => renglon.includes("const NIVELES")) + 1;
    expect(linea).toBeGreaterThan(1);
    const { fallas } = ejecutar({
      rutas: [],
      leer: (ruta) => (ruta === REGLAS ? texto : null),
      contratos: [],
      excepciones: [],
      exclusiones: [],
      ahora: AHORA,
    });
    expect(fallas[0]?.linea).toBe(linea);
  });

  it("el informe es de un análisis PARCIAL y vacío en todo lo demás", () => {
    const { informe } = sinRutas();
    expect(informe).toMatchObject({
      version: 1,
      generadoEn: "2026-10-21T12:00:00.000Z",
      resultado: "falla",
      analisisCompleto: false,
      totales: {
        rutas: 0,
        rutasClasificadas: 0,
        unidades: 0,
        unidadesDeclaradas: 0,
        contratos: 0,
        excepcionesAplicadas: 0,
        fallas: 1,
        avisos: 0,
      },
      clases: {},
      exclusiones: {},
      unidades: [],
      excepcionesAplicadas: [],
      contratosSinDetectorDeDefinicion: [],
      usosFueraDeUnidades: [],
      avisos: [],
    });
    expect(informe.reglasEjecutadas.clasificacion).toEqual([]);
    expect(informe.reglasEjecutadas.detectores).toEqual([]);
  });

  it("el informe lista cada chequeo con su descripción y su regla de línea", () => {
    const { chequeos } = sinRutas().informe.reglasEjecutadas;
    expect(chequeos.map((c) => c.codigo)).toEqual([...CODIGOS_DE_FALLA]);
    for (const chequeo of chequeos) {
      expect(chequeo.descripcion, chequeo.codigo).toBe(DESCRIPCION_DE_CODIGOS[chequeo.codigo]);
      expect(chequeo.reglaDeLinea, chequeo.codigo).toBe(REGLAS_DE_LINEA[chequeo.codigo]);
    }
    expect(chequeos[0]).toEqual({
      codigo: "sin-rutas",
      descripcion: "el repositorio tiene rutas versionadas para analizar",
      reglaDeLinea:
        "(e) clasificacion.cjs: línea de la tabla `const NIVELES` (1 si no se puede leer)",
    });
  });

  it("las fallas y avisos previos se conservan también acá", () => {
    const r = ejecutar({
      rutas: [],
      leer: () => null,
      contratos: [],
      excepciones: [],
      exclusiones: [],
      ahora: AHORA,
      previas: {
        fallas: [
          previa({
            codigo: "excepcion-invalida",
            archivo: "arquitectura/contratos/excepciones.json",
          }),
        ],
        avisos: [
          previa({
            codigo: "excepcion-por-vencer",
            archivo: "arquitectura/contratos/exclusiones.json",
          }),
        ],
      },
    });
    expect(r.fallas.map((f) => f.codigo)).toEqual(["sin-rutas", "excepcion-invalida"]);
    expect(r.avisos.map((a) => a.codigo)).toEqual(["excepcion-por-vencer"]);
    expect(r.informe.totales["avisos"]).toBe(1);
  });
});

describe("la lista de rutas", () => {
  it("se ordena y no repite: el informe cuenta cada ruta una vez y las lista en orden alfabético", () => {
    const rutas = [...Object.keys(BASE)].reverse();
    const r = ejecutar({
      rutas: [...rutas, "package.json", "scripts/migrar.ts", ...rutas],
      leer: (ruta) => BASE[ruta] ?? null,
      contratos: [],
      excepciones: [],
      exclusiones: EXCLUSIONES_BASE,
      ahora: AHORA,
    });
    expect(r.fallas).toEqual([]);
    expect(r.informe.totales["rutas"]).toBe(16);
    expect(r.informe.clases["config"]?.listaDeRutas).toEqual([
      "apps/web/contratos.json",
      "arquitectura/reglas.cjs",
      "migraciones/contratos.json",
      "package.json",
      "scripts/contratos.json",
      "src/capacidades/contratos.json",
      "src/modulos/empresas/contratos.json",
    ]);
    expect(r.informe.clases["frontend"]?.listaDeRutas).toEqual([
      "apps/web/ui/Caja.module.css",
      "apps/web/ui/tokens.css",
    ]);
  });
});

describe("una tabla de clasificación inválida no se confunde con clases vacías", () => {
  const TABLA_ROTA = [{ nombre: "roto", reglas: [{ clase: "inventada", glob: "**" }] }];
  const MOTIVO_DE_TABLA =
    "La tabla de clasificación es inválida: nivel 1: la clase «inventada» no existe (frontend, backend, migraciones, scripts, workers, generado, docs, config, pruebas).";

  it("falla por la tabla y no suma «clase sin rutas» por cada clase esperada", () => {
    const r = correr({ niveles: TABLA_ROTA });
    expect(r.fallas.map((f) => [f.codigo, f.motivo])).toEqual([
      ["regla-de-clasificacion-invalida", MOTIVO_DE_TABLA],
      [
        "excepcion-obsoleta",
        "La exclusión «excl-docs» no saca nada del análisis: la clase «docs» no tiene archivos.",
      ],
      [
        "excepcion-obsoleta",
        "La exclusión «excl-generado» no saca nada del análisis: la clase «generado» no tiene archivos.",
      ],
    ]);
  });

  it("tampoco acusa a los detectores de no haber analizado nada de una clase", () => {
    const r = correr({ niveles: TABLA_ROTA, contratos: [contrato()] });
    expect(r.fallas.map((f) => f.codigo)).toEqual([
      "regla-de-clasificacion-invalida",
      "excepcion-obsoleta",
      "excepcion-obsoleta",
    ]);
  });
});

describe("una ruta sin clase no invalida la tabla de clasificación", () => {
  it("sigue avisando de las clases esperadas que quedaron vacías", () => {
    const r = correr({
      archivos: { "herramienta/x.ts": "export {};", "test/una.test.ts": null },
    });
    expect(r.fallas.map((f) => [f.codigo, f.archivo])).toEqual([
      ["clase-sin-rutas", REGLAS],
      ["ruta-sin-clase", "herramienta/x.ts"],
    ]);
    expect(r.fallas[0]?.motivo).toContain("«pruebas»");
  });
});

describe("las exclusiones a mano en el informe", () => {
  const exclusion = (ruta: string, i: number) => ({
    id: `excl-${i}`,
    alcance: "ruta",
    ruta,
    huella: huellaDelArchivo(BASE[ruta] ?? ""),
    motivo: "Prueba",
    responsable: "Ingeniería",
    aprobadoPor: "Dueño",
    creada: "2026-10-21",
    vence: "2026-12-20",
  });

  it("cuentan las rutas excluidas de cada clase y se listan por ruta", () => {
    const una = correr({
      exclusiones: [...EXCLUSIONES_BASE, exclusion("apps/web/ui/tokens.css", 0)],
    });
    expect(una.informe.clases["frontend"]).toMatchObject({ rutas: 2, excluidas: 1 });
    expect(una.informe.clases["backend"]).toMatchObject({ rutas: 2, excluidas: 0 });
    expect(una.informe.exclusiones.porRuta.map((e) => [e.id, e.ruta])).toEqual([
      ["excl-0", "apps/web/ui/tokens.css"],
    ]);
    const dos = correr({
      exclusiones: [
        ...EXCLUSIONES_BASE,
        exclusion("apps/web/ui/tokens.css", 0),
        exclusion("apps/web/ui/Caja.module.css", 1),
      ],
    });
    expect(dos.informe.clases["frontend"]).toMatchObject({ rutas: 2, excluidas: 2 });
    expect(dos.informe.exclusiones.porRuta.map((e) => e.ruta)).toEqual([
      "apps/web/ui/tokens.css",
      "apps/web/ui/Caja.module.css",
    ]);
  });
});

describe("un detector que no analizó nada de su clase", () => {
  const miraElFrontend = (clase = "frontend") =>
    contrato({
      // La fuente está en un archivo que no es del frontend: así vaciar esa clase no suma otras fallas.
      fuenteDeVerdad: { archivo: "scripts/migrar.ts", exportacion: "export" },
      deteccion: [
        { tipo: "uso", clases: [clase], nombre: "mira la clase", reconoce: () => [] },
        definicionInerte(),
      ],
    });
  const excluirAMano = ["apps/web/ui/tokens.css", "apps/web/ui/Caja.module.css"].map((ruta, i) => ({
    id: `excl-${i}`,
    alcance: "ruta",
    ruta,
    huella: huellaDelArchivo(BASE[ruta] ?? ""),
    motivo: "Prueba",
    responsable: "Ingeniería",
    aprobadoPor: "Dueño",
    creada: "2026-10-21",
    vence: "2026-12-20",
  }));
  const frontendSinAnalizar = {
    exclusiones: [...EXCLUSIONES_BASE, ...excluirAMano],
  };

  it("falla con una clase que tiene rutas aunque no esté entre las esperadas", () => {
    const r = correr({
      contratos: [miraElFrontend()],
      clasesEsperadas: [],
      ...frontendSinAnalizar,
    });
    expect(r.fallas.map((f) => [f.codigo, f.contrato, f.motivo])).toEqual([
      [
        "detector-sin-rutas",
        "color-separador",
        "El detector «mira la clase» declara la clase «frontend» pero no analizó ni un archivo de ella (2 rutas de esa clase): «sin hallazgos» no sería un resultado.",
      ],
    ]);
  });

  it("falla con una clase esperada que quedó sin rutas (y también avisa que la clase quedó vacía)", () => {
    const r = correr({
      contratos: [miraElFrontend()],
      archivos: { "apps/web/ui/tokens.css": null, "apps/web/ui/Caja.module.css": null },
    });
    expect(r.fallas.map((f) => [f.codigo, f.motivo])).toEqual([
      [
        "clase-sin-rutas",
        "La clase «frontend» no tiene ninguna ruta, y este repositorio debería tener archivos de esa clase: el análisis no cubrió nada de ella.",
      ],
      [
        "detector-sin-rutas",
        "El detector «mira la clase» declara la clase «frontend» pero no analizó ni un archivo de ella (0 rutas de esa clase): «sin hallazgos» no sería un resultado.",
      ],
    ]);
  });

  it("no falla con una clase que no se espera y no tiene rutas", () => {
    const r = correr({ contratos: [miraElFrontend("workers")] });
    expect(r.informe.clases["workers"]).toMatchObject({ rutas: 0, esperada: false });
    expect(r.fallas).toEqual([]);
  });

  it("sí falla con la misma clase vacía cuando se la declara esperada", () => {
    const r = correr({
      contratos: [miraElFrontend("workers")],
      clasesEsperadas: [
        "workers",
        "frontend",
        "backend",
        "migraciones",
        "scripts",
        "generado",
        "docs",
        "config",
        "pruebas",
      ],
    });
    expect(r.fallas.map((f) => f.codigo)).toEqual(["clase-sin-rutas", "detector-sin-rutas"]);
  });

  it("no falla si el detector sí analizó archivos de la clase", () => {
    expect(correr({ contratos: [contrato()], clasesEsperadas: [] }).fallas).toEqual([]);
  });
});

describe("un registro roto", () => {
  const ROTO = [contrato({ protege: "" })];

  it("el informe no inventa contratos, detectores ni excepciones", () => {
    const { informe, fallas } = correr({ contratos: ROTO });
    expect(fallas.map((f) => [f.codigo, f.archivo, f.contrato])).toEqual([
      ["registro-invalido", "arquitectura/contratos/contratos.cjs", null],
    ]);
    expect(informe.totales).toEqual({
      rutas: 16,
      rutasClasificadas: 16,
      unidades: 5,
      unidadesDeclaradas: 5,
      contratos: 0,
      excepcionesAplicadas: 0,
      fallas: 1,
      avisos: 0,
    });
    expect(informe.analisisCompleto).toBe(true);
    expect(informe.reglasEjecutadas.detectores).toEqual([]);
    expect(informe.excepcionesAplicadas).toEqual([]);
    expect(informe.contratosSinDetectorDeDefinicion).toEqual([]);
    expect(informe.usosFueraDeUnidades).toEqual([]);
    for (const clase of Object.values(informe.clases)) {
      expect(clase.analizadasPorDetectores).toBe(0);
      expect(clase.binariasOmitidas).toBe(0);
    }
  });

  it("las unidades se leen igual, sin comprobar que sus ids existan", () => {
    const { fallas } = correr({
      contratos: ROTO,
      archivos: {
        "apps/web/contratos.json": JSON.stringify({ usa: ["no-existe-en-ningun-registro"] }),
      },
    });
    expect(fallas.map((f) => f.codigo)).toEqual(["registro-invalido"]);
  });

  it("un error que no es del registro (un contrato que explota al leerlo) no se esconde", () => {
    const explosivo = {
      get id(): string {
        throw new Error("boom del contrato");
      },
    };
    expect(() => correr({ contratos: [explosivo] })).toThrow("boom del contrato");
  });
});

describe("el informe cuando todo se analizó", () => {
  it("cuenta rutas, unidades, declaraciones y contratos, y marca el análisis como completo", () => {
    const { informe } = correr({ contratos: [contrato(), contratoDeRadio()] });
    expect(informe).toMatchObject({
      version: 1,
      generadoEn: "2026-10-21T12:00:00.000Z",
      resultado: "pasa",
      analisisCompleto: true,
      totales: {
        rutas: 16,
        rutasClasificadas: 16,
        unidades: 5,
        unidadesDeclaradas: 5,
        contratos: 2,
        excepcionesAplicadas: 0,
        fallas: 0,
        avisos: 0,
      },
      excepcionesAplicadas: [],
      usosFueraDeUnidades: [],
      contratosSinDetectorDeDefinicion: [],
    });
    expect(informe.unidades.map((u) => [u.unidad, u.archivos])).toEqual([
      ["apps/web", 3],
      ["migraciones", 2],
      ["scripts", 2],
      ["src/capacidades", 2],
      ["src/modulos/empresas", 2],
    ]);
    expect(informe.unidades[0]?.declaracion).toEqual({ usa: [], noUsa: "Sin contratos todavía." });
  });

  it("de cada clase dice cuántas rutas tiene, cuántas están sin unidad y cuáles se excluyeron", () => {
    const { informe } = correr();
    const resumen = Object.fromEntries(
      Object.entries(informe.clases).map(([clase, c]) => [
        clase,
        [c.rutas, c.sinUnidad, c.excluidas, c.exclusionPorClase, c.esperada],
      ]),
    );
    expect(resumen).toEqual({
      frontend: [2, 0, 0, null, true],
      backend: [2, 0, 0, null, true],
      migraciones: [1, 0, 0, null, true],
      scripts: [1, 0, 0, null, true],
      workers: [0, 0, 0, null, false],
      generado: [1, 1, 1, "excl-generado", true],
      docs: [1, 1, 1, "excl-docs", true],
      config: [7, 2, 0, null, true],
      pruebas: [1, 1, 0, null, true],
    });
    expect(informe.exclusiones.porClase.map((e) => e.id)).toEqual(["excl-generado", "excl-docs"]);
    expect(informe.exclusiones.porRuta).toEqual([]);
  });

  it("lista los detectores ejecutados y cuántos archivos leyeron (y omitieron por binarios) por clase", () => {
    const { informe } = correr({
      contratos: [contrato()],
      archivos: { "apps/web/ui/icono.png": "binario" },
    });
    expect(informe.reglasEjecutadas.detectores).toEqual([
      {
        contrato: "color-separador",
        detector: "uso de la variable",
        tipo: "uso",
        clases: ["frontend", "backend"],
      },
      {
        contrato: "color-separador",
        detector: "definición de la variable",
        tipo: "definicion",
        clases: ["frontend"],
      },
    ]);
    expect(informe.clases["frontend"]).toMatchObject({
      rutas: 3,
      analizadasPorDetectores: 2,
      binariasOmitidas: 1,
    });
    expect(informe.clases["backend"]).toMatchObject({
      rutas: 2,
      analizadasPorDetectores: 2,
      binariasOmitidas: 0,
    });
    expect(informe.clases["pruebas"]).toMatchObject({
      analizadasPorDetectores: 0,
      binariasOmitidas: 0,
    });
  });

  it("deja a la vista los contratos que declaran no poder tener un detector de definición", () => {
    const soloUso = porPatron({
      tipo: "uso",
      clases: ["frontend"],
      patron: /var\(--radio\)/,
      nombre: "uso del radio",
    });
    const motivo = "El valor lo calcula un servicio externo y no se escribe en ningún archivo.";
    const { informe } = correr({
      contratos: [
        contrato(),
        contratoDeRadio({ deteccion: [soloUso], sinDetectorDeDefinicion: motivo }),
      ],
    });
    expect(informe.contratosSinDetectorDeDefinicion).toEqual([{ contrato: "radio-unico", motivo }]);
    expect(informe.totales["contratos"]).toBe(2);
  });

  it("cuenta las excepciones aplicadas y las lista", () => {
    const ruta = "apps/web/ui/Linea.module.css";
    const resultado = correr({
      contratos: [contrato()],
      archivos: { [ruta]: `${LINEA_DE_USO}\n` },
      excepciones: [
        {
          id: "exc-1",
          contrato: "color-separador",
          ruta,
          huella: huellaDe(LINEA_DE_USO),
          motivo: "Migración pendiente: el componente viejo se reemplaza en el próximo sprint.",
          responsable: "Ingeniería",
          aprobadoPor: "Dueño",
          creada: "2026-10-21",
          vence: "2026-12-20",
        },
      ],
    });
    expect(resultado.fallas).toEqual([]);
    expect(resultado.informe.totales["excepcionesAplicadas"]).toBe(1);
    expect(resultado.informe.excepcionesAplicadas.map((e) => e.id)).toEqual(["exc-1"]);
  });

  it("los usos en archivos que no son de ninguna unidad figuran aparte", () => {
    const { informe } = correr({
      contratos: [
        contrato({
          deteccion: [
            porPatron({ tipo: "uso", clases: ["config"], patron: /"name"/, nombre: "usa name" }),
            definicionInerte(),
          ],
        }),
      ],
      archivos: { "package.json": '{\n  "name": "x"\n}\n' },
    });
    expect(informe.usosFueraDeUnidades).toHaveLength(1);
    expect(informe.usosFueraDeUnidades[0]).toMatchObject({ archivo: "package.json", linea: 2 });
  });

  it("el informe reproduce las reglas de clasificación aplicadas", () => {
    const { informe } = correr();
    expect(informe.reglasEjecutadas.clasificacion.length).toBeGreaterThan(10);
    expect(informe.reglasEjecutadas.clasificacion.every((r) => typeof r.glob === "string")).toBe(
      true,
    );
  });
});

describe("el orden de lo analizado no depende del orden de entrada", () => {
  it("dos órdenes de las mismas rutas dan el mismo informe", () => {
    const { archivos: _archivos, ...a } = correr();
    void _archivos;
    const claves = Object.keys(BASE);
    const alReves = Object.fromEntries(claves.reverse().map((k) => [k, BASE[k]!]));
    const b = ejecutar({
      rutas: Object.keys(alReves),
      leer: (ruta) => alReves[ruta] ?? null,
      contratos: [],
      excepciones: [],
      exclusiones: EXCLUSIONES_BASE,
      ahora: AHORA,
    });
    expect(b).toEqual(a);
  });
});
