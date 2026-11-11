import { registroDeExcepcion } from "../../../capacidades/controles/decision";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadATexto, cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { cantidadConSignoATexto } from "../../../primitivas/cantidad/con-signo";
import { formatearDecimalFijo } from "../../../primitivas/cantidad/decimal-fijo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { convertirCantidad } from "../../../primitivas/unidades/convertir-cantidad";
import { UNIDADES, type CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import {
  CONTROL_DE_NEGATIVO,
  evaluarFaltantes,
  explotarConsumo,
  leerCantidad,
  productosParaExplotar,
  type ControlDeStock,
} from "../../stock/publico";
import { esUuid } from "../dominio/identificadores";
import type { RenglonEsperado } from "../dominio/esperados";
import {
  autorizar,
  exigirAlcanceDeLasDosSucursales,
  exigirPerillaDeProduccion,
  traducir,
} from "./comun";
import type { DependenciasDeProduccion, TxDeProduccion } from "./contrato";
import type { ErrorDeProduccion } from "./errores";

type R<S> = Resultado<S, ErrorDeProduccion>;

export type EntradaDeAbrirOrden = Readonly<{
  /** Lo manda la pantalla (UUID): es la idempotencia del alta. */
  id: string;
  productoId: string;
  /** Texto decimal exacto, mayor que cero, en `unidadId`. */
  cantidad: string;
  unidadId: string;
  depositoId: string;
  depositoDestinoId: string;
  /** `["stock.existencia_negativa"]` si la persona aceptó producir con faltante (nivel `AVISAR`: «Producir igual»). */
  confirmaciones?: readonly string[] | undefined;
}>;

export type EsperadoDeOrden = Readonly<{
  articuloId: string;
  productoId: string;
  /** Texto decimal exacto, en la unidad de stock del insumo. */
  cantidad: string;
  unidadId: string;
}>;

export type FaltanteDeOrden = Readonly<{
  productoId: string;
  /** Lo que hay en el depósito de origen (puede ser negativo). */
  existencia: string;
  /** Lo que necesita la orden. */
  necesario: string;
  unidadId: string;
}>;

export type SalidaDeAbrirOrden = Readonly<{
  ordenId: string;
  numero: number;
  esperados: readonly EsperadoDeOrden[];
  faltantes: readonly FaltanteDeOrden[];
  yaExistia: boolean;
}>;

const esUnidad = (texto: unknown): texto is CodigoDeUnidad =>
  typeof texto === "string" && Object.hasOwn(UNIDADES, texto);

/** Las confirmaciones: solo el control que declara stock (lista de permitidos). */
function leerConfirmaciones(valor: unknown): R<readonly ControlDeStock[]> {
  if (valor === undefined) return ok([]);
  if (!Array.isArray(valor)) return err("IDENTIFICADOR_INVALIDO");
  const confirmaciones: ControlDeStock[] = [];
  for (const c of valor as unknown[]) {
    if (c !== CONTROL_DE_NEGATIVO) return err("IDENTIFICADOR_INVALIDO");
    confirmaciones.push(c);
  }
  return ok(confirmaciones);
}

/**
 * Abrir una orden de producción (E6 §3.2): NO mueve nada. Lo esperado sale de la receta VIGENTE escalada a lo que se quiere producir (la explosión
 * anidada de stock, sin el stock propio del producto: se explota SU receta), sumado por insumo; la versión de la receta queda SELLADA en la orden y
 * no se relee (S-2). Guard `transformaciones.abrir`, módulo `produccion` y perilla `produccion`; las dos sucursales de los depósitos en el alcance
 * de quien pide; ambos depósitos normales y activos. El producto tiene artículo activo (`PRODUCTO_NO_SE_PRODUCE`) y receta vigente no vacía
 * (`PRODUCTO_SIN_RECETA`). Los faltantes se informan y el control `stock.existencia_negativa` decide como en cualquier salida: `BLOQUEAR` rechaza,
 * `AVISAR` pide confirmar («Producir igual»), `PERMITIR` pasa; lo que pasa con faltante queda auditado como excepción. El NÚMERO lo asigna la base
 * (correlativo por empresa, sin huecos por una carrera ni por un rollback: S-18). Repetición: el mismo `id` con el mismo contenido devuelve la
 * orden existente con `yaExistia`, sin escribir ni auditar; con otro contenido, `ID_REUTILIZADO`. Dos altas del mismo `id` a la vez: la base
 * deja una (la otra repite y ve la primera).
 */
export function armarAbrirOrden(dependencias: DependenciasDeProduccion) {
  return async function abrirOrden(
    contexto: ContextoOperativo,
    entrada: EntradaDeAbrirOrden,
  ): Promise<R<SalidaDeAbrirOrden>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeAbrirOrden>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "transformaciones.abrir",
        ]);
        if (!permiso.ok) return permiso;
        const perilla = await exigirPerillaDeProduccion(tx, contexto);
        if (!perilla.ok) return perilla;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");

        for (const id of [
          entrada.id,
          entrada.productoId,
          entrada.depositoId,
          entrada.depositoDestinoId,
        ]) {
          if (typeof id !== "string" || !esUuid(id)) return err("IDENTIFICADOR_INVALIDO");
        }
        if (!esUnidad(entrada.unidadId)) return err("IDENTIFICADOR_INVALIDO");
        const cantidad = leerCantidad(entrada.cantidad);
        if (!cantidad.ok) return cantidad;
        const confirmaciones = leerConfirmaciones(entrada.confirmaciones);
        if (!confirmaciones.ok) return confirmaciones;
        const id = entrada.id.toLowerCase();

        const origen = await tx.depositos.obtener(empresaId, entrada.depositoId.toLowerCase());
        if (origen === null) return err("DEPOSITO_NO_ENCONTRADO");
        const destino = await tx.depositos.obtener(
          empresaId,
          entrada.depositoDestinoId.toLowerCase(),
        );
        if (destino === null) return err("DEPOSITO_DE_DESTINO_NO_ENCONTRADO");
        const alcance = await exigirAlcanceDeLasDosSucursales(tx, contexto, [
          origen.sucursalId,
          destino.sucursalId,
        ]);
        if (!alcance.ok) return alcance;

        const producto = await tx.productosParaStock.obtener(
          empresaId,
          entrada.productoId.toLowerCase(),
        );
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
        if (!esUnidad(producto.unidadBaseId))
          throw new RangeError("producción: unidad base desconocida");
        const enBase = convertirCantidad(
          cantidadDesdeTexto(cantidadATexto(cantidad.valor)),
          entrada.unidadId,
          producto.unidadBaseId,
        );
        if (!enBase.ok)
          return err(enBase.error === "FUERA_DE_RANGO" ? "CANTIDAD_INVALIDA" : enBase.error);
        const cantidadEnBase = cantidadATexto(enBase.valor);

        // Repetición: el mismo id es la misma orden; no depende de cómo esté el catálogo hoy.
        const previa = await tx.ordenesDeProduccion.obtener(empresaId, id);
        if (previa !== null) {
          const igual =
            previa.productoId === producto.id &&
            previa.depositoId === origen.id &&
            previa.depositoDestinoId === destino.id &&
            previa.cantidadEsperada === cantidadEnBase;
          if (!igual) return err("ID_REUTILIZADO");
          const guardados = await tx.ordenesDeProduccion.renglonesDe(empresaId, previa.id);
          const articulos = await tx.articulosDeStock.porIds(
            empresaId,
            guardados.map((r) => r.articuloId),
          );
          const dato = new Map(articulos.map((a) => [a.id, a]));
          return ok({
            ordenId: previa.id,
            numero: previa.numero,
            esperados: guardados.map((r) => ({
              articuloId: r.articuloId,
              productoId: dato.get(r.articuloId)?.productoId ?? r.articuloId,
              cantidad: r.cantidadEsperada,
              unidadId: dato.get(r.articuloId)?.unidadDeStockId ?? "",
            })),
            faltantes: [],
            yaExistia: true,
          });
        }

        if (!producto.activo) return err("PRODUCTO_INACTIVO");
        const articulo = (await tx.articulosDeStock.porProductos(empresaId, [producto.id]))[0];
        if (articulo === undefined || !articulo.activo) return err("PRODUCTO_NO_SE_PRODUCE");
        const receta = await tx.composicionesDeStock.ultimaVersion(empresaId, producto.id);
        if (receta === null || receta.componentes.length === 0) return err("PRODUCTO_SIN_RECETA");
        if (!origen.activo) return err("DEPOSITO_INACTIVO");
        if (!destino.activo) return err("DEPOSITO_INACTIVO");
        if (origen.uso !== "NORMAL") return err("USO_INVALIDO");
        if (destino.uso !== "NORMAL") return err("DEPOSITO_DE_DESTINO_NO_NORMAL");

        // Los esperados: la receta vigente (ya con sus elaborados) escalada; se explota SU receta, no su stock propio.
        const productos = await productosParaExplotar(tx, contexto, [producto.id]);
        const raiz = productos.get(producto.id);
        if (raiz === undefined) return err("PRODUCTO_NO_ENCONTRADO");
        const explosion = explotarConsumo({
          lineas: [
            {
              posicion: 1,
              productoId: producto.id,
              cantidad: enBase.valor,
              unidadDeVentaId: producto.unidadBaseId,
              variante: null,
              opciones: [],
            },
          ],
          productos: new Map(productos).set(producto.id, { ...raiz, articulo: null }),
          articulosDeInsumos: new Map(),
        });
        if (!explosion.ok) {
          const codigo = explosion.error.codigo;
          return err(
            codigo === "PRODUCTO_DESCONOCIDO"
              ? "PRODUCTO_NO_ENCONTRADO"
              : codigo === "FUERA_DE_RANGO" || codigo === "CANTIDAD_INVALIDA"
                ? "CANTIDAD_INVALIDA"
                : codigo === "OPCION_CON_CONSUMO_EN_VENTA_POR_PESO"
                  ? "IDENTIFICADOR_INVALIDO"
                  : codigo,
          );
        }
        // Se suma por insumo (la misma materia prima puede venir de dos versiones de receta) y se ordena por artículo: lo mismo en cada reintento.
        const porArticulo = new Map<string, bigint>();
        for (const r of explosion.valor.renglones) {
          porArticulo.set(
            r.articuloId,
            (porArticulo.get(r.articuloId) ?? 0n) - r.cantidad.unidades,
          );
        }
        const esperadosDeLaOrden: readonly RenglonEsperado[] = [...porArticulo]
          .filter(([, unidades]) => unidades > 0n)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([articuloId, unidades]) => ({ articuloId, composicionId: null, unidades }));
        if (esperadosDeLaOrden.length === 0) return err("PRODUCTO_SIN_RECETA");

        const evaluacion = await evaluarFaltantes(tx, contexto, {
          depositoId: origen.id,
          requeridos: esperadosDeLaOrden.map((e) => ({
            articuloId: e.articuloId,
            unidades: e.unidades,
          })),
          confirmaciones: confirmaciones.valor,
        });
        if (evaluacion === null) return err("DEPOSITO_NO_ENCONTRADO");
        const insumos = await tx.articulosDeStock.porIds(
          empresaId,
          esperadosDeLaOrden.map((e) => e.articuloId),
        );
        const insumoDe = new Map(insumos.map((a) => [a.id, a]));
        const texto = (unidades: bigint) => formatearDecimalFijo(unidades, 4);
        const necesarioDe = new Map(esperadosDeLaOrden.map((e) => [e.articuloId, e.unidades]));
        const faltantes: FaltanteDeOrden[] = evaluacion.faltantes.map((f) => ({
          productoId: insumoDe.get(f.articuloId)?.productoId ?? f.articuloId,
          existencia: cantidadConSignoATexto(f.existencia),
          necesario: texto(necesarioDe.get(f.articuloId) ?? 0n),
          unidadId: insumoDe.get(f.articuloId)?.unidadDeStockId ?? "",
        }));
        if (evaluacion.decision === "BLOQUEA" || evaluacion.decision === "REQUIERE_CONFIRMACION") {
          return err({
            error:
              evaluacion.decision === "BLOQUEA"
                ? "CONTROL_BLOQUEA"
                : "CONTROL_REQUIERE_CONFIRMACION",
            control: CONTROL_DE_NEGATIVO,
            detalle: evaluacion.faltantes.map((f) => ({
              productoId: insumoDe.get(f.articuloId)?.productoId ?? f.articuloId,
              depositoId: origen.id,
              existenciaResultante: cantidadConSignoATexto(f.existenciaResultante),
            })),
          });
        }

        const orden = await tx.ordenesDeProduccion.insertar(empresaId, {
          id,
          productoId: producto.id,
          articuloId: articulo.id,
          composicionId: receta.id,
          depositoId: origen.id,
          depositoDestinoId: destino.id,
          cantidadEsperada: cantidadEnBase,
          abiertaPor: persona,
          abiertaEn: contexto.ahora,
        });
        await tx.ordenesDeProduccion.insertarRenglones(
          empresaId,
          orden.id,
          esperadosDeLaOrden.map((e, i) => ({
            numero: i + 1,
            articuloId: e.articuloId,
            composicionId: null,
            cantidadEsperada: texto(e.unidades),
          })),
        );
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "ORDEN_DE_PRODUCCION_ABIERTA",
          entidad: "orden_de_produccion",
          entidadId: orden.id,
          antes: null,
          despues: {
            numero: orden.numero,
            productoId: producto.id,
            cantidadEsperada: cantidadEnBase,
            depositoId: origen.id,
            depositoDestinoId: destino.id,
            composicionId: receta.id,
          },
        });
        // Lo que pasa con faltante porque el control lo permite o la persona lo confirmó: una excepción auditada por insumo.
        if (evaluacion.decision === "PASA_CON_EXCEPCION" && evaluacion.nivel !== "BLOQUEAR") {
          for (const f of evaluacion.faltantes) {
            const registro = registroDeExcepcion(
              {
                control: CONTROL_DE_NEGATIVO,
                nivel: evaluacion.nivel,
                confirmado: confirmaciones.valor.includes(CONTROL_DE_NEGATIVO),
              },
              { entidad: "orden_de_produccion", entidadId: orden.id },
            );
            await tx.auditoria.registrar({
              empresaId,
              actorPersonaId: persona,
              accion: registro.accion,
              entidad: registro.entidad,
              entidadId: registro.entidadId,
              despues: {
                ...registro.despues,
                depositoId: origen.id,
                productoId: insumoDe.get(f.articuloId)?.productoId ?? f.articuloId,
                existenciaResultante: cantidadConSignoATexto(f.existenciaResultante),
              },
            });
          }
        }
        return ok({
          ordenId: orden.id,
          numero: orden.numero,
          esperados: esperadosDeLaOrden.map((e) => ({
            articuloId: e.articuloId,
            productoId: insumoDe.get(e.articuloId)?.productoId ?? e.articuloId,
            cantidad: texto(e.unidades),
            unidadId: insumoDe.get(e.articuloId)?.unidadDeStockId ?? "",
          })),
          faltantes,
          yaExistia: false,
        });
      },
    );
    return traducir(resultado);
  };
}

export type { TxDeProduccion };
