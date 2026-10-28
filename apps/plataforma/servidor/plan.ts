import "server-only";

import { armarPlanDeEmpresa, type PlanDeEmpresa } from "../logica/plan-de-empresa";
import { detalleDeFalla } from "../../../src/capacidades/experiencia/respuesta";
import { errorParaLaPantalla } from "../logica/errores-de-plataforma";
import { exigirAcceso } from "./acceso";
import { fallaInesperada, protegida, type Falla } from "./proteccion";

export type { PlanDeEmpresa } from "../logica/plan-de-empresa";
export type { Falla } from "./proteccion";

const ETIQUETA = "plan";
const TEXTO_PANTALLA_VIEJA = "La pantalla quedó vieja. Volvé a abrirla y probá de nuevo.";
const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El error de un resultado para la pantalla, con el contexto del plan; lo inesperado, con su referencia. */
function fallaDelPlan(error: unknown): Falla {
  const paraLaPantalla = errorParaLaPantalla(error, "PLAN");
  if (paraLaPantalla.tipo === "INESPERADO") return fallaInesperada(ETIQUETA, detalleDeFalla(error));
  return { ok: false, error: paraLaPantalla };
}

export type ResultadoDelPlan = Readonly<{ ok: true; plan: PlanDeEmpresa }> | Falla;

/**
 * El plan de una empresa: lo que rige hoy, lo programado, los módulos, las perillas y los planes elegibles.
 * El «en uso» es solo empresas por cliente frente a su tope: la plataforma no conoce el uso operativo.
 */
export async function planDeEmpresa(empresaId: string): Promise<ResultadoDelPlan> {
  return protegida(ETIQUETA, async () => {
    if (!FORMA_DE_UUID.test(empresaId)) {
      return {
        ok: false as const,
        error: { tipo: "PANTALLA_VIEJA" as const, texto: TEXTO_PANTALLA_VIEJA },
      };
    }
    const acceso = await exigirAcceso();
    const derechos = await acceso.consultas.derechosDeUsoDeEmpresa({ empresaId });
    if (!derechos.ok) return fallaDelPlan(derechos.error);
    const tenantId = derechos.valor.tenantId;
    const [plan, planes, empresas] = await Promise.all([
      acceso.consultas.planDelTenant({ tenantId }),
      acceso.consultas.listarPlanes(),
      acceso.consultas.listarEmpresas({ tenantId, limite: 100 }),
    ]);
    if (!plan.ok) return fallaDelPlan(plan.error);
    if (!planes.ok) return fallaDelPlan(planes.error);

    // El nombre es un adorno: si no se puede leer, la pantalla dice «Empresa».
    const fila = empresas.ok ? empresas.valor.filas.find((f) => f.id === empresaId) : undefined;

    // `listarTenants` no filtra por id. Se busca por el nombre del cliente (una sola lectura, que ya
    // trae `empresasEnUso` y el tope efectivo) y se elige el de este id. Si no aparece, `null`.
    let cliente = null;
    if (fila !== undefined) {
      const tenants = await acceso.consultas.listarTenants({
        buscar: fila.tenantNombre,
        limite: 100,
      });
      if (tenants.ok) cliente = tenants.valor.filas.find((t) => t.id === tenantId) ?? null;
    }

    return {
      ok: true as const,
      plan: armarPlanDeEmpresa({
        derechos: derechos.valor,
        plan: plan.valor,
        planes: planes.valor,
        razonSocial: fila?.razonSocial ?? null,
        cliente,
      }),
    };
  });
}
