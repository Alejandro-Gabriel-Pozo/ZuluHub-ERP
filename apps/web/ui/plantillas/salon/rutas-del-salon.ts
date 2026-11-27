/**
 * Las rutas de OPERACIÓN del salón (S-0r; `salon-s0-ficha-y-tramos.md` §1, confirmadas por el orquestador el 17/11/2026): `/salon` es el mapa de mesas y `/salon/cuenta/[mesaId]` la ficha de la mesa. La
 * administración de mesas es otra cosa y vive en `/salon/mesas` (`modelo-de-mesas.ts`): la ficha NO es `/salon/mesas/[id]`, que es la edición de una mesa, para no confundir las dos pantallas.
 * Solo se declaran las constantes: las pantallas son de S-3 y NO hay fila de menú todavía (una entrada hacia una página que no existe sería una entrada rota, y con `salon` disponible la vería quien tenga la perilla).
 * Chequeo: `test/web/rutas-del-salon.test.ts`.
 */
export const RUTA_DEL_SALON = "/salon";
export const RUTA_DE_LA_CUENTA_DE_MESA = `${RUTA_DEL_SALON}/cuenta`;

/** La ficha de una mesa; el id viaja codificado (nunca se arma una ruta con un texto crudo). */
export const rutaDeLaCuentaDeMesa = (mesaId: string): string =>
  `${RUTA_DE_LA_CUENTA_DE_MESA}/${encodeURIComponent(mesaId)}`;

/** «Cobrar» la mesa (SAL-D): la hoja de cobro de la cuenta de esa mesa; el id viaja codificado. */
export const rutaDeCobrarLaMesa = (mesaId: string): string =>
  `${rutaDeLaCuentaDeMesa(mesaId)}/cobrar`;

/** «Cobrar» una cuenta hija de una mesa dividida (SAL-E2): la misma hoja de cobro, con la cuenta en la dirección; los ids viajan codificados. */
export const rutaDeCobrarLaCuenta = (mesaId: string, cuentaId: string): string =>
  `${rutaDeCobrarLaMesa(mesaId)}?cuenta=${encodeURIComponent(cuentaId)}`;
