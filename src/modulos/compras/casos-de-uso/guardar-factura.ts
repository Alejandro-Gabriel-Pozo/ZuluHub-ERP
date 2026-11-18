import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { claseDeComprobante, type NivelDeCompra } from "../dominio/niveles";
import { claveDeLaConciliacionDeAtajo } from "../dominio/registrar-compra";
import type { FacturaPedida } from "../dominio/factura";
import type { TxDeCompras } from "./contrato";
import type { FacturaPreparada, LineaCalculada } from "./registrar-compra-tipos";

/** Escribe el comprobante, sus líneas, importes por alícuota y tributos, y la conciliación atajo con sus asignaciones. Devuelve el id del comprobante. */
export async function guardarFactura(
  tx: TxDeCompras,
  datos: Readonly<{
    empresaId: EmpresaId;
    persona: PersonaId;
    /** La recepción con la que se concilia en el mismo acto (N1 y N2); `null` si la factura llega sola (N3): sin atajo y sin puntero a una recepción. */
    recepcionId: string | null;
    proveedorId: string;
    nivel: NivelDeCompra;
    clave: string;
    huella: string;
    factura: FacturaPedida;
    /** Los renglones recibidos con los que se carga el detalle (N1 y N2); en N3 van los datos de cada línea en `deLaFactura`. */
    lineas: readonly LineaCalculada[];
    /** Solo N3: el producto de cada línea de la factura (descripción, unidad base y producto). */
    deLaFactura?: readonly Readonly<{ descripcion: string; unidad: string; productoId: string }>[];
    preparada: FacturaPreparada;
  }>,
): Promise<string> {
  const { empresaId, factura, preparada } = datos;
  const c = preparada.calculado;
  const comprobanteId = await tx.comprobantesDeProveedor.insertar(empresaId, {
    proveedorId: datos.proveedorId,
    clase: claseDeComprobante(factura.tipo),
    tipo: factura.tipo,
    puntoDeVenta: factura.puntoDeVenta,
    numero: factura.numero,
    fechaDelComprobante: factura.fecha,
    fechaDeVencimientoDePago: factura.vencimientoDePago,
    netoGravado: c.netoGravado,
    noGravado: c.noGravado,
    exento: c.exento,
    iva: c.iva,
    tributosTotal: c.tributosTotal,
    creditoFiscalComputable: c.creditoFiscalComputable,
    totalCalculado: c.totalCalculado,
    totalSegunFactura: c.totalSegunFactura,
    proveedorCuit: preparada.cuit,
    proveedorRazonSocial: preparada.razonSocial,
    letraNoEsperada: preparada.letraNoEsperada,
    nivel: datos.nivel,
    esAtajo: datos.recepcionId !== null,
    clave: datos.clave,
    huella: datos.huella,
    registradoPor: datos.persona,
  });
  if (comprobanteId === undefined) {
    throw new Error(
      "el comprobante chocó con una restricción única que no es la clave ni el duplicado",
    );
  }
  await tx.detalleDeComprobantes.insertarLineas(
    empresaId,
    comprobanteId,
    factura.lineas.map((l, i) => {
      const propia = datos.deLaFactura?.[i];
      const renglon = datos.lineas[l.renglon - 1];
      const calculada = c.lineas[i];
      if (calculada === undefined)
        throw new Error("el comprobante calculado no tiene todas las líneas");
      if (propia === undefined && renglon === undefined) {
        throw new Error("la línea de la factura no tiene a qué producto corresponder");
      }
      return {
        numero: i + 1,
        descripcion: propia?.descripcion ?? (renglon as LineaCalculada).producto.nombre,
        unidad: propia?.unidad ?? (renglon as LineaCalculada).producto.unidadBaseId,
        ...(propia === undefined ? {} : { productoId: propia.productoId }),
        cantidadFacturada: l.cantidadFacturada,
        precioNeto: l.precioNeto,
        alicuota: calculada.alicuota,
        netoDeLinea: calculada.netoDeLinea,
        ivaDeLinea: calculada.ivaDeLinea,
        recepcionId: datos.recepcionId,
        lineaDeRecepcion: datos.recepcionId === null ? null : l.renglon,
      };
    }),
  );
  await tx.detalleDeComprobantes.insertarImportes(empresaId, comprobanteId, c.importesPorAlicuota);
  await tx.detalleDeComprobantes.insertarTributos(
    empresaId,
    comprobanteId,
    c.tributos.map((t, i) => ({
      numero: i + 1,
      tipo: t.tipo,
      descripcion: t.descripcion,
      baseImponible: t.baseImponible,
      alicuota: t.alicuota,
      importe: t.importe,
    })),
  );
  if (datos.recepcionId === null) return comprobanteId;
  const recepcionId = datos.recepcionId;
  const conciliacionId = await tx.conciliacionesDeCompra.insertarConciliacion(empresaId, {
    acto: "CONCILIACION",
    anulaA: null,
    comprobanteId,
    esAtajo: true,
    nivel: datos.nivel,
    clave: claveDeLaConciliacionDeAtajo(recepcionId),
    registradoPor: datos.persona,
  });
  if (conciliacionId === undefined) {
    throw new Error("la conciliación chocó con una restricción única que no es su clave");
  }
  await tx.conciliacionesDeCompra.insertarAsignaciones(
    empresaId,
    { id: conciliacionId, acto: "CONCILIACION", comprobanteId },
    preparada.asignaciones.map((a, i) => ({
      numero: i + 1,
      lineaDeComprobante: a.lineaDeFactura,
      recepcionId,
      lineaDeRecepcion: a.renglon,
      cantidad: a.cantidad,
    })),
  );
  return comprobanteId;
}
