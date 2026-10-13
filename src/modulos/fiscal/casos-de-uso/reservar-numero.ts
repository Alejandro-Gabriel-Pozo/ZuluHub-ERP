import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { TipoDeComprobante } from "../dominio/comprobante-emitido";
import type { PuntoDeVentaId, SolicitudId } from "../dominio/identificadores";
import {
  OPCIONES_DE_NUMERACION,
  iniciarSerie,
  reservarNumero,
  type ErrorDeNumeracion,
} from "../dominio/numeracion";
import { datosDeSerie, empresaOpera, entidadDeSerie, puntoDeVentaParaEmision } from "./comun";
import type { DependenciasDeNumeracion } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import type { ErrorDeEmision, PuntoDeVentaParaEmision } from "./emision-electronica";

export type EntradaDeReservarNumero = Readonly<{
  puntoDeVentaId: PuntoDeVentaId;
  tipo: TipoDeComprobante;
  /** La identidad del pedido (la proforma): repetir con la misma devuelve el mismo número. */
  solicitud: SolicitudId;
}>;

export type SalidaDeReservarNumero = Readonly<{
  /** El número reservado para la solicitud. */
  numero: bigint;
  /** Lo que el servicio de emisión necesita para autorizarlo. */
  puntoDeVenta: PuntoDeVentaParaEmision;
  /** `true`: la misma solicitud ya lo había reservado; no se escribió nada. */
  yaReservada: boolean;
}>;

type ErrorPropioAlReservar =
  | "PUNTO_DE_VENTA_NO_ENCONTRADO"
  | "PUNTO_DE_VENTA_INACTIVO"
  | "EMISOR_INACTIVO"
  | ErrorDeNumeracion;

export type ErrorAlReservarNumero =
  ErrorPropioAlReservar | MotivoDeRechazo | EmpresaNoOpera | ErrorDeEmision | ErrorDePersistencia;

type Paso =
  | Readonly<{ tipo: "RESERVADO"; salida: SalidaDeReservarNumero }>
  /** La serie no existe todavía: hay que preguntarle al servicio cuál es su último número. */
  | Readonly<{ tipo: "FALTA_LA_SERIE"; puntoDeVenta: PuntoDeVentaParaEmision }>;

/**
 * Reservar el próximo número de una serie para una solicitud (H7, §B.8). Contexto OPERATIVO con
 * persona. En UNA transacción serializable y corta: el guard (`comprobantes.emitir`), la empresa
 * opera, el punto de venta existe, y entonces el dominio decide (`reservarNumero`):
 *
 *  - serie `LIBRE` → `EN_CURSO` con `ultimoNumero + 1`, auditoría `NUMERO_DE_COMPROBANTE_RESERVADO`
 *    en la misma transacción; solo si el punto de venta y su emisor están activos;
 *  - la misma solicitud ya tenía la reserva → el mismo número, sin escribir (`yaReservada`);
 *  - otra solicitud la tiene → `SERIE_OCUPADA` (se reintenta luego); `BLOQUEADA` → `SERIE_BLOQUEADA`.
 *
 * Dos reservas simultáneas de la misma serie no pueden ganar las dos: SERIALIZABLE (y la versión de
 * la fila) hace que una repita y encuentre a la otra. Los números salen de la serie, nunca del reloj
 * ni del azar: sin huecos ni duplicados.
 *
 * La serie de un (punto de venta, tipo) nace con el último número que informa el servicio de
 * emisión. Esa pregunta es un efecto externo y va FUERA de la transacción (ADR-007): la primera
 * transacción descubre que falta, se pregunta, y una segunda crea la serie (`crear` es idempotente
 * y no pisa una existente) y reserva. Una repetición posterior ya no pregunta.
 *
 * Límite conocido: sin la tabla de comprobantes (la trae la facturación) no queda registro de las
 * solicitudes ya cerradas. Repetir esta reserva DESPUÉS de cerrada reservaría un número nuevo: quien
 * orquesta (la facturación, con la unicidad de su origen) no debe llamarla para una solicitud ya
 * validada.
 */
