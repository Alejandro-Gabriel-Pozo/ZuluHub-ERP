import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { NIVELES_ESTANDAR_DE_COMPRA, type NivelDeCompra } from "../modulos/compras/publico";
import { ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeGuardarElNivel } from "./entradas-de-nivel-de-compras";
import { accionDeCompras } from "./errores-de-compras";
import type { Web } from "./web";

/**
 * «Nivel de compras» (Compras PR 11; maqueta `compra-nivel.html`): el gerente elige entre «Sin factura» (N1) y «Con factura» (N2).
 *  - **Leer no escribe**: `nivelDeCompras` no crea la fila de una empresa que todavía no la tiene (mirar no escribe).
 *  - **Guardar** es `configurarCompras`: solo el gerente (`compras.configurar`, el guard corre dentro de su transacción), con la versión que se vio. Dos personas que guardan niveles distintos con la misma
 *    versión: una gana y la otra recibe el genérico (`VERSION_DESACTUALIZADA`) sin escribir; guardar el nivel vigente repetido no escribe ni audita; lo ya cargado conserva el nivel con que nació.
 *  - La empresa y quién actúa salen de la sesión. N3 y N4 (fase 5, pausada) no se ofrecen ni se aceptan: la lista de niveles sale del dominio.
 */

export type DependenciasDeNivelDeComprasWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeCompras"]>, "configurarCompras">;
  consultas: () => Pick<ReturnType<Web["consultasDeCompras"]>, "nivelDeCompras">;
  respuesta: DependenciasDeRespuesta;
}>;

export type NivelDeComprasParaLaPantalla = Readonly<{
  /** El nivel vigente. Si es uno de la fase 5 (puesto por soporte), la pantalla no marca ninguno. */
  nivel: NivelDeCompra;
  /** Lo que la persona vio: vuelve con el guardado para detectar que otra persona cambió el nivel antes. */
  version: number;
  /** Los niveles que se eligen, en orden. */
  niveles: readonly NivelDeCompra[];
}>;

/** El nivel vigente y su versión, sin escribir nada. */
export function leerElNivelDeCompras(
  d: DependenciasDeNivelDeComprasWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<NivelDeComprasParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    {},
    () => ok(null),
    () => d.consultas().nivelDeCompras(contexto),
    (vigente) => ({
      nivel: vigente.nivel,
      version: vigente.version,
      niveles: NIVELES_ESTANDAR_DE_COMPRA,
    }),
  );
}

/** Guarda el nivel elegido con la versión que la persona vio. Devuelve lo vigente tras guardar. */
export function guardarElNivelDeCompras(
  d: DependenciasDeNivelDeComprasWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<NivelDeComprasParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeGuardarElNivel,
    (entrada) => d.casosDeUso().configurarCompras(contexto, entrada),
    (vigente) => ({
      nivel: vigente.nivel,
      version: vigente.version,
      niveles: NIVELES_ESTANDAR_DE_COMPRA,
    }),
  );
}
