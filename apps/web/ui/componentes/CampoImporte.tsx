import type { DatoDeCampo } from "../../../../src/capacidades/datos/registro";
import { REGLA_DE_IMPORTE } from "../../../../src/capacidades/experiencia/importe-tipeado";
import { CampoNumero } from "./CampoNumero";

export type PropsDeCampoImporte = Readonly<{
  /** Qué dato pide el campo: un `IdDeDato` del registro de datos o `"pendiente"` (deuda registrada). Obligatorio: sin dato no hay campo. */
  dato: DatoDeCampo;
  etiqueta: string;
  /**
   * El importe como TEXTO decimal canónico (`"1234.50"`), o `""` si no hay nada. Nunca un `number`:
   * lo que entrega este campo y lo que viaja al servidor es texto (ADR-006, [A006]).
   */
  valor: string;
  alCambiar: (valor: string) => void;
  /** Si está, el campo va dentro de un `<form>` con un `<input type="hidden">` que lleva el texto canónico. */
  nombre?: string | undefined;
  /** El símbolo que se ve antes del importe. Es adorno: la etiqueta ya dice que es dinero. */
  simbolo?: string | undefined;
  obligatorio?: string | undefined;
  ayuda?: string | undefined;
  error?: string | undefined;
  deshabilitado?: boolean;
}>;

/**
 * Importe en pesos: un `CampoNumero` con la regla del dinero (v1 solo `ARS`, 2 decimales, siempre completos). El campo muestra
 * `1.234,50`; la frontera entrega `"1234.50"`.
 */
export function CampoImporte({ simbolo = "$", ...resto }: PropsDeCampoImporte) {
  return <CampoNumero {...resto} simbolo={simbolo} regla={REGLA_DE_IMPORTE} />;
}
