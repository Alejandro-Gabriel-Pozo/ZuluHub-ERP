import { z } from "zod";
import {
  leerDireccionPegada,
  type PartesDeDireccion,
} from "../capacidades/activos/direccion-externa";
import { CARAS_DE_VIDRIERA } from "../capacidades/experiencia/vidriera/caras";
import { COLOR_RRGGBB } from "../primitivas/color/contraste";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import { entero, identificador, leer, texto } from "./entradas-de-facturacion";

/**
 * La entrada de la pantalla «Carta en línea» (C1): de lo que mandan los formularios a lo que aceptan las acciones de la carta. Pura: sin base ni servidor.
 *
 * Lista de permitidos: de cada pedido solo se leen las claves que declara su esquema (`z.object` descarta el resto): NO se puede mandar la empresa, la persona,
 * el código de la carta, el estado ni el mensaje de portada. La sucursal la pone el servidor (la elegida en el dispositivo, validada); acá solo viaja para compararla
 * con la que la página mostró. Esta capa dice si el dato tiene la FORMA pedida; qué es un nombre, un rubro o un lugar válido lo decide el dominio (el largo y el
 * conjunto permitido viven una vez, en `datos-de-carta-publica.ts`).
 *
 * Dos pedidos:
 *  - **Guardar los textos y la identidad.** Lleva la clave de la carta (`cartaId`: la que fijó la página; para una carta nueva es la clave de creación, y repetir el alta con la misma
 *    clave devuelve la carta ya creada) y, si la carta ya existía, la versión que la persona vio. Previene: dos cartas por un doble toque, y pisar un cambio ajeno.
 *  - **Poner en línea / sacar de línea.** Lleva la carta, la versión vista y el estado pedido: pide un ESTADO, no alterna. Previene: que dos «Poner en línea» seguidos
 *    (o un reintento) saquen la carta que el otro acaba de poner.
 * La identidad (V1): `cara` de la lista cerrada o vacía («sin elegir»); `paleta` (vacía = usar lo de la empresa, un `#rrggbb` de las seis paletas o la palabra «otro») y, solo con «otro», `colorPropio`
 * con la forma `#rrggbb`; `logo` como la dirección pegada de un proveedor permitido (se lee con `leerDireccionPegada` y viaja en PARTES, nunca como dirección) o vacío. Lista de permitidos: lo que no
 * tiene esa forma es `PEDIDO_INVALIDO`. Lo que NO viene (ausente, no vacío) conserva lo vigente: así un pedido que no trae la identidad (otra pantalla, un reintento viejo) no la borra.
 * El modelo no viaja: queda el vigente (VYP-3).
 * Chequeo: `entradas-de-carta-en-linea.test.ts`.
 */

const FORMA_DE_GUARDAR = z.object({
  cartaId: identificador,
  sucursalId: identificador,
  versionEsperada: entero.nullable(),
  nombre: texto,
  rubro: texto,
  lugar: texto,
  cara: z.enum(["", ...CARAS_DE_VIDRIERA]).optional(),
  paleta: z.union([z.literal(""), z.literal("otro"), z.string().regex(COLOR_RRGGBB)]).optional(),
  colorPropio: z.string().max(7).optional(),
  logo: texto.optional(),
});
const FORMA_DE_CAMBIAR_EL_ESTADO = z.object({
  cartaId: identificador,
  sucursalId: identificador,
  versionEsperada: entero,
  estado: z.enum(["EN_LINEA", "FUERA_DE_LINEA"]),
});

/** El pedido de guardar ya leído: la identidad ausente es `undefined` (conserva lo vigente) y vacía es `null` (sin elegir). */
export type PedidoDeGuardarLaCarta = Readonly<{
  cartaId: string;
  sucursalId: string;
  versionEsperada: number | null;
  nombre: string;
  rubro: string;
  lugar: string;
  cara?: string | null;
  colorPropio?: string | null;
  logo?: PartesDeDireccion | null;
}>;
export type PedidoDeCambiarElEstadoDeLaCarta = z.output<typeof FORMA_DE_CAMBIAR_EL_ESTADO>;

type Pedido<T> = Resultado<T, "PEDIDO_INVALIDO">;

function leido<T>(esquema: z.ZodType<T>, crudo: unknown): Pedido<T> {
  const forma = leer(esquema, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}

/** El color elegido: la paleta, o `colorPropio` si la paleta es «otro»; `null` si es «usar lo de la empresa». «Otro» sin color con la forma pedida no es un pedido. */
function colorElegido(paleta: string, colorPropio: string | undefined): Pedido<string | null> {
  if (paleta === "") return ok(null);
  if (paleta !== "otro") return ok(paleta);
  return colorPropio !== undefined && COLOR_RRGGBB.test(colorPropio)
    ? ok(colorPropio)
    : err("PEDIDO_INVALIDO");
}

/** El pedido, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export function leerElPedidoDeGuardarLaCarta(crudo: unknown): Pedido<PedidoDeGuardarLaCarta> {
  const forma = leido(FORMA_DE_GUARDAR, crudo);
  if (!forma.ok) return forma;
  const { cara, paleta, colorPropio, logo, ...base } = forma.valor;
  const color = paleta === undefined ? ok(undefined) : colorElegido(paleta, colorPropio);
  if (!color.ok) return color;
  let elLogo: PartesDeDireccion | null | undefined;
  if (logo === undefined) elLogo = undefined;
  else if (logo.trim() === "") elLogo = null;
  else {
    const leida = leerDireccionPegada(logo);
    if (!leida.ok) return err("PEDIDO_INVALIDO");
    elLogo = leida.valor.partes;
  }
  return ok({
    ...base,
    ...(cara === undefined ? {} : { cara: cara === "" ? null : cara }),
    ...(color.valor === undefined ? {} : { colorPropio: color.valor }),
    ...(elLogo === undefined ? {} : { logo: elLogo }),
  });
}
export const leerElPedidoDeCambiarElEstadoDeLaCarta = (
  crudo: unknown,
): Pedido<PedidoDeCambiarElEstadoDeLaCarta> => leido(FORMA_DE_CAMBIAR_EL_ESTADO, crudo);
