import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ReglasDePlataforma } from "../../capacidades/permisos/plataforma";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  LISTAS_DEL_SISTEMA,
  listaDesdeTexto,
  type ErrorDeListaInvalida,
  type ListaDelSistema,
  type RepositorioDeListas,
  type ValorGuardado,
} from "../../modulos/listas/publico";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { Transacciones, ErrorDePersistencia } from "../../puertos/transacciones";
import type { TxDeListas } from "../casos-de-uso/listas-comun";
import { exigirAccionDePlataforma } from "./comun";
import type { DeclaracionDeAccionDePlataforma } from "./declaraciones";

/**
 * Las consultas de plataforma sobre las listas del sistema (e3 §3.7, decisión 130) y la acción que cada una exige al guard. SOPORTE
 * ve (`listas.ver`); solo ADMIN cambia (`listas.editar`). La fábrica exige que cada consulta tenga su declaración.
 */
export const DECLARACIONES_DE_CONSULTAS_DE_LISTAS = {
  listarValoresDeLista: { accion: "listas.ver" },
} as const satisfies Record<string, DeclaracionDeAccionDePlataforma>;

/** Lo que una consulta de listas recibe de su transacción: el guard y el repositorio, para LEER (no puede escribir ni auditar). */
export type TxDeConsultasDeListas = Pick<TxDeListas, "autorizacionDePlataforma"> &
  Readonly<{ listas: Pick<RepositorioDeListas, "listar"> }>;

export type DependenciasDeConsultasDeListas = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeListas>;
  /** El catálogo y la matriz de PLATAFORMA con los que se autoriza a quien consulta. */
  reglas: ReglasDePlataforma;
}>;

export type EntradaDeListarValoresDeLista = Readonly<{
  /** Una lista (`MARCAS_DE_TARJETA` o `MOTIVOS_DE_RECHAZO`) o ninguna: todas. Llega sin tipar y se valida. */
  lista?: string | null;
}>;

export type VistaDeValoresDeLista = Readonly<{ valores: readonly ValorGuardado[] }>;

export type ErrorAlListarValoresDeLista =
  MotivoDeRechazo | ErrorDeListaInvalida | ErrorDePersistencia;

const LECTURA = { aislamiento: "read committed", soloLectura: true } as const;

/**
 * Los valores de las listas, activos e inactivos, por lista y por nombre (sin distinguir mayúsculas ni acentos), con la `version` que
 * cada cambio pide como `versionEsperada`. `listas.ver`, solo lectura. Sin `lista`, las dos.
 */
export function armarListarValoresDeLista({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeListas) {
  return async function listarValoresDeLista(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeListarValoresDeLista = {},
  ): Promise<Resultado<VistaDeValoresDeLista, ErrorAlListarValoresDeLista>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (
        tx,
      ): Promise<Resultado<VistaDeValoresDeLista, MotivoDeRechazo | ErrorDeListaInvalida>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          DECLARACIONES_DE_CONSULTAS_DE_LISTAS.listarValoresDeLista.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        let listas: readonly ListaDelSistema[] = LISTAS_DEL_SISTEMA;
        if (entrada.lista !== undefined && entrada.lista !== null) {
          const lista = listaDesdeTexto(entrada.lista);
          if (!lista.ok) return err(lista.error);
          listas = [lista.valor];
        }
        return ok({ valores: await tx.listas.listar(listas) });
      },
    );
  };
}

/** Las consultas de listas, listas para que la composición las ofrezca (ver `DECLARACIONES_DE_CONSULTAS_DE_LISTAS`). */
export function crearConsultasDeListas(dependencias: DependenciasDeConsultasDeListas) {
  return {
    listarValoresDeLista: armarListarValoresDeLista(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS_DE_LISTAS, unknown>;
}

export type ConsultasDeListas = ReturnType<typeof crearConsultasDeListas>;
