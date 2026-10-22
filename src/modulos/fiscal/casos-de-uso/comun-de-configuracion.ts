import {
  domicilioDesdeDatos,
  type DatosDeDomicilio,
  type ErrorDeDomicilio,
} from "../../../primitivas/domicilio/domicilio";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Dato } from "../../../puertos/sin-secretos";
import { esUuid, type DomicilioId } from "../dominio/identificadores";
import type { TxDeConfiguracionFiscal } from "./contrato-de-configuracion";

/**
 * Piezas que comparten los casos de uso de configuración fiscal del gerente (H7, T5): el domicilio que llega
 * con el borrador o con el punto de venta, la forma de los identificadores que genera la pantalla y el
 * antes/después de la auditoría.
 */

/**
 * El domicilio que acompaña a un borrador de datos fiscales o a un punto de venta. Un domicilio no se edita
 * (la tabla es de solo inserción): o es uno NUEVO, con el `id` (uuid) que generó la pantalla, o es uno
 * EXISTENTE de esta empresa (por ejemplo, el que ya tenía otra versión).
 */
export type DomicilioDeEntrada =
  | Readonly<{ tipo: "NUEVO"; id: DomicilioId; datos: DatosDeDomicilio }>
  | Readonly<{ tipo: "EXISTENTE"; id: DomicilioId }>;

export type ErrorDeDomicilioDeEntrada =
  ErrorDeDomicilio | "ID_INVALIDO" | "ID_EN_USO" | "DOMICILIO_NO_ENCONTRADO";

/**
 * Deja el domicilio listo y devuelve su id. NUEVO: valida su forma y lo inserta con el `id` de la pantalla
 * (repetir el mismo `id` con el mismo contenido es la repetición y no escribe; el mismo `id` con otro contenido,
 * o de una fila que esta empresa no ve, es `ID_EN_USO`). EXISTENTE: tiene que ser de esta empresa. La forma del
 * `id` se mira antes de tocar la base.
 */
export async function dejarListoElDomicilio(
  tx: Pick<TxDeConfiguracionFiscal, "domicilios">,
  empresa: EmpresaId,
  entrada: DomicilioDeEntrada,
): Promise<Resultado<DomicilioId, ErrorDeDomicilioDeEntrada>> {
  if (!esUuid(entrada.id)) return err("ID_INVALIDO");
  if (entrada.tipo === "EXISTENTE") {
    const existente = await tx.domicilios.obtener(empresa, entrada.id);
    return existente === null ? err("DOMICILIO_NO_ENCONTRADO") : ok(entrada.id);
  }
  const domicilio = domicilioDesdeDatos(entrada.datos);
  if (!domicilio.ok) return domicilio;
  const alta = await tx.domicilios.crear(empresa, entrada.id, domicilio.valor);
  return alta.ok ? ok(entrada.id) : alta;
}

/**
 * La persona que actúa. Un trabajo de sistema (sin persona) no configura lo fiscal: es un defecto de quien llama,
 * no un error de negocio, y se corta antes de abrir la transacción.
 */
export function personaQueActua(personaId: PersonaId | null, caso: string): PersonaId {
  if (personaId === null) {
    throw new RangeError(`${caso} exige una persona: un trabajo de sistema no lo hace`);
  }
  return personaId;
}

/**
 * Solo lo que cambió entre dos estados, campo por campo: el `antes` y el `después` de la auditoría. Un campo
 * igual en los dos no aparece. Si no cambió nada, los dos vienen vacíos.
 */
export function cambiosParaAuditar(
  antes: Readonly<Record<string, Dato>>,
  despues: Readonly<Record<string, Dato>>,
): Readonly<{ antes: Record<string, Dato>; despues: Record<string, Dato> }> {
  const soloAntes: Record<string, Dato> = {};
  const soloDespues: Record<string, Dato> = {};
  for (const campo of Object.keys(despues)) {
    const valorAntes = antes[campo] ?? null;
    const valorDespues = despues[campo] ?? null;
    if (valorAntes !== valorDespues) {
      soloAntes[campo] = valorAntes;
      soloDespues[campo] = valorDespues;
    }
  }
  return { antes: soloAntes, despues: soloDespues };
}
