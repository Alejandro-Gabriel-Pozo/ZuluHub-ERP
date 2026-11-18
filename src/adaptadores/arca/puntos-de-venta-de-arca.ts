import type { EmisionElectronica, ErrorDeEmision } from "../../modulos/fiscal/publico";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { FilaDeParametro } from "./leer-respuestas";

// Los tipos salen del puerto: `publico.ts` de fiscal no puede crecer (deuda registrada) y el adaptador no importa del dominio por dentro.
type ListaDePuntosDeVenta = Awaited<ReturnType<EmisionElectronica["puntosDeVenta"]>>;
type PuntoDeVentaDeArca = Extract<ListaDePuntosDeVenta, Readonly<{ ok: true }>>["valor"][number];

const NRO = /^[0-9]{1,5}$/;
const FECHA_DE_BAJA = /^[0-9]{8}$/;
/** El texto fijo que ARCA manda en `FchBaja` cuando el punto de venta no está dado de baja (ver el comentario de `aPuntosDeVentaDeArca`). */
const SIN_BAJA_DE_ARCA = "NULL";

function aPuntoDeVenta(fila: FilaDeParametro): PuntoDeVentaDeArca | null {
  const numero = fila["Nro"] ?? "";
  const bloqueado = fila["Bloqueado"] ?? "";
  const baja = fila["FchBaja"] ?? "";
  if (!NRO.test(numero)) return null;
  if (bloqueado !== "S" && bloqueado !== "N") return null;
  const sinBaja = baja === "" || baja === SIN_BAJA_DE_ARCA;
  if (!sinBaja && !FECHA_DE_BAJA.test(baja)) return null;
  return { numero: Number(numero), bloqueado: bloqueado === "S", dadoDeBaja: !sinBaja };
}

/**
 * De las filas de `FEParamGetPtosVenta` (cada `PtoVenta` con sus campos como texto, ya leídas por el lector de tablas) a los puntos de
 * venta que entiende el puerto. Valor puro. Solo se usa lo que el manual WSFE v4.8 (l. 3107-3114) dice de cada campo:
 *  - `Nro`: entero de hasta 5 dígitos;
 *  - `Bloqueado`: `S` o `N`, nada más;
 *  - `FchBaja`: opcional, de 8 caracteres (una fecha `yyyymmdd`); vacío, ausente o el texto exacto `NULL` es que no está dado de baja.
 *    El `NULL` es lo que ARCA manda cuando no hay baja según conocimiento público (no está en el manual); se acepta SOLO ese texto, en
 *    mayúsculas y sin espacios (`null`, ` NULL`, `Nulo`, 7 dígitos... se rechazan).
 * Lo que no tiene esa forma no se interpreta ni se completa con lo que se supone que ARCA querría decir: toda la respuesta es
 * `SERVICIO_NO_DISPONIBLE` (no se sabe, no se pasa). `EmisionTipo` no se lee: se ignora a propósito (D-77 no lo pide).
 * SIN VERIFICAR contra ARCA real: no hay una grabación de esta operación; el `NULL` de `FchBaja` es conocimiento público, no una
 * grabación nuestra. Si ARCA manda algo distinto en `FchBaja` cuando no hay baja, toda consulta se rechaza hasta ajustar este lector.
 */
export function aPuntosDeVentaDeArca(
  filas: Resultado<readonly FilaDeParametro[], ErrorDeEmision>,
): ListaDePuntosDeVenta {
  if (!filas.ok) return filas;
  const puntos: PuntoDeVentaDeArca[] = [];
  for (const fila of filas.valor) {
    const punto = aPuntoDeVenta(fila);
    if (punto === null) {
      return err({
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "la lista de puntos de venta de ARCA no se pudo leer",
      });
    }
    puntos.push(punto);
  }
  return ok(puntos);
}
