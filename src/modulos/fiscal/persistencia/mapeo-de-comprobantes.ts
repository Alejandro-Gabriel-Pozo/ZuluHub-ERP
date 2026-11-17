import { sql } from "kysely";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import { importeATexto, importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { moneda } from "../../../primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import { formatearDomicilio } from "../../../primitivas/domicilio/domicilio";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { empresaId, personaId } from "../../../primitivas/identificadores/marca";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { CODIGOS_DE_ALICUOTA } from "../dominio/alicuota";
import {
  TIPOS_DE_COMPROBANTE,
  TIPOS_DE_ORIGEN,
  claseDeComprobante,
  type ClaseDeComprobante,
} from "../dominio/comprobante-emitido";
import { AMBIENTES, CONCEPTOS, type PeriodoDeServicio } from "../dominio/comprobante-nuevo";
import { MODOS_DE_PRECIO } from "../dominio/calculo-de-renglones";
import { CONDICIONES_DE_IVA_DEL_RECEPTOR } from "../dominio/condicion-iva-receptor";
import { esCondicionDeIibb, type CondicionIibb } from "../dominio/datos-fiscales";
import { esCondicionDeIva, type CondicionIva } from "../dominio/emisor";
import { ESTADOS_DE_COMPROBANTE_ARCA } from "../dominio/estados-de-comprobante";
import {
  comprobanteId,
  emisorId,
  origenId,
  puntoDeVentaId,
  versionId,
} from "../dominio/identificadores";
import { importesParaArca } from "../dominio/importes-para-arca";
import type { Receptor } from "../dominio/receptor";
import { documentoDelReceptorDeLaBase } from "./documento-del-receptor";
import { sucursalCongeladaDeLaFila, type FilaDeComprobante } from "./fila-de-comprobante";
import { deLaLista, exigir } from "./ayudas-de-repositorio";

import type {
  AltaDeComprobante,
  AsociadoGuardado,
  ComprobanteGuardado,
  EmisorCongelado,
  ResueltoPor,
} from "./tipos-de-comprobantes";

/** Filas ↔ dominio del comprobante (salió de `repositorio-de-comprobantes.ts` al partirlo; el texto es el mismo). */
// Filas ↔ dominio
// =================================================================================================

/** Una fecha civil que la base guardó: si no es válida, algo se rompió. */
export function fechaDeLaBase(texto: string, nombre: string): FechaCivil {
  const r = fechaCivilDesdeTexto(texto);
  if (!r.ok) throw new RangeError(`${nombre} inválida en la base: ${texto}`);
  return r.valor;
}

// Una columna `date` leída como texto: `pg` la devolvería como un `Date` a la medianoche local, que corre un
// día según el huso.
export const aFecha = <C extends string>(columna: C) =>
  sql<string>`to_char(${sql.ref(columna)}, 'YYYY-MM-DD')`.as(columna);
export const aFechaOpcional = <C extends string>(columna: C) =>
  sql<string | null>`to_char(${sql.ref(columna)}, 'YYYY-MM-DD')`.as(columna);

/** Las columnas del comprobante, con las fechas (`date`) como texto `YYYY-MM-DD`. */
export const COLUMNAS_DE_COMPROBANTE = [
  "id",
  "empresa_id",
  "emisor_id",
  "punto_de_venta_id",
  "ambiente",
  "origen_tipo",
  "origen_id",
  "clase",
  "tipo_comprobante",
  "concepto",
  aFechaOpcional("servicio_desde"),
  aFechaOpcional("servicio_hasta"),
  aFechaOpcional("vencimiento_pago"),
  "moneda",
  "modo_de_precio",
  "total",
  "neto_gravado",
  "iva",
  "exento",
  "no_gravado",
  "datos_fiscales_id",
  "emisor_cuit",
  "emisor_razon_social",
  "emisor_condicion_iva",
  "emisor_domicilio_fiscal",
  aFecha("emisor_inicio_actividades"),
  "emisor_iibb_numero",
  "emisor_iibb_condicion",
  "punto_de_venta_numero",
  "punto_de_venta_domicilio",
  "receptor_nombre",
  "receptor_documento_tipo",
  "receptor_documento_numero",
  "receptor_condicion_iva",
  "receptor_domicilio",
  "comprobante_asociado_id",
  "motivo",
  "estado",
  "envios",
  "numero_reservado",
  aFechaOpcional("fecha_emision"),
  "numero",
  "cae",
  aFechaOpcional("cae_vence"),
  "autorizado_en",
  "resuelto_por",
  "motivo_descarte",
  "huella",
  "version_de_representacion",
  "sucursal_telefono",
  "sucursal_correo",
  "sucursal_web",
  "sucursal_nombre",
  "creado_por",
  "creado_en",
  "version",
] as const;

type FilaDeRenglon = Readonly<{
  posicion: number;
  descripcion: string;
  cantidad: string;
  precio_unitario: string;
  descuento: string | null;
  alicuota: string | null;
  importe: string;
  unidad: string | null;
}>;

type FilaDeDesglose = Readonly<{ alicuota: string; total: string; neto: string; iva: string }>;

const RESUELTO_POR: readonly ResueltoPor[] = ["RESPUESTA", "RECONCILIACION"];
const CLASES: readonly ClaseDeComprobante[] = ["FACTURA", "NOTA_DEBITO", "NOTA_CREDITO"];

function aReceptor(fila: FilaDeComprobante): Receptor {
  return {
    nombre: fila.receptor_nombre,
    documento: documentoDelReceptorDeLaBase(
      fila.receptor_documento_tipo,
      fila.receptor_documento_numero,
    ),
    condicionIva: deLaLista(
      CONDICIONES_DE_IVA_DEL_RECEPTOR,
      fila.receptor_condicion_iva,
      "condición de IVA del receptor",
    ),
    domicilio: fila.receptor_domicilio,
  };
}

function condicionDeIva(texto: string): CondicionIva {
  if (!esCondicionDeIva(texto))
    throw new RangeError(`condición de IVA desconocida en la base: ${texto}`);
  return texto;
}

function condicionDeIibb(texto: string | null): CondicionIibb | null {
  if (texto === null) return null;
  if (!esCondicionDeIibb(texto)) {
    throw new RangeError(`condición de IIBB desconocida en la base: ${texto}`);
  }
  return texto;
}

function aEmisor(fila: FilaDeComprobante): EmisorCongelado {
  return {
    cuit: fila.emisor_cuit as Cuit,
    razonSocial: fila.emisor_razon_social,
    condicionIva: condicionDeIva(fila.emisor_condicion_iva),
    domicilioFiscal: fila.emisor_domicilio_fiscal,
    inicioDeActividades: fechaDeLaBase(fila.emisor_inicio_actividades, "inicio de actividades"),
    iibbNumero: fila.emisor_iibb_numero,
    iibbCondicion: condicionDeIibb(fila.emisor_iibb_condicion),
    puntoDeVentaNumero: fila.punto_de_venta_numero,
    domicilioDelPuntoDeVenta: fila.punto_de_venta_domicilio,
    datosFiscalesId: versionId(fila.datos_fiscales_id),
  };
}

function aServicio(fila: FilaDeComprobante): PeriodoDeServicio | null {
  if (fila.servicio_desde === null) return null;
  return {
    desde: fechaDeLaBase(fila.servicio_desde, "servicio_desde"),
    hasta: fechaDeLaBase(exigir(fila.servicio_hasta, "servicio_hasta"), "servicio_hasta"),
    vencimientoDePago: fechaDeLaBase(
      exigir(fila.vencimiento_pago, "vencimiento_pago"),
      "vencimiento_pago",
    ),
  };
}

export function aComprobante(
  fila: FilaDeComprobante,
  renglones: readonly FilaDeRenglon[],
  desglose: readonly FilaDeDesglose[],
  asociado: AsociadoGuardado | null,
): ComprobanteGuardado {
  const m = moneda(fila.moneda);
  const importe = (texto: string) => importeDesdeTexto(m, texto);
  const tipo = deLaLista(TIPOS_DE_COMPROBANTE, fila.tipo_comprobante, "tipo de comprobante");
  const codigo = (texto: string) => deLaLista(CODIGOS_DE_ALICUOTA, texto, "alícuota");
  return {
    id: comprobanteId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    emisorId: emisorId(fila.emisor_id),
    puntoDeVentaId: puntoDeVentaId(fila.punto_de_venta_id),
    ambiente: deLaLista(AMBIENTES, fila.ambiente, "ambiente"),
    origen: {
      tipo: deLaLista(TIPOS_DE_ORIGEN, fila.origen_tipo, "tipo de origen"),
      id: origenId(fila.origen_id),
    },
    clase: deLaLista(CLASES, fila.clase, "clase de comprobante"),
    tipo,
    concepto: deLaLista(CONCEPTOS, fila.concepto, "concepto"),
    servicio: aServicio(fila),
    modoDePrecio: deLaLista(MODOS_DE_PRECIO, fila.modo_de_precio, "modo de precio"),
    importes: {
      total: importe(fila.total),
      neto: importe(fila.neto_gravado),
      iva: importe(fila.iva),
      exento: importe(fila.exento),
      noGravado: importe(fila.no_gravado),
    },
    emisor: aEmisor(fila),
    receptor: aReceptor(fila),
    asociado,
    motivo: fila.motivo,
    renglones: renglones.map((r) => ({
      posicion: r.posicion,
      descripcion: r.descripcion,
      cantidad: cantidadDesdeTexto(r.cantidad),
      precioUnitario: precioUnitarioDesdeTexto(r.precio_unitario),
      descuento: r.descuento === null ? null : porcentajeDesdeTexto(r.descuento),
      alicuota: r.alicuota === null ? null : codigo(r.alicuota),
      importe: importe(r.importe),
      unidad: r.unidad,
    })),
    desglose: [...desglose]
      .map((d) => ({
        alicuota: codigo(d.alicuota),
        total: importe(d.total),
        neto: importe(d.neto),
        iva: importe(d.iva),
      }))
      .sort(
        (a, b) => CODIGOS_DE_ALICUOTA.indexOf(a.alicuota) - CODIGOS_DE_ALICUOTA.indexOf(b.alicuota),
      ),
    estado: deLaLista(ESTADOS_DE_COMPROBANTE_ARCA, fila.estado, "estado de comprobante"),
    envios: fila.envios,
    numeroReservado: fila.numero_reservado === null ? null : BigInt(fila.numero_reservado),
    fechaEmision:
      fila.fecha_emision === null ? null : fechaDeLaBase(fila.fecha_emision, "fecha_emision"),
    numero: fila.numero === null ? null : BigInt(fila.numero),
    cae: fila.cae,
    caeVence: fila.cae_vence === null ? null : fechaDeLaBase(fila.cae_vence, "cae_vence"),
    autorizadoEn: fila.autorizado_en,
    resueltoPor:
      fila.resuelto_por === null
        ? null
        : deLaLista(RESUELTO_POR, fila.resuelto_por, "resuelto_por"),
    motivoDeDescarte: fila.motivo_descarte,
    huella: fila.huella,
    versionDeRepresentacion: fila.version_de_representacion,
    ...sucursalCongeladaDeLaFila(fila),
    creadoPor: personaId(fila.creado_por),
    creadoEn: fila.creado_en,
    version: fila.version,
  };
}

/** Los valores del comprobante tal como los pide la base (todas las columnas de contenido). */
export function valoresDelComprobante(alta: AltaDeComprobante) {
  const c = alta.contenido;
  if ((c.asociado === null) !== (alta.asociadoId === null)) {
    throw new RangeError("una nota lleva su comprobante asociado y una factura no");
  }
  const importes = importesParaArca(c);
  const documento = c.receptor.documento;
  return {
    id: alta.id,
    empresa_id: c.empresaId,
    emisor_id: c.emisorId,
    punto_de_venta_id: c.puntoDeVentaId,
    ambiente: c.ambiente,
    origen_tipo: c.origen.tipo,
    origen_id: c.origen.id,
    clase: claseDeComprobante(c.tipo),
    tipo_comprobante: c.tipo,
    concepto: c.concepto,
    servicio_desde: c.servicio?.desde ?? null,
    servicio_hasta: c.servicio?.hasta ?? null,
    vencimiento_pago: c.servicio?.vencimientoDePago ?? null,
    moneda: c.total.moneda,
    modo_de_precio: c.modoDePrecio,
    total: importeATexto(importes.total),
    neto_gravado: importeATexto(importes.neto),
    iva: importeATexto(importes.iva),
    exento: importeATexto(importes.exento),
    no_gravado: importeATexto(importes.noGravado),
    datos_fiscales_id: alta.datosFiscales.id,
    emisor_cuit: c.emisor.cuit,
    emisor_razon_social: c.emisor.razonSocial,
    emisor_condicion_iva: c.emisor.condicionIva,
    emisor_domicilio_fiscal: formatearDomicilio(c.emisor.domicilioFiscal),
    emisor_inicio_actividades: alta.datosFiscales.inicioDeActividades,
    emisor_iibb_numero: alta.datosFiscales.iibbNumero,
    emisor_iibb_condicion: alta.datosFiscales.iibbCondicion,
    punto_de_venta_numero: c.emisor.puntoDeVentaNumero,
    punto_de_venta_domicilio: formatearDomicilio(c.emisor.domicilioDelPuntoDeVenta),
    // Sin clientes en la primera entrega (clientes §B.6.3): el receptor se congela en las columnas.
    receptor_parte_id: null,
    receptor_nombre: c.receptor.nombre,
    receptor_documento_tipo: documento.tipo,
    receptor_documento_numero: documento.tipo === "SIN_IDENTIFICAR" ? null : documento.numero,
    receptor_condicion_iva: c.receptor.condicionIva,
    receptor_domicilio: c.receptor.domicilio,
    comprobante_asociado_id: alta.asociadoId,
    motivo: c.motivo,
    huella: alta.huella,
    version_de_representacion: alta.versionDeRepresentacion,
    creado_por: alta.creadoPor,
  };
}
