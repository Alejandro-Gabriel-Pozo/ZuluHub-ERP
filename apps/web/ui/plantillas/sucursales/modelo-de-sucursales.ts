import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { RUTAS_DE_CUENTA } from "../sesion/rutas-de-cuenta";

/**
 * El modelo de «Sucursales»: de lo que entrega el servidor a lo que dibuja la pantalla, con todo el texto ya resuelto. Puro: sin React ni servidor. La lista muestra solo las sucursales ACTIVAS, por nombre, sin estados.
 * «Nueva sucursal» se ofrece solo a quien puede crear (la oferta la calcula el servidor); lo que decide de verdad es el caso de uso al enviar.
 */

/** Lo que entrega el servidor (`src/composicion/sucursales-web.ts`, que la interfaz no importa: las apps entran por `apps/web/servidor`). */
export type SucursalParaLaPantalla = Readonly<{ id: string; nombre: string }>;

export type ListaDeSucursalesArmada = Readonly<{
  /** «Nueva sucursal»: `null` si quien mira no puede crear (no se dibuja). */
  nuevo: Readonly<{ texto: string; href: string }> | null;
  filas: readonly Readonly<{ id: string; nombre: string }>[];
}>;

/** La lista de sucursales activas, en el orden del servidor (nombre). */
export function armarLaListaDeSucursales(
  sucursales: readonly SucursalParaLaPantalla[],
  diccionario: DiccionarioResuelto,
  puedeCrear: boolean,
): ListaDeSucursalesArmada {
  return {
    nuevo: puedeCrear
      ? { texto: texto(diccionario, "sucursales.lista.nueva"), href: RUTAS_DE_CUENTA.nuevaSucursal }
      : null,
    filas: sucursales.map((s) => ({ id: s.id, nombre: s.nombre })),
  };
}

export type FormularioDeAltaDeSucursalArmado = Readonly<{
  nombre: string;
  guardar: string;
  cancelar: string;
}>;

/** El formulario de «Nueva sucursal»: solo el nombre. Los textos son los ya aprobados de «Nombre», «Guardar» y «Cancelar». */
export function armarElFormularioDeAltaDeSucursal(
  diccionario: DiccionarioResuelto,
): FormularioDeAltaDeSucursalArmado {
  return {
    nombre: texto(diccionario, "caja.campo.nombre"),
    guardar: texto(diccionario, "caja.accion.guardar"),
    cancelar: texto(diccionario, "caja.accion.cancelar"),
  };
}
