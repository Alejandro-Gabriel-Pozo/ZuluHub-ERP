import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { CODIGOS_DE_FALLA, formatearFalla, type Falla } from "./guardian-apoyo";
import {
  APLICADORES,
  CODIGOS_DE_MECANISMO,
  CONTRATO_A,
  IDS_DE_INVARIANTES,
  INVARIANTES,
  OBJETIVOS,
  PRUEBAS_DEL_GUARDIAN,
  SALTOS_PERMITIDOS,
  TIPOS_DE_MUTACION,
  comprobarMatriz,
  correrElCanario,
  cumpleLoEsperado,
  defectosDeUbicacion,
  ejecutarMundo,
  escanearPruebasDelGuardian,
  evaluarCanario,
  huecosAbiertos,
  leerPruebasDelGuardian,
  leerReal,
  mundoConExcepcionVigente,
  mundoSano,
  resolverLinea,
  veredicto,
  verificarInformeDeEvidencia,
  verificarScriptsDeArquitectura,
  verificarVitestConfig,
  verificarWorkflowDeCi,
  type Corrida,
  type Esperado,
  type Invariante,
  type Mundo,
  type Mutacion,
} from "./guardian-matriz-apoyo";

/**
 * MATRIZ DE INVARIANTES (contratos-arquitectonicos.md §4). El catálogo (`arquitectura/contratos/
 * invariantes.cjs`) dice, por cada invariante de G1 (I1 a I10), qué mutaciones lo atacan y qué tiene que
 * pasar; acá se aplica cada una sobre un repositorio sintético (o sobre una copia en memoria de
 * package.json, ci.yml, vitest.config.ts, las pruebas del guardián o el propio catálogo) y se exige que
 * el guardián, o el verificador del mecanismo, FALLE como se declaró. Una mutación que sobrevive es un
 * hueco y esta prueba falla. No repite las pruebas unitarias del guardián: es la capa de invariantes.
 *
 * Esta prueba no puede saltarse a sí misma: M4 escanea `guardian-*.test.ts` (incluida esta) y no admite
 * saltos fuera de la lista de `SALTOS_PERMITIDOS`. Por eso acá no hay ninguno.
 */

const require = createRequire(import.meta.url);
const REGISTRO_REAL = require("../../arquitectura/contratos/contratos.cjs") as unknown[];

// Cada mutación se aplica una sola vez por corrida de pruebas y el resultado se comparte.
const memoria = new Map<string, Corrida>();
function aplicar(id: string): Corrida {
  const guardada = memoria.get(id);
  if (guardada !== undefined) return guardada;
  const aplicador = APLICADORES[id];
  if (aplicador === undefined) throw new Error(`la mutación ${id} no tiene aplicador`);
  const corrida = aplicador();
  memoria.set(id, corrida);
  return corrida;
}

const todas = INVARIANTES.flatMap((invariante) =>
  invariante.mutaciones.map((mutacion) => ({ invariante, mutacion })),
);
const ejecutables = todas.filter(({ mutacion }) => mutacion.noAplica === undefined);
const textoDelCatalogo = leerReal("arquitectura/contratos/invariantes.cjs");

/** Los problemas de la matriz real, o de una copia alterada, con los códigos de guardián y mecanismo. */
const problemasDe = (
  invariantes: readonly object[] = INVARIANTES,
  cambios: { codigosDeFalla?: readonly string[]; idsConAplicador?: string[] } = {},
) =>
  comprobarMatriz({
    invariantes,
    codigosDeFalla: cambios.codigosDeFalla ?? CODIGOS_DE_FALLA,
    idsConAplicador: cambios.idsConAplicador ?? Object.keys(APLICADORES),
    texto: textoDelCatalogo,
  });
const codigosDe = (problemas: { codigo: string }[]) => problemas.map((p) => p.codigo);

