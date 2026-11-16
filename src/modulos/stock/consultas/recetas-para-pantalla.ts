import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { textoDeBusquedaDeProductoDesdeTexto } from "../../../primitivas/texto/termino-de-busqueda-de-producto";
import type { TxDeConsultasDeStock } from "../casos-de-uso/contrato";
import {
  costoPorUnidadDeLaVersion,
  fichaDeLaVersion,
  type FichaDeReceta,
} from "../casos-de-uso/lectura-de-recetas";
import {
  vistaPreviaDeLaVersion,
  type VistaPreviaDeReceta,
} from "../casos-de-uso/vista-previa-de-receta";
import { esUuid } from "../persistencia/filas";
import type { ClaveDePagina } from "../persistencia/lecturas-de-recetas";
import type { ComposicionGuardada } from "../persistencia/modelo";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type { VistaPreviaDeReceta } from "../casos-de-uso/vista-previa-de-receta";

type Tx = TxDeConsultasDeStock;

/** Cuántas filas trae una página de la lista de recetas o de ingredientes (la misma medida que la lista de productos del catálogo). */
const TAMANO_DE_PAGINA = 50;

export type RecetaDeLista = Readonly<{
  productoId: string;
  nombre: string;
  claseDeUso: "VENDIBLE" | "ELABORADO";
  activo: boolean;
  /** El número de la versión vigente, o `null` si no tiene receta (nunca tuvo, o la última versión la retiró). */
  version: number | null;
  /** SOLO con `costos.ver`: lo que cuesta cada unidad que rinde la receta (texto decimal, 6 decimales) o `null` si no tiene receta o le falta algún costo (nunca cero). */
  costoPorUnidad?: string | null | undefined;
  /** SOLO con `costos.ver`: la moneda de `costoPorUnidad`. */
  moneda?: "ARS" | undefined;
}>;

export type PaginaDeRecetas = Readonly<{
  recetas: readonly RecetaDeLista[];
  /** Pasar como `despuesDe` para pedir la página siguiente; `null` si no hay más. */
  siguiente: ClaveDePagina | null;
}>;

export type EntradaDeListarRecetas = Readonly<{
  /** Prefijo del nombre. Vacío o blancos: sin filtro. Un texto que no es de la lista de permitidos de la búsqueda de productos: página vacía. */
  texto?: string | undefined;
  /** `true`: solo con receta; `false`: solo sin receta (una receta retirada cuenta como «sin receta»). Ausente: todos. */
  conReceta?: boolean | undefined;
  /** `true` o `false`: solo activos o solo desactivados. Ausente: todos. */
  activo?: boolean | undefined;
  despuesDe?: ClaveDePagina | undefined;
}>;

export type IngredienteParaReceta = Readonly<{
  productoId: string;
  nombre: string;
  claseDeUso: "MATERIA_PRIMA" | "REVENTA" | "ELABORADO";
  /** La unidad en que se carga el bruto: la de stock del artículo o la base del elaborado. */
  unidadId: string;
}>;

export type PaginaDeIngredientes = Readonly<{
  ingredientes: readonly IngredienteParaReceta[];
  siguiente: ClaveDePagina | null;
}>;

export type EntradaDeIngredientes = Readonly<{
  texto?: string | undefined;
  despuesDe?: ClaveDePagina | undefined;
}>;

export type RecetaDeProducto = Readonly<{
  producto: Readonly<{
    id: string;
    nombre: string;
    claseDeUso: "VENDIBLE" | "ELABORADO";
    activo: boolean;
  }>;
  /** El número de la ÚLTIMA versión que existe, también si es la que retiró la receta; 0 si nunca tuvo. Es la `versionEsperada` de guardar (hallazgo H6). */
  ultimaVersion: number;
  /** La versión pedida (la vigente si no se dice) con sus ingredientes; `null` si el producto no tiene receta, la versión pedida no existe o es la que la retiró. */
  ficha: FichaDeReceta | null;
}>;

const VACIA = { siguiente: null } as const;

/** ¿La persona ve costos? Lo decide el rol de la misma transacción, no la pantalla (E5-T10, P-1). */
export const veLosCostos =
  (reglas: ReglasDeEmpresa) => async (tx: Tx, contexto: ContextoOperativo) =>
    (await exigirAccion(reglas, "costos.ver", () => tx.autorizacion.delActor(contexto))).ok;

