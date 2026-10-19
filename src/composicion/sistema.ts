import { crearGuardaDeMigracion } from "./guarda-de-migracion";
import type { Conexiones } from "./conexiones";
import { perezoso } from "./perezoso";
import { tipoDeFalla } from "./tipo-de-falla";
import { verificacionMemorizada } from "./verificacion-memorizada";

/**
 * Lo que la composición le ofrece a las rutas de sistema de la web (W6): la guarda de migración, la
 * comprobación de salud y el secreto del cron. Todo se arma la primera vez que se pide y entonces valida sus
 * variables: importar esto no lee nada (P-12). El detalle de por qué algo no está bien va a `registrar`
 * (registro del servidor: tipos de falla y códigos de Postgres, sin valores ni datos personales).
 */

/** Cuánto vale una respuesta de salud antes de volver a preguntarle a la base (no se la martilla desde afuera). */
export const VIGENCIA_DE_LA_SALUD_EN_MS = 5_000;

export type OpcionesDeSistema = Readonly<{
  registrar?: (detalle: string) => void;
  /** El reloj en milisegundos; por defecto, el real. Se inyecta en las pruebas. */
  ahora?: () => number;
}>;

export function armarSistema(conexiones: Conexiones, opciones: OpcionesDeSistema = {}) {
  const registrar = opciones.registrar ?? (() => undefined);
  const ahora = opciones.ahora ?? (() => Date.now());
  return {
    secretoDeCron: () => conexiones.secretoDeCron(),
    /** `true` si la base tiene la migración que el código necesita (`MIGRACION_REQUERIDA`). */
    guardaDeMigracion: perezoso(() =>
      crearGuardaDeMigracion({
        leerUltima: () => conexiones.lecturasDeSistema().ultimaMigracion(),
        ahora,
        alNoEstarAlDia: (detalle) => registrar(`[migración] ${detalle}`),
      }),
    ),
    /** `true` si la base responde a `SELECT 1` con el rol de la aplicación. Falla cerrado. */
    baseResponde: perezoso(() =>
      verificacionMemorizada({
        verificar: async () => {
          try {
            await conexiones.lecturasDeSistema().ping();
            return true;
          } catch (error) {
            registrar(`[salud] la base no respondió: ${tipoDeFalla(error)}`);
            return false;
          }
        },
        ahora,
        vigenciaDelSiEnMs: VIGENCIA_DE_LA_SALUD_EN_MS,
        vigenciaDelNoEnMs: VIGENCIA_DE_LA_SALUD_EN_MS,
      }),
    ),
  };
}

export type Sistema = ReturnType<typeof armarSistema>;
