import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { ImporteJson } from "../../../primitivas/dinero/importe";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorAlCobrar } from "../../caja/publico";
import type { ErrorDeCotizacion } from "../../catalogo/publico";
import type { ErrorDeCuadre, ErrorAlDecidirCobrar, ErrorDeCobros } from "../dominio/cobranza";
import type { ErrorDeJornadaNoAbierta } from "../../cierre/publico";
import type {
  ErrorDeCierre,
  ErrorDeAnularTicket,
  ErrorDeConfirmacion,
} from "../dominio/decisiones";
import type { ErrorDeMotivo } from "../dominio/motivo";

/**
 * Los errores con nombre de los comandos de ventas (E4 §3.4 y §3.8). Cada comando devuelve un subconjunto; el contrato público de cada uno
 * es el que documenta su caso de uso. Los de la base (restricciones) se traducen con `ERRORES_DE_VENTAS_POR_RESTRICCION`.
 */
export type ErrorDeVentas =
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDeAlcance
  | ErrorDePersistencia
  | ErrorDeCotizacion
  | ErrorDeJornadaNoAbierta
  | ErrorDeCierre
  | ErrorDeAnularTicket
  | ErrorDeConfirmacion
  | ErrorDeMotivo
  | ErrorAlCobrar
  | ErrorAlDecidirCobrar
  | ErrorDeCobros
  | ErrorDeCuadre
  | Readonly<{
      error: "PRECIO_CAMBIO";
      /** Lo que da la cuenta de ahora: la pantalla muestra el total nuevo y pide confirmar de nuevo. */
      totalActual: ImporteJson;
      lineas: readonly Readonly<{ precioUnitario: ImporteJson; importe: ImporteJson }>[];
    }>
  | "ENTRADA_INVALIDA"
  | "SESION_DE_CAJA_CAMBIO"
  | "CAJA_NO_ENCONTRADA_PARA_COBRAR"
  | Readonly<{ error: "TICKET_YA_COBRADO"; cobranzaId: string }>
  | "IDENTIFICADOR_INVALIDO"
  | "CLAVE_INVALIDA"
  | "CLAVE_REUTILIZADA"
  | "SUCURSAL_NO_ENCONTRADA"
  | "SUCURSAL_INACTIVA"
  | "ANCLA_INVALIDA"
  | "ANCLA_OCUPADA"
  | "ETIQUETA_INVALIDA"
  | "CUENTA_ID_EN_USO"
  | "CUENTA_NO_ENCONTRADA"
  | "CUENTA_NO_ABIERTA"
  | "CUENTA_CERRADA"
  | "LINEA_ID_EN_USO"
  | "LINEA_NO_ENCONTRADA"
  | "EJEMPLAR_ID_EN_USO"
  | "PRODUCTO_SIN_PRECIO"
  | "PRECIO_ABIERTO_NO_PERMITIDO"
  | "IMPORTE_INVALIDO"
  | "CANTIDAD_INVALIDA"
  | "TICKET_NO_ENCONTRADO"
  | "INVARIANTE_DE_VENTAS"
  | "ERROR_DE_LA_BASE_NO_TRADUCIDO"
  | Readonly<{ error: "CONFIRMACION_REQUERIDA"; clave: "VENTA_A_CERO" }>;
