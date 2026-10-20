import { SIN_SESION_DE_PLATAFORMA } from "../capacidades/autenticacion/estado-de-sesion-de-plataforma";
import type { AutenticacionDePlataforma } from "../puertos/autenticacion";
import { respuestaNeutra } from "./ruta-de-ingreso";

/**
 * La autenticación de la consola atada a UN host (el de `PEDERNAL_HOST_DE_LA_CONSOLA`, h5-p8 §7): cualquier otro host
 * que llegue por el parámetro `host` recibe «acá no hay nada» (el 404 neutro, ninguna sesión, el estado sin sesión) y la
 * autenticación de abajo ni se entera. Falla que previene: que la app de la consola pase por descuido el encabezado
 * `Host` del pedido (un alias de Vercel, un dominio de más) y la librería arme una instancia de ingreso, con su origen,
 * su retorno de Google y su comprobación de origen, para un host que nadie eligió; y que un chorro de hosts inventados
 * llene la caché de instancias. Es defensa en profundidad: la app tiene que pasar `hostDeLaConsola()`, y si se equivoca
 * falla cerrado. Chequeo: `autenticacion-de-host-fijo.test.ts` (grupo de mutación de la consola).
 */
export function conHostFijo(
  base: AutenticacionDePlataforma,
  hostFijo: string,
): AutenticacionDePlataforma {
  return {
    sesionDe: (pedido, host) =>
      host === hostFijo ? base.sesionDe(pedido, host) : Promise.resolve(null),
    manejar: (pedido, host) =>
      host === hostFijo ? base.manejar(pedido, host) : Promise.resolve(respuestaNeutra()),
    estadoDeSesion: (pedido, host) =>
      host === hostFijo
        ? base.estadoDeSesion(pedido, host)
        : Promise.resolve(SIN_SESION_DE_PLATAFORMA),
  };
}
