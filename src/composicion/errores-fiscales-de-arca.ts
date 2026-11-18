import type { Causa } from "../adaptadores/arca/errores-de-arca";
import type { CodigoFiscal } from "../capacidades/experiencia/respuesta-fiscal";

/**
 * Los errores de ARCA al pasar un punto de venta a producción y la causa de un error de acceso (`ErrorDeEmision["causa"]`), con sus textos
 * aprobados por el dueño el 18/11/2026 (`decisiones-del-dueno-2026-11.md`, filas 305 y 306; DEC-0741). Viven aparte para que `errores-fiscales.ts`
 * no pase del tope de líneas, como los de certificado e ingresos brutos.
 */

/**
 * Por qué ARCA no habilita un punto de venta para pasar a producción (D-77 y la regla de solo CAEA, DEC-0742). Exhaustivo por tipo: un
 * motivo nuevo del caso de uso que nadie tradujo NO COMPILA.
 */
export const ERRORES_AL_PASAR_A_PRODUCCION: Readonly<
  Record<
    | "PUNTO_DE_VENTA_NO_HABILITADO_EN_ARCA"
    | "SIN_PUNTOS_DE_VENTA_EN_ARCA"
    | "PUNTO_DE_VENTA_BLOQUEADO_EN_ARCA"
    | "PUNTO_DE_VENTA_DADO_DE_BAJA_EN_ARCA"
    | "PUNTO_DE_VENTA_SOLO_CAEA_EN_ARCA",
    CodigoFiscal
  >
> = {
  PUNTO_DE_VENTA_NO_HABILITADO_EN_ARCA: "FISCAL_PUNTO_DE_VENTA_NO_HABILITADO_EN_ARCA",
  SIN_PUNTOS_DE_VENTA_EN_ARCA: "FISCAL_ARCA_SIN_PUNTOS_DE_VENTA",
  PUNTO_DE_VENTA_BLOQUEADO_EN_ARCA: "FISCAL_PUNTO_DE_VENTA_BLOQUEADO_EN_ARCA",
  PUNTO_DE_VENTA_DADO_DE_BAJA_EN_ARCA: "FISCAL_PUNTO_DE_VENTA_DADO_DE_BAJA_EN_ARCA",
  PUNTO_DE_VENTA_SOLO_CAEA_EN_ARCA: "FISCAL_PUNTO_DE_VENTA_SOLO_CAEA_EN_ARCA",
};

/**
 * El texto de cada `causa` de un error de ARCA: la causa solo elige el texto, el `codigo` sigue decidiendo el comportamiento. `null` = sin
 * texto aprobado o sin conectar: sale el texto del `codigo`, el de siempre. Exhaustivo por tipo: una causa nueva no compila sin su decisión.
 * `CERTIFICADO_NO_RECONOCIDO` (texto aprobado, DEC-0741) no se conecta hasta tener una grabación real de `cms.cert.untrusted`;
 * `PUNTO_DE_VENTA_NO_HABILITADO` (11002) conserva el texto de hoy.
 */
export const FISCAL_POR_CAUSA_DE_ARCA: Readonly<Record<Causa, CodigoFiscal | null>> = {
  CUIT_NO_REPRESENTADA: "FISCAL_ARCA_CUIT_NO_REPRESENTADA",
  CERTIFICADO_VENCIDO: "FISCAL_ARCA_CERTIFICADO_VENCIDO",
  PROBLEMA_DEL_SISTEMA: "FISCAL_ARCA_PROBLEMA_DEL_SISTEMA",
  CERTIFICADO_NO_RECONOCIDO: null,
  PUNTO_DE_VENTA_NO_HABILITADO: null,
};

/** El código de la causa de un error, si la trae, la conocemos y tiene texto; una causa desconocida o mal formada se ignora. */
function codigoDeLaCausa(error: Readonly<Record<string, unknown>>): CodigoFiscal | null {
  const causa = error["causa"];
  return typeof causa === "string" && Object.hasOwn(FISCAL_POR_CAUSA_DE_ARCA, causa)
    ? FISCAL_POR_CAUSA_DE_ARCA[causa as Causa]
    : null;
}

/**
 * El código fiscal de un error que viene como objeto con `codigo`: el de su causa si la trae y tiene texto aprobado, si no el que dice la
 * `tabla` por su `codigo`; `undefined` si el `codigo` no es de la tabla (el error pasa sin traducir). La causa solo elige el texto: si no
 * hay `codigo` conocido, no se la mira.
 */
export function codigoDeErrorConCodigo(
  error: Readonly<Record<string, unknown>>,
  tabla: Readonly<Record<string, CodigoFiscal>>,
): CodigoFiscal | undefined {
  const nombre = error["codigo"];
  if (typeof nombre !== "string" || !Object.hasOwn(tabla, nombre)) return undefined;
  return codigoDeLaCausa(error) ?? tabla[nombre];
}
