import "server-only";
import type { DestinoDeModulo } from "../ui/plantillas/sesion/ArmazonDeOperacion";
import type { Pendiente } from "../ui/plantillas/sesion/PantallaDeInicio";

/**
 * Lo que cada módulo suma al armazón: sus destinos de la barra inferior y lo que falta hacer en el inicio.
 * En v1 NO hay ninguno: los llenan los tramos de los módulos (el facturador, [FAC]) agregando sus entradas acá.
 *
 * SUPUESTO declarado: todavía no hay una consulta de módulos habilitados por empresa en la composición de la
 * web (`planYModulos` y los derechos de uso no llegan a `TxDeApp`), así que el armazón muestra las entradas
 * que declaren los módulos y el SERVIDOR rechaza con su motivo («por qué no puedo») lo que la empresa no
 * tiene. Cuando exista la consulta, se filtra acá, en un solo lugar.
 */
export function destinosDeModulos(): readonly DestinoDeModulo[] {
  return [];
}

/** La ranura «lo que falta» del inicio (en v1 [FAC]: datos fiscales, punto de venta, certificado). Vacía hasta entonces. */
export function pendientesDeLaEmpresa(): readonly Pendiente[] {
  return [];
}
