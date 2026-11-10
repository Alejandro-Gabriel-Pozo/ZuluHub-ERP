import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { opcionDeMedioParaCobrar } from "../dominio/cobrar";
import type {
  ErrorAlConsultarOpcionesDeCobro,
  OpcionesDeCobro,
  TxDeLecturaDeCaja,
} from "./contrato";

/**
 * Qué ofrecer en la pantalla de cobro (e3 §3.5 y §3.9): SOLO los medios activos y, de cada uno, las cuentas activas de la sucursal de LA CAJA
 * que el medio admite (puede no haber ninguna: la cuenta es opcional, decisión 151; `cuentaObligatoria` es siempre `false`), qué datos
 * pide y las marcas de tarjeta activas. Lo ya cobrado con un medio desactivado se sigue viendo en otro lado: acá no se ofrece. Una caja que
 * no existe o está desactivada no ofrece nada. SOLO LEE.
 */
export async function opcionesDeCobro(
  tx: TxDeLecturaDeCaja,
  contexto: ContextoOperativo,
  cajaId: string,
): Promise<Resultado<OpcionesDeCobro, ErrorAlConsultarOpcionesDeCobro>> {
  const { empresaId } = contexto;
  const caja = await tx.cajas.obtener(empresaId, cajaId);
  if (caja === null) return err("CAJA_NO_ENCONTRADA");
  if (!caja.activa) return err("CAJA_INACTIVA");
  const medios = await tx.mediosDePago.listar(empresaId, { incluirInactivos: false });
  const cuentas = await tx.cuentasDeCobro.listar(empresaId, {
    sucursales: [caja.sucursalId],
    incluirInactivas: false,
  });
  return ok({
    medios: medios.map((medio) => opcionDeMedioParaCobrar(medio, cuentas)),
    marcasDeTarjeta: await tx.cobros.marcasActivas(),
  });
}
