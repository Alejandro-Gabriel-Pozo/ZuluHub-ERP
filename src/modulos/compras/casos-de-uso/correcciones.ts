import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import { calcularLinea } from "../dominio/calcular-linea";
import { alicuotaQueEntraAlCosto } from "../dominio/iva-en-el-costo";
import { discriminaIva, type AlicuotaDeCompra } from "../dominio/comprobante";
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
    /** `null` si la línea no tenía precio (se la completó). */
    costoPorUnidadAntes: string | null;
    costoPorUnidadDespues: string;
    /** El promedio del depósito antes y después; `null` si la línea no entró a stock con costo. */
    promedioAntes: string | null;
    promedioDespues: string | null;
    /** Lo que ya no estaba cuando se corrigió (entró − queda): conserva su costo congelado. `null` si la línea no entró a stock. */
    consumidoAlCorregir: string | null;
  }> | null;
}>;

/** La cuenta de la línea guardada con el precio dado (la misma `calcularLinea` del alta): importe y costo por unidad de stock. */
export async function costoDeLaLinea(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  linea: LineaDeRecepcion,
  precio: string,
  alicuotaDeIvaEnElCosto: AlicuotaDeCompra | null,
  /** El «precio por» que rige: el de la línea, o el de la corrección que completó su precio (una línea «Sin precio» no lo tiene guardado). */
  precioPor: Readonly<{
    precioPorTipo: "PRESENTACION" | "UNIDAD" | null;
    unidadDePrecioId: string | null;
  }> = linea,
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
    precioPor: precioPor.precioPorTipo as "PRESENTACION" | "UNIDAD",
    unidadDePrecio: precioPor.unidadDePrecioId as CodigoDeUnidad | null,
    precio,
    alicuotaDeIvaEnElCosto,
  });
  if (!cuenta.ok) return cuenta;
  // Con precio, el costo por unidad nunca es `null` (la cuenta devuelve los dos o ninguno).
  return ok(cuenta.valor.costoPorUnidadDeStock as string);
}

/** El IVA que entra al costo de una línea ya registrada: sale de la línea de la factura VIGENTE de la compra que la cubre; sin factura vigente, ninguno. */
export async function alicuotaDelCosto(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  recepcionId: string,
  numeroDeLinea: number,
): Promise<R<AlicuotaDeCompra | null>> {
  const comprobante = await tx.comprobantesDeProveedor.delaRecepcion(
    contexto.empresaId,
    recepcionId,
  );
  if (comprobante === null || comprobante.estado !== "REGISTRADO" || comprobante.tipo === null) {
    return ok(null);
  }
  const condicion = discriminaIva(comprobante.tipo)
    ? await dependencias.ivaDeLaEmpresa.condicion(tx, contexto)
    : null;
  const lineas = await tx.detalleDeComprobantes.lineasDe(contexto.empresaId, comprobante.id);
  const cubre = lineas.find(
    (l) => l.recepcionId === recepcionId && l.lineaDeRecepcion === numeroDeLinea,
  );
  return alicuotaQueEntraAlCosto(condicion, comprobante.tipo, cubre?.alicuota ?? null);
}

