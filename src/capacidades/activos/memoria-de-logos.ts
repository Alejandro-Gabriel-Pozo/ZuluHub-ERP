import type { Resultado } from "../../primitivas/resultado/resultado";

/**
 * La memoria del servidor para los logos de carta traídos de afuera (carta, §5.7.5). Tres cosas, todas acotadas:
 *  - Lo bueno se guarda (a lo sumo `capacidad` logos, el menos usado sale primero): una visita repetida no vuelve a salir a internet.
 *  - Lo que falló de forma definitiva se recuerda `retencionDeFallosMs` (5 minutos): un enlace roto, o un tercero que se cuelga, no se vuelve a pedir en cada visita.
 *    Lo transitorio («no hay lugar ahora») no se recuerda.
 *  - Pedidos iguales a la vez comparten UN solo viaje: 100 visitas simultáneas a la misma carta son una conexión saliente, no cien.
 * Vive en la memoria de cada instancia del servidor y no guarda nada entre instancias ni en la base: perderla solo cuesta un pedido más. La clave la arma quien la usa
 * (carta y dirección canónica del logo), así un logo cambiado nunca recibe los bytes del anterior.
 */

export const CAPACIDAD_DE_LA_MEMORIA_DE_LOGOS = 200;
export const RETENCION_DE_FALLOS_MS = 300_000;

export type FalloDeTraida = "DEFINITIVO" | "TRANSITORIO";

export type MemoriaDeLogos = Readonly<{
  /** Los bytes del logo, o `null` si no se pudo. `traer` no se llama si ya hay bytes, si hay un fallo vigente o si ya hay otro viaje en curso con la misma clave. */
  obtener(
    clave: string,
    traer: () => Promise<Resultado<Uint8Array, FalloDeTraida>>,
  ): Promise<Uint8Array | null>;
}>;

export function crearMemoriaDeLogos(
  ahora: () => number,
  opciones: Readonly<{ capacidad?: number; retencionDeFallosMs?: number }> = {},
): MemoriaDeLogos {
  const capacidad = opciones.capacidad ?? CAPACIDAD_DE_LA_MEMORIA_DE_LOGOS;
  const retencion = opciones.retencionDeFallosMs ?? RETENCION_DE_FALLOS_MS;
  /** `Map` recuerda el orden de alta: el primero es el menos usado. */
  const buenos = new Map<string, Uint8Array>();
  const fallos = new Map<string, number>();
  const enCurso = new Map<string, Promise<Uint8Array | null>>();

  /** Saca los menos usados hasta que quepan. */
  const acotar = <V>(mapa: Map<string, V>): void => {
    for (const clave of mapa.keys()) {
      if (mapa.size <= capacidad) return;
      mapa.delete(clave);
    }
  };

  async function viajar(
    clave: string,
    traer: () => Promise<Resultado<Uint8Array, FalloDeTraida>>,
  ): Promise<Uint8Array | null> {
    try {
      const traido = await traer();
      if (traido.ok) {
        buenos.set(clave, traido.valor);
        acotar(buenos);
        return traido.valor;
      }
      if (traido.error === "DEFINITIVO") {
        fallos.set(clave, ahora() + retencion);
        acotar(fallos);
      }
      return null;
    } finally {
      enCurso.delete(clave);
    }
  }

  return {
    obtener(clave, traer) {
      const guardado = buenos.get(clave);
      if (guardado !== undefined) {
        // Usado ahora: pasa a ser el más nuevo.
        buenos.delete(clave);
        buenos.set(clave, guardado);
        return Promise.resolve(guardado);
      }
      // Un fallo vencido queda hasta que lo pise otro o lo saque el tope: no cambia ninguna respuesta.
      const venceElFallo = fallos.get(clave) ?? Number.NEGATIVE_INFINITY;
      if (ahora() < venceElFallo) return Promise.resolve(null);
      const viajando = enCurso.get(clave);
      if (viajando !== undefined) return viajando;
      const nuevo = viajar(clave, traer);
      enCurso.set(clave, nuevo);
      return nuevo;
    },
  };
}
