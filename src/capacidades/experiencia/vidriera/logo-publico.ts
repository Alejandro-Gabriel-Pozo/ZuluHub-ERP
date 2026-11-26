import { armarDestinoDeLogo, direccionCanonica } from "../../activos/direccion-externa";
import type { FalloDeTraida, MemoriaDeLogos } from "../../activos/memoria-de-logos";
import type { ImagenesExternas } from "../../../puertos/imagenes-externas";
import type { VidrieraPublica } from "../../../puertos/vidriera-publica";
import { err, ok } from "../../../primitivas/resultado/resultado";
import type { AlcanceDelHost } from "../puerta";

/**
 * El logo de la carta que se sirve desde la dirección de la propia carta (`/<código>/logo/<versión>.webp`, §5.7.5): la CSP no deja imágenes de otro sitio, así que
 * el servidor lo trae, lo valida y lo entrega desde acá. Una función con sus piezas a la vista (la carta pública, el traedor y la memoria), para ejercerla entera
 * sin red ni base. El orden importa y cada paso corta con `null` (la ruta responde 404 sin decir por qué: no hay oráculo):
 *  1. La carta se lee con la MISMA puerta que la página (`porCodigo`): código de esa marca, carta en línea, sucursal abierta, empresa que opera, plan que la deja servir y
 *     host que corresponde. Una carta que no se ve, tampoco entrega su logo.
 *  2. La versión pedida tiene que ser la guardada, ANTES de ir a ningún lado: un enlace viejo o inventado no cuesta una conexión saliente.
 *  3. La memoria decide si hay que salir a pedir; el traedor es el único que sale.
 * La cuenta del logo tiene que estar entre las que la EMPRESA DE LA CARTA declaró y tiene activas (0102, spec §5.7.2): `CUENTA_NO_DECLARADA` corta con `null` (el mismo 404, sin oráculo) y no
 * sale ningún pedido. Es la segunda línea: la carta ya anula el logo de una cuenta no declarada al armarse (`armarVidrieraPublicada`).
 */

/** El sufijo con que la carta nombra su logo servido. */
export const EXTENSION_DE_LOGO_SERVIDO = ".webp";

export type DependenciasDelLogoPublico = Readonly<{
  vidriera: Pick<VidrieraPublica, "porCodigo">;
  traedor: ImagenesExternas;
  memoria: MemoriaDeLogos;
}>;

/** La versión de «1700000000.webp», o `null` si el tramo no termina en `.webp`. */
export function versionDeLaRuta(tramo: string): string | null {
  return tramo.endsWith(EXTENSION_DE_LOGO_SERVIDO)
    ? tramo.slice(0, -EXTENSION_DE_LOGO_SERVIDO.length)
    : null;
}

/** La dirección del logo servido (relativa a la carta): la que arma la vista y la que atiende la ruta. */
export const rutaDelLogoServido = (rutaDeLaCarta: string, version: string): string =>
  `${rutaDeLaCarta}/logo/${version}${EXTENSION_DE_LOGO_SERVIDO}`;

export async function logoPublicoDeLaCarta(
  dependencias: DependenciasDelLogoPublico,
  host: AlcanceDelHost,
  codigo: string,
  tramoDeVersion: string,
): Promise<Uint8Array | null> {
  const version = versionDeLaRuta(tramoDeVersion);
  if (version === null) return null;
  const vidriera = await dependencias.vidriera.porCodigo(host, codigo);
  if (vidriera === null) return null;
  const logo = vidriera.identidad.logo;
  if (logo === null || logo.version !== version) return null;
  const destino = armarDestinoDeLogo(logo, vidriera.cuentasDeImagen);
  if (!destino.ok) return null;
  // La carta y la dirección exacta del logo: un logo cambiado (otra versión, otra imagen) nunca hereda los bytes ni el fallo del anterior.
  const clave = `${vidriera.codigo}|${direccionCanonica(logo)}`;
  return dependencias.memoria.obtener(clave, async () => {
    const traido = await dependencias.traedor.traerLogo(destino.valor);
    if (traido.ok) return ok(traido.valor);
    return err<FalloDeTraida>({ transitorio: traido.error === "OCUPADO" });
  });
}
