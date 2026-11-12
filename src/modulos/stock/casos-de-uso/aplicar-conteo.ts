import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeTexto,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { explicarConMarcas } from "../dominio/conteo";
import { huellaDeComando } from "../dominio/huella";
import {
  MOTIVO_QUE_EXIGE_AJUSTAR,
  validarMotivoDeDiferencia,
} from "../dominio/motivos-de-diferencia";
import type { AltaDeDiferencia, AltaDeMarca } from "../persistencia/repositorio-de-conteos";
import { autorizar } from "./comun";
import { claveDelAjusteDeConteo, cargarConteo } from "./conteos-comun";
import type { DependenciasDeStock, TxDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";
import { registrarMovimientoEnTx } from "./movimiento-en-tx";
import { leerDetalle, leerId, MAXIMO_DE_RENGLONES, traducirMovimiento } from "./movimientos-comun";
import { revisarConteo, type RevisionDeArticulo } from "./revision-de-conteo";

type R<S> = Resultado<S, ErrorDeStock>;

/** Un movimiento que quien aplica marca como «ya había ocurrido cuando contó» (opcional: solo si la hora declarada quedó mal). */
export type MarcaPedida = Readonly<{ movimientoId: string; numero: number }>;

/**
 * Lo que responde quien aplica sobre un artículo contado: el motivo de lo que QUEDA de diferencia (de la lista cerrada del sistema) y, si el motivo es
 * «otra salida» u «otra entrada», un detalle. Un artículo sin diferencia no lleva respuesta (no se pregunta nada).
 */
export type RespuestaDeConteo = Readonly<{
  productoId: string;
  motivo?: string | null | undefined;
  detalle?: string | null | undefined;
  marcas?: readonly MarcaPedida[] | undefined;
}>;

export type EntradaDeAplicarConteo = Readonly<{
  conteoId: string;
  /** La huella de la revisión que la persona vio (`fichaDeConteo`): si lo que hay ahora es otra cosa, no se aplica (`REVISION_DESACTUALIZADA`). */
  huella: string;
  respuestas?: readonly RespuestaDeConteo[] | undefined;
}>;
export type SalidaDeAplicarConteo = Readonly<{
  /** El ajuste por conteo; `null` si ningún artículo contado quedó con diferencia (el conteo se resolvió sin escribir un ajuste). */
  movimientoId: string | null;
  /** `true`: el conteo ya estaba aplicado (misma aplicación repetida): no se escribió ni se auditó nada. */
  yaAplicado: boolean;
}>;

type RespuestaLeida = Readonly<{
  productoId: string;
  motivo: string | null;
  detalle: string | null;
  marcas: readonly MarcaPedida[];
}>;

const comoObjeto = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Las marcas de una respuesta: una lista de `{ movimientoId, numero }`, de a lo sumo los renglones que cabe un movimiento (nadie marca más de lo que
 * existe); lo demás es `MOVIMIENTO_NO_EXPLICA` (no explica nada que exista).
 */
function leerMarcas(valor: unknown): R<readonly MarcaPedida[]> {
  if (valor === undefined) return ok([]);
  if (!Array.isArray(valor) || valor.length > MAXIMO_DE_RENGLONES)
    return err("MOVIMIENTO_NO_EXPLICA");
  const marcas: MarcaPedida[] = [];
  for (const cruda of valor as unknown[]) {
    const marca = comoObjeto(cruda);
    const movimientoId = marca === null ? null : leerId(marca["movimientoId"]);
    const numero = marca === null ? null : marca["numero"];
    if (movimientoId === null || typeof numero !== "number" || !Number.isInteger(numero)) {
      return err("MOVIMIENTO_NO_EXPLICA");
    }
    marcas.push({ movimientoId, numero });
  }
  return ok(marcas);
}

/**
 * Lo que mandó la pantalla, leído con la lista de permitidos: cada respuesta es de un producto (UUID), con motivo (texto o ausente), detalle (el
 * de una línea de stock) y marcas. Nada se supone: una forma que no es esta se rechaza.
 */
function leerRespuestas(valor: unknown): R<readonly RespuestaLeida[]> {
  if (valor === undefined) return ok([]);
  if (!Array.isArray(valor)) return err("RENGLONES_INVALIDOS");
  const respuestas: RespuestaLeida[] = [];
  for (const cruda of valor as unknown[]) {
    const respuesta = comoObjeto(cruda);
    if (respuesta === null) return err("RENGLONES_INVALIDOS");
    const productoId = leerId(respuesta["productoId"]);
    if (productoId === null) return err("ARTICULO_NO_CONTROLADO");
    const motivo = respuesta["motivo"];
    if (motivo !== undefined && motivo !== null && typeof motivo !== "string") {
      return err("MOTIVO_NO_CORRESPONDE");
    }
    const detalle = leerDetalle(respuesta["detalle"], false);
    if (!detalle.ok) return detalle;
    const marcas = leerMarcas(respuesta["marcas"]);
    if (!marcas.ok) return marcas;
    respuestas.push({
      productoId,
      motivo: motivo ?? null,
      detalle: detalle.valor,
      marcas: marcas.valor,
    });
  }
  return ok(respuestas);
}

/** La explicación ya decidida de un artículo contado: lo que se guarda y, si quedó diferencia, el renglón del ajuste. */
type Explicacion = Readonly<{
  revision: RevisionDeArticulo;
  marcado: CantidadConSigno;
  diferenciaFinal: CantidadConSigno;
  motivo: string | null;
  detalle: string | null;
  marcas: readonly Readonly<{ movimientoId: string; numero: number; cantidad: string }>[];
}>;

/**
 * Decide la explicación de cada artículo contado con las respuestas de la persona: las marcas se verifican contra el libro (existen, son del
 * depósito y del artículo, ocurrieron después de la hora y son del sentido de la diferencia), la diferencia final es `Δ0 − marcado` y el motivo tiene
 * que corresponder a ella. Una respuesta de un producto sin carga, o repetida, se rechaza. No escribe nada.
 */
async function explicarArticulos(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  depositoId: string,
  articulos: readonly RevisionDeArticulo[],
  respuestas: readonly RespuestaLeida[],
): Promise<R<readonly Explicacion[]>> {
  const productos = await tx.articulosDeStock.porProductos(
    contexto.empresaId,
    respuestas.map((r) => r.productoId),
  );
  const articuloDeProducto = new Map(productos.map((a) => [a.productoId, a.id]));
  const respuestaDe = new Map<string, RespuestaLeida>();
  for (const respuesta of respuestas) {
    const articuloId = articuloDeProducto.get(respuesta.productoId);
    if (articuloId === undefined || !articulos.some((a) => a.articuloId === articuloId)) {
      return err("RENGLONES_INVALIDOS");
    }
    if (respuestaDe.has(articuloId)) return err("RENGLON_REPETIDO");
    respuestaDe.set(articuloId, respuesta);
  }

  const explicaciones: Explicacion[] = [];
  for (const revision of articulos) {
    const respuesta = respuestaDe.get(revision.articuloId);
    const pedidas = respuesta?.marcas ?? [];
    if (new Set(pedidas.map((m) => `${m.movimientoId}|${m.numero}`)).size !== pedidas.length) {
      return err("RENGLON_REPETIDO");
    }
    const renglones = await tx.conteosDeStock.renglonesPorClave(
      contexto.empresaId,
      depositoId,
      revision.articuloId,
      pedidas,
    );
    if (renglones.length !== pedidas.length) return err("MOVIMIENTO_NO_EXPLICA");
    const marcables = [];
    for (const renglon of renglones) {
      const cantidad = cantidadConSignoDesdeTexto(renglon.cantidad);
      if (!cantidad.ok) throw new RangeError("stock: la base devolvió una cantidad ilegible");
      marcables.push({ cantidad: cantidad.valor, hechoEn: renglon.hechoEn });
    }
    const explicada = explicarConMarcas(revision.diferenciaBruta, revision.hora, marcables);
    if (!explicada.ok) {
      return err(explicada.error === "FUERA_DE_RANGO" ? "CANTIDAD_INVALIDA" : explicada.error);
    }
    const motivo = validarMotivoDeDiferencia(
      explicada.valor.diferenciaFinal,
      respuesta?.motivo ?? null,
      respuesta?.detalle ?? null,
    );
    if (!motivo.ok) return motivo;
    explicaciones.push({
      revision,
      marcado: explicada.valor.marcado,
      diferenciaFinal: explicada.valor.diferenciaFinal,
      motivo: motivo.valor === null ? null : motivo.valor.codigo,
      detalle: respuesta?.detalle ?? null,
      marcas: renglones.map((r) => ({
        movimientoId: r.movimientoId,
        numero: r.numero,
        cantidad: r.cantidad,
      })),
    });
  }
  return ok(explicaciones);
}

/**
 * Aplicar un conteo (E5 conteo con hora, §2.3 y §4; D125, D132). Guard `conteos.aplicar` (administrador y gerente; el motivo `VENCIMIENTO` pide además
 * `stock.ajustar`, S-7). UNA transacción: `ABIERTO → APLICADO` con `UPDATE … WHERE estado = 'ABIERTO'` sobre el conteo bloqueado (de dos aplicaciones,
 * o de aplicar y cancelar, a la vez gana una), un `AJUSTE_POR_CONTEO` con un renglón por artículo que SIGUE con diferencia después de explicarla, y la
 * explicación de CADA artículo cargado (`conteo_diferencia`, también con diferencia cero) con sus marcas. Cada artículo se compara contra lo que el
 * sistema creía a la hora en que se contó: lo vendido después (ya incluido en lo que hay) no se toca, y lo no contado no cambia. Solo si queda
 * diferencia se pide motivo (`MOTIVO_REQUERIDO`, de la lista del sentido: `MOTIVO_NO_CORRESPONDE`; «otra» pide `DETALLE_REQUERIDO`). Como es un ajuste,
 * nunca se bloquea por existencia negativa. «Venta no registrada» es solo un motivo: no crea ticket, venta ni cobro.
 *
 * La `huella` de la revisión que la persona vio se recalcula acá (`REVISION_DESACTUALIZADA` si difiere: nada se escribe). Sin cargas no se aplica
 * (`CONTEO_SIN_REGISTROS`); cancelado es `CONTEO_CANCELADO`. Repetición (`YA_ESTABA`): un conteo ya aplicado devuelve el ajuste que se hizo con
 * `yaAplicado: true`, sin escribir ni auditar y sin mirar las respuestas (lo primero que se aplicó manda); la clave del ajuste es derivada del
 * conteo y la explicación es única por (conteo, artículo), así que la base tampoco admite dos.
 */
export function armarAplicarConteo(dependencias: DependenciasDeStock) {
  return async function aplicarConteo(
    contexto: ContextoOperativo,
    entrada: EntradaDeAplicarConteo,
  ): Promise<R<SalidaDeAplicarConteo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeAplicarConteo>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["conteos.aplicar"]);
        if (!permiso.ok) return permiso;
        const conteo = await cargarConteo(tx, contexto, entrada.conteoId, true);
        if (!conteo.ok) return conteo;
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        const clave = claveDelAjusteDeConteo(conteo.valor.id);

        if (conteo.valor.estado === "CANCELADO") return err("CONTEO_CANCELADO");
        if (conteo.valor.estado === "APLICADO") {
          const ajuste = await tx.movimientosDeStock.porClave(empresaId, clave);
          return ok({ movimientoId: ajuste === null ? null : ajuste.id, yaAplicado: true });
        }

        const revision = await revisarConteo(tx.conteosDeStock, empresaId, conteo.valor);
        if (!revision.ok) return revision;
        if (revision.valor.articulos.length === 0) return err("CONTEO_SIN_REGISTROS");
        if (entrada.huella !== revision.valor.huella) return err("REVISION_DESACTUALIZADA");

        const respuestas = leerRespuestas(entrada.respuestas);
        if (!respuestas.ok) return respuestas;
        const explicaciones = await explicarArticulos(
          tx,
          contexto,
          conteo.valor.depositoId,
          revision.valor.articulos,
          respuestas.valor,
        );
        if (!explicaciones.ok) return explicaciones;
        if (explicaciones.valor.some((e) => e.motivo === MOTIVO_QUE_EXIGE_AJUSTAR)) {
          const ajustar = await exigirAccion(dependencias.reglas, "stock.ajustar", () =>
            tx.autorizacion.delActor(contexto),
          );
          if (!ajustar.ok) return ajustar;
        }

        const resuelto = await tx.conteosDeStock.resolver(empresaId, conteo.valor.id, {
          estado: "APLICADO",
          resueltoPor: persona,
          resueltoEn: contexto.ahora,
          motivo: null,
        });
        // El conteo está bloqueado y abierto: que ya no lo esté es un defecto, no una carrera.
        if (resuelto === null) throw new Error("el conteo bloqueado dejó de estar abierto");

        const conDiferencia = explicaciones.valor.filter((e) => e.diferenciaFinal.unidades !== 0n);
        let movimientoId: string | null = null;
        if (conDiferencia.length > 0) {
          const registrado = await registrarMovimientoEnTx(tx, contexto, {
            clase: "AJUSTE_POR_CONTEO",
            motivo: "CONTEO",
            detalle: null,
            origen: null,
            depositoId: conteo.valor.depositoId,
            accion: "conteos.aplicar",
            anulaA: null,
            conteoId: conteo.valor.id,
            clave,
            huella: huellaDeComando(
              "aplicar_conteo",
              [conteo.valor.id],
              conDiferencia.map((e) => [
                e.revision.articuloId,
                cantidadConSignoATexto(e.diferenciaFinal),
              ]),
            ),
            hechoEn: contexto.ahora,
            fechaDeNegocio: null,
            renglones: conDiferencia.map((e) => ({
              depositoId: conteo.valor.depositoId,
              articuloId: e.revision.articuloId,
              composicionId: null,
              cantidad: e.diferenciaFinal,
            })),
            confirmaciones: [],
          });
          if (!registrado.ok) return registrado;
          movimientoId = registrado.valor.movimiento.id;
        }

        const diferencias: AltaDeDiferencia[] = explicaciones.valor.map((e) => ({
          conteoId: conteo.valor.id,
          articuloId: e.revision.articuloId,
          registroId: e.revision.registroId,
          contada: cantidadATexto(e.revision.contada),
          contadoEn: e.revision.hora,
          existenciaALaHora: cantidadConSignoATexto(e.revision.existenciaALaHora),
          diferenciaBruta: cantidadConSignoATexto(e.revision.diferenciaBruta),
          marcado: cantidadConSignoATexto(e.marcado),
          diferenciaFinal: cantidadConSignoATexto(e.diferenciaFinal),
          motivo: e.motivo,
          detalle: e.detalle,
          explicadaPor: persona,
          explicadaEn: contexto.ahora,
        }));
        const marcas: AltaDeMarca[] = explicaciones.valor.flatMap((e) =>
          e.marcas.map((m) => ({
            conteoId: conteo.valor.id,
            articuloId: e.revision.articuloId,
            movimientoId: m.movimientoId,
            numero: m.numero,
            cantidad: m.cantidad,
            marcadaPor: persona,
            marcadaEn: contexto.ahora,
          })),
        );
        await tx.conteosDeStock.insertarDiferencias(empresaId, diferencias);
        await tx.conteosDeStock.insertarMarcas(empresaId, marcas);

        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "CONTEO_APLICADO",
          entidad: "conteo_fisico",
          entidadId: conteo.valor.id,
          antes: { estado: "ABIERTO" },
          despues: {
            estado: "APLICADO",
            movimientoId,
            renglonesConDiferencia: conDiferencia.length,
            articulosExplicados: diferencias.length,
            marcas: marcas.length,
          },
        });
        return ok({ movimientoId, yaAplicado: false });
      },
    );
    return traducirMovimiento(resultado);
  };
}
