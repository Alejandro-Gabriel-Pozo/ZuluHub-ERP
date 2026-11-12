import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { EstadoDeTenant } from "../../../contexto/estados";
import type { SucursalId, TenantId } from "../../../primitivas/identificadores/marca";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { LecturaDeDerechosDeUso } from "../../../puertos/derechos-de-uso";
import type { Transacciones } from "../../../puertos/transacciones";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { RepositorioDeEmpresas, RepositorioDeSucursales } from "../../empresas/publico";
import type { FormaDeVenta } from "../dominio/forma-de-venta";
import type { LectorDeCarta } from "../persistencia/lector-de-carta";
import type { RepositorioDeCartas } from "../persistencia/repositorio-de-cartas";
import type { RepositorioDeDisponibilidad } from "../persistencia/repositorio-de-disponibilidad";
import type { RepositorioDeSecciones } from "../persistencia/repositorio-de-secciones";
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
  seccionesDeCarta: Pick<RepositorioDeSecciones, "todas">;
  cartasPublicas: Pick<RepositorioDeCartas, "deLaSucursal">;
  disponibilidadDeProductos: Pick<RepositorioDeDisponibilidad, "ocultas" | "delLocal">;
  lectorDeCarta: LectorDeCarta;
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
    /** La carta pública, el botón «Ocultar» y las secciones (migración 0043 y T2 de la carta real). */
    cartasPublicas: RepositorioDeCartas;
    disponibilidadDeProductos: RepositorioDeDisponibilidad;
    seccionesDeCarta: RepositorioDeSecciones;
    lectorDeCarta: LectorDeCarta;
    sucursales: Pick<RepositorioDeSucursales, "obtener">;
    /** Lo que el plan de la empresa le deja usar (la perilla `vidriera_por_qr`), leído en esta transacción y sin caché. */
    derechos: Pick<LecturaDeDerechosDeUso, "deLaEmpresa">;
    auditoria: Auditoria;
    /** Quién es el actor, qué módulos tiene la empresa y en qué sucursales opera, leído dentro de la transacción (sin caché). */
    autorizacion: CargaDeAutorizacion;
  }>;

/** Dónde se mira la existencia o los conteos de un producto: en toda la empresa o en un local (sus depósitos). */
export type AlcanceDeExistencia =
  Readonly<{ tipo: "EMPRESA" }> | Readonly<{ tipo: "SUCURSAL"; sucursalId: SucursalId }>;

/**
 * Lo que el catálogo le pregunta a stock para ocultar o desactivar un producto (carta real §6.5, T-6). El catálogo NO puede importar stock (es stock quien lee el
 * catálogo): lo implementa la composición con la MISMA transacción (patrón `StockDeVentas`), y el catálogo solo ve este puerto. Un producto sin artículo de
 * stock no tiene existencia ni conteos: las dos respuestas son `false`. Una duda se responde `true` (falla cerrado: no se oculta ni se desactiva).
 */
export type ExistenciasDelProducto = Readonly<{
  /** ¿Tiene existencia DISTINTA DE CERO (también negativa) en ese alcance? */
  conExistencia(
    tx: object,
    contexto: ContextoOperativo,
    productoId: string,
    alcance: AlcanceDeExistencia,
  ): Promise<boolean>;
  /** ¿Hay un conteo abierto con cargas de ese producto en ese alcance? */
  conConteoAbiertoConCargas(
    tx: object,
    contexto: ContextoOperativo,
    productoId: string,
    alcance: AlcanceDeExistencia,
  ): Promise<boolean>;
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
  /** Existencia y conteos abiertos de un producto (lo implementa la composición con stock). */
  existencias: ExistenciasDelProducto;
  /**
   * El puerto de azar del código de la carta: devuelve un código nuevo de ≥ 128 bits al azar en base64url (22 caracteres). El dominio no tiene azar: lo pone
   * la composición (`node:crypto`) y las pruebas lo fijan.
   */
  generarCodigoDeCarta: () => string;
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
export type { EstadoDeCarta } from "../dominio/carta-publica";
export type { GrupoConOpciones } from "../dominio/cotizar";
export type { FilaDePrecio, LineaDeConsumo, Producto } from "../dominio/modelo";
