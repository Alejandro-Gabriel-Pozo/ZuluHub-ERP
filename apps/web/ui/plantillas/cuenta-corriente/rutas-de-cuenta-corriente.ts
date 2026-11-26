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

/** Habilitar a un cliente (formulario) y cambiar el plazo o el límite de uno ya habilitado. */
export const RUTA_DE_HABILITAR_CUENTA = `${RUTA_DE_LA_CUENTA_CORRIENTE}/habilitar`;

export const rutaDeLasCondicionesDeCuenta = (parteId: string): string =>
  `${rutaDeLaFichaDeCuenta(parteId)}/condiciones`;

/** La descarga a Excel de la cuenta corriente de todos los clientes con ficha, al día de hoy (CC-5 D): una dirección de GET sin parámetros; el servidor decide empresa y permisos. */
export const direccionDeExportarCuentaCorriente = (): string =>
  `${RUTA_DE_LA_CUENTA_CORRIENTE}/exportar`;

/**
 * «Cobrar un ticket a cuenta» (CC-5 B2b): se llega desde la ficha del cliente. Sin `?ticket=` se cobra el cargo pendiente más antiguo del cliente; con él, ese ticket (el que se vio). El servidor
 * valida los dos ids contra la empresa: lo que venga del navegador nunca decide qué se cobra.
 */
export const rutaDeCobrarACuenta = (parteId: string, ticketId?: string): string => {
  const base = `${rutaDeLaFichaDeCuenta(parteId)}/cobrar`;
  return ticketId === undefined
    ? base
    : `${base}?${new URLSearchParams([["ticket", ticketId]]).toString()}`;
};
