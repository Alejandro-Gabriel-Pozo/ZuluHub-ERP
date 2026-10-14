import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { TipoDeComprobante } from "../dominio/comprobante-emitido";
import type { Ambiente } from "../dominio/comprobante-nuevo";
import type { EmisorId, PuntoDeVentaId } from "../dominio/identificadores";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import { empresaOpera, puntoDeVentaParaEmision } from "./comun";
import {
  encolarValidacion,
  opcionesDe,
  type DependenciasDeFacturacion,
} from "./contrato-de-facturacion";
import { DECLARACIONES_DE_FACTURACION } from "./declaraciones-de-facturacion";
import type { ErrorDeEmision, PuntoDeVentaParaEmision } from "./emision-electronica";
import { ultimoAutorizadoConLimite } from "./llamadas-a-arca";
import { resincronizarEnTx, type ErrorPropioAlResincronizar } from "./numeracion-en-tx";

// =================================================================================================
// Resincronizar una serie bloqueada (§B.4.6, QF1)
// =================================================================================================

export type EntradaDeResincronizarSerie = Readonly<{
  puntoDeVentaId: PuntoDeVentaId;
  tipo: TipoDeComprobante;
  ambiente: Ambiente;
  /** El último número que la persona vio en la pantalla (lo que informaba ARCA) y confirmó. */
  ultimoVistoEnArca: bigint;
  motivo: string;
}>;

export type SalidaDeResincronizarSerie = Readonly<{
  ultimoNumero: bigint;
  /** Cuántos comprobantes `PENDIENTE` de la serie se volvieron a encolar. */
  reencolados: number;
}>;

export type ErrorAlResincronizarSerie =
  | ErrorPropioAlResincronizar
  | "MOTIVO_INVALIDO"
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDeEmision
  | ErrorDePersistencia;

/** Cuántos pendientes de la serie reencola una resincronización (el resto lo levanta la reconciliación). */
const PENDIENTES_POR_RESINCRONIZACION = 200;

/**
 * Sacar una serie de `BLOQUEADA` (spec H7 facturación §B.4.6). Dos fases, porque preguntarle a ARCA es un efecto
 * externo (ADR-007): una transacción de lectura con el guard (la serie tiene que estar `BLOQUEADA`), afuera el
 * último autorizado de ARCA con tiempo límite, y una transacción con el guard otra vez que aplica
 * `resincronizarEnTx` (si ARCA cambió mientras la persona miraba → `ULTIMO_DISTINTO_DEL_DE_ARCA`; hacia atrás →
 * `DESFASE_HACIA_ATRAS`, a soporte), audita `SERIE_RESINCRONIZADA` y reencola los `PENDIENTE` de esa serie.
 * Repetirla encuentra la serie `LIBRE`: `SERIE_NO_BLOQUEADA`, sin escribir.
 */
export function armarResincronizarSerie(dependencias: DependenciasDeFacturacion) {
  const { transacciones, reglas, emision } = dependencias;
  const opciones = opcionesDe(dependencias);
  const accion = DECLARACIONES_DE_FACTURACION.resincronizarSerie.accion;

  return async function resincronizarSerie(
    contexto: ContextoOperativo,
    entrada: EntradaDeResincronizarSerie,
  ): Promise<Resultado<SalidaDeResincronizarSerie, ErrorAlResincronizarSerie>> {
    const { empresaId } = contexto;
    const motivo = entrada.motivo.trim();

    const lectura = await transacciones.ejecutar(
      { contexto, soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<
          Readonly<{ puntoDeVenta: PuntoDeVentaParaEmision; emisorId: EmisorId }>,
          ErrorPropioAlResincronizar | "MOTIVO_INVALIDO" | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(reglas, accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        if (motivo === "" || motivo.length > 200) return err("MOTIVO_INVALIDO");
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;
        const serie = await tx.series.obtener(
          empresaId,
          entrada.puntoDeVentaId,
          entrada.tipo,
          entrada.ambiente,
        );
        if (serie === null) return err("SERIE_NO_ENCONTRADA");
        if (serie.estado !== "BLOQUEADA") return err("SERIE_NO_BLOQUEADA");
        const datos = await puntoDeVentaParaEmision(tx, empresaId, entrada.puntoDeVentaId);
        if (datos === null) throw new Error("la serie existe pero su punto de venta no es visible");
        return ok({ puntoDeVenta: datos.paraEmision, emisorId: serie.emisorId });
      },
    );
    if (!lectura.ok) return lectura;

    const ultimo = await ultimoAutorizadoConLimite(
      emision.para(empresaId, lectura.valor.emisorId, entrada.ambiente),
      lectura.valor.puntoDeVenta,
      entrada.tipo,
      opciones.tiempos,
    );
    if (!ultimo.ok) return ultimo;

    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeResincronizarSerie,
          ErrorPropioAlResincronizar | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(reglas, accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const libre = await resincronizarEnTx(tx, contexto, {
          puntoDeVentaId: entrada.puntoDeVentaId,
          tipo: entrada.tipo,
          ambiente: entrada.ambiente,
          ultimoVistoEnArca: entrada.ultimoVistoEnArca,
          ultimoDeArca: ultimo.valor,
          motivo,
        });
        if (!libre.ok) return libre;
        const pendientes = await tx.comprobantes.pendientes(
          empresaId,
          {
            serie: {
              puntoDeVentaId: entrada.puntoDeVentaId,
              tipo: entrada.tipo,
              ambiente: entrada.ambiente,
            },
          },
          PENDIENTES_POR_RESINCRONIZACION,
        );
        let reencolados = 0;
        for (const id of pendientes) {
          if (await encolarValidacion(tx, empresaId, id)) reencolados += 1;
        }
        return ok({ ultimoNumero: libre.valor.ultimoNumero, reencolados });
      },
    );
  };
}

