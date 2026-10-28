import "server-only";

import { detalleDeFalla } from "../../../src/capacidades/experiencia/respuesta";
import { respuestaDeFalla } from "../../../src/composicion/a-respuesta";
import { errorParaLaPantalla, type ErrorParaLaPantalla } from "../logica/errores-de-plataforma";
import type { FiltrosDeEmpresas } from "../logica/filtros-de-empresas";
import { exigirAcceso } from "./acceso";

/** Una empresa tal como la muestra la lista: solo texto, sin ids internos de más. */
export type FilaDeEmpresa = Readonly<{
  id: string;
  razonSocial: string;
  cuit: string;
  submarca: string;
  plan: string;
  estadoEfectivo: string;
  motivoEstado: string | null;
}>;

export type Falla = Readonly<{
  ok: false;
  error: ErrorParaLaPantalla;
  referencia?: string;
}>;

export type ListaDeEmpresas =
  | Readonly<{ ok: true; filas: readonly FilaDeEmpresa[]; siguienteDespuesDeId: string | null }>
  | Falla;

export type OpcionesDeFiltros =
  | Readonly<{
      ok: true;
      submarcas: readonly { id: string; nombre: string }[];
      planes: readonly { id: string; nombre: string }[];
    }>
  | Falla;

export type SubmarcaDelAlta = Readonly<{
  id: string;
  nombre: string;
  elegible: boolean;
  motivoSiNo: string | null;
  planPorDefecto: string | null;
  modulosIniciales: readonly string[];
}>;

export type OpcionesDelAlta =
  | Readonly<{
      ok: true;
      submarcas: readonly SubmarcaDelAlta[];
      planes: readonly { versionDePlanId: string; nombre: string }[];
    }>
  | Falla;

/** Por qué una marca no sirve para el alta, en castellano (nunca el código técnico). */
const MOTIVOS_DE_MARCA: Readonly<Record<string, string>> = {
  MARCA_NO_ENCONTRADA: "La submarca no existe.",
  MARCA_RETIRADA: "La submarca está retirada.",
  MARCA_SIN_DEFINICION: "La submarca todavía no tiene su definición completa.",
  MARCA_SIN_DOMINIO: "La submarca todavía no tiene un dominio propio.",
  MARCA_SIN_PLAN_POR_DEFECTO: "La submarca no tiene un plan por defecto publicado.",
};
const MOTIVO_GENERICO_DE_MARCA = "La submarca no está lista para dar de alta empresas.";

/** Un fallo inesperado: detalle y referencia al registro del servidor; hacia afuera, solo la referencia. */
function inesperado(detalle: string): Falla {
  const publico = respuestaDeFalla(detalle, {
    registrar: (texto) => {
      console.error(`[empresas] ${texto}`);
    },
  });
  return {
    ok: false,
    error: { tipo: "INESPERADO" },
    ...(publico.referencia === undefined ? {} : { referencia: publico.referencia }),
  };
}

/** El error de un resultado, listo para la pantalla; si es inesperado, con su referencia. */
function falla(error: unknown): Falla {
  const paraLaPantalla = errorParaLaPantalla(error);
  if (paraLaPantalla.tipo === "INESPERADO") return inesperado(detalleDeFalla(error));
  return { ok: false, error: paraLaPantalla };
}

/** `redirect()` de `exigirAcceso` lanza a propósito: Next lo necesita para redirigir. */
function esRedireccion(excepcion: unknown): boolean {
  if (typeof excepcion !== "object" || excepcion === null) return false;
  const digest = (excepcion as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/** Corre una lectura capturando toda excepción: la pantalla nunca recibe el detalle. */
async function protegida<T>(lectura: () => Promise<T | Falla>): Promise<T | Falla> {
  try {
    return await lectura();
  } catch (excepcion) {
    if (esRedireccion(excepcion)) throw excepcion;
    return inesperado(detalleDeFalla(excepcion));
  }
}

export async function listaDeEmpresas(filtros: FiltrosDeEmpresas): Promise<ListaDeEmpresas> {
  return protegida(async () => {
    const acceso = await exigirAcceso();
    const resultado = await acceso.consultas.listarEmpresas({
      limite: 50,
      ...(filtros.estadoEfectivo === undefined ? {} : { estadoEfectivo: filtros.estadoEfectivo }),
      ...(filtros.marcaId === undefined ? {} : { marcaId: filtros.marcaId }),
      ...(filtros.planId === undefined ? {} : { planId: filtros.planId }),
      ...(filtros.buscar === undefined ? {} : { buscar: filtros.buscar }),
      ...(filtros.despuesDeId === undefined ? {} : { despuesDeId: filtros.despuesDeId }),
    });
    if (!resultado.ok) return falla(resultado.error);
    return {
      ok: true as const,
      filas: resultado.valor.filas.map((f): FilaDeEmpresa => ({
        id: f.id,
        razonSocial: f.razonSocial,
        cuit: f.cuit,
        submarca: f.marcaNombreVisible ?? f.marcaCodigo,
        plan: f.planNombreComercial ?? f.planCodigo ?? "—",
        estadoEfectivo: f.estadoEfectivo,
        motivoEstado: f.motivoEstado,
      })),
      siguienteDespuesDeId: resultado.valor.siguienteDespuesDeId,
    };
  });
}

export async function opcionesDeFiltros(): Promise<OpcionesDeFiltros> {
  return protegida(async () => {
    const acceso = await exigirAcceso();
    const [marcas, planes] = await Promise.all([
      acceso.consultas.listarMarcas(),
      acceso.consultas.listarPlanes(),
    ]);
    if (!marcas.ok) return falla(marcas.error);
    if (!planes.ok) return falla(planes.error);
    return {
      ok: true as const,
      submarcas: marcas.valor.marcas.map((m) => ({
        id: m.marca.id,
        nombre: m.nombreVisible ?? m.marca.codigo,
      })),
      planes: planes.valor.planes.map((p) => ({
        id: p.plan.id,
        nombre: p.ultimaVersion?.nombreComercial ?? p.plan.codigo,
      })),
    };
  });
}

export async function opcionesDelAlta(): Promise<OpcionesDelAlta> {
  return protegida(async () => {
    const acceso = await exigirAcceso();
    const [marcas, planes] = await Promise.all([
      acceso.consultas.marcasParaElAlta(),
      acceso.consultas.listarPlanes(),
    ]);
    if (!marcas.ok) return falla(marcas.error);
    if (!planes.ok) return falla(planes.error);
    return {
      ok: true as const,
      submarcas: marcas.valor.marcas.map((m): SubmarcaDelAlta => ({
        id: m.marcaId,
        nombre: m.nombre ?? m.codigo,
        elegible: m.elegible,
        motivoSiNo:
          m.motivoSiNo === null
            ? null
            : (MOTIVOS_DE_MARCA[m.motivoSiNo] ?? MOTIVO_GENERICO_DE_MARCA),
        planPorDefecto: m.planPorDefecto?.nombreComercial ?? null,
        modulosIniciales: [...m.modulosIniciales],
      })),
      planes: planes.valor.planes.flatMap((p) =>
        p.ultimaVersion === null
          ? []
          : [
              {
                versionDePlanId: p.ultimaVersion.versionDePlanId,
                nombre: p.ultimaVersion.nombreComercial,
              },
            ],
      ),
    };
  });
}
