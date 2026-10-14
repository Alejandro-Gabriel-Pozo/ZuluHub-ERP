import {
  SUPERFICIES_DE_DOMINIO,
  normalizarHost,
  type Host,
  type HostServible,
  type LecturaPublicaDeMarcas,
  type SuperficieDeDominio,
} from "../../modulos/marcas/publico";
import { ok } from "../../primitivas/resultado/resultado";
import type { HostResuelto, ResolucionDeHost, SuperficieDeHost } from "../../puertos/marcas";
import type { TransaccionesPublicas } from "../../puertos/transacciones-publicas";

/** Lo que recibe el trabajo de una transacción pública: solo lecturas de marcas. */
export type TxPublica = Readonly<{ marcas: LecturaPublicaDeMarcas }>;

type Iguales<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/**
 * Las superficies del puerto son exactamente las del dominio (y las del CHECK de la base). Si una lista
 * cambia sin la otra, esto no compila.
 */
const SUPERFICIES_COINCIDEN: Iguales<SuperficieDeHost, SuperficieDeDominio> = true;
/** El host servible del dominio es estructuralmente el `HostResuelto` del puerto. */
const HOST_SERVIBLE_ES_EL_DEL_PUERTO: HostServible extends HostResuelto ? true : never = true;
void SUPERFICIES_COINCIDEN;
void HOST_SERVIBLE_ES_EL_DEL_PUERTO;

/**
 * El pedido de un llamador sin tipos, filtrado ANTES de tocar la base: el host normalizado y la
 * superficie, o `null` si no se puede servir (host que no normaliza, superficie que no es de la lista).
 * Lo comparten la resolución y la configuración pública para que ninguna se olvide de filtrar.
 */
export function pedidoServible(
  host: string,
  superficie: SuperficieDeHost,
): Readonly<{ host: Host; superficie: SuperficieDeDominio }> | null {
  const normalizado = normalizarHost(host);
  if (!normalizado.ok) return null;
  // Una superficie que no es una de la lista (un llamador sin tipos) tampoco sirve nada.
  const conocida = SUPERFICIES_DE_DOMINIO.find((s) => s === superficie);
  return conocida === undefined ? null : { host: normalizado.valor, superficie: conocida };
}

/**
 * `ResolucionDeHost` sobre la puerta pública (marcas y planes, §B.2): la entrada de la página neutra.
 *
 *  - Un host que no normaliza (`normalizarHost`: IP, puerto fuera de rango, no ASCII, etiquetas largas…)
 *    responde `ok(null)` SIN tocar la base: igual que uno desconocido, y sin consulta que se note.
 *  - Todo lo demás es UNA consulta (`LecturaPublicaDeMarcas.resolverHost`) que devuelve el host o nada:
 *    el motivo por el que no se sirve no sale de acá (sin oráculo).
 *  - No guarda nada entre llamadas. Cachear la respuesta (hasta 60 s por instancia, §B.2.3) es decisión
 *    de la puerta web (M9), que además tiene que cachear también el `null`.
 *  - Un fallo de la base vuelve como `err`, nunca como `ok(null)` ni como la marca principal.
 */
export function crearResolucionDeHost(
  transacciones: TransaccionesPublicas<TxPublica>,
): ResolucionDeHost {
  return {
    async porHost(host, superficie) {
      const pedido = pedidoServible(host, superficie);
      if (pedido === null) return ok(null);
      return transacciones.leer((tx) => tx.marcas.resolverHost(pedido.host, pedido.superficie));
    },
  };
}
