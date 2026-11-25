import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { UNIDADES, type CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import type { AlicuotaDeCompra } from "../dominio/comprobante";
import {
  camposDeHuellaDeTomarElCosto,
  facturaUnicaDeLaLinea,
  leerMotivoDelCostoTomado,
  leerTomarElCosto,
  motivoDelCostoTomado,
} from "../dominio/costo-de-la-factura";
import { leerPrecioPositivo, textoDePrecio } from "../dominio/decimal";
import { decidirPorHuella, huellaDeComando } from "../dominio/huella";
import type { LineaDeRecepcion } from "../persistencia/repositorio-de-recepciones";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import { alicuotaDeUnaLineaDeFactura, costoDeLaLinea } from "./correcciones";
import type { ErrorDeCompras } from "./errores";

type R<S> = Resultado<S, ErrorDeCompras>;

export type EntradaDeTomarElCosto = Readonly<{
  /** Un UUID que genera la pantalla al abrir la hoja: es la idempotencia de la toma del costo. */
  clave: string;
  recepcionId: string;
  linea: number;
}>;

export type SalidaDeTomarElCosto = Readonly<{
  recepcionId: string;
  linea: number;
  numero: number;
  /** `true`: el costo ya estaba tomado con esta clave y este contenido: no se escribió ni se ajustó nada. */
  yaExistia: boolean;
}>;

const esUnidad = (codigo: string): codigo is CodigoDeUnidad => Object.hasOwn(UNIDADES, codigo);

/** El «precio por» de la línea de una factura: siempre por UNIDAD y en la unidad de esa línea (la base del producto, que es en la que se carga la factura de N3). */
type PrecioPorDeLaFactura = Readonly<{ precioPorTipo: "UNIDAD"; unidadDePrecioId: CodigoDeUnidad }>;

type RenglonDeLaFactura = Readonly<{
  precio: string;
  precioPor: PrecioPorDeLaFactura;
  /** El IVA que entra al costo (`null`: ninguno). */
  alicuota: AlicuotaDeCompra | null;
}>;

/**
 * Lo que dice una línea de una factura para costear: su precio neto, su unidad y el IVA que entra al costo hoy (regla única). `COSTO_SIN_FACTURA_UNICA` si la factura o la línea no está, no es una
 * factura de proveedor con tipo, o su precio o su unidad no se pueden leer; con `exigirNoAnulada`, `COMPROBANTE_ANULADO` si la factura está anulada (tomar el costo de una anulada no se permite; recalcular
 * uno ya tomado, sí: es historia).
 */
async function renglonDeLaFactura(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  origen: Readonly<{ comprobanteId: string; lineaDeFactura: number }>,
  exigirNoAnulada: boolean,
): Promise<R<RenglonDeLaFactura>> {
  const factura = await tx.comprobantesDeProveedor.obtener(
    contexto.empresaId,
    origen.comprobanteId,
  );
  if (factura === null || factura.clase !== "FACTURA" || factura.tipo === null) {
    return err("COSTO_SIN_FACTURA_UNICA");
  }
  if (exigirNoAnulada && factura.estado === "ANULADO") return err("COMPROBANTE_ANULADO");
  const renglon = (await tx.detalleDeComprobantes.lineasDe(contexto.empresaId, factura.id)).find(
    (l) => l.numero === origen.lineaDeFactura,
  );
  const precioLeido = renglon === undefined ? null : leerPrecioPositivo(renglon.precioNeto);
  if (renglon === undefined || precioLeido === null || !esUnidad(renglon.unidad)) {
    return err("COSTO_SIN_FACTURA_UNICA");
  }
  const alicuota = await alicuotaDeUnaLineaDeFactura(
    tx,
    contexto,
    dependencias,
    factura.tipo,
    renglon.alicuota,
  );
  if (!alicuota.ok) return alicuota;
  return ok({
    precio: textoDePrecio(precioLeido),
    precioPor: { precioPorTipo: "UNIDAD", unidadDePrecioId: renglon.unidad },
    alicuota: alicuota.valor,
  });
}

/**
 * El costo por unidad de stock que rige hoy para una línea de una recepción separada: el costo que la línea guardó al registrarse si lo tiene, o el que tomó de la factura (la corrección de
 * precio que completó su «Sin precio»), recalculado con el precio y el IVA de la línea de la factura que ESA corrección anota en su motivo, aunque la conciliación ya se haya anulado. `null` si
 * la línea todavía no tiene costo. Lo usa «corregir lo recibido» para que lo que entra de más entre al costo vigente y no sin costo.
 */
export async function costoVigenteDeLaLineaSeparada(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  recepcionId: string,
  linea: LineaDeRecepcion,
): Promise<R<string | null>> {
  if (linea.costoPorUnidadDeStock !== null) return ok(linea.costoPorUnidadDeStock);
  const toma = (await tx.correccionesDeCompra.deLaRecepcion(contexto.empresaId, recepcionId))
    .filter((c) => c.linea === linea.numero && c.precioNuevo !== null)
    .at(-1);
  if (toma === undefined) return ok(null);
  const origen = leerMotivoDelCostoTomado(toma.motivo);
  if (origen === null) return err("COSTO_SIN_FACTURA_UNICA");
  const renglon = await renglonDeLaFactura(tx, contexto, dependencias, origen, false);
  if (!renglon.ok) return renglon;
  return costoDeLaLinea(
    tx,
    contexto,
    linea,
    toma.precioNuevo as string,
    renglon.valor.alicuota,
    renglon.valor.precioPor,
  );
}

/**
 * Tomar el costo de la factura de una línea recibida de una recepción separada (E9 N3, decisión del dueño del 25/11/2026, «b chica»; DEC-0903): «Recibir» no pide precio, así que la línea queda
 * sin costo hasta que, ya conciliada, se lo toma de la factura. Es la corrección que completa el precio de una línea «Sin precio» (la misma de N1 y N2, con su ajuste del costo del stock) adaptada
 * a la recepción separada: el precio NO viene del pedido, lo lee el servidor de la ÚNICA línea de factura que cubre toda la línea recibida (`facturaUnicaDeLaLinea`; con dos líneas o dos facturas no hay
 * un costo único y se rechaza), el IVA que entra al costo sale de esa línea con la regla única `alicuotaQueEntraAlCosto` y el motivo es un código con la línea de la factura. Guards `compras.corregir`
 * y `stock.ajustar` (gerente y administrador) y la sucursal de la recepción en el alcance. El costo se ajusta en CADA depósito donde entró la línea, sobre lo recibido vigente (con las correcciones de
 * lo recibido): lo ya vendido o consumido conserva el costo con que salió. Todo en UNA transacción, serializada por la recepción y el saldo de la línea. Repetición: misma clave y mismo contenido
 * devuelve lo hecho sin escribir ni ajustar; otro contenido, `CLAVE_REUTILIZADA`; una línea que ya tiene costo, `COSTO_YA_TOMADO` (dos personas a la vez dejan una). Anular la conciliación después no
 * toca el costo: es de la línea recibida, no de la conciliación (DEC-0941).
 */
export function armarTomarElCosto(dependencias: DependenciasDeCompras) {
  return async function tomarElCosto(
    contexto: ContextoOperativo,
    entrada: EntradaDeTomarElCosto,
  ): Promise<R<SalidaDeTomarElCosto>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    const pedido = leerTomarElCosto(entrada);
    if (!pedido.ok) return pedido;
    const p = pedido.valor;
    const huella = huellaDeComando("tomar_el_costo", camposDeHuellaDeTomarElCosto(p), []);

    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeTomarElCosto>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, ["compras.corregir"]);
          if (!permiso.ok) return permiso;
          const recepcion = await tx.recepcionesSeparadas.bloquearSeparada(
            empresaId,
            p.recepcionId,
          );
          if (recepcion === null || recepcion.nivel !== "RECEPCION_SEPARADA") {
            return err("RECEPCION_NO_ENCONTRADA");
          }
          const alcance = await exigirAlcanceDeSucursal(
            tx,
            contexto,
            sucursalId(recepcion.sucursalId),
          );
          if (!alcance.ok) return alcance;

          const previa = await tx.correccionesDeCompra.porClave(empresaId, p.clave);
          if (previa !== null) {
            return decidirPorHuella(previa.huella, huella) === "REPETIDA"
              ? ok({
                  recepcionId: previa.recepcionId,
                  linea: previa.linea,
                  numero: previa.numero,
                  yaExistia: true,
                })
              : err("CLAVE_REUTILIZADA");
          }
          if (recepcion.estado === "ANULADA") return err("RECEPCION_YA_ANULADA");
          if (recepcion.estado !== "CONFIRMADA") return err("RECEPCION_NO_CONFIRMADA");

          const lineas = await tx.recepciones.lineasDe(empresaId, recepcion.id);
          const linea = lineas.find((l) => l.numero === p.linea);
          if (linea === undefined) return err("LINEA_NO_ENCONTRADA");
          // La fila del saldo se bloquea después de la recepción (el mismo orden que corregir lo recibido): con ella se serializan estas tomas, las correcciones y las conciliaciones de la línea.
          const saldo = await tx.correccionesDeLoRecibido.saldoBloqueado(
            empresaId,
            recepcion.id,
            linea.numero,
          );
          if (saldo === null) return err("LINEA_NO_ENCONTRADA");

          const correcciones = (
            await tx.correccionesDeCompra.deLaRecepcion(empresaId, recepcion.id)
          ).filter((c) => c.linea === linea.numero);
          if (linea.precio !== null || correcciones.some((c) => c.precioNuevo !== null)) {
            return err("COSTO_YA_TOMADO");
          }

          const vigentes = (
            await tx.conciliacionesDeCompra.vigentesDeLasRecepciones(empresaId, [recepcion.id])
          )
            .filter((v) => v.lineaDeRecepcion === linea.numero)
            .map((v) => ({
              comprobanteId: v.comprobanteId,
              lineaDeFactura: v.lineaDeComprobante,
              cantidad: v.cantidad,
            }));
          const elegida = facturaUnicaDeLaLinea({
            recibida: saldo.recibida,
            asignada: saldo.asignada,
            vigentes,
          });
          if (!elegida.ok) return elegida;

          const renglon = await renglonDeLaFactura(tx, contexto, dependencias, elegida.valor, true);
          if (!renglon.ok) return renglon;
          const { precio, precioPor } = renglon.valor;

          const costo = await costoDeLaLinea(
            tx,
            contexto,
            linea,
            precio,
            renglon.valor.alicuota,
            precioPor,
          );
          if (!costo.ok) return costo;

          const entradas = (
            await tx.recepcionesSeparadas.entradasDe(empresaId, recepcion.id)
          ).filter((e) => e.linea === linea.numero);
          if (entradas.length > 0) {
            const stock = await autorizar(tx, contexto, dependencias.reglas, ["stock.ajustar"]);
            if (!stock.ok) return stock;
          }

          const motivo = motivoDelCostoTomado(elegida.valor);
          const guardada = await tx.correccionesDeCompra.insertar(empresaId, {
            recepcionId: recepcion.id,
            linea: linea.numero,
            numero: 1,
            precioAnterior: null,
            precioNuevo: precio,
            cantidadAnterior: null,
            cantidadNueva: null,
            pesoRealAnterior: null,
            pesoRealNuevo: null,
            precioPorTipo: precioPor.precioPorTipo,
            unidadDePrecioId: precioPor.unidadDePrecioId,
            motivo,
            clave: p.clave,
            huella,
            registradoPor: persona,
          });
          if (!guardada) {
            throw new Error(
              "la toma del costo chocó con una restricción única bajo el bloqueo de la línea",
            );
          }

          // Lo que el proveedor cobró acompaña a la toma: la línea entra a la oferta como una compra más (la más nueva gana), igual que al completar el precio de N1 y N2.
          await tx.ofertasDeProveedor.registrar(empresaId, {
            proveedorId: recepcion.proveedorId,
            productoId: linea.productoId,
            presentacionId: linea.presentacionId,
            precioPorTipo: precioPor.precioPorTipo,
            unidadDePrecioId: precioPor.unidadDePrecioId,
            ultimoPrecio: precio,
            ultimoCostoPorUnidadDeStock: costo.valor,
            ultimaCompraId: recepcion.id,
            ultimaCompraEn: recepcion.hechoEn,
          });

          // Un depósito, lo recibido vigente (con las correcciones de lo recibido); varios, lo que entró a cada uno (esas líneas no se corrigen, así que lo que entró es lo recibido).
          const ajustes: {
            depositoId: string;
            promedioAntes: string | null;
            promedioDespues: string | null;
          }[] = [];
          for (const e of entradas) {
            const ajuste = await dependencias.stock.ajusteDeCostoPorOrigen.ajustar(tx, contexto, {
              origen: { tipo: "CORRECCION_DE_COMPRA", id: recepcion.id },
              depositoId: e.depositoId,
              productoId: linea.productoId,
              costoAnterior: null,
              costoNuevo: costo.valor,
              cantidadQueEntro: entradas.length === 1 ? saldo.recibida : e.cantidad,
            });
            if (!ajuste.ok) return ajuste;
            ajustes.push({
              depositoId: e.depositoId,
              promedioAntes: ajuste.valor.costoAntes,
              promedioDespues: ajuste.valor.costoDespues,
            });
          }

          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "COMPRA_CORREGIDA",
            entidad: "recepcion",
            entidadId: recepcion.id,
            antes: { linea: linea.numero, precio: null, costoPorUnidad: null },
            despues: {
              tipo: "COSTO_TOMADO",
              linea: linea.numero,
              numero: 1,
              precio,
              costoPorUnidad: costo.valor,
              comprobanteId: elegida.valor.comprobanteId,
              lineaDeFactura: elegida.valor.lineaDeFactura,
              ajustes,
            },
          });
          return ok({
            recepcionId: recepcion.id,
            linea: linea.numero,
            numero: 1,
            yaExistia: false,
          });
        },
      ),
    );
  };
}
