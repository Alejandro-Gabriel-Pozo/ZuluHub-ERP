"use client";

import { Campo } from "../../componentes/Campo";
import { CampoDeDocumento } from "../../componentes/CampoDeDocumento";
import { Selector } from "../../componentes/Selector";
import estilos from "./Cobrar.module.css";
import {
  textoDelErrorDeDato,
  type DatoDelMedio,
  type DatosEscritos,
  type DatosQuePideElMedio,
  type EstadoDeUnaFila,
} from "./modelo-de-cobro";
import { rotuloDeUnDato, type TextosDeCobrar } from "./textos-de-cobrar";

export type PropsDeDatosDelMedio = Readonly<{
  /** Qué datos admite el medio: lo que el servidor habilitó (nace todo cerrado). Lo que no admite no se dibuja. */
  admite: DatosQuePideElMedio;
  datos: DatosEscritos;
  errores: EstadoDeUnaFila["erroresDeDatos"];
  marcas: readonly Readonly<{ id: string; nombre: string }>[];
  textos: TextosDeCobrar;
  alCambiar: (dato: DatoDelMedio, valor: string) => void;
  deshabilitado: boolean;
}>;

/**
 * Los datos opcionales de un cobro con tarjeta o transferencia (decisión 129; maqueta `datos-cobro.html`): cupón, últimos 4 dígitos, marca y cuotas con débito o crédito, y DNI con transferencia.
 * Solo se dibuja lo que el medio admite. Todos son opcionales: vacío es válido y nunca bloquea; un dato mal escrito se dice debajo del campo (y «Cobrar» queda apagado hasta corregirlo o vaciarlo).
 * Cada campo valida con la regla de su primitiva (`modelo-de-cobro.ts`); el servidor vuelve a validar todo. Ningún campo recorta lo que se escribe: avisa con el error aprobado.
 */
export function DatosDelMedio({
  admite,
  datos,
  errores,
  marcas,
  textos,
  alCambiar,
  deshabilitado,
}: PropsDeDatosDelMedio) {
  const rotulo = (dato: string) => rotuloDeUnDato(dato, textos.opcional);
  const error = (dato: DatoDelMedio): string | undefined => {
    const e = errores[dato];
    return e === undefined ? undefined : textoDelErrorDeDato(e);
  };
  return (
    <div className={estilos["datos"]}>
      {admite.cupon ? (
        <Campo
          dato="cupon-del-cobro"
          etiqueta={rotulo(textos.cupon)}
          autoComplete="off"
          autoCapitalize="off"
          valor={datos.cupon}
          alCambiar={(v) => {
            alCambiar("cupon", v);
          }}
          error={error("cupon")}
          deshabilitado={deshabilitado}
        />
      ) : null}
      {admite.ultimos4 ? (
        <Campo
          dato="ultimos-cuatro-del-cobro"
          etiqueta={rotulo(textos.ultimos4)}
          autoComplete="off"
          inputMode="numeric"
          valor={datos.ultimos4}
          alCambiar={(v) => {
            alCambiar("ultimos4", v);
          }}
          error={error("ultimos4")}
          deshabilitado={deshabilitado}
        />
      ) : null}
      {admite.marca ? (
        <Selector
          dato="marca-de-tarjeta-del-cobro"
          etiqueta={rotulo(textos.marca)}
          textoDeElegir={textos.sinElegir}
          valor={datos.marca}
          alCambiar={(v) => {
            alCambiar("marca", v);
          }}
          opciones={marcas.map((m) => ({ valor: m.id, etiqueta: m.nombre }))}
          deshabilitado={deshabilitado}
        />
      ) : null}
      {admite.cuotas ? (
        <Campo
          dato="cuotas-del-cobro"
          etiqueta={rotulo(textos.cuotas)}
          autoComplete="off"
          inputMode="numeric"
          valor={datos.cuotas}
          alCambiar={(v) => {
            alCambiar("cuotas", v);
          }}
          error={error("cuotas")}
          deshabilitado={deshabilitado}
        />
      ) : null}
      {admite.dni ? (
        <CampoDeDocumento
          dato="dni-del-cobro"
          etiqueta={rotulo(textos.dni)}
          tipo="DNI"
          valor={datos.dni}
          alCambiar={(v) => {
            alCambiar("dni", v);
          }}
          error={error("dni")}
          deshabilitado={deshabilitado}
        />
      ) : null}
    </div>
  );
}
