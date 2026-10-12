import { marcaComercialId } from "../../src/primitivas/identificadores/marca";

/**
 * Las marcas de las PRUEBAS. La marca principal es la puerta por defecto de todo contexto operativo que
 * arma una prueba (`comoEmpresa`): así las pruebas que no hablan de marcas siguen entrando por la
 * puerta del tenant. Este valor por defecto vive SOLO acá: en el código de producción la marca de
 * entrada la resuelve el servidor a partir del host y nunca se supone (marcas y planes, §E.2).
 *
 * Son identificadores fijos con forma de UUID. Cuando exista la tabla `marca` (migración 0007), la base
 * de pruebas tendrá que sembrar la principal con este id (o el ayudante leerlo de la base): lo resuelve
 * el tramo que construye la persistencia, no este.
 */
export const MARCA_PRINCIPAL_DE_PRUEBA = marcaComercialId("00000000-0000-4000-8000-0000000000a1");

/** Una segunda marca (un producto), para las pruebas de aislamiento entre marcas. */
export const OTRA_MARCA_DE_PRUEBA = marcaComercialId("00000000-0000-4000-8000-0000000000a2");
