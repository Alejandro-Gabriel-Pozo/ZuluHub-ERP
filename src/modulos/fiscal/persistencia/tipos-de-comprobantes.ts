import { type Importe } from "../../../primitivas/dinero/importe";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { type EmpresaId, type PersonaId } from "../../../primitivas/identificadores/marca";
import { type Resultado } from "../../../primitivas/resultado/resultado";
import { type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { DesgloseDeAlicuota } from "../dominio/comprobante";
import {
  type ClaseDeComprobante,
  type OrigenDeComprobante,
  type TipoDeComprobante,
  type TipoDeOrigen,
} from "../dominio/comprobante-emitido";
import {
  type Ambiente,
  type ComprobanteNuevo,
  type Concepto,
  type PeriodoDeServicio,
  type RenglonCalculado,
} from "../dominio/comprobante-nuevo";
import { type ModoDePrecio } from "../dominio/calculo-de-renglones";
import { type CondicionIibb } from "../dominio/datos-fiscales";
import { type CondicionIva } from "../dominio/emisor";
import { type EstadoDeComprobanteArca } from "../dominio/estados-de-comprobante";
import {
  type ComprobanteId,
  type EmisorId,
  type OrigenId,
  type PuntoDeVentaId,
  type VersionId,
} from "../dominio/identificadores";
import type { ContactoCongelado } from "../dominio/contacto-impreso";
import type { Receptor } from "../dominio/receptor";
import { type ErrorDeAlta, type ResultadoDeAlta } from "./repositorios";

/** Las formas de los comprobantes guardados y el contrato de su repositorio (salieron de `repositorio-de-comprobantes.ts` al partirlo; el texto es el mismo). */
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
  /** Lo que la sucursal tenía al nacer el comprobante: el contacto (0019, D-98) y el nombre (0022, D-114, nulo si es anterior). Lo copia la base. */
  contacto: ContactoCongelado;
  sucursalNombre: string | null;
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
  /**
   * Los ids de los comprobantes `PENDIENTE` de la empresa, los más viejos primero, hasta `limite`: los de una
   * serie (`serie`, para reencolarlos al resincronizarla) y/o los creados antes de un instante (`creadosAntesDe`,
   * los que la reconciliación reencola si quedaron sin trabajo).
   */
  pendientes(
    empresa: EmpresaId,
    filtro: Readonly<{
      serie?: Readonly<{
        puntoDeVentaId: PuntoDeVentaId;
        tipo: TipoDeComprobante;
        ambiente: Ambiente;
      }>;
      creadosAntesDe?: Date;
    }>,
    limite: number,
  ): Promise<ComprobanteId[]>;
}
