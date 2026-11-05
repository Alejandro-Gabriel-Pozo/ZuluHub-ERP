import { err, type Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto } from "./texto-de-una-linea";

/**
 * FICHA DEL DATO: NOMBRE O RAZÓN SOCIAL. (DECIDIDO = lo dijo el dueño o ya está implementado; SUPUESTO = del ingeniero, revertible;
 * SIN DECIDIR = falta la decisión del dueño.)
 *
 * - Qué es: cómo se llama una persona o una empresa, tal como se imprime en un comprobante: el nombre del receptor (el cliente al
 *   que se le factura). La razón social del emisor y la de la empresa se suman cuando pasen a usar esta primitiva (otro paso).
 *   No es un texto libre tipo motivo o descripción.
 * - Cómo se escribe: se recortan los blancos de los extremos, los espacios repetidos pasan a uno solo y el texto queda en NFC.
 *   Se conservan las mayúsculas y los acentos que escribió la persona (SUPUESTO). Entre 1 y `LARGO_MAXIMO_DEL_NOMBRE_O_RAZON_SOCIAL`
 *   (200, el valor que ya tenía el sistema; ARCA no lo fija: WSFE no recibe el nombre del receptor) caracteres, contados por
 *   carácter. Debe tener AL MENOS UNA LETRA (DECIDIDO en espíritu: el dueño, 2026-11-05, vio que se cargaba un «nombre» formado solo
 *   por números; confirmación de la regla: SIN DECIDIR, Q2). Eso también rechaza un CUIT escrito en el campo del nombre
 *   («30-71234567-1» no tiene letras), sin una regla aparte. Admite números junto a las letras («La 5ta. SRL», «Hotel 9 de Julio»).
 *   Rechaza caracteres de control, de formato invisible y bidi, saltos de línea, `<` `>` y emojis (ver `texto-de-una-linea.ts`).
 *   SIN DECIDIR todavía (Q3, Q4, Q7): un tope de dígitos seguidos, una lista cerrada de signos admitidos y el rechazo de un texto
 *   que empiece con `=`, `+`, `-` o `@`. Mientras no se decidan NO se aplican: se admiten todos los signos que no son peligrosos.
 * - Obligatorio/opcional: lo decide quien la usa. El receptor lo exige salvo con el consumidor final sin identificar; vacío = no se
 *   informa y se guarda `NULL`, nunca un texto vacío (eso lo resuelve el llamador antes de llegar acá).
 * - Único: no. Dos clientes pueden llamarse igual; lo que identifica es el documento.
 * - Quién lo cambia: el nombre del receptor no se cambia: se congela en el comprobante.
 * - Verificado o declarado: solo DECLARADO. Queda compatible con comparar contra la razón social que devuelva ARCA por CUIT; esa
 *   consulta NO está construida.
 * - Se congela: sí, en el comprobante (`receptor_nombre`, 0009).
 * - Qué ve el público: se imprime tal cual se guardó.
 * - Código de error: el motivo corto de esta primitiva; el receptor lo traduce a `RECEPTOR_INVALIDO` con `campo: "nombre"`.
 * - Ejemplos válidos: "Distribuidora Sur SA", "Pérez & Hijos S.A.", "D'Angelo", "La 5ta. SRL", "  Juan   Pérez " (queda "Juan Pérez").
 *   Inválidos: "12345678", "30-71234567-1", "", "Juan\nPérez", "<b>Juan</b>", "Juan 😀".
 *
 * Lo que repite la base: el CHECK `comprobante_receptor_nombre_ck` (0009) pide 1 a 200 caracteres, sin blancos en los extremos y sin
 * control; esta regla es más estricta. Un test de integración que compare ambos queda para el paso que toque la base.
 */
export const LARGO_MAXIMO_DEL_NOMBRE_O_RAZON_SOCIAL = 200;

export type MotivoDeNombreInvalido =
  "VACIO" | "DEMASIADO_LARGO" | "CARACTER_PROHIBIDO" | "SIN_LETRAS";

const UNA_LETRA = /\p{L}/u;

export function nombreODenominacionDesdeTexto(
  texto: string,
): Resultado<string, MotivoDeNombreInvalido> {
  const limpio = textoDeUnaLineaDesdeTexto(texto, LARGO_MAXIMO_DEL_NOMBRE_O_RAZON_SOCIAL);
  if (!limpio.ok) return limpio;
  return UNA_LETRA.test(limpio.valor) ? limpio : err("SIN_LETRAS");
}
