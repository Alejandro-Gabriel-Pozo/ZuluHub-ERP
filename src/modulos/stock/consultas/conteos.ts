import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { cantidadConSignoATexto } from "../../../primitivas/cantidad/con-signo";
import {
  horaDelConteo,
  revisarConteo,
  type RevisionDeArticulo,
} from "../casos-de-uso/revision-de-conteo";
import { esUuid } from "../persistencia/filas";
import { ESTADOS_DE_CONTEO, type EstadoDeConteo } from "../persistencia/modelo";
import type { RenglonPosterior } from "../persistencia/lecturas-de-conteo";
import { TAMANO_DE_PAGINA } from "./existencias";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type ConteoDeLista = Readonly<{
  id: string;
  depositoId: string;
  estado: EstadoDeConteo;
  abiertoPor: PersonaId;
  abiertoEn: Date;
  resueltoPor: PersonaId | null;
  resueltoEn: Date | null;
  /** Solo el de la cancelación. */
  motivo: string | null;
  version: number;
}>;

/**
 * Un registro del conteo. Lo de la revisión (`existenciaALaHora`, `movidoDesdeLaHora`, `diferenciaBruta`) está SOLO si quien mira puede aplicar el conteo
 * (`conteos.aplicar`) y solo en el registro vigente de cada artículo de un conteo abierto: para el resto el campo no existe, no viene vacío (conteo a
 * ciegas, D125).
 */
export type RegistroDeFicha = Readonly<{
  id: string;
  articuloId: string;
  productoId: string;
  /** En la unidad de stock del artículo. */
  cantidadContada: string;
  registradoPor: PersonaId;
  registradoEn: Date;
  /** La hora a la que se contó: la que declaró quien cargó, o la de carga si no declaró ninguna. */
  contadoEn: Date;
  /** `true` si es el último registro del artículo (el que vale al aplicar). */
  vigente: boolean;
  /** Lo que el sistema creía que había a la hora en que se contó. */
  existenciaALaHora?: string;
  /** El neto de lo movido (vendido, consumido, recibido...) después de esa hora: ya está en lo que hay hoy y no se toca. */
  movidoDesdeLaHora?: string;
  /** `contada − existenciaALaHora`: negativa = faltante, positiva = sobrante, cero = no hay nada que explicar. */
  diferenciaBruta?: string;
}>;

/** Lo que quedó guardado de un artículo al aplicar el conteo (`conteo_diferencia`): solo con `conteos.aplicar`. */
export type ExplicacionDeFicha = Readonly<{
  articuloId: string;
  productoId: string;
  contada: string;
  contadoEn: Date;
  existenciaALaHora: string;
  diferenciaBruta: string;
  marcado: string;
  diferenciaFinal: string;
  motivo: string | null;
  detalle: string | null;
  explicadaPor: PersonaId;
  explicadaEn: Date;
}>;

export type FichaDeConteo = Readonly<{
  conteo: ConteoDeLista;
  /** Del más viejo al más nuevo. */
  registros: readonly RegistroDeFicha[];
  /** La huella de lo mostrado (solo con `conteos.aplicar` y con el conteo abierto): `aplicarConteo` la pide igual. */
  huella?: string;
  /** Solo con `conteos.aplicar` y con el conteo aplicado. */
  explicaciones?: readonly ExplicacionDeFicha[];
}>;

/** Un movimiento posterior a la hora del conteo que podría explicar la diferencia (el «ver detalle» opcional). */
export type CandidatoDeConteo = Readonly<{
  movimientoId: string;
  numero: number;
  clase: RenglonPosterior["clase"];
  motivo: string;
  origenTipo: string;
  origenId: string | null;
  hechoEn: Date;
  registradoPor: PersonaId;
  /** Texto decimal exacto, con signo. */
  cantidad: string;
}>;

export type CursorDeCandidatos = Readonly<{ hechoEn: Date; movimientoId: string; numero: number }>;

export type PaginaDeCandidatos = Readonly<{
  candidatos: readonly CandidatoDeConteo[];
  siguiente: CursorDeCandidatos | null;
}>;

const conteoDeLista = (c: {
  id: string;
  depositoId: string;
  estado: EstadoDeConteo;
  abiertoPor: PersonaId;
  abiertoEn: Date;
  resueltoPor: PersonaId | null;
  resueltoEn: Date | null;
  motivo: string | null;
  version: number;
}): ConteoDeLista => ({
  id: c.id,
  depositoId: c.depositoId,
  estado: c.estado,
  abiertoPor: c.abiertoPor,
  abiertoEn: c.abiertoEn,
  resueltoPor: c.resueltoPor,
  resueltoEn: c.resueltoEn,
  motivo: c.motivo,
  version: c.version,
});

