import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeComandas } from "../../comandas/publico";
import type { ErrorDeVentas } from "../../ventas/publico";
import type { ErrorDeDivision } from "../dominio/division";
import type { ErrorDeMesa } from "../dominio/mesa";
import type { ErrorDeUnion } from "../dominio/union";

/**
 * Los errores con nombre de los casos de uso del salón (E7 §3.4). Los de la base (restricciones) se traducen con `ERRORES_DE_SALON_POR_RESTRICCION`;
 * los de ventas, que el salón orquesta, salen tal cual (`ErrorDeVentas`).
 */
export type ErrorDeSalon =
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDeAlcance
  | ErrorDePersistencia
  | ErrorDeMesa
  | ErrorDeUnion
  | ErrorDeDivision
  | ErrorDeVentas
  | ErrorDeComandas
  | "IDENTIFICADOR_INVALIDO"
  | "SUCURSAL_NO_ENCONTRADA"
  | "SUCURSAL_INACTIVA"
  | "MESA_ID_EN_USO"
  | "MESA_NO_ENCONTRADA"
  | "MESA_INACTIVA"
  | "NUMERO_DE_MESA_EN_USO"
  | Readonly<{ error: "MESA_SUPERPUESTA"; numeros: readonly number[] }>
  | "VERSION_DESACTUALIZADA"
  | "MESA_CON_CUENTA"
  | "DIVISION_ID_EN_USO"
  | "MESA_UNIDA"
  | "MESA_NO_LIBRE"
  | "MESA_CON_PEDIDO"
  | "CUENTA_NO_ES_DE_MESA"
  | "SUCURSAL_DISTINTA"
  | "HAY_PLATOS_SIN_ENVIAR"
  | "MESA_DIVIDIDA"
  /** Dos administradores guardaron mesas con casillas que se pisan a la vez: la única de la base dejó pasar a uno. */
  | "MESA_SUPERPUESTA_AL_GUARDAR";
