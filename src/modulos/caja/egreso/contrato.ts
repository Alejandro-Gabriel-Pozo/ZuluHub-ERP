import type { ContextoOperativo } from "../../../contexto/contexto";
import type { ImporteJson } from "../../../primitivas/dinero/importe";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDeJornadaNoAbierta } from "../../cierre/publico";
import type { TxDeCaja } from "../casos-de-uso/contrato";
import type { ErrorDeAnulacion } from "../dominio/anulacion";
import type { ErrorDeImporte } from "../dominio/importes";
import type { ErrorDeSesionParaCobrar } from "../dominio/cobrar";
import type { ErrorDeParDeCobro } from "../dominio/medios";
import type { TipoDeMedio } from "../estados";

/**
 * El puerto de egreso de efectivo de caja para compras (E9 T10b, D-E9-7): al pagar una factura en efectivo, la plata sale de la caja abierta en la
 * MISMA transacción del pago. Corre en la transacción de quien llama y NO autoriza (el permiso es el de la acción de compras que paga); caja aplica sus
 * invariantes y su aislamiento por empresa. Nunca se expone al cliente. Como el cobro, solo corre en una transacción serializable.
 */
export type OrigenDeEgreso = Readonly<{
  tipo: "PAGO_A_PROVEEDOR" | "SALIDA_DE_DINERO";
  id: string;
}>;

/** El medio por el que sale la plata cuando NO es el efectivo de siempre (la salida de dinero de caja): el par medio y cuenta de cobro, validado como el de un cobro. */
export type MedioDelEgreso = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  /** Los tipos de medio que admite quien llama (por ejemplo, según la categoría de la salida): otro tipo es `MEDIO_NO_ADMITIDO`. Ausente: cualquiera. */
  tiposAdmitidos?: readonly TipoDeMedio[] | undefined;
}>;

export type EntradaDeEgresoPorOrigen = Readonly<{
  cajaId: string;
  /** La sucursal en la que se espera la caja: una caja de otra sucursal se rechaza. */
  sucursalId: string;
  origen: OrigenDeEgreso;
  /** El monto en positivo y ARS: el egreso se guarda con signo negativo. En efectivo, salvo que venga `medio`. */
  importe: ImporteJson;
  /** Ausente: efectivo, como siempre (compras). Presente: ese medio (y cuenta), que tiene que estar activo y ser de la empresa. */
  medio?: MedioDelEgreso | undefined;
  /** Lo escribe quien paga (la pantalla): caja no inventa textos. */
  motivo: string;
}>;

export type SalidaDeEgresoPorOrigen = Readonly<{
  movimientoId: string;
  sesionId: string;
  /** `true`: ya se había registrado con este origen; no se escribió nada. */
  yaExistia: boolean;
  /** El tipo del medio por el que salió. En una repetición (`yaExistia`) es `null`: no se vuelve a leer. */
  medioTipo: TipoDeMedio | null;
  /** `true`: el egreso salió del efectivo y superó lo esperado en la sesión (queda la constancia `EGRESO_SUPERA_EFECTIVO`; no bloquea). En una repetición es `false`: no se vuelve a medir. */
  superaElEfectivo: boolean;
}>;

export type ErrorAlEgresar =
  | ErrorDeImporte
  | ErrorDeParDeCobro
  | "MEDIO_NO_ADMITIDO"
  | ErrorDeSesionParaCobrar
  | ErrorDeJornadaNoAbierta
  | "MOTIVO_INVALIDO"
  | "CLAVE_REUTILIZADA"
  | "CAJA_NO_ENCONTRADA"
  | "CAJA_INACTIVA"
  | "CAJA_DE_OTRA_SUCURSAL"
  | "SIN_PERMISO";

export type EntradaDeAnularEgresoPorOrigen = Readonly<{ origen: OrigenDeEgreso; motivo: string }>;

export type SalidaDeAnularEgresoPorOrigen = Readonly<{
  /** `null`: el origen no tenía egreso de caja (el pago se hizo sin sacar de la caja): no hay nada que anular. */
  anulacionId: string | null;
}>;

export type ErrorAlAnularEgreso = ErrorDeAnulacion | "SIN_PERMISO";

export type CajaParaCompras = Readonly<{
  registrarEgresoEnTx(
    tx: TxDeCaja,
    contexto: ContextoOperativo,
    entrada: EntradaDeEgresoPorOrigen,
  ): Promise<Resultado<SalidaDeEgresoPorOrigen, ErrorAlEgresar>>;
  anularEgresoEnTx(
    tx: TxDeCaja,
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularEgresoPorOrigen,
  ): Promise<Resultado<SalidaDeAnularEgresoPorOrigen, ErrorAlAnularEgreso>>;
}>;
