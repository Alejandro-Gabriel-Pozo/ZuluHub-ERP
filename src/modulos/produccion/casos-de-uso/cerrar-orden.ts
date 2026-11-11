import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadATexto, cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { cantidadConSignoDesdeTexto } from "../../../primitivas/cantidad/con-signo";
import {
  formatearDecimalFijo,
  parsearDecimalFijo,
} from "../../../primitivas/cantidad/decimal-fijo";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { convertirCantidad } from "../../../primitivas/unidades/convertir-cantidad";
import { UNIDADES, type CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import {
  fechaCivilValida,
  leerCantidad,
  llaveDeSaldo,
  MOTIVO_CONSUMO_DE_TRANSFORMACION,
  MOTIVO_PRODUCTO_DE_TRANSFORMACION,
  ORIGEN_TRANSFORMACION,
  registrarMovimientoEnTx,
  type ControlDeStock,
  type LoteDeEntrada,
  CONTROL_DE_NEGATIVO,
} from "../../stock/publico";
import { completarConsumos } from "../dominio/esperados";
import { costearOrden } from "../dominio/costo-de-orden";
import { huellaDeCerrarOrden, huellaDelProductoDeLaOrden } from "../dominio/huella";
import { esUuid } from "../dominio/identificadores";
import { autorizar, exigirAlcanceDeLasDosSucursales, traducir } from "./comun";
import type { DependenciasDeProduccion, TxDeProduccion } from "./contrato";
import {
  codigoDeLoteDeOrden,
  mermaYSalida,
  negada,
  positiva,
  type ConsumoRealDeEntrada,
  type EntradaDeCerrarOrden,
  type SalidaDeCerrarOrden,
} from "./cierre-comun";
import type { ErrorDeProduccion } from "./errores";

type R<S> = Resultado<S, ErrorDeProduccion>;

const esUnidad = (texto: unknown): texto is CodigoDeUnidad =>
  typeof texto === "string" && Object.hasOwn(UNIDADES, texto);
const MAXIMO_DE_CONSUMOS = 500;
const ESCALA_DEL_COSTO = 6;

/**
 * Cerrar una orden de producción (E6 §3.2 y §3.3): consumo de ingredientes + producto con lote y costo + estado, UNA transacción. Guard
 * `transformaciones.cerrar`, las dos sucursales en el alcance. Toma la fila de la orden `FOR UPDATE` (dos cierres o un cierre y una cancelación a
 * la vez se encolan y el segundo relee el estado). Cierra con lo REAL que carga la persona, nunca con la receta: los esperados sellados no se
 * releen. Orden: 1) el consumo (`SALIDA CONSUMO_DE_TRANSFORMACION`, origen `TRANSFORMACION:<orden>`, FEFO por ingrediente, control de existencia
 * negativa); 2) el costo = Σ lo consumido × el costo congelado de cada renglón ÷ lo obtenido, redondeado UNA vez (`SIN_COSTO` si algún ingrediente no
 * tenía); 3) el producto (`ENTRADA PRODUCTO_DE_TRANSFORMACION`, destino, lote `OP-<número>` con el vencimiento, el costo declarado); 4) lo real de
 * cada renglón; 5) recién ahí la orden pasa a `CERRADA` (la base exige los dos movimientos en la misma transacción) y se audita. Si algo falla (un
 * ingrediente bloqueado por el control, un vencimiento que falta) no queda NADA. Repetición: la orden ya cerrada con el mismo contenido devuelve lo hecho
 * (`yaExistia`) aunque venga otra clave; la misma clave con otro contenido es `CLAVE_REUTILIZADA`; otro contenido con otra clave, `ORDEN_YA_CERRADA`.
 */
export function armarCerrarOrden(dependencias: DependenciasDeProduccion) {
  return async function cerrarOrden(
    contexto: ContextoOperativo,
    entrada: EntradaDeCerrarOrden,
  ): Promise<R<SalidaDeCerrarOrden>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCerrarOrden>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "transformaciones.cerrar",
        ]);
        if (!permiso.ok) return permiso;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");

        // ---- lo que llega (lista de permitidos) ----
        if (typeof entrada.ordenId !== "string" || !esUuid(entrada.ordenId))
          return err("ORDEN_NO_ENCONTRADA");
        if (typeof entrada.clave !== "string" || !esUuid(entrada.clave))
          return err("IDENTIFICADOR_INVALIDO");
        if (!esUnidad(entrada.unidadId)) return err("IDENTIFICADOR_INVALIDO");
        const obtenido = leerCantidad(entrada.obtenido);
        if (!obtenido.ok) return obtenido;
        const vence = entrada.vence ?? null;
        if (vence !== null && !fechaCivilValida(vence)) return err("IDENTIFICADOR_INVALIDO");
        if (!Array.isArray(entrada.consumos) || entrada.consumos.length > MAXIMO_DE_CONSUMOS) {
          return err("RENGLONES_INVALIDOS");
        }
        const confirmaciones: ControlDeStock[] = [];
        for (const c of (entrada.confirmaciones ?? []) as unknown[]) {
          if (c !== CONTROL_DE_NEGATIVO) return err("IDENTIFICADOR_INVALIDO");
          confirmaciones.push(c);
        }
        const leidos: {
          productoId: string;
          unidades: bigint;
          texto: string;
          unidadId: CodigoDeUnidad;
        }[] = [];
        for (const crudo of entrada.consumos as readonly unknown[]) {
          const c = (typeof crudo === "object" && crudo !== null ? crudo : {}) as Record<
            string,
            unknown
          >;
          const productoId = c["productoId"];
          if (typeof productoId !== "string" || !esUuid(productoId) || !esUnidad(c["unidadId"])) {
            return err("IDENTIFICADOR_INVALIDO");
          }
          const real = leerCantidad(c["cantidadReal"], true);
          if (!real.ok) return real;
          leidos.push({
            productoId: productoId.toLowerCase(),
            unidades: real.valor.unidades,
            texto: cantidadATexto(real.valor),
            unidadId: c["unidadId"],
          });
        }

        // ---- la orden, con su bloqueo ----
        const orden = await tx.ordenesDeProduccion.bloquear(
          empresaId,
          entrada.ordenId.toLowerCase(),
        );
        if (orden === null) return err("ORDEN_NO_ENCONTRADA");
        const origen = await tx.depositos.obtener(empresaId, orden.depositoId);
        const destino = await tx.depositos.obtener(empresaId, orden.depositoDestinoId);
        if (origen === null || destino === null) return err("DEPOSITO_NO_ENCONTRADO");
        const alcance = await exigirAlcanceDeLasDosSucursales(tx, contexto, [
          origen.sucursalId,
          destino.sucursalId,
        ]);
        if (!alcance.ok) return alcance;

        const huella = huellaDeCerrarOrden(
          orden.id,
          cantidadATexto(obtenido.valor),
          entrada.unidadId,
          vence,
          leidos.map((c) => [c.productoId, c.texto, c.unidadId]),
        );
        if (orden.estado === "CANCELADA") return err("ORDEN_CANCELADA");
        if (orden.estado === "ANULADA") return err("ORDEN_ANULADA");
        if (orden.estado === "CERRADA") {
          const consumo =
            orden.movimientoDeConsumoId === null
              ? null
              : await tx.movimientosDeStock.obtener(empresaId, orden.movimientoDeConsumoId);
          if (consumo === null) throw new Error("producción: la orden cerrada no tiene su consumo");
          if (consumo.huella === huella) {
            const lote =
              orden.loteId === null
                ? null
                : ((await tx.lotesDeStock.obtener(empresaId, orden.loteId))?.codigo ?? null);
            return ok(mermaYSalida(orden, lote, [], true));
          }
          return err(consumo.clave === entrada.clave ? "CLAVE_REUTILIZADA" : "ORDEN_YA_CERRADA");
        }

        // ---- lo real contra lo esperado ----
        const articulos = await tx.articulosDeStock.porProductos(
          empresaId,
          leidos.map((c) => c.productoId),
        );
        const articuloDe = new Map(articulos.map((a) => [a.productoId, a]));
        const reales: { articuloId: string; composicionId: null; unidades: bigint }[] = [];
        for (const c of leidos) {
          const articulo = articuloDe.get(c.productoId);
          if (articulo === undefined) return err("CONSUMO_FUERA_DE_LA_ORDEN");
          if (!esUnidad(articulo.unidadDeStockId))
            throw new RangeError("producción: unidad de stock desconocida");
          const enStock = convertirCantidad(
            cantidadDesdeTexto(c.texto),
            c.unidadId,
            articulo.unidadDeStockId,
          );
          if (!enStock.ok)
            return err(enStock.error === "FUERA_DE_RANGO" ? "CANTIDAD_INVALIDA" : enStock.error);
          reales.push({
            articuloId: articulo.id,
            composicionId: null,
            unidades: enStock.valor.unidades,
          });
        }
        const guardados = await tx.ordenesDeProduccion.renglonesDe(empresaId, orden.id);
        const esperados = guardados.map((r) => {
          const u = cantidadConSignoDesdeTexto(r.cantidadEsperada);
          if (!u.ok) throw new RangeError("producción: cantidad esperada inválida");
          return {
            articuloId: r.articuloId,
            composicionId: r.composicionId,
            unidades: u.valor.unidades,
          };
        });
        const completados = completarConsumos(esperados, reales);
        if (!completados.ok) return err(completados.error);
        const aConsumir = completados.valor.filter((r) => r.unidades > 0n);
        if (aConsumir.length === 0) return err("CANTIDAD_INVALIDA");
        const productoArticulo = await tx.articulosDeStock.porIds(empresaId, [orden.articuloId]);
        const articuloDelProducto = productoArticulo[0];
        if (articuloDelProducto === undefined || !esUnidad(articuloDelProducto.unidadDeStockId)) {
          return err("PRODUCTO_NO_SE_PRODUCE");
        }
        const obtenidoEnStock = convertirCantidad(
          cantidadDesdeTexto(cantidadATexto(obtenido.valor)),
          entrada.unidadId,
          articuloDelProducto.unidadDeStockId,
        );
        if (!obtenidoEnStock.ok) {
          return err(
            obtenidoEnStock.error === "FUERA_DE_RANGO"
              ? "CANTIDAD_INVALIDA"
              : obtenidoEnStock.error,
          );
        }
        if (obtenidoEnStock.valor.unidades <= 0n) return err("CANTIDAD_INVALIDA");

        // ---- 1) el consumo ----
        const consumo = await registrarMovimientoEnTx(tx, contexto, {
          clase: "SALIDA",
          motivo: MOTIVO_CONSUMO_DE_TRANSFORMACION,
          detalle: null,
          origen: { tipo: ORIGEN_TRANSFORMACION, id: orden.id },
          depositoId: orden.depositoId,
          accion: "transformaciones.cerrar",
          anulaA: null,
          conteoId: null,
          clave: entrada.clave,
          huella,
          hechoEn: contexto.ahora,
          fechaDeNegocio: null,
          renglones: aConsumir.map((r) => ({
            depositoId: orden.depositoId,
            articuloId: r.articuloId,
            composicionId: null,
            cantidad: negada(r.unidades),
          })),
          confirmaciones,
        });
        if (!consumo.ok) return consumo;
        if (consumo.valor.yaExistia)
          throw new Error("producción: el consumo de una orden abierta ya existe");

        // ---- 2) el costo congelado ----
        const renglonesDelLibro = await tx.movimientosDeStock.renglonesDe(
          empresaId,
          consumo.valor.movimiento.id,
        );
        const costosDelLibro = await tx.costosDeStock.costosDeRenglones(
          empresaId,
          consumo.valor.movimiento.id,
        );
        const costeados = renglonesDelLibro.map((r) => {
          const u = cantidadConSignoDesdeTexto(r.cantidad);
          if (!u.ok) throw new RangeError("producción: cantidad del libro inválida");
          const costo = costosDelLibro.get(r.numero);
          return {
            unidades: -u.valor.unidades,
            costoUnitario:
              costo?.estado === "DEFINITIVO" && costo.costoUnitario !== null
                ? parsearDecimalFijo(costo.costoUnitario, ESCALA_DEL_COSTO, "costo")
                : null,
          };
        });
        const costo = costearOrden(costeados, obtenidoEnStock.valor.unidades);
        // Un costo en cero no se declara (la entrada exige costo mayor que cero): el producto nace sin costo, nunca con cero.
        const costoTexto =
          costo.estado === "DEFINITIVO" && costo.costoUnitario > 0n
            ? formatearDecimalFijo(costo.costoUnitario, ESCALA_DEL_COSTO)
            : null;

        // ---- 3) el producto, con su lote ----
        const control = (await tx.lotesDeStock.controlesDe(empresaId, [orden.articuloId])).get(
          orden.articuloId,
        );
        const lotes: readonly LoteDeEntrada[] | undefined =
          control?.activo === true
            ? [
                {
                  codigo: codigoDeLoteDeOrden(orden.numero),
                  ...(vence === null ? {} : { fechaDeVencimiento: vence }),
                  cantidad: cantidadATexto(obtenidoEnStock.valor),
                },
              ]
            : undefined;
        const producto = await registrarMovimientoEnTx(tx, contexto, {
          clase: "ENTRADA",
          motivo: MOTIVO_PRODUCTO_DE_TRANSFORMACION,
          detalle: null,
          origen: { tipo: ORIGEN_TRANSFORMACION, id: orden.id },
          depositoId: orden.depositoDestinoId,
          accion: "transformaciones.cerrar",
          anulaA: null,
          conteoId: null,
          clave: `${entrada.clave}-producto`,
          huella: huellaDelProductoDeLaOrden(
            orden.id,
            cantidadATexto(obtenido.valor),
            entrada.unidadId,
            vence,
          ),
          hechoEn: contexto.ahora,
          fechaDeNegocio: null,
          renglones: [
            {
              depositoId: orden.depositoDestinoId,
              articuloId: orden.articuloId,
              composicionId: null,
              cantidad: positiva(obtenidoEnStock.valor.unidades),
            },
          ],
          confirmaciones: [],
          costos:
            costoTexto === null
              ? new Map()
              : new Map([
                  [
                    llaveDeSaldo(orden.depositoDestinoId, orden.articuloId),
                    precioUnitarioDesdeTexto(costoTexto),
                  ],
                ]),
          ...(lotes === undefined
            ? {}
            : {
                lotes: {
                  entradas: new Map([
                    [llaveDeSaldo(orden.depositoDestinoId, orden.articuloId), lotes],
                  ]),
                },
              }),
        });
        if (!producto.ok) return producto;
        const loteDelProducto =
          lotes === undefined
            ? null
            : ((await tx.lotesDeStock.renglonesDeLoteDe(empresaId, producto.valor.movimiento.id))[0]
                ?.loteId ?? null);

        // ---- 4) y 5) lo real de cada renglón y, recién ahora, la orden ----
        for (const [i, r] of completados.valor.entries()) {
          const numero = guardados[i]?.numero;
          if (numero === undefined)
            throw new Error("producción: un renglón de la orden desapareció");
          await tx.ordenesDeProduccion.cargarReal(
            empresaId,
            orden.id,
            numero,
            formatearDecimalFijo(r.unidades, 4),
          );
        }
        const cerrada = await tx.ordenesDeProduccion.cerrar(empresaId, orden.id, {
          cantidadObtenida: cantidadATexto(obtenidoEnStock.valor),
          loteId: loteDelProducto,
          vence,
          costoUnitario: costoTexto,
          costoEstado: costoTexto === null ? "SIN_COSTO" : "DEFINITIVO",
          movimientoDeConsumoId: consumo.valor.movimiento.id,
          movimientoDeProductoId: producto.valor.movimiento.id,
          cerradaPor: persona,
          cerradaEn: contexto.ahora,
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "ORDEN_DE_PRODUCCION_CERRADA",
          entidad: "orden_de_produccion",
          entidadId: orden.id,
          antes: { estado: "ABIERTA" },
          despues: {
            estado: "CERRADA",
            cantidadObtenida: cerrada.cantidadObtenida,
            costoUnitario: cerrada.costoUnitario,
            costoEstado: cerrada.costoEstado,
            loteId: cerrada.loteId,
            vence: cerrada.vence,
          },
        });
        return ok(
          mermaYSalida(
            cerrada,
            lotes === undefined ? null : codigoDeLoteDeOrden(orden.numero),
            consumo.valor.excepciones.map((e) => ({
              productoId: e.productoId,
              existenciaResultante: e.existenciaResultante,
            })),
            false,
          ),
        );
      },
    );
    return traducir(resultado);
  };
}

export type { ConsumoRealDeEntrada, EntradaDeCerrarOrden, SalidaDeCerrarOrden, TxDeProduccion };
