import {
  decidirMarcaDeMail,
  type LecturaDeMarcaParaMail,
  type RespaldoDeMail,
} from "../../modulos/marcas/publico";
import type { MarcasDeMail } from "../../puertos/marcas";

/**
 * `MarcasDeMail` sobre la lectura de marcas de la aplicación (marcas y planes, §B.10). Lee con la MISMA
 * conexión de la transacción del caso de uso, dentro de la puerta de la aplicación (rol `pedernal_app`):
 * el tenant se ve solo si es el del contexto, y de su marca solo las versiones confirmadas y vigentes y
 * el dominio canónico activo. No guarda nada entre llamadas.
 *
 * `respaldo` es el nombre y el origen de las variables de entorno de antes de las marcas
 * (`PEDERNAL_NOMBRE_DE_MARCA`, `PEDERNAL_URL_BASE`, ya validadas por `leerConfiguracionDeCorreo`): solo la
 * marca principal puede caer en él. Un tenant que no se ve devuelve `null`, igual que un producto sin
 * identidad propia: quien manda el mail no lo manda con el nombre ni el dominio de otra marca.
 */
export function crearMarcasDeMail(
  lectura: LecturaDeMarcaParaMail,
  respaldo: RespaldoDeMail,
): MarcasDeMail {
  return {
    async delTenant(tenantId, ahora) {
      const datos = await lectura.delTenant(tenantId, ahora);
      return datos === null ? null : decidirMarcaDeMail(datos, respaldo);
    },
  };
}
