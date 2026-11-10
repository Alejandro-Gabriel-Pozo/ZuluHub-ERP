import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeATexto } from "../../../primitivas/cantidad/porcentaje";
import { type Importe } from "../../../primitivas/dinero/importe";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ModoDePrecio } from "../dominio/calculo-de-renglones";
import type { OrigenDeComprobante, TipoDeComprobante } from "../dominio/comprobante-emitido";
import type {
  Concepto,
  ErrorDeComprobanteNuevo,
  PeriodoDeServicio,
  RenglonAFacturar,
} from "../dominio/comprobante-nuevo";
import type { EstadoDeComprobanteArca } from "../dominio/estados-de-comprobante";
import type { ComprobanteId, PuntoDeVentaId } from "../dominio/identificadores";
import type { ErrorDeNota } from "../dominio/nota-asociada";
import type { Receptor } from "../dominio/receptor";
import type { ErrorDeSucursalCerrada } from "../dominio/sucursales-de-la-emision";
import { huellaDe } from "./llamadas-a-arca";

/**
 * Lo que entra y sale de emitir (a mano o desde un documento de otro módulo) y la huella del pedido. Vive aparte de `emitir-comprobante.ts`
 * (el cuerpo de la transacción) para que ese archivo quede bajo el tope de líneas; se reexporta desde allí.
 */

export type EntradaDeComprobanteManual = Readonly<{
  /** La clave de idempotencia que generó la pantalla (uuid); es también el id del comprobante. */
  clave: string;
  puntoDeVentaId: PuntoDeVentaId;
  concepto: Concepto;
  servicio: PeriodoDeServicio | null;
  modoDePrecio: ModoDePrecio;
  receptor: Receptor;
  renglones: readonly RenglonAFacturar[];
}>;

export type EntradaDeNotaManual = Readonly<{
  clave: string;
  /** El comprobante `AUTORIZADO` que la nota corrige (crédito) o aumenta (débito). */
  comprobanteAsociadoId: ComprobanteId;
  /** Por defecto (`null`), el punto de venta del asociado. */
  puntoDeVentaId: PuntoDeVentaId | null;
  concepto: Concepto;
  servicio: PeriodoDeServicio | null;
  modoDePrecio: ModoDePrecio;
  renglones: readonly RenglonAFacturar[];
  motivo: string | null;
}>;

export type SalidaDeEmitir = Readonly<{
  comprobanteId: ComprobanteId;
  estado: EstadoDeComprobanteArca;
  tipo: TipoDeComprobante;
  /** Texto decimal (ADR-006). */
  total: string;
  /** `true`: la misma clave con el mismo pedido ya lo había creado; no se escribió nada. */
  yaExistia: boolean;
}>;

export type ErrorPropioAlEmitir =
  | "CLAVE_INVALIDA"
  | "CLAVE_REUTILIZADA"
  | "PUNTO_DE_VENTA_NO_ENCONTRADO"
  | "PUNTO_DE_VENTA_INACTIVO"
  | ErrorDeSucursalCerrada
  | ErrorDeAlcance
  | "EMISOR_INACTIVO"
  | "SIN_DATOS_FISCALES_VIGENTES"
  | "INGRESOS_BRUTOS_SIN_DECLARAR"
  | "SIN_CERTIFICADO_VIGENTE"
  | "COMPROBANTE_ASOCIADO_NO_ENCONTRADO"
  | "COMPROBANTE_ALTA_INVALIDA"
  | "COMPROBANTE_ASOCIADO_INVALIDO"
  | ErrorDeComprobanteNuevo
  | ErrorDeNota;

export type ErrorAlEmitir =
  ErrorPropioAlEmitir | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Lo que se emite: una factura, o una nota sobre un asociado. */
export type Pedido =
  | Readonly<{ clase: "FACTURA"; entrada: EntradaDeComprobanteManual }>
  | Readonly<{ clase: "NOTA_CREDITO" | "NOTA_DEBITO"; entrada: EntradaDeNotaManual }>;

/**
 * El renglón como entra a la huella. La unidad se suma SOLO si no es `null`: si se sumara siempre, cambiaría la huella de todos los
 * pedidos manuales ya guardados (no llevan unidad) y repetir uno después del despliegue daría `CLAVE_REUTILIZADA` en vez de `yaExistia`.
 * Chequeo: `test/integracion/facturacion-huella-de-origen.test.ts` (la huella de un pedido manual no cambió) y los debilitamientos.
 */
const renglonCanonico = (r: RenglonAFacturar) => ({
  descripcion: r.descripcion,
  cantidad: cantidadATexto(r.cantidad),
  precioUnitario: precioUnitarioATexto(r.precioUnitario),
  descuento: r.descuento === null ? null : porcentajeATexto(r.descuento),
  alicuota: r.alicuota,
  ...(r.unidad === null ? {} : { unidad: r.unidad }),
});

/**
 * La huella del pedido canónico (§B.4.1): SHA-256 de lo que la persona pidió (clase, punto de venta, concepto y
 * fechas, modo, receptor o asociado, renglones y motivo), con cantidades y precios como texto exacto.
 */
export function huellaDelPedido(pedido: Pedido): string {
  const { entrada } = pedido;
  const comun = {
    clase: pedido.clase,
    puntoDeVentaId: entrada.puntoDeVentaId,
    concepto: entrada.concepto,
    servicio: entrada.servicio,
    modoDePrecio: entrada.modoDePrecio,
    renglones: entrada.renglones.map(renglonCanonico),
  };
  return pedido.clase === "FACTURA"
    ? huellaDe({ ...comun, receptor: pedido.entrada.receptor })
    : huellaDe({
        ...comun,
        asociado: pedido.entrada.comprobanteAsociadoId,
        motivo: pedido.entrada.motivo,
      });
}

/**
 * La huella de una factura que nace de un origen (`emitirFacturaDeOrigenEnTx`): la del pedido manual más el origen (tipo e id), que es lo que
 * la identifica. Lo que no cambia el contenido del comprobante (la sucursal y el total esperados, que solo se verifican) no entra.
 */
export function huellaDeLaFacturaDeOrigen(
  origen: OrigenDeComprobante,
  entrada: EntradaDeComprobanteManual,
): string {
  const { renglones, puntoDeVentaId, concepto, servicio, modoDePrecio, receptor } = entrada;
  return huellaDe({
    clase: "FACTURA",
    puntoDeVentaId,
    concepto,
    servicio,
    modoDePrecio,
    renglones: renglones.map(renglonCanonico),
    receptor,
    origen: { tipo: origen.tipo, id: origen.id },
  });
}

/**
 * Lo que cambia cuando la factura no es un pedido manual sino un documento de otro módulo (`emitirFacturaDeOrigenEnTx`): el origen (que da la
 * identidad y la repetición), el id que eligió quien llama (estable entre reintentos), la sucursal a la que tiene que pertenecer el punto de
 * venta y el total que se cobró, que el cálculo de fiscal tiene que igualar al centavo.
 */
export type DeOrigen = Readonly<{
  origen: OrigenDeComprobante;
  comprobanteId: ComprobanteId;
  huella: string;
  sucursalEsperadaId: SucursalId;
  totalEsperado: Importe;
}>;

/** Lo que solo puede dar una factura de origen. */
export type ErrorDeOrigen = "PUNTO_DE_VENTA_DE_OTRA_SUCURSAL" | "TOTAL_NO_COINCIDE";
