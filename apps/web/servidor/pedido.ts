import "server-only";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { esIndexable, esNonceValido } from "../../../src/capacidades/experiencia/cabeceras";
import {
  ENCABEZADO_DE_NONCE,
  hostDelPedido,
  type PuertaResuelta,
  type SuperficieServible,
} from "../../../src/capacidades/experiencia/puerta";
import { despliegueEsProduccion, resolverPuerta } from "./puerta";

/**
 * La puerta vista desde una página, un layout o una acción: resuelve el host del pedido OTRA VEZ (no se
 * confía en lo que decidió `proxy.ts`) y, si no es la superficie que se esperaba, responde como si la
 * página no existiera. `notFound()` desde un layout cae en la neutra de la raíz (`app/not-found.tsx`).
 */
export async function exigirPuerta(superficie: SuperficieServible): Promise<PuertaResuelta> {
  const estado = await resolverPuerta(hostDelPedido(await headers()));
  if (estado.tipo !== "RESUELTA" || estado.puerta.superficie !== superficie) notFound();
  return estado.puerta;
}

/** El nonce que puso la puerta para este pedido; `null` si no vino o no tiene la forma de un nonce. */
export async function nonceDelPedido(): Promise<string | null> {
  const nonce = (await headers()).get(ENCABEZADO_DE_NONCE);
  return nonce !== null && esNonceValido(nonce) ? nonce : null;
}

/** El `robots` de la etiqueta `<meta>` (respaldo del encabezado `X-Robots-Tag` de la puerta). */
export function robotsDe(superficie: SuperficieServible): NonNullable<Metadata["robots"]> {
  const indexa = esIndexable(superficie, despliegueEsProduccion());
  return { index: indexa, follow: indexa };
}
