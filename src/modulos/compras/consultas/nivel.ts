import { nivelDeComprasDentro, type NivelDeComprasVigente } from "../casos-de-uso/lectura-nivel";
import { type Lector, type RDeConsulta } from "./comun";

export type { NivelDeComprasVigente };

export function armarConsultasDeNivel(leer: Lector) {
  return {
    /**
     * El nivel de operación de las compras de la empresa y su versión (guard `compras.configurar`, solo gerente). Es una LECTURA que NO escribe: ver `nivelDeComprasDentro`. Mirar no crea nada.
     */
    nivelDeCompras(contexto: Parameters<Lector>[0]): Promise<RDeConsulta<NivelDeComprasVigente>> {
      return leer(contexto, ["compras.configurar"], (tx) => nivelDeComprasDentro(tx, contexto));
    },
  };
}
