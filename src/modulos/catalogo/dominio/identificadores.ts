import type { Marca } from "../../../primitivas/identificadores/marca";

/** Identificadores del catálogo, con marca: un `ProductoId` no se pasa donde se espera un `OpcionId`. Los manda la aplicación (uuid). */
export type ProductoId = Marca<string, "ProductoId">;
export type SeccionDeCartaId = Marca<string, "SeccionDeCartaId">;
export type GrupoDeEleccionesId = Marca<string, "GrupoDeEleccionesId">;
export type OpcionId = Marca<string, "OpcionId">;
export type VersionDeOpcionId = Marca<string, "VersionDeOpcionId">;
export type PrecioDeVentaId = Marca<string, "PrecioDeVentaId">;
export type CopiaDeOpcionesId = Marca<string, "CopiaDeOpcionesId">;
export type CartaPublicaId = Marca<string, "CartaPublicaId">;

const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id del catálogo es un uuid: lo demás nunca puede ser el id de nada y la base lo rechazaría por formato. */
export const esUuid = (texto: string): boolean => FORMA_DE_UUID.test(texto);

export const productoId = (valor: string): ProductoId => valor as ProductoId;
export const seccionDeCartaId = (valor: string): SeccionDeCartaId => valor as SeccionDeCartaId;
export const grupoDeEleccionesId = (valor: string): GrupoDeEleccionesId =>
  valor as GrupoDeEleccionesId;
export const opcionId = (valor: string): OpcionId => valor as OpcionId;
export const versionDeOpcionId = (valor: string): VersionDeOpcionId => valor as VersionDeOpcionId;
export const precioDeVentaId = (valor: string): PrecioDeVentaId => valor as PrecioDeVentaId;
export const copiaDeOpcionesId = (valor: string): CopiaDeOpcionesId => valor as CopiaDeOpcionesId;
export const cartaPublicaId = (valor: string): CartaPublicaId => valor as CartaPublicaId;
