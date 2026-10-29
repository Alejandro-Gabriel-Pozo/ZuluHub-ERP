import { tipoDeFalla } from "./tipo-de-falla";
import { verificacionMemorizada } from "./verificacion-memorizada";

/**
 * La guarda en ejecución de las migraciones (web-armazon §5.7, P-15). La compilación de Vercel NUNCA migra: las
 * aplica a mano el workflow `migrar.yml`, con la aprobación del dueño. Si alguien despliega código que usa
 * una migración que todavía no se aplicó, la guarda lo nota al primer pedido de cada instancia y la app
 * responde «En mantenimiento» (503, con una referencia) en vez de fallar a mitad de una factura.
 *
 *  - `MIGRACION_REQUERIDA`: el número de la ÚLTIMA migración que este código necesita. Se sube en el mismo
 *    cambio que agrega la migración; una prueba la mantiene igual al número del último archivo de
 *    `migraciones/`, así que olvidarla rompe el CI (si no, la guarda dejaría pasar código sin su esquema).
 *  - Se compara con la última fila de la tabla `migracion` (`ORDER BY nombre DESC`): los nombres empiezan con
 *    el número de cuatro cifras y se aplican en orden, así que la última fila es la más nueva.
 *  - Un «al día» se memoriza para siempre en la instancia (las migraciones solo avanzan); un «no» se vuelve a
 *    mirar pasados unos segundos, para que la app vuelva sola apenas el dueño migra.
 *  - Falla cerrado: no poder leer la tabla (sin conexión, sin permiso, sin tabla) es «no al día».
 */
export const MIGRACION_REQUERIDA = "0017";

/** Cuánto se espera antes de volver a mirar una base que no estaba al día. */
export const ESPERA_ENTRE_VERIFICACIONES_EN_MS = 10_000;

const FORMA_DE_NUMERO = /^\d{4}$/;
const NUMERO_DE_MIGRACION = /^(\d{4})_[a-z0-9_]+\.sql$/;

/**
 * ¿La base está al menos en la migración requerida? `ultimaAplicada` es el nombre del último registro
 * (`0012_respaldo.sql`) o `null` si no hay ninguno. Un nombre que no tiene la forma de una migración no
 * cuenta: ante la duda, no está al día.
 */
export function migracionAlDia(ultimaAplicada: string | null, requerida: string): boolean {
  if (!FORMA_DE_NUMERO.test(requerida)) {
    throw new RangeError("la migración requerida es un número de cuatro cifras");
  }
  // `null` se lee como el texto «null», que no tiene la forma de una migración. Sin número, el texto vacío queda
  // por debajo de cualquier requerida (que tiene cuatro cifras), así que «no al día».
  const numero = NUMERO_DE_MIGRACION.exec(String(ultimaAplicada))?.[1] ?? "";
  // Cuatro cifras en los dos lados: el orden de los textos es el orden de los números.
  return numero >= requerida;
}

export type ConfiguracionDeLaGuarda = Readonly<{
  /** Lee el nombre de la última migración aplicada (o `null`). Lanza si no puede. */
  leerUltima: () => Promise<string | null>;
  ahora: () => number;
  /** Se informa (para el registro del servidor, sin secretos) por qué no está al día. */
  alNoEstarAlDia: (detalle: string) => void;
  requerida?: string;
  esperaEnMs?: number;
}>;

/** La función que se llama en cada pedido: `true` si la base tiene la migración que el código necesita. */
export function crearGuardaDeMigracion(
  configuracion: ConfiguracionDeLaGuarda,
): () => Promise<boolean> {
  const requerida = configuracion.requerida ?? MIGRACION_REQUERIDA;
  const verificar = async (): Promise<boolean> => {
    let ultima: string | null;
    try {
      ultima = await configuracion.leerUltima();
    } catch (error) {
      configuracion.alNoEstarAlDia(
        `no se pudo leer la última migración aplicada: ${tipoDeFalla(error)}`,
      );
      return false;
    }
    if (migracionAlDia(ultima, requerida)) return true;
    configuracion.alNoEstarAlDia(
      `la base está en ${ultima ?? "ninguna migración"} y el código necesita la ${requerida}`,
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
