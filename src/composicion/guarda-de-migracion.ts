import { MIGRACIONES_ESPERADAS } from "./migraciones-esperadas";
import { tipoDeFalla } from "./tipo-de-falla";
import { verificacionMemorizada } from "./verificacion-memorizada";

/**
 * La guarda en ejecución de las migraciones (web-armazon §5.7, P-15). La compilación de Vercel NUNCA migra: las
 * aplica a mano el workflow `migrar.yml`, con la aprobación del dueño. Si alguien despliega código que usa
 * una migración que todavía no se aplicó, la guarda lo nota al primer pedido de cada instancia y la app
 * responde «En mantenimiento» (503, con una referencia) en vez de fallar a mitad de una factura.
 *
 *  - `MIGRACIONES_ESPERADAS` (`migraciones-esperadas.ts`): los nombres de TODAS las migraciones que este código
 *    necesita. Una prueba la mantiene igual a la carpeta `migraciones/`, así que olvidarse de agregar una rompe el
 *    CI (si no, la guarda dejaría pasar código sin su esquema). `MIGRACION_REQUERIDA` es el número de la última.
 *  - Se lee la lista de nombres de la tabla `migracion` y se exige que figuren TODAS las esperadas (no solo la
 *    última: una base con la última pero sin una del medio no está al día). Los números tienen huecos, así que no
 *    se exige que sean seguidos; las migraciones de más (de un código más nuevo) no molestan.
 *  - Un «al día» se memoriza para siempre en la instancia (las migraciones solo avanzan); un «no» se vuelve a
 *    mirar pasados unos segundos, para que la app vuelva sola apenas el dueño migra.
 *  - Falla cerrado: no poder leer la tabla (sin conexión, sin permiso, sin tabla) es «no al día».
 */
/** Cuánto se espera antes de volver a mirar una base que no estaba al día. */
export const ESPERA_ENTRE_VERIFICACIONES_EN_MS = 10_000;

const NUMERO_DE_MIGRACION = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** Cuántos nombres faltantes se nombran en el informe (el resto se cuenta). */
const FALTANTES_QUE_SE_NOMBRAN = 5;

/**
 * Valida la lista esperada (un defecto del código, no de la base, así que lanza): no vacía, con la forma de los
 * nombres de migración, sin repetidos y en orden. Devuelve el número de cuatro cifras de la última.
 */
function numeroDeLaUltima(esperadas: readonly string[]): string {
  const ultima = esperadas.at(-1);
  if (ultima === undefined) throw new RangeError("la lista de migraciones esperadas está vacía");
  if (esperadas.some((nombre) => !NUMERO_DE_MIGRACION.test(nombre))) {
    throw new RangeError("la lista de migraciones esperadas trae un nombre que no es de migración");
  }
  // Estrictamente creciente: sin repetidas y en orden (los nombres empiezan con el número de cuatro cifras).
  if (esperadas.slice(1).some((nombre, i) => nombre <= (esperadas[i] as string))) {
    throw new RangeError("la lista de migraciones esperadas tiene repetidas o está desordenada");
  }
  return ultima.slice(0, 4);
}

/** El número de la ÚLTIMA migración que este código necesita (se sube agregando su nombre a la lista). */
export const MIGRACION_REQUERIDA: string = numeroDeLaUltima(MIGRACIONES_ESPERADAS);

/**
 * Las migraciones esperadas que NO figuran entre las aplicadas, en el orden de la lista. Se compara por nombre
 * completo: lo que no tiene la forma exacta no cuenta. Lista vacía = todo se espera y nada está: no al día.
 */
export function migracionesFaltantes(
  aplicadas: readonly string[],
  esperadas: readonly string[],
): string[] {
  const presentes = new Set(aplicadas);
  return esperadas.filter((nombre) => !presentes.has(nombre));
}

export type ConfiguracionDeLaGuarda = Readonly<{
  /** Lee los nombres de las migraciones aplicadas (todas las filas de `migracion`). Lanza si no puede. */
  leerAplicadas: () => Promise<readonly string[]>;
  ahora: () => number;
  /** Se informa (para el registro del servidor, sin secretos) por qué no está al día. */
  alNoEstarAlDia: (detalle: string) => void;
  /** Por defecto, `MIGRACIONES_ESPERADAS`. Se inyecta en las pruebas. */
  esperadas?: readonly string[];
  esperaEnMs?: number;
}>;

/** La función que se llama en cada pedido: `true` si la base tiene la migración que el código necesita. */
export function crearGuardaDeMigracion(
  configuracion: ConfiguracionDeLaGuarda,
): () => Promise<boolean> {
  const esperadas = configuracion.esperadas ?? MIGRACIONES_ESPERADAS;
  const requerida = numeroDeLaUltima(esperadas);
  const verificar = async (): Promise<boolean> => {
    let aplicadas: readonly string[];
    try {
      aplicadas = await configuracion.leerAplicadas();
    } catch (error) {
      configuracion.alNoEstarAlDia(
        `no se pudieron leer las migraciones aplicadas: ${tipoDeFalla(error)}`,
      );
      return false;
    }
    const faltantes = migracionesFaltantes(aplicadas, esperadas);
    if (faltantes.length === 0) return true;
    const nombradas = faltantes.slice(0, FALTANTES_QUE_SE_NOMBRAN).join(", ");
    const resto = faltantes.length - FALTANTES_QUE_SE_NOMBRAN;
    configuracion.alNoEstarAlDia(
      `a la base le faltan migraciones (el código necesita hasta la ${requerida}): ${nombradas}` +
        (resto > 0 ? ` y ${String(resto)} más` : ""),
    );
    return false;
  };
  return verificacionMemorizada({
    verificar,
    ahora: configuracion.ahora,
    vigenciaDelSiEnMs: Infinity,
    vigenciaDelNoEnMs: configuracion.esperaEnMs ?? ESPERA_ENTRE_VERIFICACIONES_EN_MS,
  });
}
