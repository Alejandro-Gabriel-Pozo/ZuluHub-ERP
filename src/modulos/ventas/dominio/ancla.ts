import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  textoDeUnaLineaDesdeTexto,
  type MotivoDeTextoInvalido,
} from "../../../primitivas/texto/texto-de-una-linea";
import { esUuid } from "./identificadores";

/**
 * FICHAS DEL DATO: ANCLA Y ETIQUETA DE UNA CUENTA (E4 §3.1 y §3.4). La cuenta no sabe quién la abre: el módulo de arriba (el salón) le pone
 * un `ancla (tipo, id)` opaca y a lo sumo una cuenta abierta por ancla; el mostrador no usa ancla. El tipo es una clave de máquina de
 * letras minúsculas y guion bajo, con un punto opcional (`salon.mesa`), de hasta 40; el id es un uuid. La etiqueta es un texto corto para
 * personas (hasta 40, lista de permitidos de `texto-de-una-linea`). La base repite ambas reglas (`cuenta_ancla_tipo_ck`, `cuenta_etiqueta_ck`).
 */
export const LARGO_MAXIMO_DEL_TIPO_DE_ANCLA = 40;
export const LARGO_MAXIMO_DE_LA_ETIQUETA = 40;

const FORMA_DEL_TIPO_DE_ANCLA = /^[a-z_]+(\.[a-z_]+)?$/;

export type Ancla = Readonly<{ tipo: string; id: string }>;

export function anclaValida(ancla: Ancla): Resultado<Ancla, "ANCLA_INVALIDA"> {
  return ancla.tipo.length <= LARGO_MAXIMO_DEL_TIPO_DE_ANCLA &&
    FORMA_DEL_TIPO_DE_ANCLA.test(ancla.tipo) &&
    esUuid(ancla.id)
    ? ok(ancla)
    : err("ANCLA_INVALIDA");
}

export function etiquetaDeCuenta(texto: string): Resultado<string, "ETIQUETA_INVALIDA"> {
  const etiqueta: Resultado<string, MotivoDeTextoInvalido> = textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DE_LA_ETIQUETA,
    exigirUnaLetra: false,
  });
  return etiqueta.ok ? ok(etiqueta.valor) : err("ETIQUETA_INVALIDA");
}
