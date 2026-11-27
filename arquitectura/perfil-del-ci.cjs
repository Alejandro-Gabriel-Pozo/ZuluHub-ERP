/**
 * El PERFIL del CI de un pull request. Lo usa `planificar-mutacion.cjs` (decide qué corre) y `evaluar-gate.cjs` (decide qué salto acepta el Gate); la rama de integración vive UNA vez, acá.
 *
 *  - `completo`: el pull request final, de la rama de integración hacia otra (`main`) y todo evento que no es un pull request: TODOS los grupos, Estabilidad siempre y la web siempre;
 *  - `por-grafo`: cualquier otro pull request (incluido uno hacia la rama de integración): solo lo que el cambio alcanza, y la web siempre.
 *
 * El perfil `liviano` (dueño, 25/11/2026: un pull request hacia la rama de integración sin mutación, sin Estabilidad y con la web solo si el cambio la tocaba) se RETIRÓ el 27/11/2026 junto con la
 * rama de integración (la etapa 1 entró a `main`, #641): un pull request hacia esa rama ya no recorta nada. Su relajación quedó RESTAURADA en `arquitectura/deuda/relajaciones-de-pruebas.json`
 * (`ci-liviano-en-pr-a-integracion`). Chequeo: `test/arquitectura/planificar-ci-liviano.test.ts` (nunca vuelve a salir `liviano`) y `relajaciones-de-pruebas.test.ts` (el registro dice lo que hace el código).
 * Sin dependencias: lo carga el job `Gate`, que no instala paquetes.
 */

/** La rama de integración. */
const BASE_DE_INTEGRACION = "integracion/modulos-v2";

/**
 * Cambios que ninguna prueba lee de un modo que cambie un resultado: ni la mutación ni la integración los notan. Los dos workflows de acá no los lee ninguna prueba salvo el escaneo de nombres, que no ejerce código mutado.
 */
const DOCUMENTACION_Y_AJENOS = [
  /\.md$/,
  /^\.github\/dependabot\.yml$/,
  /^\.github\/workflows\/(codeql|gate-rapido)\.yml$/,
  /^\.gitleaks\.toml$/,
  /^skills-lock\.json$/,
];

const ARCHIVO_DE_CI = ".github/workflows/ci.yml";

/**
 * @param {{ evento: string, origen: string }} entrada
 * @returns {"completo" | "por-grafo"}
 */
function perfilDelPullRequest({ evento, origen }) {
  if (evento !== "pull_request") return "completo";
  return origen === BASE_DE_INTEGRACION ? "completo" : "por-grafo";
}

/**
 * Lo que decide el plan de un evento: la mutación, Estabilidad, la web y el perfil. `h` son las herramientas de `planificar-mutacion.cjs` (se pasan, no se importan: un
 * archivo no importa al otro).
 *
 * @param {{ evento: string, origen: string, raiz: string, grupos: unknown[], h: Record<string, any> }} entrada
 */
function decidirElPlan({ evento, origen, raiz, grupos, h }) {
  const perfil = perfilDelPullRequest({ evento, origen });
  if (evento !== "pull_request") {
    const cual = `evento ${evento === "" ? "local" : evento}`;
    return {
      perfil,
      plan: h.todosLosGrupos(grupos, `${cual}: se corre todo`),
      estabilidad: { corre: true, motivo: `${cual}: se repite siempre` },
      web: { toca: true, motivo: `${cual}: la web corre siempre` },
    };
  }
  const cambios = h.leerCambios(raiz);
  const dependencias = h.leerDependencias(raiz);
  const web = { toca: true, motivo: "pull request: la web corre siempre" };
  if (perfil === "completo") {
    return {
      perfil,
      plan: h.todosLosGrupos(grupos, "pull request final: se corre todo"),
      estabilidad: { corre: true, motivo: "pull request final: se repite siempre" },
      web,
    };
  }
  const ci = cambios.includes(ARCHIVO_DE_CI) ? h.leerCi(raiz) : undefined;
  return {
    perfil,
    plan: h.planificar({ cambios, grupos, dependencias, ci }),
    estabilidad: h.planificarEstabilidad({ cambios, dependencias }),
    web,
  };
}

module.exports = {
  BASE_DE_INTEGRACION,
  DOCUMENTACION_Y_AJENOS,
  ARCHIVO_DE_CI,
  decidirElPlan,
};
