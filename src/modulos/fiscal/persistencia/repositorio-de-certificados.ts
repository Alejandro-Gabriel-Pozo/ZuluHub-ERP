import type { Kysely } from "kysely";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { empresaId, personaId, type EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { DondeSeGuarda, TextoCifrado } from "../../../puertos/cifrado-de-secretos";
import { AMBIENTES, type Ambiente } from "../dominio/comprobante-nuevo";
import {
  certificadoId,
  emisorId,
  type CertificadoId,
  type EmisorId,
} from "../dominio/identificadores";
import {
  deLaLista,
  serializarAltaDeId,
  type ErrorDeAlta,
  type ResultadoDeAlta,
} from "./repositorios";
import type { FiscalDb } from "./tablas";
import {
  ESTADOS_DE_CERTIFICADO,
  type ActivacionDeCertificado,
  type CargaDeCertificado,
  type CertificadoGuardado,
  type PedidoDeCertificado,
} from "./tipos-de-certificados";

export {
  ESTADOS_DE_CERTIFICADO,
  type ActivacionDeCertificado,
  type CargaDeCertificado,
  type CertificadoGuardado,
  type EstadoDeCertificado,
  type PedidoDeCertificado,
} from "./tipos-de-certificados";

/**
 * Repositorio de los certificados de ARCA y de la credencial de acceso (spec H7 facturación §B.6, §B.8.5).
 *
 * ESTE ARCHIVO ES EL ÚNICO REPOSITORIO que selecciona las columnas cifradas (`clave_*` de `certificado_arca` y
 * `credencial_*` de `acceso_arca`; solo las declaran, además, `tablas.ts` y `esquema.ts`). Lo que guarda y devuelve son los BYTES cifrados que le da y le pide el
 * adaptador de ARCA: no cifra ni descifra nada (eso es de F7), y ninguna lectura común los trae.
 * `obtener` y `vigente` devuelven el certificado SIN clave; la clave cifrada sale solo por `obtenerClave` y
 * la credencial cifrada solo por `obtenerCredencial`, los dos para ese adaptador. Previene que una consulta
 * o `publico.ts` devuelvan la clave privada (aun cifrada) o la credencial de acceso (§B.9, «nunca se muestra»).
 *
 * Mismas reglas que los demás repositorios fiscales: todo filtra por empresa; las altas con `id` de la
 * aplicación son idempotentes; los cambios son `UPDATE ... WHERE version = <la que se leyó>` y devuelven la
 * fila nueva o `null`; ninguna restricción de la base se atrapa acá. Un certificado no se borra jamás.
 */

/** Un texto cifrado con AES-256-GCM (el puerto de cifrado lo define; acá se guarda tal cual). */
export type { TextoCifrado };

/**
 * Dónde vive cada texto cifrado: la fila y la columna que lo atan al cifrarlo (dato asociado, AAD; spec §B.6.3).
 * Viven acá porque este archivo es el único que nombra las columnas cifradas: quien cifra (F7) y quien descifra
 * (el adaptador de ARCA, F8) piden el lugar a este archivo y no lo escriben por su cuenta, así no pueden divergir.
 * Previene que un texto cifrado se escriba con un lugar y se lea con otro (no descifraría nunca). Chequeo:
 * `credenciales-de-emisor.test.ts` y las pruebas de integración de F7 (cifrar al pedir, descifrar al leer).
 */
export const dondeSeGuardaLaClave = (
  empresa: EmpresaId,
  certificado: CertificadoId,
): DondeSeGuarda => ({
  empresaId: empresa,
  tabla: "certificado_arca",
  filaId: certificado,
  columna: "clave_cifrada",
});

export interface RepositorioDeCertificados {
  /** Un certificado de la empresa, SIN su clave; `null` si no existe o es de otra empresa. */
  obtener(empresa: EmpresaId, id: CertificadoId): Promise<CertificadoGuardado | null>;
  /** El certificado `VIGENTE` del emisor en ese ambiente (hay a lo sumo uno). */
  vigente(
    empresa: EmpresaId,
    emisor: EmisorId,
    ambiente: Ambiente,
  ): Promise<CertificadoGuardado | null>;
  /** El certificado ya cargado con esa huella (cualquier estado): para que cargar dos veces el mismo sea «ya estaba». */
  porHuella(empresa: EmpresaId, huellaSha256: string): Promise<CertificadoGuardado | null>;
  /**
   * La clave privada CIFRADA del certificado, para el adaptador de ARCA; `null` si no existe o es de otra
   * empresa. Es lo único que la devuelve.
   */
  obtenerClave(empresa: EmpresaId, id: CertificadoId): Promise<TextoCifrado | null>;
  /**
   * Guarda el pedido `PEDIDO_GENERADO` con el `id` de la aplicación (idempotente: repetir el MISMO pedido
   * devuelve el que existe, `creado: false`, sin tocarlo; el mismo `id` con otro emisor, ambiente, alias,
   * titular o pedido, o de un certificado que esta empresa no ve, es `ID_EN_USO`).
   */
  crearPedido(
    pedido: PedidoDeCertificado,
  ): Promise<Resultado<ResultadoDeAlta<CertificadoGuardado>, ErrorDeAlta>>;
  /**
   * `PEDIDO_GENERADO` → `VIGENTE` con el certificado cargado, si la versión coincide; si no (o si ya no está
   * `PEDIDO_GENERADO`), `null` y no toca nada. Si el emisor ya tiene uno `VIGENTE` en ese ambiente lo pasa a
   * `REEMPLAZADO` ANTES, en la misma transacción: nunca hay dos vigentes. Dos cargas a la vez para el mismo
   * `(emisor, ambiente)` se serializan. Un certificado ya cargado con esa huella sale como error de la base
   * (`certificado_huella_uk`).
   */
  activar(
    empresa: EmpresaId,
    id: CertificadoId,
    versionEsperada: number,
    carga: CargaDeCertificado,
  ): Promise<ActivacionDeCertificado | null>;
  /** `PEDIDO_GENERADO` → `DESCARTADO` si la versión coincide; si no, `null`. */
  descartar(
    empresa: EmpresaId,
    id: CertificadoId,
    versionEsperada: number,
  ): Promise<CertificadoGuardado | null>;
  /**
   * Los pedidos `PEDIDO_GENERADO` de ese `(emisor, ambiente)` distintos de `salvo` pasan a `DESCARTADO`, de una
   * sola sentencia (D-92, 2026-11-03: un pedido nuevo anula al pendiente anterior). Devuelve los que pasaron, del más
   * viejo al más nuevo; no toca `VIGENTE` ni `REEMPLAZADO` ni otro emisor, ambiente o empresa. Previene dos pedidos
   * pendientes a la vez para el mismo `(emisor, ambiente)`.
   */
  descartarPendientes(
    empresa: EmpresaId,
    emisor: EmisorId,
    ambiente: Ambiente,
    salvo: CertificadoId,
  ): Promise<readonly CertificadoGuardado[]>;
  /**
   * Anota la primera llamada exitosa a ARCA de un certificado `VIGENTE`. Se anota UNA vez: si ya estaba
   * anotada (o no es vigente, o no existe) devuelve `null` y no escribe.
   */
  anotarVerificacion(
    empresa: EmpresaId,
    id: CertificadoId,
    cuando: Date,
  ): Promise<CertificadoGuardado | null>;
}

/** Lo que se sabe de la credencial de acceso sin mostrarla. */
// =================================================================================================
// Certificados
// =================================================================================================

type FilaDeCertificado = Readonly<{
  id: string;
  empresa_id: string;
  emisor_id: string;
  ambiente: string;
  alias: string;
  cuit_titular: string;
  estado: string;
  pedido_pem: string;
  certificado_pem: string | null;
  huella_sha256: string | null;
  vence_en: Date | null;
  autorizacion_verificada_en: Date | null;
  creado_por: string;
  creado_en: Date;
  version: number;
}>;

/** Las columnas que se pueden mostrar: ni `clave_*` ni nada cifrado. */
export const COLUMNAS_DE_CERTIFICADO = [
  "id",
  "empresa_id",
  "emisor_id",
  "ambiente",
  "alias",
  "cuit_titular",
  "estado",
  "pedido_pem",
  "certificado_pem",
  "huella_sha256",
  "vence_en",
  "autorizacion_verificada_en",
  "creado_por",
  "creado_en",
  "version",
] as const;

export function aCertificado(fila: FilaDeCertificado): CertificadoGuardado {
  return {
    id: certificadoId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    emisorId: emisorId(fila.emisor_id),
    ambiente: deLaLista(AMBIENTES, fila.ambiente, "ambiente de certificado"),
    alias: fila.alias,
    cuitTitular: fila.cuit_titular as Cuit,
    estado: deLaLista(ESTADOS_DE_CERTIFICADO, fila.estado, "estado de certificado"),
    pedidoPem: fila.pedido_pem,
    certificadoPem: fila.certificado_pem,
    huellaSha256: fila.huella_sha256,
    venceEn: fila.vence_en,
    autorizacionVerificadaEn: fila.autorizacion_verificada_en,
    creadoPor: personaId(fila.creado_por),
    creadoEn: fila.creado_en,
    version: fila.version,
  };
}

/** Los bytes cifrados como `Buffer` para la base (también los usa `repositorio-de-accesos.ts`). */
export const aBytes = (b: Uint8Array) => Buffer.from(b);

function mismoPedido(guardado: CertificadoGuardado, pedido: PedidoDeCertificado): boolean {
  return (
    guardado.emisorId === pedido.emisorId &&
    guardado.ambiente === pedido.ambiente &&
    guardado.alias === pedido.alias &&
    guardado.cuitTitular === pedido.cuitTitular &&
    guardado.pedidoPem === pedido.pedidoPem
  );
}

export function crearRepositorioDeCertificados(db: Kysely<FiscalDb>): RepositorioDeCertificados {
  const seleccionar = () => db.selectFrom("certificado_arca").select(COLUMNAS_DE_CERTIFICADO);

  async function obtener(
    empresa: EmpresaId,
    id: CertificadoId,
  ): Promise<CertificadoGuardado | null> {
    const fila = await seleccionar()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .executeTakeFirst();
    return fila === undefined ? null : aCertificado(fila);
  }

  return {
    obtener,

    async vigente(empresa, emisor, ambiente) {
      const fila = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("emisor_id", "=", emisor)
        .where("ambiente", "=", ambiente)
        .where("estado", "=", "VIGENTE")
        .executeTakeFirst();
      return fila === undefined ? null : aCertificado(fila);
    },

    async porHuella(empresa, huellaSha256) {
      const fila = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("huella_sha256", "=", huellaSha256)
        .executeTakeFirst();
      return fila === undefined ? null : aCertificado(fila);
    },

    async obtenerClave(empresa, id) {
      const fila = await db
        .selectFrom("certificado_arca")
        .select(["clave_cifrada", "clave_nonce", "clave_etiqueta", "clave_kid"])
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined
        ? null
        : {
            cifrado: fila.clave_cifrada,
            nonce: fila.clave_nonce,
            etiqueta: fila.clave_etiqueta,
            kid: fila.clave_kid,
          };
    },

    async crearPedido(pedido) {
      await serializarAltaDeId(db, "certificado_arca", pedido.id);
      const nuevo = await db
        .insertInto("certificado_arca")
        .values({
          id: pedido.id,
          empresa_id: pedido.empresaId,
          emisor_id: pedido.emisorId,
          ambiente: pedido.ambiente,
          alias: pedido.alias,
          cuit_titular: pedido.cuitTitular,
          pedido_pem: pedido.pedidoPem,
          clave_cifrada: aBytes(pedido.clave.cifrado),
          clave_nonce: aBytes(pedido.clave.nonce),
          clave_etiqueta: aBytes(pedido.clave.etiqueta),
          clave_kid: pedido.clave.kid,
          creado_por: pedido.creadoPor,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .returning("id")
        .executeTakeFirst();
      const guardado = await obtener(pedido.empresaId, pedido.id);
      if (guardado === null) return err("ID_EN_USO");
      if (nuevo !== undefined) return ok({ creado: true, valor: guardado });
      return mismoPedido(guardado, pedido)
        ? ok({ creado: false, valor: guardado })
        : err("ID_EN_USO");
    },

    async activar(empresa, id, versionEsperada, carga) {
      // El emisor y el ambiente del pedido no cambian nunca: se leen sin bloquear para saber qué serializar.
      const pedido = await obtener(empresa, id);
      if (pedido === null) return null;
      // Dos cargas del mismo `(emisor, ambiente)` a la vez: la segunda espera a la primera.
      await serializarAltaDeId(
        db,
        "certificado_vigente",
        `${empresa}|${pedido.emisorId}|${pedido.ambiente}`,
      );
      // Se valida ANTES de tocar al vigente: si el pedido ya no sirve no se reemplaza nada.
      const aActivar = await db
        .selectFrom("certificado_arca")
        .select("id")
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "PEDIDO_GENERADO")
        .where("version", "=", versionEsperada)
        .forUpdate()
        .executeTakeFirst();
      if (aActivar === undefined) return null;
      const anterior = await db
        .updateTable("certificado_arca")
        .set({ estado: "REEMPLAZADO" })
        .where("empresa_id", "=", empresa)
        .where("emisor_id", "=", pedido.emisorId)
        .where("ambiente", "=", pedido.ambiente)
        .where("estado", "=", "VIGENTE")
        .where("id", "<>", id)
        .returning(COLUMNAS_DE_CERTIFICADO)
        .executeTakeFirst();
      const activado = await db
        .updateTable("certificado_arca")
        .set({
          estado: "VIGENTE",
          certificado_pem: carga.certificadoPem,
          huella_sha256: carga.huellaSha256,
          vence_en: carga.venceEn,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returning(COLUMNAS_DE_CERTIFICADO)
        .executeTakeFirst();
      if (activado === undefined) throw new Error("el pedido bloqueado no se pudo activar");
      return {
        certificado: aCertificado(activado),
        reemplazado: anterior === undefined ? null : aCertificado(anterior),
      };
    },

    async descartar(empresa, id, versionEsperada) {
      const descartado = await db
        .updateTable("certificado_arca")
        .set({ estado: "DESCARTADO" })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "PEDIDO_GENERADO")
        .where("version", "=", versionEsperada)
        .returning(COLUMNAS_DE_CERTIFICADO)
        .executeTakeFirst();
      return descartado === undefined ? null : aCertificado(descartado);
    },

    async descartarPendientes(empresa, emisor, ambiente, salvo) {
      const descartados = await db
        .updateTable("certificado_arca")
        .set({ estado: "DESCARTADO" })
        .where("empresa_id", "=", empresa)
        .where("emisor_id", "=", emisor)
        .where("ambiente", "=", ambiente)
        .where("estado", "=", "PEDIDO_GENERADO")
        .where("id", "<>", salvo)
        .returning(COLUMNAS_DE_CERTIFICADO)
        .execute();
      return descartados
        .map(aCertificado)
        .sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime() || a.id.localeCompare(b.id));
    },

    async anotarVerificacion(empresa, id, cuando) {
      const anotado = await db
        .updateTable("certificado_arca")
        .set({ autorizacion_verificada_en: cuando })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "VIGENTE")
        .where("autorizacion_verificada_en", "is", null)
        .returning(COLUMNAS_DE_CERTIFICADO)
        .executeTakeFirst();
      return anotado === undefined ? null : aCertificado(anotado);
    },
  };
}
