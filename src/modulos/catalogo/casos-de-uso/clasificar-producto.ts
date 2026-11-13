import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { vigenteDesdeDesdeTexto } from "../../../primitivas/tiempo/vigente-desde";
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
  /** `YYYY-MM-DD`: desde qué día de Argentina rige (hoy o futuro, nunca pasado); `null` = desde ahora. */
  desde: string | null;
}>;
export type SalidaDeClasificarProducto = Readonly<{
  vinculoId: string;
  /** Desde cuándo rige: ahora (si no se dio fecha o es hoy) o la medianoche de Argentina de la fecha futura. */
  vigenteDesde: Date;
  yaExistia: boolean;
}>;

/**
 * Clasificar un producto (A2b, decisión 60; maqueta `clasificacion.html`): agrega un vínculo producto → nodo con la fecha desde la que rige. NO edita nada: el vínculo anterior
 * sigue (y queda además en la auditoría) y el que rige es el último con fecha hasta ahora; uno con fecha futura queda programado y convive con el vigente. Acción
 * `productos.editar` con alcance TODAS, como el resto de la ficha. El `id` lo manda la aplicación: repetir el mismo pedido (doble clic, reintento, o dos a la vez: el candado del árbol los serializa) devuelve el vínculo existente sin
 * duplicarlo ni volver a auditar, aunque ya pasara la fecha pedida; el mismo `id` con otro producto o nodo es `ID_REUTILIZADO`. El nodo tiene que existir en la empresa y estar
 * ACTIVO al asignarlo (un nodo desactivado después no se le saca al producto). Una fecha pasada se rechaza (tocaría la historia del producto): `FECHA_PASADA`.
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
        const vigenteDesde = vigenteDesdeDesdeTexto(entrada.desde, contexto.ahora);
        if (!vigenteDesde.ok) return vigenteDesde;
        const producto = await tx.productos.obtener(empresaId, entrada.productoId);
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
        if (entrada.nodoId !== null) {
          const nodo = await tx.clasificacion.obtener(empresaId, entrada.nodoId);
          if (nodo === null) return err("NODO_INEXISTENTE");
          if (!nodo.activo) return err("NODO_DESACTIVADO");
        }
        const { vigente: antes } = await tx.clasificacion.clasificacionDelProducto(
          empresaId,
          entrada.productoId,
          contexto.ahora,
        );
        const creado = await tx.clasificacion.insertarVinculo(empresaId, {
          id: entrada.id,
          productoId: entrada.productoId,
          nodoId: entrada.nodoId,
          vigenteDesde: vigenteDesde.valor,
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
