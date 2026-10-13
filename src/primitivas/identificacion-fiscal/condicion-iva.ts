/**
 * Condición frente al IVA (spec H7 facturación §B.3.2; conciliación §3.7). Son los once valores de la
 * tabla «Condición Frente al IVA del receptor» de WSFE v4.8 (l. 5712-5727): los que puede tener cualquier
 * contribuyente que recibe un comprobante, y por eso vive acá y no en `modulos/fiscal`: la guarda también
 * quien lleva el directorio de clientes y proveedores, que no puede importar fiscal. Se guardan los
 * NOMBRES; los códigos de ARCA (1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16) viven en el adaptador de fiscal, con
 * su prueba contra lo que devuelva `FEParamGetCondicionIvaReceptor`.
 *
 * Qué clases de comprobante admite cada una (A, B o C) es regla de facturación y sigue en fiscal. El
 * EMISOR tiene un subconjunto de estas (tres), que fiscal declara en `emisor.ts`. No hay una segunda
 * lista: dos copias de los nombres serían dos CHECK distintos en la base para el mismo dato.
 */
export const CONDICIONES_DE_IVA = [
  "RESPONSABLE_INSCRIPTO",
  "EXENTO",
  "CONSUMIDOR_FINAL",
  "MONOTRIBUTO",
  "NO_CATEGORIZADO",
  "PROVEEDOR_DEL_EXTERIOR",
  "CLIENTE_DEL_EXTERIOR",
  "IVA_LIBERADO_LEY_19640",
  "MONOTRIBUTISTA_SOCIAL",
  "IVA_NO_ALCANZADO",
  "MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO",
] as const;

export type CondicionIva = (typeof CONDICIONES_DE_IVA)[number];

/** Solo los nombres exactos (mayúsculas, guion bajo): ni minúsculas ni espacios ni abreviaturas. */
export function esCondicionIva(texto: string): texto is CondicionIva {
  return (CONDICIONES_DE_IVA as readonly string[]).includes(texto);
}
