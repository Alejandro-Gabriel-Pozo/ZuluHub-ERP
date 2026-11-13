import { crearConsultasDeCarta } from "./consultas-de-carta";
import { crearConsultasDeClasificacion } from "./consultas-de-clasificacion";
import { crearConsultasDeClasificacionDeProducto } from "./consultas-de-clasificacion-de-producto";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type {
  ClaseDeUso,
  DependenciasDeConsultasDeCatalogo,
  FilaDePrecio,
  GrupoConOpciones,
  LineaDeConsumo,
  Producto,
  TxDeConsultasDeCatalogo,
} from "../casos-de-uso/contrato";
import type { SeccionDeCarta } from "../persistencia/repositorio-de-productos";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

type R<S> = Resultado<S, MotivoDeRechazo | ErrorDePersistencia>;

const TAMANO_DE_PAGINA = 50;
const MAXIMO_DE_INSUMOS = 100;

export type EstadoDeProducto = "ACTIVO" | "FALTA_COMPLETAR" | "DESACTIVADO";
/** Lo que muestra la lista como precio: el de la empresa, «Según tamaño» (con variante) o «Sin precio» (precio abierto). `null`: no se vende. */
export type PrecioDeLista =
  | Readonly<{ tipo: "EMPRESA"; precio: string }>
  | Readonly<{ tipo: "SEGUN_TAMANO" }>
  | Readonly<{ tipo: "SIN_PRECIO" }>
  | null;

export type ProductoDeLista = Readonly<{
  id: string;
  nombre: string;
  claseDeUso: ClaseDeUso;
  estado: EstadoDeProducto;
  unidadDeVentaId: string;
  precio: PrecioDeLista;
}>;

export type PaginaDeProductos = Readonly<{
  productos: readonly ProductoDeLista[];
  /** Pasar como `despuesDe` para pedir la página siguiente; `null` si no hay más. */
  siguiente: Readonly<{ nombreClave: string; id: string }> | null;
}>;

export type EntradaDeListarProductos = Readonly<{
  texto?: string | undefined;
  claseDeUso?: ClaseDeUso | undefined;
  faltaCompletar?: boolean | undefined;
  activo?: boolean | undefined;
  despuesDe?: Readonly<{ nombreClave: string; id: string }> | undefined;
}>;

export type OpcionDeFicha = Readonly<{
  id: string;
  versionDeOpcionId: string;
  nombre: string;
  recargo: string;
  factorDeTamano: string;
  orden: number;
  activa: boolean;
  consumo: readonly LineaDeConsumo[];
}>;

export type GrupoDeFicha = Readonly<{
  id: string;
  clase: "VARIANTE" | "INCLUIDA" | "ADICIONAL";
  esTamano: boolean;
  nombre: string;
  esObligatorio: boolean;
  admiteVarias: boolean;
  seMuestraEnCarta: boolean;
  orden: number;
  activo: boolean;
  opciones: readonly OpcionDeFicha[];
}>;

export type FilaDeHistorial = Readonly<{
  precioId: string;
  opcionId: string | null;
  sucursalId: string | null;
  precio: string | null;
  unidadId: string;
  pasoMinimo: string;
  desde: Date;
  cargadoPor: string | null;
}>;

export type FichaDeProducto = Readonly<{
  producto: Producto;
  grupos: readonly GrupoDeFicha[];
  /** Lo que rige hoy en cada alcance (empresa y cada sucursal, de cada tamaño o del producto). */
  preciosVigentes: readonly FilaDePrecio[];
  historial: readonly FilaDeHistorial[];
}>;

export type PreciosDelProducto = Readonly<{
  /** Lo que rige hoy en el alcance pedido, con su origen: `SUCURSAL` (precio propio), `EMPRESA` o `ABIERTO`. */
  efectivos: ReadonlyArray<{
    opcionId: string | null;
    origen: "SUCURSAL" | "EMPRESA" | "ABIERTO";
    precioId: string | null;
    precio: string | null;
  }>;
  historial: readonly FilaDeHistorial[];
}>;

