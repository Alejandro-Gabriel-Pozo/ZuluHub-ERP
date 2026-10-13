import type { Resultado } from "../../primitivas/resultado/resultado";
import {
  HOST_DESCONOCIDO,
  HOST_NO_DISPONIBLE,
  SUPERFICIES_SERVIBLES,
  type EstadoDeLaResolucion,
  type MarcaPublica,
  type SuperficieServible,
} from "./puerta";

/**
 * Resolutor de la puerta (marcas y planes §B.2.3): de un host crudo a su `EstadoDeLaResolucion`, con
 * la consulta a la base y la lectura de la marca INYECTADAS (la web las enchufa contra la puerta
 * pública; las pruebas, contra un falso) y el reloj también. Lo que hace él:
 *  - un host que no normaliza es DESCONOCIDO sin consultar nada ni tocar la caché (un atacante que
 *    rota nombres inválidos no la llena);
 *  - un host sirve una sola superficie: se pregunta por cada una en orden y se corta en la primera;
 *  - guarda por INSTANCIA, hasta 60 s y con tamaño acotado, la configuración PÚBLICA resuelta, también
 *    el «desconocido» (un dominio retirado deja de servirse en a lo sumo un minuto). La clave es el
 *    host normalizado: nada se comparte entre hosts. Los fallos NO se guardan;
 *  - un fallo (error devuelto o excepción de la consulta o de la lectura) es `NO_DISPONIBLE`, nunca
 *    «desconocido» ni la marca principal. Un host sin marca legible también es desconocido.
 */
export const VIDA_MAXIMA_DE_LA_CACHE_EN_MS = 60_000;
export const TAMANO_DE_LA_CACHE = 500;

export type ConsultaDeHost = (
  host: string,
  superficie: SuperficieServible,
) => Promise<Resultado<Readonly<{ marcaId: string }> | null, unknown>>;

export type LecturaDeMarca = (marcaId: string) => Promise<MarcaPublica | null>;

export type OpcionesDelResolutor = Readonly<{
  consultarHost: ConsultaDeHost;
  leerMarca: LecturaDeMarca;
  /** El host normalizado, o `null` si no es un host válido (la definición es la de `modulos/marcas`). */
  normalizarHost: (crudo: string) => string | null;
  /** Milisegundos desde cualquier origen fijo: solo se restan. */
  ahora: () => number;
  vidaEnMs?: number;
  tamano?: number;
}>;

type Guardado = Readonly<{ estado: EstadoDeLaResolucion; vence: number }>;

export function crearResolutorDePuerta(
  opciones: OpcionesDelResolutor,
): (hostCrudo: string) => Promise<EstadoDeLaResolucion> {
  const vida = Math.min(
    opciones.vidaEnMs ?? VIDA_MAXIMA_DE_LA_CACHE_EN_MS,
    VIDA_MAXIMA_DE_LA_CACHE_EN_MS,
  );
  const tamano = opciones.tamano ?? TAMANO_DE_LA_CACHE;
  const cache = new Map<string, Guardado>();

  async function consultar(host: string): Promise<EstadoDeLaResolucion> {
    for (const superficie of SUPERFICIES_SERVIBLES) {
      const respuesta = await opciones.consultarHost(host, superficie);
      if (!respuesta.ok) return HOST_NO_DISPONIBLE;
      if (respuesta.valor === null) continue;
      const marca = await opciones.leerMarca(respuesta.valor.marcaId);
      if (marca === null) return HOST_DESCONOCIDO;
      return {
        tipo: "RESUELTA",
        puerta: { host, superficie, marcaId: respuesta.valor.marcaId, marca },
      };
    }
    return HOST_DESCONOCIDO;
  }

  function guardar(host: string, estado: EstadoDeLaResolucion): void {
    // Se reinserta al final: el que más tiempo lleva sin refrescarse es el primero en salir.
    cache.delete(host);
    if (cache.size >= tamano) {
      const masViejo = cache.keys().next();
      if (masViejo.done !== true) cache.delete(masViejo.value);
    }
    cache.set(host, { estado, vence: opciones.ahora() + vida });
  }

  return async (hostCrudo) => {
    const host = opciones.normalizarHost(hostCrudo);
    if (host === null) return HOST_DESCONOCIDO;
    const guardado = cache.get(host);
    if (guardado !== undefined && opciones.ahora() < guardado.vence) return guardado.estado;
    let estado: EstadoDeLaResolucion;
    try {
      estado = await consultar(host);
    } catch {
      return HOST_NO_DISPONIBLE;
    }
    if (estado.tipo !== "NO_DISPONIBLE") guardar(host, estado);
    return estado;
  };
}
