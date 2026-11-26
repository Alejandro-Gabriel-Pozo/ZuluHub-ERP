import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { textosDeNuevaCompra, type TextosDeNuevaCompra } from "../nueva/textos-de-nueva-compra";

/**
 * Los textos de «Reemplazar el comprobante» ya resueltos (NOTAS-2c-2). Cada texto sale del catálogo con su fuente (`catalogo-compras-costo.ts`; lo demás ya existía y se reutiliza). Lo que no tiene texto aprobado NO se
 * escribe acá: va a la lista de textos por aprobar del PR. Los errores de «Reemplazar» son el genérico existente (los frenos los muestra el primer paso ANTES de enviar).
 */
export type TextosDeReemplazo = Readonly<{
  titulo: string;
  queDeshacerAntes: string;
  comprobanteNuevo: string;
  reemplazar: string;
  cambiarElComprobante: string;
  pago: string;
  conciliaciones: string;
  notas: string;
  motivo: string;
  costoNoCambia: string;
  proveedor: string;
  enviando: string;
  reintentar: string;
  /** Los textos del formulario de la factura (los mismos de «Nueva compra» y «Cargar factura»: es el mismo bloque). */
  factura: TextosDeNuevaCompra;
  /** El motivo precargado con el número de la factura nueva (`0005-00001234`). */
  motivoPorDefecto: (numero: string) => string;
}>;

export function textosDeReemplazo(): TextosDeReemplazo {
  return {
    titulo: texto({}, "compras.reemplazo.titulo"),
    queDeshacerAntes: texto({}, "compras.reemplazo.que_deshacer_antes"),
    comprobanteNuevo: texto({}, "compras.reemplazo.comprobante_nuevo"),
    reemplazar: texto({}, "compras.orden.reemplazar"),
    cambiarElComprobante: texto({}, "compras.reemplazo.cambiar_comprobante"),
    pago: texto({}, "compras.reemplazo.pago"),
    conciliaciones: texto({}, "compras.conciliacion.conciliaciones"),
    notas: texto({}, "compras.notas.titulo"),
    motivo: texto({}, "ventas.ticket.motivo"),
    costoNoCambia: texto({}, "compras.reemplazo.costo_no_cambia"),
    proveedor: texto({}, "compras.compra.proveedor"),
    enviando: texto({}, "conexion.enviando"),
    reintentar: texto({}, "estado.reintentar"),
    factura: textosDeNuevaCompra(),
    motivoPorDefecto: (numero) => texto({}, "compras.reemplazo.motivo_por_defecto", { numero }),
  };
}
