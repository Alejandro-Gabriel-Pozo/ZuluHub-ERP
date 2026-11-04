import { timingSafeEqual } from "node:crypto";
import {
  parsearClaveMaestra,
  PEDERNAL_CLAVE_CERTIFICADOS,
  type ClaveMaestra,
} from "../adaptadores/cifrado/aes-gcm";
import {
  CARACTERES_DISTINTOS_MINIMOS,
  caracteresDistintos,
} from "../adaptadores/autenticacion/configuracion";
import {
  leerClaveDeContexto,
  PEDERNAL_CLAVE_CONTEXTO,
} from "../adaptadores/postgres/contexto-firmado";
import { ErrorDeConfiguracion } from "../adaptadores/postgres/errores";

/**
 * La clave que cifra las claves privadas de los certificados de ARCA y sus tickets: además de tener la forma
 * `<kid>:<64 hexadecimales>` (`parsearClaveMaestra`), tiene que servir de verdad como secreto.
 *
 *  - Con la variedad mínima de caracteres que se le pide al resto de los secretos (`CARACTERES_DISTINTOS_MINIMOS`, el
 *    mismo piso que el secreto del cron): un `000…0` tiene la forma pero no protege nada.
 *  - Distinta de `PEDERNAL_CLAVE_CONTEXTO`: esa se instala en la base (`contexto_clave`), así que con los mismos bytes
 *    quien lee esa tabla descifraría las claves de ARCA y el cifrado en reposo no serviría.
 *
 * Los mensajes nombran la variable y el motivo; nunca el valor recibido ni su largo.
 */
export function leerClaveDeCertificados(
  valor: string | undefined,
  claveDeContexto: string | undefined,
): ClaveMaestra {
  const maestra = parsearClaveMaestra(valor ?? "");
  if (caracteresDistintos(maestra.clave.toString("hex")) < CARACTERES_DISTINTOS_MINIMOS) {
    throw new ErrorDeConfiguracion(
      `${PEDERNAL_CLAVE_CERTIFICADOS} inválida: tiene muy poca variedad de caracteres`,
    );
  }
  const { secreto } = leerClaveDeContexto(claveDeContexto);
  if (secreto.length === maestra.clave.length && timingSafeEqual(secreto, maestra.clave)) {
    throw new ErrorDeConfiguracion(
      `${PEDERNAL_CLAVE_CERTIFICADOS} inválida: no puede ser la misma clave que ${PEDERNAL_CLAVE_CONTEXTO}`,
    );
  }
  return maestra;
}
