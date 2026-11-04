/**
 * FICHA DEL DATO: WEB DE CONTACTO. (DECIDIDO = D-98, 2026-11-04; SUPUESTO = del ingeniero, revertible; SIN DECIDIR = falta la
 * decisión del dueño.)
 *
 * - Qué es: la dirección web de un local (hoy, la de la sucursal) que la factura impresa muestra si existe (D-98).
 * - Cómo se escribe: empieza con `http://` o `https://` (sin distinguir mayúsculas) y sigue sin blancos (SUPUESTO). Normalización:
 *   solo se recortan los blancos de los extremos; no se pasa a minúsculas, no se completa ni se corrige («www.hotel.com» se
 *   rechaza) y no se abre ni se resuelve. Sin caracteres de control. Hasta `LARGO_MAXIMO_DE_LA_WEB` (200) caracteres (SUPUESTO).
 * - Obligatorio/opcional: OPCIONAL (D-98). Vacío = «no tiene»: un texto en blanco o `null` borra el dato (SUPUESTO); en la base es
 *   NULL, nunca un texto vacío.
 * - Único: NO. La base no le pone unicidad. Si debe serlo: SIN DECIDIR.
 * - Quién lo cambia: quien edita la sucursal (permiso `sucursales.editar`: gerente y administrador; SUPUESTO).
 * - Verificado o declarado: solo DECLARADO; nadie comprueba que la dirección exista.
 * - Se congela en comprobantes: SÍ, la vigente al darse de alta el comprobante (`comprobante.sucursal_web`, copiada por la base);
 *   no cambia nunca después. Los comprobantes anteriores a 0019 quedan sin web (D-98).
 * - Dato personal: normalmente no (es la web del negocio), pero nada impide cargar una página personal. Se audita el antes y el
 *   después en `auditoria_empresa` y queda en las facturas emitidas. Si alguna norma lo alcanza: SIN DECIDIR.
 * - Cómo se compara y cómo se imprime: igualdad exacta del texto ya recortado (distingue mayúsculas: "https://A.com" y
 *   "https://a.com" son distintas). Cómo se imprime (rótulo, lugar, si se acorta o se muestra sin el esquema): SIN DECIDIR.
 * - Código de error: `WEB_INVALIDA` (la sucursal lo expone como `WEB_DE_SUCURSAL_INVALIDA`).
 * - Ejemplos válidos: "https://hotel.com/centro", "http://hotel.com", "HTTPS://HOTEL.COM". Inválidos: "www.hotel.com", "https://",
 *   "ftp://hotel.com", "https://ho tel.com", 201 caracteres.
 *
 * Lo que repite el CHECK `sucursal_web_ck` (0019); un test de integración compara los dos (`contacto-check.test.ts`).
 */
import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";
import { esUnaLineaSinControl, largoEnCaracteres } from "./una-linea";

/**
 * Dirección web de contacto: empieza con `http://` o `https://` (sin distinguir mayúsculas) y sigue sin blancos. No se abre,
 * no se resuelve y no se completa (`www.hotel.com` se rechaza). Solo nace de `webDesdeTexto`. Primitiva por la misma razón
 * que el teléfono: clientes y proveedores la comparten.
 *
 * El tope y la forma son un SUPUESTO del ingeniero (sin fuente del dueño): los repite el CHECK `sucursal_web_ck` (0019).
 */
export type SitioWeb = Marca<string, "SitioWeb">;

export const LARGO_MAXIMO_DE_LA_WEB = 200;

/** La forma admitida; el CHECK `sucursal_web_ck` repite este patrón y un test lo compara. */
export const PATRON_DE_LA_WEB = /^https?:\/\/\S+$/i;

/** Sin espacios en los extremos, con el esquema `http(s)://`, hasta 200 caracteres y sin caracteres de control. */
export function webDesdeTexto(texto: string): Resultado<SitioWeb, "WEB_INVALIDA"> {
  const limpio = texto.trim();
  if (
    !PATRON_DE_LA_WEB.test(limpio) ||
    largoEnCaracteres(limpio) > LARGO_MAXIMO_DE_LA_WEB ||
    !esUnaLineaSinControl(limpio)
  ) {
    return err("WEB_INVALIDA");
  }
  return ok(limpio as SitioWeb);
}
