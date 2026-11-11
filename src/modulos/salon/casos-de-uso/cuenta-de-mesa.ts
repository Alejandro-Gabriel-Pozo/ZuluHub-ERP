import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Cuenta } from "../../ventas/publico";
import type { TxDeSalon } from "./contrato";
import type { ErrorDeSalon } from "./errores";

/** Los tipos de ancla del salón (E7 §3.2): la mesa (id = mesa) y la cuenta hija de una división (id = la propia cuenta). */
export const ANCLA_DE_MESA = "salon.mesa";
export const ANCLA_DE_PARTE = "salon.parte";

/** Los motivos internos con los que el salón anula (códigos de máquina, no textos de pantalla; E7 S-5). */
export const MOTIVO_UNIDA_COBRADA = "UNIDA_COBRADA";
export const MOTIVO_DIVISION_COBRADA = "DIVISION_COBRADA";
export const MOTIVO_MESA_LIBERADA = "MESA_LIBERADA";

/**
 * Qué es una cuenta para el salón. `MESA`: la cuenta de una mesa, donde se toma el pedido. `HIJA`: una cuenta de una división (se cobra sola).
 * `RESERVA_DE_UNION` y `RESERVA_DE_DIVISION`: la cuenta que sigue ABIERTA y sin líneas para sostener el ancla de su mesa (es lo que impide, EN LA BASE,
 * tomar un pedido nuevo en una mesa unida o dividida): nadie la usa. `AJENA`: no es del salón.
 */
export type ClaseDeCuenta =
  | Readonly<{ clase: "MESA"; mesaId: string }>
  | Readonly<{ clase: "HIJA" }>
  | Readonly<{ clase: "RESERVA_DE_UNION"; mesaId: string }>
  | Readonly<{ clase: "RESERVA_DE_DIVISION"; mesaId: string }>
  | Readonly<{ clase: "AJENA" }>;

export async function claseDeCuenta(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  cuenta: Cuenta,
): Promise<ClaseDeCuenta> {
  const { empresaId } = contexto;
  if (cuenta.ancla === null) return { clase: "AJENA" };
  if (cuenta.ancla.tipo === ANCLA_DE_PARTE) return { clase: "HIJA" };
  if (cuenta.ancla.tipo !== ANCLA_DE_MESA) return { clase: "AJENA" };
  const mesaId = cuenta.ancla.id;
  if ((await tx.unionesYDivisiones.unionPorOrigen(empresaId, cuenta.id)) !== null) {
    return { clase: "RESERVA_DE_UNION", mesaId };
  }
  if ((await tx.unionesYDivisiones.divisionPorMadre(empresaId, cuenta.id)) !== null) {
    return { clase: "RESERVA_DE_DIVISION", mesaId };
  }
  return { clase: "MESA", mesaId };
}

/** La cuenta de una mesa o de una hija, o el error que corresponde (la reserva no se usa; una cuenta ajena no es del salón). */
export function exigirCuentaUsable(
  clase: ClaseDeCuenta,
  aceptaHija: boolean,
): Resultado<ClaseDeCuenta, ErrorDeSalon> {
  switch (clase.clase) {
    case "MESA":
      return ok(clase);
    case "HIJA":
      return aceptaHija ? ok(clase) : err("MESA_DIVIDIDA");
    case "RESERVA_DE_UNION":
      return err("MESA_UNIDA");
    case "RESERVA_DE_DIVISION":
      return err("MESA_DIVIDIDA");
    case "AJENA":
      return err("CUENTA_NO_ES_DE_MESA");
  }
}

/** El rótulo que va en el papel de cocina («Mesa 5»): lo arma el servidor desde la mesa, nunca el cliente. */
export async function rotuloDeLaCuenta(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  cuenta: Cuenta,
  clase: ClaseDeCuenta,
): Promise<Resultado<string, ErrorDeSalon>> {
  const { empresaId } = contexto;
  let mesaId: string;
  if (clase.clase === "MESA") {
    mesaId = clase.mesaId;
  } else if (clase.clase === "HIJA") {
    const hija = await tx.unionesYDivisiones.divisionPorHija(empresaId, cuenta.id);
    if (hija === null) return err("CUENTA_NO_ES_DE_MESA");
    mesaId = hija.division.mesaId;
  } else {
    return err("CUENTA_NO_ES_DE_MESA");
  }
  const mesa = await tx.mesas.obtener(empresaId, mesaId);
  if (mesa === null) return err("MESA_NO_ENCONTRADA");
  return ok(`Mesa ${mesa.numero}`);
}
