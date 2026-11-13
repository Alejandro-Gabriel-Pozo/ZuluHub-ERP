import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { caminoDeNodo, type ArbolDeClasificacion } from "../../../primitivas/clasificacion/arbol";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeConsultasDeCatalogo } from "../casos-de-uso/contrato";
import type { VinculoGuardado } from "../persistencia/repositorio-de-clasificacion";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

type R<S> = Resultado<S, MotivoDeRechazo | ErrorDePersistencia>;

/** Un vínculo con su camino ya resuelto, del departamento hasta el nodo (vacío si es «Sin elegir»). */
export type VinculoParaLaFicha = Readonly<{
  vinculoId: string;
  nodoId: string | null;
  desde: Date;
  camino: readonly Readonly<{ id: string; nombre: string }>[];
}>;

export type ClasificacionParaLaFicha = Readonly<{
  /** Lo que rige ahora; `null` = nunca se clasificó (o solo hay cambios programados): «Sin elegir». */
  vigente: VinculoParaLaFicha | null;
  /** Los cambios con fecha futura, del más próximo al más lejano. */
  programados: readonly VinculoParaLaFicha[];
}>;

/**
 * La clasificación de un producto para su ficha (A2b): la vigente con «Vigente desde» y los cambios programados, con el camino (departamento y categorías) de cada uno. Pide
 * `productos.ver` (los tres roles). Un producto de otra empresa o inexistente es `null`, indistinguible. El historial completo NO se muestra (decidido: queda en la auditoría).
 */
export function crearConsultasDeClasificacionDeProducto(d: DependenciasDeConsultasDeCatalogo) {
  return {
    verClasificacionDelProducto: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoId: string }>,
    ): Promise<R<ClasificacionParaLaFicha | null>> =>
      d.transacciones.ejecutar(
        { contexto, aislamiento: "read committed", soloLectura: true },
        async (tx): Promise<R<ClasificacionParaLaFicha | null>> => {
          const permiso = await exigirAccion(
            d.reglas,
            DECLARACIONES_DE_CONSULTAS.verClasificacionDelProducto.accion,
            () => tx.autorizacion.delActor(contexto),
          );
          if (!permiso.ok) return permiso;
          const producto = await tx.productos.obtener(contexto.empresaId, entrada.productoId);
          if (producto === null) return ok(null);
          const nodos = await tx.clasificacion.todos(contexto.empresaId);
          const arbol: ArbolDeClasificacion = new Map(
            nodos.map((n) => [n.id, { id: n.id, padreId: n.padreId, activo: n.activo }]),
          );
          const nombres = new Map(nodos.map((n) => [n.id, n.nombre]));
          const paraLaFicha = (v: VinculoGuardado): VinculoParaLaFicha => {
            const camino = v.nodoId === null ? null : caminoDeNodo(arbol, v.nodoId);
            return {
              vinculoId: v.id,
              nodoId: v.nodoId,
              desde: v.vigenteDesde,
              // Un nodo cuyo camino no se puede calcular (árbol dañado) sale sin camino: nunca se inventa uno.
              camino:
                camino === null || !camino.ok
                  ? []
                  : camino.valor.map((id) => ({ id, nombre: nombres.get(id) ?? "" })),
            };
          };
          const { vigente, programados } = await tx.clasificacion.clasificacionDelProducto(
            contexto.empresaId,
            entrada.productoId,
            contexto.ahora,
          );
          return ok({
            vigente: vigente === null ? null : paraLaFicha(vigente),
            programados: programados.map(paraLaFicha),
          });
        },
      ),
  };
}
