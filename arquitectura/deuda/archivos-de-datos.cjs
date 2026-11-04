/**
 * Los archivos de DATOS de la deuda y del propio control, donde cada entrada es un marcador (contratos-
 * arquitectonicos.md §10, G5): `knip.json` (lo que deja pasar), las excepciones y exclusiones del guardián y los
 * grupos de mutación sin `pruebas`. Cada uno dice cómo reconocerlo y en qué línea cae cada entrada, a partir del
 * árbol de `analizarJson` (`ubicacion.cjs`).
 */

/** La clave de `knip.json` cuyas entradas dejan pasar algo. Las booleanas (`ignoreExportsUsedInFile`) no se cuentan. */
const IGNORES_DE_KNIP = new Set([
  "ignore",
  "ignoreBinaries",
  "ignoreDependencies",
  "ignoreIssues",
  "ignoreMembers",
  "ignoreUnresolved",
  "ignoreWorkspaces",
]);

/** Recorre el árbol de `analizarJson` y cuenta una entrada por elemento de cada lista (o clave de cada objeto) `ignore*`. */
function entradasDeKnip(nodo, salida) {
  if (nodo.miembros !== undefined) {
    for (const [clave, miembro] of nodo.miembros) {
      if (IGNORES_DE_KNIP.has(clave)) {
        for (const elemento of miembro.nodo.elementos ?? []) salida.push(elemento.inicio);
        for (const interno of miembro.nodo.miembros?.values() ?? []) salida.push(interno.linea);
      }
      entradasDeKnip(miembro.nodo, salida);
    }
  }
  for (const elemento of nodo.elementos ?? []) entradasDeKnip(elemento, salida);
  return salida;
}

/** Línea del `id` (o de la apertura) de cada elemento de una lista de excepciones o exclusiones. */
const entradasDelGuardian = (raiz) =>
  (raiz.elementos ?? []).map((entrada) => entrada.miembros?.get("id")?.linea ?? entrada.inicio);

/** Línea del `grupo` de cada elemento de la lista de grupos de mutación que no trae `pruebas` (o la trae vacía). */
function gruposSinFiltro(raiz, valor) {
  const lineas = [];
  (raiz.elementos ?? []).forEach((grupo, posicion) => {
    const pruebas = valor[posicion]?.pruebas;
    if (typeof pruebas !== "string" || pruebas.trim() === "") {
      lineas.push(grupo.miembros?.get("grupo")?.linea ?? grupo.inicio);
    }
  });
  return lineas;
}

/** Los archivos de datos que son un marcador por entrada: cómo reconocerlos y cómo leer sus entradas. */
const ESPECIALES = Object.freeze([
  {
    tipo: "knip-ignora",
    coincide: (ruta) => ruta === "knip.json" || ruta.endsWith("/knip.json"),
    lineas: (raiz) => entradasDeKnip(raiz, []),
  },
  {
    tipo: "excepcion-del-guardian",
    coincide: (ruta) =>
      ruta === "arquitectura/contratos/excepciones.json" ||
      ruta === "arquitectura/contratos/exclusiones.json",
    lineas: entradasDelGuardian,
  },
  {
    tipo: "mutacion-sin-filtro",
    coincide: (ruta) => ruta === "arquitectura/grupos-de-mutacion.json",
    lineas: gruposSinFiltro,
  },
]);

module.exports = { ESPECIALES };
