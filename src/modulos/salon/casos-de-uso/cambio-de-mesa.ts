import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { cuentaAbiertaPorAncla, cuentaPorId, reanclarCuentaEnTx } from "../../ventas/publico";
import { exigirAlcance, exigirUuid, prepararComando, traducir } from "./comun";
import type { DependenciasDeSalon, TxDeSalon } from "./contrato";
import { ANCLA_DE_MESA, claseDeCuenta, exigirCuentaUsable } from "./cuenta-de-mesa";
import type { ErrorDeSalon } from "./errores";

type R<S> = Resultado<S, ErrorDeSalon>;

export type EntradaDeCambiarDeMesa = Readonly<{ cuentaId: string; mesaDestinoId: string }>;
export type SalidaDeCambiarDeMesa = Readonly<{ yaExistia: boolean }>;

/**
 * `cambiarDeMesa` (E7 §3.4, D59): la cuenta pasa ENTERA (lo enviado y lo no enviado) a una mesa LIBRE de la misma sucursal. Guard (`salon.cambiar_mesa`).
 * No se cambia la cuenta de reserva de una unión ni una cuenta dividida. Mesa ocupada: `MESA_NO_LIBRE`, también si otro mozo la ocupó a la vez (lo decide
 * el índice de ancla de la base: gana uno). Los envíos ya hechos conservan su rótulo original (son una foto). Mismo destino otra vez: `yaExistia`.
 * Audita `MESA_CAMBIADA` con la mesa de origen y la de destino.
 */
async function cambiar(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeCambiarDeMesa,
): Promise<R<SalidaDeCambiarDeMesa>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.cuentaId, entrada.mesaDestinoId);
  if (!ids.ok) return ids;
  const cuenta = await cuentaPorId(tx, empresaId, entrada.cuentaId);
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  const clase = exigirCuentaUsable(await claseDeCuenta(tx, contexto, cuenta), false);
  if (!clase.ok) return clase;
  if (cuenta.estado !== "ABIERTA") return err("CUENTA_NO_ABIERTA");
  const destino = await tx.mesas.obtener(empresaId, entrada.mesaDestinoId);
  if (destino === null) return err("MESA_NO_ENCONTRADA");
  if (destino.sucursalId !== cuenta.sucursalId) return err("SUCURSAL_DISTINTA");
  if (!destino.activa) return err("MESA_INACTIVA");
  if (cuenta.ancla !== null && cuenta.ancla.id === destino.id) return ok({ yaExistia: true });
  const ancla = { tipo: ANCLA_DE_MESA, id: destino.id };
  if ((await cuentaAbiertaPorAncla(tx, empresaId, ancla)) !== null) return err("MESA_NO_LIBRE");
  const movida = await reanclarCuentaEnTx(tx, contexto, persona, { cuentaId: cuenta.id, ancla });
  if (!movida.ok) return movida.error === "ANCLA_OCUPADA" ? err("MESA_NO_LIBRE") : movida;
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "MESA_CAMBIADA",
    entidad: "cuenta_consumo",
    entidadId: cuenta.id,
    antes: { mesaId: cuenta.ancla === null ? null : cuenta.ancla.id },
    despues: { mesaId: destino.id, numero: destino.numero },
  });
  return ok({ yaExistia: movida.valor.yaExistia });
}

export function armarCambioDeMesa(dependencias: DependenciasDeSalon) {
  return {
    async cambiarDeMesa(
      contexto: ContextoOperativo,
      entrada: EntradaDeCambiarDeMesa,
    ): Promise<R<SalidaDeCambiarDeMesa>> {
      const resultado = await dependencias.transacciones.ejecutar({ contexto }, async (tx) => {
        const persona = await prepararComando(tx, contexto, dependencias.reglas, [
          "salon.cambiar_mesa",
        ]);
        if (!persona.ok) return persona;
        return cambiar(tx, contexto, persona.valor, entrada);
      });
      return traducir(resultado, dependencias.stock);
    },
  };
}
