import { z } from "zod";
import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { MAXIMO_DE_RENGLONES } from "../modulos/stock/publico";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { enBlanco } from "./entradas-de-movimientos";
import {
  decimal,
  identificador,
  leer,
  texto,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";
import { accionDeStock } from "./errores-de-stock";
import type { Web } from "./web";

/**
 * La carga inicial del stock en tanda (STK-C, FP-STK-08): UNA entrada con motivo `CARGA_INICIAL` y todos los renglones de la grilla en un solo depósito. Reglas de esta capa:
 *  - **La sucursal la pone el servidor.** El depósito tiene que ser un depósito activo de esa sucursal y de uso `Normal` (Cuarentena y Rechazo no reciben entradas); cada artículo, uno de los que se pueden
 *    mover (su producto y su unidad salen del servidor, nunca del navegador). Lo que no corresponde sale como el genérico, indistinguible de lo que no existe.
 *  - **Todo o nada**: la tanda es una sola entrada, o sea una sola transacción del módulo: un renglón inválido (artículo repetido, cantidad cero, costo mal formado) frena toda la carga. De 1 a `MAXIMO_DE_RENGLONES`.
 *  - **Idempotente**: la clave la genera la página al abrir y viaja ligada a la acción; repetir el envío devuelve lo ya hecho (`yaExistia`) sin duplicar. La MISMA tanda abierta en dos pestañas tiene dos claves y el servidor
 *    no puede saberlo: lo cubre el aviso de abajo.
 *  - **Aviso de existencia previa (P-8, aviso y no bloqueo)**: si el depósito ya tiene existencia y la persona no confirmó, vuelve `STOCK_YA_HAY_EXISTENCIA` y no se escribe nada; confirmar reenvía con la misma clave. Lo decide el
 *    caso de uso DENTRO de su transacción, después de detectar la repetición: repetir la misma clave devuelve siempre lo hecho, sin avisar. Es una AYUDA (lectura sin bloqueo): dos tandas a la vez se suman igual, cada una con su clave.
 *  - **Dinero**: el costo por unidad es opcional y viaja como texto decimal; vacío es «sin costo» (no entra al promedio). La cantidad, el costo, el permiso (`stock.registrar_entrada` y además `stock.ajustar`, DEC-STK-004) y la
 *    fecha («de hoy»: nunca se manda `hechoEn`) los decide el caso de uso dentro de su transacción.
 */

export type DependenciasDeCargaInicialWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeStock"]>, "registrarEntrada">;
  consultas: () => Pick<
    ReturnType<Web["consultasDeStock"]>,
    "articulosControlados" | "listarDepositos"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

const formaDeRenglon = z
  .object({
    articuloId: identificador,
    cantidad: decimal,
    costoUnitario: decimal.optional(),
    /** Solo de un artículo controlado por lote (STK-E2b): el código del lote y su vencimiento; el servidor valida la forma y las reglas. En blanco = ausente. */
    loteCodigo: texto.optional(),
    loteVence: texto.optional(),
  })
  .strict();
const formaDeCarga = z
  .object({
    clave: identificador,
    depositoId: identificador,
    renglones: z.array(formaDeRenglon).min(1).max(MAXIMO_DE_RENGLONES),
    confirmar: z.enum(["", "1"]).optional(),
  })
  .strict();

export type EntradaWebDeCargaInicial = Readonly<{
  clave: string;
  depositoId: string;
  renglones: readonly Readonly<{
    articuloId: string;
    cantidad: string;
    costoUnitario: string | undefined;
    loteCodigo: string | undefined;
    loteVence: string | undefined;
  }>[];
  /** La persona vio el aviso «este depósito ya tiene existencia» y lo confirmó. */
  confirmar: boolean;
}>;

/** Lo que manda el navegador a lo que recibe la composición: solo la FORMA. Un costo en blanco es «sin costo». */
export function entradaDeCargaInicial(
  crudo: unknown,
): Resultado<EntradaWebDeCargaInicial, ErrorDeEntrada> {
  const f = leer(formaDeCarga, crudo);
  return f.ok
    ? ok({
        clave: f.valor.clave,
        depositoId: f.valor.depositoId,
        renglones: f.valor.renglones.map((r) => ({
          articuloId: r.articuloId,
          cantidad: r.cantidad,
          costoUnitario: enBlanco(r.costoUnitario),
          loteCodigo: enBlanco(r.loteCodigo),
          loteVence: enBlanco(r.loteVence),
        })),
        confirmar: f.valor.confirmar === "1",
      })
    : f;
}

export type OpcionesDeCargaInicial = Readonly<{
  /** Solo los depósitos de uso `Normal` activos de la sucursal. */
  depositos: readonly Readonly<{ id: string; nombre: string }>[];
  articulos: readonly Readonly<{
    id: string;
    nombre: string;
    unidadId: string;
    /** Cómo se controla por lote hoy, o `null` (ayuda para ofrecer «Lote» y «Vence» en la fila). */
    controlDeLote: "LOTE" | "LOTE_Y_VENCIMIENTO" | null;
  }>[];
}>;

/** Lo que ofrece la grilla: los depósitos `Normal` activos de la sucursal y los artículos que se pueden mover. */
export function opcionesParaLaCargaInicial(
  d: DependenciasDeCargaInicialWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<OpcionesDeCargaInicial>> {
  return accionDeStock(
    d.respuesta,
    {},
    () => ok({}),
    async () => {
      const depositos = await d.consultas().listarDepositos(contexto, { sucursalId });
      if (!depositos.ok) return depositos;
      const articulos = await d.consultas().articulosControlados(contexto);
      if (!articulos.ok) return articulos;
      return ok({ depositos: depositos.valor, articulos: articulos.valor });
    },
    ({ depositos, articulos }): OpcionesDeCargaInicial => ({
      depositos: depositos
        .filter((x) => x.activo && x.uso === "NORMAL")
        .map((x) => ({ id: x.id, nombre: x.nombre })),
      articulos: articulos.map((x) => ({
        id: x.articuloId,
        nombre: x.nombre,
        unidadId: x.unidadId,
        controlDeLote: x.controlDeLote,
      })),
    }),
  );
}

type Hecho = Readonly<{ movimientoId: string; yaExistia: boolean }>;

/** Registra la carga inicial de la tanda en el depósito elegido de la sucursal. */
export function registrarLaCargaInicial(
  d: DependenciasDeCargaInicialWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Hecho>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    entradaDeCargaInicial,
    async (e) => {
      const depositos = await d.consultas().listarDepositos(contexto, { sucursalId });
      if (!depositos.ok) return depositos;
      if (!depositos.valor.some((x) => x.id === e.depositoId && x.activo && x.uso === "NORMAL")) {
        return err("DEPOSITO_NO_ENCONTRADO" as const);
      }
      const articulos = await d.consultas().articulosControlados(contexto);
      if (!articulos.ok) return articulos;
      const porId = new Map(articulos.valor.map((a) => [a.articuloId, a]));
      const renglones = [];
      for (const r of e.renglones) {
        const articulo = porId.get(r.articuloId);
        if (articulo === undefined) return err("ARTICULO_NO_CONTROLADO" as const);
        // Un vencimiento sin código no es un lote: pedido mal formado, nunca se ignora en silencio. UN lote por fila (SUPUESTO, DEC-STK-007): su cantidad es la de la fila.
        if (r.loteCodigo === undefined && r.loteVence !== undefined) {
          return err("RENGLONES_INVALIDOS" as const);
        }
        renglones.push({
          productoId: articulo.productoId,
          cantidad: r.cantidad,
          unidadId: articulo.unidadId,
          costoUnitario: r.costoUnitario,
          ...(r.loteCodigo === undefined
            ? {}
            : {
                lotes: [
                  {
                    codigo: r.loteCodigo,
                    fechaDeVencimiento: r.loteVence ?? null,
                    cantidad: r.cantidad,
                  },
                ],
              }),
        });
      }
      return d.casosDeUso().registrarEntrada(contexto, {
        clave: e.clave,
        depositoId: e.depositoId,
        motivo: "CARGA_INICIAL",
        renglones,
        confirmaExistenciaPrevia: e.confirmar,
      });
    },
    (s): Hecho => ({ movimientoId: s.movimientoId, yaExistia: s.yaExistia }),
  );
}
