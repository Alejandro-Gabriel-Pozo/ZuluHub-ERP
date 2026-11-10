/**
 * Los ÚNICOS cuerpos `…EnTx` que `fiscal/publico.ts` puede exportar: `emitirFacturaDeOrigenEnTx` y `vigenciaDeComprobantesEnTx` (E1). Las pruebas
 * «guard primero» prohíben exportar cuerpos de transacción (numerar, cerrar o resincronizar sin permiso); estos llevan SU guard adentro, antes de
 * leer o escribir nada, y eso lo prueban `guard-primero-facturacion.test.ts` y `guard-primero.test.ts` de las consultas. Un nombre nuevo acá
 * exige el mismo argumento: no es una lista para ir agrandando.
 */
export const CUERPOS_CON_GUARD_PROPIO: readonly string[] = [
  "emitirFacturaDeOrigenEnTx",
  "vigenciaDeComprobantesEnTx",
];
