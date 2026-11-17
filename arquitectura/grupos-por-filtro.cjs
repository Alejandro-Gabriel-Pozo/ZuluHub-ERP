/**
 * Un grupo de mutación corre solo si lo que cambió puede alterar su resultado: un archivo SUYO cambió, o algo del cierre de importaciones
 * de alguna prueba de SU filtro (`pruebas` del grupo: lo que vitest corre por cada mutante). Solo esas pruebas pueden matar sus mutantes.
 *
 * Previene: que las ~30 pruebas de `test/web`, que importan la composición y con ella casi todo, enciendan ~69 grupos que luego corren
 * con un filtro que ni las incluye (medido sobre 37 PR: 9.585 → 4.478 min declarados de mutación, −53 %). Esto SOLO REFINA al plan por
 * grafo (`planificar` aplica antes su regla ancha): nunca agrega un grupo, y ante lo que no puede resolver deja la regla ancha (fail-closed).
 * Sin filtro, o con una entrada del filtro que no coincide con ninguna prueba, el grupo se queda como estaba.
 * La nocturna, `main` y el disparo manual no pasan por acá (corren todos los grupos completos).
 * El chequeo que falla si se quita es `test/arquitectura/grupos-por-filtro.test.ts` (paridad con `vitest list --filesOnly`).
 */

/** Las rutas de un filtro de pruebas: vitest las toma como subcadenas de la ruta de cada archivo (`vitest list --filesOnly`). */
const entradasDelFiltro = (pruebas) =>
  (pruebas ?? "").split(/\s+/).filter((entrada) => entrada !== "");

/**
 * Las pruebas que corre un filtro y las entradas que no coinciden con ninguna.
 *
 * @param {string | undefined} pruebas
 * @param {readonly string[]} universo todas las pruebas que corre el proyecto `node`
 */
function pruebasDelFiltro(pruebas, universo) {
  const entradas = entradasDelFiltro(pruebas);
  const corridas = universo.filter((prueba) =>
    entradas.some((entrada) => prueba.includes(entrada)),
  );
  const sinPrueba = entradas.filter(
    (entrada) => !universo.some((prueba) => prueba.includes(entrada)),
  );
  return { corridas, sinPrueba };
}

/**
 * Prepara la decisión por grupo. `afectadas` son las pruebas que ya alcanzan lo cambiado (con su cierre de importaciones y las raíces globales:
 * las calcula `pruebasAfectadas` en `planificar-mutacion.cjs`, que es quien carga este módulo); `esPruebaDeNode` filtra las del proyecto `node` (el universo que vitest filtra).
 *
 * @returns {(grupo: { grupo: string, pruebas?: string, expandidos: readonly string[], fuente?: string }) => { corre: boolean, motivo: string }}
 */
function decidirPorFiltro({ dependencias, afectadas, enElGrafo, esPruebaDeNode, archivoDe }) {
  const universo = Object.keys(dependencias).filter(esPruebaDeNode);
  return ({ pruebas, expandidos, fuente }) => {
    if (entradasDelFiltro(pruebas).length === 0)
      return { corre: true, motivo: "sin filtro de pruebas: corre con todas" };
    // Su definición (su archivo de grupo: qué archivos muta y con qué pruebas) también es suya: si cambia, el grupo corre.
    const propio = [...expandidos.map(archivoDe), fuente].find((archivo) => enElGrafo.has(archivo));
    if (propio !== undefined) return { corre: true, motivo: `cambió su archivo ${propio}` };
    const { corridas, sinPrueba } = pruebasDelFiltro(pruebas, universo);
    if (sinPrueba.length > 0)
      return {
        corre: true,
        motivo: `su filtro no resuelve «${sinPrueba.join(" ")}» (regla ancha)`,
      };
    const prueba = corridas.find((candidata) => afectadas.has(candidata));
    if (prueba !== undefined)
      return { corre: true, motivo: `la prueba ${prueba} de su filtro alcanza lo cambiado` };
    return {
      corre: false,
      motivo: `ni sus archivos ni sus ${corridas.length} prueba(s) del filtro alcanzan lo cambiado`,
    };
  };
}

/**
 * Los grupos que corren de los candidatos (ya ordenados y sin los del guardián que no toca el PR): los que alcanza lo cambiado (`afectados`:
 * archivos cambiados y cierres de las pruebas afectadas) y que `decidirPorFiltro` no descarta. Un grupo cuya definición cambió corre con TODOS sus
 * archivos. Devuelve también una línea de motivo por cada grupo saltado.
 */
function elegirGrupos({ grupos, afectados, ...contexto }) {
  const porFiltro = decidirPorFiltro(contexto);
  const elegidos = [];
  const saltados = [];
  for (const { grupo, pruebas, expandidos, fuente } of grupos) {
    const nueva = contexto.enElGrafo.has(fuente);
    const archivos = nueva
      ? expandidos
      : expandidos.filter((e) => afectados.has(contexto.archivoDe(e)));
    if (archivos.length === 0) continue;
    const decision = porFiltro({ grupo, pruebas, expandidos, fuente });
    if (decision.corre)
      elegidos.push({ grupo, archivos: archivos.join(","), pruebas: pruebas ?? "" });
    else saltados.push(`${grupo}: ${decision.motivo}`);
  }
  return { elegidos, saltados };
}

module.exports = { decidirPorFiltro, elegirGrupos, pruebasDelFiltro };
