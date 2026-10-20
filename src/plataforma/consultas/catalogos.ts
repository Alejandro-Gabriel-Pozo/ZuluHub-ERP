import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import { CATALOGO_DE_TEXTOS, LARGO_MAXIMO_DE_TEXTO } from "../../capacidades/vocabulario/catalogo";
import type { ClaveDeTexto } from "../../capacidades/vocabulario/catalogo";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  ASPECTO_POR_DEFECTO,
  COLORES_DE_SUPERFICIE,
  COLOR_DEL_TEMA,
  LISTAS_DE_ASPECTO,
  SUPERFICIES_DE_ASPECTO,
  TOKENS_DE_ASPECTO,
  TOKENS_DE_TEMA,
  contrastesDelTema,
} from "../../modulos/marcas/publico";
import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import { exigirAccionDePlataforma } from "./comun";
import type {
  DependenciasDeConsultasDeMarcasYPlanes,
  VistaDeCatalogosDeMarca,
} from "./contrato-de-marcas-y-planes";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES as D } from "./declaraciones-de-marcas-y-planes";

const LECTURA = { aislamiento: "read committed", soloLectura: true } as const;

export type ErrorAlVerUnCatalogo = MotivoDeRechazo | ErrorDePersistencia;

/**
 * Los catálogos con los que se arma el editor de una marca (tema, aspecto, superficies y vocabulario), tal
 * como los valida el guardado del borrador. `marcas.ver`. No lee ninguna tabla: son constantes del código; la
 * transacción es solo la que lee al administrador para el guard. Los pares de contraste y sus mínimos salen de
 * `contrastesDelTema`, la misma definición que usa la confirmación.
 */
export function armarCatalogosDeMarca({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function catalogosDeMarca(
    contexto: ContextoDePlataforma,
  ): Promise<Resultado<VistaDeCatalogosDeMarca, ErrorAlVerUnCatalogo>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (tx): Promise<Resultado<VistaDeCatalogosDeMarca, MotivoDeRechazo>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.catalogosDeMarca.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        return ok({
          tema: {
            tokens: TOKENS_DE_TEMA,
            formato: "#rrggbb",
            patron: COLOR_DEL_TEMA.source,
            pares: contrastesDelTema({}, "NEUTRA").map(({ par, minimo }) => ({ par, minimo })),
          },
          aspecto: TOKENS_DE_ASPECTO.map((token) => ({
            token,
            valores: LISTAS_DE_ASPECTO[token],
            porDefecto: ASPECTO_POR_DEFECTO[token],
          })),
          superficies: SUPERFICIES_DE_ASPECTO.map((valor) => ({
            valor,
            fondo: COLORES_DE_SUPERFICIE[valor].fondo,
            superficie: COLORES_DE_SUPERFICIE[valor].superficie,
          })),
          vocabulario: (Object.keys(CATALOGO_DE_TEXTOS) as ClaveDeTexto[]).sort().map((texto) => {
            const definicion: {
              porDefecto: string;
              largoMaximo?: number;
              marcadores?: readonly string[];
            } = CATALOGO_DE_TEXTOS[texto];
            return {
              texto,
              porDefecto: definicion.porDefecto,
              largoMaximo: definicion.largoMaximo ?? LARGO_MAXIMO_DE_TEXTO,
              marcadores: definicion.marcadores ?? [],
            };
          }),
        });
      },
    );
  };
}
