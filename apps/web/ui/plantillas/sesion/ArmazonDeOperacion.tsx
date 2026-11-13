import type { ReactNode } from "react";
import { destinosDeOperacion } from "../../../../../src/capacidades/experiencia/destinos";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { ClaveDeIcono } from "../../iconos/catalogo";
import type { ClaveDeArea, ClaveDeFila } from "../../navegacion/menu";
import { FranjaSinConexion } from "../../patrones/FranjaSinConexion.cliente";
import { IndicadorDeSesion } from "../../patrones/IndicadorDeSesion.cliente";
import {
  PlantillaOperacion,
  type DestinoDeOperacion,
  type PropsDePlantillaOperacion,
} from "../PlantillaOperacion";
import { BarraSuperior } from "./BarraSuperior";

/**
 * La clave de un destino del menú: la de su pantalla (un área con una sola pantalla va directo a ella) o la de su área (con varias, se
 * abre su hoja). Así la pantalla de ese destino lo marca como actual. Salen de la tabla del menú (`navegacion/menu.ts`), no se repiten a mano.
 */
type ClaveDeModulo = ClaveDeFila | ClaveDeArea;

/** Un destino del menú en la barra inferior: un área con lo que la persona puede ver hoy. Con `hoja`, reúne varias pantallas. */
export type DestinoDeModulo = Readonly<{
  clave: ClaveDeModulo;
  href: string;
  /** El texto del destino, ya resuelto. */
  etiqueta: string;
  icono: ClaveDeIcono;
  /** Las pantallas del área, por grupo, cuando son varias; las claves son las de sus pantallas. */
  hoja?: readonly Readonly<{
    etiqueta: string | null;
    enlaces: readonly Readonly<{ clave: ClaveDeFila; etiqueta: string; href: string }>[];
  }>[];
}>;

/** Cuál de los destinos de la barra es el de esta pantalla: uno de los fijos o el de su módulo. */
export type DestinoActual = "inicio" | "empresa" | "cuenta" | ClaveDeModulo;

export type PropsDeArmazonDeOperacion = Readonly<{
  titulo: string;
  /** Cuál de los destinos es el de esta pantalla; ninguno si no está en la barra. */
  actual?: DestinoActual;
  marca: string;
  empresa: string;
  /** Los destinos de los módulos habilitados (en v1, ninguno). */
  modulos?: readonly DestinoDeModulo[];
  diccionario?: DiccionarioResuelto;
  children: ReactNode;
}>;

/**
 * El armazón de operación de la aplicación en el celular (armazón web §1.1 «Layout de celular»): la barra
 * de arriba (marca, empresa, cambio de empresa y estado de la sesión), el contenido, la franja de «sin
 * conexión» y la barra inferior con 3 a 5 destinos. Operación y administración son DOS armazones: este es el
 * de operación; el de administración llega con las pantallas de H6.
 */
export function ArmazonDeOperacion({
  titulo,
  actual,
  marca,
  empresa,
  modulos = [],
  diccionario = {},
  children,
}: PropsDeArmazonDeOperacion) {
  const fijo = (
    clave: DestinoActual,
    icono: ClaveDeIcono,
    etiqueta: Parameters<typeof texto>[1],
    href: string,
  ): DestinoDeOperacion => ({
    etiqueta: texto(diccionario, etiqueta),
    icono,
    href,
    actual: actual === clave,
  });
  const destinos = destinosDeOperacion<DestinoDeOperacion>({
    inicio: fijo("inicio", "inicio", "navegacion.inicio", "/"),
    empresa: fijo("empresa", "empresa", "navegacion.empresa", "/empresa"),
    cuenta: fijo("cuenta", "cuenta", "navegacion.cuenta", "/cuenta"),
    modulos: modulos.map((m) => ({
      etiqueta: m.etiqueta,
      icono: m.icono,
      href: m.href,
      actual:
        actual === m.clave ||
        (m.hoja?.some((g) => g.enlaces.some((e) => e.clave === actual)) ?? false),
      ...(m.hoja === undefined
        ? {}
        : {
            hoja: m.hoja.map((g) => ({
              etiqueta: g.etiqueta,
              enlaces: g.enlaces.map((e) => ({
                etiqueta: e.etiqueta,
                href: e.href,
                actual: actual === e.clave,
              })),
            })),
          }),
    })),
  });
  return (
    <PlantillaOperacion
      titulo={titulo}
      etiquetaDeNavegacion={texto(diccionario, "navegacion.etiqueta")}
      textoDeSalto={texto(diccionario, "navegacion.saltar")}
      // `destinosDeOperacion` devuelve siempre de 3 a 5 (lo prueba su propiedad); la plantilla lo exige por tipo.
      destinos={destinos as PropsDePlantillaOperacion["destinos"]}
      franjas={<FranjaSinConexion texto={texto(diccionario, "conexion.sin_conexion")} />}
      barraSuperior={
        <BarraSuperior
          marca={marca}
          empresa={empresa}
          hrefDeCambiarEmpresa="/empresa"
          indicadorDeSesion={<IndicadorDeSesion diccionario={diccionario} />}
          diccionario={diccionario}
        />
      }
    >
      {children}
    </PlantillaOperacion>
  );
}
