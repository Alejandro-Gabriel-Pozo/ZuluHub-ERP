import { TEXTOS_DE_FISCAL_1 } from "./partes/fiscal-1";
import { TEXTOS_DE_FISCAL_2 } from "./partes/fiscal-2";
import { TEXTOS_DE_FISCAL_3 } from "./partes/fiscal-3";

/**
 * Los textos del facturador (H7 facturación) del catálogo de textos (`catalogo.ts`): los errores de negocio que puede ver la
 * persona al emitir, descartar, reintentar, resincronizar o cambiar el ambiente (`experiencia/respuesta-fiscal.ts`) y lo que
 * ARCA informó de un comprobante, traducido (`fiscal.arca.*`). Castellano neutro, en términos del negocio y sin nada técnico:
 * ningún texto crudo de ARCA llega a la pantalla. Viven en un archivo aparte para que el catálogo no crezca sin tope (cada
 * módulo suma los suyos); `catalogo.ts` los incluye y su prueba (`catalogo.test.ts`) los revisa como a todos.
 */
export const TEXTOS_DE_FISCAL = {
  ...TEXTOS_DE_FISCAL_1,
  ...TEXTOS_DE_FISCAL_2,
  ...TEXTOS_DE_FISCAL_3,
} as const;
