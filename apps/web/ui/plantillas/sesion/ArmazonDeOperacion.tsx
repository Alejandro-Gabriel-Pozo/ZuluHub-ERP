import type { ReactNode } from "react";
import { destinosDeOperacion } from "../../../../../src/capacidades/experiencia/destinos";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { ClaveDeIcono } from "../../iconos/catalogo";
import { FranjaSinConexion } from "../../patrones/FranjaSinConexion.cliente";
import { IndicadorDeSesion } from "../../patrones/IndicadorDeSesion.cliente";
import {
  PlantillaOperacion,
  type DestinoDeOperacion,
  type PropsDePlantillaOperacion,
} from "../PlantillaOperacion";
import { BarraSuperior } from "./BarraSuperior";

/** Un destino que suma un módulo habilitado a la barra inferior (las entradas las llenan los otros tramos). */
export type DestinoDeModulo = Readonly<{
  href: string;
  /** El texto del destino, ya resuelto. */
  etiqueta: string;
  icono: ClaveDeIcono;
}>;

/** Los destinos fijos y los módulos con pantalla (`facturacion`): un módulo no marca ningún destino fijo como actual. */
export type DestinoActual = "inicio" | "empresa" | "cuenta" | "facturacion";

export type PropsDeArmazonDeOperacion = Readonly<{
  titulo: string;
  /** Cuál de los destinos fijos es el de esta pantalla; ninguno si es la de un módulo. */
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
    modulos: modulos.map((m) => ({ etiqueta: m.etiqueta, icono: m.icono, href: m.href })),
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
