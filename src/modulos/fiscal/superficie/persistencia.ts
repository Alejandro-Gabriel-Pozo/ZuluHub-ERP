/** Persistencia fiscal: esquema, repositorios, comprobantes, intentos y certificados. Se reexporta desde `../publico.ts`, la única puerta del módulo (ADR-001). */
// H7 T4: persistencia (tablas, repositorios y traducción de las restricciones de la base). La
// composición arma los repositorios con `db.withTables<FiscalDb>()`; los casos de uso (T5 a T7) los
// reciben por su contrato y traducen con `traducirErroresDeFiscal`.
export {
  COLUMNAS_DE_FISCAL,
  ERRORES_DE_FISCAL_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_FISCAL,
  type ErrorDeFiscalPorRestriccion,
} from "../persistencia/esquema";
export type { FiscalDb } from "../persistencia/tablas";
export {
  crearRepositorioDeDatosFiscales,
  crearRepositorioDeDomicilios,
  crearRepositorioDeEmisores,
  crearRepositorioDePuntosDeVenta,
  crearRepositorioDeReglasDeEmisor,
  crearRepositorioDeSeries,
  type BorradorDeReglaDeEmisor,
  type DomicilioGuardado,
  type ErrorDeAlta,
  type PuntoDeVentaGuardado,
  type RepositorioDeDatosFiscales,
  type RepositorioDeDomicilios,
  type RepositorioDeEmisores,
  type RepositorioDePuntosDeVenta,
  type RepositorioDeReglasDeEmisor,
  type RepositorioDeSeries,
  type ResultadoDeAlta,
  type VersionDeDatosFiscales,
  type VersionDeRegla,
} from "../persistencia/repositorios";
// H7 facturación F3: comprobantes, intentos contra ARCA y certificados (0009).
export {
  crearRepositorioDeComprobantes,
  type AltaDeComprobante,
  type AsociadoGuardado,
  type CambioDeComprobante,
  type ComprobanteGuardado,
  type DatosFiscalesDeLaFoto,
  type EmisorCongelado,
  type ErrorDeAltaDeComprobante,
  type ImportesGuardados,
  type RenglonGuardado,
  type RepositorioDeComprobantes,
  type ResueltoPor,
} from "../persistencia/repositorio-de-comprobantes";
export {
  CLASES_DE_MENSAJE,
  DESENLACES_DE_INTENTO,
  OPERACIONES_DE_INTENTO,
  crearRepositorioDeIntentos,
  type ClaseDeMensaje,
  type DesenlaceDeIntento,
  type IntentoDeArca,
  type MensajeDeIntento,
  type OperacionDeIntento,
  type RepositorioDeIntentos,
} from "../persistencia/repositorio-de-intentos";
export {
  ESTADOS_DE_CERTIFICADO,
  dondeSeGuardaLaClave,
  crearRepositorioDeCertificados,
  type ActivacionDeCertificado,
  type CargaDeCertificado,
  type CertificadoGuardado,
  type EstadoDeCertificado,
  type PedidoDeCertificado,
  type RepositorioDeCertificados,
  type TextoCifrado,
} from "../persistencia/repositorio-de-certificados";
export {
  dondeSeGuardaLaCredencial,
  crearRepositorioDeAccesos,
  type AccesoGuardado,
  type CredencialDeAcceso,
  type RepositorioDeAccesos,
  type ServicioDeArca,
} from "../persistencia/repositorio-de-accesos";
export { crearLecturasDeCertificados } from "../persistencia/lecturas-de-certificados";
export { errorFiscalDeRestriccion, traducirErroresDeFiscal } from "../persistencia/traducir";
