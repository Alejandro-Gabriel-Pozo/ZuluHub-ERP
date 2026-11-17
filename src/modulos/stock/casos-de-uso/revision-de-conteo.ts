import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import {
  cantidadConSignoDesdeTexto,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  diferenciaBruta,
  horaDelConteo,
  huellaDeRevision,
  registrosVigentes,
  type RegistroDeConteo,
} from "../dominio/conteo";
import type { RepositorioDeConteos } from "../persistencia/repositorio-de-conteos";
import type { Conteo } from "../persistencia/modelo";

/** La hora del conteo de un registro (la declarada, o la de carga): la misma regla para la revisión y para lo que muestra la ficha. */
export { horaDelConteo };

/**
 * La revisión de un conteo (E5 conteo con hora, §2.3): para cada artículo con carga, lo que el sistema creía a la hora en que se contó (`E`), lo
 * movido desde entonces y la diferencia bruta `Δ0 = contada − E`. La comparten la consulta que muestra la revisión (`fichaDeConteo`) y `aplicarConteo`,
 * que la recalcula dentro de su transacción: una regla, un lugar. Solo lee.
 */
export type RevisionDeArticulo = Readonly<{
  articuloId: string;
  /** El registro vigente (el último cargado) que se evaluó. */
  registroId: string;
  hora: Date;
  contada: Cantidad;
  /** Lo que el sistema creía a esa hora (suma de los renglones con `hecho_en <= hora`). Puede ser negativa. */
  existenciaALaHora: CantidadConSigno;
  /** El neto de todo lo posterior a la hora (ventas, consumos, compras, transferencias, anulaciones); ya está en lo que hay hoy. */
  movidoDesdeLaHora: CantidadConSigno;
  /** `contada − existenciaALaHora`: negativa = faltante, positiva = sobrante, cero = no hay nada que explicar. */
  diferenciaBruta: CantidadConSigno;
}>;

export type Revision = Readonly<{
  /** Un artículo por cada uno con carga, ordenados por artículo. Vacía si el conteo no tiene cargas. */
  articulos: readonly RevisionDeArticulo[];
  /** La huella de lo mostrado: `aplicarConteo` la exige igual. */
  huella: string;
}>;

/** Una cantidad que la base guardó o sumó: si no se lee es un defecto, no un dato de la persona. */
function cantidadGuardada(texto: string): CantidadConSigno {
  const leida = cantidadConSignoDesdeTexto(texto);
  if (!leida.ok) throw new RangeError("stock: la base devolvió una cantidad ilegible");
  return leida.valor;
}

/** Los registros guardados como los entiende el dominio. */
export function registrosParaElDominio(
  guardados: readonly Readonly<{
    id: string;
    articuloId: string;
    orden: number;
    cantidadContada: string;
    contadoEn: Date | null;
    registradoEn: Date;
  }>[],
): RegistroDeConteo[] {
  return guardados.map((g) => ({
    id: g.id,
    articuloId: g.articuloId,
    orden: g.orden,
    cantidadContada: cantidadDesdeTexto(g.cantidadContada),
    contadoEn: g.contadoEn,
    registradoEn: g.registradoEn,
  }));
}

export async function revisarConteo(
  repositorio: Pick<RepositorioDeConteos, "registrosDe" | "sumasAlrededorDeLaHora">,
  empresa: EmpresaId,
  conteo: Pick<Conteo, "id" | "depositoId">,
): Promise<Resultado<Revision, "CANTIDAD_INVALIDA">> {
  const guardados = await repositorio.registrosDe(empresa, conteo.id);
  const vigentes = registrosVigentes(registrosParaElDominio(guardados));
  const sumas = await repositorio.sumasAlrededorDeLaHora(
    empresa,
    conteo.depositoId,
    vigentes.map((r) => ({ articuloId: r.articuloId, hora: horaDelConteo(r) })),
  );
  const articulos: RevisionDeArticulo[] = [];
  for (const registro of vigentes) {
    const sumaDelArticulo = sumas.get(registro.articuloId);
    if (sumaDelArticulo === undefined) {
      throw new Error("stock: la revisión no recibió las sumas de un artículo contado");
    }
    const existenciaALaHora = cantidadGuardada(sumaDelArticulo.hastaLaHora);
    const bruta = diferenciaBruta(registro.cantidadContada, existenciaALaHora);
    // Lo contado y lo que había caben en la base, pero su diferencia puede salirse del rango que la aplicación sabe representar.
    if (!bruta.ok) return err("CANTIDAD_INVALIDA");
    articulos.push({
      articuloId: registro.articuloId,
      registroId: registro.id,
      hora: horaDelConteo(registro),
      contada: registro.cantidadContada,
      existenciaALaHora,
      movidoDesdeLaHora: cantidadGuardada(sumaDelArticulo.despuesDeLaHora),
      diferenciaBruta: bruta.valor,
    });
  }
  return ok({
    articulos,
    huella: huellaDeRevision(
      conteo.id,
      articulos.map((a) => ({
        articuloId: a.articuloId,
        registroId: a.registroId,
        hora: a.hora,
        existenciaALaHora: a.existenciaALaHora,
        diferenciaBruta: a.diferenciaBruta,
      })),
    ),
  });
}