const aHistorial = (
  f: FilaDePrecio & Readonly<{ cargadoPor: string | null }>,
): FilaDeHistorial => ({
  precioId: f.id,
  opcionId: f.opcionId,
  sucursalId: f.sucursalId,
  precio: f.precio,
  unidadId: f.unidadId,
  pasoMinimo: f.pasoMinimo,
  desde: f.vigenteDesde,
  cargadoPor: f.cargadoPor,
});

async function exigirVer(
  tx: TxDeConsultasDeCatalogo,
  contexto: ContextoOperativo,
  d: DependenciasDeConsultasDeCatalogo,
  accion: (typeof DECLARACIONES_DE_CONSULTAS)[keyof typeof DECLARACIONES_DE_CONSULTAS]["accion"],
): Promise<Resultado<null, MotivoDeRechazo>> {
  return exigirAccion(d.reglas, accion, () => tx.autorizacion.delActor(contexto));
}

/** El precio que muestra la lista para un producto de la empresa (sin sucursal: el de la empresa). */
async function precioDeLista(
  tx: TxDeConsultasDeCatalogo,
  contexto: ContextoOperativo,
  p: Producto,
  grupos: readonly GrupoConOpciones[],
): Promise<PrecioDeLista> {
  if (!p.seVende) return null;
  if (grupos.some(({ grupo }) => grupo.clase === "VARIANTE" && grupo.activo))
    return { tipo: "SEGUN_TAMANO" };
  const fila = await tx.precios.vigente(contexto.empresaId, p.id, null, null, contexto.ahora);
  return fila === null || fila.precio === null
    ? { tipo: "SIN_PRECIO" }
    : { tipo: "EMPRESA", precio: fila.precio };
}

/**
 * Las consultas por pantalla del catálogo (ADR-005): solo lectura (`read committed`), cada una pide `productos.ver` al guard dentro de
 * su transacción. Un producto, sección o sucursal de otra empresa es indistinguible de uno que no existe.
 */
