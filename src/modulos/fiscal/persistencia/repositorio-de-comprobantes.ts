import { sql, type Kysely } from "kysely";
import { cantidadATexto, cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeATexto, porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import { importeATexto, importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { moneda } from "../../../primitivas/dinero/moneda";
import {
  precioUnitarioATexto,
  precioUnitarioDesdeTexto,
} from "../../../primitivas/dinero/precio-unitario";
import { formatearDomicilio } from "../../../primitivas/domicilio/domicilio";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import {
  empresaId,
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { CODIGOS_DE_ALICUOTA } from "../dominio/alicuota";
import type { DesgloseDeAlicuota } from "../dominio/comprobante";
import {
  TIPOS_DE_COMPROBANTE,
  TIPOS_DE_ORIGEN,
  claseDeComprobante,
  type ClaseDeComprobante,
  type OrigenDeComprobante,
  type TipoDeComprobante,
  type TipoDeOrigen,
} from "../dominio/comprobante-emitido";
import {
  AMBIENTES,
  CONCEPTOS,
  type Ambiente,
  type ComprobanteNuevo,
  type Concepto,
  type PeriodoDeServicio,
  type RenglonCalculado,
} from "../dominio/comprobante-nuevo";
import { MODOS_DE_PRECIO, type ModoDePrecio } from "../dominio/calculo-de-renglones";
import { CONDICIONES_DE_IVA_DEL_RECEPTOR } from "../dominio/condicion-iva-receptor";
import { esCondicionDeIibb, type CondicionIibb } from "../dominio/datos-fiscales";
import { esCondicionDeIva, type CondicionIva } from "../dominio/emisor";
import {
  ESTADOS_DE_COMPROBANTE_ARCA,
  type EstadoDeComprobanteArca,
} from "../dominio/estados-de-comprobante";
import {
  comprobanteId,
  emisorId,
  origenId,
  puntoDeVentaId,
  versionId,
  type ComprobanteId,
  type EmisorId,
  type OrigenId,
  type PuntoDeVentaId,
  type VersionId,
} from "../dominio/identificadores";
import { importesParaArca } from "../dominio/importes-para-arca";
import { TIPOS_DE_DOCUMENTO, type DocumentoDelReceptor, type Receptor } from "../dominio/receptor";
import {
  deLaLista,
  exigir,
  serializarAltaDeId,
  type ErrorDeAlta,
  type ResultadoDeAlta,
} from "./repositorios";
import type { FiscalDb } from "./tablas";

/**
 * Repositorio de comprobantes (spec H7 facturación §B.8, tramo F3): el comprobante fiscal con sus
 * renglones y su desglose por alícuota. Mismas reglas que los demás repositorios fiscales:
 *
 *  - Todo filtra por empresa aunque la RLS ya lo imponga.
 *  - El alta es idempotente y entera: el comprobante, sus renglones y su desglose entran juntos en la
 *    transacción de quien llama (la base comprueba al confirmar que suman, `comprobante_cuadra`). Repetir
 *    el alta de lo mismo devuelve el comprobante que ya existe (`creado: false`) sin escribir un renglón
 *    más; es el caso de uso quien compara la `huella` y decide si lo repetido es lo mismo.
 *  - El contenido no se modifica nunca (ni el dueño de la base puede): solo avanza el estado, con
 *    `transicionar`, que es `UPDATE ... WHERE version = <la que se leyó>` y devuelve el comprobante nuevo o
 *    `null` si no lo tocó (otra transacción cambió antes, o no es de la empresa).
 *  - Ninguna restricción de la base se atrapa acá: salen tal cual y el adaptador de transacciones las traduce
 *    a `ErrorDePersistencia` (la traducción a motivos de negocio está en `traducir.ts`).
 *  - Dinero y cantidades viajan como `Importe`, `Cantidad` y `PrecioUnitario` del dominio y se escriben y
 *    leen como texto decimal (`numeric` exacto): nunca pasan por `number`.
 */

// =================================================================================================
// Lo que se lee
// =================================================================================================

/**
 * El emisor y el punto de venta tal como estaban al emitir (la foto que congela el comprobante). A
 * diferencia de `InstantaneaDeEmisor`, los domicilios son el TEXTO que se guardó (`formatearDomicilio`): la
 * base no conserva sus partes.
 */
export type EmisorCongelado = Readonly<{
  cuit: Cuit;
  razonSocial: string;
  condicionIva: CondicionIva;
  domicilioFiscal: string;
  inicioDeActividades: FechaCivil;
  iibbNumero: string | null;
  iibbCondicion: CondicionIibb | null;
  puntoDeVentaNumero: number;
  domicilioDelPuntoDeVenta: string;
  /** La versión confirmada de los datos fiscales de la que salió la foto. */
  datosFiscalesId: VersionId;
}>;

export type RenglonGuardado = RenglonCalculado & Readonly<{ posicion: number }>;

/** Lo que el comprobante informó a ARCA en cada total: los mismos cinco de `importesParaArca`. */
export type ImportesGuardados = Readonly<{
  total: Importe;
  /** Solo lo gravado (en la letra C, todo el total). */
  neto: Importe;
  iva: Importe;
  exento: Importe;
  noGravado: Importe;
}>;

/** La nota y lo que de su asociado viaja en `CbtesAsoc`; el asociado es siempre uno `AUTORIZADO`. */
export type AsociadoGuardado = Readonly<{
  id: ComprobanteId;
  tipo: TipoDeComprobante;
  puntoDeVenta: number;
  numero: bigint;
  cuit: Cuit;
  fecha: FechaCivil;
}>;

export type ResueltoPor = "RESPUESTA" | "RECONCILIACION";

export type ComprobanteGuardado = Readonly<{
  id: ComprobanteId;
  empresaId: EmpresaId;
  emisorId: EmisorId;
  puntoDeVentaId: PuntoDeVentaId;
  ambiente: Ambiente;
  origen: OrigenDeComprobante;
  clase: ClaseDeComprobante;
  tipo: TipoDeComprobante;
  concepto: Concepto;
  servicio: PeriodoDeServicio | null;
  modoDePrecio: ModoDePrecio;
  importes: ImportesGuardados;
  emisor: EmisorCongelado;
  receptor: Receptor;
  asociado: AsociadoGuardado | null;
  motivo: string | null;
  renglones: readonly RenglonGuardado[];
  desglose: readonly DesgloseDeAlicuota[];
  estado: EstadoDeComprobanteArca;
  /** Cuántas veces entró a `EN_VALIDACION`. */
  envios: number;
  numeroReservado: bigint | null;
  fechaEmision: FechaCivil | null;
  /** Solo un `AUTORIZADO` tiene número, CAE y todo lo que sigue. */
  numero: bigint | null;
  cae: string | null;
  caeVence: FechaCivil | null;
  autorizadoEn: Date | null;
  resueltoPor: ResueltoPor | null;
  motivoDeDescarte: string | null;
  /** SHA-256 del pedido canónico: con ella el caso de uso distingue una repetición de una clave reutilizada. */
  huella: string;
  versionDeRepresentacion: number;
  creadoPor: PersonaId;
  creadoEn: Date;
  version: number;
}>;

// =================================================================================================
// Lo que se escribe
// =================================================================================================

/** Los datos fiscales confirmados de los que sale la foto del emisor y lo que la base pide de ellos. */
export type DatosFiscalesDeLaFoto = Readonly<{
  id: VersionId;
  inicioDeActividades: FechaCivil;
  iibbNumero: string | null;
  iibbCondicion: CondicionIibb | null;
}>;

export type AltaDeComprobante = Readonly<{
  /** El `id` del comprobante: lo manda la aplicación y es la `solicitud` con la que reserva su número. */
  id: ComprobanteId;
  contenido: ComprobanteNuevo;
  datosFiscales: DatosFiscalesDeLaFoto;
  /**
   * El comprobante que la nota corrige o aumenta; `null` en una factura. De él sale lo que viaja en `CbtesAsoc`: el
   * `asociado` del contenido NO se guarda (se lee del comprobante asociado, que es siempre uno `AUTORIZADO`).
   */
  asociadoId: ComprobanteId | null;
  huella: string;
  /** La versión de la representación impresa que se sella al nacer. */
  versionDeRepresentacion: number;
  creadoPor: PersonaId;
}>;

/**
 * Cada transición de §B.2.2 con lo que nace en ella. Qué transiciones son válidas desde cada estado lo
 * decide la tabla del dominio (`TRANSICIONES_DE_COMPROBANTE`) y la impone la base (`comprobante_cambio`).
 */
export type CambioDeComprobante =
  /** `PENDIENTE` → `EN_VALIDACION`: el trabajo reservó el número (los envíos suben de a uno). */
  | Readonly<{ a: "EN_VALIDACION"; numeroReservado: bigint; fechaEmision: FechaCivil }>
  /** → `AUTORIZADO`: el número es el reservado (lo fija la base, no quien llama). */
  | Readonly<{
      a: "AUTORIZADO";
      cae: string;
      caeVence: FechaCivil;
      autorizadoEn: Date;
      resueltoPor: ResueltoPor;
    }>
  /** → `PENDIENTE`: se vacían el número y la fecha reservados. */
  | Readonly<{ a: "PENDIENTE" }>
  | Readonly<{ a: "RECHAZADO" | "INCIERTO" | "CONFLICTO" }>
  | Readonly<{ a: "DESCARTADO"; motivo: string }>;

export type ErrorDeAltaDeComprobante = ErrorDeAlta;

export interface RepositorioDeComprobantes {
  /** Un comprobante de la empresa con sus renglones y su desglose; `null` si no existe o es de otra empresa. */
  obtener(empresa: EmpresaId, id: ComprobanteId): Promise<ComprobanteGuardado | null>;
  /**
   * Los comprobantes de ese origen, en cualquier estado y de cualquier emisor y clase, los más nuevos
   * primero. Es la búsqueda de la repetición de una clave manual (§B.4.1).
   */
  delOrigen(
    empresa: EmpresaId,
    origenTipo: TipoDeOrigen,
    origenId: OrigenId,
  ): Promise<ComprobanteGuardado[]>;
  /**
   * Crea el comprobante `PENDIENTE` con sus renglones y su desglose (idempotente). Si ya hay uno de la
   * misma identidad devuelve ese (`creado: false`) sin escribir nada:
   *  - el mismo `id` con la misma identidad `(origen, emisor, clase)`;
   *  - para un origen `MANUAL`, el que tiene esa clave (una clave nunca da dos comprobantes, ni siquiera
   *    después de un rechazo ni con otra clase u otro emisor);
   *  - para los demás, el comprobante VIGENTE (ni `RECHAZADO` ni `DESCARTADO`) del mismo origen, emisor y clase.
   * El `id` de un comprobante de otra identidad, o de uno que esta empresa no ve, es `ID_EN_USO`. El
   * `valor` devuelto puede tener otro `id` que el pedido: es el comprobante que ya existía.
   */
  crear(
    alta: AltaDeComprobante,
  ): Promise<Resultado<ResultadoDeAlta<ComprobanteGuardado>, ErrorDeAltaDeComprobante>>;
  /**
   * Mueve el estado (`UPDATE ... WHERE version`): devuelve el comprobante cambiado o `null` si la versión ya
   * no es la que se leyó o no existe. Una transición que la tabla no permite sale como error de la base
   * (`comprobante_transicion_invalida`). El contenido nunca cambia.
   */
  transicionar(
    empresa: EmpresaId,
    id: ComprobanteId,
    versionEsperada: number,
    cambio: CambioDeComprobante,
  ): Promise<ComprobanteGuardado | null>;
  /**
   * Los comprobantes `EN_VALIDACION` o `INCIERTO` cuya reserva en la serie venció (`en_curso_hasta <= ahora`),
   * los de reserva más vieja primero, hasta `limite`. Es lo que la reconciliación tiene que resolver.
   */
  enVueloVencidos(empresa: EmpresaId, ahora: Date, limite: number): Promise<ComprobanteGuardado[]>;
}

// =================================================================================================
// Filas ↔ dominio
// =================================================================================================

/** Una fecha civil que la base guardó: si no es válida, algo se rompió. */
function fechaDeLaBase(texto: string, nombre: string): FechaCivil {
  const r = fechaCivilDesdeTexto(texto);
  if (!r.ok) throw new RangeError(`${nombre} inválida en la base: ${texto}`);
  return r.valor;
}

// Una columna `date` leída como texto: `pg` la devolvería como un `Date` a la medianoche local, que corre un
// día según el huso.
const aFecha = <C extends string>(columna: C) =>
  sql<string>`to_char(${sql.ref(columna)}, 'YYYY-MM-DD')`.as(columna);
const aFechaOpcional = <C extends string>(columna: C) =>
  sql<string | null>`to_char(${sql.ref(columna)}, 'YYYY-MM-DD')`.as(columna);

/** Las columnas del comprobante, con las fechas (`date`) como texto `YYYY-MM-DD`. */
const COLUMNAS_DE_COMPROBANTE = [
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
  "creado_por",
  "creado_en",
  "version",
] as const;

type FilaDeComprobante = Readonly<{
  id: string;
  empresa_id: string;
  emisor_id: string;
  punto_de_venta_id: string;
  ambiente: string;
  origen_tipo: string;
  origen_id: string;
  clase: string;
  tipo_comprobante: string;
  concepto: string;
  servicio_desde: string | null;
  servicio_hasta: string | null;
  vencimiento_pago: string | null;
  moneda: string;
  modo_de_precio: string;
  total: string;
  neto_gravado: string;
  iva: string;
  exento: string;
  no_gravado: string;
  datos_fiscales_id: string;
  emisor_cuit: string;
  emisor_razon_social: string;
  emisor_condicion_iva: string;
  emisor_domicilio_fiscal: string;
  emisor_inicio_actividades: string;
  emisor_iibb_numero: string | null;
  emisor_iibb_condicion: string | null;
  punto_de_venta_numero: number;
  punto_de_venta_domicilio: string;
  receptor_nombre: string | null;
  receptor_documento_tipo: string;
  receptor_documento_numero: string | null;
  receptor_condicion_iva: string;
  receptor_domicilio: string | null;
  comprobante_asociado_id: string | null;
  motivo: string | null;
  estado: string;
  envios: number;
  numero_reservado: string | null;
  fecha_emision: string | null;
  numero: string | null;
  cae: string | null;
  cae_vence: string | null;
  autorizado_en: Date | null;
  resuelto_por: string | null;
  motivo_descarte: string | null;
  huella: string;
  version_de_representacion: number;
  creado_por: string;
  creado_en: Date;
  version: number;
}>;

type FilaDeRenglon = Readonly<{
  posicion: number;
  descripcion: string;
  cantidad: string;
  precio_unitario: string;
  descuento: string | null;
  alicuota: string | null;
  importe: string;
}>;

type FilaDeDesglose = Readonly<{ alicuota: string; total: string; neto: string; iva: string }>;

const RESUELTO_POR: readonly ResueltoPor[] = ["RESPUESTA", "RECONCILIACION"];
const CLASES: readonly ClaseDeComprobante[] = ["FACTURA", "NOTA_DEBITO", "NOTA_CREDITO"];

function aReceptor(fila: FilaDeComprobante): Receptor {
  const tipo = fila.receptor_documento_tipo;
  const documento: DocumentoDelReceptor =
    tipo === "SIN_IDENTIFICAR"
      ? { tipo }
      : {
          tipo: deLaLista(TIPOS_DE_DOCUMENTO, tipo, "tipo de documento del receptor"),
          numero: exigir(fila.receptor_documento_numero, "receptor_documento_numero"),
        };
  return {
    nombre: fila.receptor_nombre,
    documento,
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

function aComprobante(
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
    creadoPor: personaId(fila.creado_por),
    creadoEn: fila.creado_en,
    version: fila.version,
  };
}

/** Los valores del comprobante tal como los pide la base (todas las columnas de contenido). */
function valoresDelComprobante(alta: AltaDeComprobante) {
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

// =================================================================================================
// El repositorio
// =================================================================================================

export function crearRepositorioDeComprobantes(db: Kysely<FiscalDb>): RepositorioDeComprobantes {
  const seleccionar = () => db.selectFrom("comprobante").select(COLUMNAS_DE_COMPROBANTE);

  async function armar(fila: FilaDeComprobante): Promise<ComprobanteGuardado> {
    // Una consulta por vez: la conexión de la transacción es una sola (`pg` ya no admite pedir otra mientras corre una).
    const renglones = await db
      .selectFrom("comprobante_linea")
      .select([
        "posicion",
        "descripcion",
        "cantidad",
        "precio_unitario",
        "descuento",
        "alicuota",
        "importe",
      ])
      .where("empresa_id", "=", fila.empresa_id)
      .where("comprobante_id", "=", fila.id)
      .orderBy("posicion")
      .execute();
    const desglose = await db
      .selectFrom("comprobante_alicuota")
      .select(["alicuota", "total", "neto", "iva"])
      .where("empresa_id", "=", fila.empresa_id)
      .where("comprobante_id", "=", fila.id)
      .execute();
    const asociado =
      fila.comprobante_asociado_id === null
        ? null
        : await db
            .selectFrom("comprobante")
            .select([
              "id",
              "tipo_comprobante",
              "punto_de_venta_numero",
              "emisor_cuit",
              "numero",
              aFechaOpcional("fecha_emision"),
            ])
            .where("empresa_id", "=", fila.empresa_id)
            .where("id", "=", fila.comprobante_asociado_id)
            .executeTakeFirst();
    let aso: AsociadoGuardado | null = null;
    if (fila.comprobante_asociado_id !== null) {
      // La base garantiza que el asociado existe y está `AUTORIZADO` (con número y fecha).
      if (asociado === null || asociado === undefined) {
        throw new RangeError("el comprobante asociado no se pudo leer");
      }
      aso = {
        id: comprobanteId(asociado.id),
        tipo: deLaLista(TIPOS_DE_COMPROBANTE, asociado.tipo_comprobante, "tipo de comprobante"),
        puntoDeVenta: asociado.punto_de_venta_numero,
        numero: BigInt(exigir(asociado.numero, "numero del asociado")),
        cuit: asociado.emisor_cuit as Cuit,
        fecha: fechaDeLaBase(
          exigir(asociado.fecha_emision, "fecha del asociado"),
          "fecha del asociado",
        ),
      };
    }
    return aComprobante(fila, renglones, desglose, aso);
  }

  async function obtener(
    empresa: EmpresaId,
    id: ComprobanteId,
  ): Promise<ComprobanteGuardado | null> {
    const fila = await seleccionar()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .executeTakeFirst();
    return fila === undefined ? null : armar(fila);
  }

  /** El comprobante que ya existe para esta alta (ver `crear`), o `null` si no hay ninguno visible. */
  async function existenteDe(
    alta: AltaDeComprobante,
  ): Promise<ComprobanteGuardado | "ID_EN_USO" | null> {
    const c = alta.contenido;
    const clase = claseDeComprobante(c.tipo);
    const porId = await obtener(c.empresaId, alta.id);
    if (porId !== null) {
      const mismaIdentidad =
        porId.origen.tipo === c.origen.tipo &&
        porId.origen.id === c.origen.id &&
        porId.emisorId === c.emisorId &&
        porId.clase === clase;
      return mismaIdentidad ? porId : "ID_EN_USO";
    }
    const porOrigen = seleccionar()
      .where("empresa_id", "=", c.empresaId)
      .where("origen_id", "=", c.origen.id);
    const fila =
      c.origen.tipo === "MANUAL"
        ? await porOrigen.where("origen_tipo", "=", "MANUAL").executeTakeFirst()
        : await porOrigen
            .where("origen_tipo", "=", c.origen.tipo)
            .where("emisor_id", "=", c.emisorId)
            .where("clase", "=", clase)
            .where("estado", "not in", ["RECHAZADO", "DESCARTADO"])
            .executeTakeFirst();
    return fila === undefined ? null : armar(fila);
  }

  return {
    obtener,

    async delOrigen(empresa, origenTipo, origen) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("origen_tipo", "=", origenTipo)
        .where("origen_id", "=", origen)
        .orderBy("creado_en", "desc")
        .orderBy("id")
        .execute();
      const armados: ComprobanteGuardado[] = [];
      for (const fila of filas) armados.push(await armar(fila));
      return armados;
    },

    async crear(alta) {
      const c = alta.contenido;
      const valores = valoresDelComprobante(alta);
      // Dos altas del mismo origen a la vez: la segunda espera a que la primera termine y ve su fila (ver
      // `serializarAltaDeId`). Sin esto la perdedora de la carrera chocaba con una de las otras únicas.
      await serializarAltaDeId(
        db,
        "comprobante_origen",
        `${c.empresaId}|${c.origen.tipo}|${c.origen.id}`,
      );
      // Sin objetivo de conflicto: el `id`, la identidad vigente y la clave manual son únicas distintas y
      // cualquiera de las tres significa «ya estaba»; abajo se busca cuál.
      const nuevo = await db
        .insertInto("comprobante")
        .values(valores)
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      if (nuevo === undefined) {
        const existente = await existenteDe(alta);
        if (existente === null || existente === "ID_EN_USO") return err("ID_EN_USO");
        return ok({ creado: false, valor: existente });
      }
      await db
        .insertInto("comprobante_linea")
        .values(
          c.renglones.map((r, i) => ({
            empresa_id: c.empresaId,
            comprobante_id: alta.id,
            posicion: i + 1,
            descripcion: r.descripcion,
            cantidad: cantidadATexto(r.cantidad),
            precio_unitario: precioUnitarioATexto(r.precioUnitario),
            descuento: r.descuento === null ? null : porcentajeATexto(r.descuento),
            alicuota: r.alicuota,
            importe: importeATexto(r.importe),
          })),
        )
        .execute();
      if (c.desglose.length > 0) {
        await db
          .insertInto("comprobante_alicuota")
          .values(
            c.desglose.map((d) => ({
              empresa_id: c.empresaId,
              comprobante_id: alta.id,
              alicuota: d.alicuota,
              total: importeATexto(d.total),
              neto: importeATexto(d.neto),
              iva: importeATexto(d.iva),
            })),
          )
          .execute();
      }
      const guardado = await obtener(c.empresaId, alta.id);
      if (guardado === null) throw new Error("el comprobante recién creado no se pudo leer");
      return ok({ creado: true, valor: guardado });
    },

    async transicionar(empresa, id, versionEsperada, cambio) {
      const cambios = (() => {
        switch (cambio.a) {
          case "EN_VALIDACION":
            return {
              estado: cambio.a,
              envios: sql<number>`envios + 1`,
              numero_reservado: cambio.numeroReservado.toString(),
              fecha_emision: cambio.fechaEmision,
            };
          case "AUTORIZADO":
            return {
              estado: cambio.a,
              // El número autorizado es el reservado: lo copia la base, no se elige.
              numero: sql<string>`numero_reservado`,
              cae: cambio.cae,
              cae_vence: cambio.caeVence,
              autorizado_en: cambio.autorizadoEn,
              resuelto_por: cambio.resueltoPor,
            };
          case "PENDIENTE":
            return { estado: cambio.a, numero_reservado: null, fecha_emision: null };
          case "DESCARTADO":
            return { estado: cambio.a, motivo_descarte: cambio.motivo };
          case "RECHAZADO":
          case "INCIERTO":
          case "CONFLICTO":
            return { estado: cambio.a };
        }
      })();
      const actualizado = await db
        .updateTable("comprobante")
        .set(cambios)
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returning("id")
        .executeTakeFirst();
      return actualizado === undefined ? null : obtener(empresa, id);
    },

    async enVueloVencidos(empresa, ahora, limite) {
      const ids = await db
        .selectFrom("comprobante")
        .innerJoin("serie_comprobante", (unir) =>
          unir
            .onRef("serie_comprobante.empresa_id", "=", "comprobante.empresa_id")
            .onRef("serie_comprobante.punto_de_venta_id", "=", "comprobante.punto_de_venta_id")
            .onRef("serie_comprobante.tipo_comprobante", "=", "comprobante.tipo_comprobante")
            .onRef("serie_comprobante.ambiente", "=", "comprobante.ambiente"),
        )
        .select("comprobante.id")
        .where("comprobante.empresa_id", "=", empresa)
        .where("comprobante.estado", "in", ["EN_VALIDACION", "INCIERTO"])
        .where("serie_comprobante.estado", "=", "EN_CURSO")
        .where("serie_comprobante.en_curso_hasta", "<=", ahora)
        .orderBy("serie_comprobante.en_curso_hasta")
        .orderBy("comprobante.id")
        .limit(limite)
        .execute();
      const encontrados: ComprobanteGuardado[] = [];
      for (const f of ids) {
        const c = await obtener(empresa, comprobanteId(f.id));
        if (c !== null) encontrados.push(c);
      }
      return encontrados;
    },
  };
}
