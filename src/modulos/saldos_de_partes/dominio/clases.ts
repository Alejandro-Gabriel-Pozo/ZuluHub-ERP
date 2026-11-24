/**
 * Las clases de asiento del libro de saldos y su signo. Es la COPIA en código de la tabla sembrada `clase_de_asiento` (0092): una prueba
 * de integración compara las dos y falla si difieren. Una clase que no figura acá no se usa (todo nace cerrado). Previene: un asiento con
 * el signo contrario al de su clase (una factura que resta, un pago que suma) y una clase inventada que la base rechazaría tarde.
 *
 * El signo es el del IMPORTE del asiento: `+` aumenta lo que se debe (A_PAGAR: lo que se le debe al proveedor; A_COBRAR: lo que debe el
 * cliente); `-` lo reduce o es saldo a favor; `±` lo decide el asiento y exige un detalle (el motivo). Las clases de A_COBRAR las siembra CC-1.
 */
export const SENTIDOS = ["A_COBRAR", "A_PAGAR"] as const;
export type Sentido = (typeof SENTIDOS)[number];

export type SignoDeClase = "+" | "-" | "±";

export type ClaseDeAsiento = Readonly<{
  sentido: Sentido;
  clase: string;
  signo: SignoDeClase;
  exigeDetalle: boolean;
  admiteVencimiento: boolean;
}>;

export const CLASES_DE_ASIENTO: readonly ClaseDeAsiento[] = [
  {
    sentido: "A_PAGAR",
    clase: "CARGO_DE_FACTURA_DE_COMPRA",
    signo: "+",
    exigeDetalle: false,
    admiteVencimiento: true,
  },
  {
    sentido: "A_PAGAR",
    clase: "NOTA_DE_CREDITO_DE_COMPRA",
    signo: "-",
    exigeDetalle: false,
    admiteVencimiento: false,
  },
  {
    sentido: "A_PAGAR",
    clase: "PAGO_A_PROVEEDOR",
    signo: "-",
    exigeDetalle: false,
    admiteVencimiento: false,
  },
  {
    sentido: "A_PAGAR",
    clase: "REINTEGRO_DE_PROVEEDOR",
    signo: "+",
    exigeDetalle: false,
    admiteVencimiento: false,
  },
  {
    sentido: "A_PAGAR",
    clase: "CREDITO_A_FAVOR",
    signo: "-",
    exigeDetalle: false,
    admiteVencimiento: false,
  },
  {
    sentido: "A_PAGAR",
    clase: "RETENCION_PRACTICADA",
    signo: "-",
    exigeDetalle: false,
    admiteVencimiento: false,
  },
  {
    sentido: "A_PAGAR",
    clase: "AJUSTE_DE_SALDO",
    signo: "±",
    exigeDetalle: true,
    admiteVencimiento: false,
  },
];

/** La clase de ese sentido, o `null` si no existe (ni la de otro sentido con el mismo nombre). */
export function claseDe(sentido: string, clase: string): ClaseDeAsiento | null {
  return CLASES_DE_ASIENTO.find((c) => c.sentido === sentido && c.clase === clase) ?? null;
}
