/**
 * Las reglas de arquitectura que viven en archivos propios, juntas en un solo lugar. `reglas.cjs` pasa del tope de líneas y no puede crecer (`arquitectura/deuda`):
 * sumar un archivo de reglas se hace acá, no allá. Cada regla tiene su violación inyectada en `test/arquitectura/reglas.test.ts`.
 */

module.exports = [].concat(
  require("./reglas-de-pdf.cjs"),
  require("./reglas-de-modulos.cjs"),
  require("./reglas-de-red.cjs"),
  require("./reglas-de-xlsx.cjs"),
);
