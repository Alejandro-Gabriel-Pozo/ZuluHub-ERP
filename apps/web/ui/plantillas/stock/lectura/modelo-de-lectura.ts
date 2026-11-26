import { RUTAS_DE_STOCK } from "../rutas-de-stock";

/**
 * Lo que comparten las dos pantallas de lectura de Stock (Existencias y Movimientos, maqueta `stock.html`, 09/11/2026): adónde lleva cada depósito del selector y la página siguiente.
 * El depósito y el cursor viajan en la dirección (`?deposito=` y `?despues=`); la sucursal, no: la fija el servidor. Puro: sin React ni servidor.
 */

type Pantalla = "existencias" | "movimientos";

/** La dirección de una pantalla de lectura con su depósito y, si hay, la página que sigue. El cursor es opaco: se pasa tal cual. */
export function hrefDeLectura(
  pantalla: Pantalla,
  depositoId: string | null,
  despues: string | null = null,
): string {
  const consulta = new URLSearchParams();
  if (depositoId !== null) consulta.set("deposito", depositoId);
  if (despues !== null) consulta.set("despues", despues);
  const texto = consulta.toString();
  return texto === "" ? RUTAS_DE_STOCK[pantalla] : `${RUTAS_DE_STOCK[pantalla]}?${texto}`;
}

/** Lo que el navegador manda en la dirección, solo como texto: la forma la valida la composición. Un valor repetido o de otro tipo se descarta. */
export function leerLaLectura(
  params: Readonly<Record<string, string | string[] | undefined>>,
): Readonly<{ depositoId?: string; despues?: string }> {
  const uno = (v: string | string[] | undefined): string | undefined =>
    typeof v === "string" && v !== "" ? v : undefined;
  const depositoId = uno(params["deposito"]);
  const despues = uno(params["despues"]);
  return {
    ...(depositoId === undefined ? {} : { depositoId }),
    ...(despues === undefined ? {} : { despues }),
  };
}
