import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { EstadoDeTenant } from "../../../contexto/estados";
import type { TenantId } from "../../../primitivas/identificadores/marca";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RepositorioDeEmpresas, RepositorioDeSucursales } from "../../empresas/publico";
import type { FormaDeVenta } from "../dominio/forma-de-venta";
import type { RepositorioDePresentaciones } from "../persistencia/repositorio-de-presentaciones";
import type { RepositorioDeOpciones } from "../persistencia/repositorio-de-opciones";
import type { RepositorioDePrecios } from "../persistencia/repositorio-de-precios";
import type { RepositorioDeProductos } from "../persistencia/repositorio-de-productos";

/** Lo que necesita un caso de uso para saber si la empresa opera: su estado y el de su tenant (el tenant se tipa por su forma). */
export type LecturaDeEstados = Readonly<{
  empresas: Pick<RepositorioDeEmpresas, "obtener">;
  tenants: Readonly<{
    obtener(id: TenantId): Promise<Readonly<{ estado: EstadoDeTenant }> | null>;
  }>;
}>;

/** Lo que lee `cotizarParaVender` y las consultas: solo lecturas de los repositorios. */
export type LecturasDeCatalogo = Readonly<{
  productos: Pick<
    RepositorioDeProductos,
    "obtener" | "listar" | "conOpciones" | "insumosElegibles" | "listarSecciones" | "obtenerSeccion"
  >;
  opciones: Pick<RepositorioDeOpciones, "gruposDelProducto" | "consumoDeVersiones">;
  precios: Pick<RepositorioDePrecios, "vigente" | "historial" | "ultimasPorAlcance">;
  sucursales: Pick<RepositorioDeSucursales, "obtener">;
}>;

/** Lo que recibe el trabajo de una transacción del catálogo (ADR-004): los repositorios, la sucursal, la auditoría y la autorización. */
export type TxDeCatalogo = LecturaDeEstados &
  Readonly<{
    productos: RepositorioDeProductos;
    opciones: RepositorioDeOpciones;
    precios: RepositorioDePrecios;
    presentacionesDeProducto: RepositorioDePresentaciones;
    sucursales: Pick<RepositorioDeSucursales, "obtener">;
    auditoria: Auditoria;
    /** Quién es el actor, qué módulos tiene la empresa y en qué sucursales opera, leído dentro de la transacción (sin caché). */
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeCatalogo = Readonly<{
  transacciones: Transacciones<TxDeCatalogo>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
  /**
   * Qué formas de venta se pueden cargar. Por defecto, las del PILOTO: unidad de venta = unidad base y paso 1 (decisión 162). Fracciones y
   * peso se habilitan pasando otra función (un cambio de configuración en código, sin migración).
   */
  formaDeVentaHabilitada?: (unidadBaseId: string, forma: FormaDeVenta) => boolean;
}>;

/** Lo que reciben las consultas: transacciones de solo lectura con sus repositorios de lectura. */
export type TxDeConsultasDeCatalogo = Readonly<{
  autorizacion: CargaDeAutorizacion;
}> &
  LecturasDeCatalogo;

export type DependenciasDeConsultasDeCatalogo = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeCatalogo>;
  reglas: ReglasDeEmpresa;
}>;

/**
 * Los tipos planos del modelo que devuelven las consultas. Las consultas por pantalla no importan el dominio (ADR-005): leen y devuelven
 * objetos planos, y estos tipos son su forma. Solo tipos; ninguna regla.
 */
export type { ClaseDeUso } from "../dominio/clases";
export type { GrupoConOpciones } from "../dominio/cotizar";
export type { FilaDePrecio, LineaDeConsumo, Producto } from "../dominio/modelo";
