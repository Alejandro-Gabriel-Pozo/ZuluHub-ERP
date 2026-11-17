/**
 * Las reglas de arquitectura del PDF de la factura. Viven aparte de `reglas.cjs` porque ese archivo pasa del tope de líneas y no puede crecer
 * (`arquitectura/deuda`): `reglas.cjs` las suma a su lista, así que `.dependency-cruiser.cjs` y las pruebas las ven como cualquier otra.
 * Cada una tiene su violación inyectada en `test/arquitectura/reglas.test.ts`.
 */

/** @type {import("dependency-cruiser").IForbiddenRuleType[]} */
module.exports = [
  {
    // PDF de la factura (dueño, 2026-11-05: «Librería de PDF con otro diseño»; `pdfkit` 0.20.2 exacta, aprobada por el dueño). Previene: que la
    // librería de PDF se importe desde otro lugar y un texto del cliente llegue al documento SIN pasar por la validación de caracteres del
    // pincel (un emoji o texto de derecha a izquierda saldría corrupto en una factura), o que el dibujo se copie en cada uso. Lo importa UN solo
    // lugar, `src/adaptadores/pdf/`. Chequeo: la violación inyectada de reglas.test.ts.
    name: "pdf-solo-en-su-adaptador",
    severity: "error",
    comment:
      "`pdfkit` solo se importa en src/adaptadores/pdf/: todo texto del comprobante pasa por el pincel, que rechaza los caracteres que la tipografía del PDF no tiene (decisión del dueño, 2026-11-05).",
    from: {
      path: "^(src|apps|scripts)/",
      pathNot: "^src/adaptadores/pdf/",
    },
    to: { path: "^(node_modules/)?pdfkit(/|$)" },
  },
  {
    // Lo mismo para las dos herramientas que LEEN un PDF para probarlo (`pdfjs-dist`: texto y dibujo; `jsqr`: decodificar el QR), aprobadas por el
    // dueño el 2026-11-05 solo para pruebas. Previene: que el código de producción cargue un lector de PDF (peso y superficie de ataque en la
    // función de Vercel) o que una prueba deje de verificar lo que el PDF dice. Chequeo: la violación inyectada de reglas.test.ts.
    name: "lectores-de-pdf-solo-en-pruebas",
    severity: "error",
    comment:
      "`pdfjs-dist` y `jsqr` son solo para pruebas (archivos *.test.* y test/): el código de producción no los importa.",
    from: {
      path: "^(src|apps|scripts)/",
      pathNot: "\\.test\\.(ts|tsx)$",
    },
    to: { path: "^(node_modules/)?(pdfjs-dist|jsqr)(/|$)" },
  },
];
