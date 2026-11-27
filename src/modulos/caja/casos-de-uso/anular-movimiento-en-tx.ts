import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeATexto } from "../../../primitivas/dinero/importe";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Dato } from "../../../puertos/sin-secretos";
import {
  decidirAnulacion,
  movimientoAnulableDe,
  type ErrorDeAnulacion,
} from "../dominio/anulacion";
import type { MovimientoConSesion } from "../persistencia/repositorio-de-movimientos";
import { dejarConstancia } from "./comun";
import type { TxDeCaja } from "./contrato";

export type EntradaDeAnularMovimientoEnTx = Readonly<{
  /** El movimiento que se anula, ya leído en esta transacción y ya dentro del alcance de la persona. */
  original: MovimientoConSesion;
  /** La clave y la huella de LA anulación (las deriva quien llama: una por movimiento anulado). */
  claveDeIdempotencia: string;
  huella: string;
  motivo: string | null | undefined;
  /** `movimientos_caja.anular_de_otros` en la anulación genérica; `true` cuando quien llama ya exigió su propia acción (la devolución). */
  puedeAnularDeOtros: boolean;
  /** Lo que la constancia `MOVIMIENTO_ANULADO` suma a lo de siempre (por ejemplo, la devolución a la que pertenece el egreso). */
  constanciaExtra?: Readonly<Record<string, Dato>> | undefined;
}>;

/**
 * UNA sola manera de anular un movimiento de caja (e3 §3.2), en la transacción de quien llama y sin autorizar: el espejo exacto (mismo medio y cuenta, importe opuesto,
 * motivo obligatorio) con las reglas del dominio (`decidirAnulacion`: una sola vez, sesión abierta, nunca un cobro, de quién es) y su constancia `MOVIMIENTO_ANULADO` en la
 * misma transacción. Lo usan la anulación genérica (`anularMovimientoDeCaja`) y la de una devolución (`anularDevolucion`): la regla no se escribe dos veces. La idempotencia
 * (buscar por clave antes de llamar) es de quien llama. Previene: dos copias de la regla que difieren (la anulación de la devolución anulando lo que el genérico rechaza).
 */
export async function anularMovimientoEnTx(
  tx: TxDeCaja,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeAnularMovimientoEnTx,
): Promise<Resultado<Readonly<{ anulacionId: string }>, ErrorDeAnulacion>> {
  const { empresaId, ahora } = contexto;
  const { original } = entrada;
  const espejo = decidirAnulacion({
    movimiento: movimientoAnulableDe(original),
    yaAnulado: (await tx.movimientos.anulacionDe(empresaId, original.id)) !== null,
    sesion: original.estadoDeLaSesion,
    actor: { personaId: persona, puedeAnularDeOtros: entrada.puedeAnularDeOtros },
    motivo: entrada.motivo,
  });
  if (!espejo.ok) return err(espejo.error);
  const anulacionId = await tx.movimientos.insertar({
    empresa: empresaId,
    sesionId: original.sesionId,
    clase: espejo.valor.clase,
    medioDePagoId: espejo.valor.medioDePagoId,
    cuentaDeCobroId: espejo.valor.cuentaDeCobroId,
    importe: espejo.valor.importe,
    motivo: espejo.valor.motivo,
    anulaA: original.id,
    corrigeJornada: null,
    registradoEn: ahora,
    registradoPor: persona,
    claveDeIdempotencia: entrada.claveDeIdempotencia,
    huella: entrada.huella,
  });
  await dejarConstancia(tx, contexto, persona, {
    accion: "MOVIMIENTO_ANULADO",
    entidad: "movimiento_caja",
    entidadId: anulacionId,
    despues: {
      sesionId: original.sesionId,
      movimientoAnuladoId: original.id,
      clase: original.clase,
      importe: importeATexto(espejo.valor.importe),
      motivo: espejo.valor.motivo,
      ...(entrada.constanciaExtra ?? {}),
    },
  });
  return ok({ anulacionId });
}
