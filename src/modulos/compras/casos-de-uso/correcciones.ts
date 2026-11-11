import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import { calcularLinea } from "../dominio/calcular-linea";
import {
  camposDeHuellaDeCorreccion,
  cantidadConsumida,
  esElMismoPrecio,
  leerCorreccion,
} from "../dominio/correccion";
import { decidirPorHuella, huellaDeComando } from "../dominio/huella";
import type { LineaDeRecepcion } from "../persistencia/repositorio-de-recepciones";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

type R<S> = Resultado<S, ErrorDeCompras>;

export type EntradaDeCorregirCompra = Readonly<{
  /** Un UUID que genera la pantalla al abrir: es la idempotencia de la corrección. */
  clave: string;
  recepcionId: string;
  linea: number;
  /** Cuántas correcciones de esta línea había cuando se miró la compra (0 si ninguna): la versión optimista. */
  correccionesVistas: number;
  /** El precio corregido, texto decimal de hasta 6 decimales, mayor que cero, en el mismo «precio por» y unidad de precio de la línea. */
  precio: string;
  motivo: string;
}>;

export type SalidaDeCorregirCompra = Readonly<{
  recepcionId: string;
  linea: number;
  numero: number;
  yaExistia: boolean;
  /** Solo la primera vez (`null` al repetir): el efecto de la corrección. */
  ajuste: Readonly<{
    costoPorUnidadAntes: string;
    costoPorUnidadDespues: string;
    /** El promedio del depósito antes y después; `null` si la línea no entró a stock con costo. */
    promedioAntes: string | null;
    promedioDespues: string | null;
    /** Lo que ya no estaba cuando se corrigió (entró − queda): conserva su costo congelado. `null` si la línea no entró a stock. */
    consumidoAlCorregir: string | null;
  }> | null;
}>;

/** La cuenta de la línea guardada con el precio dado (la misma `calcularLinea` del alta): importe y costo por unidad de stock. */
async function costoDeLaLinea(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  linea: LineaDeRecepcion,
  precio: string,
): Promise<R<string>> {
  const producto = await tx.productosParaCompras.bloquearCompartido(
    contexto.empresaId,
    linea.productoId,
  );
  if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
  let presentacion = null;
  if (linea.presentacionId !== null) {
    presentacion = await tx.presentacionesDeProducto.obtener(
      contexto.empresaId,
      linea.presentacionId,
    );
    if (presentacion === null) return err("PRESENTACION_NO_ENCONTRADA");
  }
  const cuenta = calcularLinea({
    unidadBase: producto.unidadBaseId as CodigoDeUnidad,
    presentacion:
      presentacion === null
        ? null
        : { cantidadEnBase: presentacion.cantidad, dePesoVariable: presentacion.dePesoVariable },
    unidadDeCompra: linea.unidadDeCompraId as CodigoDeUnidad,
    cantidadDeCompra: linea.cantidadDeCompra,
    pesoReal: linea.pesoReal,
    precioPor: linea.precioPorTipo as "PRESENTACION" | "UNIDAD",
    unidadDePrecio: linea.unidadDePrecioId as CodigoDeUnidad | null,
    precio,
  });
  if (!cuenta.ok) return cuenta;
  // Con precio, el costo por unidad nunca es `null` (la cuenta devuelve los dos o ninguno).
  return ok(cuenta.valor.costoPorUnidadDeStock as string);
}

/**
 * Corregir el PRECIO de una línea de una compra ya hecha (E9 §3.7, T11, D143): no se anula y se recarga, se corrige con un ajuste y un motivo. Guard
 * `compras.corregir` (gerente y administrador). La corrección es una fila nueva (la línea original no se edita) con el precio de antes y el de ahora, y el costo
 * de lo que entró a stock se corrige por el puerto de stock `ajusteDeCostoPorOrigen` (fórmula A de la P-2: la diferencia sobre lo que QUEDA de la compra; lo ya
 * consumido conserva su costo congelado). Todo en UNA transacción: una falla en el ajuste de costo no deja la corrección (A3). La recepción se bloquea: dos
 * correcciones a la vez de la misma línea dejan una (la otra, `CORRECCION_DESACTUALIZADA`, C4) y una corrección y una anulación de la compra se serializan (C5).
 * Repetición (`CLAVE_DE_IDEMPOTENCIA`, I6): misma clave y mismo contenido devuelve la corrección con `yaExistia` sin escribir ni auditar; otro contenido,
 * `CLAVE_REUTILIZADA`. Una línea sin precio no se corrige acá (`LINEA_SIN_PRECIO`: la corrección no guarda el «precio por» del precio nuevo; DEC-0319).
 */