const enAlcance = (alcance: AlcanceDeSucursales, sucursal: string): boolean =>
  alcance === "TODAS" || (alcance as readonly string[]).includes(sucursal);

/**
 * Pestaña Conteo (E5 §3.4). Guard `stock.ver`; el operador solo ve los conteos de los depósitos de sus sucursales (uno ajeno es indistinguible de
 * uno que no existe). El conteo es A CIEGAS: lo que el sistema creía a la hora del conteo, lo movido desde entonces y la diferencia solo viajan si el rol tiene
 * `conteos.aplicar` (administrador y gerente): lo evalúa el guard con el rol de la misma transacción, no la pantalla.
 */
export function armarConsultasDeConteos(leer: Lector, reglas: ReglasDeEmpresa) {
  return {
    /**
     * El conteo con sus registros. `null` si no existe o su depósito está fuera del alcance. Con `conteos.aplicar` y el conteo abierto trae además la
     * REVISIÓN de cada artículo cargado (lo que el sistema creía a la hora en que se contó, lo movido desde entonces y la diferencia bruta) y la huella
     * de lo mostrado; con el conteo aplicado, lo que quedó explicado de cada artículo. Para el resto, nada de eso existe (a ciegas).
     */
    fichaDeConteo: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ conteoId: string }>,
    ): Promise<RDeConsulta<FichaDeConteo | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.fichaDeConteo.accion, async (tx, alcance) => {
        if (typeof entrada.conteoId !== "string" || !esUuid(entrada.conteoId)) return null;
        const conteo = await tx.conteosDeStock.obtener(contexto.empresaId, entrada.conteoId);
        if (conteo === null) return null;
        const deposito = await tx.depositos.obtener(contexto.empresaId, conteo.depositoId);
        if (deposito === null || !enAlcance(alcance, deposito.sucursalId)) return null;
        const veLoTeorico = (
          await exigirAccion(reglas, "conteos.aplicar", () => tx.autorizacion.delActor(contexto))
        ).ok;
        const guardados = await tx.conteosDeStock.registrosDe(contexto.empresaId, conteo.id);
        const articulos = await tx.articulosDeStock.porIds(
          contexto.empresaId,
          guardados.map((g) => g.articuloId),
        );
        const productoDe = new Map(articulos.map((a) => [a.id, a.productoId]));
        const ultimoOrden = new Map<string, number>();
        for (const g of guardados) {
          ultimoOrden.set(g.articuloId, Math.max(ultimoOrden.get(g.articuloId) ?? 0, g.orden));
        }
        const revision =
          veLoTeorico && conteo.estado === "ABIERTO"
            ? await revisarConteo(tx.conteosDeStock, contexto.empresaId, conteo)
            : null;
        if (revision !== null && !revision.ok) {
          throw new RangeError("stock: la diferencia de un conteo se sale del rango");
        }
        const revisionDe = new Map<string, RevisionDeArticulo>(
          revision === null || !revision.ok
            ? []
            : revision.valor.articulos.map((a) => [a.articuloId, a]),
        );
        const ficha = {
          conteo: conteoDeLista(conteo),
          registros: guardados.map((g): RegistroDeFicha => {
            const base = {
              id: g.id,
              articuloId: g.articuloId,
              productoId: productoDe.get(g.articuloId) ?? g.articuloId,
              cantidadContada: g.cantidadContada,
              registradoPor: g.registradoPor,
              registradoEn: g.registradoEn,
              contadoEn: horaDelConteo(g),
              vigente: ultimoOrden.get(g.articuloId) === g.orden,
            };
            const revisado = base.vigente ? revisionDe.get(g.articuloId) : undefined;
            if (revisado === undefined) return base;
            return {
              ...base,
              existenciaALaHora: cantidadConSignoATexto(revisado.existenciaALaHora),
              movidoDesdeLaHora: cantidadConSignoATexto(revisado.movidoDesdeLaHora),
              diferenciaBruta: cantidadConSignoATexto(revisado.diferenciaBruta),
            };
          }),
        };
        if (revision !== null && revision.ok) return { ...ficha, huella: revision.valor.huella };
        if (!veLoTeorico || conteo.estado !== "APLICADO") return ficha;
        const guardadas = await tx.conteosDeStock.diferenciasDe(contexto.empresaId, conteo.id);
        return {
          ...ficha,
          explicaciones: guardadas.map((d): ExplicacionDeFicha => ({
            articuloId: d.articuloId,
            productoId: productoDe.get(d.articuloId) ?? d.articuloId,
            contada: d.contada,
            contadoEn: d.contadoEn,
            existenciaALaHora: d.existenciaALaHora,
            diferenciaBruta: d.diferenciaBruta,
            marcado: d.marcado,
            diferenciaFinal: d.diferenciaFinal,
            motivo: d.motivo,
            detalle: d.detalle,
            explicadaPor: d.explicadaPor,
            explicadaEn: d.explicadaEn,
          })),
        };
      }),

    /**
     * El «ver detalle» OPCIONAL de un artículo contado de un conteo abierto: los movimientos posteriores a la hora en que se contó, del sentido de la
     * diferencia (un faltante, los que restaron; un sobrante, los que sumaron), por `(hora, movimiento, renglón)` y paginado por cursor. Solo con
     * `conteos.aplicar`. Sin diferencia bruta, o con el conteo cerrado, no hay nada que mostrar. `null` si el conteo no existe o su depósito está fuera
     * del alcance. Quien aplica puede marcar alguno como «ya había ocurrido cuando contó»; no hace falta abrirlo para aplicar.
     */
    candidatosDeConteo: (
      contexto: ContextoOperativo,
      entrada: Readonly<{
        conteoId: string;
        productoId: string;
        despuesDe?: CursorDeCandidatos | undefined;
      }>,
    ): Promise<RDeConsulta<PaginaDeCandidatos | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.candidatosDeConteo.accion, async (tx, alcance) => {
        if (!esUuid(entrada.conteoId) || !esUuid(entrada.productoId)) return null;
        const conteo = await tx.conteosDeStock.obtener(contexto.empresaId, entrada.conteoId);
        if (conteo === null) return null;
        const deposito = await tx.depositos.obtener(contexto.empresaId, conteo.depositoId);
        if (deposito === null || !enAlcance(alcance, deposito.sucursalId)) return null;
        const vacia: PaginaDeCandidatos = { candidatos: [], siguiente: null };
        const articulo = await tx.articulosDeStock.porProducto(
          contexto.empresaId,
          entrada.productoId,
        );
        if (articulo === null || conteo.estado !== "ABIERTO") return vacia;
        const revision = await revisarConteo(tx.conteosDeStock, contexto.empresaId, conteo);
        if (!revision.ok)
          throw new RangeError("stock: la diferencia de un conteo se sale del rango");
        const contado = revision.valor.articulos.find((a) => a.articuloId === articulo.id);
        const bruta = contado?.diferenciaBruta.unidades ?? 0n;
        if (contado === undefined || bruta === 0n) return vacia;
        const cursor = entrada.despuesDe;
        if (
          cursor !== undefined &&
          !(
            cursor.hechoEn instanceof Date &&
            esUuid(cursor.movimientoId) &&
            Number.isInteger(cursor.numero)
          )
        ) {
          return vacia;
        }
        const filas = await tx.conteosDeStock.renglonesPosteriores(contexto.empresaId, {
          depositoId: conteo.depositoId,
          articuloId: articulo.id,
          desde: contado.hora,
          sentido: bruta < 0n ? "RESTA" : "SUMA",
          despuesDe: cursor,
          limite: TAMANO_DE_PAGINA + 1,
        });
        const pagina = filas.slice(0, TAMANO_DE_PAGINA);
        const ultima = pagina[pagina.length - 1];
        return {
          candidatos: pagina,
          siguiente:
            filas.length > TAMANO_DE_PAGINA && ultima !== undefined
              ? {
                  hechoEn: ultima.hechoEn,
                  movimientoId: ultima.movimientoId,
                  numero: ultima.numero,
                }
              : null,
        };
      }),

    /**
     * Los conteos que el alcance deja ver, del más nuevo al más viejo (hasta una página), de un depósito y/o en un estado. Un filtro mal
     * formado da una lista vacía.
     */
    listarConteos: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ depositoId?: string | undefined; estado?: string | undefined }> = {},
    ): Promise<RDeConsulta<readonly ConteoDeLista[]>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.listarConteos.accion, async (tx, alcance) => {
        const estado = entrada.estado;
        if (
          (entrada.depositoId !== undefined && !esUuid(entrada.depositoId)) ||
          (estado !== undefined && !(ESTADOS_DE_CONTEO as readonly string[]).includes(estado))
        ) {
          return [];
        }
        const conteos = await tx.conteosDeStock.listar(contexto.empresaId, {
          alcance,
          depositoId: entrada.depositoId,
          estado: estado as EstadoDeConteo | undefined,
          limite: TAMANO_DE_PAGINA,
        });
        return conteos.map(conteoDeLista);
      }),
  };
}
