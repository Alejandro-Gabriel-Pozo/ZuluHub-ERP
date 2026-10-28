/**
 * Códigos de falla y de aviso del control de deuda técnica: la lista CERRADA (contratos-arquitectonicos.md §10).
 *
 * Toda falla y todo aviso de `deuda.cjs` lleva uno de estos códigos, archivo y una línea entera desde 1 (M3):
 * la autocomprobación de `deuda.cjs` reemplaza lo que no cumple por una falla propia. Los códigos `excepcion-*`
 * y los dos de la autocomprobación son los MISMOS del guardián (`../contratos/codigos.cjs`): una excepción de
 * deuda se valida con el mismo control que las excepciones del guardián (`problemasComunes`, ≤ 60 días).
 * Agregar un chequeo exige: sumarlo acá (con su regla de línea), un invariante con mutaciones en la matriz
 * (`../contratos/invariantes.cjs`, I12) y sus pruebas en `test/arquitectura/guardian-deuda-*.test.ts`.
 */

/**
 * Los códigos con los que el control puede FALLAR, en el orden del informe. Cada uno dice qué comprueba y dónde
 * cae su línea (M3: toda falla trae archivo y una línea entera desde 1).
 */
const CODIGOS_DE_FALLA = Object.freeze([
  // todo marcador de deuda tiene una entrada en el registro (deuda sin registrar falla).
  //   Línea: la línea del marcador, en su archivo.
  "deuda-sin-registrar",
  // el registro es una lista y cada entrada trae sus campos, con la forma correcta.
  //   Línea: registro.json: la clave ofensora, o la entrada si falta el campo; JSON inválido: la línea del error.
  "deuda-entrada-invalida",
  // los archivos de una entrada son archivos versionados.
  //   Línea: registro.json: la línea de "archivos" de la entrada.
  "deuda-archivo-inexistente",
  // configuracion.json trae el tope de excepciones y la opción de bloqueo con su forma.
  //   Línea: configuracion.json: la clave ofensora; JSON inválido: la línea del error.
  "deuda-configuracion-invalida",
  // no hay más excepciones abiertas que el tope configurado.
  //   Línea: registro.json: la línea del "id" de la primera excepción que sobra.
  "deuda-tope-de-excepciones",
  // todo archivo que el detector debe analizar se puede leer (y los de datos son JSON válido).
  //   Línea: el archivo ofensor: la línea del error, o 1 si no se pudo leer.
  "deuda-archivo-ilegible",
  // un archivo que el cambio toca no conserva la deuda que ya tenía (se paga o lleva excepción).
  //   Línea: la línea del primer marcador que queda, en su archivo.
  "deuda-en-archivo-tocado",
  // un marcador o un hallazgo nuevo lleva una excepción vigente.
  //   Línea: la línea del primer marcador nuevo, o del id de la entrada nueva.
  "deuda-nueva-sin-excepcion",
  // el total de marcadores de un archivo no sube sin una excepción vigente.
  //   Línea: la línea del primer marcador de más, en su archivo.
  "deuda-total-sube",
  // un archivo registrado como «archivo-grande» no mide más líneas que las registradas (el trinquete solo baja).
  //   Línea: la primera línea de más (tamaño registrado + 1), en su archivo.
  "deuda-archivo-crece",
  // una entrada del registro no desaparece mientras el problema sigue (se borra pagando).
  //   Línea: la línea del marcador que sigue, en su archivo.
  "deuda-entrada-borrada",
  // las excepciones de deuda traen todos sus campos, sin sobrantes.
  //   Línea: registro.json: la clave ofensora o la entrada si el campo falta.
  "excepcion-invalida",
  // ninguna excepción de deuda está vencida.
  //   Línea: registro.json: la línea de "vence".
  "excepcion-vencida",
  // ninguna excepción de deuda dura más de 60 días (vence - creada).
  //   Línea: registro.json: la línea de "vence".
  "excepcion-plazo-excesivo",
  // el vencimiento de una excepción de deuda no es anterior a su creación.
  //   Línea: registro.json: la línea de "vence".
  "excepcion-vence-antes-de-creada",
  // la fecha de creación de una excepción de deuda no es futura.
  //   Línea: registro.json: la línea de "creada".
  "excepcion-creada-futura",
  // toda excepción de deuda cubre algo que sigue abierto.
  //   Línea: registro.json: la línea del "id" de la excepción.
  "excepcion-obsoleta",
  // toda falla y todo aviso traen archivo y una línea entera desde 1 (M3).
  //   Línea: deuda.cjs (o el archivo ofensor si lo trae), línea 1.
  "falla-sin-ubicacion",
  // todo hallazgo usa un código de esta lista cerrada.
  //   Línea: deuda.cjs (o el archivo ofensor si lo trae), línea 1.
  "codigo-fuera-de-la-lista",
]);

/** Los códigos con los que el control puede AVISAR (no bloquea). */
const CODIGOS_DE_AVISO = Object.freeze([
  "deuda-resuelta",
  "deuda-tamano-desactualizado",
  "deuda-borrada-sin-verificar",
  "deuda-en-archivo-tocado-sin-bloqueo",
  "deuda-base-sin-registro",
  "excepcion-por-vencer",
]);

module.exports = { CODIGOS_DE_FALLA, CODIGOS_DE_AVISO };
