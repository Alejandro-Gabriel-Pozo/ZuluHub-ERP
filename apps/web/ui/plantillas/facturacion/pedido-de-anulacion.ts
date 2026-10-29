import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { importeATexto } from "../../../../../src/primitivas/dinero/importe";
import {
  calcularLaAnulacion,
  type EleccionDeAnulacion,
  type FacturaParaAnular,
  type ParteAAnular,
} from "./eleccion-de-anulacion";
import { formatearAlicuota } from "./formato-fiscal";

/**
 * El pedido de la nota de crédito (D-69, D-71): UN renglón por alícuota con importe, de cantidad 1 y con el TOTAL CON IVA a anular en
 * esa alícuota como precio, modo «IVA incluido» (el servidor reparte neto e IVA con la misma cuenta que la factura; letra C: un
 * solo renglón sin alícuota). La clave de idempotencia la pone el intento (`useEnvioDeLaAnulacion`). Previene: mandar al servidor
 * algo distinto de lo que la persona vio en «A anular ahora». Chequeo: `test/web/anular-pedido.test.ts`.
 */

type RenglonDeLaNota = Readonly<{
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  descuento: null;
  alicuota: string | null;
}>;

/** Los valores de la nota SIN la clave: se fijan al primer toque y se reusan en cada reintento. `puntoDeVentaId: null` es el de la factura. */
export type PedidoDeAnulacion = Readonly<{
  comprobanteAsociadoId: string;
  puntoDeVentaId: null;
  concepto: string;
  servicio: FacturaParaAnular["servicio"];
  modoDePrecio: "IVA_INCLUIDO";
  renglones: readonly RenglonDeLaNota[];
  motivo: string;
}>;

/**
 * D-74 (aprobado por el dueño el 2026-10-29, cuestionario en la sesión web del carril web): «Anulación parcial de la factura 00001-00000123, IVA 21 %»; «Anulación total de …» si
 * se anula todo; «nota de débito» si se anula una nota de débito. Sin la alícuota si no lleva IVA (letra C, exento, no gravado).
 */
function descripcionDelRenglon(
  d: DiccionarioResuelto,
  f: FacturaParaAnular,
  parcial: boolean,
  parte: ParteAAnular,
): string {
  const base = {
    anulacion: texto(
      d,
      parcial ? "fiscal.pantalla.anulacion_parcial" : "fiscal.pantalla.anulacion_total",
    ),
    clase: texto(
      d,
      f.tipo.startsWith("NOTA_DEBITO")
        ? "fiscal.pantalla.anular_clase_nota_de_debito"
        : "fiscal.pantalla.anular_clase_factura",
    ),
    numero: f.numero ?? "",
  };
  const alicuota = parte.fila.alicuota === null ? null : formatearAlicuota(parte.fila.alicuota);
  return alicuota === null
    ? texto(d, "fiscal.pantalla.anular_descripcion", base)
    : texto(d, "fiscal.pantalla.anular_descripcion_con_iva", {
        ...base,
        iva: texto(d, "fiscal.pantalla.renglon_iva", { alicuota }),
      });
}

export function armarElPedido(
  d: DiccionarioResuelto,
  f: FacturaParaAnular,
  e: EleccionDeAnulacion,
  motivo: string,
): PedidoDeAnulacion {
  return {
    comprobanteAsociadoId: f.id,
    puntoDeVentaId: null,
    concepto: f.concepto,
    servicio: f.servicio,
    modoDePrecio: "IVA_INCLUIDO",
    renglones: calcularLaAnulacion(f, e).partes.map((parte) => ({
      descripcion: descripcionDelRenglon(d, f, e.parcial, parte),
      cantidad: "1",
      precioUnitario: importeATexto(parte.importe),
      descuento: null,
      alicuota: parte.fila.alicuota,
    })),
    motivo: motivo.trim(),
  };
}
