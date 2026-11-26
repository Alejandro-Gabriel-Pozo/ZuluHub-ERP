import type { ContextoOperativo } from "../../../contexto/contexto";
import type { CondicionDeIvaDeLaEmpresa } from "../dominio/comprobante";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RepositorioDePresentaciones, RepositorioDeProductos } from "../../catalogo/publico";
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

export type CodigoDelLibroDeProveedores =
  | "LIBRO_DE_SALDOS_RECHAZADO"
  | "ASIENTO_DE_LA_FACTURA_NO_ENCONTRADO"
  | "ASIENTO_DEL_PAGO_NO_ENCONTRADO"
  | "ASIENTO_DE_LA_NOTA_NO_ENCONTRADO"
  | "CLAVE_REUTILIZADA"
  | "SIN_PERMISO";

/**
 * El puerto del libro de saldos que declara compras y IMPLEMENTA la composición con `saldos_de_partes` (L1: compras no importa el libro). Corre en la transacción de la factura y NO autoriza
 * (el permiso es el de la acción de compras). `registrarCargo` deja el asiento de la factura (el proveedor es la parte; `total` y los importes del reparto son texto decimal en pesos y el reparto suma el
 * total); repetido con el mismo comprobante devuelve el asiento hecho. `anularCargo` lo espeja: sin asiento falla cerrado (`ASIENTO_DE_LA_FACTURA_NO_ENCONTRADO`).
 */
export type LibroDeProveedores = Readonly<{
  registrarCargo(
    tx: TxDeCompras,
    contexto: ContextoOperativo,
    entrada: Readonly<{
      comprobanteId: string;
      proveedorId: string;
      total: string;
      venceEl: string | null;
      reparto: readonly Readonly<{ sucursalId: string | null; importe: string }>[];
      hechoEn: Date;
    }>,
  ): Promise<
    Resultado<Readonly<{ asientoId: string; yaExistia: boolean }>, CodigoDelLibroDeProveedores>
  >;
  anularCargo(
    tx: TxDeCompras,
    contexto: ContextoOperativo,
    entrada: Readonly<{ comprobanteId: string }>,
  ): Promise<
    Resultado<Readonly<{ asientoId: string; yaExistia: boolean }>, CodigoDelLibroDeProveedores>
  >;
  /**
   * El pago de la factura (L2): un asiento de pago por `importe` (texto decimal en pesos: el que se guardó en el pago, nunca recalculado) con la parte y la distribución por centro de costo del cargo de la factura,
   * imputado contra ese cargo. Sin cargo (una factura anterior al libro) o con un importe que no es el del cargo, falla cerrado. Repetido con el mismo pago devuelve lo hecho.
   */
  registrarPago(
    tx: TxDeCompras,
    contexto: ContextoOperativo,
    entrada: Readonly<{ pagoId: string; comprobanteId: string; importe: string; hechoEn: Date }>,
  ): Promise<
    Resultado<Readonly<{ asientoId: string; yaExistia: boolean }>, CodigoDelLibroDeProveedores>
  >;
  /**
   * La nota de crédito (L3a): un asiento de nota (resta) por `importe` a nombre del proveedor de la factura, repartido por centro de costo contra lo PENDIENTE del cargo, imputado contra el cargo hasta lo que quede
   * pendiente (lo que sobre queda como saldo a favor de la empresa). Sin cargo (factura anterior al libro) falla cerrado. Repetido con la misma nota devuelve lo hecho.
   */
  registrarNotaDeCredito(
    tx: TxDeCompras,
    contexto: ContextoOperativo,
    entrada: Readonly<{ notaId: string; facturaId: string; importe: string; hechoEn: Date }>,
  ): Promise<
    Resultado<Readonly<{ asientoId: string; yaExistia: boolean }>, CodigoDelLibroDeProveedores>
  >;
  /** El espejo de la nota de crédito (deshace su imputación): sin asiento (una nota anterior al libro) falla cerrado (`ASIENTO_DE_LA_NOTA_NO_ENCONTRADO`). */
  anularNotaDeCredito(
    tx: TxDeCompras,
    contexto: ContextoOperativo,
    entrada: Readonly<{ notaId: string }>,
  ): Promise<
    Resultado<Readonly<{ asientoId: string; yaExistia: boolean }>, CodigoDelLibroDeProveedores>
  >;
  /**
   * La nota de débito (L3a, la usa NOTAS-1): un cargo SUELTO del proveedor (suma, sin imputar: se paga aparte), con la distribución por sucursal de la factura vinculada si hay y tiene cargo, o «sin centro de costo».
   * Repetido con la misma nota devuelve lo hecho.
   */
  registrarNotaDeDebito(
    tx: TxDeCompras,
    contexto: ContextoOperativo,
    entrada: Readonly<{
      notaId: string;
      proveedorId: string;
      facturaId: string | null;
      importe: string;
      hechoEn: Date;
    }>,
  ): Promise<
    Resultado<Readonly<{ asientoId: string; yaExistia: boolean }>, CodigoDelLibroDeProveedores>
  >;
  anularNotaDeDebito(
    tx: TxDeCompras,
    contexto: ContextoOperativo,
    entrada: Readonly<{ notaId: string }>,
  ): Promise<
    Resultado<Readonly<{ asientoId: string; yaExistia: boolean }>, CodigoDelLibroDeProveedores>
  >;
  /** El espejo del asiento del pago (deshace su imputación): sin asiento (un pago anterior al libro) falla cerrado (`ASIENTO_DEL_PAGO_NO_ENCONTRADO`). */
  anularPago(
    tx: TxDeCompras,
    contexto: ContextoOperativo,
    entrada: Readonly<{ pagoId: string }>,
  ): Promise<
    Resultado<Readonly<{ asientoId: string; yaExistia: boolean }>, CodigoDelLibroDeProveedores>
  >;
}>;

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
    | "articulosDeVenta"
    | "entradaPorOrigen"
    | "salidaPorOrigen"
    | "correccionDeRecepcion"
    | "existenciaParaMostrar"
    | "ajusteDeCostoPorOrigen"
  >;
  /** El egreso de efectivo de caja para el pago en efectivo (la composición lo implementa con caja). */
  egresoDeCaja: EgresoDeCaja;
  libroDeProveedores: LibroDeProveedores;
  /** La condición de la empresa frente al IVA (la composición la lee de los datos fiscales). */
  ivaDeLaEmpresa: IvaDeLaEmpresa;
}>;

/** Lo que reciben las consultas: transacciones de solo lectura con la autorización y los repositorios (que solo leen). */
export type TxDeConsultasDeCompras = Pick<TxDeStock, "autorizacion"> &
  RepositoriosDeCompras &
  RepositoriosDeClientes &
  Readonly<{
    presentacionesDeProducto: RepositorioDePresentaciones;
    /** Solo la lista del catálogo: «productos para comprar» busca con la MISMA regla de nombre que el catálogo (una regla, un lugar). */
    productos: Pick<RepositorioDeProductos, "listar">;
  }>;

export type DependenciasDeConsultasDeCompras = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeCompras>;
  reglas: ReglasDeEmpresa;
}>;
