import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EstadoDeEmpresa } from "../../../contexto/estados";
import type { EmpresaId, SucursalId, TenantId } from "../../../primitivas/identificadores/marca";
import type { Transacciones } from "../../../puertos/transacciones";
import type { TrabajosReencolables } from "../../../puertos/trabajos";
import type { Ambiente } from "../dominio/comprobante-nuevo";
import type { ComprobanteId, EmisorId } from "../dominio/identificadores";
import { OPCIONES_DE_NUMERACION, type OpcionesDeNumeracion } from "../dominio/numeracion";
import type { LecturasDeComprobantes } from "../persistencia/lecturas-de-comprobantes";
import type { RepositorioDeCertificados } from "../persistencia/repositorio-de-certificados";
import type { RepositorioDeComprobantes } from "../persistencia/repositorio-de-comprobantes";
import type { RepositorioDeIntentos } from "../persistencia/repositorio-de-intentos";
import type {
  RepositorioDeDatosFiscales,
  RepositorioDeDomicilios,
  RepositorioDePuntosDeVenta,
  RepositorioDeSeries,
} from "../persistencia/repositorios";
import type { TxDeNumeracion } from "./contrato";
import type { EmisionElectronica } from "./emision-electronica";

/**
 * Contrato de los casos de uso de facturación (spec H7 facturación §B.4, tramo F5). Lo que recibe el trabajo de
 * una transacción es lo de la numeración (los cuerpos `reservarEnTx`, `cerrarEnTx` y `resincronizarEnTx` corren
 * con esta misma transacción) más los comprobantes, sus intentos, el certificado vigente, los datos fiscales y los
 * domicilios del emisor, y los trabajos (con la lectura de lo encolado, para reencolar la validación).
 */
export type TxDeFacturacion = Omit<TxDeNumeracion, "empresas" | "puntosDeVenta" | "series"> &
  Readonly<{
    /** La empresa con su zona horaria: la fecha del comprobante es el día civil en esa zona (§B.3.6). */
    empresas: Readonly<{
      obtener(id: EmpresaId): Promise<Readonly<{
        tenantId: TenantId;
        estado: EstadoDeEmpresa;
        zonaHoraria: string;
      }> | null>;
    }>;
    tenants: TxDeNumeracion["tenants"];
    /**
     * La sucursal de un comprobante guardado: lo único que se lee para decidir si la persona lo alcanza (D-39) antes de leer el
     * resto (`consultas/comprobante-en-alcance.ts`), y la de la factura que una nota corrige (D-51).
     */
    lecturas: Pick<LecturasDeComprobantes, "sucursalDelComprobante">;
    /**
     * Una sucursal de la empresa, abierta o cerrada (la composición pasa el repositorio de empresas, que ya cumple esto): emitir
     * exige la del punto de venta abierta (D-50).
     */
    sucursales: Readonly<{
      obtener(empresa: EmpresaId, id: SucursalId): Promise<Readonly<{ activa: boolean }> | null>;
    }>;
    puntosDeVenta: Pick<RepositorioDePuntosDeVenta, "obtener" | "cambiarAmbiente">;
    series: Pick<
      RepositorioDeSeries,
      "obtener" | "crear" | "guardar" | "enCursoVencidas" | "delPuntoDeVenta"
    >;
    comprobantes: Pick<
      RepositorioDeComprobantes,
      "obtener" | "delOrigen" | "crear" | "transicionar" | "enVueloVencidos" | "pendientes"
    >;
    intentos: Pick<RepositorioDeIntentos, "registrar">;
    certificados: Pick<RepositorioDeCertificados, "vigente">;
    datosFiscales: Pick<RepositorioDeDatosFiscales, "confirmadas">;
    domicilios: Pick<RepositorioDeDomicilios, "obtener">;
    trabajos: TrabajosReencolables;
  }>;

/**
 * El servicio de emisión de un emisor en un ambiente (§B.5.2: «uno por (emisor, ambiente); lo arma la
 * composición»). Cada ambiente es otro ARCA y cada emisor tiene su certificado: pedirle al de otro par sería
 * emitir con la credencial equivocada. En pruebas, el adaptador falso.
 */
export type ProveedorDeEmision = Readonly<{
  para(empresa: EmpresaId, emisor: EmisorId, ambiente: Ambiente): EmisionElectronica;
}>;

/**
 * Tiempos límite PROPIOS de cada llamada al servicio de emisión, en milisegundos (§B.5.4). Son el respaldo del
 * caso de uso por encima de los del adaptador: una llamada que no vuelve a tiempo es `INCIERTO` (autorizar, que
 * NUNCA se reenvía), `CONSULTA_FALLIDA` (consultar) o `SERVICIO_NO_DISPONIBLE` (último autorizado). ASUMIDOS:
 * un poco más que los del adaptador (20 s y 10 s) y bastante menos que la reserva de la serie (5 minutos).
 */
