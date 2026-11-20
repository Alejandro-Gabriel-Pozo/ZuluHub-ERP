import type { AlcanceDelHost } from "../capacidades/experiencia/puerta";
import type { PartesDeDireccion } from "../capacidades/activos/direccion-externa";

/**
 * Puerto `PortalPublico` (portal de la empresa, migraciones 0078 y 0083): la lectura PÚBLICA del portal por su código propio (el del QR de la empresa) DENTRO DE UNA MARCA.
 * Solo lectura y sin sesión. Devuelve `null` si el código no existe en esa marca o el portal no está disponible (empresa que no opera, o que bajó de plan o perdió el
 * módulo `vidriera` o la perilla `vidriera_por_qr`), sin distinguir los casos: la respuesta neutra no es un oráculo. Las imágenes llegan como PARTES de la dirección
 * externa (nunca la dirección pegada): quien las muestra arma la dirección con el proveedor de la lista cerrada.
 */
export type TarjetaPublicada = Readonly<{
  orden: number;
  /** El nombre propio de la tarjeta o, si no lo tiene, el de la carta de esa sucursal. */
  nombre: string;
  telefono: string | null;
  foto: PartesDeDireccion | null;
  /** La carta en línea a la que lleva (el enlace es `/s/carta/<código>`). */
  codigoDeCarta: string;
}>;

/** Porcentajes de la imagen con dos decimales, como texto decimal. */
export type ZonaPublicada = Readonly<{
  x: string;
  y: string;
  ancho: string;
  alto: string;
  codigoDeCarta: string;
}>;

export type PortalPublicado = Readonly<{
  codigo: string;
  variante: "A" | "B";
  lineaSuperior: string | null;
  titulo: string | null;
  colorEncabezado: string | null;
  colorPagina: string | null;
  colorDetras: string | null;
  logoVisible: boolean;
  imagen: PartesDeDireccion | null;
  tarjetas: readonly TarjetaPublicada[];
  zonas: readonly ZonaPublicada[];
}>;

export interface PortalPublico {
  porCodigo(host: AlcanceDelHost, codigo: string): Promise<PortalPublicado | null>;
  /**
   * El código del portal de la empresa de UNA carta, para el enlace «← PORTAL» (`hrefDelPortal`). `null` si el código no es de una carta del host, la empresa no tiene
   * portal o el portal no se sirve (mismo plan y mismo estado que `porCodigo`): sin portal servible no hay flecha.
   */
  codigoDelPortalDeLaCarta(host: AlcanceDelHost, codigoDeCarta: string): Promise<string | null>;
}
