import type { FuenteDeTexto, UsoDeTexto } from "./uso-y-fuente-de-texto";

/**
 * Los textos de la pantalla «Cobrar un ticket a cuenta» (prefijo `cuenta_corriente.cobro.`, CC-5 B2b; maqueta P4 `cuenta-corriente-ficha-listado-y-cobro.html`, aprobada por el dueño el 26/11/2026).
 * El orquestador los aceptó por la delegación de la fila 173 en `DEC-CCL-009`; `sin_caja` lleva la corrección del dueño (la caja abierta es obligatoria para TODO medio de cobro). Lo demás de la
 * pantalla reutiliza claves que ya existían (Cliente, Vencida, Cobrado, Cancelar, los tipos de medio, Salón, Mostrador y Ticket): no se repite ninguno.
 */
const FUENTE: FuenteDeTexto = { decision: "DEC-CCL-009" };
const ARCHIVO = "apps/web/ui/plantillas/cuenta-corriente/textos-de-cobrar-a-cuenta.ts";
const DE = (nombre: string): UsoDeTexto => ({ como: "FUNCION", archivo: ARCHIVO, nombre });
/** Los tres textos largos de la hoja declaran su largo (la base admite hasta 200); los que llevan datos declaran sus marcadores. */
const texto = <T extends string>(
  porDefecto: T,
  extra: Readonly<{ marcadores?: readonly string[]; largoMaximo?: number }> = {},
  funcion = "textosDeCobrarACuenta",
) => ({ porDefecto, ...extra, usos: [DE(funcion)] as const, fuente: FUENTE }) as const;

export const TEXTOS_DE_COBRO_A_CUENTA = {
  "cuenta_corriente.cobro.titulo": texto("Cobrar un ticket a cuenta"),
  "cuenta_corriente.cobro.nota": texto(
    "Cobro por el total del ticket. El cobro parcial y el de varias ventas juntas todavía no están.",
    { largoMaximo: 120 },
  ),
  "cuenta_corriente.cobro.ticket_valor": texto(
    "{n} · {canal} · {fecha}",
    {
      marcadores: ["n", "canal", "fecha"],
    },
    "valorDelTicket",
  ),
  "cuenta_corriente.cobro.vencia_el": texto("Vencía el"),
  "cuenta_corriente.cobro.total_a_cobrar": texto("Total a cobrar"),
  "cuenta_corriente.cobro.medio": texto("Medio de cobro"),
  "cuenta_corriente.cobro.caja": texto("Caja donde entra el cobro"),
  "cuenta_corriente.cobro.caja_opcion": texto(
    "{caja} · {sucursal} · sesión abierta hoy",
    {
      marcadores: ["caja", "sucursal"],
    },
    "opcionDeCaja",
  ),
  "cuenta_corriente.cobro.entra_en_la_caja": texto(
    "Este cobro entra en la caja del {fecha}.",
    {
      marcadores: ["fecha"],
    },
    "entraEnLaCaja",
  ),
  "cuenta_corriente.cobro.cobrar": texto(
    "Cobrar {importe}",
    { marcadores: ["importe"] },
    "cobrarImporte",
  ),
  "cuenta_corriente.cobro.cobrado_detalle": texto(
    "El ticket {n} quedó cobrado el {fecha} por {medio}: {importe}. El saldo de {cliente} bajó a {saldo}.",
    {
      marcadores: ["n", "fecha", "medio", "importe", "cliente", "saldo"],
      largoMaximo: 120,
    },
    "detalleDelCobrado",
  ),
  "cuenta_corriente.cobro.sin_caja": texto(
    "Sin caja abierta hoy no se puede cobrar: abrí una caja. Con la jornada en auditoría o cerrada, el cobro se rechaza.",
    { largoMaximo: 120 },
  ),
  "cuenta_corriente.cobro.ver_cuenta": texto("Ver la cuenta del cliente"),
  "cuenta_corriente.cobro.cobrar_otro": texto("Cobrar otro ticket"),
  // El botón de la ficha del cliente lo resuelve el archivo de textos de la cuenta corriente, no el de esta pantalla.
  "cuenta_corriente.cobro.boton_de_la_ficha": {
    porDefecto: "Cobrar un ticket",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/cuenta-corriente/textos-de-cuenta-corriente.ts",
        nombre: "textosDeCuentaCorriente",
      },
    ] as const,
    fuente: FUENTE,
  },
} as const;
