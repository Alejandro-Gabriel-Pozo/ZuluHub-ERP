import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { TxDeConsultasDeStock } from "../casos-de-uso/contrato";
import {
  comparacionDeVersiones,
  fichaDeCocinaDe,
  fichaDeLaVersion,
  type ComparacionDeVersiones,
  type FichaDeCocina,
  type FichaDeReceta,
  type VersionDeReceta,
} from "../casos-de-uso/lectura-de-recetas";
import { esUuid } from "../persistencia/filas";
import type { ComposicionGuardada } from "../persistencia/modelo";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type {
  CambioDeComponente,
  ComparacionDeVersiones,
  CostosDeFicha,
  FichaDeCocina,
  FichaDeReceta,
  LineaDeCocina,
  LineaDeFicha,
  VersionDeReceta,
} from "../casos-de-uso/lectura-de-recetas";

type Tx = TxDeConsultasDeStock;

/**
 * Las consultas de recetas (E6 §3.5): la ficha con costo, comparar versiones, la lista de versiones y la ficha de cocina. Mirar es de quien
 * puede mirar stock (`stock.ver`: la receta es de la empresa, no de una sucursal); los COSTOS viajan solo con `costos.ver` (el rol de la misma
 * transacción lo decide, no la pantalla; E5-T10, P-1). Sin costo es `null`, nunca cero (D125). Un id mal formado, de otra empresa o una
 * versión que no existe da `null`/lista vacía (indistinguibles: la RLS). Las cuentas están en `casos-de-uso/lectura-de-recetas.ts`: una
 * consulta no importa el dominio (ADR-005).
 */
export function armarConsultasDeRecetas(leer: Lector, reglas: ReglasDeEmpresa) {
  const veCostos = async (tx: Tx, contexto: ContextoOperativo): Promise<boolean> =>
    (await exigirAccion(reglas, "costos.ver", () => tx.autorizacion.delActor(contexto))).ok;

  return {
    /** La ficha de una versión (la vigente si no se dice): componentes con bruto cargado, merma y neto; con `costos.ver`, costo por línea y de la receta. */
    fichaDeReceta: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoId: string; version?: number | undefined }>,
    ): Promise<RDeConsulta<FichaDeReceta | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.fichaDeReceta.accion, async (tx, alcance) => {
        if (typeof entrada.productoId !== "string" || !esUuid(entrada.productoId)) return null;
        const ultima = await tx.composicionesDeStock.ultimaVersion(
          contexto.empresaId,
          entrada.productoId,
        );
        if (ultima === null) return null;
        const version =
          entrada.version === undefined
            ? ultima
            : await versionPedida(tx, contexto, entrada.productoId, entrada.version);
        if (version === null) return null;
        return fichaDeLaVersion(
          tx,
          contexto,
          alcance,
          version,
          ultima,
          await veCostos(tx, contexto),
        );
      }),

    /** Qué cambió entre dos versiones y, con `costos.ver`, cuánto cambia el costo por unidad con los precios de hoy. */
    compararVersiones: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoId: string; desde: number; hasta: number }>,
    ): Promise<RDeConsulta<ComparacionDeVersiones | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.compararVersiones.accion, async (tx, alcance) => {
        if (typeof entrada.productoId !== "string" || !esUuid(entrada.productoId)) return null;
        const desde = await versionPedida(tx, contexto, entrada.productoId, entrada.desde);
        const hasta = await versionPedida(tx, contexto, entrada.productoId, entrada.hasta);
        if (desde === null || hasta === null) return null;
        return comparacionDeVersiones(
          tx,
          contexto,
          alcance,
          desde,
          hasta,
          await veCostos(tx, contexto),
        );
      }),

    /** Las versiones de la receta de un producto, de la más nueva a la más vieja. */
    versionesDeReceta: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoId: string }>,
    ): Promise<RDeConsulta<readonly VersionDeReceta[]>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.versionesDeReceta.accion, async (tx) => {
        if (typeof entrada.productoId !== "string" || !esUuid(entrada.productoId)) return [];
        const versiones = await tx.composicionesDeStock.versionesDe(
          contexto.empresaId,
          entrada.productoId,
        );
        return versiones.map((v) => ({
          version: v.numero,
          rinde: v.rinde,
          pasos: v.pasos,
          creadaPor: v.creadaPor,
          creadaEn: v.creadaEn,
        }));
      }),

    /** La ficha de cocina de la versión vigente: cantidades BRUTAS y pasos, sin costos ni precios (D99, idea 6). */
    fichaDeCocina: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoId: string }>,
    ): Promise<RDeConsulta<FichaDeCocina | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.fichaDeCocina.accion, async (tx) => {
        if (typeof entrada.productoId !== "string" || !esUuid(entrada.productoId)) return null;
        const version = await tx.composicionesDeStock.ultimaVersion(
          contexto.empresaId,
          entrada.productoId,
        );
        return version === null ? null : fichaDeCocinaDe(tx, contexto, version);
      }),
  };
}

/** Una versión por número de ese producto; el número tiene que ser un entero positivo (si no, no existe). */
async function versionPedida(
  tx: Tx,
  contexto: ContextoOperativo,
  productoId: string,
  numero: unknown,
): Promise<ComposicionGuardada | null> {
  if (typeof numero !== "number" || !Number.isSafeInteger(numero) || numero < 1) return null;
  return tx.composicionesDeStock.porNumero(contexto.empresaId, productoId, numero);
}
