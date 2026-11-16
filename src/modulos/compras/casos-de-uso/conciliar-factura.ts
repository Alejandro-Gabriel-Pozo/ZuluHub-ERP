import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { leerAsignaciones, type AsignacionPedida } from "../dominio/conciliacion-separada";
import { esUuid } from "../dominio/identificadores";
import { esNivelDeRecepcionSeparada } from "../dominio/recepcion-separada";
import { claveDeLaAnulacionDeLaConciliacion } from "../dominio/registrar-compra";
import type { AsignacionGuardada } from "../persistencia/repositorio-de-conciliaciones";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";
import { registrarDiferenciasDeLaConciliacion } from "./diferencias-de-conciliacion";

type R<S> = Resultado<S, ErrorDeCompras>;

export type EntradaDeConciliarFactura = Readonly<{
  /** Un UUID que genera la pantalla al abrir: es la idempotencia de la conciliación. */
  clave: string;
  comprobanteId: string;
  /** Lo que la persona confirma (`dominio/conciliacion-separada.ts`): cada línea de la factura con la línea recibida que cubre y cuánto. */
  asignaciones: unknown;
}>;

export type SalidaDeConciliarFactura = Readonly<{
  conciliacionId: string;
  /** `true`: la misma conciliación ya estaba hecha (misma clave y mismas asignaciones): no se escribió ni se auditó nada. */
  yaExistia: boolean;
}>;

const lasMismas = (
  guardadas: readonly AsignacionGuardada[],
  pedidas: readonly AsignacionPedida[],
) => {
  const de = (x: readonly (AsignacionGuardada | AsignacionPedida)[]) =>
    x
      .map((a) => {
        const linea = "lineaDeFactura" in a ? a.lineaDeFactura : a.lineaDeComprobante;
        return `${String(linea)}|${a.recepcionId}|${String(a.lineaDeRecepcion)}|${a.cantidad}`;
      })
      .sort()
      .join(";");
  return de(guardadas) === de(pedidas);
};

/**
 * Conciliar la factura de N3 o N4 con lo recibido (E9 §3.8): la persona confirma qué línea recibida cubre cada línea de la factura y cuánto (la propuesta la arma
 * `proponerConciliacion`). Guard `conciliaciones.conciliar` (gerente y administrador) y la sucursal de cada recepción en el alcance. Cada asignación tiene que ser de una línea
 * de la factura con producto, de una recepción CONFIRMADA de N3 o N4 del MISMO proveedor, del MISMO producto y no rechazada; lo asignado nunca supera lo recibido ni lo
 * facturado (lo impone la base con los saldos: dos conciliaciones a la vez sobre la misma línea, gana una y la otra es `CANTIDAD_ASIGNADA_EXCEDE_LO_RECIBIDO` o
 * `...LO_FACTURADO`). Todo o nada. Repetición: misma clave y mismas asignaciones devuelve lo hecho (`yaExistia`); misma clave con otras, `CLAVE_REUTILIZADA`.
 */
export function armarConciliarFactura(dependencias: DependenciasDeCompras) {
  return async function conciliarFactura(
    contexto: ContextoOperativo,
    entrada: EntradaDeConciliarFactura,
  ): Promise<R<SalidaDeConciliarFactura>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.clave) || !esUuid(entrada.comprobanteId))
      return err("IDENTIFICADOR_INVALIDO");
    const asignaciones = leerAsignaciones(entrada.asignaciones);
    if (!asignaciones.ok) return asignaciones;

    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeConciliarFactura>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "conciliaciones.conciliar",
          ]);
          if (!permiso.ok) return permiso;
          const comprobante = await tx.comprobantesDeProveedor.bloquear(
            empresaId,
            entrada.comprobanteId,
          );
          if (
            comprobante === null ||
            !esNivelDeRecepcionSeparada(comprobante.nivel) ||
            comprobante.esAtajo
          ) {
            return err("COMPROBANTE_NO_ENCONTRADO");
          }
          if (comprobante.estado === "ANULADO") return err("COMPROBANTE_ANULADO");

          const previa = await tx.conciliacionesDeCompra.porClave(empresaId, entrada.clave);
          if (previa !== null) {
            const hechas = await tx.conciliacionesDeCompra.asignacionesDe(empresaId, previa.id);
            if (
              previa.acto !== "CONCILIACION" ||
              previa.comprobanteId !== comprobante.id ||
              !lasMismas(hechas, asignaciones.valor)
            ) {
              return err("CLAVE_REUTILIZADA");
            }
            return ok({ conciliacionId: previa.id, yaExistia: true });
          }

          const lineas = await tx.detalleDeComprobantes.lineasDe(empresaId, comprobante.id);
          const recibidas = await tx.recepcionesSeparadas.lineasConciliables(
            empresaId,
            comprobante.proveedorId,
          );
          const sucursales = new Map<string, string>();
          for (const a of asignaciones.valor) {
            const facturada = lineas.find((l) => l.numero === a.lineaDeFactura);
            if (facturada === undefined) return err("LINEA_NO_ENCONTRADA");
            const recibida = recibidas.find(
              (r) => r.recepcionId === a.recepcionId && r.linea === a.lineaDeRecepcion,
            );
            if (recibida === undefined) return err("ASIGNACION_NO_CONCILIABLE");
            if (facturada.productoId === null || facturada.productoId === undefined) {
              return err("ASIGNACION_NO_CONCILIABLE");
            }
            if (facturada.productoId !== recibida.productoId) {
              return err("ASIGNACION_DE_OTRO_PRODUCTO");
            }
            if (!sucursales.has(a.recepcionId)) {
              const recepcion = await tx.recepcionesSeparadas.obtenerSeparada(
                empresaId,
                a.recepcionId,
              );
              if (recepcion === null) return err("ASIGNACION_NO_CONCILIABLE");
              sucursales.set(a.recepcionId, recepcion.sucursalId);
            }
          }
          for (const sucursal of new Set(sucursales.values())) {
            const alcance = await exigirAlcanceDeSucursal(tx, contexto, sucursalId(sucursal));
            if (!alcance.ok) return alcance;
          }

          const conciliacionId = await tx.conciliacionesDeCompra.insertarConciliacion(empresaId, {
            acto: "CONCILIACION",
            anulaA: null,
            comprobanteId: comprobante.id,
            esAtajo: false,
            nivel: comprobante.nivel,
            clave: entrada.clave,
            registradoPor: persona,
          });
          if (conciliacionId === undefined) {
            throw new Error("la conciliación chocó con una restricción única que no es su clave");
          }
          await tx.conciliacionesDeCompra.insertarAsignaciones(
            empresaId,
            { id: conciliacionId, acto: "CONCILIACION", comprobanteId: comprobante.id },
            asignaciones.valor.map((a, i) => ({
              numero: i + 1,
              lineaDeComprobante: a.lineaDeFactura,
              recepcionId: a.recepcionId,
              lineaDeRecepcion: a.lineaDeRecepcion,
              cantidad: a.cantidad,
            })),
          );
          // En N4 la conciliación calcula las diferencias (misma transacción); en N3 no las hay.
          const configuracion = await tx.configuracionDeCompras.leer(empresaId);
          const diferencias =
            configuracion.nivel === "TRES_VIAS"
              ? await registrarDiferenciasDeLaConciliacion(
                  tx,
                  contexto,
                  { id: conciliacionId, comprobanteId: comprobante.id },
                  asignaciones.valor,
                )
              : null;
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "CONCILIACION_REGISTRADA",
            entidad: "conciliacion",
            entidadId: conciliacionId,
            despues: {
              comprobanteId: comprobante.id,
              asignaciones: asignaciones.valor.length,
              ...(diferencias === null
                ? {}
                : { diferencias: diferencias.total, diferenciasAbiertas: diferencias.abiertas }),
            },
          });
          return ok({ conciliacionId, yaExistia: false });
        },
      ),
    );
  };
}

