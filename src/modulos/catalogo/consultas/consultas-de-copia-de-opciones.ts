import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type {
  DependenciasDeConsultasDeCatalogo,
  TxDeConsultasDeCatalogo,
} from "../casos-de-uso/contrato";
import type { ErrorDeCatalogo } from "../casos-de-uso/errores";
import { leerLoQueTraeLaCopia } from "../casos-de-uso/lo-que-trae-la-copia";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

type R<S> = Resultado<S, ErrorDeCatalogo>;

/** Un grupo de la vista previa de «Copiar de otro producto»: lo que se va a traer, con las opciones activas. `recargo` es texto decimal exacto, o `null` si la opción no lleva recargo. */
export type GrupoDeVistaPrevia = Readonly<{
  nombre: string;
  clase: "VARIANTE" | "INCLUIDA" | "ADICIONAL";
  opciones: readonly Readonly<{ nombre: string; recargo: string | null }>[];
}>;

/** Un recargo «cero» no tiene ningún dígito distinto de 0 (`0.00`): la vista previa no lo muestra (maqueta). */
const recargoParaMostrar = (recargo: string): string | null =>
  /[1-9]/.test(recargo) ? recargo : null;

/**
 * La consulta de la hoja «Copiar de otro producto» (A13, tramo Opciones). Solo lectura: no escribe ni audita (DEC-0731).
 */
export function crearConsultasDeCopiaDeOpciones(d: DependenciasDeConsultasDeCatalogo) {
  const leer = <S>(
    contexto: ContextoOperativo,
    accion: "productos.ver",
    trabajo: (tx: TxDeConsultasDeCatalogo) => Promise<S>,
  ): Promise<R<S>> =>
    d.transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<R<S>> => {
        const permiso = await exigirAccion(d.reglas, accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return ok(await trabajo(tx));
      },
    );

  return {
    /**
     * La vista previa de «Copiar de otro producto»: los grupos (con sus opciones activas) que `copiarOpciones` traería del origen al destino, calculados con la MISMA lectura y la MISMA regla
     * que la copia (`leerLoQueTraeLaCopia`). Origen o destino inexistente, de otra empresa o el mismo producto: lista vacía (no dice cuál es el caso). Permiso `productos.ver`.
     */
    vistaPreviaDeCopiaDeOpciones: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoOrigenId: string; productoDestinoId: string }>,
    ): Promise<R<readonly GrupoDeVistaPrevia[]>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.vistaPreviaDeCopiaDeOpciones.accion, async (tx) => {
        if (entrada.productoOrigenId === entrada.productoDestinoId) return [];
        const origen = await tx.productos.obtener(contexto.empresaId, entrada.productoOrigenId);
        const destino = await tx.productos.obtener(contexto.empresaId, entrada.productoDestinoId);
        if (origen === null || destino === null) return [];
        const grupos = await leerLoQueTraeLaCopia(
          tx,
          contexto.empresaId,
          origen,
          destino,
          contexto.ahora,
        );
        return grupos.map(({ grupo, opciones }) => ({
          nombre: grupo.nombre,
          clase: grupo.clase,
          opciones: opciones.map((o) => ({
            nombre: o.nombre,
            recargo: recargoParaMostrar(o.recargo),
          })),
        }));
      }),
  };
}
