import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../dominio/identificadores";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

/** Tope de secciones de una carta (supuesto de la especificación §6.1): una lista más larga no es de una carta. */
const MAXIMO_DE_SECCIONES = 200;

export type EntradaDeReordenarSecciones = Readonly<{
  /** TODAS las secciones activas de la empresa, una vez cada una, en el orden nuevo, cada una con la versión que vio quien las ordenó. */
  secciones: readonly Readonly<{ seccionId: string; versionEsperada: number }>[];
}>;

export type SalidaDeReordenarSecciones = Readonly<{
  /** Cuántas secciones cambiaron de lugar; 0 si el orden pedido ya era el vigente (`SIN_CAMBIOS`). */
  movidas: number;
}>;

/**
 * Reordenar las secciones de la carta de una vez, todo o nada (carta real §6.1). Acción `productos.editar`, como las otras secciones, con alcance TODAS. La lista
 * tiene que traer TODAS las secciones activas, una vez cada una: si falta una (alguien creó otra mientras se arrastraba) es `LISTA_DE_SECCIONES_INCOMPLETA`; si
 * una se repite, `SECCION_REPETIDA`; una de otra empresa, apagada o inexistente, `SECCION_NO_ENCONTRADA` (el mismo error). Toma TODAS las filas activas con
 * `FOR UPDATE` en orden fijo (por `id`): dos reordenamientos a la vez se ponen en fila. Si el orden pedido ya es el vigente es éxito sin escribir ni auditar
 * (aunque las versiones sean viejas: es repetir lo ya aplicado). Si no, compara las versiones de TODAS: si una cambió, se rechaza todo
 * (`VERSION_DESACTUALIZADA`); si no, asigna `orden` = posición (0, 1, 2…) en la misma transacción.
 */
export function armarReordenarSeccionesDeCarta(dependencias: DependenciasDeCatalogo) {
  return async function reordenarSeccionesDeCarta(
    contexto: ContextoOperativo,
    entrada: EntradaDeReordenarSecciones,
  ): Promise<R<SalidaDeReordenarSecciones>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeReordenarSecciones>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        const pedidas = entrada.secciones;
        if (pedidas.length > MAXIMO_DE_SECCIONES) return err("ORDEN_INVALIDO");
        if (
          pedidas.some(
            (s) =>
              !esUuid(s.seccionId) || !Number.isInteger(s.versionEsperada) || s.versionEsperada < 1,
          )
        )
          return err("IDENTIFICADOR_INVALIDO");
        if (new Set(pedidas.map((s) => s.seccionId.toLowerCase())).size !== pedidas.length)
          return err("SECCION_REPETIDA");

        const activas = await tx.seccionesDeCarta.bloquearActivas(empresaId);
        const porId = new Map(activas.map((s) => [s.id.toLowerCase(), s]));
        if (pedidas.some((s) => !porId.has(s.seccionId.toLowerCase())))
          return err("SECCION_NO_ENCONTRADA");
        if (pedidas.length !== activas.length) return err("LISTA_DE_SECCIONES_INCOMPLETA");

        const nuevas = pedidas.map((p, posicion) => ({
          actual: porId.get(p.seccionId.toLowerCase()) as (typeof activas)[number],
          posicion,
          versionEsperada: p.versionEsperada,
        }));
        const aMover = nuevas.filter((n) => n.actual.orden !== n.posicion);
        if (aMover.length === 0) return ok({ movidas: 0 });
        if (nuevas.some((n) => n.actual.version !== n.versionEsperada))
          return err("VERSION_DESACTUALIZADA");
        for (const n of aMover) {
          const movida = await tx.seccionesDeCarta.cambiarOrden(
            empresaId,
            n.actual.id,
            n.actual.version,
            n.posicion,
          );
          if (movida === null) return err("VERSION_DESACTUALIZADA");
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "SECCIONES_DE_CARTA_REORDENADAS",
          entidad: "seccion_de_carta",
          entidadId: aMover[0]?.actual.id as string,
          antes: { orden: nuevas.map((n) => ({ id: n.actual.id, orden: n.actual.orden })) },
          despues: { orden: nuevas.map((n) => ({ id: n.actual.id, orden: n.posicion })) },
        });
        return ok({ movidas: aMover.length });
      },
    );
    return traducir(resultado);
  };
}
