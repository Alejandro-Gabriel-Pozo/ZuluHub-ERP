/**
 * FICHA DEL DATO: WEB DE CONTACTO. (DECIDIDO = D-98 y D-99, 2026-11-04; SUPUESTO = del ingeniero, revertible; SIN DECIDIR = falta la
 * decisión del dueño.)
 *
 * - Qué es: la dirección web de un local (hoy, la de la sucursal) que se muestra donde se muestran los datos de la sucursal del
 *   comprobante (D-99).
 * - Cómo se escribe: la persona la puede escribir CON o SIN `http://` / `https://` (D-99). Se GUARDA canónica, sin esquema: sin
 *   `http(s)://`, con el host en minúsculas, sin la barra final cuando es solo el host ("https://WWW.Hotel.com/" → "www.hotel.com") y
 *   el resto (puerto, ruta, consulta) tal cual se escribió. El host son letras ASCII, dígitos y guiones separados por puntos, con al
 *   menos un punto ("hotel.com", "www.hotel.com"); puerto opcional; después, `/`, `?` o `#` y texto sin blancos. Cualquier otro
 *   esquema (`ftp:`, `javascript:`, `data:`, `mailto:`…), usuario o contraseña (`a@`), blancos o caracteres de control se
 *   rechazan: lo que se guarda termina como enlace y no puede traer un esquema ejecutable. Hasta `LARGO_MAXIMO_DE_LA_WEB` (200)
 *   caracteres YA SIN el esquema (SUPUESTO). Nombres de dominio con letras fuera de ASCII (ñ, tildes): SIN DECIDIR (hoy se rechazan).
 *   No se abre ni se resuelve: que el sitio exista no se comprueba.
 * - Obligatorio/opcional: OPCIONAL (D-98). Vacío = «no tiene»: un texto en blanco o `null` borra el dato (SUPUESTO); en la base es
 *   NULL, nunca un texto vacío.
 * - Único: NO. La base no le pone unicidad. Si debe serlo: SIN DECIDIR.
 * - Quién lo cambia: quien edita la sucursal (permiso `sucursales.editar`: gerente y administrador; SUPUESTO).
 * - Verificado o declarado: solo DECLARADO; nadie comprueba que la dirección exista.
 * - Se congela en comprobantes: SÍ, la vigente al darse de alta el comprobante (`comprobante.sucursal_web`, copiada por la base, ya
 *   sin esquema); no cambia nunca después. Los comprobantes anteriores a 0019 quedan sin web (D-98).
 * - Dónde se muestra (D-99): factura impresa, PDF, mails y detalle del comprobante; en cada uno con `webParaImprimir` o
 *   `enlaceDeLaWeb`, nunca reescribiendo la regla. Rótulo y lugar en cada medio: SIN DECIDIR.
 * - Dato personal: normalmente no (es la web del negocio), pero nada impide cargar una página personal. Se audita el antes y el
 *   después en `auditoria_empresa` y queda en las facturas emitidas. Si alguna norma lo alcanza: SIN DECIDIR.
 * - Cómo se compara y cómo se imprime: se compara por igualdad exacta del texto canónico ("Hotel.com" y "https://hotel.com" son el
 *   mismo dato; la ruta distingue mayúsculas). En papel va SIN esquema, como texto (`webParaImprimir`, D-99: un papel no lleva a
 *   ningún lado). Donde el medio lo permite (PDF, mail, pantalla) es un enlace `https://` + el valor (`enlaceDeLaWeb`); que el
 *   enlace use SIEMPRE https es un SUPUESTO del ingeniero (un sitio solo http no se puede enlazar tal cual).
 * - Código de error: `WEB_INVALIDA` (la sucursal lo expone como `WEB_DE_SUCURSAL_INVALIDA`).
 * - Ejemplos válidos (entrada → se guarda): "www.hotelcentro.com" → "www.hotelcentro.com"; " HTTPS://WWW.Hotel.COM/ " → "www.hotel.com";
 *   "http://hotel.com/Centro" → "hotel.com/Centro"; "hotel.com:8080/x?y=1" → igual. Inválidos: "", "https://", "ftp://hotel.com",
 *   "javascript:alert(1)", "hotel", "ho tel.com", "hotel.com/a\nb" (salto de línea adentro; en los extremos se recorta), 201 caracteres sin el esquema.
 *
 * Lo que repite el CHECK `sucursal_web_ck` (0019): el patrón de `PATRON_DE_LA_WEB`, la regla de la barra final, el tope y la clase
 * de control; un test de integración compara los dos (`contacto-check.test.ts`).
 */
import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";
import { esUnaLineaSinControl, largoEnCaracteres } from "./una-linea";

/** Una web ya canónica: sin esquema, host en minúsculas. Solo nace de `webDesdeTexto`. */
export type SitioWeb = Marca<string, "SitioWeb">;

export const LARGO_MAXIMO_DE_LA_WEB = 200;

/**
 * La forma canónica guardada: host en minúsculas (letras minúsculas, dígitos y guiones, con al menos un punto), puerto y después
 * `/`, `?` o `#` con texto sin blancos. Sin esquema: `https://x.com` no calza. El CHECK `sucursal_web_ck` repite este literal.
 */
export const PATRON_DE_LA_WEB =
  /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?(:[0-9]{1,5})?([/?#]\S*)?$/;
/** Solo el host (con puerto) y una barra: la canónica no la lleva. El CHECK repite este mismo patrón, negado. */
export const PATRON_DE_HOST_CON_BARRA = /^[^/?#]*\/$/;

const ESQUEMA_ADMITIDO = /^https?:\/\//i;

/**
 * Lleva el texto a la forma canónica y la valida. Quita un `http://` o `https://` inicial (cualquier otro esquema queda en el texto y
 * hace que no calce con el patrón), pasa el host a minúsculas y saca la barra final si no hay más que el host.
 */
export function webDesdeTexto(texto: string): Resultado<SitioWeb, "WEB_INVALIDA"> {
  const sinEsquema = texto.trim().replace(ESQUEMA_ADMITIDO, "");
  const corte = sinEsquema.search(/[/?#]/);
  const host = corte === -1 ? sinEsquema : sinEsquema.slice(0, corte);
  const resto = corte === -1 ? "" : sinEsquema.slice(corte);
  const canonica = host.toLowerCase() + (resto === "/" ? "" : resto);
  if (
    !PATRON_DE_LA_WEB.test(canonica) ||
    PATRON_DE_HOST_CON_BARRA.test(canonica) ||
    largoEnCaracteres(canonica) > LARGO_MAXIMO_DE_LA_WEB ||
    !esUnaLineaSinControl(canonica)
  ) {
    return err("WEB_INVALIDA");
  }
  return ok(canonica as SitioWeb);
}

/** El texto para el papel: la web sin esquema, tal cual se guarda (D-99). */
export function webParaImprimir(web: SitioWeb): string {
  return web;
}

/** El enlace para PDF, mail y pantalla: `https://` + la web. SUPUESTO: siempre https (D-99). */
export function enlaceDeLaWeb(web: SitioWeb): string {
  return `https://${web}`;
}
