import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeTexto,
  restarConSigno,
} from "../../../primitivas/cantidad/con-signo";
import { esUuid } from "../persistencia/filas";
import { ESTADOS_DE_CONTEO, type EstadoDeConteo } from "../persistencia/modelo";
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
 * Un registro del conteo. `existenciaTeorica` y `diferencia` están SOLO si quien mira puede aplicar el conteo (`conteos.aplicar`): para el resto
 * el campo no existe, no viene vacío (conteo a ciegas, D125).
 */
export type RegistroDeFicha = Readonly<{
  id: string;
  articuloId: string;
  productoId: string;
  /** En la unidad de stock del artículo. */
  cantidadContada: string;
  registradoPor: PersonaId;
  registradoEn: Date;
  /** `true` si es el último registro del artículo (el que vale al aplicar). */
  vigente: boolean;
  /** La existencia del depósito cuando se registró (la fijó la base). */
  existenciaTeorica?: string;
  /** `contada − existencia teórica`: lo que generaría el ajuste al aplicar. */
  diferencia?: string;
}>;

export type FichaDeConteo = Readonly<{
  conteo: ConteoDeLista;
  /** Del más viejo al más nuevo. */
  registros: readonly RegistroDeFicha[];
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
 * uno que no existe). El conteo es A CIEGAS: la existencia teórica de cada registro y su diferencia solo viajan si el rol tiene
 * `conteos.aplicar` (administrador y gerente): lo evalúa el guard con el rol de la misma transacción, no la pantalla.
 */
export function armarConsultasDeConteos(leer: Lector, reglas: ReglasDeEmpresa) {
  return {
    /** El conteo con sus registros. `null` si no existe o su depósito está fuera del alcance. */
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
        return {
          conteo: conteoDeLista(conteo),
          registros: guardados.map((g): RegistroDeFicha => {
            const base = {
              id: g.id,
              articuloId: g.articuloId,
              productoId: productoDe.get(g.articuloId) ?? g.articuloId,
              cantidadContada: g.cantidadContada,
              registradoPor: g.registradoPor,
              registradoEn: g.registradoEn,
              vigente: ultimoOrden.get(g.articuloId) === g.orden,
            };
            if (!veLoTeorico) return base;
            const contada = cantidadConSignoDesdeTexto(g.cantidadContada);
            const teorica = cantidadConSignoDesdeTexto(g.existenciaAlRegistrar);
            if (!contada.ok || !teorica.ok) {
              throw new RangeError("stock: un registro de conteo guardó una cantidad ilegible");
            }
            const diferencia = restarConSigno(contada.valor, teorica.valor);
            if (!diferencia.ok) throw new RangeError("stock: la diferencia se sale del rango");
            return {
              ...base,
              existenciaTeorica: g.existenciaAlRegistrar,
              diferencia: cantidadConSignoATexto(diferencia.valor),
            };
          }),
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
