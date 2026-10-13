import type { ConfiguracionPublica, TokenDeTema } from "../../modulos/marcas/publico";
import { ok } from "../../primitivas/resultado/resultado";
import type {
  ConfiguracionPublicaDeHost,
  ConfiguracionPublicaDeMarca,
  TokenDeTemaPublico,
} from "../../puertos/marcas";
import type { TransaccionesPublicas } from "../../puertos/transacciones-publicas";
import { pedidoServible, type TxPublica } from "./resolucion-de-host";

type Iguales<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Los colores del puerto son exactamente los del dominio (y los del `CHECK tema_valido` de la base). */
const TOKENS_COINCIDEN: Iguales<TokenDeTemaPublico, TokenDeTema> = true;
/** La configuración del dominio es estructuralmente la del puerto: el tipo no deja pasar un campo de más. */
const CONFIGURACION_ES_LA_DEL_PUERTO: ConfiguracionPublica extends ConfiguracionPublicaDeMarca
  ? true
  : never = true;
void TOKENS_COINCIDEN;
void CONFIGURACION_ES_LA_DEL_PUERTO;

/**
 * `ConfiguracionPublicaDeHost` sobre la puerta pública (marcas y planes, §B.2.3): lo que la página pinta
 * de la marca de un host, leído con el rol `zuluhub_publico`.
 *
 *  - Los mismos filtros previos que `ResolucionDeHost` (`pedidoServible`): un host que no normaliza o una
 *    superficie fuera de la lista responden `ok(null)` SIN tocar la base.
 *  - Todo lo demás es UNA transacción de solo lectura con una sola foto (`LecturaPublicaDeMarcas`): la
 *    resolución del host y la lectura de la marca no pueden verse a medias.
 *  - Devuelve exactamente `nombre`, `tema` y `hostCanonico`: se arma el objeto campo por campo, así que
 *    un campo nuevo de la lectura no sale por la puerta sin que alguien lo decida acá.
 *  - No guarda nada entre llamadas. Un fallo de la base vuelve como `err`, nunca como `ok(null)`.
 */
export function crearConfiguracionPublicaDeHost(
  transacciones: TransaccionesPublicas<TxPublica>,
): ConfiguracionPublicaDeHost {
  return {
    async porHost(host, superficie) {
      const pedido = pedidoServible(host, superficie);
      if (pedido === null) return ok(null);
      const leida = await transacciones.leer((tx) =>
        tx.marcas.configuracionDeHost(pedido.host, pedido.superficie),
      );
      if (!leida.ok) return leida;
      if (leida.valor === null) return ok(null);
      const { nombre, tema, hostCanonico } = leida.valor;
      return ok({ nombre, tema, hostCanonico });
    },
  };
}
