import type { CodigoFiscal } from "../capacidades/experiencia/respuesta-fiscal";

/**
 * Los errores de Ingresos Brutos (D-115/D-116: el número de inscripción o «No contribuyente») y el campo que cada uno marca. Viven acá
 * porque `errores-fiscales.ts` está en el tope de tamaño (400 líneas). Ninguno trae texto nuevo:
 *  - al guardar, un valor mal puesto es el error de datos de Datos fiscales (D-67, «Revisá los datos marcados.») con su campo;
 *  - emitir con una versión vigente que no declara ninguno de los dos usa el texto ya aprobado de «faltan los datos fiscales confirmados».
 * Previene: que un error de Ingresos Brutos salga como defecto (sin saber qué corregir) o con un texto que el dueño no aprobó.
 * Chequeo: `errores-fiscales.test.ts`.
 */
export const ERRORES_DE_IIBB = {
  IIBB_NUMERO_INVALIDO: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  IIBB_CONDICION_INVALIDA: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  INGRESOS_BRUTOS_SIN_DECLARAR: "FISCAL_SIN_DATOS_FISCALES",
} as const satisfies Readonly<Record<string, CodigoFiscal>>;

/** El campo del formulario que marca cada error al guardar. */
export const CAMPOS_DE_IIBB = {
  IIBB_NUMERO_INVALIDO: "iibbNumero",
  IIBB_CONDICION_INVALIDA: "iibbCondicion",
} as const;
