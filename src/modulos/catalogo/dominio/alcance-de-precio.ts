import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "./identificadores";

/**
 * FICHA DEL DATO: ALCANCE DE UN PRECIO (A1, `fichas-de-modulo/a1-productos-y-precios.md`; decisión del 9/11/2026: el precio es de la empresa o de una sucursal, la opción no).
 * «EMPRESA» vale para todas las sucursales (en la fila de `precio_de_venta` es `sucursal_id` nulo) y «SUCURSAL» solo para la sucursal elegida. Todo nace cerrado: «SUCURSAL» sin
 * sucursal elegida NO se toma por «EMPRESA» (sin sucursal elegida nunca se asume «todas»; CLAUDE.md) y un alcance que no es de la lista se rechaza. Devuelve la sucursal
 * de la fila: `null` para la empresa. Previene: un precio pensado para una sucursal que se guarda para todas por no haber llegado el id.
 */
export const ALCANCES_DE_PRECIO = ["EMPRESA", "SUCURSAL"] as const;
export type AlcanceDePrecio = (typeof ALCANCES_DE_PRECIO)[number];

export type ErrorDeAlcanceDePrecio =
  "ALCANCE_INVALIDO" | "SUCURSAL_REQUERIDA" | "SUCURSAL_INVALIDA";

export function sucursalDelAlcanceDePrecio(
  alcance: string,
  sucursalElegida: string | null,
): Resultado<string | null, ErrorDeAlcanceDePrecio> {
  if (alcance === "EMPRESA") return ok(null);
  if (alcance !== "SUCURSAL") return err("ALCANCE_INVALIDO");
  if (sucursalElegida === null || sucursalElegida === "") return err("SUCURSAL_REQUERIDA");
  return esUuid(sucursalElegida) ? ok(sucursalElegida) : err("SUCURSAL_INVALIDA");
}
