import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import type { VersionDePlanId } from "../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import { versionDePlanDelTenantNuevo } from "../casos-de-uso/alta-nucleo";
import { decidirMarcaDelAlta } from "../dominio/alta-con-marca";
import { exigirAccionDePlataforma } from "./comun";
import type {
  DependenciasDeConsultasDeMarcasYPlanes,
  MarcaParaElAlta,
  PlanPorDefectoDelAlta,
  TxDeConsultasDeMarcasYPlanes,
  VistaDeMarcasParaElAlta,
} from "./contrato-de-marcas-y-planes";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES as D } from "./declaraciones-de-marcas-y-planes";

const LECTURA = { aislamiento: "read committed", soloLectura: true } as const;

export type ErrorAlVerMarcasParaElAlta = MotivoDeRechazo | ErrorDePersistencia;

/** La versión de plan que el alta asignaría, con el código de su plan, su número y su nombre comercial. */
async function detalleDelPlan(
  tx: TxDeConsultasDeMarcasYPlanes,
  leidos: Map<VersionDePlanId, PlanPorDefectoDelAlta>,
  id: VersionDePlanId,
): Promise<PlanPorDefectoDelAlta> {
  const conocido = leidos.get(id);
  if (conocido !== undefined) return conocido;
  const version = await tx.planes.versionPorId(id);
  // El alta acaba de ver esa versión PUBLICADA (`decidirPlanPorDefecto`), y una publicada tiene número y plan.
  if (version === null || version.numero === null) {
    throw new RangeError(`la versión de plan ${id} publicada no se puede leer`);
  }
  const plan = await tx.planes.obtenerPlan(version.planId);
  if (plan === null) throw new RangeError(`la versión de plan ${id} no tiene plan`);
  const detalle: PlanPorDefectoDelAlta = {
    planId: plan.id,
    codigo: plan.codigo,
    versionDePlanId: id,
    numero: version.numero,
    nombreComercial: version.nombreComercial,
  };
  leidos.set(id, detalle);
  return detalle;
}

/**
 * Las marcas con lo que el formulario de alta necesita: si se puede dar de alta una empresa con tenant nuevo
 * por esa marca, por qué no, con qué plan por defecto nacería y qué módulos propone (M6, consola). `marcas.ver`,
 * solo lectura.
 *
 * NO copia ninguna regla del alta: por cada marca hace lo que hace `crearAltaEnTransaccion`, con las mismas
 * piezas y en el mismo orden: la misma lectura (`LecturaDeMarcaParaElAlta.delAlta`), `decidirMarcaDelAlta`
 * y, sin versión de plan elegida, `versionDePlanDelTenantNuevo` (que usa `decidirPlanPorDefecto`). Una prueba
 * recorre marcas elegibles y no elegibles y ejecuta el alta real contra cada una. Es UNA lectura de la marca por
 * marca (hoy son pocas); si llegaran a ser cientos habría que pasar a una lectura en lote, sin tocar la regla.
 */
export function armarMarcasParaElAlta({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function marcasParaElAlta(
    contexto: ContextoDePlataforma,
  ): Promise<Resultado<VistaDeMarcasParaElAlta, ErrorAlVerMarcasParaElAlta>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (tx): Promise<Resultado<VistaDeMarcasParaElAlta, MotivoDeRechazo>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.marcasParaElAlta.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;

        // Un plan por defecto lo comparten muchas marcas: el plan y su versión se leen una vez.
        const planes = new Map<VersionDePlanId, PlanPorDefectoDelAlta>();
        const marcas: MarcaParaElAlta[] = [];
        for (const marca of await tx.marcas.listar()) {
          const datos = await tx.marcaParaElAlta.delAlta(marca.id, contexto.ahora);
          const base = {
            marcaId: marca.id,
            codigo: marca.codigo,
            nombre: datos?.cadena[0]?.nombreVisible ?? null,
          };
          const decidida = decidirMarcaDelAlta(datos);
          if (!decidida.ok) {
            marcas.push({
              ...base,
              elegible: false,
              motivoSiNo: decidida.error,
              planPorDefecto: null,
              modulosIniciales: [],
            });
            continue;
          }
          const { modulosIniciales } = decidida.valor;
          const version = await versionDePlanDelTenantNuevo(tx, null, decidida.valor);
          if (!version.ok) {
            marcas.push({
              ...base,
              elegible: false,
              // Sin versión elegida, el único error posible es la falta de plan por defecto utilizable.
              motivoSiNo: "MARCA_SIN_PLAN_POR_DEFECTO",
              planPorDefecto: null,
              modulosIniciales,
            });
            continue;
          }
          marcas.push({
            ...base,
            elegible: true,
            motivoSiNo: null,
            planPorDefecto: await detalleDelPlan(tx, planes, version.valor),
            modulosIniciales,
          });
        }
        return ok({ marcas });
      },
    );
  };
}
