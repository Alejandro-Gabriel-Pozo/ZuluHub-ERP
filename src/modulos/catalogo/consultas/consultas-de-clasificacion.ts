import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  caminoDeNodo,
  destinosParaMover,
  type ArbolDeClasificacion,
} from "../../../primitivas/clasificacion/arbol";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type {
  DependenciasDeConsultasDeCatalogo,
  TxDeConsultasDeCatalogo,
} from "../casos-de-uso/contrato";
import type { NodoGuardado } from "../persistencia/repositorio-de-clasificacion";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

type R<S> = Resultado<S, MotivoDeRechazo | ErrorDePersistencia | "NODO_INEXISTENTE">;

/** Un nodo de la lista: lo que la pantalla necesita para dibujar el árbol (el nivel sale del camino: 1 = departamento). */
export type NodoDeLista = Readonly<{
  id: string;
  padreId: string | null;
  nombre: string;
  activo: boolean;
  version: number;
  nivel: number;
}>;

const arbolDe = (nodos: readonly NodoGuardado[]): ArbolDeClasificacion =>
  new Map(nodos.map((n) => [n.id, { id: n.id, padreId: n.padreId, activo: n.activo }]));

/**
 * Las consultas de la clasificación comercial (A2b), de solo lectura: cada una pide `productos.ver` (los tres roles). Lo de otra empresa no se ve nunca. La pantalla
 * NO replica las reglas del árbol: pide acá los destinos válidos de un movimiento y apaga el resto; el servidor igual vuelve a decidir al mover.
 */
export function crearConsultasDeClasificacion(d: DependenciasDeConsultasDeCatalogo) {
  const leer = <S>(
    contexto: ContextoOperativo,
    trabajo: (tx: TxDeConsultasDeCatalogo) => Promise<R<S>>,
  ): Promise<R<S>> =>
    d.transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<R<S>> => {
        const permiso = await exigirAccion(
          d.reglas,
          DECLARACIONES_DE_CONSULTAS.listarClasificacion.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return trabajo(tx);
      },
    );

  return {
    /**
     * TODOS los nodos de la empresa, activos o no, con su nivel y por nombre: un nodo desactivado se ve tachado en la administración y no se ofrece en el selector
     * (la pantalla filtra por `activo`). Un árbol dañado (un nivel que no se puede calcular) deja el nodo con nivel 0: nunca se inventa uno.
     */
    listarClasificacion: (contexto: ContextoOperativo): Promise<R<readonly NodoDeLista[]>> =>
      leer(contexto, async (tx) => {
        const nodos = await tx.clasificacion.todos(contexto.empresaId);
        const arbol = arbolDe(nodos);
        return ok(
          nodos.map((n) => {
            const camino = caminoDeNodo(arbol, n.id);
            return {
              id: n.id,
              padreId: n.padreId,
              nombre: n.nombre,
              activo: n.activo,
              version: n.version,
              nivel: camino.ok ? camino.valor.length : 0,
            };
          }),
        );
      }),

    /** Los ids que pueden ser el nuevo padre de un nodo (vacío si no se puede mover, por ejemplo un departamento): la pantalla apaga todo lo demás. */
    destinosParaMoverNodo: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ nodoId: string }>,
    ): Promise<R<readonly string[]>> =>
      leer(contexto, async (tx) => {
        const nodos = await tx.clasificacion.todos(contexto.empresaId);
        if (!nodos.some((n) => n.id === entrada.nodoId)) return err("NODO_INEXISTENTE");
        return ok([...destinosParaMover(arbolDe(nodos), entrada.nodoId)].sort());
      }),
  };
}
