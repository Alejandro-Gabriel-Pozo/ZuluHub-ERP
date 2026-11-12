import { codigoDeCartaDesdeTexto } from "../../primitivas/texto/datos-de-carta-publica";
import {
  armarVidrieraPublicada,
  crearLecturaPublicaDeCartas,
  type LecturaPublicaDeCartas,
} from "../../modulos/catalogo/publico";
import { crearLecturaPublicaDeMarcas, type PublicoDb } from "../../modulos/marcas/publico";
import type { Kysely } from "kysely";
import type { TxPublica } from "./resolucion-de-host";
import type { SinTablas } from "./transacciones";
import type { TransaccionesPublicas } from "../../puertos/transacciones-publicas";
import type { VidrieraPublica } from "../../puertos/vidriera-publica";

/** Lo que recibe el trabajo de una transacción pública de la carta: la lectura del catálogo para el comensal (0044). */
export type TxPublicaDeCarta = Readonly<{ cartas: LecturaPublicaDeCartas }>;

/** Todo lo que lee la puerta pública: marcas (resolución de host) y cartas. */
export type TxPublicaCompleta = TxPublica & TxPublicaDeCarta;

export const armarTxPublica = (db: Kysely<SinTablas>): TxPublicaCompleta => ({
  marcas: crearLecturaPublicaDeMarcas(db.withTables<PublicoDb>()),
  cartas: crearLecturaPublicaDeCartas(db),
});

/**
 * `VidrieraPublica` sobre la puerta pública (carta real §4): la carta de un código DENTRO DE UNA MARCA, con datos REALES de la empresa.
 *
 *  - Un código que no tiene la forma de un código de carta responde `null` SIN tocar la base (igual que uno inexistente).
 *  - Todo lo demás es UNA transacción de solo lectura con una sola foto (`LecturaPublicaDeCartas`): la visita ve la carta ENTERA de antes o ENTERA de después de
 *    un cambio, nunca a medias. La marca es la del host de la puerta (nunca un dato del cliente).
 *  - `null` es la ÚNICA respuesta para todo lo que no se sirve (código inexistente, de otra marca, carta retirada, sucursal cerrada, empresa que no opera): no
 *    hay oráculo. Un fallo de la base NO es `null`: se lanza (una caída no se disfraza de «no disponible»).
 *  - La hora es la del reloj de la composición, no `now()` de la base: el precio vigente depende de ella.
 */
export function crearVidrieraPublica(
  transacciones: TransaccionesPublicas<TxPublicaDeCarta>,
  reloj: Readonly<{ ahora(): Date }>,
): VidrieraPublica {
  return {
    async porCodigo(marcaId, codigo) {
      if (!codigoDeCartaDesdeTexto(codigo).ok) return null;
      const ahora = reloj.ahora();
      const leida = await transacciones.leer((tx) => tx.cartas.porCodigo(codigo, ahora));
      if (!leida.ok) throw new Error(`no se pudo leer la carta pública: ${leida.error.tipo}`);
      return leida.valor === null ? null : armarVidrieraPublicada(leida.valor, marcaId);
    },
  };
}
