import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  anularItemEnviadoEnTx,
  enviarACocinaEnTx,
  pedirQueSalgaEnTx,
  type EntradaDeAnularItemEnviado,
  type EntradaDeEnviarACocina,
  type EntradaDePedirQueSalga,
  type SalidaDeAnularItemEnviado,
  type SalidaDeEnvio,
} from "../../comandas/publico";
import { cuentaPorId } from "../../ventas/publico";
import { armarComando, exigirAlcance, exigirUuid } from "./comun";
import type { DependenciasDeSalon, TxDeSalon } from "./contrato";
import { claseDeCuenta, exigirCuentaUsable, rotuloDeLaCuenta } from "./cuenta-de-mesa";
import type { ErrorDeSalon } from "./errores";

type R<S> = Resultado<S, ErrorDeSalon>;

/** Lo que manda la pantalla al enviar: el rótulo («Mesa 5») NO viene del cliente, lo arma el servidor desde la mesa. */
export type EntradaDeEnviarMesa = Omit<EntradaDeEnviarACocina, "rotulo">;
export type EntradaDePedirQueSalgaMesa = Omit<EntradaDePedirQueSalga, "rotulo">;
export type EntradaDeAnularItemDeMesa = Omit<EntradaDeAnularItemEnviado, "rotulo">;

/** La cuenta del salón de esa entrada, en el alcance de quien pide, y el rótulo de su mesa armado por el servidor. */
async function cuentaYRotulo(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  cuentaId: string,
): Promise<R<string>> {
  const ids = exigirUuid(cuentaId);
  if (!ids.ok) return ids;
  const cuenta = await cuentaPorId(tx, contexto.empresaId, cuentaId);
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  const clase = exigirCuentaUsable(await claseDeCuenta(tx, contexto, cuenta), true);
  if (!clase.ok) return clase;
  return rotuloDeLaCuenta(tx, contexto, cuenta, clase.valor);
}

/**
 * Enviar a cocina, pedir que salga y anular un ítem ya enviado DESDE LA MESA (E7 §3.4 y §3.5): el salón valida que la cuenta es de una mesa suya, arma el
 * rótulo del papel («Mesa N») desde la mesa (nada de eso se confía al cliente) y llama a comandas dentro de LA MISMA transacción. Todo lo demás (números
 * de envío sin huecos, líneas que salen en un solo envío, aviso de anulación, impresión) es de comandas.
 */
export function armarEnvios(dependencias: DependenciasDeSalon) {
  const comando = armarComando(dependencias);
  return {
    enviarACocina: comando(
      ["comandas.enviar"],
      async (
        tx: TxDeSalon,
        contexto: ContextoOperativo,
        persona: PersonaId,
        entrada: EntradaDeEnviarMesa,
      ): Promise<R<SalidaDeEnvio>> => {
        const rotulo = await cuentaYRotulo(tx, contexto, entrada.cuentaId);
        if (!rotulo.ok) return rotulo;
        return enviarACocinaEnTx(tx, contexto, persona, { ...entrada, rotulo: rotulo.valor });
      },
    ),
    pedirQueSalga: comando(
      ["comandas.enviar"],
      async (
        tx: TxDeSalon,
        contexto: ContextoOperativo,
        persona: PersonaId,
        entrada: EntradaDePedirQueSalgaMesa,
      ): Promise<R<SalidaDeEnvio>> => {
        const rotulo = await cuentaYRotulo(tx, contexto, entrada.cuentaId);
        if (!rotulo.ok) return rotulo;
        return pedirQueSalgaEnTx(tx, contexto, persona, { ...entrada, rotulo: rotulo.valor });
      },
    ),
    anularItemEnviado: comando(
      ["cuentas.anular_linea", "cuentas.agregar_linea"],
      async (
        tx: TxDeSalon,
        contexto: ContextoOperativo,
        persona: PersonaId,
        entrada: EntradaDeAnularItemDeMesa,
      ): Promise<R<SalidaDeAnularItemEnviado>> => {
        const rotulo = await cuentaYRotulo(tx, contexto, entrada.cuentaId);
        if (!rotulo.ok) return rotulo;
        return anularItemEnviadoEnTx(tx, contexto, persona, { ...entrada, rotulo: rotulo.valor });
      },
    ),
  };
}
