import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { TipoDeComprobante } from "../dominio/comprobante-emitido";
import type { Ambiente } from "../dominio/comprobante-nuevo";
import { habilitadoEnArca } from "../dominio/habilitacion-en-arca";
import type { EmisorId, PuntoDeVentaId } from "../dominio/identificadores";
import {
  exigirSucursalAbierta,
  type ErrorDeSucursalCerrada,
} from "../dominio/sucursales-de-la-emision";
import type { PuntoDeVentaGuardado } from "../persistencia/repositorios";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import { empresaOpera, puntoDeVentaParaEmision } from "./comun";
import {
  encolarValidacion,
  opcionesDe,
  type DependenciasDeFacturacion,
  type TxDeFacturacion,
} from "./contrato-de-facturacion";
import { DECLARACIONES_DE_FACTURACION } from "./declaraciones-de-facturacion";
import type { ErrorDeEmision, PuntoDeVentaParaEmision } from "./emision-electronica";
import { puntosDeVentaConLimite, ultimoAutorizadoConLimite } from "./llamadas-a-arca";
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
// Cambiar el ambiente de un punto de venta (§B.2.4, QF2, D-48 y D-77)
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
  | "PUNTO_DE_VENTA_YA_EMITIO_EN_PRODUCCION"
  /** D-77: ARCA no tiene ese número, o lo tiene bloqueado o dado de baja. Sin texto aprobado todavía (`errores-fiscales.ts`). */
  | "PUNTO_DE_VENTA_NO_HABILITADO_EN_ARCA"
  | ErrorDeSucursalCerrada;

export type ErrorAlCambiarAmbiente =
  | ErrorPropioAlCambiarAmbiente
  | ErrorDeEmision
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDePersistencia;

type ErrorDeLaRevision = ErrorPropioAlCambiarAmbiente | MotivoDeRechazo | EmpresaNoOpera;

/** Lo que se consulta a ARCA y se protege al escribir: el punto de venta tal como estaba y lo que identifica a su número. */
type PasajeAProduccion = Readonly<{
  pv: PuntoDeVentaGuardado;
  puntoDeVenta: PuntoDeVentaParaEmision;
}>;

/**
 * Todo lo que se mira antes de pasar un punto de venta a producción, en este orden (el de siempre): el guard, que la empresa opere, que
 * el punto de venta exista, «ya estaba» (`null`, sin mirar nada más), que no se vuelva de producción (QF2), la versión, que no haya una
 * serie `EN_CURSO` y el certificado de producción vigente del emisor. Se corre DOS veces (antes y después de preguntarle a ARCA), siempre
 * con el guard primero: lo que valía antes de la llamada puede haber cambiado durante ella.
 * Si no es «ya estaba» y no se vuelve de producción, el destino es PRODUCCIÓN: homologación a homologación es «ya estaba».
 */
async function revisarElPasaje(
  tx: TxDeFacturacion,
  contexto: ContextoOperativo,
  reglas: DependenciasDeFacturacion["reglas"],
  entrada: EntradaDeCambiarAmbiente,
): Promise<Resultado<PasajeAProduccion | null, ErrorDeLaRevision>> {
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
  if (pv.ambiente === entrada.ambiente) return ok(null);
  // QF2 (DECIDIDO, dueño 2026-10-13): de producción no se vuelve a homologación, haya emitido o no. La base
  // además lo impide si ya emitió (`punto_de_venta_ambiente_no_vuelve`).
  if (pv.ambiente === "PRODUCCION") return err("AMBIENTE_NO_VUELVE");
  if (pv.version !== entrada.versionEsperada) return err("VERSION_DESACTUALIZADA");
  const series = await tx.series.delPuntoDeVenta(empresaId, pv.id, pv.ambiente);
  if (series.some((s) => s.estado === "EN_CURSO")) return err("SERIE_EN_CURSO");
  const certificado = await tx.certificados.vigente(empresaId, pv.emisorId, "PRODUCCION");
  if (
    certificado === null ||
    certificado.venceEn === null ||
    certificado.venceEn.getTime() <= ahora.getTime()
  ) {
    return err("SIN_CERTIFICADO_VIGENTE");
  }
  const emisor = await tx.emisores.obtener(empresaId, pv.emisorId);
  // La clave foránea compuesta garantiza que el emisor existe y es de la empresa.
  if (emisor === null) throw new Error(`el emisor ${pv.emisorId} del punto de venta no existe`);
  return ok({ pv, puntoDeVenta: { cuit: emisor.cuit, numero: pv.numero } });
}

