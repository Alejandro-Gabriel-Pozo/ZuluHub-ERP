import { PROVINCIAS } from "../../../primitivas/domicilio/provincias";

/**
 * Catálogos cerrados de la solicitud de alta (alta por solicitud §2.4 y §4.4). Viven en el código, no
 * en la base: la base solo valida la FORMA (`solicitud_rubro_ck`, `solicitud_motivo_ck`...) y el
 * servidor decide qué valores existen. Dominio puro.
 */

/**
 * Tipo de negocio que elige el interesado (§4.4). Es un dato del código, no un paquete de entrada
 * ([DEC] 25 sigue abierta): sirve para saber si el producto le sirve. La lista definitiva la confirma el
 * dueño con el contenido de la landing (B4). La forma `[a-z][a-z_]{1,39}` es la de `solicitud_rubro_ck`.
 */
export const RUBROS = [
  "cafeteria",
  "panaderia",
  "restaurante",
  "bar",
  "heladeria",
  "almacen_o_comercio",
  "hoteleria",
  "otro",
] as const;

export type Rubro = (typeof RUBROS)[number];

/** Las 24 jurisdicciones (ISO 3166-2:AR), tomadas del catálogo común: una sola fuente. */
export const CODIGOS_DE_PROVINCIA: readonly string[] = PROVINCIAS.map((p) => p.codigo);

/** Por qué se rechaza una solicitud (lista cerrada; `solicitud_motivo_ck`). */
export const MOTIVOS_DE_RECHAZO = [
  "NO_VERIFICADA",
  "FUERA_DE_ALCANCE",
  "DATOS_INCOMPLETOS",
  "NO_CONTACTABLE",
  "OTRO",
] as const;

export type MotivoDeRechazo = (typeof MOTIVOS_DE_RECHAZO)[number];

/**
 * `NO_VERIFICADA` lo pone solo el barrido a los 7 días. Un administrador que lo elija recibe
 * `MOTIVO_RESERVADO`; además la base lo impide (`solicitud_no_verificada_ck`).
 */
export const MOTIVO_RESERVADO_AL_SISTEMA: MotivoDeRechazo = "NO_VERIFICADA";

export const MOTIVOS_QUE_ELIGE_UN_ADMIN: readonly MotivoDeRechazo[] = MOTIVOS_DE_RECHAZO.filter(
  (m) => m !== MOTIVO_RESERVADO_AL_SISTEMA,
);

/** Para qué se usan los datos. Hoy una sola: evaluar y dar el alta, no enviar publicidad (§2.4). */
export const FINALIDADES = ["EVALUAR_ALTA"] as const;

export type Finalidad = (typeof FINALIDADES)[number];

/** Forma de una versión de texto legal: `AAAA-MM-DD` con sufijo opcional `.N` (`solicitud_terminos_ck`). */
export const FORMA_DE_VERSION = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$/;

/** Las versiones de los textos que la landing puede mostrar hoy. Una página con otra es una página vieja. */
export type VersionesVigentes = Readonly<{
  terminos: readonly string[];
  privacidad: readonly string[];
  avisoDeMedicion: readonly string[];
}>;

/**
 * Las versiones vigentes. VACÍAS a propósito hasta que el asesor entregue los textos legales (B3, que
 * bloquea la publicación de la landing): con la lista vacía todo envío da `PAGINA_VENCIDA`, es decir,
 * falla cerrado. Al publicar un texto, su versión se agrega acá en el mismo cambio que lo publica.
 */
export const VERSIONES_VIGENTES: VersionesVigentes = {
  terminos: [],
  privacidad: [],
  avisoDeMedicion: [],
};
