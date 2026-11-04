import "server-only";

import { armarFichaDeSubmarca, type FichaDeSubmarca } from "../logica/ficha-de-submarca";
import { exigirAcceso } from "./acceso";
import { fallaDe, protegida, type Falla } from "./proteccion";

export type { FichaDeSubmarca } from "../logica/ficha-de-submarca";
export type { Falla } from "./proteccion";

const ETIQUETA = "submarcas";
const TEXTO_PANTALLA_VIEJA = "La pantalla quedó vieja. Volvé a abrirla y probá de nuevo.";
const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una submarca tal como la muestra la lista: solo texto y marcas, sin más ids internos. */
export type FilaDeSubmarca = Readonly<{
  id: string;
  codigo: string;
  nombre: string;
  estado: string;
  versionVigente: number | null;
  hayBorrador: boolean;
  hayProgramada: boolean;
}>;

export type ListaDeSubmarcas = Readonly<{ ok: true; submarcas: readonly FilaDeSubmarca[] }> | Falla;

export type ResultadoDeFicha = Readonly<{ ok: true; ficha: FichaDeSubmarca }> | Falla;

export async function listaDeSubmarcas(): Promise<ListaDeSubmarcas> {
  return protegida(ETIQUETA, async () => {
    const acceso = await exigirAcceso();
    const resultado = await acceso.consultas.listarMarcas();
    if (!resultado.ok) return fallaDe(ETIQUETA, resultado.error);
    return {
      ok: true as const,
      submarcas: resultado.valor.marcas.map((m): FilaDeSubmarca => ({
        id: m.marca.id,
        codigo: m.marca.codigo,
        nombre: m.nombreVisible ?? m.marca.codigo,
        estado: m.marca.estado,
        versionVigente: m.versionVigente,
        hayBorrador: m.hayBorrador,
        hayProgramada: m.hayProgramada,
      })),
    };
  });
}

export async function fichaDeSubmarca(marcaId: string): Promise<ResultadoDeFicha> {
  return protegida(ETIQUETA, async () => {
    if (!FORMA_DE_UUID.test(marcaId)) {
      return {
        ok: false as const,
        error: { tipo: "PANTALLA_VIEJA" as const, texto: TEXTO_PANTALLA_VIEJA },
      };
    }
    const acceso = await exigirAcceso();
    const [ficha, catalogos] = await Promise.all([
      acceso.consultas.fichaDeMarca({ marcaId }),
      acceso.consultas.catalogosDeMarca(),
    ]);
    if (!ficha.ok) return fallaDe(ETIQUETA, ficha.error);
    if (!catalogos.ok) return fallaDe(ETIQUETA, catalogos.error);
    return { ok: true as const, ficha: armarFichaDeSubmarca(ficha.valor, catalogos.valor) };
  });
}