export function crearConsultasDeCatalogo(d: DependenciasDeConsultasDeCatalogo) {
  const leer = <S>(
    contexto: ContextoOperativo,
    accion: Parameters<typeof exigirVer>[3],
    trabajo: (tx: TxDeConsultasDeCatalogo) => Promise<S>,
  ): Promise<R<S>> =>
    d.transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<R<S>> => {
        const permiso = await exigirVer(tx, contexto, d, accion);
        if (!permiso.ok) return permiso;
        return ok(await trabajo(tx));
      },
    );

  return {
    /** Página de 50 por `(nombre_clave, id)`: nombre, clase, estado, unidad y precio de la empresa (o «Según tamaño», «Sin precio»). */
    listarProductos: (
      contexto: ContextoOperativo,
      entrada: EntradaDeListarProductos = {},
    ): Promise<R<PaginaDeProductos>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.listarProductos.accion, async (tx) => {
        const filas = await tx.productos.listar(contexto.empresaId, {
          ...entrada,
          limite: TAMANO_DE_PAGINA + 1,
        });
        const pagina = filas.slice(0, TAMANO_DE_PAGINA);
        const productos: ProductoDeLista[] = [];
        for (const { producto: p } of pagina) {
          const grupos =
            p.seVende || p.claseDeUso === "VENDIBLE" || p.claseDeUso === "REVENTA"
              ? await tx.opciones.gruposDelProducto(contexto.empresaId, p.id)
              : [];
          productos.push({
            id: p.id,
            nombre: p.nombre,
            claseDeUso: p.claseDeUso,
            estado: !p.activo ? "DESACTIVADO" : p.faltaCompletar ? "FALTA_COMPLETAR" : "ACTIVO",
            unidadDeVentaId: p.unidadDeVentaId,
            precio: await precioDeLista(tx, contexto, p, grupos),
          });
        }
        const ultima = pagina[pagina.length - 1];
        return {
          productos,
          siguiente:
            filas.length > TAMANO_DE_PAGINA && ultima !== undefined
              ? { nombreClave: ultima.nombreClave, id: ultima.producto.id }
              : null,
        };
      }),

    /** La ficha: datos, versiones, grupos con opciones y consumo vigente, precios vigentes por alcance e historial. `null` si no existe. */
    verProducto: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoId: string }>,
    ): Promise<R<FichaDeProducto | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.verProducto.accion, async (tx) => {
        const producto = await tx.productos.obtener(contexto.empresaId, entrada.productoId);
        if (producto === null) return null;
        const grupos = await tx.opciones.gruposDelProducto(contexto.empresaId, producto.id);
        const consumo = await tx.opciones.consumoDeVersiones(
          contexto.empresaId,
          grupos.flatMap((g) => g.opciones.map((o) => o.versionId)),
        );
        return {
          producto,
          grupos: grupos.map(({ grupo, opciones }) => ({
            ...grupo,
            opciones: opciones.map((o) => ({
              id: o.id,
              versionDeOpcionId: o.versionId,
              nombre: o.nombre,
              recargo: o.recargo,
              factorDeTamano: o.factorDeTamano,
              orden: o.orden,
              activa: o.activa,
              consumo: consumo.get(o.versionId) ?? [],
            })),
          })),
          preciosVigentes: await tx.precios.ultimasPorAlcance(contexto.empresaId, producto.id),
          historial: (await tx.precios.historial(contexto.empresaId, producto.id)).map(aHistorial),
        };
      }),

    /** La pestaña Precios: por alcance (la empresa o una sucursal), el vigente efectivo con su origen y el historial. `null` si no existe. */
    preciosDelProducto: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoId: string; sucursalId?: string | undefined }>,
    ): Promise<R<PreciosDelProducto | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.preciosDelProducto.accion, async (tx) => {
        const producto = await tx.productos.obtener(contexto.empresaId, entrada.productoId);
        if (producto === null) return null;
        const grupos = await tx.opciones.gruposDelProducto(contexto.empresaId, producto.id);
        const variante = grupos.find((g) => g.grupo.clase === "VARIANTE" && g.grupo.activo);
        const duenos =
          variante === undefined
            ? [null]
            : variante.opciones.filter((o) => o.activa).map((o) => o.id);
        const sucursal = entrada.sucursalId ?? null;
        const efectivos: Array<PreciosDelProducto["efectivos"][number]> = [];
        for (const opcionId of duenos) {
          const fila = await tx.precios.vigente(
            contexto.empresaId,
            producto.id,
            opcionId,
            sucursal,
            contexto.ahora,
          );
          efectivos.push({
            opcionId,
            origen:
              fila === null || fila.precio === null
                ? "ABIERTO"
                : fila.sucursalId === null
                  ? "EMPRESA"
                  : "SUCURSAL",
            precioId: fila === null ? null : fila.id,
            precio: fila === null ? null : fila.precio,
          });
        }
        const historial = (await tx.precios.historial(contexto.empresaId, producto.id))
          .filter((f) => f.sucursalId === sucursal)
          .map(aHistorial);
        return { efectivos, historial };
      }),

    /** Insumos elegibles para «Qué consume»: materia prima, insumo y reventa activos (hasta 100). */
    productosParaConsumo: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ texto?: string | undefined }> = {},
    ): Promise<R<readonly Producto[]>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.productosParaConsumo.accion, (tx) =>
        tx.productos.insumosElegibles(contexto.empresaId, entrada.texto, MAXIMO_DE_INSUMOS),
      ),

    /** Productos activos con opciones, para «Copiar de otro producto» (distintos del destino). */
    productosParaCopiar: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoDestinoId: string }>,
    ): Promise<R<readonly Producto[]>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.productosParaCopiar.accion, async (tx) => {
        const destino = await tx.productos.obtener(contexto.empresaId, entrada.productoDestinoId);
        return destino === null ? [] : tx.productos.conOpciones(contexto.empresaId, destino.id);
      }),

    /** Las secciones activas de la carta, en orden. */
    listarSeccionesDeCarta: (contexto: ContextoOperativo): Promise<R<readonly SeccionDeCarta[]>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.listarSeccionesDeCarta.accion, (tx) =>
        tx.productos.listarSecciones(contexto.empresaId),
      ),
    ...crearConsultasDeCarta(d),
    ...crearConsultasDeClasificacion(d),
    ...crearConsultasDeClasificacionDeProducto(d),
  };
}

export type ConsultasDeCatalogo = ReturnType<typeof crearConsultasDeCatalogo>;
