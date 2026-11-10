import type { ContextoOperativo } from "../../../contexto/contexto";
import type { Importe } from "../../../primitivas/dinero/importe";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { ErrorDeJornada } from "../../../primitivas/tiempo/fecha-de-negocio";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { TxDeJornadas, ErrorDeJornadaNoAbierta } from "../../cierre/publico";
import type { RepositorioDeSucursales } from "../../empresas/publico";
import type { TxDeCaja } from "../casos-de-uso/contrato";
import type { DatosDelCobro, ErrorDeDatoDelCobro } from "../dominio/datos-del-cobro";
import type { ErrorDeParDeCobro } from "../dominio/medios";
import type { ReferenciaOpaca } from "../dominio/identidad-del-cobro";
import type { EstadoDeCaja } from "../dominio/sesion";
import type { TipoDeCuenta, TipoDeMedio } from "../estados";
import type { RepositorioDeCajas } from "../persistencia/repositorio-de-cajas";
import type { RepositorioDeCobros } from "../persistencia/repositorio-de-cobros";
import type { RepositorioDeCuentasDeCobro } from "../persistencia/repositorio-de-cuentas";
import type { RepositorioDeMediosDePago } from "../persistencia/repositorio-de-medios";
import type { RepositorioDeSesiones } from "../persistencia/repositorio-de-sesiones";

/**
 * El puerto «cobrar» de caja para ventas (e3 §3.5; lo consume E4). Corre EN LA TRANSACCIÓN DE QUIEN LLAMA (ventas) y NO autoriza: el
 * permiso es el de la acción de ventas (`tickets.cobrar`); caja aplica todas sus invariantes y su aislamiento por empresa (RLS). Nunca se
 * expone al cliente: no es una acción de servidor ni una ruta (`test/arquitectura/cobrar-no-expuesto.test.ts`). Los identificadores son
 * texto UUID en minúsculas (`CajaId`, `MedioDePagoId`, `CuentaDeCobroId`, `MovimientoDeCajaId`, `SesionDeCajaId` del spec).
 *
 * Diferencias con la firma de e3 §3.5, todas por lo mismo: sin empresa ni reloj no se puede leer ni fechar, y un identificador que no existe
 * no puede ser un valor de salida. Las lecturas reciben el `contexto` (la empresa y `ahora`, como `registrarCobroEnTx`) y devuelven
 * `Resultado` cuando pueden fallar por algo que no es un dato (`SUCURSAL_NO_ENCONTRADA`, `CAJA_NO_ENCONTRADA`).
 */

/**
 * Lo que lee el puerto sin escribir (`TxDeCaja` lo contiene: la transacción de ventas sirve igual para leer y para cobrar). Por tipos, una
 * lectura no tiene auditoría ni inserción.
 */
export type TxDeLecturaDeCaja = TxDeJornadas &
  Readonly<{
    sucursales: Pick<RepositorioDeSucursales, "jornadaDe">;
    cajas: Pick<RepositorioDeCajas, "obtener" | "listarDeLaSucursal">;
    sesiones: Pick<RepositorioDeSesiones, "vigenteDeLaCaja">;
    mediosDePago: Pick<RepositorioDeMediosDePago, "listar">;
    cuentasDeCobro: Pick<RepositorioDeCuentasDeCobro, "listar">;
    cobros: Pick<RepositorioDeCobros, "marcasActivas" | "deOrigen">;
  }>;

export type { ReferenciaOpaca, DatosDelCobro, EstadoDeCaja };

export type CajaParaCobrar = Readonly<{
  cajaId: string;
  nombre: string;
  estado: EstadoDeCaja;
  sesionId: string | null;
  /** La jornada de la sesión; `null` sin sesión. */
  fechaDeNegocio: FechaCivil | null;
  /** La sesión sigue abierta después de su jornada: sigue cobrando en ella (decisión de diseño F1); la pantalla puede avisar. */
  jornadaVencida: boolean;
}>;

export type JornadaActualParaCobrar = Readonly<{
  fechaDeNegocio: FechaCivil;
  /** Si no es `ABIERTA`, no se puede abrir una caja (e3b §3.4). Una jornada sin actividad todavía es `ABIERTA`: abrir la crea. */
  estado: "ABIERTA" | "EN_AUDITORIA" | "CERRADA";
}>;

export type EstadoDeCajasParaCobrar = Readonly<{
  cajas: readonly CajaParaCobrar[];
  jornadaActual: JornadaActualParaCobrar;
}>;

export type ErrorAlConsultarCajasParaCobrar =
  "SUCURSAL_NO_ENCONTRADA" | ErrorDeJornada | ErrorDePersistencia;

export type OpcionDeCobro = Readonly<{
  id: string;
  tipo: TipoDeMedio;
  nombre: string | null;
  cuentaObligatoria: boolean;
  cuentas: readonly Readonly<{ id: string; tipo: TipoDeCuenta; nombre: string }>[];
  datosQuePide: Readonly<{
    cupon: boolean;
    ultimos4: boolean;
    marca: boolean;
    cuotas: boolean;
    dni: boolean;
  }>;
}>;

