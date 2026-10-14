import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { CifradorDeSecretos } from "../../../puertos/cifrado-de-secretos";
import type { GeneradorDeCredenciales } from "../../../puertos/generador-de-credenciales";
import type { LectorDeCertificados } from "../../../puertos/lector-de-certificados";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RepositorioDeCertificados } from "../persistencia/repositorio-de-certificados";
import type { RepositorioDeEmisores } from "../persistencia/repositorios";
import type { TxDeNumeracion } from "./contrato";

/**
 * Lo que recibe el trabajo de una transacción de certificados (F7): los repositorios que usa, la lectura de
 * estados (empresa y tenant, tipados por su forma: fiscal no conoce a esos módulos) y los puertos de auditoría y
 * autorización. El repositorio de certificados se pide ANGOSTO: lo único que devuelve la clave cifrada es
 * `obtenerClave`, y solo `cargarCertificado` la lee, para compararla con el certificado en memoria.
 */
export type TxDeCertificados = Readonly<{
  empresas: TxDeNumeracion["empresas"];
  tenants: TxDeNumeracion["tenants"];
  emisores: Pick<RepositorioDeEmisores, "obtener">;
  certificados: Pick<
    RepositorioDeCertificados,
    "obtener" | "obtenerClave" | "crearPedido" | "activar"
  >;
  auditoria: Auditoria;
  /** Quién es el actor y qué módulos tiene la empresa, leído dentro de la transacción (sin caché). */
  autorizacion: CargaDeAutorizacion;
}>;

export type DependenciasDeCertificados = Readonly<{
  transacciones: Transacciones<TxDeCertificados>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
  /** Cifra la clave privada atada a su fila (AES-256-GCM con la clave maestra versionada). */
  cifrador: CifradorDeSecretos;
  /** Genera el par de claves y el pedido (CSR). La clave privada nunca sale de acá. */
  generador: GeneradorDeCredenciales;
  /** Lee el certificado X.509 y lo compara con la clave y con la cadena de ARCA. */
  lector: LectorDeCertificados;
}>;
