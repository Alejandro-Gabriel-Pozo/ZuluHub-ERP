import { ok } from "../../primitivas/resultado/resultado";
import type { ConfiguracionPublicaDeHost, ResolucionDeHost } from "../../puertos/marcas";
import { marcaPublicaDe } from "./marca-publica";
import type { ConsultaDeHost, LecturaDeMarca } from "./resolutor";

/** De dónde sale la resolución de un host y la marca que lo atiende (lo que pide `crearResolutorDePuerta`). */
export type FuenteDePuertas = Readonly<{
  consultarHost: ConsultaDeHost;
  leerMarca: LecturaDeMarca;
}>;

/** Los dos puertos de la puerta pública, PEREZOSOS: pedirlos es lo que lee el entorno (y lo que puede fallar). */
export type PuertosDeLaPuerta = Readonly<{
  resolucion: () => ResolucionDeHost;
  configuracion: () => ConfiguracionPublicaDeHost;
}>;

/**
 * La fuente REAL de la puerta (armazón web §3.2; marcas y planes §B.2.3): el host se resuelve con
 * `ResolucionDeHost.porHost` y la marca se pinta con `ConfiguracionPublicaDeHost.porHost`, las dos por el
 * rol `pedernal_publico`. Decisión: son dos lecturas (el puerto de resolución es el que da el `marcaId`
 * de la puerta; la configuración trae el suyo para poder contrastarlos), pero la segunda solo se hace si la primera encontró un host
 * servible y las dos pasan por la caché del resolutor (≤ 60 s por host).
 *  - Del resolutor sale solo el `marcaId`: nada del dueño ni de la empresa llega más arriba.
 *  - Falla cerrado: una variable sin configurar (pedir el puerto lanza) o un error de la base ES una
 *    excepción o un `err`, que el resolutor convierte en `NO_DISPONIBLE` (503 neutra), nunca en «desconocido»
 *    ni en la marca de otro host. Un `ok(null)` de la configuración (la marca dejó de ser servible entre las
 *    dos lecturas) es desconocido.
 */
export function armarFuenteDePuertas(puertos: PuertosDeLaPuerta): FuenteDePuertas {
  return {
    consultarHost: async (host, superficie) => {
      const respuesta = await puertos.resolucion().porHost(host, superficie);
      if (!respuesta.ok) return respuesta;
      return ok(respuesta.valor === null ? null : { marcaId: respuesta.valor.marcaId });
    },
    leerMarca: async (_marcaId, host, superficie) => {
      const respuesta = await puertos.configuracion().porHost(host, superficie);
      if (!respuesta.ok) {
        // El mensaje no dice nada de la base ni del host: el detalle ya quedó en el registro de la conexión.
        throw new Error("no se pudo leer la configuración pública de la marca");
      }
      return respuesta.valor === null ? null : marcaPublicaDe(respuesta.valor);
    },
  };
}
