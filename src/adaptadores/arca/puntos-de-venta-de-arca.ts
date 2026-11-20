import type { EmisionElectronica, ErrorDeEmision } from "../../modulos/fiscal/publico";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { FilaDeParametro } from "./leer-respuestas";

// Los tipos salen del puerto: `publico.ts` de fiscal no puede crecer (deuda registrada) y el adaptador no importa del dominio por dentro.
type ListaDePuntosDeVenta = Awaited<ReturnType<EmisionElectronica["puntosDeVenta"]>>;
type PuntoDeVentaDeArca = Extract<ListaDePuntosDeVenta, Readonly<{ ok: true }>>["valor"][number];

const NRO = /^[0-9]{1,5}$/;
/** Los únicos `EmisionTipo` que se entienden, por igualdad exacta: cualquier otra forma no se interpreta. */
const EMISIONES = ["CAE", "CAEA"] as const;
const FECHA_DE_BAJA = /^[0-9]{8}$/;
/** El texto fijo que ARCA manda en `FchBaja` cuando el punto de venta no está dado de baja (ver el comentario de `aPuntosDeVentaDeArca`). */
const SIN_BAJA_DE_ARCA = "NULL";

const DETALLE_DE_LISTA_ILEGIBLE = "la lista de puntos de venta de ARCA no se pudo leer";
/** Lo único que se copia de un `EmisionTipo` inesperado al registro: letras y dígitos, de 1 a 8 (el largo del campo en el manual). */
const FORMA_DE_EMISION_TIPO_PARA_EL_REGISTRO = /^[A-Za-z0-9]{1,8}$/;
const EMISION_TIPO_SIN_FORMA = "FORMA_INVALIDA";

/** El `EmisionTipo` recibido, saneado para el registro: si no tiene la forma permitida, un texto fijo (nunca un pedazo de la respuesta). */
function formaDeEmisionTipo(recibido: string | undefined): string {
  return recibido !== undefined && FORMA_DE_EMISION_TIPO_PARA_EL_REGISTRO.test(recibido)
    ? recibido
    : EMISION_TIPO_SIN_FORMA;
}

function aPuntoDeVenta(fila: FilaDeParametro): PuntoDeVentaDeArca | null {
  const numero = fila["Nro"] ?? "";
  const bloqueado = fila["Bloqueado"] ?? "";
  const baja = fila["FchBaja"] ?? "";
  const emision = EMISIONES.find((e) => e === fila["EmisionTipo"]);
  if (emision === undefined) return null;
  if (!NRO.test(numero)) return null;
  if (bloqueado !== "S" && bloqueado !== "N") return null;
  const sinBaja = baja === "" || baja === SIN_BAJA_DE_ARCA;
  if (!sinBaja && !FECHA_DE_BAJA.test(baja)) return null;
  return { numero: Number(numero), bloqueado: bloqueado === "S", dadoDeBaja: !sinBaja, emision };
}

/**
 * De las filas de `FEParamGetPtosVenta` (cada `PtoVenta` con sus campos como texto, ya leídas por el lector de tablas) a los puntos de
 * venta que entiende el puerto. Valor puro. Solo se usa lo que el manual WSFE v4.8 (l. 3107-3114) dice de cada campo:
 *  - `Nro`: entero de hasta 5 dígitos;
 *  - `Bloqueado`: `S` o `N`, nada más;
 *  - `FchBaja`: opcional, de 8 caracteres (una fecha `yyyymmdd`); vacío, ausente o el texto exacto `NULL` es que no está dado de baja.
 *    El `NULL` es lo que ARCA manda cuando no hay baja según conocimiento público (no está en el manual); se acepta SOLO ese texto, en
 *    mayúsculas y sin espacios (`null`, ` NULL`, `Nulo`, 7 dígitos... se rechazan).
 *  - `EmisionTipo`: `CAE` o `CAEA`, igualdad exacta (manual l. 3112: «identifica si es punto de venta para CAE o CAEA», 8 caracteres); vacío,
 *    ausente, otras mayúsculas o minúsculas, con espacios o con cualquier otro texto se rechaza. Se lee porque un punto de venta solo
 *    CAEA no pasa a producción (`habilitacion-en-arca.ts`).
 * Lo que no tiene esa forma no se interpreta ni se completa con lo que se supone que ARCA querría decir: toda la respuesta es
 * `SERVICIO_NO_DISPONIBLE` (no se sabe, no se pasa).
 * SIN VERIFICAR contra ARCA real: no hay una grabación de esta operación; el `NULL` de `FchBaja` es conocimiento público, no una
 * grabación nuestra, y los literales de `EmisionTipo` salen de la descripción del manual. Si ARCA manda otra forma, toda consulta se
 * rechaza (fail closed) hasta ajustar este lector. Cuando lo que falla es `EmisionTipo`, el detalle (que solo va al registro del servidor)
 * lleva el valor recibido ya saneado (`formaDeEmisionTipo`), para diagnosticar sin adivinar.
 */
export function aPuntosDeVentaDeArca(
  filas: Resultado<readonly FilaDeParametro[], ErrorDeEmision>,
): ListaDePuntosDeVenta {
  if (!filas.ok) return filas;
  const puntos: PuntoDeVentaDeArca[] = [];
  for (const fila of filas.valor) {
    const punto = aPuntoDeVenta(fila);
    if (punto === null) {
      const recibido = fila["EmisionTipo"];
      const emisionInesperada = !EMISIONES.some((e) => e === recibido);
      return err({
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: emisionInesperada
          ? `${DETALLE_DE_LISTA_ILEGIBLE} (EmisionTipo recibido: ${formaDeEmisionTipo(recibido)})`
          : DETALLE_DE_LISTA_ILEGIBLE,
        causa: "PROBLEMA_DEL_SISTEMA",
      });
    }
    puntos.push(punto);
  }
  return ok(puntos);
}
