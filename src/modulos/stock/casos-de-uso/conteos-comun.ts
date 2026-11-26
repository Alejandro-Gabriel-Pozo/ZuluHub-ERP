import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { instanteDeLaHora } from "../../../primitivas/tiempo/instante-de-la-hora";
import { datosDeJornada } from "../../empresas/publico";
import type { Conteo } from "../persistencia/modelo";
import { exigirAlcanceDeSucursal } from "./comun";
import type { TxDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";
import { leerId } from "./movimientos-comun";

/** Lo que comparten abrir, registrar, aplicar y cancelar un conteo (E5 §3.2). */

/**
 * La clave de idempotencia del ajuste por conteo: derivada de forma determinística del conteo, así que aplicar dos veces es una sola vez. No es
 * un UUID: lo que manda la pantalla (UUID) no puede ocuparla (`leerClave`).
 */
export const claveDelAjusteDeConteo = (conteoId: string): string => `conteo_${conteoId}`;

/**
 * El conteo de la persona, con el alcance de la sucursal de su depósito: inexistente (o de otra empresa) es `CONTEO_NO_ENCONTRADO`; un
 * depósito fuera del alcance de quien pide, `SUCURSAL_FUERA_DE_ALCANCE`. `bloquear`: con `SELECT … FOR UPDATE`, para serializar aplicar,
 * cancelar y registrar sobre el mismo conteo.
 */
export async function cargarConteo(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  id: unknown,
  bloquear: boolean,
): Promise<Resultado<Conteo, ErrorDeStock>> {
  const conteoId = leerId(id);
  if (conteoId === null) return err("CONTEO_NO_ENCONTRADO");
  const conteo = bloquear
    ? await tx.conteosDeStock.bloquear(contexto.empresaId, conteoId)
    : await tx.conteosDeStock.obtener(contexto.empresaId, conteoId);
  if (conteo === null) return err("CONTEO_NO_ENCONTRADO");
  const deposito = await tx.depositos.obtener(contexto.empresaId, conteo.depositoId);
  if (deposito === null) throw new Error("el depósito de un conteo no existe");
  const alcance = await exigirAlcanceDeSucursal(tx, contexto, deposito.sucursalId);
  return alcance.ok ? ok(conteo) : alcance;
}

/**
 * La hora de pared que escribió quien cuenta («14:30») como el instante más reciente que ya pasó en la zona de la sucursal del depósito (UTC-3). Se resuelve ACÁ, con la zona de la empresa leída en la transacción, y no en la
 * pantalla: quien cuenta (el operador) no puede leer la ficha de la sucursal y la zona no la decide el navegador. Un texto que no es `HH:MM` es `IDENTIFICADOR_INVALIDO`; una sucursal que no se puede fechar es una configuración
 * rota (la base valida la zona al guardarla): se frena. La ventana (jornada vigente o anterior, no anterior al último conteo aplicado) la sigue comprobando `registrarConteo` sobre el instante resultante.
 */
export async function instanteDeLaHoraDelConteo(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  depositoId: string,
  hora: unknown,
): Promise<Resultado<Date, ErrorDeStock>> {
  if (typeof hora !== "string") return err("IDENTIFICADOR_INVALIDO");
  const deposito = await tx.depositos.obtener(contexto.empresaId, depositoId);
  if (deposito === null) throw new Error("el depósito de un conteo no existe");
  const datos = await datosDeJornada(tx, deposito.sucursalId);
  if (!datos.ok) return err("SUCURSAL_NO_ENCONTRADA");
  const instante = instanteDeLaHora(hora, datos.valor.zonaHoraria, contexto.ahora);
  if (instante.ok) return ok(instante.valor);
  if (instante.error === "HORA_DEL_DIA_INVALIDA") return err("IDENTIFICADOR_INVALIDO");
  throw new Error(`la sucursal ${deposito.sucursalId} no se puede fechar`);
}
