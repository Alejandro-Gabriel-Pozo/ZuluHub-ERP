import { z } from "zod";
import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import {
  MAXIMO_DE_DIAS_POR_VENCER,
  type LoteQueVence,
  type LotesDeUnArticulo,
} from "../modulos/stock/publico";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { identificador, leer, type ErrorDeEntrada } from "./entradas-de-facturacion";
import { accionDeStock } from "./errores-de-stock";
import type { Web } from "./web";

/**
 * La pestaña «Lotes» de stock (STK-E, lectura; FP-STK-13 y FP-STK-14, maqueta `stock-lotes.html`): dos LECTURAS que no escriben ni auditan y repetirlas da lo mismo.
 *  - **Lotes de un artículo**: el artículo se elige entre los controlados (el pedido, o el primero); uno que no está en la lista sale como el genérico. Sin importes: la maqueta no los muestra, así que
 *    `seLosPierde` nunca sale de acá aunque quien mira tenga `costos.ver`. La existencia y lo disponible son texto decimal exacto (ADR-006).
 *  - **Vencimientos**: lo que vence en los próximos `dias` (0 a 365, por defecto 7) en la sucursal que el servidor fija (nunca el pedido). «Vencido» y «Vence hoy» los decide la consulta con la jornada de la
 *    sucursal; lo que vence después no lleva estado.
 * El guard (`lotes.ver`) y el alcance de sucursales los resuelve la consulta; un id de otra empresa o ajeno sale como si no existiera.
 */

export type DependenciasDeLotesWeb = Readonly<{
  consultas: () => Pick<
    ReturnType<Web["consultasDeStock"]>,
    "articulosControlados" | "lotesDeArticulo" | "vencimientosProximos"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

export const DIAS_POR_DEFECTO = 7;

export type ArticuloParaElSelector = Readonly<{ id: string; nombre: string }>;

export type LoteParaLaPantalla = Readonly<{
  loteId: string;
  codigo: string;
  /** `AAAA-MM-DD`, o `null` (el «sin asignar»). */
  vence: string | null;
  existencia: string;
  disponible: string;
  sinAsignar: boolean;
}>;

export type LotesParaLaPantalla = Readonly<{
  articulos: readonly ArticuloParaElSelector[];
  articuloId: string | null;
  unidadId: string | null;
  lotes: readonly LoteParaLaPantalla[];
}>;

export type VencimientoParaLaPantalla = Readonly<{
  loteId: string;
  nombre: string;
  codigo: string;
  vence: string;
  existencia: string;
  unidadId: string;
  estado: "VENCIDO" | "VENCE_HOY" | null;
}>;

export type VencimientosParaLaPantalla = Readonly<{
  dias: number;
  vencimientos: readonly VencimientoParaLaPantalla[];
}>;

const formaDeLotes = z.object({ articuloId: identificador.optional() }).strict();
const formaDeVencimientos = z
  .object({
    dias: z
      .string()
      .regex(/^\d{1,3}$/)
      .optional(),
  })
  .strict();

function entradaDeLotes(
  crudo: unknown,
): Resultado<Readonly<{ articuloId: string | undefined }>, ErrorDeEntrada> {
  const leida = leer(formaDeLotes, crudo);
  return leida.ok ? ok({ articuloId: leida.valor.articuloId }) : leida;
}

/** Los días del filtro: un entero de 0 a 365; sin valor, los de por defecto. Uno fuera de rango no se corrige: se rechaza. */
function entradaDeVencimientos(
  crudo: unknown,
): Resultado<Readonly<{ dias: number }>, ErrorDeEntrada> {
  const leida = leer(formaDeVencimientos, crudo);
  if (!leida.ok) return leida;
  const dias = leida.valor.dias === undefined ? DIAS_POR_DEFECTO : Number(leida.valor.dias);
  return dias <= MAXIMO_DE_DIAS_POR_VENCER
    ? ok({ dias })
    : err({ codigo: "FISCAL_DATOS_INVALIDOS", campo: "dias" });
}

type Cargado = Readonly<{
  articulos: readonly ArticuloParaElSelector[];
  articuloId: string | null;
  unidadId: string | null;
  lotes: LotesDeUnArticulo | null;
}>;

/** Los lotes del artículo elegido (o del primero controlado), con el selector de artículos. */
export function lotesDelArticulo(
  d: DependenciasDeLotesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<LotesParaLaPantalla>> {
  return accionDeStock<Readonly<{ articuloId: string | undefined }>, Cargado, LotesParaLaPantalla>(
    d.respuesta,
    crudo,
    entradaDeLotes,
    async (entrada) => {
      const controlados = await d.consultas().articulosControlados(contexto);
      if (!controlados.ok) return controlados;
      const elegido =
        entrada.articuloId === undefined
          ? controlados.valor[0]
          : controlados.valor.find((a) => a.articuloId === entrada.articuloId);
      if (entrada.articuloId !== undefined && elegido === undefined) {
        return err("IDENTIFICADOR_INVALIDO");
      }
      const articulos = controlados.valor.map((a) => ({ id: a.articuloId, nombre: a.nombre }));
      if (elegido === undefined)
        return ok({ articulos, articuloId: null, unidadId: null, lotes: null });
      const lotes = await d
        .consultas()
        .lotesDeArticulo(contexto, { articuloId: elegido.articuloId });
      if (!lotes.ok) return lotes;
      return ok({
        articulos,
        articuloId: elegido.articuloId,
        unidadId: elegido.unidadId,
        lotes: lotes.valor,
      });
    },
    ({ articulos, articuloId, unidadId, lotes }): LotesParaLaPantalla => ({
      articulos,
      articuloId,
      unidadId,
      lotes: (lotes?.lotes ?? []).map((l) => ({
        loteId: l.loteId,
        codigo: l.codigo,
        vence: l.fechaDeVencimiento,
        existencia: l.existencia,
        disponible: l.disponible,
        sinAsignar: l.esSinAsignar,
      })),
    }),
  );
}

const estadoDe = (l: LoteQueVence): VencimientoParaLaPantalla["estado"] =>
  l.situacion.tipo === "VENCIDO" || l.situacion.tipo === "VENCE_HOY" ? l.situacion.tipo : null;

/** Lo que vence en los próximos días (o ya venció) en la sucursal elegida. */
export function vencimientosDeLaSucursal(
  d: DependenciasDeLotesWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<VencimientosParaLaPantalla>> {
  return accionDeStock<
    Readonly<{ dias: number }>,
    Readonly<{ dias: number; lotes: readonly LoteQueVence[] }>,
    VencimientosParaLaPantalla
  >(
    d.respuesta,
    crudo,
    entradaDeVencimientos,
    async ({ dias }) => {
      const lotes = await d.consultas().vencimientosProximos(contexto, { dias, sucursalId });
      return lotes.ok ? ok({ dias, lotes: lotes.valor }) : lotes;
    },
    ({ dias, lotes }): VencimientosParaLaPantalla => ({
      dias,
      vencimientos: lotes.map((l) => ({
        loteId: l.loteId,
        nombre: l.nombre,
        codigo: l.codigo,
        vence: l.vence,
        existencia: l.existencia,
        unidadId: l.unidadId,
        estado: estadoDe(l),
      })),
    }),
  );
}
