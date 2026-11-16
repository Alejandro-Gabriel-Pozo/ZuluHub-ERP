"use client";

import { useActionState, useState } from "react";
import { REGLA_DE_CANTIDAD } from "../../../../../src/capacidades/experiencia/cantidad-tipeada";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { CampoNumero } from "../../componentes/CampoNumero";
import { Casilla } from "../../componentes/Casilla";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import estilos from "./FormularioDeConsumoDeUnGrupo.module.css";
import type { ConsumoArmado, LineaArmada } from "./modelo-de-consumo";

export type PropsDeFormularioDeConsumoDeUnGrupo = Readonly<{
  consumo: ConsumoArmado;
  /** La acción de servidor (`guardarConsumoAccion` ya ligada al producto, a la versión, al grupo y a las opciones que se vieron). */
  accion: AccionDeFormulario;
  /** Si el servidor deja guardar hoy: si no, «Guardar» sale apagado (solo una ayuda: el guard decide; DEC-0346). */
  puedeGuardar: boolean;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * Lo que consume cada opción de un grupo (maqueta `productos.html`, función `vConsumo`, «Qué consume»): una tarjeta por opción con sus líneas (insumo, cantidad en la unidad del insumo y, si el
 * producto tiene medida, «Escala con la medida») y «Agregar insumo» / «Quitar». Es el conjunto FINAL de cada opción: lo que se quita, se quita. La validez la decide el servidor: acá no se
 * valida nada. El error sale debajo con el patrón común. La cantidad viaja como texto decimal canónico (`CampoNumero`, ADR-006). Repetir el envío no duplica: guardar el mismo consumo no escribe;
 * el botón solo ignora el segundo toque.
 */
export function FormularioDeConsumoDeUnGrupo({
  consumo,
  accion,
  puedeGuardar,
}: PropsDeFormularioDeConsumoDeUnGrupo) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [lineas, setLineas] = useState(
    consumo.opciones.map((o): readonly LineaArmada[] => o.filas),
  );
  const [siguiente, setSiguiente] = useState(consumo.siguienteLinea);

  const cambiar = (opcion: number, clave: string, cambio: Partial<LineaArmada>) => {
    setLineas((actuales) =>
      actuales.map((filas, i) =>
        i === opcion ? filas.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)) : filas,
      ),
    );
  };
  const primero = consumo.insumos[0]?.valor ?? "";

  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <h2 className={estilos["titulo"]}>{consumo.titulo}</h2>
          {consumo.opciones.map((opcion) => (
            <section key={opcion.indice} className={estilos["opcion"]} aria-label={opcion.nombre}>
              <strong>{opcion.nombre}</strong>
              {(lineas[opcion.indice] ?? []).map((fila) => (
                <div key={fila.clave} className={estilos["linea"]}>
                  <Selector
                    dato="insumo-de-consumo-de-opcion"
                    etiqueta={consumo.textos.insumo}
                    nombre={`consumo_${String(opcion.indice)}_${fila.clave}_insumo`}
                    valor={fila.insumoId}
                    alCambiar={(valor) => {
                      cambiar(opcion.indice, fila.clave, { insumoId: valor });
                    }}
                    opciones={consumo.insumos}
                  />
                  <CampoNumero
                    dato="cantidad-de-consumo-de-opcion"
                    etiqueta={`${consumo.textos.cantidad} (${consumo.unidades[fila.insumoId] ?? ""})`}
                    nombre={`consumo_${String(opcion.indice)}_${fila.clave}_cantidad`}
                    valor={fila.cantidad}
                    alCambiar={(valor) => {
                      cambiar(opcion.indice, fila.clave, { cantidad: valor });
                    }}
                    regla={REGLA_DE_CANTIDAD}
                  />
                  {consumo.tieneMedida ? (
                    <Casilla
                      dato="escala-con-la-medida-de-consumo"
                      etiqueta={consumo.textos.escala}
                      nombre={`consumo_${String(opcion.indice)}_${fila.clave}_escala`}
                      marcada={fila.escala}
                      alCambiar={(marcada) => {
                        cambiar(opcion.indice, fila.clave, { escala: marcada });
                      }}
                    />
                  ) : null}
                  <Boton
                    variante="secundaria"
                    alTocar={() => {
                      setLineas((actuales) =>
                        actuales.map((filas, i) =>
                          i === opcion.indice ? filas.filter((f) => f.clave !== fila.clave) : filas,
                        ),
                      );
                    }}
                  >
                    {consumo.textos.quitar}
                  </Boton>
                </div>
              ))}
              <div>
                <Boton
                  variante="secundaria"
                  deshabilitado={primero === ""}
                  alTocar={() => {
                    setLineas((actuales) =>
                      actuales.map((filas, i) =>
                        i === opcion.indice
                          ? [
                              ...filas,
                              {
                                clave: `l${String(siguiente)}`,
                                insumoId: primero,
                                cantidad: "",
                                escala: false,
                              },
                            ]
                          : filas,
                      ),
                    );
                    setSiguiente(siguiente + 1);
                  }}
                >
                  {consumo.textos.agregar}
                </Boton>
              </div>
            </section>
          ))}
          {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
          {puedeGuardar ? (
            <BotonDeEnvio>{consumo.textos.guardar}</BotonDeEnvio>
          ) : (
            <Boton deshabilitado>{consumo.textos.guardar}</Boton>
          )}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
