import { TEXTOS_DE_FISCAL_EMITIR_1 } from "./partes/fiscal-emitir-1";
import { TEXTOS_DE_FISCAL_EMITIR_2 } from "./partes/fiscal-emitir-2";

/**
 * Los textos de «Emitir una factura» (8B, por pasos; prefijo `fiscal.pantalla.emitir_*`) y el «+ Emitir» del Listado. Viven aparte de
 * `catalogo-fiscal-pantallas.ts` para que ninguno pase del tope de líneas; `catalogo.ts` los incluye y `catalogo.test.ts` los revisa
 * como a todos. Lo que la pantalla ya podía decir con un texto existente NO tiene clave nueva (una regla, un lugar): «Cliente»,
 * «Renglones», «Total», «Punto de venta», «Documento», «Consumidor final», los nombres de los tipos de documento, «Condición frente al
 * IVA», «Siguiente», «Volver», «Enviando…», «IVA {alicuota} %», «Exento», «No gravado», «Pruebas» y su aviso (D-87) y «Ninguno activo».
 * Fuente de esos textos: figuran en PROTO-8B «Cliente», «Renglones», «Total» y «Volver» (el prototipo dibuja solo el paso 3; los textos
 * de los pasos 1 y 2 los cubre D-93); «Verificando si se registró…» es texto ya aprobado (D-93; el del contrato era una propuesta);
 * sin puntos de venta activos se usa «Ninguno activo» (D-64), aprobado por el dueño el 2026-11-03 (pregunta «Sin puntos»), sin texto nuevo.
 * Decisiones del dueño (2026-11-03, D-93 y D-95 de Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`): la sucursal es la del Listado
 * («Sucursal»); el error del servidor se ve en el paso final y se vuelve con «Volver», sin marcar campos («Errores»); «Verificando…» no tiene
 * salida («Verificando»).
 *
 * Una línea de fuente por texto. Siglas (repositorio de documentos (Pedernal-docs), salvo ARCA-016):
 *   PROTO-8B   = artefacto «Facturador: detalle y emitir» (`claude.ai/artifact/JpPY2SLKmaeZddVx6t1BRb`, `project/Emitir.dc.html`), opción B,
 *                aprobada por el dueño: «Si 7C y 8B» (2026-10-14 22:45Z, según el contrato, pantalla 3).
 *   CONTRATO   = `11-especificaciones/facturador-contratos-de-pantalla.md`.
 *   EMITIR-HTML, RECEPTOR-HTML = `10-ux-ui/prototipos-facturador/emitir.html` y `receptor.html`: de donde salen los rótulos (no son el
 *                prototipo 8B; los rótulos los aprobó el dueño: ver D-93).
 *   D-93 / D-95 = filas del CONTRATO (Pedernal-docs), confirmadas por el dueño el 2026-11-03 (D-93) y el 2026-11-04 (D-95); cada texto cita su punto.
 *   ARCA-016   = `test/utilidades/arca-grabaciones/corrida1/016-FEParamGetCondicionIvaReceptor-respuesta-http200.xml` (los textos de la
 *                condición frente al IVA; la misma fuente que D-44 para los del emisor).
 *   SUPUESTO (DEC-0049)   = del ingeniero, sin fuente: el dueño no lo aprobó ni figura en un documento. Va en las preguntas pendientes del PR (hoy ninguno).
 */
export const TEXTOS_DE_FISCAL_EMITIR = {
  ...TEXTOS_DE_FISCAL_EMITIR_1,
  ...TEXTOS_DE_FISCAL_EMITIR_2,
} as const;
