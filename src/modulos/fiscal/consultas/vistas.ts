import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeATexto } from "../../../primitivas/cantidad/porcentaje";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { numeroImpreso } from "../dominio/modelo-de-impresion";
import type { IntentoDeArca } from "../persistencia/repositorio-de-intentos";
import type { ComprobanteGuardado } from "../persistencia/repositorio-de-comprobantes";
import type { FilaDeListado, NotaQueCita } from "../persistencia/lecturas-de-comprobantes";
import type { SerieGuardada } from "../persistencia/repositorios";

/**
 * Lo que las pantallas del facturador reciben (spec H7 facturación §B.4.9): objetos planos, sin tipos de
 * dominio que la pantalla no necesita. Todo importe, cantidad y precio es texto decimal (ADR-006), las fechas
 * civiles son `YYYY-MM-DD` (el día de Argentina) y los instantes son ISO 8601 en UTC.
 *
 * Nunca llevan una columna de certificados, claves ni credenciales de acceso, ni la `huella` del pedido, ni la
 * respuesta cruda de ARCA: esas tablas ni siquiera se leen acá.
 */

export type ResumenDeComprobante = Readonly<{
  id: FilaDeListado["id"];
  tipo: FilaDeListado["tipo"];
  /** `PPPPP-NNNNNNNN`; `null` mientras no esté `AUTORIZADO` (un número reservado todavía puede perderse). */
  numero: string | null;
  fecha: FechaCivil;
  receptorNombre: string | null;
  total: string;
  estado: FilaDeListado["estado"];
  ambiente: FilaDeListado["ambiente"];
}>;

export type PaginaDeComprobantes = Readonly<{
  items: readonly ResumenDeComprobante[];
  /** La clave para pedir la página que sigue (`despuesDe`); `null` en la última. */
  siguiente: string | null;
}>;

const numeroDe = (puntoDeVenta: number, numero: bigint | null): string | null =>
  numero === null ? null : numeroImpreso(puntoDeVenta, numero);

export function resumenDe(fila: FilaDeListado): ResumenDeComprobante {
  return {
    id: fila.id,
    tipo: fila.tipo,
    numero: numeroDe(fila.puntoDeVentaNumero, fila.numero),
    fecha: fila.fecha,
    receptorNombre: fila.receptorNombre,
    total: importeATexto(fila.total),
    estado: fila.estado,
    ambiente: fila.ambiente,
  };
}

export type NotaQueCitaVista = Readonly<{
  id: NotaQueCita["id"];
  tipo: NotaQueCita["tipo"];
  numero: string | null;
  fecha: FechaCivil;
  total: string;
  estado: NotaQueCita["estado"];
}>;

export const notaQueCitaVista = (nota: NotaQueCita): NotaQueCitaVista => ({
  id: nota.id,
  tipo: nota.tipo,
  numero: numeroDe(nota.puntoDeVentaNumero, nota.numero),
  fecha: nota.fecha,
  total: importeATexto(nota.total),
  estado: nota.estado,
});

/** Lo último que ARCA contestó por el comprobante: el desenlace y los códigos, sin la respuesta cruda. */
export type UltimoIntentoVisto = Readonly<{
  operacion: IntentoDeArca["operacion"];
  desenlace: IntentoDeArca["desenlace"];
  mensajes: IntentoDeArca["mensajes"];
  iniciadoEn: string;
}>;

export const ultimoIntentoVisto = (intento: IntentoDeArca): UltimoIntentoVisto => ({
  operacion: intento.operacion,
  desenlace: intento.desenlace,
  mensajes: intento.mensajes,
  iniciadoEn: intento.iniciadoEn.toISOString(),
});

/** La serie del comprobante: si está bloqueada, la pantalla ofrece resincronizar. */
export type SerieVista = Readonly<{
  estado: SerieGuardada["estado"];
  ultimoNumero: string;
  motivoDeBloqueo: string | null;
}>;

export const serieVista = (serie: SerieGuardada): SerieVista => ({
  estado: serie.estado,
  ultimoNumero: serie.ultimoNumero.toString(),
  motivoDeBloqueo: serie.estado === "BLOQUEADA" ? serie.motivoBloqueo : null,
});