/**
 * Corregir el PRECIO de una línea de una compra ya hecha (E9 §3.7, T11, D143): no se anula y se recarga, se corrige con un ajuste y un motivo. Guard
 * `compras.corregir` (gerente y administrador). La corrección es una fila nueva (la línea original no se edita) con el precio de antes y el de ahora, y el costo
 * de lo que entró a stock se corrige por el puerto de stock `ajusteDeCostoPorOrigen` (fórmula A de la P-2: la diferencia sobre lo que QUEDA de la compra; lo ya
 * consumido conserva su costo congelado). Todo en UNA transacción: una falla en el ajuste de costo no deja la corrección (A3). La recepción se bloquea: dos
 * correcciones a la vez de la misma línea dejan una (la otra, `CORRECCION_DESACTUALIZADA`, C4) y una corrección y una anulación de la compra se serializan (C5).
 * Repetición (`CLAVE_DE_IDEMPOTENCIA`, I6): misma clave y mismo contenido devuelve la corrección con `yaExistia` sin escribir ni auditar; otro contenido,
 * `CLAVE_REUTILIZADA`. Completar el precio de una línea «Sin precio» es una corrección con su «precio por» (migración 0093): el costo entra a la línea y al promedio del depósito (antes `null`), y la oferta del proveedor la toma como una compra más (la más nueva gana). Cambiar la cantidad o el peso real, con su ajuste de stock, queda para el tramo siguiente (`CORRECCION_DE_CANTIDAD_NO_DISPONIBLE`).
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
          // Corregir la cantidad o el peso real (con su ajuste de stock) viene en el tramo siguiente: hasta entonces no se acepta (nunca se ignora en silencio).
          if (p.cantidad !== null || p.pesoReal !== null) {
            return err("CORRECCION_DE_CANTIDAD_NO_DISPONIBLE");
          }
          const delaLinea = (
            await tx.correccionesDeCompra.deLaRecepcion(empresaId, recepcion.id)
          ).filter((c) => c.linea === linea.numero);
          const ultima = delaLinea[delaLinea.length - 1] ?? null;
          if ((ultima?.numero ?? 0) !== p.correccionesVistas) {
            return err("CORRECCION_DESACTUALIZADA");
          }
          // Lo que rige hoy: el precio de la última corrección que lo cambió (o el de la línea) y su «precio por» (el de la corrección que completó una línea «Sin precio»).
          const completo = [...delaLinea].reverse().find((c) => c.precioPorTipo !== null) ?? null;
          const precioVigente =
            [...delaLinea].reverse().find((c) => c.precioNuevo !== null)?.precioNuevo ??
            linea.precio;
          const porVigente =
            precioVigente === null
              ? { precioPorTipo: null, unidadDePrecioId: null }
              : completo !== null
                ? {
                    precioPorTipo: completo.precioPorTipo,
                    unidadDePrecioId: completo.unidadDePrecioId,
                  }
                : { precioPorTipo: linea.precioPorTipo, unidadDePrecioId: linea.unidadDePrecioId };
          // Completar «Sin precio»: trae su «precio por»; una línea que ya tiene precio no lo cambia.
          const completando = precioVigente === null;
          if (completando !== (p.precioPor !== null)) return err("PRECIO_POR_INVALIDO");
          const precioNuevo = p.precio as string;
          if (esElMismoPrecio(precioVigente, precioNuevo)) return err("SIN_CAMBIOS");
          const porNuevo = completando
            ? { precioPorTipo: p.precioPor, unidadDePrecioId: p.unidadDePrecio }
            : porVigente;

          // El IVA que entra al costo: la MISMA regla del registro (`alicuotaQueEntraAlCosto`), con la alícuota de la línea de la factura que cubre esta línea y la condición
          // de la empresa de hoy (DEC-0324). Sin factura vigente (o una B o C) el costo es el importe de la línea.
          const alicuota = await alicuotaDelCosto(
            tx,
            contexto,
            dependencias,
            recepcion.id,
            linea.numero,
          );
          if (!alicuota.ok) return alicuota;
          // Antes: el costo que la línea declaró al registrarse (el guardado) mientras no se haya corregido; después de una corrección, el de su precio vigente; una línea «Sin precio» no tenía costo.
          const costoAntes: R<string | null> = completando
            ? ok(null)
            : ultima === null
              ? ok(linea.costoPorUnidadDeStock as string)
              : await costoDeLaLinea(
                  tx,
                  contexto,
                  linea,
                  precioVigente,
                  alicuota.valor,
                  porVigente,
                );
          if (!costoAntes.ok) return costoAntes;
          const costoDespues = await costoDeLaLinea(
            tx,
            contexto,
            linea,
            precioNuevo,
            alicuota.valor,
            porNuevo,
          );
          if (!costoDespues.ok) return costoDespues;

          const numero = p.correccionesVistas + 1;
          const guardada = await tx.correccionesDeCompra.insertar(empresaId, {
            recepcionId: recepcion.id,
            linea: linea.numero,
            numero,
            precioAnterior: precioVigente,
            precioNuevo,
            cantidadAnterior: null,
            cantidadNueva: null,
            pesoRealAnterior: null,
            pesoRealNuevo: null,
            precioPorTipo: completando ? p.precioPor : null,
            unidadDePrecioId: completando ? p.unidadDePrecio : null,
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

          // Lo que el proveedor cobró (la oferta) acompaña a la corrección: si esta compra es la última de la oferta, toma el precio y el costo corregidos (D11); si la línea no tenía
          // precio (nunca formó la oferta), entra como una compra más: la más nueva gana, igual que al registrar.
          if (completando) {
            await tx.ofertasDeProveedor.registrar(empresaId, {
              proveedorId: recepcion.proveedorId,
              productoId: linea.productoId,
              presentacionId: linea.presentacionId,
              precioPorTipo: p.precioPor as "PRESENTACION" | "UNIDAD",
              unidadDePrecioId: p.unidadDePrecio,
              ultimoPrecio: precioNuevo,
              ultimoCostoPorUnidadDeStock: costoDespues.valor,
              ultimaCompraId: recepcion.id,
              ultimaCompraEn: recepcion.hechoEn,
            });
          } else {
            await tx.ofertasDeProveedor.corregirPrecioDeCompra(empresaId, {
              compraId: recepcion.id,
              proveedorId: recepcion.proveedorId,
              productoId: linea.productoId,
              presentacionId: linea.presentacionId,
              ultimoPrecio: precioNuevo,
              ultimoCostoPorUnidadDeStock: costoDespues.valor,
            });
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
