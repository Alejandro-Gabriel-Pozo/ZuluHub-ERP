import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../dominio/identificadores";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeClasificarProducto = Readonly<{
  /** Lo manda la aplicación: es la clave de idempotencia del cambio. */
  id: string;
  productoId: string;
  /** El nodo (departamento o categoría) donde queda el producto; `null` = volver a «Sin elegir». */
  nodoId: string | null;
}>;
export type SalidaDeClasificarProducto = Readonly<{
  vinculoId: string;
  /** Desde cuándo rige: el instante del guardado (el cambio rige solo desde ahora). */
  vigenteDesde: Date;
  yaExistia: boolean;
}>;

/**
 * Clasificar un producto (A2b, decisión 60; maqueta `clasificacion.html`): agrega un vínculo producto → nodo que rige DESDE AHORA (decisión del dueño del 13/11/2026: sin fecha
 * futura ni cambios programados, como los precios). NO edita nada: el vínculo anterior sigue (y queda además en la auditoría) y el que rige es el último guardado. Acción
 * `productos.editar` con alcance TODAS, como el resto de la ficha. El `id` lo manda la aplicación: repetir el mismo pedido (doble clic, reintento, o dos a la vez: el candado del árbol
 * los serializa) devuelve el vínculo existente sin duplicarlo ni volver a auditar; el mismo `id` con otro producto o nodo es `ID_REUTILIZADO`. El nodo tiene que existir en la
 * empresa y estar ACTIVO al asignarlo (un nodo desactivado después no se le saca al producto). Dos cambios del mismo producto en el MISMO instante chocan con la única de la base
 * (`CLASIFICACION_EN_ESA_FECHA`): el segundo se reintenta.
 */
export function armarClasificarProducto(dependencias: DependenciasDeCatalogo) {
  return async function clasificarProducto(
    contexto: ContextoOperativo,
    entrada: EntradaDeClasificarProducto,
  ): Promise<R<SalidaDeClasificarProducto>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto, aislamiento: "read committed" },
      async (tx): Promise<R<SalidaDeClasificarProducto>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        // La clave de `cargado_por` es la persona del contexto: sin persona nadie clasifica (la autorización ya lo dejó afuera; esto es el cierre del tipo).
        if (contexto.personaId === null) return err("SIN_PERMISO");
        if (
          !esUuid(entrada.id) ||
          !esUuid(entrada.productoId) ||
          (entrada.nodoId !== null && !esUuid(entrada.nodoId))
        ) {
          return err("IDENTIFICADOR_INVALIDO");
        }
        // El mismo candado del árbol: serializa este cambio con los de los nodos (un nodo no se desactiva entre mirarlo y asignarlo) y con el mismo pedido repetido a la vez.
        await tx.clasificacion.bloquearArbol(empresaId);
        const previo = await tx.clasificacion.vinculo(empresaId, entrada.id);
        if (previo !== null) {
          const igual =
            previo.productoId === entrada.productoId && previo.nodoId === entrada.nodoId;
          return igual
            ? ok({ vinculoId: previo.id, vigenteDesde: previo.vigenteDesde, yaExistia: true })
            : err("ID_REUTILIZADO");
        }
        const producto = await tx.productos.obtener(empresaId, entrada.productoId);
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
        if (entrada.nodoId !== null) {
          const nodo = await tx.clasificacion.obtener(empresaId, entrada.nodoId);
          if (nodo === null) return err("NODO_INEXISTENTE");
          if (!nodo.activo) return err("NODO_DESACTIVADO");
        }
        const antes = await tx.clasificacion.vigenteDelProducto(empresaId, entrada.productoId);
        const creado = await tx.clasificacion.insertarVinculo(empresaId, {
          id: entrada.id,
          productoId: entrada.productoId,
          nodoId: entrada.nodoId,
          vigenteDesde: contexto.ahora,
          cargadoPor: contexto.personaId,
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "PRODUCTO_CLASIFICADO",
          entidad: "producto",
          entidadId: entrada.productoId,
          antes: { nodoId: antes === null ? null : antes.nodoId },
          despues: { nodoId: creado.nodoId, vigenteDesde: creado.vigenteDesde.toISOString() },
        });
        return ok({ vinculoId: creado.id, vigenteDesde: creado.vigenteDesde, yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}
