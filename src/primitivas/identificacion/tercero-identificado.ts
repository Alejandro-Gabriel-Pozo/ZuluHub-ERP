import { esUuidCanonico } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";
import { nombreODenominacionDesdeTexto } from "../texto/nombre-o-razon-social";

/**
 * Quién está del otro lado de un movimiento de dinero sin documento. Lista cerrada: lo que no está acá no identifica a nadie.
 * Dato personal: el nombre nunca se escribe en el detalle de la auditoría (lo cumplen los casos de uso).
 * `NOMBRE`: ya normalizado por la primitiva del nombre (una regla, un lugar). `EMPLEADO`: una persona con usuario de la empresa (solo la salida).
 */
export type TerceroIdentificado =
  Readonly<{ tipo: "NOMBRE"; nombre: string }> | Readonly<{ tipo: "EMPLEADO"; personaId: string }>;

export type ErrorDeTercero = "TERCERO_INVALIDO";

/**
 * De lo que llega de la frontera (ya con forma) al valor válido. `null` = no vino nadie (ni nombre, o solo espacios, ni persona).
 * Previene que entrada y salida validen distinto al mismo dato: el nombre se valida con `nombreODenominacionDesdeTexto`, sin regla propia.
 */
export function terceroDesdeEntrada(
  entrada: Readonly<{ nombre?: string | undefined; personaId?: string | undefined }> | null,
): Resultado<TerceroIdentificado | null, ErrorDeTercero> {
  if (entrada === null) return ok(null);
  const hayNombre = entrada.nombre !== undefined && entrada.nombre.trim() !== "";
  const hayPersona = entrada.personaId !== undefined;
  if (hayNombre && hayPersona) return err("TERCERO_INVALIDO");
  if (hayPersona) {
    return esUuidCanonico(entrada.personaId)
      ? ok({ tipo: "EMPLEADO", personaId: entrada.personaId })
      : err("TERCERO_INVALIDO");
  }
  if (!hayNombre) return ok(null);
  const nombre = nombreODenominacionDesdeTexto(entrada.nombre);
  return nombre.ok ? ok({ tipo: "NOMBRE", nombre: nombre.valor }) : err("TERCERO_INVALIDO");
}
