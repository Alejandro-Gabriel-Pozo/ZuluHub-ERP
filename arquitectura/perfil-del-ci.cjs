/**
 * El PERFIL del CI de un pull request (dueño, 25/11/2026: «ser más flexible para llegar al objetivo, con un contador de deuda; el cliente tendrá 1 o 2 personas operando por
 * sucursal como máximo»). Lo usa `planificar-mutacion.cjs` (decide qué corre) y `evaluar-gate.cjs` (decide qué salto acepta el Gate); la rama de integración vive UNA vez, acá.
 *
 *  - `liviano`: un pull request hacia la rama de integración. Sin mutación ni Estabilidad (corren de noche, `nocturna-de-integracion.yml`) y la web (compilación, componentes y
 *    recorrido) solo si el cambio la toca (`tocaLaWeb`);
 *  - `completo`: el pull request final, de la rama de integración hacia otra (`main`): TODOS los grupos, Estabilidad siempre y la web siempre;
 *  - `por-grafo`: cualquier otro (por ejemplo, una actualización de dependencias hacia `main`): lo de antes, solo lo que el cambio alcanza.
 * Ante la duda (base vacía o distinta, otro evento) NO es `liviano`: exige la base exacta y el evento `pull_request`.
 *
 * Previene: unos 60 chequeos y 30 a 60 minutos por pull request con muchas sesiones en paralelo, sin que el recorte se filtre a un pull request que no le corresponde. Registrado en
 * `arquitectura/deuda/relajaciones-de-pruebas.json` (`ci-liviano-en-pr-a-integracion`). Chequeo: `test/arquitectura/planificar-ci-liviano.test.ts`.
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
 * @param {{ evento: string, base: string, origen: string }} entrada
 * @returns {"liviano" | "completo" | "por-grafo"}
 */
function perfilDelPullRequest({ evento, base, origen }) {
  if (evento !== "pull_request") return "completo";
  if (base === BASE_DE_INTEGRACION) return "liviano";
  return origen === BASE_DE_INTEGRACION ? "completo" : "por-grafo";
}

/**
 * ¿El cambio puede afectar a la web (compilación de `apps/web` y `apps/plataforma`, componentes en Chromium y recorrido)? Sí si toca un archivo de `apps/`, el propio `ci.yml`, un
 * archivo que alguna aplicación o un recorrido importa (cierre de importaciones del grafo) o algo que el grafo no conoce (la configuración, las migraciones que aplica el
 * recorrido, `package.json`): ante lo que no sabe clasificar, SÍ (falla cerrado). Solo la documentación y lo que ninguna aplicación ni recorrido alcanza dan `false`.
 *
 * @param {{
 *   cambios: readonly string[],
 *   dependencias: Readonly<Record<string, readonly string[]>>,
 *   cierre: (archivo: string, dependencias: Readonly<Record<string, readonly string[]>>) => Set<string>,
 * }} entrada
 * @returns {{ toca: boolean, motivo: string }}
 */
function tocaLaWeb({ cambios, dependencias, cierre }) {
  const entradas = Object.keys(dependencias).filter(
    (archivo) =>
      archivo.startsWith("apps/") || /^test\/recorrido\/.*\.recorrido\.ts$/.test(archivo),
  );
  let alcanzados;
  const alcanzaA = (cambio) => {
    alcanzados ??= entradas.map((entrada) => cierre(entrada, dependencias));
    return alcanzados.some((alcance) => alcance.has(cambio));
  };
  for (const cambio of cambios) {
    if (DOCUMENTACION_Y_AJENOS.some((patron) => patron.test(cambio))) continue;
    if (cambio === ARCHIVO_DE_CI || cambio.startsWith("apps/")) {
      return { toca: true, motivo: `cambia ${cambio}` };
    }
    if (!(cambio in dependencias)) {
      return { toca: true, motivo: `cambia ${cambio}, que el grafo de importaciones no explica` };
    }
    if (alcanzaA(cambio)) {
      return { toca: true, motivo: `cambia ${cambio}, que usa una aplicación o un recorrido` };
    }
  }
  return {
    toca: false,
    motivo: "el PR no cambia nada que alcance a las aplicaciones ni a los recorridos",
  };
}

/**
 * Lo que decide el plan de un evento: la mutación, Estabilidad, la web y el perfil. `h` son las herramientas de `planificar-mutacion.cjs` (se pasan, no se importan: un
 * archivo no importa al otro).
 *
 * @param {{ evento: string, base: string, origen: string, raiz: string, grupos: unknown[], h: Record<string, any> }} entrada
 */
function decidirElPlan({ evento, base, origen, raiz, grupos, h }) {
  const perfil = perfilDelPullRequest({ evento, base, origen });
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
  if (perfil === "liviano") {
    return {
      perfil,
      plan: {
        completo: false,
        motivo: `CI liviano (pull request hacia ${BASE_DE_INTEGRACION}): la mutación corre de noche`,
        grupos: [],
      },
      estabilidad: { corre: false, motivo: "CI liviano: Estabilidad corre de noche" },
      web: tocaLaWeb({
        cambios,
        dependencias,
        cierre: h.cierre,
      }),
    };
  }
  const web = { toca: true, motivo: "pull request fuera del CI liviano: la web corre siempre" };
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
