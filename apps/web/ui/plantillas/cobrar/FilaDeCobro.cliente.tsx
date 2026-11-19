"use client";

import { Boton } from "../../componentes/Boton.cliente";
import { CampoImporte } from "../../componentes/CampoImporte";
import { Selector } from "../../componentes/Selector";
import estilos from "./Cobrar.module.css";
import { DatosDelMedio } from "./DatosDelMedio.cliente";
import {
  cambiarDeMedio,
  cambiarUnDato,
  nombreDelMedio,
  type EstadoDeUnaFila,
  type MedioParaCobrar,
  type OpcionesParaCobrar,
  type PagoEnEdicion,
} from "./modelo-de-cobro";
import { type TextosDeCobrar } from "./textos-de-cobrar";

export type PropsDeFilaDeCobro = Readonly<{
  pago: PagoEnEdicion;
  estado: EstadoDeUnaFila;
  opciones: OpcionesParaCobrar;
  textos: TextosDeCobrar;
  alCambiar: (pago: PagoEnEdicion) => void;
  /** `null` en la primera fila: siempre hay al menos un cobro. */
  alQuitar: (() => void) | null;
  deshabilitado: boolean;
}>;

/**
 * Una fila de la hoja de cobro (maqueta `venta-rapida-v4.html`): el medio y el importe lado a lado, debajo la cuenta de cobro (solo si el medio tiene cuentas; es opcional, decisión 151) y, si el medio
 * los admite, los datos opcionales. Solo ofrece lo que el servidor ofreció: medios activos, cuentas de la sucursal y marcas activas; no replica ninguna regla de negocio.
 */
export function FilaDeCobro({
  pago,
  estado,
  opciones,
  textos,
  alCambiar,
  alQuitar,
  deshabilitado,
}: PropsDeFilaDeCobro) {
  const medio: MedioParaCobrar | undefined = opciones.medios.find((m) => m.id === pago.medioId);
  return (
    <div className={estilos["fila"]}>
      <div className={estilos["medioEImporte"]}>
        <Selector
          dato="medio-de-cobro"
          etiqueta={textos.medio}
          valor={pago.medioId}
          alCambiar={(id) => {
            const nuevo = opciones.medios.find((m) => m.id === id);
            if (nuevo !== undefined) alCambiar(cambiarDeMedio(pago, nuevo));
          }}
          opciones={opciones.medios.map((m) => ({ valor: m.id, etiqueta: nombreDelMedio(m) }))}
          deshabilitado={deshabilitado}
        />
        <CampoImporte
          dato="importe-de-cobro"
          etiqueta={textos.importe}
          valor={pago.importe}
          alCambiar={(importe) => {
            alCambiar({ ...pago, importe, tocado: true });
          }}
          error={pago.tocado && estado.importeNoValido ? textos.importeNoValido : undefined}
          deshabilitado={deshabilitado}
        />
      </div>
      {medio === undefined || medio.cuentas.length === 0 ? null : (
        <Selector
          dato="cuenta-de-cobro"
          etiqueta={textos.cuentaDeCobro}
          textoDeElegir={textos.sinElegir}
          valor={pago.cuentaId}
          alCambiar={(cuentaId) => {
            alCambiar({ ...pago, cuentaId });
          }}
          opciones={medio.cuentas.map((c) => ({ valor: c.id, etiqueta: c.nombre }))}
          deshabilitado={deshabilitado}
        />
      )}
      {medio === undefined ? null : (
        <DatosDelMedio
          admite={medio.datosQuePide}
          datos={pago.datos}
          errores={estado.erroresDeDatos}
          marcas={opciones.marcasDeTarjeta}
          textos={textos}
          alCambiar={(dato, valor) => {
            alCambiar(cambiarUnDato(pago, dato, valor));
          }}
          deshabilitado={deshabilitado}
        />
      )}
      {alQuitar === null ? null : (
        <div className={estilos["quitar"]}>
          <Boton variante="secundaria" alTocar={alQuitar} deshabilitado={deshabilitado}>
            {textos.quitar}
          </Boton>
        </div>
      )}
    </div>
  );
}
