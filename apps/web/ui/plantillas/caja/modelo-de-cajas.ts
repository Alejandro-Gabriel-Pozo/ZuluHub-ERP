import { RUTAS_DE_CAJA, estadoDeLista, type FilaDeLista } from "./lista-de-caja";

/**
 * El modelo de vista de «Cajas» (maqueta aprobada `medios.html`, 09/11/2026): de lo que entrega la lista de la composición, lo que se ve en cada tarjeta (solo su nombre y su
 * estado: la maqueta no tiene línea de detalle). Puro: sin React ni servidor.
 */

export const RUTAS_DE_CAJAS = {
  lista: RUTAS_DE_CAJA.cajas,
  nuevo: `${RUTAS_DE_CAJA.cajas}/nuevo`,
} as const;

export const rutaDeUnaCaja = (id: string): string => `${RUTAS_DE_CAJAS.lista}/${id}`;

/** Una caja como la entrega la composición. */
export type CajaDeLaLista = Readonly<{
  id: string;
  nombre: string;
  activa: boolean;
  version: number;
}>;

export function armarLaListaDeCajas(cajas: readonly CajaDeLaLista[]): readonly FilaDeLista[] {
  return cajas.map((c) => ({
    id: c.id,
    titulo: c.nombre,
    detalle: "",
    activo: c.activa,
    estado: estadoDeLista(c.activa),
    sePuedeDesactivar: true,
    version: c.version,
    href: rutaDeUnaCaja(c.id),
  }));
}
