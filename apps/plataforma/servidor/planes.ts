import "server-only";

import {
  fichaVista,
  filaDePlan,
  type FichaVista,
  type FilaDePlan,
} from "../logica/vista-de-planes";
import { errorDePlanes } from "../logica/errores-de-planes";
import { permisosDePlanes, type PermisosDePlanes } from "../logica/permisos-de-planes";
import { detalleDeFalla } from "../../../src/capacidades/experiencia/respuesta";
import { exigirAcceso } from "./acceso";
import { fallaInesperada, protegida, type Falla } from "./proteccion";

export type { Falla } from "./proteccion";

const ETIQUETA = "planes";
const VISTA_VIEJA = "La pantalla quedó vieja. Volvé a abrirla y probá de nuevo.";
const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Cuántos clientes se listan de una versión: una página (el tope del servidor es 100). */
const CLIENTES_POR_PAGINA = 100;

function falla(error: unknown): Falla {
  const paraLaPantalla = errorDePlanes(error);
  if (paraLaPantalla.tipo === "INESPERADO") return fallaInesperada(ETIQUETA, detalleDeFalla(error));
  return { ok: false, error: paraLaPantalla };
}

const idInvalido = (): Falla => ({
  ok: false,
  error: { tipo: "PANTALLA_VIEJA", texto: VISTA_VIEJA },
});

export type ListaDePlanes =
  Readonly<{ ok: true; planes: readonly FilaDePlan[]; puede: PermisosDePlanes }> | Falla;
export type DatosDeFicha =
  Readonly<{ ok: true; ficha: FichaVista; puede: PermisosDePlanes }> | Falla;
export type ClienteDeVersion = Readonly<{ id: string; nombre: string }>;
export type DatosDeVersion =
  Readonly<{ ok: true; ficha: FichaVista; clientes: readonly ClienteDeVersion[] }> | Falla;

/** Los planes, con su última versión publicada, si hay borrador y cuántos clientes lo tienen (`planes.ver`). */
export async function listaDePlanes(): Promise<ListaDePlanes> {
  return protegida(ETIQUETA, async () => {
    const acceso = await exigirAcceso();
    const lista = await acceso.consultas.listarPlanes();
    if (!lista.ok) return falla(lista.error);
    const filas: FilaDePlan[] = [];
    for (const e of lista.valor.planes) {
      const ficha = await acceso.consultas.fichaDePlan({ planId: e.plan.id });
      if (!ficha.ok) return falla(ficha.error);
      filas.push(filaDePlan(e, ficha.valor.tenantsConElPlan));
    }
    return { ok: true as const, planes: filas, puede: permisosDePlanes(acceso.admin.rol) };
  });
}

/** La ficha de un plan con sus versiones (`planes.ver`). Un id que no es UUID es una pantalla vieja, no un error. */
export async function fichaDelPlan(planId: string): Promise<DatosDeFicha> {
  return protegida(ETIQUETA, async () => {
    if (!FORMA_DE_UUID.test(planId)) return idInvalido();
    const acceso = await exigirAcceso();
    const ficha = await acceso.consultas.fichaDePlan({ planId });
    if (!ficha.ok) return falla(ficha.error);
    return {
      ok: true as const,
      ficha: fichaVista(ficha.valor),
      puede: permisosDePlanes(acceso.admin.rol),
    };
  });
}

/** Una versión publicada del plan y los clientes que la usan hoy (`planes.ver`). */
export async function versionDelPlan(planId: string, versionId: string): Promise<DatosDeVersion> {
  return protegida(ETIQUETA, async () => {
    if (!FORMA_DE_UUID.test(planId) || !FORMA_DE_UUID.test(versionId)) return idInvalido();
    const acceso = await exigirAcceso();
    const ficha = await acceso.consultas.fichaDePlan({ planId });
    if (!ficha.ok) return falla(ficha.error);
    const vista = fichaVista(ficha.valor);
    if (!vista.publicadas.some((v) => v.id === versionId)) return idInvalido();
    const clientes = await acceso.consultas.tenantsConLaVersion({
      versionDePlanId: versionId,
      limite: CLIENTES_POR_PAGINA,
    });
    if (!clientes.ok) return falla(clientes.error);
    return {
      ok: true as const,
      ficha: vista,
      clientes: clientes.valor.filas.map((c) => ({ id: c.tenantId, nombre: c.nombre })),
    };
  });
}
