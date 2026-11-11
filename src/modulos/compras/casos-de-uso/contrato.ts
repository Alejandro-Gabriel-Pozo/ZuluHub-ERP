import type { ContextoOperativo } from "../../../contexto/contexto";
import type { CondicionDeIvaDeLaEmpresa } from "../dominio/comprobante";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RepositorioDePresentaciones } from "../../catalogo/publico";
import type { RepositoriosDeClientes } from "../../clientes/publico";
import type { PuertosDeStock, TxDeStock } from "../../stock/publico";
import type { RepositoriosDeCompras } from "../persistencia/repositorios-de-compras";

/**
 * Lo que recibe el trabajo de una transacción de compras (ADR-004): los repositorios de compras, el directorio de partes (los proveedores son partes) y todo lo de
 * stock (sucursal, auditoría, autorización, estado de la empresa y los repositorios con que stock registra la entrada: la compra y su entrada de stock son UNA
 * transacción). La composición lo arma sobre la conexión de la transacción.
 */
export type TxDeCompras = TxDeStock &
  RepositoriosDeCompras &
  RepositoriosDeClientes &
  /** Las presentaciones son del catálogo (X5): compras las lee por su repositorio, nunca por SQL a la tabla. */
  Readonly<{ presentacionesDeProducto: RepositorioDePresentaciones }>;

/** Los motivos por los que caja no deja sacar o devolver el efectivo de un pago (los que caja distingue, traducidos a los códigos de compras). */
export type CodigoDeEgresoDeCaja =
  | "CAJA_NO_ENCONTRADA"
  | "CAJA_INACTIVA"
  | "CAJA_DE_OTRA_SUCURSAL"
  | "SIN_SESION_ABIERTA"
  | "CAJA_EN_CIERRE"
  | "JORNADA_DE_CAJA_NO_ABIERTA"
  | "EGRESO_DE_CAJA_RECHAZADO"
  | "EGRESO_DE_CAJA_NO_ANULABLE"
  | "CLAVE_REUTILIZADA"
  | "SIN_PERMISO";

/**
 * El puerto de egreso de efectivo que declara compras y IMPLEMENTA la composición con caja (E9 T10b, D-E9-7: compras no importa caja). Corre en la transacción del
 * pago y NO autoriza (el permiso es el de la acción de compras que paga o anula el pago). `registrar` saca el importe de la caja abierta indicada; `anular` devuelve
 * lo sacado con un registro nuevo (`anulacionId: null` si el pago no había salido de la caja). Sin sesión abierta falla cerrado con su código: se puede pagar por otro medio.
 */
export type EgresoDeCaja = Readonly<{
  registrar(
    tx: TxDeCompras,
    contexto: ContextoOperativo,
    entrada: Readonly<{
      cajaId: string;
      sucursalId: string;
      pagoId: string;
      /** Texto decimal en pesos (`"2420.00"`). */
      importe: string;
      motivo: string;
    }>,
  ): Promise<
    Resultado<Readonly<{ movimientoId: string; yaExistia: boolean }>, CodigoDeEgresoDeCaja>
  >;
  anular(
    tx: TxDeCompras,
    contexto: ContextoOperativo,
    entrada: Readonly<{ pagoId: string; motivo: string }>,
  ): Promise<Resultado<Readonly<{ anulacionId: string | null }>, CodigoDeEgresoDeCaja>>;
}>;

/**
 * La condición de la EMPRESA frente al IVA, que declara compras y IMPLEMENTA la composición con fiscal (compras no importa fiscal): de ella depende si el IVA
 * discriminado de una Factura A es crédito fiscal o costo (DEC-0322). `null` si no se puede leer (la empresa no tiene datos fiscales confirmados): con IVA
 * discriminado la compra no se registra (cierra, no supone).
 */
export type IvaDeLaEmpresa = Readonly<{
  condicion(
    tx: TxDeCompras,
    contexto: ContextoOperativo,
  ): Promise<CondicionDeIvaDeLaEmpresa | null>;
}>;

export type DependenciasDeCompras = Readonly<{
  transacciones: Transacciones<TxDeCompras>;
  /** El catálogo de módulos y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
  /** Los puertos de stock que usa «Comprar y recibir»: qué productos se controlan, la entrada por origen y la existencia (la composición los arma). */
  stock: Pick<
    PuertosDeStock,
    "articulosDeVenta" | "entradaPorOrigen" | "existenciaParaMostrar" | "ajusteDeCostoPorOrigen"
  >;
  /** El egreso de efectivo de caja para el pago en efectivo (la composición lo implementa con caja). */
  egresoDeCaja: EgresoDeCaja;
  /** La condición de la empresa frente al IVA (la composición la lee de los datos fiscales). */
  ivaDeLaEmpresa: IvaDeLaEmpresa;
}>;

/** Lo que reciben las consultas: transacciones de solo lectura con la autorización y los repositorios (que solo leen). */
export type TxDeConsultasDeCompras = Pick<TxDeStock, "autorizacion"> &
  RepositoriosDeCompras &
  RepositoriosDeClientes &
  Readonly<{ presentacionesDeProducto: RepositorioDePresentaciones }>;

export type DependenciasDeConsultasDeCompras = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeCompras>;
  reglas: ReglasDeEmpresa;
}>;
