/**
 * Las direcciones de la cuenta corriente de clientes (CC-5, A1): el listado y la ficha de un cliente. El id de la ficha es un UUID que sale de la consulta del servidor, nunca de un texto libre.
 * `?orden=` es lo único que la dirección aporta al listado (el servidor lo valida contra la lista cerrada).
 */
export const RUTA_DE_LA_CUENTA_CORRIENTE = "/caja/cuenta-corriente";

export const rutaDeLaFichaDeCuenta = (parteId: string): string =>
  `${RUTA_DE_LA_CUENTA_CORRIENTE}/${parteId}`;

export type OrdenDelListado = "SALDO" | "VENCIDO" | "ANTIGUEDAD";

export const direccionDelListadoDeCuentas = (orden: OrdenDelListado): string =>
  `${RUTA_DE_LA_CUENTA_CORRIENTE}?${new URLSearchParams([["orden", orden]]).toString()}`;

/** La descarga a Excel de la cuenta corriente de todos los clientes con ficha, al día de hoy (CC-5 D): una dirección de GET sin parámetros; el servidor decide empresa y permisos. */
export const direccionDeExportarCuentaCorriente = (): string =>
  `${RUTA_DE_LA_CUENTA_CORRIENTE}/exportar`;
