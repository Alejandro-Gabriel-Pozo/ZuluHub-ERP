import type { EmisionElectronica, ErrorDeEmision } from "../../modulos/fiscal/publico";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { FilaDeParametro } from "./leer-respuestas";

// Los tipos salen del puerto: `publico.ts` de fiscal no puede crecer (deuda registrada) y el adaptador no importa del dominio por dentro.
type ListaDePuntosDeVenta = Awaited<ReturnType<EmisionElectronica["puntosDeVenta"]>>;
type PuntoDeVentaDeArca = Extract<ListaDePuntosDeVenta, Readonly<{ ok: true }>>["valor"][number];

const NRO = /^[0-9]{1,5}$/;
const FECHA_DE_BAJA = /^[0-9]{8}$/;

function aPuntoDeVenta(fila: FilaDeParametro): PuntoDeVentaDeArca | null {
  const numero = fila["Nro"] ?? "";
  const bloqueado = fila["Bloqueado"] ?? "";
  const baja = fila["FchBaja"] ?? "";
  if (!NRO.test(numero)) return null;
  if (bloqueado !== "S" && bloqueado !== "N") return null;
  if (baja !== "" && !FECHA_DE_BAJA.test(baja)) return null;
  return { numero: Number(numero), bloqueado: bloqueado === "S", dadoDeBaja: baja !== "" };
}

/**
 * De las filas de `FEParamGetPtosVenta` (cada `PtoVenta` con sus campos como texto, ya leídas por el lector de tablas) a los puntos de
 * venta que entiende el puerto. Valor puro. Solo se usa lo que el manual WSFE v4.8 (l. 3107-3114) dice de cada campo:
 *  - `Nro`: entero de hasta 5 dígitos;
 *  - `Bloqueado`: `S` o `N`, nada más;
 *  - `FchBaja`: opcional, de 8 caracteres (una fecha `yyyymmdd`); vacío o ausente es que no está dado de baja.
 * Lo que no tiene esa forma no se interpreta ni se completa con lo que se supone que ARCA querría decir: toda la respuesta es
 * `SERVICIO_NO_DISPONIBLE` (no se sabe, no se pasa). `EmisionTipo` no se lee (sin decidir qué hacer con él).
 * SIN VERIFICAR contra ARCA real: no hay una grabación de esta operación. Si ARCA manda algo distinto en `FchBaja` cuando no hay baja
 * (un texto fijo, por ejemplo), toda consulta se rechaza hasta ajustar este lector con la grabación.
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