export function armarCorregirCompra(dependencias: DependenciasDeCompras) {
  return async function corregirCompra(
    contexto: ContextoOperativo,
    entrada: EntradaDeCorregirCompra,
  ): Promise<R<SalidaDeCorregirCompra>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    const pedido = leerCorreccion(entrada);
    if (!pedido.ok) return pedido;
    const p = pedido.valor;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeCorregirCompra>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, ["compras.corregir"]);
          if (!permiso.ok) return permiso;
          const recepcion = await tx.recepciones.bloquear(empresaId, p.recepcionId);
          if (recepcion === null) return err("RECEPCION_NO_ENCONTRADA");
          const alcance = await exigirAlcanceDeSucursal(
            tx,
            contexto,
            sucursalId(recepcion.sucursalId),
          );
          if (!alcance.ok) return alcance;

          const huella = huellaDeComando("corregir_compra", camposDeHuellaDeCorreccion(p), []);
          const previa = await tx.correccionesDeCompra.porClave(empresaId, p.clave);
          if (previa !== null) {
            return decidirPorHuella(previa.huella, huella) === "REPETIDA"
              ? ok({
                  recepcionId: previa.recepcionId,
                  linea: previa.linea,
                  numero: previa.numero,
                  yaExistia: true,
                  ajuste: null,
                })
              : err("CLAVE_REUTILIZADA");
          }
          if (recepcion.estado === "ANULADA") return err("RECEPCION_YA_ANULADA");
          const lineas = await tx.recepciones.lineasDe(empresaId, recepcion.id);
          const linea = lineas.find((l) => l.numero === p.linea);
          if (linea === undefined) return err("LINEA_NO_ENCONTRADA");
          if (linea.precio === null) return err("LINEA_SIN_PRECIO");

          const ultima = await tx.correccionesDeCompra.ultimaDeLaLinea(
            empresaId,
            recepcion.id,
            linea.numero,
          );
          if ((ultima?.numero ?? 0) !== p.correccionesVistas) {
            return err("CORRECCION_DESACTUALIZADA");
          }
          const precioVigente = ultima?.precioNuevo ?? linea.precio;
          if (esElMismoPrecio(precioVigente, p.precio)) return err("SIN_CAMBIOS");

          const costoAntes = await costoDeLaLinea(tx, contexto, linea, precioVigente);
          if (!costoAntes.ok) return costoAntes;
          const costoDespues = await costoDeLaLinea(tx, contexto, linea, p.precio);
          if (!costoDespues.ok) return costoDespues;

          const numero = p.correccionesVistas + 1;
          const guardada = await tx.correccionesDeCompra.insertar(empresaId, {
            recepcionId: recepcion.id,
            linea: linea.numero,
            numero,
            precioAnterior: precioVigente,
            precioNuevo: p.precio,
            motivo: p.motivo,
            clave: p.clave,
            huella,
            registradoPor: persona,
          });
          if (!guardada) {
            throw new Error(
              "la corrección chocó con una restricción única bajo el bloqueo de la recepción",
            );
          }

          let consumidoAlCorregir: string | null = null;
          let promedioAntes: string | null = null;
          let promedioDespues: string | null = null;
          if (linea.movimientoId !== null && linea.depositoId !== null) {
            const stock = await autorizar(tx, contexto, dependencias.reglas, ["stock.ajustar"]);
            if (!stock.ok) return stock;
            const ajuste = await dependencias.stock.ajusteDeCostoPorOrigen.ajustar(tx, contexto, {
              origen: { tipo: "CORRECCION_DE_COMPRA", id: recepcion.id },
              depositoId: linea.depositoId,
              productoId: linea.productoId,
              costoAnterior: costoAntes.valor,
              costoNuevo: costoDespues.valor,
              cantidadQueEntro: linea.cantidadEnStock,
            });
            if (!ajuste.ok) return ajuste;
            promedioAntes = ajuste.valor.costoAntes;
            promedioDespues = ajuste.valor.costoDespues;
            consumidoAlCorregir = cantidadConsumida(
              linea.cantidadEnStock,
              ajuste.valor.cantidadQueQueda,
            );
          }
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "COMPRA_CORREGIDA",
            entidad: "recepcion",
            entidadId: recepcion.id,
            antes: { linea: linea.numero, precio: precioVigente, costoPorUnidad: costoAntes.valor },
            despues: {
              linea: linea.numero,
              numero,
              precio: p.precio,
              costoPorUnidad: costoDespues.valor,
              motivo: p.motivo,
              consumidoAlCorregir,
            },
          });
          return ok({
            recepcionId: recepcion.id,
            linea: linea.numero,
            numero,
            yaExistia: false,
            ajuste: {
              costoPorUnidadAntes: costoAntes.valor,
              costoPorUnidadDespues: costoDespues.valor,
              promedioAntes,
              promedioDespues,
              consumidoAlCorregir,
            },
          });
        },
      ),
    );
  };
}
