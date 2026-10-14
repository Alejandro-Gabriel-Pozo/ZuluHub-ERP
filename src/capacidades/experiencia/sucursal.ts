/**
 * La sucursal elegida en ESTE dispositivo (armazón web §1.1 «Sucursal»): una preferencia local, no un dato
 * del servidor. Lo que se guarda en el dispositivo puede estar viejo (la sucursal se desactivó, la persona ya
 * no tiene acceso, se cambió de empresa): se usa solo si sigue entre las disponibles ahora. Previene: operar
 * sobre una sucursal que ya no existe o no es de la persona porque el celular la recordaba. El servidor igual
 * verifica en cada operación; esto es solo comodidad. Chequeo: `sucursal.test.ts`.
 */
export type SucursalElegible = Readonly<{ id: string }>;

/**
 * Qué sucursal queda elegida: la guardada si sigue disponible; si no, la única que haya; si hay varias y la
 * guardada no sirve, ninguna (la pantalla pide elegir). `null` si no hay ninguna.
 */
export function sucursalElegida(
  guardada: string | null,
  disponibles: readonly SucursalElegible[],
): string | null {
  if (guardada !== null && disponibles.some((s) => s.id === guardada)) return guardada;
  const [unica, ...resto] = disponibles;
  return unica !== undefined && resto.length === 0 ? unica.id : null;
}

/** La clave con la que se recuerda en el dispositivo: una por empresa, así cambiar de empresa no arrastra la sucursal. */
export function claveDeSucursalLocal(empresaId: string): string {
  return `zh:sucursal:${empresaId}`;
}
