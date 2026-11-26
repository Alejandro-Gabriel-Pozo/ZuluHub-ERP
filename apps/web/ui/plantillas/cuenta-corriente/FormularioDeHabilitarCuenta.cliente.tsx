"use client";

import { useState } from "react";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { CampoImporte } from "../../componentes/CampoImporte";
import { CampoNumero } from "../../componentes/CampoNumero";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import estilos from "./CuentaCorriente.module.css";

type ClienteParaElegir = Readonly<{
  parteId: string;
  /** Lo que se ve en la lista: el nombre y el CUIT («Turismo Andino S. A. · 30-68901234-5»). */
  etiqueta: string;
  /** Solo el nombre (la razón social que se ve al elegirlo). */
  nombre: string;
  /** `false`: no tiene CUIT cargado; se avisa y «Habilitar» queda apagado (el servidor igual lo rechaza). */
  tieneCuit: boolean;
}>;

export type PropsDeFormularioDeHabilitarCuenta = Readonly<{
  /** La acción de servidor con el identificador del alta ya ligado (`bind`): repetir el envío no duplica la ficha. */
  accion: AccionDeFormulario;
  textos: Readonly<{
    cliente: string;
    elegirCliente: string;
    razonSocial: string;
    plazo: string;
    limite: string;
    faltaElCuit: string;
    faltaElCuitDetalle: string;
    habilitar: string;
    cancelar: string;
  }>;
  clientes: readonly ClienteParaElegir[];
  /** Los dígitos que deja escribir el plazo (salen del máximo del dominio, que da la página). */
  digitosDelPlazo: number;
  /** Adónde vuelve «Cancelar»: el listado. Es un enlace: cancelar no manda nada. */
  hrefDeCancelar: string;
  puedeGuardar: boolean;
}>;

/**
 * Habilitar la cuenta corriente de un cliente (CC-5, A2; maqueta `cuenta-corriente-ficha-listado-y-cobro.html`, «Habilitar cuenta»): se elige un cliente activo sin cuenta, se ve su razón social, y se cargan el
 * plazo y el límite. Un cliente sin CUIT se puede elegir para ver POR QUÉ no se puede: aparece el aviso y «Habilitar» queda apagado. Que el cliente esté activo, tenga CUIT y razón social y no tenga ya una ficha,
 * y que el plazo y el límite sean válidos, lo decide el servidor al enviar: la pantalla no replica esas reglas. Sin pie explicativo. Sin permiso, sin elegir o con algún dato vacío, «Habilitar» sale apagado.
 */
export function FormularioDeHabilitarCuenta({
  accion,
  textos,
  clientes,
  digitosDelPlazo,
  hrefDeCancelar,
  puedeGuardar,
}: PropsDeFormularioDeHabilitarCuenta) {
  const [parteId, setParteId] = useState("");
  const [plazo, setPlazo] = useState("");
  const [limite, setLimite] = useState("");
  const elegido = clientes.find((c) => c.parteId === parteId);
  const sePuede =
    puedeGuardar && elegido !== undefined && elegido.tieneCuit && plazo !== "" && limite !== "";
  return (
    <FormularioDeAccion accion={accion}>
      <Selector
        dato="cliente-a-habilitar-de-cuenta-corriente"
        etiqueta={textos.cliente}
        nombre="parteId"
        valor={parteId}
        alCambiar={setParteId}
        textoDeElegir={textos.elegirCliente}
        opciones={clientes.map((c) => ({ valor: c.parteId, etiqueta: c.etiqueta }))}
      />
      {elegido === undefined ? null : (
        <div className={estilos["dato"]}>
          <span>{textos.razonSocial}</span>
          <span>{elegido.nombre}</span>
        </div>
      )}
      {elegido === undefined || elegido.tieneCuit ? null : (
        <Aviso tono="aviso">
          <strong>{textos.faltaElCuit}</strong> {textos.faltaElCuitDetalle}
        </Aviso>
      )}
      <CampoNumero
        dato="plazo-de-cuenta-corriente"
        etiqueta={textos.plazo}
        nombre="plazoDias"
        valor={plazo}
        alCambiar={setPlazo}
        regla={{ decimales: 0, enterosMaximos: digitosDelPlazo }}
      />
      <CampoImporte
        dato="limite-de-cuenta-corriente"
        etiqueta={textos.limite}
        nombre="limite"
        valor={limite}
        alCambiar={setLimite}
      />
      <div className={estilos["acciones"]}>
        <a className={estilos["secundario"]} href={hrefDeCancelar}>
          {textos.cancelar}
        </a>
        {sePuede ? (
          <BotonDeEnvio>{textos.habilitar}</BotonDeEnvio>
        ) : (
          <Boton deshabilitado>{textos.habilitar}</Boton>
        )}
      </div>
    </FormularioDeAccion>
  );
}
