/**
 * FICHA DEL DATO: CORREO ELECTRÓNICO. (DECIDIDO = D-98, 2026-11-04 o una decisión anterior ya implementada; SUPUESTO = del
 * ingeniero, revertible; SIN DECIDIR = falta la decisión del dueño.) Tiene dos usos con reglas distintas: el de PERSONA (invitaciones,
 * admins de plataforma, captación: `emailDesdeTexto`, ya vigente) y el de CONTACTO de un local (`emailDeContactoDesdeTexto`, 0019).
 *
 * - Qué es: una dirección de correo. Como contacto, la del local (hoy, la de la sucursal) que la factura impresa muestra si existe.
 * - Cómo se escribe: se recortan los blancos de los extremos y se pasa a MINÚSCULAS; al menos un carácter antes y uno después de
 *   una `@` (no es una validación de RFC: la verificación real es el enlace); sin blancos adentro. Como contacto, además: hasta
 *   `LARGO_MAXIMO_DEL_EMAIL_DE_CONTACTO` (254, SUPUESTO) caracteres y sin caracteres de control. El de persona NO tiene ese tope.
 * - Obligatorio/opcional: de persona, OBLIGATORIO. De contacto, OPCIONAL (D-98): vacío = «no tiene»; un texto en blanco o `null`
 *   borra el dato (SUPUESTO); en la base es NULL, nunca un texto vacío.
 * - Único: el de persona, sí (`persona_email_uk`, entre todas las personas). El de contacto, NO: la base no le pone unicidad.
 * - Quién lo cambia: el de contacto de la sucursal, quien edita la sucursal (`sucursales.editar`: gerente y administrador; SUPUESTO).
 *   El de persona lo definen los casos de uso de identidad (fuera de esta ficha).
 * - Verificado o declarado: el de persona se verifica con el enlace de la invitación. El de contacto es solo DECLARADO: no se
 *   le manda nada para comprobarlo.
 * - Se congela en comprobantes: el de contacto SÍ, el vigente al darse de alta el comprobante (`comprobante.sucursal_correo`,
 *   copiado por la base); no cambia nunca después. Los anteriores a 0019 quedan sin correo (D-98).
 * - Dónde se muestra (D-99): el de contacto, factura impresa, PDF, mails y detalle del comprobante. Como enlace `mailto:` donde el
 *   medio lo permita (PDF, mail, pantalla); en papel, texto. Todavía no hay función para armar el `mailto:`: se agrega cuando
 *   una superficie la necesite (SIN DECIDIR si se deja el correo en minúsculas tal cual o con otro tratamiento).
 * - Dato personal: SÍ puede serlo (un correo personal cargado como contacto del local). Se audita el antes y el después en
 *   `auditoria_empresa` (de solo inserción) y queda en las facturas emitidas. Si alguna norma de datos personales lo alcanza: SIN DECIDIR.
 * - Cómo se compara y cómo se imprime: por igualdad exacta del texto ya normalizado (por eso "Centro@Hotel.com" y "centro@hotel.com"
 *   son el mismo). Cómo se imprime (rótulo, lugar en el papel): SIN DECIDIR (la plantilla imprimible, D-97, no está construida).
 * - Código de error: `EMAIL_INVALIDO` (la sucursal lo expone como `CORREO_DE_SUCURSAL_INVALIDO`).
 * - Ejemplos válidos: "centro@hotel.com", "a@b", "  Centro@Hotel.COM " (queda "centro@hotel.com"). Inválidos: "centro", "@hotel.com",
 *   "centro@", "cen tro@hotel.com"; como contacto además 255 caracteres o un carácter de control.
 *
 * Lo que repite el CHECK `sucursal_correo_ck` (0019); un test de integración compara los dos (`contacto-check.test.ts`).
 */
import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";
import { esUnaLineaSinControl, largoEnCaracteres } from "./una-linea";

/**
 * Email normalizado (sin espacios en los extremos y en minúsculas). Solo nace de `emailDesdeTexto`. Es
 * una primitiva y no del dominio de identidad porque lo usan también clientes y proveedores (conciliación
 * §3.7): dos reglas de email serían dos CHECK distintos en la base para el mismo dato.
 */
export type Email = Marca<string, "Email">;

const ESPACIO_BLANCO = /\s/;

/**
 * Normaliza (`trim` y minúsculas) y valida con la MISMA regla que el CHECK `persona_email_ck` de
 * la base: al menos un carácter antes de una `@` y al menos uno después (`LIKE '%_@_%'`). No se
 * inventa una validación de RFC más estricta: la verificación real del email es el enlace.
 *
 * Decisión propia, más prudente que la base: se rechaza cualquier espacio en blanco interno
 * (espacios, tabulaciones, saltos de línea). La base los aceptaría, pero un email con blancos
 * adentro nunca es una dirección real y casi siempre es un error de carga.
 */
export function emailDesdeTexto(texto: string): Resultado<Email, "EMAIL_INVALIDO"> {
  const normalizado = texto.trim().toLowerCase();
  if (ESPACIO_BLANCO.test(normalizado)) return err("EMAIL_INVALIDO");
  // Una `@` que no sea el primer carácter y que no sea el último: equivale a `LIKE '%_@_%'`.
  const arroba = normalizado.indexOf("@", 1);
  if (arroba === -1 || arroba === normalizado.length - 1) return err("EMAIL_INVALIDO");
  return ok(normalizado as Email);
}

/**
 * Tope del correo que se guarda como DATO DE CONTACTO (254 caracteres, el máximo de una dirección). Lo repite el CHECK
 * `sucursal_correo_ck` (0019). No rige para `emailDesdeTexto`: las personas y los admins no tienen este tope.
 */
export const LARGO_MAXIMO_DEL_EMAIL_DE_CONTACTO = 254;

/**
 * `emailDesdeTexto` más lo que pide un correo impreso en una factura: hasta 254 caracteres y sin caracteres de control. Función
 * aparte para NO endurecer a quienes ya usan `emailDesdeTexto` (identidad, plataforma, captación): ellos no cambian.
 */
export function emailDeContactoDesdeTexto(texto: string): Resultado<Email, "EMAIL_INVALIDO"> {
  const email = emailDesdeTexto(texto);
  if (
    !email.ok ||
    largoEnCaracteres(email.valor) > LARGO_MAXIMO_DEL_EMAIL_DE_CONTACTO ||
    !esUnaLineaSinControl(email.valor)
  ) {
    return err("EMAIL_INVALIDO");
  }
  return email;
}
