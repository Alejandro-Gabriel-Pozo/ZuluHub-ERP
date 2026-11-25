import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import { ESTADOS_DE_DOMINIO } from "../../modulos/marcas/publico";
import { empresaId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import {
  paginaValida,
  resultadoDePagina,
  uuidDesdeTexto,
  type EntradaDePagina,
  type ErrorDePagina,
  type ResultadoDePagina,
} from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type {
  DependenciasDeConsultasDePlataforma,
  FilaDeDominio,
  FiltroDeDominios,
} from "./contrato";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA as D } from "./declaraciones";

/**
 * Lo que llega sin tipar del navegador: una empresa y/o un estado, más la página. Se valida acá (lista cerrada de estados, uuid canónico); un valor que no
 * sirve es un error, nunca «sin filtro» (todo nace cerrado: un filtro mal escrito no devuelve todo).
 */
export type EntradaDeListarDominios = EntradaDePagina &
  Readonly<{ empresaId?: string | null; estado?: string | null }>;

export type ErrorAlListarDominios =
  MotivoDeRechazo | ErrorDePagina | "ID_INVALIDO" | "FILTRO_INVALIDO" | ErrorDePersistencia;

function filtroValido(
  entrada: EntradaDeListarDominios,
): Resultado<FiltroDeDominios, "ID_INVALIDO" | "FILTRO_INVALIDO"> {
  let empresa: FiltroDeDominios["empresaId"] = null;
  if (entrada.empresaId !== undefined && entrada.empresaId !== null) {
    const id = uuidDesdeTexto(entrada.empresaId);
    if (!id.ok) return err("ID_INVALIDO");
    empresa = empresaId(id.valor);
  }
  let estado: FiltroDeDominios["estado"] = null;
  if (entrada.estado !== undefined && entrada.estado !== null) {
    const pedido = ESTADOS_DE_DOMINIO.find((e) => e === entrada.estado);
    if (pedido === undefined) return err("FILTRO_INVALIDO");
    estado = pedido;
  }
  return ok({ empresaId: empresa, estado });
}

/**
 * Los dominios de las empresas con su estado y la razón social de cada una, por id y en páginas (consola «Dominios»). `dominios.ver` (ADMIN y SOPORTE), solo
 * lectura. Los dominios de una marca no entran: los administra otro camino.
 */
export function armarListarDominios({
  transacciones,
  reglas,
}: DependenciasDeConsultasDePlataforma) {
  return async function listarDominios(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeListarDominios = {},
  ): Promise<Resultado<ResultadoDePagina<FilaDeDominio>, ErrorAlListarDominios>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<
          ResultadoDePagina<FilaDeDominio>,
          MotivoDeRechazo | ErrorDePagina | "ID_INVALIDO" | "FILTRO_INVALIDO"
        >
      > => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.listarDominios.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const filtro = filtroValido(entrada);
        if (!filtro.ok) return filtro;
        const pagina = paginaValida(entrada, "UUID");
        if (!pagina.ok) return pagina;
        const filas = await tx.soporte.listarDominios(filtro.valor, pagina.valor);
        return ok(resultadoDePagina(filas, pagina.valor, (f) => f.id));
      },
    );
  };
}
