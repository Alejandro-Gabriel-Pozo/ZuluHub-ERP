import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  comparacionDeVersiones,
  costoPorUnidadDeLaVersion,
  fichaDeCocinaDe,
  fichaDeLaVersion,
  type ComparacionDeVersiones,
  type FichaDeCocina,
  type FichaDeReceta,
  type VersionDeReceta,
} from "../casos-de-uso/lectura-de-recetas";
import { esUuid } from "../persistencia/filas";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { veLosCostos, versionPedida } from "./recetas-para-pantalla";

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

/**
 * Las consultas de recetas (E6 §3.5): la ficha con costo, comparar versiones, la lista de versiones y la ficha de cocina. Mirar es de quien
 * puede mirar stock (`stock.ver`: la receta es de la empresa, no de una sucursal); los COSTOS viajan solo con `costos.ver` (el rol de la misma
 * transacción lo decide, no la pantalla; E5-T10, P-1). Sin costo es `null`, nunca cero (D125). Un id mal formado, de otra empresa o una
 * versión que no existe da `null`/lista vacía (indistinguibles: la RLS). Las cuentas están en `casos-de-uso/lectura-de-recetas.ts`: una
 * consulta no importa el dominio (ADR-005).
 */
export function armarConsultasDeRecetas(leer: Lector, reglas: ReglasDeEmpresa) {
  const veCostos = veLosCostos(reglas);

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

    /**
     * Las versiones de la receta de un producto, de la más nueva a la más vieja. Con `costos.ver`, cada una trae el costo de una unidad con los precios de HOY (`costoPorUnidad`,
     * en `moneda`; `null` si no se sabe, p. ej. la versión que retiró la receta). Quién la guardó sale como persona (`creadaPor`): ponerle nombre es de la composición.
     */
    versionesDeReceta: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoId: string }>,
    ): Promise<RDeConsulta<readonly VersionDeReceta[]>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.versionesDeReceta.accion, async (tx, alcance) => {
        if (typeof entrada.productoId !== "string" || !esUuid(entrada.productoId)) return [];
        const versiones = await tx.composicionesDeStock.versionesDe(
          contexto.empresaId,
          entrada.productoId,
        );
        const conCostos = await veCostos(tx, contexto);
        const memo = new Map<string, bigint | null>();
        const lista: VersionDeReceta[] = [];
        for (const v of versiones) {
          const base = {
            version: v.numero,
            rinde: v.rinde,
            pasos: v.pasos,
            creadaPor: v.creadaPor,
            creadaEn: v.creadaEn,
          };
          if (!conCostos) {
            lista.push(base);
            continue;
          }
          // La lista no trae los componentes: la versión completa se lee de a una (todas dentro de la misma transacción).
          const completa = await tx.composicionesDeStock.porNumero(
            contexto.empresaId,
            entrada.productoId,
            v.numero,
          );
          lista.push({
            ...base,
            moneda: "ARS",
            costoPorUnidad:
              completa === null
                ? null
                : await costoPorUnidadDeLaVersion(tx, contexto, alcance, completa, memo),
          });
        }
        return lista;
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
