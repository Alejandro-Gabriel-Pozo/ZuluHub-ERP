/**
 * Repositorios fiscales (ADR-005, ADR-009). Cada método tiene una intención y devuelve tipos del
 * dominio. Reglas de este archivo:
 *
 *  - Todo filtra por empresa, aunque la RLS ya lo imponga: la base es la última defensa, no la
 *    primera. Las únicas excepciones son los métodos de PLATAFORMA (`cuitsTomados`, que mira toda la
 *    instalación a propósito) y la lectura del emisor por id sin empresa, que no existe.
 *  - Los cambios son `UPDATE ... WHERE version = <la que se leyó>` y devuelven la fila nueva, o
 *    `null` si no la tocaron (otra transacción cambió antes, o no es de la empresa): nada de
 *    `FOR UPDATE` ni de upserts. Cuando es `null`, el caso de uso vuelve a leer y decide (un «ya
 *    estaba» es éxito).
 *  - Las altas que traen un `id` de la aplicación son idempotentes: `INSERT ... ON CONFLICT (id) DO
 *    NOTHING`. Repetir devuelve la fila que ya existe con `creado: false`; es el caso de uso quien
 *    compara si lo repetido es lo mismo. Un `id` tomado por una fila que esta empresa no ve es
 *    `ID_EN_USO`. El conflicto es SOLO sobre el `id`: el resto de las únicas (número de punto de
 *    venta, borrador único) salen tal cual como error de la base.
 *  - Ninguna restricción de la base se atrapa acá: salen tal cual y el adaptador de transacciones
 *    las traduce a `ErrorDePersistencia` (la traducción a errores de negocio está en `traducir.ts`).
 *  - La plataforma no tiene permiso sobre casi nada fiscal: ve `emisor`, `serie_comprobante` y 4
 *    columnas de `punto_de_venta`. Los métodos pensados para ella (los de emisores,
 *    `contarActivosDelEmisor` y `hayNumerosUsadosDelEmisor`) solo tocan eso.
 *
 * Este archivo es la puerta de los repositorios fiscales: cada repositorio vive en su archivo (partidos para que ninguno pase de 400 líneas, sin cambiar
 * una línea de lógica) y acá se reexportan con los mismos nombres de siempre; las ayudas comunes están en `ayudas-de-repositorio.ts`.
 */

export {
  deLaLista,
  exigir,
  serializarAltaDeId,
  type ErrorDeAlta,
  type ResultadoDeAlta,
} from "./ayudas-de-repositorio";
export {
  crearRepositorioDeDomicilios,
  crearRepositorioDeEmisores,
  type DomicilioGuardado,
  type RepositorioDeDomicilios,
  type RepositorioDeEmisores,
} from "./repositorio-de-emisores";
export {
  crearRepositorioDeDatosFiscales,
  type RepositorioDeDatosFiscales,
  type VersionDeDatosFiscales,
} from "./repositorio-de-datos-fiscales";
export {
  crearRepositorioDeReglasDeEmisor,
  type BorradorDeReglaDeEmisor,
  type RepositorioDeReglasDeEmisor,
  type VersionDeRegla,
} from "./repositorio-de-reglas-de-emisor";
export {
  crearRepositorioDePuntosDeVenta,
  type PuntoDeVentaGuardado,
  type RepositorioDePuntosDeVenta,
} from "./repositorio-de-puntos-de-venta";
export {
  crearRepositorioDeSeries,
  type RepositorioDeSeries,
  type SerieGuardada,
} from "./repositorio-de-series";
