import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { ImporteJson } from "../../../primitivas/dinero/importe";
import { sucursalId, type SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeCotizacion } from "../../catalogo/publico";
import {
  aJson,
  calcularLasLineas,
  cuentaId,
  esUuid,
  numeroDeCorreccion,
} from "../casos-de-uso/calculo";
import { cotizarVentaRapida } from "../casos-de-uso/cotizar-venta-rapida";
import { cargarEstadosDeLaEmpresa } from "../../empresas/publico";
import type {
  CursorDePendientes,
  RenglonParaFacturar,
} from "../persistencia/repositorio-de-lecturas";
import type { DependenciasDeConsultasDeVentas, TxDeConsultasDeVentas } from "./contrato";
import type { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type ErrorDeConsultaDeVentas =
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDeAlcance
  | ErrorDePersistencia
  | ErrorDeCotizacion
  | "IDENTIFICADOR_INVALIDO"
  | "FECHA_INVALIDA"
  | "CANTIDAD_INVALIDA"
  | "PRODUCTO_SIN_PRECIO"
  | "PRECIO_ABIERTO_NO_PERMITIDO"
  | "IMPORTE_INVALIDO"
  | "CUENTA_NO_ENCONTRADA"
  | "TICKET_NO_ENCONTRADO"
  | "TICKET_NO_FACTURABLE"
  | "LIMITE_INVALIDO";

type R<S> = Resultado<S, ErrorDeConsultaDeVentas>;

export const MAXIMO_DE_PENDIENTES_POR_PEDIDO = 100;
const PENDIENTES_POR_DEFECTO = 50;
const ACCION: ClaveAccion = "ventas.ver";
const ARS = "ARS";

export type EntradaDeJornadaDeVentas = Readonly<{ sucursalId: string; fechaNegocio: string }>;
export type EntradaDePendientes = Readonly<{
  sucursalId?: string | undefined;
  fechaDesde?: string | undefined;
  fechaHasta?: string | undefined;
  motivo?: "SIN_COMPROBANTE" | "COMPROBANTE_ANULADO" | undefined;
  despuesDe?: CursorDePendientes | undefined;
  limite?: number | undefined;
}>;
export type EntradaDeCotizarVentaRapida = Readonly<{
  sucursalId: string;
  lineas: readonly Readonly<{
    productoId: string;
    varianteId?: string | undefined;
    opcionIds: readonly string[];
    cantidad: string;
    /** Solo para un producto en precio abierto (decisión 179). */
    precioAbierto?: string | undefined;
  }>[];
}>;

type Previo = Readonly<{ alcance: "TODAS" | readonly SucursalId[] }>;

/** El guard (`ventas.ver`), que la empresa opere y el alcance de sucursales de quien pide: lo primero de toda consulta. */
async function previo(
  tx: TxDeConsultasDeVentas,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeConsultasDeVentas,
): Promise<Resultado<Previo, MotivoDeRechazo | EmpresaNoOpera>> {
  const permiso = await exigirAccion(dependencias.reglas, ACCION, () =>
    tx.autorizacion.delActor(contexto),
  );
  if (!permiso.ok) return permiso;
  const opera = comprobarQueOpera(
    contexto.empresaId,
    await cargarEstadosDeLaEmpresa(tx, contexto.empresaId),
  );
  if (!opera.ok) return opera;
  return ok({ alcance: await tx.autorizacion.sucursalesDelActor(contexto) });
}

function jornadaDe(entrada: EntradaDeJornadaDeVentas, p: Previo) {
  if (!esUuid(entrada.sucursalId)) return err("IDENTIFICADOR_INVALIDO" as const);
  const fecha = fechaCivilDesdeTexto(entrada.fechaNegocio);
  if (!fecha.ok) return err("FECHA_INVALIDA" as const);
  const sucursal = sucursalId(entrada.sucursalId);
  const alcance = exigirSucursal(p.alcance, sucursal);
  if (!alcance.ok) return alcance;
  return ok({ sucursal, fecha: fecha.valor });
}

function importe(monto: string): ImporteJson {
  return { moneda: ARS, monto };
}

export function crearConsultasDeVentas(dependencias: DependenciasDeConsultasDeVentas) {
  const leer = <T>(
    contexto: ContextoOperativo,
    trabajo: (tx: TxDeConsultasDeVentas, p: Previo) => Promise<R<T>>,
  ) =>
    dependencias.transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx) => {
        const p = await previo(tx, contexto, dependencias);
        return p.ok ? trabajo(tx, p.valor) : p;
      },
    );

  /** Las consultas de una jornada de una sucursal comparten forma: validan, leen y devuelven filas. */
  const deLaJornada =
    <T>(
      leerFilas: (
        tx: TxDeConsultasDeVentas,
        contexto: ContextoOperativo,
        sucursal: SucursalId,
        fecha: FechaCivil,
      ) => Promise<T>,
    ) =>
    (contexto: ContextoOperativo, entrada: EntradaDeJornadaDeVentas): Promise<R<T>> =>
      leer(contexto, async (tx, p) => {
        const j = jornadaDe(entrada, p);
        if (!j.ok) return j;
        return ok(await leerFilas(tx, contexto, j.valor.sucursal, j.valor.fecha));
      });

  return {
    cotizarVentaRapida: (contexto: ContextoOperativo, entrada: EntradaDeCotizarVentaRapida) =>
      leer(contexto, async (tx, p) => {
        if (!esUuid(entrada.sucursalId)) return err("IDENTIFICADOR_INVALIDO");
        const alcance = exigirSucursal(p.alcance, sucursalId(entrada.sucursalId));
        if (!alcance.ok) return alcance;
        return cotizarVentaRapida(tx, contexto, entrada);
      }),

    fichaDeCuenta: (contexto: ContextoOperativo, entrada: Readonly<{ cuentaId: string }>) =>
      leer(contexto, async (tx, p) => {
        if (!esUuid(entrada.cuentaId)) return err("IDENTIFICADOR_INVALIDO");
        const cuenta = await tx.cuentas.obtener(contexto.empresaId, cuentaId(entrada.cuentaId));
        if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
        const alcance = exigirSucursal(p.alcance, cuenta.sucursalId);
        if (!alcance.ok) return alcance;
        const lineas = await tx.cuentas.lineasDeCuenta(contexto.empresaId, cuenta.id);
        return ok({
          cuentaId: cuenta.id,
          sucursalId: cuenta.sucursalId,
          estado: cuenta.estado,
          etiqueta: cuenta.etiqueta,
          ancla: cuenta.ancla,
          totalProvisorio: aJson(calcularLasLineas(lineas)),
          version: cuenta.version,
          lineas,
        });
      }),

    fichaDeTicket: (contexto: ContextoOperativo, entrada: Readonly<{ ticketId: string }>) =>
      leer(contexto, async (tx, p) => {
        const ficha = await tx.lecturasDeVentas.fichaDeTicket(contexto.empresaId, entrada.ticketId);
        if (ficha === null) return err("TICKET_NO_ENCONTRADO");
        const alcance = exigirSucursal(p.alcance, ficha.ticket.sucursalId);
        if (!alcance.ok) return alcance;
        const t = ficha.ticket;
        return ok({
          ticketId: t.id,
          numero: t.numero,
          numeroDeCorreccion: numeroDeCorreccion(t.ejemplarVigente),
          estado: t.estado,
          fechaNegocio: t.fechaNegocio,
          total: importe(t.total),
          ejemplares: ficha.ejemplares.map((e) => ({
            ejemplarId: e.id,
            tipo: e.tipo,
            numeroDeCorreccion: e.numeroDeEjemplar - 1,
            total: importe(e.total),
            quien: e.creadoPor,
            cuando: e.creadoEn,
            vigente: e.numeroDeEjemplar === t.ejemplarVigente,
          })),
          renglones: ficha.renglonesDelVigente,
          cobranza: ficha.cobranza,
          // Hasta que exista la emisión (E1) todo ticket cobrado está pendiente de facturar (§3.12).
          pendienteDeFacturar: t.estado === "COBRADO",
        });
      }),

    listarTickets: deLaJornada(async (tx, contexto, sucursal, fecha) =>
      (await tx.lecturasDeVentas.ticketsDeLaJornada(contexto.empresaId, sucursal, fecha)).map(
        (t) => ({
          ticketId: t.ticketId,
          numero: t.numero,
          numeroDeCorreccion: numeroDeCorreccion(t.ejemplarVigente),
          estado: t.estado,
          total: importe(t.totalVigente),
        }),
      ),
    ),

    ticketsDeLaJornada: deLaJornada(async (tx, contexto, sucursal, fecha) =>
      (await tx.lecturasDeVentas.ticketsDeLaJornada(contexto.empresaId, sucursal, fecha)).map(
        (t) => ({
          ...t,
          numeroDeCorreccion: numeroDeCorreccion(t.ejemplarVigente),
        }),
      ),
    ),

    anulacionesDeLaJornada: deLaJornada((tx, contexto, sucursal, fecha) =>
      tx.lecturasDeVentas.anulacionesDeLaJornada(contexto.empresaId, sucursal, fecha),
    ),

    correccionesDeLaJornada: deLaJornada(async (tx, contexto, sucursal, fecha) =>
      (await tx.lecturasDeVentas.correccionesDeLaJornada(contexto.empresaId, sucursal, fecha)).map(
        (c) => ({
          ...c,
          numeroDeCorreccion: numeroDeCorreccion(c.ejemplarVigente),
        }),
      ),
    ),

    cortesiasDeLaJornada: deLaJornada(async (tx, contexto, sucursal, fecha) =>
      (await tx.lecturasDeVentas.cortesiasDeLaJornada(contexto.empresaId, sucursal, fecha)).map(
        (c) => ({
          ...c,
          numeroDeCorreccion: numeroDeCorreccion(c.ejemplarVigente),
        }),
      ),
    ),

    resumenDeVentasDeLaJornada: deLaJornada((tx, contexto, sucursal, fecha) =>
      tx.lecturasDeVentas.resumenDeLaJornada(contexto.empresaId, sucursal, fecha),
    ),

    ticketsPorCobranza: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ cobranzaIds: readonly string[] }>,
    ) =>
      leer(contexto, async (tx, p) => {
        const filas = await tx.lecturasDeVentas.ticketsPorCobranza(
          contexto.empresaId,
          entrada.cobranzaIds,
        );
        // Lo que está fuera del alcance de quien pide no se devuelve (no se distingue de lo inexistente).
        const permitidas = [];
        for (const f of filas) {
          const t = await tx.lecturasDeVentas.fichaDeTicket(contexto.empresaId, f.ticketId);
          if (t !== null && exigirSucursal(p.alcance, t.ticket.sucursalId).ok) {
            permitidas.push({ ...f, numeroDeCorreccion: numeroDeCorreccion(f.ejemplarVigente) });
          }
        }
        return ok(permitidas);
      }),

    ticketsPendientesDeFacturar: (contexto: ContextoOperativo, entrada: EntradaDePendientes) =>
      leer(contexto, async (tx, p) => {
        const limite = entrada.limite ?? PENDIENTES_POR_DEFECTO;
        if (!Number.isInteger(limite) || limite < 1 || limite > MAXIMO_DE_PENDIENTES_POR_PEDIDO) {
          return err("LIMITE_INVALIDO");
        }
        let sucursales: readonly SucursalId[] | null;
        if (entrada.sucursalId !== undefined) {
          if (!esUuid(entrada.sucursalId)) return err("IDENTIFICADOR_INVALIDO");
          const una = sucursalId(entrada.sucursalId);
          const alcance = exigirSucursal(p.alcance, una);
          if (!alcance.ok) return alcance;
          sucursales = [una];
        } else {
          // Sin sucursal, TODAS las del alcance de quien pide (nunca «todas» si el alcance es una lista).
          sucursales = p.alcance === "TODAS" ? null : p.alcance;
        }
        const desde =
          entrada.fechaDesde === undefined ? null : fechaCivilDesdeTexto(entrada.fechaDesde);
        const hasta =
          entrada.fechaHasta === undefined ? null : fechaCivilDesdeTexto(entrada.fechaHasta);
        if ((desde !== null && !desde.ok) || (hasta !== null && !hasta.ok))
          return err("FECHA_INVALIDA");
        if (
          entrada.despuesDe !== undefined &&
          (!esUuid(entrada.despuesDe.sucursalId) ||
            !fechaCivilDesdeTexto(entrada.despuesDe.fechaNegocio).ok)
        ) {
          return err("IDENTIFICADOR_INVALIDO");
        }
        // Sin emisión (E1) no existen comprobantes anulados: ese motivo no tiene nada que listar.
        if (entrada.motivo === "COMPROBANTE_ANULADO") return ok({ tickets: [], siguiente: null });
        const filas = await tx.lecturasDeVentas.pendientesDeFacturar(contexto.empresaId, {
          sucursales,
          fechaDesde: desde === null || !desde.ok ? null : desde.valor,
          fechaHasta: hasta === null || !hasta.ok ? null : hasta.valor,
          despuesDe: entrada.despuesDe ?? null,
          limite: limite + 1,
        });
        const pagina = filas.slice(0, limite);
        const ultimo = pagina[pagina.length - 1];
        return ok({
          tickets: pagina.map((f) => ({
            ticketId: f.ticketId,
            numero: f.numero,
            numeroDeCorreccion: numeroDeCorreccion(f.ejemplarVigente),
            sucursalId: f.sucursalId,
            fechaNegocio: f.fechaNegocio,
            total: importe(f.total),
            cobradoEn: f.cobradoEn,
            motivo: "SIN_COMPROBANTE" as const,
          })),
          siguiente:
            filas.length > limite && ultimo !== undefined
              ? {
                  fechaNegocio: ultimo.fechaNegocio,
                  numero: ultimo.numero,
                  sucursalId: ultimo.sucursalId,
                }
              : null,
        });
      }),

    ticketParaFacturar: (contexto: ContextoOperativo, entrada: Readonly<{ ticketId: string }>) =>
      leer(contexto, async (tx, p) => {
        const t = await tx.lecturasDeVentas.ticketParaFacturar(
          contexto.empresaId,
          entrada.ticketId,
        );
        if (t === null) return err("TICKET_NO_ENCONTRADO");
        const alcance = exigirSucursal(p.alcance, t.ticket.sucursalId);
        if (!alcance.ok) return alcance;
        // Falla cerrado: solo un ticket cobrado se factura; uno emitido sin cobrar, de cortesía o anulado no.
        if (t.ticket.estado !== "COBRADO") return err("TICKET_NO_FACTURABLE");
        return ok({
          ticketId: t.ticket.id,
          numero: t.ticket.numero,
          numeroDeCorreccion: numeroDeCorreccion(t.ticket.ejemplarVigente),
          sucursalId: t.ticket.sucursalId,
          ejemplarVigenteId: t.ejemplarVigenteId,
          total: importe(t.total),
          totalVigente: importe(t.total),
          lineas: t.renglones satisfies readonly RenglonParaFacturar[],
        });
      }),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS, unknown>;
}

export type ConsultasDeVentas = ReturnType<typeof crearConsultasDeVentas>;
