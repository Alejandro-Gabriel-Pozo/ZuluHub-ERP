/**
 * Las reglas de arquitectura de las conexiones salientes (carta §5.7.4, V1c). Viven aparte de `reglas.cjs` porque ese archivo pasa del tope de líneas y no puede
 * crecer (`arquitectura/deuda`): `reglas.cjs` las suma a su lista, así que `.dependency-cruiser.cjs` y las pruebas las ven como cualquier otra.
 * Cada una tiene su violación inyectada en `test/arquitectura/reglas.test.ts`.
 */

/** @type {import("dependency-cruiser").IForbiddenRuleType[]} */
module.exports = [
  {
    // V1c (carta §5.7.4). Previene: una conexión de salida repartida por el producto, cada una con sus propios tiempos, topes y tratamiento de la
    // dirección de destino: la puerta de un pedido a un servidor interno (SSRF: la metadata de la nube, la base, un servicio local) o de un
    // servidor colgado a la espera de un tercero. Solo dos adaptadores abren conexiones: ARCA (host fijo, con su propio transporte) y el traedor de
    // imágenes externas (destino armado desde el catálogo, guarda de red, tope de bytes y de tiempo). Chequeo: las violaciones inyectadas de
    // reglas.test.ts. Límite que NO ve: `fetch` global (no es un import): hoy lo usan el cliente de Vercel (inyectado) y las pantallas hacia su
    // propio servidor; quien sume otro lo verá en la revisión.
    name: "conexiones-salientes-solo-en-adaptadores-de-red",
    severity: "error",
    comment:
      "node:http, node:https, node:http2, node:net, node:tls, node:dgram y node:dns solo se importan en src/adaptadores/arca y src/adaptadores/imagenes-externas: cada conexión saliente lleva sus tiempos, sus topes y su control del destino en un solo lugar.",
    from: {
      path: "^(src|apps|scripts)/",
      // `.next` es la salida compilada de la web (no es código nuestro): trae el transporte de Node del propio Next.
      pathNot: "^src/adaptadores/(arca|imagenes-externas)/|(^|/)\\.next/",
    },
    to: {
      dependencyTypes: ["core"],
      path: "^(node:)?(https?|http2|net|tls|dgram|dns(/promises)?)$",
    },
  },
  {
    // V1c. Previene: resolver nombres por fuera del traedor: quien resuelve y después conecta por su cuenta reabre el reenlace de DNS (el nombre
    // se resuelve a una dirección pública para la guarda y a una interna para la conexión). Resolver es del traedor, que conecta a la dirección
    // ya validada. Chequeo: las violaciones inyectadas de reglas.test.ts.
    name: "dns-solo-en-imagenes-externas",
    severity: "error",
    comment:
      "node:dns solo se importa en src/adaptadores/imagenes-externas: el traedor resuelve el nombre UNA vez, valida todas las direcciones y conecta a la ya validada.",
    from: {
      path: "^(src|apps|scripts)/",
      pathNot: "^src/adaptadores/imagenes-externas/|(^|/)\\.next/",
    },
    to: { dependencyTypes: ["core"], path: "^(node:)?dns(/promises)?$" },
  },
];
