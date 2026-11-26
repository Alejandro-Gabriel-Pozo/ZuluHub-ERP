import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { CONTROL_DE_NEGATIVO, motivosManualesDe } from "../modulos/stock/publico";
import { err, ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeAjuste,
  entradaDeAnulacion,
  entradaDeMovimiento,
  entradaDeTransferencia,
} from "./entradas-de-movimientos";
import { accionDeStock } from "./errores-de-stock";
import type { Web } from "./web";

/**
 * Los movimientos de stock a mano (STK-B2): Entrada, Salida, Transferir, Ajustar y Anular. Reglas de esta capa: la sucursal la pone el servidor; los depósitos tienen que ser de ESA sucursal y el artículo
 * uno de los que se pueden mover (su producto y su unidad salen del servidor, no del navegador); lo demás (cantidad, costo, motivo, detalle, permisos, existencia) lo decide el caso de uso dentro de su
 * transacción. La clave de idempotencia la genera la página al abrir el formulario: repetir el gesto devuelve lo ya hecho (`yaExistia`) sin duplicar. Un depósito o artículo que no corresponde sale como el genérico.
 */

export type DependenciasDeMovimientosWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeStock"]>,
    "registrarEntrada" | "registrarSalida" | "transferir" | "ajustar" | "anularMovimiento"
  >;
  consultas: () => Pick<
    ReturnType<Web["consultasDeStock"]>,
    "articulosControlados" | "listarDepositos"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

export type OpcionesDeMovimiento = Readonly<{
  depositos: readonly Readonly<{ id: string; nombre: string; uso: string }>[];
  articulos: readonly Readonly<{ id: string; nombre: string; unidadId: string }>[];
  motivosDeEntrada: readonly string[];
  motivosDeSalida: readonly string[];
}>;

/** Lo que ofrecen los formularios: los depósitos activos de la sucursal, los artículos que se pueden mover y los motivos manuales (la entrada «Carga inicial» va por su propia pantalla). */
export function opcionesParaMover(
  d: DependenciasDeMovimientosWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<OpcionesDeMovimiento>> {
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
    ({ depositos, articulos }): OpcionesDeMovimiento => ({
      depositos: depositos
        .filter((x) => x.activo)
        .map((x) => ({ id: x.id, nombre: x.nombre, uso: x.uso })),
      articulos: articulos.map((x) => ({
        id: x.articuloId,
        nombre: x.nombre,
        unidadId: x.unidadId,
      })),
      motivosDeEntrada: motivosManualesDe("ENTRADA").filter((m) => m !== "CARGA_INICIAL"),
      motivosDeSalida: motivosManualesDe("SALIDA"),
    }),
  );
}

/** El artículo pedido (con su producto y su unidad de stock) y los depósitos pedidos, todos validados contra lo que el servidor ofrece a esta persona en esta sucursal. */
async function resolver(
  d: DependenciasDeMovimientosWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  depositoIds: readonly string[],
  articuloId: string,
) {
  const depositos = await d.consultas().listarDepositos(contexto, { sucursalId });
  if (!depositos.ok) return depositos;
  if (!depositoIds.every((id) => depositos.valor.some((x) => x.id === id && x.activo)))
    return err("DEPOSITO_NO_ENCONTRADO" as const);
  const articulos = await d.consultas().articulosControlados(contexto);
  if (!articulos.ok) return articulos;
  const articulo = articulos.valor.find((x) => x.articuloId === articuloId);
  return articulo === undefined ? err("ARTICULO_NO_CONTROLADO" as const) : ok(articulo);
}

type Hecho = Readonly<{ movimientoId: string; yaExistia: boolean }>;
const comoHecho = (s: Hecho): Hecho => ({ movimientoId: s.movimientoId, yaExistia: s.yaExistia });

/** Lo que confirma la persona que vio el aviso: solo el control de existencia negativa, y solo si lo confirmó (con el nivel PERMITIR el servidor no lo necesita y no cambia nada). */
const confirmaciones = (confirmar: boolean) =>
  confirmar ? { confirmaciones: [CONTROL_DE_NEGATIVO] } : {};

/** Registra una entrada (`entrada: true`) o una salida a mano de un artículo en un depósito de la sucursal. El costo por unidad solo corresponde a la entrada por compra (lo decide el servidor). */
export function registrarElMovimiento(
  d: DependenciasDeMovimientosWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  entrada: boolean,
  crudo: unknown,
): Promise<Respuesta<Hecho>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    entradaDeMovimiento,
    async (e) => {
      const r = await resolver(d, contexto, sucursalId, [e.depositoId], e.articuloId);
      if (!r.ok) return r;
      const base = {
        clave: e.clave,
        depositoId: e.depositoId,
        motivo: e.motivo,
        detalle: e.detalle,
      };
      // Un costo mandado en una salida lo rechaza el servidor (`COSTO_INVALIDO`): la pantalla no lo filtra.
      const renglones = [
        {
          productoId: r.valor.productoId,
          cantidad: e.cantidad,
          unidadId: r.valor.unidadId,
          costoUnitario: e.costoUnitario,
        },
      ];
      return entrada
        ? d.casosDeUso().registrarEntrada(contexto, { ...base, renglones })
        : d
            .casosDeUso()
            .registrarSalida(contexto, { ...base, renglones, ...confirmaciones(e.confirmar) });
    },
    comoHecho,
  );
}

/** Pasa existencia de un depósito de la sucursal a otro. Origen y destino iguales los rechaza el servidor. */
export function transferirElStock(
  d: DependenciasDeMovimientosWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Hecho>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    entradaDeTransferencia,
    async (e) => {
      const r = await resolver(d, contexto, sucursalId, [e.origenId, e.destinoId], e.articuloId);
      if (!r.ok) return r;
      return d.casosDeUso().transferir(contexto, {
        clave: e.clave,
        origenId: e.origenId,
        destinoId: e.destinoId,
        ...confirmaciones(e.confirmar),
        renglones: [
          { productoId: r.valor.productoId, cantidad: e.cantidad, unidadId: r.valor.unidadId },
        ],
      });
    },
    comoHecho,
  );
}

/** Corrige la existencia de un artículo (sobra o falta) con su detalle, que es obligatorio. */
export function ajustarElStock(
  d: DependenciasDeMovimientosWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Hecho>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    entradaDeAjuste,
    async (e) => {
      const r = await resolver(d, contexto, sucursalId, [e.depositoId], e.articuloId);
      if (!r.ok) return r;
      return d.casosDeUso().ajustar(contexto, {
        clave: e.clave,
        depositoId: e.depositoId,
        detalle: e.detalle ?? "",
        renglones: [
          {
            productoId: r.valor.productoId,
            cantidad: e.cantidad,
            unidadId: r.valor.unidadId,
            sentido: e.sentido,
          },
        ],
      });
    },
    comoHecho,
  );
}

/** Anula un movimiento con su detalle (obligatorio): el servidor crea el espejo; lo ya anulado o no anulable lo rechaza. */
export function anularElMovimiento(
  d: DependenciasDeMovimientosWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaExistia: boolean }>>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    entradaDeAnulacion,
    (e) =>
      d.casosDeUso().anularMovimiento(contexto, {
        clave: e.clave,
        movimientoId: e.movimientoId,
        detalle: e.detalle ?? "",
      }),
    (s) => ({ yaExistia: s.yaExistia }),
  );
}