export type OpcionesDeCobro = Readonly<{
  medios: readonly OpcionDeCobro[];
  marcasDeTarjeta: readonly Readonly<{ id: string; nombre: string }>[];
}>;

export type ErrorAlConsultarOpcionesDeCobro = "CAJA_NO_ENCONTRADA" | "CAJA_INACTIVA";

export type EntradaDeRegistrarCobro = Readonly<{
  /** Qué documento originó el cobro, ej. `{ tipo: "ventas.cobranza_de_ticket", id: cobranzaId }`. */
  origen: ReferenciaOpaca;
  /** La posición del cobro dentro de su origen, de 1 a 50: dos cobros de un mismo ticket con medios distintos son el 1 y el 2. */
  origenOrden: number;
  cajaId: string;
  sucursalId: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  /** ARS, mayor que cero y hasta 999.999.999,99: el NETO que queda en el cajón (el vuelto lo calcula la pantalla). */
  importe: Importe;
  /** Todos opcionales; nunca bloquean, salvo que vengan mal escritos o que el medio no los habilite. */
  datos: DatosDelCobro;
}>;

export type SalidaDeRegistrarCobro = Readonly<{
  /** El id del movimiento de caja (el cobro es 1:1 con él). */
  cobroId: string;
  sesionId: string;
  /** La jornada de la SESIÓN, que la venta guarda tal cual. */
  fechaDeNegocio: FechaCivil;
  jornadaVencida: boolean;
  /** `true`: ese `(origen, orden)` ya estaba cobrado con el mismo contenido; no se escribió ni se auditó nada. */
  yaExistia: boolean;
}>;

/**
 * Los errores del cobro: códigos tipados, nunca texto. Los que llevan un dato (`SIN_SESION_ABIERTA`, `CAJA_EN_CIERRE`, los de un dato del
 * cobro) son objetos con `codigo`. `SIN_PERMISO` es la persona ausente del contexto (sin persona no hay quién deje constancia, ni
 * `registrado_por` que la base acepte): no es autorización, que es de ventas.
 */
export type ErrorAlCobrar =
  | "SIN_PERMISO"
  | "CAJA_NO_ENCONTRADA"
  | "CAJA_INACTIVA"
  | "CAJA_DE_OTRA_SUCURSAL"
  | Readonly<{ codigo: "SIN_SESION_ABIERTA"; cajaId: string }>
  | Readonly<{ codigo: "CAJA_EN_CIERRE"; cajaId: string; sesionId: string }>
  | ErrorDeJornadaNoAbierta
  | ErrorDeParDeCobro
  | "IMPORTE_INVALIDO"
  | "MONEDA_NO_SOPORTADA"
  | "ORIGEN_INVALIDO"
  | ErrorDeDatoDelCobro
  | "CLAVE_REUTILIZADA"
  | ErrorDeJornada
  | ErrorDePersistencia;

export type CobroConMedioVigente = Readonly<{
  cobroId: string;
  origenOrden: number;
  importe: Importe;
  /** El medio con el que se cobró. */
  medioTipo: TipoDeMedio;
  /** El medio tras las correcciones de medio (e3b §4.3); igual a `medioTipo` si no hubo. */
  medioVigenteTipo: TipoDeMedio;
  /** La cuenta con la que se cobró. */
  cuentaDeCobroId: string | null;
  fechaDeNegocio: FechaCivil;
}>;

export type CobrosDeUnOrigen = Readonly<{
  /** La suma exacta de los cobros del origen. NO cambia con una corrección de medio: el ticket sigue cobrado por el mismo total. */
  cobrado: Importe;
  cobros: readonly CobroConMedioVigente[];
}>;

export interface CajaParaVentas {
  /** 1. Lectura previa: qué mostrar antes de cobrar (decisión 145). No escribe. */
  estadoDeCajasParaCobrar(
    tx: TxDeLecturaDeCaja,
    contexto: ContextoOperativo,
    sucursalId: string,
  ): Promise<Resultado<EstadoDeCajasParaCobrar, ErrorAlConsultarCajasParaCobrar>>;
  /** 2. Qué ofrecer en la pantalla de cobro: solo medios y cuentas activos de la sucursal de la caja. No escribe. */
  opcionesDeCobro(
    tx: TxDeLecturaDeCaja,
    contexto: ContextoOperativo,
    cajaId: string,
  ): Promise<Resultado<OpcionesDeCobro, ErrorAlConsultarOpcionesDeCobro>>;
  /** 3. Escribe UN cobro en la sesión abierta de la caja, en la transacción del llamador. */
  registrarCobroEnTx(
    tx: TxDeCaja,
    contexto: ContextoOperativo,
    entrada: EntradaDeRegistrarCobro,
  ): Promise<Resultado<SalidaDeRegistrarCobro, ErrorAlCobrar>>;
  /** 4. Cuánto se cobró de un origen (para cuadrar el ticket y para reintentos). No escribe. */
  cobrosPorOrigen(
    tx: TxDeLecturaDeCaja,
    contexto: ContextoOperativo,
    origen: ReferenciaOpaca,
  ): Promise<CobrosDeUnOrigen>;
}
