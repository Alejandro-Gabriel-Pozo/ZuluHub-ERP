import { emailDeContactoDesdeTexto } from "../../../primitivas/contacto/email";
import { telefonoDesdeTexto } from "../../../primitivas/contacto/telefono";
import { webDesdeTexto } from "../../../primitivas/contacto/web";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * El contacto de una sucursal (D-98): teléfono, correo y web, los tres OPCIONALES (`null` = no existe). La factura impresa los
 * muestra si existen, y el comprobante congela los vigentes al darse de alta (0019: lo copia la base). Puro: sin Zod ni reloj.
 *
 * Qué es un teléfono, un correo o una web válidos NO se decide acá: es de `primitivas/contacto` (`telefono.ts`, `email.ts`,
 * `web.ts`), que también usarán clientes y proveedores. Acá vive solo lo propio de la sucursal: que cada dato es opcional,
 * que un texto en blanco lo borra, que ausente es «no se toca» y qué cambia de verdad. Los CHECK de 0019 repiten las reglas de
 * las primitivas, tabla por tabla.
 */
export type ContactoDeSucursal = Readonly<{
  telefono: string | null;
  correo: string | null;
  web: string | null;
}>;

/** Lo que pide una edición: la clave AUSENTE no toca ese dato; `null` (o un texto en blanco) lo borra. */
export type CambiosDeContacto = Readonly<{
  telefono?: string | null;
  correo?: string | null;
  web?: string | null;
}>;

/** Lo que llega de la entrada, sin validar: `undefined` = no se pidió. */
export type ContactoPedido = Readonly<{
  telefono?: string | null | undefined;
  correo?: string | null | undefined;
  web?: string | null | undefined;
}>;

export type ErrorDeContactoDeSucursal =
  "TELEFONO_DE_SUCURSAL_INVALIDO" | "CORREO_DE_SUCURSAL_INVALIDO" | "WEB_DE_SUCURSAL_INVALIDA";

/** Texto en blanco o `null` = sin dato; si hay, lo valida la primitiva y los errores de la sucursal siguen siendo los suyos. */
function opcional<T extends string, E extends string>(
  texto: string | null,
  validar: (texto: string) => Resultado<T, string>,
  error: E,
): Resultado<string | null, E> {
  if (texto === null || texto.trim() === "") return ok(null);
  const valido = validar(texto);
  return valido.ok ? ok(valido.valor) : err(error);
}

export function telefonoDeSucursalValido(texto: string | null) {
  return opcional(texto, telefonoDesdeTexto, "TELEFONO_DE_SUCURSAL_INVALIDO");
}

export function correoDeSucursalValido(texto: string | null) {
  return opcional(texto, emailDeContactoDesdeTexto, "CORREO_DE_SUCURSAL_INVALIDO");
}

export function webDeSucursalValida(texto: string | null) {
  return opcional(texto, webDesdeTexto, "WEB_DE_SUCURSAL_INVALIDA");
}

/**
 * Valida lo que pide una edición o un alta: solo los datos pedidos (`undefined` no se toca y no se valida) y devuelve los que
 * hay que dejar, ya limpios (`null` = borrar). El primer inválido, en el orden teléfono, correo, web, corta.
 */
export function cambiosDeContactoValidos(
  pedido: ContactoPedido,
): Resultado<CambiosDeContacto, ErrorDeContactoDeSucursal> {
  const cambios: { telefono?: string | null; correo?: string | null; web?: string | null } = {};
  if (pedido.telefono !== undefined) {
    const telefono = telefonoDeSucursalValido(pedido.telefono);
    if (!telefono.ok) return telefono;
    cambios.telefono = telefono.valor;
  }
  if (pedido.correo !== undefined) {
    const correo = correoDeSucursalValido(pedido.correo);
    if (!correo.ok) return correo;
    cambios.correo = correo.valor;
  }
  if (pedido.web !== undefined) {
    const web = webDeSucursalValida(pedido.web);
    if (!web.ok) return web;
    cambios.web = web.valor;
  }
  return ok(cambios);
}

/** Los datos de contacto que la edición CAMBIA de verdad (pedidos y distintos de los vigentes), con su valor nuevo. */
export function contactoQueCambia(
  actual: ContactoDeSucursal,
  cambios: CambiosDeContacto,
): CambiosDeContacto {
  return {
    ...(cambios.telefono !== undefined && cambios.telefono !== actual.telefono
      ? { telefono: cambios.telefono }
      : {}),
    ...(cambios.correo !== undefined && cambios.correo !== actual.correo
      ? { correo: cambios.correo }
      : {}),
    ...(cambios.web !== undefined && cambios.web !== actual.web ? { web: cambios.web } : {}),
  };
}

/** De `contacto`, solo los datos que `cambios` nombra: el antes y el después de lo que una edición cambió, para la auditoría. */
export function contactoDeLosDatos(
  contacto: ContactoDeSucursal,
  cambios: CambiosDeContacto,
): CambiosDeContacto {
  return {
    ...(cambios.telefono !== undefined ? { telefono: contacto.telefono } : {}),
    ...(cambios.correo !== undefined ? { correo: contacto.correo } : {}),
    ...(cambios.web !== undefined ? { web: contacto.web } : {}),
  };
}
