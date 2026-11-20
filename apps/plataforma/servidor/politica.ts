import "server-only";

import { detalleDeFalla } from "../../../src/capacidades/experiencia/respuesta";
import {
  PERMISOS_DE_PLATAFORMA,
  type RolDePlataforma,
} from "../../../src/capacidades/permisos/plataforma";
import type { PoliticaGuardada } from "../../../src/modulos/planes/publico";
import { errorDePolitica } from "../logica/errores-de-politica";
import type { VersionDePolitica } from "../logica/politica-de-plan";
import { exigirAcceso } from "./acceso";
import { fallaInesperada, protegida, type Falla } from "./proteccion";

export type { Falla } from "./proteccion";

const ETIQUETA = "politica-de-plan";

export type DatosDePolitica =
  | Readonly<{
      ok: true;
      vigente: VersionDePolitica;
      historial: readonly VersionDePolitica[];
      /** Solo una ayuda de la pantalla (muestra u oculta el botón): definir la vuelve a exigir el servidor (guard). */
      puedeDefinir: boolean;
    }>
  | Falla;

function vista(p: PoliticaGuardada): VersionDePolitica {
  return {
    version: p.version,
    suba: p.diasDeAnticipacionDeSuba,
    baja: p.diasDeAnticipacionDeBaja,
    arrepentimiento: p.diasDeArrepentimiento,
    motivo: p.motivo,
    definidaPor: p.definidaPor,
    creadoEn: p.creadoEn.toISOString(),
  };
}

const puede = (rol: RolDePlataforma): boolean =>
  (PERMISOS_DE_PLATAFORMA["politica_de_plan.definir"] as readonly RolDePlataforma[]).includes(rol);

/** La política vigente y su historial (`planes.ver`). Rol desconocido: no puede definir (todo nace cerrado). */
export async function politicaDeCambioDePlan(): Promise<DatosDePolitica> {
  return protegida(ETIQUETA, async () => {
    const acceso = await exigirAcceso();
    const r = await acceso.consultas.verPoliticaDeCambioDePlan();
    if (!r.ok) {
      const paraLaPantalla = errorDePolitica(r.error);
      if (paraLaPantalla.tipo === "INESPERADO")
        return fallaInesperada(ETIQUETA, detalleDeFalla(r.error));
      return { ok: false as const, error: paraLaPantalla };
    }
    return {
      ok: true as const,
      vigente: vista(r.valor.vigente),
      historial: r.valor.historial.map(vista),
      puedeDefinir: puede(acceso.admin.rol),
    };
  });
}
