import { comprobarQueOpera, type EstadosDeEmpresa } from "../../../contexto/estados";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { Dato } from "../../../puertos/sin-secretos";
import type { TipoDeComprobante } from "../dominio/comprobante-emitido";
import type { Ambiente } from "../dominio/comprobante-nuevo";
import type { PuntoDeVentaId } from "../dominio/identificadores";
import type { Serie } from "../dominio/numeracion";
import type { TxDeNumeracion } from "./contrato";
import type { PuntoDeVentaParaEmision } from "./emision-electronica";

/**
 * El estado de la empresa del contexto y el de su tenant, para decidir si opera. Las políticas de
 * lectura dejan ver siempre la empresa del contexto y su tenant: que falte es una configuración
 * rota, no un error de negocio.
 */
export async function empresaOpera(
  tx: Pick<TxDeNumeracion, "empresas" | "tenants">,
  id: EmpresaId,
) {
  const empresa = await tx.empresas.obtener(id);
  if (empresa === null) throw new Error(`la empresa ${id} no es visible para el contexto`);
  const tenant = await tx.tenants.obtener(empresa.tenantId);
  if (tenant === null) throw new Error(`el tenant de la empresa ${id} no es visible`);
  const estados: EstadosDeEmpresa = new Map([
    [id, { empresa: empresa.estado, tenant: tenant.estado }],
  ]);
  return comprobarQueOpera(id, estados);
}

/**
 * La entidad auditada de una serie: su clave natural (el punto de venta, el tipo y el ambiente). Sin el
 * ambiente, la auditoría de homologación y la de producción del mismo punto de venta se confundirían.
 */
export const entidadDeSerie = (
  puntoDeVenta: PuntoDeVentaId,
  tipo: TipoDeComprobante,
  ambiente: Ambiente,
): string => `${puntoDeVenta}:${tipo}:${ambiente}`;

/** El estado de una serie como dato de auditoría (los `bigint` viajan como texto). */
export function datosDeSerie(serie: Serie): Record<string, Dato> {
  const base = {
    estado: serie.estado,
    ambiente: serie.ambiente,
    ultimoNumero: serie.ultimoNumero.toString(),
  };
  switch (serie.estado) {
    case "LIBRE":
      return base;
    case "EN_CURSO":
      return {
        ...base,
        numeroEnCurso: serie.numeroEnCurso.toString(),
        solicitud: serie.solicitud,
        enCursoHasta: serie.enCursoHasta.toISOString(),
      };
    case "BLOQUEADA":
      return { ...base, motivoBloqueo: serie.motivoBloqueo };
  }
}

/**
 * Lo que el servicio de emisión necesita del punto de venta: el CUIT de su emisor y su número. El
 * emisor sale de la base (el principal usa el CUIT de la empresa); `null` si no se encuentra.
 */
export async function puntoDeVentaParaEmision(
  tx: TxDeNumeracion,
  empresa: EmpresaId,
  puntoDeVenta: PuntoDeVentaId,
) {
  const pv = await tx.puntosDeVenta.obtener(empresa, puntoDeVenta);
  if (pv === null) return null;
  const emisor = await tx.emisores.obtener(empresa, pv.emisorId);
  // La clave foránea compuesta garantiza que el emisor existe y es de la empresa.
  if (emisor === null) throw new Error(`el emisor ${pv.emisorId} del punto de venta no existe`);
  const paraEmision: PuntoDeVentaParaEmision = { cuit: emisor.cuit, numero: pv.numero };
  return { pv, emisor, paraEmision };
}
