import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { ClaseDeUso } from "./clases";
import type {
  GrupoDeEleccionesId,
  OpcionId,
  PrecioDeVentaId,
  ProductoId,
  SeccionDeCartaId,
  VersionDeOpcionId,
} from "./identificadores";

/**
 * Lo que el catálogo lee de la base, ya traducido. Los decimales (precio, recargo, paso, factor) viajan como TEXTO exacto, nunca como
 * `number` (ADR-006). `version` es el control de versión optimista de la fila; `versionDeOpciones` el del conjunto de opciones.
 */
export type Producto = Readonly<{
  id: ProductoId;
  empresaId: EmpresaId;
  nombre: string;
  nombreDeCocina: string | null;
  descripcionEnCarta: string | null;
  codigo: string | null;
  codigoDeBarras: string | null;
  claseDeUso: ClaseDeUso;
  unidadBaseId: string;
  unidadDeVentaId: string;
  pasoMinimo: string;
  /** Las fracciones que se ofrecen (2, 4, 8), ascendentes; vacío = no se vende por fracciones. El paso mínimo se deriva de ellas (0051). */
  porcionesOfrecidas: readonly number[];
  alicuota: string | null;
  faltaCompletar: boolean;
  seVende: boolean;
  seccionDeCartaId: SeccionDeCartaId | null;
  activo: boolean;
  versionDeOpciones: number;
  version: number;
}>;

export type ClaseDeGrupo = "VARIANTE" | "INCLUIDA" | "ADICIONAL";

export type Grupo = Readonly<{
  id: GrupoDeEleccionesId;
  productoId: ProductoId;
  clase: ClaseDeGrupo;
  esTamano: boolean;
  nombre: string;
  esObligatorio: boolean;
  admiteVarias: boolean;
  seMuestraEnCarta: boolean;
  orden: number;
  activo: boolean;
}>;

/** Una opción con su versión vigente (la de mayor número). */
export type Opcion = Readonly<{
  id: OpcionId;
  grupoId: GrupoDeEleccionesId;
  orden: number;
  activa: boolean;
  versionId: VersionDeOpcionId;
  numero: number;
  nombre: string;
  recargo: string;
  factorDeTamano: string;
}>;

export type LineaDeConsumo = Readonly<{
  insumoId: ProductoId;
  cantidad: string;
  escalaConTamano: boolean;
}>;

/** Una fila de `precio_de_venta`. `precio` nulo: con sucursal «vuelve al de la empresa», sin sucursal «precio abierto» (K6). */
export type FilaDePrecio = Readonly<{
  id: PrecioDeVentaId;
  productoId: ProductoId;
  opcionId: OpcionId | null;
  sucursalId: SucursalId | null;
  precio: string | null;
  unidadId: string;
  pasoMinimo: string;
  vigenteDesde: Date;
}>;
