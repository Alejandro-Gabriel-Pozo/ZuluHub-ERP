/**
 * Un punto de venta tal como lo informa ARCA en `FEParamGetPtosVenta` (manual WSFE v4.8, l. 3000-3114): su número (`Nro`), si está
 * bloqueado (`Bloqueado`, `S` o `N`) y si tiene fecha de baja (`FchBaja`, opcional). `EmisionTipo` (CAE o CAEA) se IGNORA a propósito
 * (D-77 solo pide que el número exista y no esté bloqueado ni dado de baja; decisión del orquestador, 2026-11-03) y por eso no se carga.
 * SIN VERIFICAR contra ARCA real qué literales manda ni si un punto de venta solo CAEA debería pasar.
 */
export type PuntoDeVentaDeArca = Readonly<{
  numero: number;
  bloqueado: boolean;
  dadoDeBaja: boolean;
}>;

/**
 * D-77 (dueño, 2026-10-29): un punto de venta puede pasar a producción solo si ARCA lo tiene en su lista, no está bloqueado y no está
 * dado de baja. Fail closed: si el número aparece más de una vez no se sabe cuál vale y no pasa (ni hace falta mirar los demás).
 * Previene: pasar a producción un número que ARCA rechazaría en cada emisión (validación 10005, «el punto de venta informado debe
 * estar dado de alta», manual l. 960), que quedaría a la vista recién con la primera factura real.
 * Chequeo: `habilitacion-en-arca.test.ts` (cada causa de rechazo por separado) y la prueba del caso de uso.
 */
export function habilitadoEnArca(
  informados: readonly PuntoDeVentaDeArca[],
  numero: number,
): boolean {
  const [unico, ...otros] = informados.filter((p) => p.numero === numero);
  return unico !== undefined && otros.length === 0 && !unico.bloqueado && !unico.dadoDeBaja;
}
