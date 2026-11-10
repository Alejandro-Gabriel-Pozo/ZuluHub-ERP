import type { ContextoOperativo } from "../../../contexto/contexto";
import { esUuidCanonico, sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaDeNegocio } from "../../../primitivas/tiempo/fecha-de-negocio";
import { jornadaDeSucursal } from "../../cierre/publico";
import { datosDeJornada } from "../../empresas/publico";
import { jornadaVencida } from "../dominio/jornada-de-caja";
import { estadoDeCaja } from "../dominio/sesion";
import type {
  CajaParaCobrar,
  ErrorAlConsultarCajasParaCobrar,
  EstadoDeCajasParaCobrar,
  TxDeLecturaDeCaja,
} from "./contrato";

/**
 * Qué mostrar antes de cobrar (e3 §3.5, decisión 145): por cada caja ACTIVA de la sucursal, si no tiene sesión (`SIN_SESION`: «abrí la caja»),
 * está abierta o está en cierre (contándose), y si su sesión sigue abierta después de su jornada (`jornadaVencida`); y la jornada de hoy de
 * la sucursal con su estado: si no es `ABIERTA`, abrir una caja daría `JORNADA_EN_AUDITORIA` o `JORNADA_CERRADA` y el botón no se ofrece.
 * Una sucursal sin cajas activas devuelve `cajas: []`. SOLO LEE: no abre ni crea nada (ni la caja por defecto ni la jornada); la jornada
 * sin actividad todavía es `ABIERTA` porque abrir la caja la crea. La fecha de hoy es la de la hora de corte de la sucursal y la zona de la
 * empresa, leídas ahora y sin caché. SUPUESTO: la sucursal ajena o inexistente es `SUCURSAL_NO_ENCONTRADA` (la RLS las hace indistinguibles).
 */
export async function estadoDeCajasParaCobrar(
  tx: TxDeLecturaDeCaja,
  contexto: ContextoOperativo,
  sucursal: string,
): Promise<Resultado<EstadoDeCajasParaCobrar, ErrorAlConsultarCajasParaCobrar>> {
  const { empresaId, ahora } = contexto;
  if (!esUuidCanonico(sucursal)) return err("SUCURSAL_NO_ENCONTRADA");
  const id = sucursalId(sucursal);
  const datos = await datosDeJornada(tx, id);
  if (!datos.ok) return datos;
  const hoy = fechaDeNegocio(ahora, datos.valor.zonaHoraria, datos.valor.horaDeCorte);
  if (!hoy.ok) return hoy;
  const estadoDeLaJornada = await jornadaDeSucursal.estadoDeJornada(tx, empresaId, id, hoy.valor);

  const cajas: CajaParaCobrar[] = [];
  for (const caja of await tx.cajas.listarDeLaSucursal(empresaId, id, {
    incluirInactivas: false,
  })) {
    const sesion = await tx.sesiones.vigenteDeLaCaja(empresaId, caja.id);
    const vencida =
      sesion === null ? ok(false) : jornadaVencida(ahora, sesion, sesion.fechaDeNegocio);
    if (!vencida.ok) return vencida;
    cajas.push({
      cajaId: caja.id,
      nombre: caja.nombre,
      estado: estadoDeCaja(sesion?.estado ?? null),
      sesionId: sesion?.id ?? null,
      fechaDeNegocio: sesion?.fechaDeNegocio ?? null,
      jornadaVencida: vencida.valor,
    });
  }
  return ok({
    cajas,
    jornadaActual: {
      fechaDeNegocio: hoy.valor,
      estado: estadoDeLaJornada === "SIN_ACTIVIDAD" ? "ABIERTA" : estadoDeLaJornada,
    },
  });
}
