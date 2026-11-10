import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { LARGO_MAXIMO_DEL_NOMBRE_DE_PRODUCTO } from "../../../primitivas/texto/nombre-de-producto";
import { esUuid } from "../persistencia/filas";
import type { DiferenciaDeSaldo } from "../persistencia/lecturas-del-libro";
import type { UsoDeDeposito } from "../persistencia/modelo";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/** Filas por página de las consultas de stock (cursor): la misma para existencias y libro. */
export const TAMANO_DE_PAGINA = 50;

/** Dónde sigue la lista de existencias: la terna por la que se ordena (`nombre_clave`, artículo, depósito). */
export type CursorDeExistencias = Readonly<{
  nombreClave: string;
  articuloId: string;
  depositoId: string;
}>;

export type ExistenciaDeLista = Readonly<{
  articuloId: string;
  productoId: string;
  nombre: string;
  /** La unidad de stock del artículo: en ella está `existencia`. */
  unidadId: string;
  depositoId: string;
  /** Texto decimal exacto; negativa si el control lo permitió. */
  existencia: string;
  /** «Disponible» es lo que hay en depósitos `NORMAL`: cuarentena y rechazo no suman (D118). */
  uso: UsoDeDeposito;
}>;

export type PaginaDeExistencias = Readonly<{
  existencias: readonly ExistenciaDeLista[];
  /** Pasar como `despuesDe` para pedir la página siguiente; `null` si no hay más. */
  siguiente: CursorDeExistencias | null;
}>;

export type EntradaDeExistencias = Readonly<{
  depositoId?: string | undefined;
  sucursalId?: string | undefined;
  /** Prefijo del nombre del producto, sin distinguir mayúsculas. */
  texto?: string | undefined;
  soloNegativas?: boolean | undefined;
  despuesDe?: CursorDeExistencias | undefined;
}>;

const PAGINA_VACIA: PaginaDeExistencias = { existencias: [], siguiente: null };

const cursorValido = (c: CursorDeExistencias | undefined): boolean =>
  c === undefined ||
  (typeof c.nombreClave === "string" &&
    c.nombreClave.length <= 2 * LARGO_MAXIMO_DEL_NOMBRE_DE_PRODUCTO &&
    esUuid(c.articuloId) &&
    esUuid(c.depositoId));

/**
 * Pestañas Existencias y la lista de salud (E5 §3.4): una fila por saldo existente (lo que nunca se movió no figura), por nombre de producto,
 * artículo y depósito, paginada por cursor. Guard `stock.ver`; el operador solo ve los depósitos de sus sucursales (filtro de la consulta: pedir
 * un depósito o una sucursal ajenos da una página vacía, no un error, y es indistinguible de uno que no existe). Un filtro mal formado
 * (id que no es UUID, texto largo, cursor roto) da una página vacía: nada se adivina.
 */
export function armarConsultasDeExistencias(leer: Lector) {
  const pagina = (
    contexto: ContextoOperativo,
    accion: typeof DECLARACIONES_DE_CONSULTAS.existencias.accion,
    entrada: EntradaDeExistencias,
  ): Promise<RDeConsulta<PaginaDeExistencias>> =>
    leer(contexto, accion, async (tx, alcance) => {
      if (
        (entrada.depositoId !== undefined && !esUuid(entrada.depositoId)) ||
        (entrada.sucursalId !== undefined && !esUuid(entrada.sucursalId)) ||
        (entrada.texto !== undefined &&
          (typeof entrada.texto !== "string" ||
            entrada.texto.length > LARGO_MAXIMO_DEL_NOMBRE_DE_PRODUCTO)) ||
        !cursorValido(entrada.despuesDe)
      ) {
        return PAGINA_VACIA;
      }
      const filas = await tx.movimientosDeStock.existencias(contexto.empresaId, {
        alcance,
        depositoId: entrada.depositoId,
        sucursalId: entrada.sucursalId === undefined ? undefined : sucursalId(entrada.sucursalId),
        texto: entrada.texto,
        soloNegativas: entrada.soloNegativas,
        despuesDe: entrada.despuesDe,
        limite: TAMANO_DE_PAGINA + 1,
      });
      const pagina = filas.slice(0, TAMANO_DE_PAGINA);
      const ultima = pagina[pagina.length - 1];
      return {
        existencias: pagina.map((f) => ({
          articuloId: f.articuloId,
          productoId: f.productoId,
          nombre: f.nombre,
          unidadId: f.unidadId,
          depositoId: f.depositoId,
          existencia: f.existencia,
          uso: f.uso,
        })),
        siguiente:
          filas.length > TAMANO_DE_PAGINA && ultima !== undefined
            ? {
                nombreClave: ultima.nombreClave,
                articuloId: ultima.articuloId,
                depositoId: ultima.depositoId,
              }
            : null,
      };
    });
  return {
    existencias: (contexto: ContextoOperativo, entrada: EntradaDeExistencias = {}) =>
      pagina(contexto, DECLARACIONES_DE_CONSULTAS.existencias.accion, entrada),
    /** Los saldos que están en negativo (el control los permitió): lo que mira la persona que cierra y quien revisa la salud del libro. */
    existenciasNegativas: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ despuesDe?: CursorDeExistencias | undefined }> = {},
    ) =>
      pagina(contexto, DECLARACIONES_DE_CONSULTAS.existenciasNegativas.accion, {
        despuesDe: entrada.despuesDe,
        soloNegativas: true,
      }),
    /**
     * Los pares (depósito, artículo) cuyo saldo difiere de la suma de sus renglones: DEBE ser vacío (el saldo se deriva del libro). Guard
     * `stock.verificar_saldos` (solo el gerente). Es de toda la empresa: no se filtra por sucursal.
     */
    verificarSaldos: (
      contexto: ContextoOperativo,
    ): Promise<RDeConsulta<readonly DiferenciaDeSaldo[]>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.verificarSaldos.accion, (tx) =>
        tx.movimientosDeStock.verificarSaldos(contexto.empresaId),
      ),
  };
}