/**
 * Cambiar el ambiente de un punto de venta (homologación ↔ producción). Pasar a PRODUCCIÓN exige tres cosas: un certificado de
 * producción vigente del emisor (sin él no se podría emitir: el error queda a la vista ahora y no después), que no haya una serie
 * `EN_CURSO` (un comprobante en vuelo terminaría en otra serie) y, desde D-77 (dueño, 2026-10-29), que ARCA lo tenga: se le pregunta
 * (`FEParamGetPtosVenta`, con el certificado de producción del emisor) y solo pasa si el número existe y no está bloqueado ni dado de
 * baja; si no, `PUNTO_DE_VENTA_NO_HABILITADO_EN_ARCA`, sin cambiar nada. Si ARCA no contesta, o no se entiende lo que contestó, no pasa
 * (fail closed): el error ya existente del servicio de emisión (`SERVICIO_NO_DISPONIBLE`, `SIN_CREDENCIAL`...). De producción no se
 * vuelve (QF2, `AMBIENTE_NO_VUELVE`; con números usados también lo rechaza la base).
 *
 * Tres pasos, porque preguntarle a ARCA es un efecto externo (ADR-007) y no se hace con una transacción abierta (el reintento
 * serializable la repetiría, y la llamada puede tardar hasta su tiempo límite con la fila del punto de venta y la serie a la vista de
 * todos): (1) una transacción de LECTURA con `revisarElPasaje`; ya estaba o un rechazo terminan acá, sin llamar a ARCA; (2) afuera,
 * la consulta con tiempo límite; (3) una transacción SERIALIZABLE que repite `revisarElPasaje` (el punto de venta puede haberse editado,
 * desactivado o pasado a producción por otro pedido mientras tanto: la versión lo detecta), exige que el número y la CUIT sean los que
 * se verificaron, lee la sucursal con `FOR SHARE` y exige que esté abierta, cambia el ambiente y audita
 * `PUNTO_DE_VENTA_AMBIENTE_CAMBIADO` en la misma transacción.
 *
 * Repetirlo con el ambiente ya aplicado es «ya estaba»: éxito sin llamar a ARCA ni escribir (el doble clic). Dos pasajes simultáneos del
 * mismo punto de venta: los dos preguntan a ARCA, la serializable deja pasar a uno y el otro, al reintentar, lee el ambiente nuevo y
 * da «ya estaba»: un solo cambio y una sola auditoría.
 *
 * Sucursal cerrada (SUPUESTO del ingeniero: D-79 y D-80 hablan de mudar y de activar, no de cambiar el ambiente; se aplica el mismo
 * criterio, nace cerrado): un punto de venta de una sucursal cerrada no pasa a producción, `SUCURSAL_CERRADA`. «Ya estaba» va ANTES y no
 * la mira (la repetición da lo mismo aunque se haya cerrado después). Revertirlo es sacar ese bloque.
 * Previene: pasar a producción un número que ARCA no tiene (cada factura real fallaría con la 10005), o hacerlo con la sucursal cerrada
 * a la vez, o con una consulta hecha sobre otro número o CUIT que el que finalmente cambia.
 * Chequeo: `cambiar-ambiente.test.ts` (cada rechazo, el orden de la llamada y la repetición) y la carrera en
 * `test/integracion/facturacion-ambiente-arca.test.ts`.
 */
export function armarCambiarAmbienteDePuntoDeVenta(dependencias: DependenciasDeFacturacion) {
  const { transacciones, reglas, emision } = dependencias;
  const opciones = opcionesDe(dependencias);

  return async function cambiarAmbienteDePuntoDeVenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarAmbiente,
  ): Promise<Resultado<SalidaDeCambiarAmbiente, ErrorAlCambiarAmbiente>> {
    const { empresaId } = contexto;
    const previa = await transacciones.ejecutar({ contexto, soloLectura: true }, (tx) =>
      revisarElPasaje(tx, contexto, reglas, entrada),
    );
    if (!previa.ok) return previa;
    if (previa.valor === null) return ok({ yaEstaba: true });
    const { pv, puntoDeVenta } = previa.valor;

    const informados = await puntosDeVentaConLimite(
      emision.para(empresaId, pv.emisorId, "PRODUCCION"),
      puntoDeVenta.cuit,
      opciones.tiempos,
    );
    if (!informados.ok) return informados;
    if (!habilitadoEnArca(informados.valor, puntoDeVenta.numero)) {
      return err("PUNTO_DE_VENTA_NO_HABILITADO_EN_ARCA");
    }

    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeCambiarAmbiente, ErrorDeLaRevision | ErrorDeSucursalCerrada>
      > => {
        const revisado = await revisarElPasaje(tx, contexto, reglas, entrada);
        if (!revisado.ok) return revisado;
        if (revisado.valor === null) return ok({ yaEstaba: true });
        const actual = revisado.valor;
        // Lo que se verificó con ARCA tiene que ser lo que se cambia. La versión ya cubre el número; la CUIT del emisor se corrige aparte.
        if (
          actual.puntoDeVenta.cuit !== puntoDeVenta.cuit ||
          actual.puntoDeVenta.numero !== puntoDeVenta.numero
        ) {
          return err("VERSION_DESACTUALIZADA");
        }
        // La sucursal del punto de venta, ANTES de escribir, con `FOR SHARE` (como activar y mudar). La clave foránea compuesta garantiza
        // que existe y es de la empresa.
        const sucursal = await tx.sucursalBloqueada.obtenerBloqueandoElCierre(
          empresaId,
          actual.pv.sucursalId,
        );
        if (sucursal === null) {
          throw new Error(`la sucursal ${actual.pv.sucursalId} del punto de venta no existe`);
        }
        const abierta = exigirSucursalAbierta(sucursal);
        if (!abierta.ok) return abierta;
        const cambiado = await tx.puntosDeVenta.cambiarAmbiente(
          empresaId,
          actual.pv.id,
          entrada.ambiente,
          actual.pv.version,
        );
        if (cambiado === null) throw new Error("el punto de venta cambió dentro de la transacción");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "PUNTO_DE_VENTA_AMBIENTE_CAMBIADO",
          entidad: "punto_de_venta",
          entidadId: actual.pv.id,
          antes: { ambiente: actual.pv.ambiente },
          despues: { ambiente: cambiado.ambiente, verificadoEnArca: true },
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
