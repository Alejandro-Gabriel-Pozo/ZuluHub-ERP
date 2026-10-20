import { registerHooks } from "node:module";

/**
 * Deja que Node cargue `src/` tal como lo escribe el proyecto: los imports sin extensión (`"../x/y"`) se
 * resuelven al `.ts` o al `index.ts` que corresponda. Los scripts de la puerta de plataforma arman la
 * composición completa (cientos de archivos con imports sin extensión), y los scripts de migración, que
 * importan unos pocos archivos escritos con `.ts` a propósito, no la necesitan.
 *
 * Se usa con `node --import ./scripts/cargador-de-ts.mjs --experimental-transform-types`. Sin dependencias
 * nuevas: son los ganchos de resolución de Node (`module.registerHooks`). Solo toca imports relativos que
 * fallan por no encontrar el archivo; nada más cambia.
 */
registerHooks({
  resolve(especificador, contexto, siguiente) {
    try {
      return siguiente(especificador, contexto);
    } catch (error) {
      const codigo = error instanceof Error ? error.code : undefined;
      const noEncontrado =
        codigo === "ERR_MODULE_NOT_FOUND" || codigo === "ERR_UNSUPPORTED_DIR_IMPORT";
      if (noEncontrado && /^\.{1,2}\//.test(especificador)) {
        for (const sufijo of [".ts", "/index.ts"]) {
          try {
            return siguiente(especificador + sufijo, contexto);
          } catch {
            // Se prueba el siguiente sufijo; si ninguno sirve, vale el error original.
          }
        }
      }
      throw error;
    }
  },
});
