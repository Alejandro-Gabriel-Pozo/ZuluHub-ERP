"use client";

import { useActionState, useEffect, useState } from "react";
import { AreaDeTexto } from "../../../componentes/AreaDeTexto";
import { Boton } from "../../../componentes/Boton.cliente";
import { Campo } from "../../../componentes/Campo";
import { Selector } from "../../../componentes/Selector";
import { ProveedorDeEnvioDeFormulario } from "../../../patrones/EnvioDeFormulario.cliente";
import { ErrorDeRespuesta } from "../../../patrones/ErrorDeRespuesta";
import { Pila } from "../../../primitivas/Pila";
import { Texto } from "../../../primitivas/Texto";
import { DECLARAR_PAGO_INICIAL, type ResultadoDeDeclararPago } from "./resultado-de-pago";
import { MEDIOS_PARA_ELEGIR, pagoListo, type MedioDePago } from "./modelo-de-pago";
import { sinReiniciar } from "../../../patrones/sin-reinicio";

export type PropsDeFormularioDeDeclararPago = Readonly<{
  /** `declararElPagoAccion` con la factura, la compra y la clave de este intento ya ligadas (`.bind`): no viajan en el formulario. */
  accion: (previo: ResultadoDeDeclararPago, datos: FormData) => Promise<ResultadoDeDeclararPago>;
  /** El total de la factura, ya con formato («$ 2.420,00»): lo muestra, no se escribe. El servidor lo copia del comprobante. */
  importe: string;
  /** La fecha de hoy en Argentina (`AAAA-MM-DD`), que fija el servidor: es el valor inicial y el tope de la fecha. */
  hoy: string;
  /** Las cajas abiertas de la sucursal; con efectivo se elige una. */
  cajas: readonly Readonly<{ cajaId: string; nombre: string }>[];
  textos: Readonly<{
    importe: string;
    fecha: string;
    medio: string;
    caja: string;
    motivo: string;
    sinElegir: string;
    declararPago: string;
    /** El texto de cada medio de pago. */
    medios: Readonly<Record<MedioDePago, string>>;
  }>;
}>;

/**
 * «Declarar pago» (maqueta `compra-pago.html`, estado «Declarar pago»): el importe fijo (el total de la factura, que NO se escribe), la fecha (hoy), el medio («Sin elegir») y, solo con efectivo, la caja de la que
 * sale la plata y el motivo del egreso. El botón queda apagado hasta tener lo necesario y no se vuelve a tocar mientras envía (`Boton` con `enviando`); repetir el envío es seguro en el servidor: la clave de este
 * intento repite el mismo pago sin escribir ni sacar la plata dos veces. Si salió bien navega a la ficha, que ya muestra el pago; si no, el error ya traducido (el genérico) queda debajo. Mostrar no es autorizar:
 * el servidor decide si se puede (fecha no futura, caja abierta, factura sin pago).
 */
export function FormularioDeDeclararPago({
  accion,
  importe,
  hoy,
  cajas,
  textos,
}: PropsDeFormularioDeDeclararPago) {
  const [fecha, setFecha] = useState(hoy);
  const [medio, setMedio] = useState("");
  const [cajaId, setCajaId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [resultado, enviar, enviando] = useActionState(accion, DECLARAR_PAGO_INICIAL);
  const ruta = resultado.estado === "HECHO" ? resultado.ruta : null;
  useEffect(() => {
    if (ruta !== null) window.location.assign(ruta);
  }, [ruta]);
  const conEfectivo = medio === "EFECTIVO";
  return (
    <form action={enviar} onReset={sinReiniciar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <Texto>
            {textos.importe}: {importe}
          </Texto>
          <Campo
            dato="fecha-de-pago-de-compra"
            etiqueta={textos.fecha}
            nombre="fecha"
            tipo="date"
            maximo={hoy}
            valor={fecha}
            alCambiar={setFecha}
          />
          <Selector
            dato="medio-de-pago-de-compra"
            etiqueta={textos.medio}
            nombre="medio"
            valor={medio}
            alCambiar={setMedio}
            textoDeElegir={textos.sinElegir}
            opciones={MEDIOS_PARA_ELEGIR.map((m) => ({ valor: m, etiqueta: textos.medios[m] }))}
          />
          {conEfectivo ? (
            <>
              <Selector
                dato="caja-de-pago-de-compra"
                etiqueta={textos.caja}
                nombre="cajaId"
                valor={cajaId}
                alCambiar={setCajaId}
                textoDeElegir={textos.sinElegir}
                opciones={cajas.map((c) => ({ valor: c.cajaId, etiqueta: c.nombre }))}
              />
              <AreaDeTexto
                dato="motivo-de-egreso-de-compra"
                etiqueta={textos.motivo}
                nombre="motivo"
                valor={motivo}
                alCambiar={setMotivo}
              />
            </>
          ) : null}
          {resultado.estado === "ERROR" ? <ErrorDeRespuesta error={resultado.error} /> : null}
          <Boton
            tipo="submit"
            enviando={enviando || ruta !== null}
            deshabilitado={!pagoListo({ fecha, medio, cajaId, motivo })}
          >
            {textos.declararPago}
          </Boton>
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