/** Una versión por número de ese producto; el número tiene que ser un entero positivo (si no, no existe). */
export async function versionPedida(
  tx: Tx,
  contexto: ContextoOperativo,
  productoId: string,
  numero: unknown,
): Promise<ComposicionGuardada | null> {
  if (typeof numero !== "number" || !Number.isSafeInteger(numero) || numero < 1) return null;
  return tx.composicionesDeStock.porNumero(contexto.empresaId, productoId, numero);
}

/** El texto de búsqueda de una entrada: `null` si nada puede coincidir, `undefined` si no hay filtro. Lista de permitidos: la de la búsqueda de productos. */
function leerTexto(valor: unknown): string | undefined | null {
  if (valor === undefined) return undefined;
  if (typeof valor !== "string") return null;
  const leido = textoDeBusquedaDeProductoDesdeTexto(valor);
  return leido.ok ? (leido.valor ?? undefined) : null;
}

/** La página que dice la clave de una consulta anterior: un id con su forma y la clave del nombre tal como la daría la lista (misma lista de permitidos). */
function leerPagina(valor: unknown): ClaveDePagina | undefined | null {
  if (valor === undefined) return undefined;
  if (typeof valor !== "object" || valor === null) return null;
  const { nombreClave, id } = valor as { nombreClave?: unknown; id?: unknown };
  if (typeof id !== "string" || !esUuid(id) || typeof nombreClave !== "string") return null;
  const leida = textoDeBusquedaDeProductoDesdeTexto(nombreClave);
  return leida.ok && leida.valor === nombreClave ? { nombreClave, id } : null;
}

const esBooleanoOAusente = (valor: unknown): valor is boolean | undefined =>
  valor === undefined || typeof valor === "boolean";

/**
 * Las consultas de la pantalla de Recetas (B1 a B4 de `recetas-pantalla.md` §8): la lista de recetas, una receta con su última versión, los ingredientes que se ofrecen y
 * la vista previa de lo que se está armando. Mirar es de quien puede mirar stock (`stock.ver`; la receta es de la empresa, no de una sucursal) y los COSTOS viajan solo con
 * `costos.ver`, con el rol de la misma transacción. Todas LEEN: ninguna escribe ni audita. Una empresa ajena, un id mal formado o una entrada fuera de la lista de permitidos
 * dan lo mismo que lo que no existe (página vacía o `null`), nunca un error que distinga.
 */
