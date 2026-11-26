import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { CLAVE_DE_TEXTO_DE_LA_ALICUOTA } from "../nueva/modelo-de-factura";

/**
 * Los textos de las pantallas de notas del proveedor ya resueltos (NOTAS-2c-1): «Notas de la factura» y «Cargar una nota del proveedor». Cada texto sale del catálogo con su fuente (`catalogo-compras-notas.ts`; lo demás ya existía
 * y se reutiliza). Lo que no tiene texto aprobado NO se escribe acá: va a la lista de textos por aprobar del PR.
 */
export type TextosDeNotas = Readonly<{
  titulo: string;
  cargarTitulo: string;
  totalDeLaFactura: string;
  creditosVigentes: string;
  debitosVinculados: string;
  importeAPagar: string;
  saldadaPorNotas: string;
  saldoAFavor: string;
  notaDeCredito: string;
  notaDeDebito: string;
  cargarNotaDeCredito: string;
  cargarNotaDeDebito: string;
  vigente: string;
  anulada: string;
  anular: string;
  motivo: string;
  cancelar: string;
  cerrar: string;
  todaviaSePuedeAcreditar: string;
  tipo: string;
  puntoDeVenta: string;
  numero: string;
  fecha: string;
  iva: string;
  sinIvaDiscriminado: string;
  neto: string;
  totalDeLaNota: string;
  guardar: string;
  enviando: string;
  reintentar: string;
  sinElegir: string;
  alicuotas: Readonly<Record<string, string>>;
}>;

export function textosDeNotas(): TextosDeNotas {
  return {
    titulo: texto({}, "compras.notas.titulo"),
    cargarTitulo: texto({}, "compras.notas.cargar_titulo"),
    totalDeLaFactura: texto({}, "compras.notas.total_de_la_factura"),
    creditosVigentes: texto({}, "compras.notas.creditos_vigentes"),
    debitosVinculados: texto({}, "compras.notas.debitos_vinculados"),
    importeAPagar: texto({}, "compras.notas.importe_a_pagar"),
    saldadaPorNotas: texto({}, "compras.notas.saldada_por_notas"),
    saldoAFavor: texto({}, "compras.notas.saldo_a_favor"),
    notaDeCredito: texto({}, "fiscal.pantalla.tipo_nota_de_credito"),
    notaDeDebito: texto({}, "fiscal.pantalla.tipo_nota_de_debito"),
    cargarNotaDeCredito: texto({}, "compras.factura.cargar_nota_de_credito"),
    cargarNotaDeDebito: texto({}, "compras.notas.cargar_nota_de_debito"),
    vigente: texto({}, "compras.notas.vigente"),
    anulada: texto({}, "compras.orden.anulada"),
    anular: texto({}, "ventas.ticket.anular"),
    motivo: texto({}, "ventas.ticket.motivo"),
    cancelar: texto({}, "catalogo.accion.cancelar"),
    cerrar: texto({}, "vidriera.producto.cerrar"),
    todaviaSePuedeAcreditar: texto({}, "compras.notas.todavia_se_puede_acreditar"),
    tipo: texto({}, "compras.factura.tipo"),
    puntoDeVenta: texto({}, "fiscal.pantalla.rotulo_punto_de_venta"),
    numero: texto({}, "compras.recepcion.numero"),
    fecha: texto({}, "fiscal.pantalla.rotulo_fecha"),
    iva: texto({}, "compras.factura.iva"),
    sinIvaDiscriminado: texto({}, "compras.factura.sin_iva_discriminado"),
    neto: texto({}, "receta.ficha.neto"),
    totalDeLaNota: texto({}, "compras.notas.total_de_la_nota"),
    guardar: texto({}, "catalogo.accion.guardar"),
    enviando: texto({}, "conexion.enviando"),
    reintentar: texto({}, "estado.reintentar"),
    sinElegir: texto({}, "catalogo.dato.sin_elegir"),
    alicuotas: Object.fromEntries(
      Object.entries(CLAVE_DE_TEXTO_DE_LA_ALICUOTA).map(([a, clave]) => [a, texto({}, clave)]),
    ),
  };
}