export type TiemposLimite = Readonly<{
  autorizarEnMs: number;
  consultarEnMs: number;
  ultimoAutorizadoEnMs: number;
}>;

export type OpcionesDeFacturacion = Readonly<{
  numeracion: OpcionesDeNumeracion;
  tiempos: TiemposLimite;
  /** Un `PENDIENTE` sin trabajo vivo y más viejo que esto lo reencola la reconciliación (§B.4.7, 10 minutos). */
  pendienteHuerfanoEnMs: number;
  /** Cuántos comprobantes en vuelo (y cuántos pendientes huérfanos) mira una corrida de la reconciliación. */
  limitePorCorrida: number;
}>;

export const OPCIONES_DE_FACTURACION: OpcionesDeFacturacion = {
  numeracion: OPCIONES_DE_NUMERACION,
  tiempos: { autorizarEnMs: 25_000, consultarEnMs: 15_000, ultimoAutorizadoEnMs: 15_000 },
  pendienteHuerfanoEnMs: 10 * 60_000,
  limitePorCorrida: 50,
};

export type DependenciasDeFacturacion = Readonly<{
  transacciones: Transacciones<TxDeFacturacion>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
  /** Se usa SIEMPRE fuera de una transacción (ADR-007). */
  emision: ProveedorDeEmision;
  /**
   * La hora de cada paso que sigue a una llamada externa (la transacción que cierra un comprobante después de
   * que ARCA respondió) y de la duración de cada intento. Los casos de uso no leen el reloj por su cuenta: la
   * composición pasa el del sistema y las pruebas uno controlado.
   */
  reloj: Readonly<{ ahora(): Date }>;
  opciones?: Partial<OpcionesDeFacturacion>;
}>;

/** El tipo del trabajo que lleva un comprobante `PENDIENTE` a ARCA (§B.4.5). */
export const TRABAJO_VALIDAR_COMPROBANTE = "fiscal.validar_comprobante";
/** El tipo del trabajo que barre los comprobantes en vuelo de una empresa (§B.4.7). */
export const TRABAJO_RECONCILIAR = "fiscal.reconciliar";

/**
 * El contexto de un trabajo de sistema de facturación: operativo, de la empresa del trabajo, SIN persona ni
 * puerta de entrada (ADR-007).
 */
export function contextoDeSistema(empresaId: EmpresaId, ahora: Date): ContextoOperativo {
  return { tipo: "OPERATIVO", empresaId, personaId: null, marcaDeEntrada: null, ahora };
}

/** El prefijo de las claves de los trabajos de validación de un comprobante (`fiscal.validar:<id>:<n>`). */
export const prefijoDeValidacion = (comprobante: ComprobanteId): string =>
  `fiscal.validar:${comprobante}:`;

/**
 * Encola la validación del comprobante si no tiene un trabajo vivo (`PENDIENTE` o `EN_CURSO`), con la clave
 * `fiscal.validar:<id>:<n>`, donde `n` es uno más que el mayor ya usado: así un reencolado nunca choca con la
 * clave de un trabajo que ya terminó (`HECHO` o `FALLIDO`) y queda sin correr. Devuelve si encoló.
 * Un trabajo `EN_CURSO` cuyo proceso murió lo retoma el procesador al vencer su toma: no hace falta otro.
 */
export async function encolarValidacion(
  tx: Pick<TxDeFacturacion, "trabajos">,
  empresaId: EmpresaId,
  comprobante: ComprobanteId,
): Promise<boolean> {
  const prefijo = prefijoDeValidacion(comprobante);
  const previos = await tx.trabajos.conPrefijo(empresaId, prefijo);
  if (previos.some((t) => t.estado === "PENDIENTE" || t.estado === "EN_CURSO")) return false;
  const ultimo = previos.reduce((mayor, t) => {
    const n = Number(t.claveDeIdempotencia.slice(prefijo.length));
    return Number.isSafeInteger(n) && n > mayor ? n : mayor;
  }, 0);
  const encolado = await tx.trabajos.encolar({
    empresaId,
    tipo: TRABAJO_VALIDAR_COMPROBANTE,
    datos: { comprobanteId: comprobante },
    claveDeIdempotencia: `${prefijo}${ultimo + 1}`,
  });
  return encolado === "ENCOLADO";
}

/** Las opciones completas: las que se pasaron sobre las de por defecto. */
export function opcionesDe(dependencias: DependenciasDeFacturacion): OpcionesDeFacturacion {
  return { ...OPCIONES_DE_FACTURACION, ...dependencias.opciones };
}