export type EntradaDeAnularConciliacion = Readonly<{ conciliacionId: string }>;

/**
 * Anular una conciliación de N3 o N4 (el espejo, una sola vez): se registra otro acto con las cantidades opuestas y las líneas recibidas y facturadas recuperan su saldo
 * (nada se borra). Guard `conciliaciones.anular` (gerente y administrador). La del atajo de N1 y N2 no se anula por acá. Una ya anulada es `CONCILIACION_YA_ANULADA` y no escribe;
 * dos anulaciones a la vez dejan un solo espejo (se serializan por el comprobante y lo impone la única `(empresa, anula_a)`).
 */
export function armarAnularConciliacion(dependencias: DependenciasDeCompras) {
  return async function anularConciliacion(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularConciliacion,
  ): Promise<R<Readonly<{ anulada: true }>>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.conciliacionId)) return err("CONCILIACION_NO_ENCONTRADA");
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<Readonly<{ anulada: true }>>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "conciliaciones.anular",
          ]);
          if (!permiso.ok) return permiso;
          const conciliacion = await tx.conciliacionesDeCompra.obtener(
            empresaId,
            entrada.conciliacionId,
          );
          if (
            conciliacion === null ||
            conciliacion.acto !== "CONCILIACION" ||
            conciliacion.esAtajo
          ) {
            return err("CONCILIACION_NO_ENCONTRADA");
          }
          const comprobante = await tx.comprobantesDeProveedor.bloquear(
            empresaId,
            conciliacion.comprobanteId,
          );
          if (comprobante === null || !esNivelDeRecepcionSeparada(comprobante.nivel)) {
            return err("CONCILIACION_NO_ENCONTRADA");
          }
          const deLaFactura = await tx.conciliacionesDeCompra.conciliacionesDe(
            empresaId,
            comprobante.id,
          );
          if (deLaFactura.some((c) => c.anulaA === conciliacion.id)) {
            return err("CONCILIACION_YA_ANULADA");
          }
          const hechas = await tx.conciliacionesDeCompra.asignacionesDe(empresaId, conciliacion.id);
          const espejoId = await tx.conciliacionesDeCompra.insertarConciliacion(empresaId, {
            acto: "ANULACION",
            anulaA: conciliacion.id,
            comprobanteId: comprobante.id,
            esAtajo: false,
            nivel: comprobante.nivel,
            clave: claveDeLaAnulacionDeLaConciliacion(conciliacion.id),
            registradoPor: persona,
          });
          if (espejoId === undefined) return err("CONCILIACION_YA_ANULADA");
          await tx.conciliacionesDeCompra.insertarAsignaciones(
            empresaId,
            { id: espejoId, acto: "ANULACION", comprobanteId: comprobante.id },
            hechas.map((a) => ({ ...a, cantidad: `-${a.cantidad}` })),
          );
          // Las diferencias de la conciliación se anulan con ella (las ya resueltas conservan su resolución).
          const diferenciasAnuladas = await tx.diferenciasDeCompra.anularDeLaConciliacion(
            empresaId,
            conciliacion.id,
          );
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "CONCILIACION_ANULADA",
            entidad: "conciliacion",
            entidadId: conciliacion.id,
            despues: { comprobanteId: comprobante.id, espejoId, diferenciasAnuladas },
          });
          return ok({ anulada: true });
        },
      ),
    );
  };
}
