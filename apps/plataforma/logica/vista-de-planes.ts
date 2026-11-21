/** Lo que la pantalla «Planes» muestra, armado desde las consultas del servidor. Puro: sin Next ni React; todo serializable (fechas como texto). */
import type { ValorDePerilla } from "../../../src/capacidades/planes/valores";
import type {
  FichaDePlan,
  PlanEnLista,
} from "../../../src/plataforma/consultas/consultas-de-planes";

export type FilaDePlan = Readonly<{
  id: string;
  codigo: string;
  retirado: boolean;
  ultima: Readonly<{ numero: number; nombreComercial: string }> | null;
  hayBorrador: boolean;
  clientes: number;
}>;

export type VersionVista = Readonly<{
  id: string;
  numero: number | null;
  borrador: boolean;
  nombreComercial: string;
  modulos: readonly string[];
  perillas: Readonly<Record<string, ValorDePerilla>>;
  motivo: string | null;
  publicadaEn: string | null;
  publicadaPor: string | null;
  /** La `version` de la fila: la `versionEsperada` de la próxima edición del borrador. */
  version: number;
  clientes: number;
}>;

export type FichaVista = Readonly<{
  id: string;
  codigo: string;
  retirado: boolean;
  /** La última publicada (la base de «Nueva versión desde la vN»). */
  ultima: VersionVista | null;
  borrador: VersionVista | null;
  /** Las publicadas, la última primero. */
  publicadas: readonly VersionVista[];
}>;

const FECHA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  dateStyle: "short",
  timeStyle: "short",
});

export const filaDePlan = (e: PlanEnLista, clientes: number): FilaDePlan => ({
  id: e.plan.id,
  codigo: e.plan.codigo,
  retirado: e.plan.estado === "RETIRADO",
  ultima:
    e.ultimaVersion === null
      ? null
      : { numero: e.ultimaVersion.numero, nombreComercial: e.ultimaVersion.nombreComercial },
  hayBorrador: e.hayBorrador,
  clientes,
});

export function fichaVista(f: FichaDePlan): FichaVista {
  const versiones: VersionVista[] = f.versiones.map((v) => ({
    id: v.versionDePlanId,
    numero: v.numero,
    borrador: v.estado === "BORRADOR",
    nombreComercial: v.nombreComercial,
    modulos: v.modulos,
    perillas: v.perillas,
    motivo: v.motivo,
    publicadaEn: v.publicadaEn === null ? null : FECHA.format(v.publicadaEn),
    publicadaPor: v.publicadaPor,
    version: v.version,
    clientes: v.tenantsConLaVersion,
  }));
  const publicadas = versiones.filter((v) => !v.borrador).reverse();
  return {
    id: f.plan.id,
    codigo: f.plan.codigo,
    retirado: f.plan.estado === "RETIRADO",
    ultima: publicadas[0] ?? null,
    borrador: versiones.find((v) => v.borrador) ?? null,
    publicadas,
  };
}
