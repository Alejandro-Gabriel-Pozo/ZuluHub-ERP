import {
  CATALOGO_DE_ICONOS,
  TAMANOS_DE_ICONO,
  type ClaveDeIcono,
  type TamanoDeIcono,
} from "./catalogo";

type Base = Readonly<{
  clave: ClaveDeIcono;
  tamano?: TamanoDeIcono;
}>;

/**
 * Un ícono dice algo o es adorno, y hay que elegir: o lleva `etiqueta` (su nombre accesible) o se
 * declara `decorativo` (junto a un texto que ya lo dice). No se puede omitir las dos cosas: un ícono
 * sin nombre accesible no compila ([02] §4.3).
 */
export type PropsDeIcono =
  | (Base & Readonly<{ etiqueta: string; decorativo?: never }>)
  | (Base & Readonly<{ decorativo: true; etiqueta?: never }>);

export function Icono(props: PropsDeIcono) {
  const Dibujo = CATALOGO_DE_ICONOS[props.clave];
  const lado = TAMANOS_DE_ICONO[props.tamano ?? "medio"];
  if (props.decorativo === true) {
    return <Dibujo size={lado} strokeWidth={2} aria-hidden="true" focusable="false" />;
  }
  return (
    <Dibujo size={lado} strokeWidth={2} role="img" aria-label={props.etiqueta} focusable="false" />
  );
}
