/**
 * La regla de arquitectura del archivo de Excel. Vive aparte de `reglas.cjs` porque ese archivo pasa del tope de líneas y no puede crecer (`arquitectura/deuda`): `reglas-aparte.cjs` la suma a
 * su lista, así que `.dependency-cruiser.cjs` y las pruebas la ven como cualquier otra. Tiene su violación inyectada en `test/arquitectura/reglas.test.ts`.
 */

/** @type {import("dependency-cruiser").IForbiddenRuleType[]} */
module.exports = [
  {
    // Archivo de Excel de compras (dueño, 2026-11-25: `write-excel-file` 4.1.1 exacta, aprobada por el dueño). Previene: que la biblioteca se importe desde otro lugar y un texto de un
    // proveedor llegue al archivo SIN pasar por la neutralización de fórmulas y la regla de «número solo si es exacto» del adaptador (un proveedor llamado `=HYPERLINK(...)` o un importe de
    // 17 dígitos redondeado en silencio), o que el armado del archivo se copie en cada uso. La importa UN solo lugar, `src/adaptadores/xlsx/`. Chequeo: la violación inyectada de reglas.test.ts.
    name: "xlsx-solo-en-su-adaptador",
    severity: "error",
    comment:
      "`write-excel-file` solo se importa en src/adaptadores/xlsx/: toda celda pasa por celdas-de-xlsx.ts (sin fórmulas, números solo si son exactos). Decisión del dueño, 2026-11-25.",
    from: {
      path: "^(src|apps|scripts)/",
      pathNot: "^src/adaptadores/xlsx/",
    },
    to: { path: "^(node_modules/)?write-excel-file(/|$)" },
  },
];
