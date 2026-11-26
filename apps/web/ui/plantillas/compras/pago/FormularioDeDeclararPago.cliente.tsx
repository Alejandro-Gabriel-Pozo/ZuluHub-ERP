"use client";

import { useActionState, useEffect, useState } from "react";
import { AreaDeTexto } from "../../../componentes/AreaDeTexto";
import { Boton } from "../../../componentes/Boton.cliente";
import { Campo } from "../../../componentes/Campo";
import { CampoImporte } from "../../../componentes/CampoImporte";
import { Selector } from "../../../componentes/Selector";
import { ProveedorDeEnvioDeFormulario } from "../../../patrones/EnvioDeFormulario.cliente";
import { ErrorDeRespuesta } from "../../../patrones/ErrorDeRespuesta";
import { Pila } from "../../../primitivas/Pila";
import { Texto } from "../../../primitivas/Texto";
import { DECLARAR_PAGO_INICIAL, type ResultadoDeDeclararPago } from "./resultado-de-pago";
import {
  hayEfectivo,
  mediosParaLaFila,
  pagoListo,
  sePuedeAgregarUnMedio,
  type FilaDeMedio,
  type MedioDePago,
} from "./modelo-de-pago";
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
    /** «Agregar medio» y «Quitar»: suman y sacan filas de medio. */
    agregarMedio: string;
    quitar: string;
    /** El texto de cada medio de pago. */
    medios: Readonly<Record<MedioDePago, string>>;
  }>;
}>;

/**
 * «Declarar pago» (maqueta `compra-pago.html`, estado «Declarar pago»): el importe fijo (el total de la factura, que NO se escribe), la fecha (hoy), el medio («Sin elegir») y, solo con efectivo, la caja de la que
 * sale la plata y el motivo del egreso. «Agregar medio» suma una fila (hasta uno de cada tipo): con varias filas cada una dice cuánto paga y el servidor comprueba que la suma sea el total (DEC-1280); con una sola,
 * el medio lleva el total y no hay importe que escribir. El botón queda apagado hasta tener lo necesario y no se vuelve a tocar mientras envía (`Boton` con `enviando`); repetir el envío es seguro en el servidor: la clave de este
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
  const [filas, setFilas] = useState<readonly FilaDeMedio[]>([{ id: 0, medio: "", importe: "" }]);
  const [siguiente, setSiguiente] = useState(1);
  const [cajaId, setCajaId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [resultado, enviar, enviando] = useActionState(accion, DECLARAR_PAGO_INICIAL);
  const ruta = resultado.estado === "HECHO" ? resultado.ruta : null;
  useEffect(() => {
    if (ruta !== null) window.location.assign(ruta);
  }, [ruta]);
  const conEfectivo = hayEfectivo(filas);
  const cambiarFila = (id: number, cambio: Partial<Omit<FilaDeMedio, "id">>) => {
    setFilas((actuales) => actuales.map((f) => (f.id === id ? { ...f, ...cambio } : f)));
  };
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
          {filas.map((fila, i) => (
            <Pila key={fila.id} separacion={2}>
              <Selector
                dato="medio-de-pago-de-compra"
                etiqueta={textos.medio}
                nombreAccesible={filas.length > 1 ? `${textos.medio} ${String(i + 1)}` : undefined}
                nombre="medio"
                valor={fila.medio}
                alCambiar={(medio) => {
                  cambiarFila(fila.id, { medio });
                }}
                textoDeElegir={textos.sinElegir}
                opciones={mediosParaLaFila(filas, fila).map((m) => ({
                  valor: m,
                  etiqueta: textos.medios[m],
                }))}
              />
              {filas.length > 1 ? (
                <>
                  <CampoImporte
                    dato="importe-de-medio-de-pago-de-compra"
                    etiqueta={`${textos.importe} ${String(i + 1)}`}
                    nombre="importe"
                    valor={fila.importe}
                    alCambiar={(importe) => {
                      cambiarFila(fila.id, { importe });
                    }}
                  />
                  <Boton
                    variante="secundaria"
                    alTocar={() => {
                      setFilas((actuales) => actuales.filter((f) => f.id !== fila.id));
                    }}
                  >
                    {textos.quitar}
                  </Boton>
                </>
              ) : null}
            </Pila>
          ))}
          {sePuedeAgregarUnMedio(filas) ? (
            <Boton
              variante="secundaria"
              alTocar={() => {
                setFilas((actuales) => [...actuales, { id: siguiente, medio: "", importe: "" }]);
                setSiguiente(siguiente + 1);
              }}
            >
              {textos.agregarMedio}
            </Boton>
          ) : null}
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
            deshabilitado={!pagoListo({ fecha, filas, cajaId, motivo })}
          >
            {textos.declararPago}
          </Boton>
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
