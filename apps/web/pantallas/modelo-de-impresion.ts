import type { ModeloDeImpresionParaLaPantalla } from "../servidor/facturacion";
import type { ComprobanteParaLaHoja } from "../ui/plantillas/facturacion/impresion/modelo-de-la-hoja";

type Modelo = ModeloDeImpresionParaLaPantalla["modelo"];

/**
 * Del modelo de impresión de fiscal (lo que devuelve el servidor) a lo que dibuja la hoja. Lista blanca a propósito: copia solo lo que
 * la hoja dibuja, así `referencias`, `descuento`, el logo y el color, la versión de representación y el QR (que viaja aparte, ya
 * dibujado) no llegan al navegador. La UI no importa `src/modulos`: el mapeo vive acá, donde sí se puede.
 *
 * SUPUESTO: la primera entrega NO imprime nombre de fantasía (`marca.nombreDeFantasia` siempre `null`, aunque el modelo traiga uno).
 * Previene: imprimir un dato de marca que el dueño no aprobó. Chequeo: `test/web/impresion-mapeo.test.ts`.
 */
export function comprobanteParaLaHoja(m: Modelo): ComprobanteParaLaHoja {
  const t = m.totales;
  return {
    marca: { nombreDeFantasia: null },
    fiscal: {
      rotulo: m.fiscal.rotulo,
      letra: m.fiscal.letra,
      codigoDelTipo: m.fiscal.codigoDelTipo,
      numero: m.fiscal.numero,
      fecha: m.fiscal.fecha,
      cae: m.fiscal.cae,
      caeVence: m.fiscal.caeVence,
      emisor: {
        cuit: m.fiscal.emisor.cuit,
        razonSocial: m.fiscal.emisor.razonSocial,
        condicionIva: m.fiscal.emisor.condicionIva,
        domicilioFiscal: m.fiscal.emisor.domicilioFiscal,
        domicilioDelPuntoDeVenta: m.fiscal.emisor.domicilioDelPuntoDeVenta,
        iibbNumero: m.fiscal.emisor.iibbNumero,
        inicioDeActividades: m.fiscal.emisor.inicioDeActividades,
      },
    },
    receptor: {
      nombre: m.receptor.nombre,
      documento: m.receptor.documento,
      condicionIva: m.receptor.condicionIva,
      domicilio: m.receptor.domicilio,
      ...(m.receptor.leyenda === undefined ? {} : { leyenda: m.receptor.leyenda }),
    },
    ...(m.modoDePrecio === undefined ? {} : { modoDePrecio: m.modoDePrecio }),
    renglones: m.renglones.map((r) => ({
      descripcion: r.descripcion,
      cantidad: r.cantidad,
      precioUnitario: r.precioUnitario,
      alicuota: r.alicuota,
      importe: r.importe,
    })),
    totales:
      t.letra === "A"
        ? {
            letra: "A",
            netoPorAlicuota: t.netoPorAlicuota,
            exento: t.exento,
            noGravado: t.noGravado,
            total: t.total,
          }
        : { letra: t.letra, total: t.total },
    ...(m.transparenciaFiscal === undefined ? {} : { transparenciaFiscal: m.transparenciaFiscal }),
    ...(m.contacto === undefined ? {} : { contacto: m.contacto }),
    asociado: m.asociado,
    leyendas: m.leyendas,
  };
}
