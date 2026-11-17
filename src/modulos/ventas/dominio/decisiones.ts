import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Importe } from "../../../primitivas/dinero/importe";
import type { PrecioUnitario } from "../../../primitivas/dinero/precio-unitario";
import { tipoDeCortesia, type TipoDeCortesia } from "./cortesia";
import type { EstadoDeCuenta, EstadoDeLinea, EstadoDeTicket } from "./estados";

/**
 * Las decisiones de ventas, puras: dado lo que se leyó (estados y datos), qué corresponde hacer o por qué no. Los casos de uso leen, llaman a
 * estas funciones y escriben; ninguna regla vive en dos lugares (E4 §3.4, §3.5 y §3.8). Sin reloj ni azar.
 */

/** Lo único que hay que confirmar hoy: vender a $0 (decisión 155). */
export const CONFIRMACIONES_DE_VENTA = ["VENTA_A_CERO"] as const;
export type ConfirmacionDeVenta = (typeof CONFIRMACIONES_DE_VENTA)[number];

export type ErrorDeConfirmacion = "CONFIRMACION_INVALIDA";

/** Lista de permitidos: solo las confirmaciones declaradas; cualquier otra cosa es un pedido mal formado. */
export function confirmacionesDesdeTexto(
  confirmaciones: readonly string[] | undefined,
): Resultado<readonly ConfirmacionDeVenta[], ErrorDeConfirmacion> {
  const lista = confirmaciones ?? [];
  const validas = lista.filter((c): c is ConfirmacionDeVenta =>
    (CONFIRMACIONES_DE_VENTA as readonly string[]).includes(c),
  );
  return validas.length === lista.length ? ok(validas) : err("CONFIRMACION_INVALIDA");
}

export type ErrorDeConfirmacionRequerida = Readonly<{
  error: "CONFIRMACION_REQUERIDA";
  clave: ConfirmacionDeVenta;
}>;

/** Agregar una línea: la cuenta tiene que estar abierta y, si vale $0, hay que haberlo confirmado. */
export function decidirAgregarLinea(
  entrada: Readonly<{
    estadoDeLaCuenta: EstadoDeCuenta;
    precioUnitario: PrecioUnitario;
    confirmaciones: readonly ConfirmacionDeVenta[];
  }>,
): Resultado<null, "CUENTA_NO_ABIERTA" | ErrorDeConfirmacionRequerida> {
  if (entrada.estadoDeLaCuenta !== "ABIERTA") return err("CUENTA_NO_ABIERTA");
  if (entrada.precioUnitario.unidades === 0n && !entrada.confirmaciones.includes("VENTA_A_CERO")) {
    return err({ error: "CONFIRMACION_REQUERIDA", clave: "VENTA_A_CERO" });
  }
  return ok(null);
}

export type DecisionDeAnularLinea = "ANULAR" | "YA_ESTABA_ANULADA";

/** Una línea ya anulada es una repetición (aunque la cuenta ya se haya resuelto); si no, la cuenta tiene que seguir abierta. */
export function decidirAnularLinea(
  entrada: Readonly<{ estadoDeLaLinea: EstadoDeLinea; estadoDeLaCuenta: EstadoDeCuenta }>,
): Resultado<DecisionDeAnularLinea, "CUENTA_NO_ABIERTA"> {
  if (entrada.estadoDeLaLinea === "ANULADA") return ok("YA_ESTABA_ANULADA");
  return entrada.estadoDeLaCuenta === "ABIERTA" ? ok("ANULAR") : err("CUENTA_NO_ABIERTA");
}

export type DecisionDeAnularCuenta = "ANULAR" | "YA_ESTABA_ANULADA";

/** Se anula una cuenta abierta (siempre, también con todas las líneas anuladas: es la salida de R5); una ya anulada es repetición; una cerrada ya tiene ticket. */
export function decidirAnularCuenta(
  estadoDeLaCuenta: EstadoDeCuenta,
): Resultado<DecisionDeAnularCuenta, "CUENTA_CERRADA"> {
  if (estadoDeLaCuenta === "ANULADA") return ok("YA_ESTABA_ANULADA");
  return estadoDeLaCuenta === "ABIERTA" ? ok("ANULAR") : err("CUENTA_CERRADA");
}

export type DecisionDeCierre =
  | Readonly<{ tipo: "YA_CERRADA" }>
  | Readonly<{
      tipo: "CERRAR";
      estadoDelTicket: "EMITIDO" | "CORTESIA";
      cortesia: TipoDeCortesia | null;
    }>;

export type ErrorDeCierre = "CUENTA_ANULADA" | "CUENTA_SIN_LINEAS" | ErrorDeConfirmacionRequerida;

/**
 * Cerrar la cuenta (E4 §3.5 pasos 1 y 2). Por estado: ya cerrada = repetición; anulada = error. Con la cuenta abierta: al menos una línea
 * vigente; con total 0 hace falta `VENTA_A_CERO` y el ticket nace `CORTESIA`; una línea a $0 dentro de un total mayor que 0 ya se
 * confirmó al agregarla y el ticket nace `EMITIDO` marcado como cortesía parcial.
 */
export function decidirCierre(
  entrada: Readonly<{
    estadoDeLaCuenta: EstadoDeCuenta;
    total: Importe;
    preciosDeLasLineasVigentes: readonly PrecioUnitario[];
    confirmaciones: readonly ConfirmacionDeVenta[];
  }>,
): Resultado<DecisionDeCierre, ErrorDeCierre> {
  if (entrada.estadoDeLaCuenta === "CERRADA") return ok({ tipo: "YA_CERRADA" });
  if (entrada.estadoDeLaCuenta === "ANULADA") return err("CUENTA_ANULADA");
  if (entrada.preciosDeLasLineasVigentes.length === 0) return err("CUENTA_SIN_LINEAS");
  const cortesia = tipoDeCortesia(entrada.total, entrada.preciosDeLasLineasVigentes);
  if (cortesia === "TOTAL") {
    if (!entrada.confirmaciones.includes("VENTA_A_CERO")) {
      return err({ error: "CONFIRMACION_REQUERIDA", clave: "VENTA_A_CERO" });
    }
    return ok({ tipo: "CERRAR", estadoDelTicket: "CORTESIA", cortesia });
  }
  return ok({ tipo: "CERRAR", estadoDelTicket: "EMITIDO", cortesia });
}

export type ErrorDeAnularTicket = "TICKET_ANULADO" | "EJEMPLAR_DESACTUALIZADO";

/**
 * Anular un ticket (E4 §3.8): un ticket ya anulado es `TICKET_ANULADO` (con otra clave que la de la primera anulación; con la misma, la
 * idempotencia por clave devolvió lo hecho antes de llegar acá); el ejemplar que vio quien anula tiene que seguir siendo el vigente.
 */
export function decidirAnularTicket(
  entrada: Readonly<{
    estadoDelTicket: EstadoDeTicket;
    ejemplarVigenteId: string;
    ejemplarBaseId: string;
  }>,
): Resultado<null, ErrorDeAnularTicket> {
  if (entrada.estadoDelTicket === "ANULADO") return err("TICKET_ANULADO");
  if (entrada.ejemplarBaseId !== entrada.ejemplarVigenteId) return err("EJEMPLAR_DESACTUALIZADO");
  return ok(null);
}