describe("base: el repositorio sintético sano pasa", () => {
  it("dos contratos reales de ejemplo, tres unidades que los usan y declaran: sin fallas ni avisos", () => {
    const resultado = ejecutarMundo(mundoSano());
    expect(resultado.fallas).toEqual([]);
    expect(resultado.avisos).toEqual([]);
    expect(resultado.informe.resultado).toBe("pasa");
    expect(resultado.informe.totales["contratos"]).toBe(2);
    const declaraciones = Object.fromEntries(
      resultado.informe.unidades.map((u) => [u.unidad, u.declaracion]),
    );
    expect(declaraciones["apps/web"]).toEqual({ usa: [CONTRATO_A, "radio-unico"], noUsa: null });
    expect(declaraciones["src/modulos/empresas"]).toEqual({ usa: [CONTRATO_A], noUsa: null });
    const detectores = resultado.informe.reglasEjecutadas.detectores.filter(
      (d) => d.contrato === CONTRATO_A,
    );
    expect(detectores.map((d) => d.tipo).sort()).toEqual(["definicion", "uso"]);
  });

  it("el uso real está detectado de verdad (no pasa por no mirar nada)", () => {
    const { informe } = ejecutarMundo(mundoSano());
    expect(informe.clases["frontend"]?.analizadasPorDetectores).toBeGreaterThanOrEqual(3);
    expect(informe.clases["backend"]?.analizadasPorDetectores).toBeGreaterThanOrEqual(2);
    expect(informe.usosFueraDeUnidades).toEqual([]);
  });

  it("con una excepción vigente que silencia un uso también pasa (base de I5)", () => {
    const resultado = ejecutarMundo(mundoConExcepcionVigente());
    expect(resultado.fallas).toEqual([]);
    expect(resultado.informe.excepcionesAplicadas.map((e) => e.id)).toEqual(["exc-1"]);
  });

  it("el informe del sano trae evidencia: rutas analizadas, clases y reglas ejecutadas", () => {
    expect(verificarInformeDeEvidencia(ejecutarMundo(mundoSano()).informe)).toEqual([]);
  });

  it("el canario aprueba al guardián real: sale distinto de 0 y diagnostica archivo:línea", () => {
    expect(correrElCanario()).toEqual([]);
  });

  it("el package.json, el ci.yml, el vitest.config.ts y las pruebas reales cumplen", () => {
    expect(verificarScriptsDeArquitectura(leerReal("package.json"))).toEqual([]);
    expect(verificarWorkflowDeCi(leerReal(".github/workflows/ci.yml"))).toEqual([]);
    expect(verificarVitestConfig(leerReal("vitest.config.ts"))).toEqual([]);
    expect(escanearPruebasDelGuardian(leerPruebasDelGuardian())).toEqual([]);
  });
});

describe("el catálogo", () => {
  it("cubre los diez invariantes de G1 (I1 a I10), con enunciado y elementos", () => {
    expect(INVARIANTES.map((i) => i.id)).toEqual([...IDS_DE_INVARIANTES]);
    for (const invariante of INVARIANTES) {
      expect(invariante.enunciado.length, invariante.id).toBeGreaterThan(10);
      for (const clave of ["aplica", "define", "parametriza", "hacePosible"]) {
        expect(invariante.elementos[clave]?.length, `${invariante.id}.${clave}`).toBeGreaterThan(0);
      }
    }
  });

  it("todo `esperado` apunta a un objetivo conocido y todo objetivo tiene aplicador", () => {
    for (const { mutacion } of ejecutables) {
      expect(OBJETIVOS, mutacion.id).toContain(mutacion.objetivo);
      expect(APLICADORES[mutacion.id], mutacion.id).toBeTypeOf("function");
    }
  });

  it("las mutaciones del documento (§4) están todas representadas", () => {
    // Una por cada renglón de la tabla de invariantes del documento, por su id.
    const delDocumento: Record<string, string[]> = {
      I1: [
        "I1-quitar-la-regla-de-una-carpeta",
        "I1-duplicar-la-regla-con-otra-clase",
        "I1-mover-codigo-fuera-de-las-reglas",
        "I1-renombrar-una-carpeta",
        "I1-clase-que-se-ignora-sin-exclusion",
        "I1-vaciar-una-clase-esperada",
      ],
      I2: [
        "I2-borrar-la-declaracion",
        "I2-noUsa-vacio",
        "I2-usa-y-noUsa-a-la-vez",
        "I2-unidad-nueva-sin-declaracion",
        "I2-id-inexistente",
      ],
      I3: [
        "I3-quitar-el-id-de-usa",
        "I3-declarar-sin-uso",
        "I3-noUsa-con-uso-real",
        "I3-vaciar-el-detector",
        "I3-desconectar-el-detector-de-las-clases-del-uso",
        "I3-mover-el-uso-a-una-clase-no-mirada",
      ],
      I4: [
        "I4-copiar-el-valor-en-otro-archivo",
        "I4-borrar-la-fuente",
        "I4-cambiar-la-exportacion",
        "I4-segunda-definicion-en-otra-unidad",
      ],
      I5: [
        "I5-vencida",
        "I5-mas-de-60-dias",
        "I5-creada-en-el-futuro",
        "I5-la-huella-ya-no-coincide",
        "I5-comodin-en-la-ruta",
        "I5-campo-faltante",
        "I5-excepcion-obsoleta",
        "I5-ampliar-el-alcance-a-otra-linea-igual",
      ],
      I6: [
        "I6-excluir-una-clase-no-permitida",
        "I6-exclusion-sin-motivo",
        "I6-exclusion-sin-aprobacion",
        "I6-exclusion-vencida",
        "I6-vaciar-las-exclusiones",
      ],
      I7: [
        "I7-repositorio-sin-archivos",
        "I7-clase-esperada-vacia",
        "I7-informe-sin-reglas-ejecutadas",
      ],
      I8: [
        "I8-campo-del-contrato-faltante",
        "I8-contrato-borrado-con-unidades-que-lo-declaran",
        "I8-contrato-borrado-junto-con-todas-sus-declaraciones",
      ],
      I9: [
        "I9-quitar-guardian-del-script-arquitectura",
        "I9-quitar-un-job-de-needs",
        "I9-continue-on-error",
        "I9-job-con-if-false",
        "I9-quitar-el-tope-de-tiempo",
        "I9-guardian-que-sale-0-sin-analizar",
        "I9-borrar-una-prueba-del-guardian",
        "I9-saltar-una-prueba-del-guardian",
      ],
      I10: [
        "I10-quitar-las-mutaciones-de-un-tipo",
        "I10-agregar-un-codigo-sin-invariante",
        "I10-saltar-la-matriz",
        "I10-excluir-la-matriz-en-vitest",
      ],
    };
    for (const [id, ids] of Object.entries(delDocumento)) {
      const declaradas = INVARIANTES.find((i) => i.id === id)?.mutaciones.map((m) => m.id) ?? [];
      for (const mutacion of ids) expect(declaradas, `${id}: ${mutacion}`).toContain(mutacion);
    }
  });
});

