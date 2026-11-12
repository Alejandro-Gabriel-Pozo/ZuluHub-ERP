import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { TonoDeEstado } from "../../componentes/Insignia";

/**
 * Lo que comparten las tres listas de la configuración de caja (medios de pago, cuentas de cobro y cajas; maqueta aprobada `medios.html`, 09/11/2026): la fila de una
 * tarjeta, qué botones se ofrecen y el estado «Activo» o «Desactivado». Se extrajo cuando la segunda pantalla real lo necesitó (ADR-014). Puro: sin React ni servidor.
 */

/** Una tarjeta de la lista: el título, la línea de detalle, el estado y adónde lleva «Editar». */
export type FilaDeLista = Readonly<{
  id: string;
  titulo: string;
  detalle: string;
  activo: boolean;
  estado: Readonly<{ texto: string; tono: TonoDeEstado }>;
  /** Un medio que no se desactiva nunca (el efectivo) sale con el botón apagado. */
  sePuedeDesactivar: boolean;
  version: number;
  href: string;
}>;

/**
 * Qué botones de una lista se ofrecen activos hoy, según lo que el SERVIDOR deja hacer (`permisosDelActor`, una lectura por pedido; `servidor/modulos.ts`). Sin permiso, el
 * botón sale apagado (la maqueta, estado «Sin permiso»). Solo una ayuda: apagar no es autorizar, cada acción vuelve a pasar por el guard dentro de su transacción. Si no
 * se pudieron leer los permisos, todo sale apagado (ante la duda el sistema cierra).
 */
export type AccionesDeLista = Readonly<{
  agregar: boolean;
  editar: boolean;
  desactivar: boolean;
  reactivar: boolean;
}>;

/** El estado de una tarjeta: Activo en verde, Desactivado como aviso (maqueta `pill`). */
export const estadoDeLista = (activo: boolean): FilaDeLista["estado"] =>
  activo
    ? { texto: texto({}, "caja.estado.activo"), tono: "exito" }
    : { texto: texto({}, "caja.estado.desactivado"), tono: "aviso" };

/** Una pestaña de la configuración de caja: adónde lleva, su texto ya resuelto y si es la pantalla actual. */
export type PestanaDeCaja = Readonly<{ href: string; texto: string; actual: boolean }>;

/** Las direcciones de las tres pantallas de la configuración de caja. */
export const RUTAS_DE_CAJA = {
  medios: "/caja/medios-de-pago",
  cuentas: "/caja/cuentas-de-cobro",
  cajas: "/caja/cajas",
} as const;
