import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeATexto } from "../../../primitivas/cantidad/porcentaje";
import { validarComposicion, type ComponenteAValidar } from "../dominio/composicion";
import { SIN_MERMA } from "../dominio/merma";
import { esUuid } from "../persistencia/filas";
import type { ComponenteGuardado, ComposicionGuardada } from "../persistencia/modelo";
import { leerComponentes, leerRinde } from "./composiciones-comun";
import type { TxDeConsultasDeStock } from "./contrato";
import { fichaDeLaVersion, type CostosDeFicha } from "./lectura-de-recetas";

/**
 * La vista previa de una receta SIN guardar (B4, `recetas-pantalla.md` §8): el neto de cada línea y, con `costos.ver`, lo que costaría la comida con los precios de hoy. Es la
 * misma cuenta de la ficha (`fichaDeLaVersion`: una sola fórmula del neto y un solo costeo), aplicada a una versión que todavía no existe: la pantalla no repite ninguna.
 * Es una LECTURA y NO es el guardado: sirve para calcular, así que comprueba lo que el cálculo necesita (forma de lo mandado, producto y artículos que existen, no insumos,
 * cantidades y unidades que convierten, merma menor que 100) y NO replica lo que solo importa al guardar (perillas del plan, productos desactivados, ciclos y niveles): eso lo
 * rechaza `guardarComposicion`. Lo que no se puede calcular es `null`, nunca un número a medias.
 */

export type VistaPreviaDeReceta = Readonly<{
  /** En el orden pedido: el neto de cada ingrediente (`bruto × (100 − merma) ÷ 100`, un redondeo). */
  componentes: readonly Readonly<{ productoId: string; neto: string }>[];
  /** SOLO con `costos.ver`; ausente si la receta no tiene con qué costearse. */
  costos?: CostosDeFicha | undefined;
}>;

/** Las perillas del plan no cambian una cuenta: la vista previa las deja abiertas y el guardado las aplica. */
const SIN_PERILLAS = { composiciones_con_perdida: true, subcomposiciones: true } as const;

export async function vistaPreviaDeLaVersion(
  tx: TxDeConsultasDeStock,
  contexto: ContextoOperativo,
  alcance: AlcanceDeSucursales,
  entrada: Readonly<{ productoId: unknown; rinde: unknown; componentes: unknown }>,
  conCostos: boolean,
): Promise<VistaPreviaDeReceta | null> {
  const empresa = contexto.empresaId;
  const persona = contexto.personaId;
  if (persona === null) return null;
  if (typeof entrada.productoId !== "string" || !esUuid(entrada.productoId)) return null;
  const producto = await tx.productosParaStock.obtener(empresa, entrada.productoId);
  if (producto === null) return null;
  if (producto.claseDeUso !== "VENDIBLE" && producto.claseDeUso !== "ELABORADO") return null;
  const rinde = leerRinde(entrada.rinde);
  const leidos = leerComponentes(entrada.componentes);
  if (!rinde.ok || !leidos.ok) return null;

  const ids = leidos.valor.map((c) => c.productoId);
  const productoDe = new Map(
    (await tx.productosParaStock.porIds(empresa, ids)).map((p) => [p.id, p]),
  );
  const articuloDe = new Map(
    (await tx.articulosDeStock.porProductos(empresa, ids)).map((a) => [a.productoId, a]),
  );
  const aValidar: ComponenteAValidar[] = [];
  /** La dimensión de cada componente, por su artículo o su elaborado: la base exige la unidad de esa dimensión. */
  const dimensionDe = new Map<string, string>();
  for (const c of leidos.valor) {
    const componente = productoDe.get(c.productoId);
    // La receta lleva solo ingredientes: el insumo no entra (`COMPONENTE_ES_INSUMO` al guardar).
    if (componente === undefined || componente.claseDeUso === "INSUMO") return null;
    if (componente.claseDeUso === "ELABORADO") {
      dimensionDe.set(componente.id, componente.dimension);
      aValidar.push({
        articuloId: null,
        compuestoId: componente.id,
        cantidad: c.cantidad,
        unidadId: c.unidadId,
        unidadDeStockId: componente.unidadBaseId,
        perdida: c.perdida,
      });
      continue;
    }
    const articulo = articuloDe.get(c.productoId);
    if (articulo === undefined) return null;
    dimensionDe.set(articulo.id, articulo.dimension);
    aValidar.push({
      articuloId: articulo.id,
      compuestoId: null,
      cantidad: c.cantidad,
      unidadId: c.unidadId,
      unidadDeStockId: articulo.unidadDeStockId,
      perdida: c.perdida,
    });
  }
  const validada = validarComposicion(rinde.valor, aValidar, SIN_PERILLAS);
  if (!validada.ok) return null;

  const componentes: ComponenteGuardado[] = validada.valor.componentes.map((c, indice) => ({
    numero: indice + 1,
    articuloId: c.articuloId,
    compuestoId: c.compuestoId,
    cantidad: cantidadATexto(c.cantidad),
    unidadId: c.unidadId,
    // La validación ya comprobó que cada componente tiene su dimensión: lo contrario es un defecto, no un dato.
    dimension: dimensionDe.get(c.articuloId ?? c.compuestoId ?? "") ?? "",
    perdida: porcentajeATexto(c.perdida ?? SIN_MERMA),
  }));
  const sinGuardar: ComposicionGuardada = {
    id: "",
    empresaId: empresa,
    productoId: producto.id,
    numero: 0,
    rinde: cantidadATexto(validada.valor.rinde),
    pasos: null,
    creadaPor: persona,
    creadaEn: contexto.ahora,
    componentes,
  };
  const ficha = await fichaDeLaVersion(tx, contexto, alcance, sinGuardar, sinGuardar, conCostos);
  return {
    componentes: ficha.componentes.map((c) => ({ productoId: c.productoId, neto: c.neto })),
    ...(ficha.costos === undefined ? {} : { costos: ficha.costos }),
  };
}