describe("meta-invariantes M1, M2 y M5 sobre la matriz real", () => {
  it("M1: cada código de falla del guardián y de los verificadores pertenece a un invariante y tiene una mutación que lo espera", () => {
    const problemas = problemasDe().filter((p) => /codigo-sin|codigo-desconocido/.test(p.codigo));
    expect(problemas.map((p) => p.motivo)).toEqual([]);
    const nombrados = new Set(INVARIANTES.flatMap((i) => i.codigosDeFalla));
    for (const codigo of [...CODIGOS_DE_FALLA, ...CODIGOS_DE_MECANISMO]) {
      expect(nombrados.has(codigo), codigo).toBe(true);
    }
  });

  it("M2: cada invariante tiene mutaciones de cada tipo o un noAplica con motivo escrito", () => {
    expect(problemasDe().filter((p) => /sin-tipos|noaplica/.test(p.codigo))).toEqual([]);
    for (const invariante of INVARIANTES) {
      for (const tipo of TIPOS_DE_MUTACION) {
        expect(
          invariante.mutaciones.some((m) => m.tipo === tipo),
          `${invariante.id} · ${tipo}`,
        ).toBe(true);
      }
      for (const m of invariante.mutaciones.filter((x) => x.noAplica !== undefined)) {
        expect(m.noAplica?.trim().length, m.id).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("M5: cada id de mutación es único y cada mutación declarada tiene su aplicador", () => {
    expect(
      problemasDe().filter((p) => /id-repetido|sin-aplicador|huerfano/.test(p.codigo)),
    ).toEqual([]);
    const ids = todas.map(({ mutacion }) => mutacion.id);
    expect(new Set(ids).size).toBe(ids.length);
    const conAplicador = new Set(Object.keys(APLICADORES));
    for (const { mutacion } of ejecutables)
      expect(conAplicador.has(mutacion.id), mutacion.id).toBe(true);
    expect([...conAplicador].filter((id) => !ids.includes(id))).toEqual([]);
  });

  it("toda la matriz real está completa y conectada (sin ningún problema)", () => {
    expect(problemasDe()).toEqual([]);
  });
});

/** Un renglón de la matriz por mutación: se aplica, se corre el guardián y se exige lo declarado. */
for (const invariante of INVARIANTES) {
  describe(`${invariante.id} · ${invariante.enunciado}`, () => {
    for (const mutacion of invariante.mutaciones) {
      const rotulo = `${mutacion.id} [${mutacion.tipo}]`;
      if (mutacion.noAplica !== undefined) {
        it(`${rotulo}: no aplica, con motivo escrito`, () => {
          expect(mutacion.noAplica?.trim().length).toBeGreaterThanOrEqual(20);
          expect(mutacion.esperado).toBeUndefined();
          expect(APLICADORES[mutacion.id], "un noAplica no lleva aplicador").toBeUndefined();
        });
        continue;
      }
      const esperado = mutacion.esperado as Esperado;
      if (mutacion.pendiente !== undefined) {
        it(`HUECO ABIERTO · ${rotulo}: sigue sin detectarse (${mutacion.pendiente.slice(0, 60)}…)`, () => {
          const corrida = aplicar(mutacion.id);
          const resultado = veredicto(esperado, corrida);
          expect(
            resultado.cumple,
            `El hueco «${mutacion.id}» YA SE CERRÓ: el guardián ahora lo detecta. Sacá la marca ` +
              "`pendiente` de la mutación en arquitectura/contratos/invariantes.cjs. " +
              resultado.detalle,
          ).toBe(false);
          for (const salida of corrida.salidas) {
            expect(
              defectosDeUbicacion(salida, mutacion.objetivo === "repo"),
              salida.codigo,
            ).toEqual([]);
          }
        });
        continue;
      }
      it(`${rotulo}: ${mutacion.descripcion ?? ""}`, () => {
        const corrida = aplicar(mutacion.id);
        const resultado = veredicto(esperado, corrida);
        expect(resultado.cumple, `SOBREVIVIÓ: ${resultado.detalle}`).toBe(true);
        // M3: toda falla trae archivo, línea entera desde 1, motivo y corrección (y contrato si es del guardián).
        for (const salida of corrida.salidas) {
          expect(defectosDeUbicacion(salida, mutacion.objetivo === "repo"), salida.codigo).toEqual(
            [],
          );
        }
        if (esperado.pasa === true) return;
        // El diagnóstico esperado, completo: archivo:línea · contrato · motivo · corrección.
        const dicha = corrida.salidas.find((s) => cumpleLoEsperado(esperado, s, corrida.textos));
        expect(dicha).toBeDefined();
        if (mutacion.objetivo === "repo" && dicha !== undefined) {
          const impresa = formatearFalla(dicha as Falla);
          expect(impresa.startsWith(`${dicha.archivo}:${String(dicha.linea)} · `)).toBe(true);
          expect(impresa.split(" · ").length).toBeGreaterThanOrEqual(4);
          if (esperado.contrato !== undefined)
            expect(impresa).toContain(` · ${esperado.contrato} · `);
        }
      });
    }
  });
}

describe("lo que la matriz muestra como hueco o como «analiza más»", () => {
  it("los huecos abiertos son exactamente los declarados: ni uno cerrado sin sacar la marca ni uno nuevo sin aviso", () => {
    expect(huecosAbiertos().map((h) => h.mutacion)).toEqual([
      "I1-reclasificar-codigo-como-documentacion",
      "I4-quitar-el-detector-de-definicion",
      "I8-contrato-borrado-junto-con-todas-sus-declaraciones",
    ]);
    for (const hueco of huecosAbiertos()) {
      expect(hueco.motivo.length, hueco.mutacion).toBeGreaterThan(40);
      expect(aplicar(hueco.mutacion).salidas, hueco.mutacion).toEqual([]);
    }
  });

  it("I6: vaciar exclusiones.json no es una falla, pero SÍ analiza más (clase docs y generado)", () => {
    const antes = ejecutarMundo(mundoSano()).informe;
    const m = mundoSano();
    m.exclusiones = [];
    const despues = ejecutarMundo(m).informe;
    expect(antes.clases["docs"]?.excluidas).toBe(antes.clases["docs"]?.rutas);
    expect(despues.clases["docs"]?.excluidas).toBe(0);
    expect(despues.clases["generado"]?.excluidas).toBe(0);
    expect(despues.exclusiones.porClase).toEqual([]);
    expect(despues.resultado).toBe("pasa");
  });
});

describe("(c) mutaciones sobre el propio guardián: la elusión no pasa", () => {
  it("un guardian.cjs que sale 0 sin analizar lo detecta el canario", () => {
    const codigos = codigosDe(aplicar("I9-guardian-que-sale-0-sin-analizar").salidas);
    expect(codigos).toEqual(["canario-pasa-un-repo-roto"]);
  });

  it("un guardián que rechaza sin decir archivo:línea tampoco pasa el canario", () => {
    expect(codigosDe(aplicar("I9-guardian-que-rechaza-sin-diagnostico").salidas)).toEqual([
      "canario-sin-diagnostico",
    ]);
  });

  it("un guardián real con un chequeo apagado no diagnostica el repo roto conocido", () => {
    const [problema] = aplicar("I9-guardian-que-no-ve-las-rutas-sin-clase").salidas;
    expect(problema?.codigo).toBe("canario-sin-diagnostico");
    expect(problema?.motivo).toContain("herramienta-sin-clase/x.ts:1");
  });

  it("evaluarCanario: sin estado (el guardián no terminó) o con otra salida, también se rechaza", () => {
    const esperadas = [{ archivo: "a.ts", linea: 1 }];
    expect(
      evaluarCanario(
        { estado: 1, salidaDeError: "FALLA a.ts:1 · - · m · c\n" },
        esperadas,
        "g.cjs",
      ),
    ).toEqual([]);
    expect(evaluarCanario({ estado: null, salidaDeError: "" }, esperadas, "g.cjs")[0]?.codigo).toBe(
      "canario-sin-diagnostico",
    );
    expect(
      evaluarCanario(
        { estado: 2, salidaDeError: "FALLA a.ts:2 · - · m · c\n" },
        esperadas,
        "g.cjs",
      )[0]?.codigo,
    ).toBe("canario-sin-diagnostico");
    expect(
      evaluarCanario(
        { estado: 0, salidaDeError: "FALLA a.ts:1 · - · m · c\n" },
        esperadas,
        "g.cjs",
      )[0]?.codigo,
    ).toBe("canario-pasa-un-repo-roto");
  });

  it("vaciar el registro de contratos REAL mientras unidades declaran `usa` hace fallar al guardián", () => {
    expect(REGISTRO_REAL).toEqual([]);
    const m = mundoSano();
    m.contratos = REGISTRO_REAL as Mundo["contratos"];
    const { fallas } = ejecutarMundo(m);
    const huerfanas = fallas.filter((f) => f.codigo === "declara-contrato-inexistente");
    expect(huerfanas.map((f) => f.archivo).sort()).toEqual([
      "apps/web/contratos.json",
      "apps/web/contratos.json",
      "src/modulos/empresas/contratos.json",
    ]);
    for (const falla of huerfanas) expect(falla.linea).toBeGreaterThanOrEqual(3);
  });

  describe("el script `arquitectura` del package.json real", () => {
    it("con `&& npm run guardian` pasa y sin él falla, con archivo y línea de la clave", () => {
      const real = leerReal("package.json");
      expect(verificarScriptsDeArquitectura(real)).toEqual([]);
      const alterado = real.replace(" && npm run guardian", "");
      expect(alterado).not.toBe(real);
      const [problema] = verificarScriptsDeArquitectura(alterado);
      expect(problema?.codigo).toBe("script-arquitectura-sin-guardian");
      expect(problema?.archivo).toBe("package.json");
      expect(problema?.linea).toBe(resolverLinea(alterado, '"arquitectura":'));
    });

    it("tampoco vale encadenarlo con `||`, `;` o `|`", () => {
      const real = leerReal("package.json");
      for (const union of [" || ", " ; ", " | "]) {
        const alterado = real.replace(" && npm run guardian", `${union}npm run guardian`);
        expect(
          verificarScriptsDeArquitectura(alterado).map((p) => p.codigo),
          union,
        ).toContain("script-arquitectura-sin-guardian");
      }
    });

    it("un package.json sin scripts o ilegible se rechaza", () => {
      expect(codigosDe(verificarScriptsDeArquitectura("{}"))).toEqual([
        "script-arquitectura-sin-guardian",
        "script-guardian-debilitado",
        "script-gate-sin-arquitectura",
        "script-test-sin-proyecto-node",
      ]);
      expect(codigosDe(verificarScriptsDeArquitectura("{ no es json"))).toEqual([
        "package-json-ilegible",
      ]);
    });
  });

  describe("pruebas del guardián: ninguna saltada, pendiente, exclusiva ni excluida", () => {
    it("los saltos permitidos son exactamente los tres de «sin .git», y existen tal cual", () => {
      // Las líneas se arman con piezas: el escaneo de ESTE archivo no las tiene que tomar por saltos.
      const si = "skip" + "If";
      expect(SALTOS_PERMITIDOS.map((s) => `${s.archivo} · ${s.linea}`)).toEqual([
        `guardian-nucleo.test.ts · const describeConGit = describe.${si}(SIN_GIT);`,
        `guardian-nucleo.test.ts · const itConGit = it.${si}(SIN_GIT);`,
        `guardian-clasificacion.test.ts · const describeConGit = describe.${si}(!HAY_GIT);`,
      ]);
      const archivos = leerPruebasDelGuardian();
      for (const salto of SALTOS_PERMITIDOS) {
        const lineas = (archivos[salto.archivo] ?? "").split("\n").map((l) => l.trim());
        expect(lineas, salto.linea).toContain(salto.linea);
        if (salto.requiere !== null) expect(lineas, salto.requiere).toContain(salto.requiere);
      }
    });

    it("el escaneo reconoce cada forma de saltar (y no se confunde con `[...todo]` ni con `.each`)", () => {
      const formas = [
        ["it", "skip"],
        ["describe", "skip"],
        ["test", "todo"],
        ["it", "only"],
        ["describe", "only"],
        ["it", "skipIf"],
        ["describe", "runIf"],
        ["it", "concurrent.skip"],
        ["it", "fails"],
      ].map(([bloque, modo]) => `${bloque}.${modo}("x", () => {});`);
      // Se arman con piezas para que el escaneo de ESTE archivo no los tome por saltos reales.
      formas.push(
        `${"x" + "it"}("x", () => {});`,
        `${"f" + "describe"}("x", () => {});`,
        `${"ctx"}${".sk" + "ip"}();`,
      );
      for (const forma of formas) {
        const archivos = { ...leerPruebasDelGuardian(), "guardian-nucleo.test.ts": `${forma}\n` };
        expect(
          escanearPruebasDelGuardian(archivos).some(
            (p) => p.codigo === "prueba-saltada" && p.archivo.endsWith("guardian-nucleo.test.ts"),
          ),
          forma,
        ).toBe(true);
      }
      const inocentes = [
        'const ruta = "apps/web/app/(entrada)/[...todo]/page.tsx";',
        'it.each(["a"])("x %s", () => {});',
        'describe("x", () => {});',
      ].join("\n");
      const limpio = { ...leerPruebasDelGuardian(), "guardian-nucleo.test.ts": inocentes };
      expect(escanearPruebasDelGuardian(limpio)).toEqual([]);
    });

    it("las pruebas reales incluyen esta matriz y todas las que el mecanismo exige", () => {
      const archivos = leerPruebasDelGuardian();
      for (const nombre of PRUEBAS_DEL_GUARDIAN) expect(archivos[nombre], nombre).toBeDefined();
      expect(Object.keys(archivos)).toContain("guardian-matriz.test.ts");
    });

    it("vitest.config.ts real no excluye las pruebas del guardián, y alterado sí falla", () => {
      const real = leerReal("vitest.config.ts");
      expect(real).toContain('"test/**/*.test.ts"');
      expect(verificarVitestConfig(real)).toEqual([]);
      for (const mutacion of [
        "I9-excluir-las-pruebas-del-guardian-en-vitest",
        "I10-excluir-la-matriz-en-vitest",
        "I9-vitest-deja-de-incluir-test",
      ]) {
        expect(aplicar(mutacion).salidas.length, mutacion).toBeGreaterThan(0);
      }
      const sinPruebasVacias = real.replace("test: {", "test: {\n    passWithNoTests: true,");
      expect(codigosDe(verificarVitestConfig(sinPruebasVacias))).toContain(
        "vitest-excluye-pruebas",
      );
    });
  });

  describe("el ci.yml real: el guardián y las pruebas bloquean", () => {
    it("el real pasa y cada alteración falla en su línea", () => {
      expect(verificarWorkflowDeCi(leerReal(".github/workflows/ci.yml"))).toEqual([]);
      for (const id of [
        "I9-quitar-un-job-de-needs",
        "I9-continue-on-error",
        "I9-job-con-if-false",
        "I9-quitar-el-tope-de-tiempo",
        "I9-ningun-trabajo-corre-el-guardian",
        "I9-comando-que-nunca-falla",
        "I9-gate-sin-always",
        "I9-renombrar-el-gate",
      ]) {
        expect(aplicar(id).salidas.length, id).toBeGreaterThan(0);
      }
    });

    it("un workflow sin trabajos ni gate se rechaza", () => {
      expect(codigosDe(verificarWorkflowDeCi("name: CI\n"))).toEqual(["ci-sin-job-gate"]);
    });
  });
});

describe("(d) meta-invariantes: M3 y M4", () => {
  it("M3: toda falla de TODAS las mutaciones trae archivo y línea entera ≥ 1 (sin guion)", () => {
    let revisadas = 0;
    for (const { mutacion } of ejecutables) {
      for (const salida of aplicar(mutacion.id).salidas) {
        revisadas += 1;
        expect(
          defectosDeUbicacion(salida, mutacion.objetivo === "repo"),
          `${mutacion.id} · ${salida.codigo}`,
        ).toEqual([]);
        expect(Number.isInteger(salida.linea) && (salida.linea ?? 0) >= 1).toBe(true);
      }
    }
    expect(revisadas).toBeGreaterThan(ejecutables.length);
  });

  it("M4: ninguna prueba de la matriz ni del guardián está saltada, pendiente ni excluida", () => {
    expect(escanearPruebasDelGuardian(leerPruebasDelGuardian())).toEqual([]);
    expect(verificarVitestConfig(leerReal("vitest.config.ts"))).toEqual([]);
    for (const id of [
      "I10-saltar-la-matriz",
      "I9-saltar-una-prueba-del-guardian",
      "I9-prueba-del-guardian-pendiente",
      "I9-prueba-del-guardian-exclusiva",
      "I9-saltar-con-una-condicion-nueva",
      "I9-constante-de-salto-forzada",
      "I9-borrar-una-prueba-del-guardian",
    ]) {
      expect(aplicar(id).salidas.length, id).toBeGreaterThan(0);
    }
  });

  it("M4: el trabajo `pruebas` del CI corre `npm test`, que corre el proyecto de Node", () => {
    const ci = leerReal(".github/workflows/ci.yml");
    expect(ci).toMatch(/- run: npm test\n/);
    expect(leerReal("package.json")).toContain('"test": "vitest run --project node"');
  });
});

describe("resistencia de la matriz misma", () => {
  it("quitar del catálogo (copia) todas las mutaciones de un tipo hace fallar M2, para cada invariante y cada tipo", () => {
    for (const invariante of INVARIANTES) {
      for (const tipo of TIPOS_DE_MUTACION) {
        const copia = structuredClone(INVARIANTES);
        const objetivo = copia.find((i) => i.id === invariante.id) as Invariante;
        objetivo.mutaciones = objetivo.mutaciones.filter((m) => m.tipo !== tipo);
        const problemas = problemasDe(copia).filter(
          (p) => p.codigo === "matriz-invariante-sin-tipos",
        );
        expect(
          problemas.some((p) =>
            p.motivo.includes(`${invariante.id} no tiene mutaciones de tipo ${tipo}`),
          ),
          `${invariante.id} · ${tipo}`,
        ).toBe(true);
      }
    }
  });

  it("un noAplica sin motivo (o con un motivo de una palabra) hace fallar M2", () => {
    for (const motivo of ["", "   ", "no aplica"]) {
      const copia = structuredClone(INVARIANTES);
      const m = copia
        .flatMap((i) => i.mutaciones)
        .find((x) => x.noAplica !== undefined) as Mutacion;
      m.noAplica = motivo;
      expect(codigosDe(problemasDe(copia)), JSON.stringify(motivo)).toContain(
        "matriz-noaplica-sin-motivo",
      );
    }
  });

  it("agregar un código a CODIGOS_DE_FALLA (copia) sin invariante hace fallar M1", () => {
    const problemas = problemasDe(INVARIANTES, {
      codigosDeFalla: [...CODIGOS_DE_FALLA, "chequeo-nuevo-sin-invariante"],
    });
    expect(codigosDe(problemas)).toEqual(["matriz-codigo-sin-invariante"]);
    expect(problemas[0]?.motivo).toContain("chequeo-nuevo-sin-invariante");
    expect(problemas[0]?.linea).toBeGreaterThanOrEqual(1);
  });

  it("un código asignado a un invariante pero sin mutación que lo pruebe también falla M1", () => {
    const copia = structuredClone(INVARIANTES);
    copia.find((i) => i.id === "I1")?.codigosDeFalla.push("chequeo-nuevo-sin-mutacion");
    const problemas = problemasDe(copia, {
      codigosDeFalla: [...CODIGOS_DE_FALLA, "chequeo-nuevo-sin-mutacion"],
    });
    expect(codigosDe(problemas)).toEqual(["matriz-codigo-sin-mutacion"]);
  });

  it("una mutación declarada sin aplicador falla M5, y dos con el mismo id también", () => {
    const sinAplicador = structuredClone(INVARIANTES);
    sinAplicador[0]?.mutaciones.push({
      id: "I1-mutacion-nueva-sin-aplicador",
      tipo: "alteracion",
      objetivo: "repo",
      descripcion: "Una mutación que nadie implementó.",
      esperado: { codigo: "ruta-sin-clase" },
    });
    expect(codigosDe(problemasDe(sinAplicador))).toEqual(["matriz-mutacion-sin-aplicador"]);

    const repetida = structuredClone(INVARIANTES);
    const primera = repetida[0]?.mutaciones[0] as Mutacion;
    repetida[1]?.mutaciones.push({ ...primera });
    expect(codigosDe(problemasDe(repetida))).toContain("matriz-id-repetido");
  });

  it("un `esperado` incorrecto se reporta como mutación superviviente (código, archivo o línea)", () => {
    let probadas = 0;
    for (const { mutacion } of ejecutables) {
      const corrida = aplicar(mutacion.id);
      const esperado = mutacion.esperado as Esperado;
      if (mutacion.pendiente !== undefined) continue;
      if (esperado.pasa === true) {
        expect(veredicto({ codigo: "ruta-sin-clase" }, corrida).cumple, mutacion.id).toBe(false);
        continue;
      }
      probadas += 1;
      expect(veredicto(esperado, corrida).cumple, mutacion.id).toBe(true);
      const conCodigoErroneo = { ...esperado, codigo: "codigo-que-no-sale" };
      expect(veredicto(conCodigoErroneo, corrida).cumple, `${mutacion.id} · código`).toBe(false);
      if (esperado.archivo !== undefined) {
        const conArchivoErroneo = { ...esperado, archivo: "otro/archivo.ts" };
        expect(veredicto(conArchivoErroneo, corrida).cumple, `${mutacion.id} · archivo`).toBe(
          false,
        );
      }
      if (esperado.linea !== undefined) {
        const conLineaErronea = { ...esperado, linea: esperado.linea + 1 };
        expect(veredicto(conLineaErronea, corrida).cumple, `${mutacion.id} · línea`).toBe(false);
      }
      if (esperado.lineaDe !== undefined) {
        const conLineaErronea = { ...esperado, lineaDe: "texto que no está en ningún archivo" };
        expect(veredicto(conLineaErronea, corrida).cumple, `${mutacion.id} · lineaDe`).toBe(false);
      }
      if (esperado.contrato !== undefined) {
        const conContratoErroneo = { ...esperado, contrato: "otro-contrato" };
        expect(veredicto(conContratoErroneo, corrida).cumple, `${mutacion.id} · contrato`).toBe(
          false,
        );
      }
      if (esperado.contieneMotivo !== undefined) {
        const conMotivoErroneo = { ...esperado, contieneMotivo: "frase que el motivo no dice" };
        expect(veredicto(conMotivoErroneo, corrida).cumple, `${mutacion.id} · motivo`).toBe(false);
      }
    }
    expect(probadas).toBeGreaterThan(100);
  });

  it("una mutación que no falla donde debía (sin cambios en el mundo) se reporta como superviviente", () => {
    const sinCambio: Corrida = { salidas: [], textos: {} };
    expect(
      veredicto({ codigo: "ruta-sin-clase", archivo: "x.ts", linea: 1 }, sinCambio).cumple,
    ).toBe(false);
    expect(veredicto({ pasa: true }, sinCambio).cumple).toBe(true);
  });

  it("cada tipo de mutación y cada objetivo del catálogo se usa al menos una vez", () => {
    for (const tipo of TIPOS_DE_MUTACION) {
      expect(
        ejecutables.filter(({ mutacion }) => mutacion.tipo === tipo).length,
        tipo,
      ).toBeGreaterThan(0);
    }
    for (const objetivo of OBJETIVOS) {
      expect(
        ejecutables.filter(({ mutacion }) => mutacion.objetivo === objetivo).length,
        objetivo,
      ).toBeGreaterThan(0);
    }
  });
});
