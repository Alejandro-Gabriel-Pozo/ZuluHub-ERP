import { createHash, timingSafeEqual } from "node:crypto";

/**
 * ¿Trae el pedido el secreto del cron? (web-armazon §5.2, `CRON_SECRET`.) Vercel manda
 * `Authorization: Bearer <secreto>` a la ruta del cron si la variable existe en el proyecto (NO VERIFICADO:
 * se mira en el primer despliegue). La ruta es pública en Internet, así que esto es lo único que separa a
 * Vercel de cualquiera que la pida.
 *
 *  - Comparación en tiempo constante: se comparan las huellas SHA-256 de los dos textos (siempre 32 bytes) con
 *    `timingSafeEqual`, así ni el contenido ni el LARGO del secreto se filtran por cuánto tarda la respuesta.
 *    Previene adivinar el secreto de a un carácter midiendo tiempos.
 *  - Falla cerrado: sin cabecera, con otro esquema (`Basic …`, `bearer …`), con el secreto vacío o con
 *    cualquier diferencia, es `false`. Un secreto vacío NO autoriza «Bearer » vacío.
 *  - No lee el entorno ni registra nada: el secreto entra como dato y el valor no sale de acá.
 */
const ESQUEMA = "Bearer ";

const huella = (texto: string): Buffer => createHash("sha256").update(texto, "utf8").digest();

export function autorizadoPorElCron(autorizacion: string | null, secreto: string): boolean {
  if (autorizacion === null || secreto === "") return false;
  if (!autorizacion.startsWith(ESQUEMA)) return false;
  return timingSafeEqual(huella(autorizacion.slice(ESQUEMA.length)), huella(secreto));
}
