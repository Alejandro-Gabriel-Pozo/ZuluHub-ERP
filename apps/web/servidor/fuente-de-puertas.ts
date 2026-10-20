import "server-only";

import {
  armarFuenteDePuertas,
  type FuenteDePuertas,
} from "../../../src/capacidades/experiencia/fuente-de-puertas";
import { web } from "./composicion";

/**
 * De dónde sale la resolución de un host y la marca que lo atiende: la puerta pública REAL (rol
 * `pedernal_publico`, `PEDERNAL_DB_PUBLICO`), enchufada acá y en ningún otro lugar. No lee ninguna variable:
 * `web.resolucionDeHost()` y `web.configuracionPublicaDeHost()` la validan la primera vez que se usan, y si
 * falta, el pedido falla cerrado (la puerta responde la neutra 503; el NOMBRE de la variable solo va al
 * registro, desde la composición). Mientras el dueño no cargue la cadena, producción muestra la neutra. La
 * lógica (y sus pruebas) está en `src/capacidades/experiencia/fuente-de-puertas.ts`; las pruebas de la web
 * reemplazan este módulo por un falso (`test/utilidades/puertas-falsas.ts`) o lo arman con la base real.
 */
export const fuenteDePuertas: FuenteDePuertas = armarFuenteDePuertas({
  resolucion: () => web.resolucionDeHost(),
  configuracion: () => web.configuracionPublicaDeHost(),
});