// =================================================================================================
// Cambiar el ambiente de un punto de venta (§B.2.4, QF2)
// =================================================================================================

export type EntradaDeCambiarAmbiente = Readonly<{
  puntoDeVentaId: PuntoDeVentaId;
  ambiente: Ambiente;
  versionEsperada: number;
}>;

export type SalidaDeCambiarAmbiente = Readonly<{ yaEstaba: boolean }>;

export type ErrorPropioAlCambiarAmbiente =
  | "PUNTO_DE_VENTA_NO_ENCONTRADO"
  | "VERSION_DESACTUALIZADA"
  | "SERIE_EN_CURSO"
  | "SIN_CERTIFICADO_VIGENTE"
  | "AMBIENTE_NO_VUELVE"
  | "PUNTO_DE_VENTA_YA_EMITIO_EN_PRODUCCION";

export type ErrorAlCambiarAmbiente =
  ErrorPropioAlCambiarAmbiente | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/**
 * Cambiar el ambiente de un punto de venta (homologación ↔ producción). Una transacción SERIALIZABLE con el
 * guard primero: ya en ese ambiente → «ya estaba» (sin escribir); una serie del punto de venta `EN_CURSO` en el
 * ambiente actual → `SERIE_EN_CURSO` (un comprobante en vuelo terminaría en otra serie); pasar a PRODUCCIÓN exige
 * un certificado de producción vigente del emisor (sin él no se podría emitir: el error queda a la vista ahora y
 * no después); de producción no se vuelve (QF2, `AMBIENTE_NO_VUELVE`; con números usados también lo rechaza la base). Audita
 * `PUNTO_DE_VENTA_AMBIENTE_CAMBIADO` en la misma transacción.
 */
export function armarCambiarAmbienteDePuntoDeVenta({
  transacciones,
  reglas,
}: DependenciasDeFacturacion) {
  return async function cambiarAmbienteDePuntoDeVenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarAmbiente,
  ): Promise<Resultado<SalidaDeCambiarAmbiente, ErrorAlCambiarAmbiente>> {
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCambiarAmbiente,
          ErrorPropioAlCambiarAmbiente | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_FACTURACION.cambiarAmbienteDePuntoDeVenta.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const { empresaId, ahora } = contexto;
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;
        const pv = await tx.puntosDeVenta.obtener(empresaId, entrada.puntoDeVentaId);
        if (pv === null) return err("PUNTO_DE_VENTA_NO_ENCONTRADO");
        if (pv.ambiente === entrada.ambiente) return ok({ yaEstaba: true });
        // QF2 (DECIDIDO, dueño 2026-10-13): de producción no se vuelve a homologación, haya emitido o no. La base
        // además lo impide si ya emitió (`punto_de_venta_ambiente_no_vuelve`).
        if (pv.ambiente === "PRODUCCION") return err("AMBIENTE_NO_VUELVE");
        if (pv.version !== entrada.versionEsperada) return err("VERSION_DESACTUALIZADA");
        const series = await tx.series.delPuntoDeVenta(empresaId, pv.id, pv.ambiente);
        if (series.some((s) => s.estado === "EN_CURSO")) return err("SERIE_EN_CURSO");
        if (entrada.ambiente === "PRODUCCION") {
          const certificado = await tx.certificados.vigente(empresaId, pv.emisorId, "PRODUCCION");
          if (
            certificado === null ||
            certificado.venceEn === null ||
            certificado.venceEn.getTime() <= ahora.getTime()
          ) {
            return err("SIN_CERTIFICADO_VIGENTE");
          }
        }
        const cambiado = await tx.puntosDeVenta.cambiarAmbiente(
          empresaId,
          pv.id,
          entrada.ambiente,
          pv.version,
        );
        if (cambiado === null) throw new Error("el punto de venta cambió dentro de la transacción");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "PUNTO_DE_VENTA_AMBIENTE_CAMBIADO",
          entidad: "punto_de_venta",
          entidadId: pv.id,
          antes: { ambiente: pv.ambiente },
          despues: { ambiente: cambiado.ambiente },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducirErroresDeFiscal(resultado, [
      "SERIE_EN_CURSO",
      "PUNTO_DE_VENTA_YA_EMITIO_EN_PRODUCCION",
    ] as const);
  };
}
