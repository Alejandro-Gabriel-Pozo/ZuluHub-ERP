import type { ContextoOperativo } from "../../../contexto/contexto";
import type { ImporteJson } from "../../../primitivas/dinero/importe";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDeJornadaNoAbierta } from "../../cierre/publico";
import type { TxDeCaja } from "../casos-de-uso/contrato";
import type { ErrorDeAnulacion } from "../dominio/anulacion";
import type { ErrorDeImporte } from "../dominio/importes";
import type { ErrorDeSesionParaCobrar } from "../dominio/cobrar";
import type { TipoDeOrigenDeIngreso } from "../dominio/origen-de-movimiento";

/**
 * El puerto de INGRESO de efectivo a la caja por origen (LB-5): espejo del de egreso. Lo usan el reintegro de un proveedor (N4-T4) y la devolución del sobrante de
 * un anticipo a rendir: la plata entra a la caja abierta en la MISMA transacción de quien la recibe. Corre en la transacción de quien llama y NO autoriza (el
 * permiso es el de la acción que lo pide: gerente y administrador; `movimientos_caja.registrar_manual`, que alcanza al operador, NO abre este puerto); caja
 * aplica sus invariantes y su aislamiento por empresa. Nunca se expone al cliente. Como el cobro, solo corre en una transacción serializable.
 */
export type OrigenDeIngreso = Readonly<{ tipo: TipoDeOrigenDeIngreso; id: string }>;

export type EntradaDeIngresoPorOrigen = Readonly<{
  cajaId: string;
  /** La sucursal en la que se espera la caja: una caja de otra sucursal se rechaza. */
  sucursalId: string;
  origen: OrigenDeIngreso;
  /** El monto en positivo y ARS: el ingreso se guarda con signo positivo, en efectivo. */
  importe: ImporteJson;
  /** Lo escribe quien lo registra (la pantalla): caja no inventa textos. */
  motivo: string;
}>;

export type SalidaDeIngresoPorOrigen = Readonly<{
  movimientoId: string;
  sesionId: string;
  /** `true`: ya se había registrado con este origen; no se escribió nada. */
  yaExistia: boolean;
}>;

export type ErrorAlIngresar =
  | ErrorDeImporte
  | ErrorDeSesionParaCobrar
  | ErrorDeJornadaNoAbierta
  | "MOTIVO_INVALIDO"
  | "ORIGEN_INVALIDO"
  | "CLAVE_REUTILIZADA"
  | "CAJA_NO_ENCONTRADA"
  | "CAJA_INACTIVA"
  | "CAJA_DE_OTRA_SUCURSAL"
  | "SIN_PERMISO";

export type EntradaDeAnularIngresoPorOrigen = Readonly<{ origen: OrigenDeIngreso; motivo: string }>;

export type SalidaDeAnularIngresoPorOrigen = Readonly<{
  /** `null`: el origen no tenía ingreso de caja (se recibió sin meterlo en la caja): no hay nada que anular. */
  anulacionId: string | null;
}>;

export type ErrorAlAnularIngreso = ErrorDeAnulacion | "ORIGEN_INVALIDO" | "SIN_PERMISO";

export type CajaParaIngresos = Readonly<{
  registrarIngresoEnTx(
    tx: TxDeCaja,
    contexto: ContextoOperativo,
    entrada: EntradaDeIngresoPorOrigen,
  ): Promise<Resultado<SalidaDeIngresoPorOrigen, ErrorAlIngresar>>;
  /** Anula el ingreso con un registro nuevo: el egreso inverso (espejo exacto). Nunca borra. */
  anularIngresoEnTx(
    tx: TxDeCaja,
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularIngresoPorOrigen,
  ): Promise<Resultado<SalidaDeAnularIngresoPorOrigen, ErrorAlAnularIngreso>>;
}>;
