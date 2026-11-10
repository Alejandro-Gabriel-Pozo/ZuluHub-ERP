/**
 * El ÚNICO cuerpo `…EnTx` que `fiscal/publico.ts` puede exportar: `emitirFacturaDeOrigenEnTx` (E1). Las pruebas «guard primero» prohíben exportar
 * cuerpos de transacción (numerar, cerrar o resincronizar sin permiso); este lleva SU guard adentro, antes de leer o escribir nada, y eso lo
 * prueba `guard-primero-facturacion.test.ts`. Un nombre nuevo acá exige el mismo argumento: no es una lista para ir agrandando.
 */
export const CUERPO_CON_GUARD_PROPIO = "emitirFacturaDeOrigenEnTx";