export function armarConsultasDeRecetasParaPantalla(leer: Lector, reglas: ReglasDeEmpresa) {
  const veCostos = veLosCostos(reglas);

  return {
    /** Los productos que llevan receta (`VENDIBLE` o `ELABORADO`), con o sin ella, de a 50 por nombre; con `costos.ver`, el costo de una unidad. */
    listarRecetas: (
      contexto: ContextoOperativo,
      entrada: EntradaDeListarRecetas = {},
    ): Promise<RDeConsulta<PaginaDeRecetas>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.listarRecetas.accion, async (tx, alcance) => {
        const texto = leerTexto(entrada.texto);
        const despuesDe = leerPagina(entrada.despuesDe);
        if (
          texto === null ||
          despuesDe === null ||
          !esBooleanoOAusente(entrada.conReceta) ||
          !esBooleanoOAusente(entrada.activo)
        ) {
          return { recetas: [], ...VACIA };
        }
        const filas = await tx.listasDeRecetas.productosConReceta(contexto.empresaId, {
          texto,
          conReceta: entrada.conReceta,
          activo: entrada.activo,
          despuesDe,
          limite: TAMANO_DE_PAGINA + 1,
        });
        const pagina = filas.slice(0, TAMANO_DE_PAGINA);
        const conCostos = await veCostos(tx, contexto);
        const versiones = conCostos
          ? await tx.composicionesDeStock.ultimasVersiones(
              contexto.empresaId,
              pagina.flatMap((f) => (f.version === null ? [] : [f.productoId])),
            )
          : new Map<string, ComposicionGuardada>();
        const memo = new Map<string, bigint | null>();
        const recetas: RecetaDeLista[] = [];
        for (const f of pagina) {
          const base = {
            productoId: f.productoId,
            nombre: f.nombre,
            claseDeUso: f.claseDeUso,
            activo: f.activo,
            version: f.version,
          };
          const version = f.version === null ? undefined : versiones.get(f.productoId);
          recetas.push(
            conCostos
              ? {
                  ...base,
                  moneda: "ARS",
                  costoPorUnidad:
                    version === undefined
                      ? null
                      : await costoPorUnidadDeLaVersion(tx, contexto, alcance, version, memo),
                }
              : base,
          );
        }
        const ultima = pagina[pagina.length - 1];
        return {
          recetas,
          siguiente:
            filas.length > TAMANO_DE_PAGINA && ultima !== undefined
              ? { nombreClave: ultima.nombreClave, id: ultima.productoId }
              : null,
        };
      }),

    /**
     * El producto, la última versión que existe y la ficha de la versión pedida (la vigente si no se dice). `null` si el producto no existe, es de otra empresa o su clase no lleva
     * receta. Siempre trae `ultimaVersion` (H6: tras retirar la receta la versión esperada ya no es 0). Una receta retirada cuenta como «sin receta» (`ficha: null`).
     */
    recetaDeProducto: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoId: string; version?: number | undefined }>,
    ): Promise<RDeConsulta<RecetaDeProducto | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.recetaDeProducto.accion, async (tx, alcance) => {
        if (typeof entrada.productoId !== "string" || !esUuid(entrada.productoId)) return null;
        const producto = await tx.productosParaStock.obtener(
          contexto.empresaId,
          entrada.productoId,
        );
        if (producto === null) return null;
        if (producto.claseDeUso !== "VENDIBLE" && producto.claseDeUso !== "ELABORADO") return null;
        const datos = {
          id: producto.id,
          nombre: producto.nombre,
          claseDeUso: producto.claseDeUso,
          activo: producto.activo,
        };
        const ultima = await tx.composicionesDeStock.ultimaVersion(contexto.empresaId, producto.id);
        if (ultima === null) return { producto: datos, ultimaVersion: 0, ficha: null };
        const version =
          entrada.version === undefined
            ? ultima
            : await versionPedida(tx, contexto, producto.id, entrada.version);
        const ficha =
          version === null || version.componentes.length === 0
            ? null
            : await fichaDeLaVersion(
                tx,
                contexto,
                alcance,
                version,
                ultima,
                await veCostos(tx, contexto),
              );
        return { producto: datos, ultimaVersion: ultima.numero, ficha };
      }),

    /** Lo que se ofrece como ingrediente: artículos activos de materia prima o reventa y elaborados activos; nunca insumos. De a 50 por nombre. */
    ingredientesParaReceta: (
      contexto: ContextoOperativo,
      entrada: EntradaDeIngredientes = {},
    ): Promise<RDeConsulta<PaginaDeIngredientes>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.ingredientesParaReceta.accion, async (tx) => {
        const texto = leerTexto(entrada.texto);
        const despuesDe = leerPagina(entrada.despuesDe);
        if (texto === null || despuesDe === null) return { ingredientes: [], ...VACIA };
        const filas = await tx.listasDeRecetas.ingredientesElegibles(contexto.empresaId, {
          texto,
          despuesDe,
          limite: TAMANO_DE_PAGINA + 1,
        });
        const pagina = filas.slice(0, TAMANO_DE_PAGINA);
        const ultima = pagina[pagina.length - 1];
        return {
          ingredientes: pagina.map((f) => ({
            productoId: f.productoId,
            nombre: f.nombre,
            claseDeUso: f.claseDeUso,
            unidadId: f.unidadId,
          })),
          siguiente:
            filas.length > TAMANO_DE_PAGINA && ultima !== undefined
              ? { nombreClave: ultima.nombreClave, id: ultima.productoId }
              : null,
        };
      }),

    /** El neto de cada línea y, con `costos.ver`, el costo de lo que se está armando, sin guardarlo. `null` si lo pedido no se puede calcular. */
    vistaPreviaDeReceta: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoId: string; rinde: string; componentes: readonly unknown[] }>,
    ): Promise<RDeConsulta<VistaPreviaDeReceta | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.vistaPreviaDeReceta.accion, async (tx, alcance) =>
        vistaPreviaDeLaVersion(tx, contexto, alcance, entrada, await veCostos(tx, contexto)),
      ),
  };
}
