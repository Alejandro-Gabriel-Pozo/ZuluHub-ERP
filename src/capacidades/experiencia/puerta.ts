/**
 * Puerta mínima de la web (W0). Decide qué hace `apps/web/proxy.ts` con un pedido, sin tocar Next: es
 * una función pura de los encabezados, así que se prueba (y se muta) sin levantar nada. En este tramo
 * NO se resuelve la marca: todo host cae en la página neutra (falla cerrado). W4 la reemplaza por la
 * resolución real del host sin cambiar lo que ya se garantiza acá:
 *  - los encabezados internos `x-zh-*` que manda el cliente se descartan siempre (solo la puerta los
 *    pone; si pasaran, un cliente podría fingir una marca o una superficie);
 *  - la identidad del pedido es el `host` y nunca `X-Forwarded-Host` (que un cliente puede inventar);
 *  - toda respuesta de la puerta sale con `X-Robots-Tag: noindex`.
 */

/** Prefijo de los encabezados que solo pone la puerta. En minúsculas: `Headers` normaliza los nombres. */
export const PREFIJO_DE_ENCABEZADO_INTERNO = "x-zh-";

/** Ruta interna de la página neutra. Nadie entra por URL directa: la puerta reescribe hacia ella. */
export const RUTA_NEUTRA = "/s/neutra";

/** Lo que se agrega a toda respuesta de la puerta. */
export const ENCABEZADOS_DE_RESPUESTA = Object.freeze({ "X-Robots-Tag": "noindex" });

export type DecisionDePuerta = Readonly<{
  /** El `host` normalizado (minúsculas, sin puerto ni punto final); vacío si no vino. */
  host: string;
  /** A dónde se reescribe el pedido. Hoy siempre la neutra. */
  rutaInterna: typeof RUTA_NEUTRA;
  /** Los encabezados del pedido que sigue su camino: sin ningún `x-zh-*`. */
  encabezadosDePedido: Headers;
  /** Los encabezados que se suman a la respuesta. */
  encabezadosDeRespuesta: Readonly<Record<string, string>>;
}>;

/** Minúsculas, sin puerto (también el de una IPv6 entre corchetes) y sin punto final. */
export function normalizarHost(crudo: string | null | undefined): string {
  const host = (crudo ?? "").trim().toLowerCase();
  const sinPuerto = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.replace(/:\d*$/, "");
  return sinPuerto.replace(/\.+$/, "");
}

/** Copia los encabezados sin ninguno interno. No modifica el original. */
export function sinEncabezadosInternos(entrantes: Headers): Headers {
  const limpios = new Headers();
  entrantes.forEach((valor, nombre) => {
    if (!nombre.startsWith(PREFIJO_DE_ENCABEZADO_INTERNO)) limpios.append(nombre, valor);
  });
  return limpios;
}

export function decidirPuerta(entrantes: Headers): DecisionDePuerta {
  return {
    host: normalizarHost(entrantes.get("host")),
    rutaInterna: RUTA_NEUTRA,
    encabezadosDePedido: sinEncabezadosInternos(entrantes),
    encabezadosDeRespuesta: ENCABEZADOS_DE_RESPUESTA,
  };
}
