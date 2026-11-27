import { randomInt, randomBytes } from "node:crypto";
import {
  PEDERNAL_CLAVE_CONTEXTO,
  instalarClaveDeContexto,
  leerClaveDeContexto,
} from "../src/adaptadores/postgres/contexto-firmado";
import {
  describirFallaDeBase,
  ocultarSecretos,
} from "../src/adaptadores/postgres/describir-falla-de-base";
import {
  abrirLoginDePlataforma,
  cerrarLoginDePlataforma,
} from "../src/adaptadores/postgres/login-temporal-de-plataforma";
import { PEDERNAL_DB_PLATAFORMA } from "../src/composicion/entorno-de-plataforma";
import { VARIABLE_DE_LA_CADENA } from "./ejecutar-crear-primer-admin";
import { leerCadenaDeDueno } from "./ejecutar-instalar-clave";

/**
 * Lo que hacen los dos pasos de `scripts/login-temporal-de-plataforma.ts` en el flujo «Preparar la empresa de pruebas»:
 *
 *  - `abrir`: (1) instala en la base una clave de contexto PROPIA de esta corrida (kid al azar, secreto al azar, solo en
 *    memoria del runner: queda VIGENTE en la tabla `contexto_clave` pero nadie la conoce ni se guarda), (2) abre el login
 *    del rol `pedernal_plataforma` con una clave al azar, y (3) entrega al resto de la corrida `PEDERNAL_DB_PLATAFORMA` y
 *    `PEDERNAL_CLAVE_CONTEXTO` por el archivo `GITHUB_ENV`, cada valor enmascarado antes. Fuera de GitHub Actions
 *    no hay `GITHUB_ENV`: no hace nada (cierra).
 *  - `abrir sin-clave-propia` (alta de un CLIENTE con base propia, PRIMER-DESPLIEGUE.md H.4): igual, pero NO instala ninguna clave de contexto en la base (la del cliente ya la instaló `migrar.yml`
 *    y es la que firma, la del Environment: `PEDERNAL_CLAVE_CONTEXTO`) y solo entrega `PEDERNAL_DB_PLATAFORMA` a los pasos siguientes. Previene: dejar en la base de un cliente una clave de contexto
 *    que nadie conoce (la de «Preparar la empresa de pruebas» es solo para preview). Sin una clave válida en el entorno falla antes de abrir nada.
 *  - `cerrar`: deja el rol `NOLOGIN` y sin clave y verifica el estado final; falla fuerte si no quedó cerrado.
 *
 * La cadena del dueño (`PEDERNAL_DB_MIGRACIONES`, directa) es lo único que se necesita. Nada de lo secreto se imprime.
 * Código de salida: 0 bien, 1 falla.
 */

/** El kid de la clave de esta corrida: lejos de los kid chicos que se usan a mano (1, 2…), dentro del `smallint`. */
const KID_MINIMO = 10_000;
const KID_MAXIMO = 32_767;

/** El único modo de abrir además del de preview: el de un cliente con base propia (sin clave de contexto propia de la corrida). */
export const MODO_SIN_CLAVE_PROPIA = "sin-clave-propia";

export type EntradaDeLoginTemporal = Readonly<{
  accion: string | undefined;
  /** Solo con `abrir`: `sin-clave-propia` o nada (el de preview). Cualquier otro texto es un error de uso. */
  modo?: string | undefined;
  entorno: Readonly<Record<string, string | undefined>>;
  info: (linea: string) => void;
  error: (linea: string) => void;
  /** Una línea tal cual, sin tapar (`::add-mask::`). */
  comando: (linea: string) => void;
  /** Agrega texto al archivo `GITHUB_ENV`. */
  agregarAlEntorno: (ruta: string, texto: string) => Promise<void>;
  abrir?: typeof abrirLoginDePlataforma;
  cerrar?: typeof cerrarLoginDePlataforma;
  instalarClave?: typeof instalarClaveDeContexto;
  bytesAlAzar?: (cuantos: number) => Buffer;
  kidAlAzar?: () => number;
}>;