export type DetalleDeComprobante = Readonly<{
  id: ComprobanteGuardado["id"];
  emisorId: ComprobanteGuardado["emisorId"];
  puntoDeVentaId: ComprobanteGuardado["puntoDeVentaId"];
  ambiente: ComprobanteGuardado["ambiente"];
  origen: ComprobanteGuardado["origen"];
  clase: ComprobanteGuardado["clase"];
  tipo: ComprobanteGuardado["tipo"];
  concepto: ComprobanteGuardado["concepto"];
  servicio: Readonly<{
    desde: FechaCivil;
    hasta: FechaCivil;
    vencimientoDePago: FechaCivil;
  }> | null;
  modoDePrecio: ComprobanteGuardado["modoDePrecio"];
  estado: ComprobanteGuardado["estado"];
  /** Cuántas veces se mandó a ARCA. */
  envios: number;
  /** `PPPPP-NNNNNNNN`; solo un `AUTORIZADO` lo tiene. */
  numero: string | null;
  fechaEmision: FechaCivil | null;
  cae: string | null;
  caeVence: FechaCivil | null;
  autorizadoEn: string | null;
  resueltoPor: ComprobanteGuardado["resueltoPor"];
  importes: Readonly<{
    total: string;
    neto: string;
    iva: string;
    exento: string;
    noGravado: string;
  }>;
  /** El desglose por alícuota que se informó a ARCA. */
  alicuotas: readonly Readonly<{
    alicuota: ComprobanteGuardado["desglose"][number]["alicuota"];
    total: string;
    neto: string;
    iva: string;
  }>[];
  renglones: readonly Readonly<{
    posicion: number;
    descripcion: string;
    cantidad: string;
    precioUnitario: string;
    descuento: string | null;
    alicuota: ComprobanteGuardado["renglones"][number]["alicuota"];
    importe: string;
  }>[];
  /** El emisor y el punto de venta como estaban al emitir. */
  emisor: Omit<ComprobanteGuardado["emisor"], "datosFiscalesId">;
  receptor: ComprobanteGuardado["receptor"];
  /** Solo una nota: el comprobante que corrige o aumenta. */
  asociado: Readonly<{
    id: NonNullable<ComprobanteGuardado["asociado"]>["id"];
    tipo: NonNullable<ComprobanteGuardado["asociado"]>["tipo"];
    numero: string;
    fecha: FechaCivil;
  }> | null;
  motivo: string | null;
  motivoDeDescarte: string | null;
  notasQueLoCitan: readonly NotaQueCitaVista[];
  ultimoIntento: UltimoIntentoVisto | null;
  serie: SerieVista | null;
  versionDeRepresentacion: number;
  creadoPor: ComprobanteGuardado["creadoPor"];
  creadoEn: string;
  version: number;
}>;

export function detalleDe(
  c: ComprobanteGuardado,
  adicionales: Readonly<{
    notasQueLoCitan: readonly NotaQueCita[];
    ultimoIntento: IntentoDeArca | null;
    serie: SerieGuardada | null;
  }>,
): DetalleDeComprobante {
  return {
    id: c.id,
    emisorId: c.emisorId,
    puntoDeVentaId: c.puntoDeVentaId,
    ambiente: c.ambiente,
    origen: c.origen,
    clase: c.clase,
    tipo: c.tipo,
    concepto: c.concepto,
    servicio: c.servicio,
    modoDePrecio: c.modoDePrecio,
    estado: c.estado,
    envios: c.envios,
    numero: numeroDe(c.emisor.puntoDeVentaNumero, c.numero),
    fechaEmision: c.fechaEmision,
    cae: c.cae,
    caeVence: c.caeVence,
    autorizadoEn: c.autorizadoEn === null ? null : c.autorizadoEn.toISOString(),
    resueltoPor: c.resueltoPor,
    importes: {
      total: importeATexto(c.importes.total),
      neto: importeATexto(c.importes.neto),
      iva: importeATexto(c.importes.iva),
      exento: importeATexto(c.importes.exento),
      noGravado: importeATexto(c.importes.noGravado),
    },
    alicuotas: c.desglose.map((d) => ({
      alicuota: d.alicuota,
      total: importeATexto(d.total),
      neto: importeATexto(d.neto),
      iva: importeATexto(d.iva),
    })),
    renglones: c.renglones.map((r) => ({
      posicion: r.posicion,
      descripcion: r.descripcion,
      cantidad: cantidadATexto(r.cantidad),
      precioUnitario: precioUnitarioATexto(r.precioUnitario),
      descuento: r.descuento === null ? null : porcentajeATexto(r.descuento),
      alicuota: r.alicuota,
      importe: importeATexto(r.importe),
    })),
    // Campo por campo: lo que el emisor agregue después no sale a la pantalla sin decidirlo acá.
    emisor: {
      cuit: c.emisor.cuit,
      razonSocial: c.emisor.razonSocial,
      condicionIva: c.emisor.condicionIva,
      domicilioFiscal: c.emisor.domicilioFiscal,
      inicioDeActividades: c.emisor.inicioDeActividades,
      iibbNumero: c.emisor.iibbNumero,
      iibbCondicion: c.emisor.iibbCondicion,
      puntoDeVentaNumero: c.emisor.puntoDeVentaNumero,
      domicilioDelPuntoDeVenta: c.emisor.domicilioDelPuntoDeVenta,
    },
    receptor: c.receptor,
    asociado:
      c.asociado === null
        ? null
        : {
            id: c.asociado.id,
            tipo: c.asociado.tipo,
            numero: numeroImpreso(c.asociado.puntoDeVenta, c.asociado.numero),
            fecha: c.asociado.fecha,
          },
    motivo: c.motivo,
    motivoDeDescarte: c.motivoDeDescarte,
    notasQueLoCitan: adicionales.notasQueLoCitan.map(notaQueCitaVista),
    ultimoIntento:
      adicionales.ultimoIntento === null ? null : ultimoIntentoVisto(adicionales.ultimoIntento),
    serie: adicionales.serie === null ? null : serieVista(adicionales.serie),
    versionDeRepresentacion: c.versionDeRepresentacion,
    creadoPor: c.creadoPor,
    creadoEn: c.creadoEn.toISOString(),
    version: c.version,
  };
}