export function armarReservarNumeroDeComprobante({
  transacciones,
  reglas,
  emision,
  opciones = OPCIONES_DE_NUMERACION,
}: DependenciasDeNumeracion) {
  return async function reservarNumeroDeComprobante(
    contexto: ContextoOperativo,
    entrada: EntradaDeReservarNumero,
  ): Promise<Resultado<SalidaDeReservarNumero, ErrorAlReservarNumero>> {
    const { empresaId } = contexto;

    const intentar = (ultimoDelServicio: bigint | null) =>
      transacciones.ejecutar(
        { contexto },
        async (
          tx,
        ): Promise<Resultado<Paso, ErrorPropioAlReservar | MotivoDeRechazo | EmpresaNoOpera>> => {
          const permiso = await exigirAccion(
            reglas,
            DECLARACIONES.reservarNumeroDeComprobante.accion,
            () => tx.autorizacion.delActor(contexto),
          );
          if (!permiso.ok) return permiso;
          const opera = await empresaOpera(tx, empresaId);
          if (!opera.ok) return opera;
          const datos = await puntoDeVentaParaEmision(tx, empresaId, entrada.puntoDeVentaId);
          if (datos === null) return err("PUNTO_DE_VENTA_NO_ENCONTRADO");
          // Solo un punto de venta activo, con su emisor activo, reserva un número NUEVO.
          const puedeReservarNuevo = (): Resultado<
            null,
            "PUNTO_DE_VENTA_INACTIVO" | "EMISOR_INACTIVO"
          > =>
            datos.pv.estado !== "ACTIVO"
              ? err("PUNTO_DE_VENTA_INACTIVO")
              : datos.emisor.activo
                ? ok(null)
                : err("EMISOR_INACTIVO");

          let serie = await tx.series.obtener(empresaId, entrada.puntoDeVentaId, entrada.tipo);
          if (serie === null) {
            const puede = puedeReservarNuevo();
            if (!puede.ok) return puede;
            if (ultimoDelServicio === null)
              return ok({ tipo: "FALTA_LA_SERIE", puntoDeVenta: datos.paraEmision });
            const nueva = iniciarSerie(
              {
                empresaId,
                puntoDeVentaId: entrada.puntoDeVentaId,
                emisorId: datos.pv.emisorId,
                tipo: entrada.tipo,
              },
              ultimoDelServicio,
            );
            if (!nueva.ok) return nueva;
            const alta = await tx.series.crear(nueva.valor);
            serie = alta.valor;
            if (alta.creado) {
              await tx.auditoria.registrar({
                empresaId,
                actorPersonaId: contexto.personaId,
                accion: "SERIE_DE_COMPROBANTES_CREADA",
                entidad: "serie_comprobante",
                entidadId: entidadDeSerie(entrada.puntoDeVentaId, entrada.tipo),
                despues: datosDeSerie(alta.valor),
              });
            }
          }

          const reserva = reservarNumero(serie, entrada.solicitud, contexto.ahora, opciones);
          if (!reserva.ok) return reserva;
          if (reserva.valor.tipo === "YA_RESERVADA") {
            return ok({
              tipo: "RESERVADO",
              salida: {
                numero: reserva.valor.numero,
                puntoDeVenta: datos.paraEmision,
                yaReservada: true,
              },
            });
          }
          const puede = puedeReservarNuevo();
          if (!puede.ok) return puede;
          const guardada = await tx.series.guardar(reserva.valor.serie);
          // En SERIALIZABLE nadie pudo cambiar la fila después de leerla (esa carrera termina en un
          // conflicto de serialización y la transacción se repite): que no se guarde es un defecto.
          if (guardada === null) throw new Error("la serie cambió dentro de la transacción");
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: contexto.personaId,
            accion: "NUMERO_DE_COMPROBANTE_RESERVADO",
            entidad: "serie_comprobante",
            entidadId: entidadDeSerie(entrada.puntoDeVentaId, entrada.tipo),
            antes: datosDeSerie(serie),
            despues: datosDeSerie(guardada),
          });
          return ok({
            tipo: "RESERVADO",
            salida: {
              numero: reserva.valor.numero,
              puntoDeVenta: datos.paraEmision,
              yaReservada: false,
            },
          });
        },
      );

    const primero = await intentar(null);
    if (!primero.ok) return primero;
    if (primero.valor.tipo === "RESERVADO") return ok(primero.valor.salida);

    // La serie no existe: se pregunta al servicio FUERA de la transacción (ADR-007).
    const ultimo = await emision.ultimoAutorizado(primero.valor.puntoDeVenta, entrada.tipo);
    if (!ultimo.ok) return ultimo;

    const segundo = await intentar(ultimo.valor);
    if (!segundo.ok) return segundo;
    if (segundo.valor.tipo !== "RESERVADO") {
      throw new Error("la serie sigue sin existir después de crearla");
    }
    return ok(segundo.valor.salida);
  };
}