export async function ejecutarLoginTemporal(entrada: EntradaDeLoginTemporal): Promise<number> {
  const { entorno } = entrada;
  const cadenaCruda = entorno[VARIABLE_DE_LA_CADENA]?.trim();
  const tapados: Array<string | undefined> = [cadenaCruda];
  const tapar = (linea: string) =>
    tapados.reduce<string>((texto, secreto) => ocultarSecretos(texto, secreto), linea);
  const info = (linea: string) => entrada.info(tapar(linea));
  const error = (linea: string) => entrada.error(tapar(linea));

  if (entrada.accion !== "abrir" && entrada.accion !== "cerrar") {
    error("uso: login-temporal-de-plataforma <abrir [sin-clave-propia]|cerrar>");
    return 1;
  }
  if (
    entrada.modo !== undefined &&
    !(entrada.accion === "abrir" && entrada.modo === MODO_SIN_CLAVE_PROPIA)
  ) {
    error("uso: login-temporal-de-plataforma <abrir [sin-clave-propia]|cerrar>");
    return 1;
  }
  const revisada = leerCadenaDeDueno(cadenaCruda);
  if ("problema" in revisada) {
    error(`ERROR: ${revisada.problema}`);
    return 1;
  }
  const { cadena } = revisada;

  try {
    if (entrada.accion === "cerrar") {
      const estado = await (entrada.cerrar ?? cerrarLoginDePlataforma)(cadena);
      if (estado.conservado === true) {
        info(
          "NO SE CERRÓ: el rol de plataforma tiene el login PERMANENTE de la consola de preview, que este flujo no abrió. No se cambió nada.",
        );
        return 0;
      }
      info(
        estado.claveVerificada
          ? "CERRADO: el rol de plataforma quedó sin login y sin clave (verificado)."
          : "CERRADO: el rol de plataforma quedó sin login (verificado). Su clave se dejó en NULL; este rol de conexión no puede mirarla.",
      );
      return 0;
    }

    const archivo = entorno["GITHUB_ENV"];
    if (entorno["GITHUB_ACTIONS"] !== "true" || archivo === undefined || archivo === "") {
      error(
        "ERROR: este paso solo corre dentro de GitHub Actions (necesita GITHUB_ENV). No se hizo nada.",
      );
      return 1;
    }
    if (entrada.modo === MODO_SIN_CLAVE_PROPIA) {
      // La clave que firma es la del cliente (ya instalada en su base): tiene que venir del Environment y servir; nada se instala.
      const delCliente = entorno[PEDERNAL_CLAVE_CONTEXTO]?.trim() ?? "";
      tapados.push(delCliente, delCliente.split(":")[1]);
      try {
        leerClaveDeContexto(delCliente);
      } catch {
        error(
          `ERROR: falta ${PEDERNAL_CLAVE_CONTEXTO} del cliente o no tiene la forma <kid>:<64 hexadecimales>. No se abrió nada.`,
        );
        return 1;
      }
      const loginDelCliente = await (entrada.abrir ?? abrirLoginDePlataforma)(cadena);
      for (const secreto of [loginDelCliente.clave, loginDelCliente.cadena]) {
        tapados.push(secreto);
        entrada.comando(`::add-mask::${secreto}`);
      }
      await entrada.agregarAlEntorno(
        archivo,
        `${PEDERNAL_DB_PLATAFORMA}=${loginDelCliente.cadena}\n`,
      );
      info(
        "ABIERTO: el rol de plataforma tiene login temporal con una clave de esta corrida. No se instaló ninguna clave de contexto: firma la del cliente. El cierre es obligatorio.",
      );
      return 0;
    }
    const bytes = entrada.bytesAlAzar ?? ((n: number) => randomBytes(n));
    const kid = (entrada.kidAlAzar ?? (() => randomInt(KID_MINIMO, KID_MAXIMO + 1)))();
    const secretoHex = bytes(32).toString("hex");
    const claveDeContexto = `${kid}:${secretoHex}`;
    for (const secreto of [secretoHex, claveDeContexto]) {
      tapados.push(secreto);
      entrada.comando(`::add-mask::${secreto}`);
    }
    // (1) La clave de contexto de la corrida, instalada con la conexión del dueño.
    await (entrada.instalarClave ?? instalarClaveDeContexto)(
      cadena,
      leerClaveDeContexto(claveDeContexto),
    );
    // (2) El login del rol de plataforma.
    const login = await (entrada.abrir ?? abrirLoginDePlataforma)(cadena);
    for (const secreto of [login.clave, login.cadena]) {
      tapados.push(secreto);
      entrada.comando(`::add-mask::${secreto}`);
    }
    // (3) A los pasos siguientes, por el archivo del entorno de la corrida (ya enmascarados).
    await entrada.agregarAlEntorno(
      archivo,
      `${PEDERNAL_DB_PLATAFORMA}=${login.cadena}\n${PEDERNAL_CLAVE_CONTEXTO}=${claveDeContexto}\n`,
    );
    info(
      "ABIERTO: el rol de plataforma tiene login temporal con una clave de esta corrida, y la base tiene una clave de contexto propia (kid de 5 dígitos, vigente; nadie la conoce). El cierre es obligatorio.",
    );
    return 0;
  } catch (falla) {
    error(`ERROR: ${describirFallaDeBase(falla, cadena)}`);
    return 1;
  }
}
