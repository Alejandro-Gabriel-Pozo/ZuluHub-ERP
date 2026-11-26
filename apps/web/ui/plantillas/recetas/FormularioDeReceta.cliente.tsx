"use client";

import { useRef, useState } from "react";
import {
  REGLA_DE_CANTIDAD,
  REGLA_DE_MERMA,
} from "../../../../../src/capacidades/experiencia/reglas-de-cantidad";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { CampoNumero } from "../../componentes/CampoNumero";
import { Selector } from "../../componentes/Selector";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import { Texto } from "../../primitivas/Texto";
import estilos from "./FormularioDeReceta.module.css";
import {
  armarLaConfirmacion,
  type FormularioArmado,
  type LineaDelFormulario,
  type VistaDeLaConfirmacion,
} from "./modelo-de-formulario-de-receta";

/** Lo que devuelve la acción de confirmar: el error ya traducido o lo que calculó el servidor (`null` si no se pudo calcular). */
export type ResultadoDeConfirmar = Readonly<
  { error: ErrorPublico } | { error: null; vista: VistaDeLaConfirmacion | null }
>;

export type PropsDeFormularioDeReceta = Readonly<{
  formulario: FormularioArmado;
  /** La acción de servidor de guardar (`guardarRecetaAccion` ya ligada al producto, a la versión que se vio y a las unidades). */
  accion: AccionDeFormulario;
  /** La acción de servidor que calcula la confirmación (`confirmarRecetaAccion` ya ligada igual); no guarda nada. */
  confirmar: (datos: FormData) => Promise<ResultadoDeConfirmar>;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/** ¿El texto decimal tiene algún dígito distinto de cero? («mayor que cero»: sin pasar por `Number`). */
const hayCantidad = (valor: string): boolean => /[1-9]/.test(valor);

/**
 * Crear una receta o guardar una versión nueva (maqueta `receta.html`, 15/11/2026, `vEditar` y confirmar). DOS PASOS en un mismo componente: lo que se escribe no viaja entre páginas. Paso 1: el
 * producto (solo al crear), el rinde, una tarjeta por ingrediente (bruto en la unidad del ingrediente, merma, «Quitar») y los pasos; «Guardar» pide la confirmación al servidor. Paso 2: la receta
 * final y, con `costos.ver`, «Costo antes / Costo ahora / Diferencia» calculados por el servidor; «Guardar como versión N» guarda y «Volver a editar» vuelve. Es el conjunto FINAL de ingredientes: lo
 * que se quita, se quita. La validez la decide el servidor: acá solo se apaga «Guardar» sin producto, sin rinde, sin ingredientes o con un bruto vacío o en cero (ayuda: el guard decide). Las cantidades
 * viajan como texto decimal canónico (`CampoNumero`, ADR-006). Repetir el envío no duplica: guardar el mismo contenido no crea otra versión; el botón solo ignora el segundo toque. Un rechazo
 * (otra persona guardó antes, sin permiso, merma con la perilla apagada…) sale como el genérico debajo y la persona vuelve a abrir la receta.
 */
export function FormularioDeReceta({ formulario, accion, confirmar }: PropsDeFormularioDeReceta) {
  const { textos } = formulario;
  const [errorDeGuardar, setErrorDeGuardar] = useState<ErrorPublico | null>(null);
  const [enviando, setEnviando] = useState(false);
  /** El segundo toque no manda un segundo envío: el estado se actualiza después del toque, la marca no. */
  const enCurso = useRef(false);
  const [paso, setPaso] = useState<"EDITAR" | "CONFIRMAR">("EDITAR");
  const [producto, setProducto] = useState(formulario.productoInicial);
  const [rinde, setRinde] = useState(formulario.rinde);
  const [pasos, setPasos] = useState(formulario.pasos);
  const [lineas, setLineas] = useState<readonly LineaDelFormulario[]>(formulario.lineas);
  const [siguiente, setSiguiente] = useState(formulario.siguienteLinea);
  const [aAgregar, setAAgregar] = useState("");
  const [vista, setVista] = useState<VistaDeLaConfirmacion | null>(null);
  const [errorDeLaVista, setErrorDeLaVista] = useState<ErrorPublico | null>(null);
  const [calculando, setCalculando] = useState(false);

  const enIngredientes = new Set(lineas.map((l) => l.ingredienteId));
  const disponibles = formulario.ofrecidos.filter((o) => !enIngredientes.has(o.valor));
  const sePuedeGuardar =
    (formulario.modo === "EDITAR" || producto !== "") &&
    hayCantidad(rinde) &&
    lineas.length > 0 &&
    lineas.every((l) => hayCantidad(l.bruto));

  const cambiar = (clave: string, cambio: Partial<LineaDelFormulario>) => {
    setLineas((actuales) => actuales.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));
  };

  /** Lo que viaja al servidor: el producto (solo al crear), el rinde, los pasos y las líneas con los nombres que la composición lee. */
  const datos = (): FormData => {
    const d = new FormData();
    if (formulario.modo === "NUEVA") d.set("producto", producto);
    d.set("rinde", rinde);
    d.set("pasos", pasos);
    for (const l of lineas) {
      d.set(`receta_${l.clave}_ingrediente`, l.ingredienteId);
      d.set(`receta_${l.clave}_bruto`, l.bruto);
      d.set(`receta_${l.clave}_merma`, l.merma);
    }
    return d;
  };

  /** Guarda. Si sale bien, el servidor redirige a la ficha (esta pantalla se va); si no, vuelve el error ya traducido y se queda con lo escrito. */
  const guardar = async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    setEnviando(true);
    setErrorDeGuardar(null);
    try {
      const r = await accion(SIN_ERROR, datos());
      setErrorDeGuardar(r.error);
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  };

  const pedirLaConfirmacion = async () => {
    setCalculando(true);
    setErrorDeLaVista(null);
    try {
      const r = await confirmar(datos());
      if (r.error !== null) {
        setErrorDeLaVista(r.error);
        return;
      }
      setVista(r.vista);
      setPaso("CONFIRMAR");
    } finally {
      setCalculando(false);
    }
  };

  if (paso === "CONFIRMAR") {
    const c = armarLaConfirmacion({ rinde, pasos, lineas }, formulario, vista);
    return (
      <Pila separacion={3}>
        <div className={estilos["resumen"]}>
          <div className={estilos["renglon"]}>
            <span className={estilos["rotulo"]}>{c.rinde.rotulo}</span>
            <span className={estilos["valor"]}>{c.rinde.valor}</span>
          </div>
          {c.costos.map((costo) => (
            <div key={costo.rotulo} className={estilos["renglon"]}>
              <span className={costo.fuerte ? estilos["fuerte"] : estilos["rotulo"]}>
                {costo.rotulo}
              </span>
              <span
                className={`${estilos["valor"] ?? ""} ${costo.fuerte ? (estilos["fuerte"] ?? "") : ""}`}
              >
                {costo.valor}
              </span>
            </div>
          ))}
        </div>
        <Texto como="h2" variante="subtitulo">
          {c.ingredientes.rotulo}
        </Texto>
        <ul className={estilos["lista"]}>
          {c.filas.map((fila) => (
            <li key={fila.clave} className={estilos["fila"]}>
              <span className={estilos["nombre"]}>{fila.nombre}</span>
              <span className={estilos["detalle"]}>{fila.detalle}</span>
            </li>
          ))}
        </ul>
        {c.pasos === null ? null : (
          <>
            <Texto como="h2" variante="subtitulo">
              {c.pasos.rotulo}
            </Texto>
            <p className={estilos["pasos"]}>{c.pasos.texto}</p>
          </>
        )}
        {errorDeGuardar === null ? null : <ErrorDeRespuesta error={errorDeGuardar} />}
        <Boton
          enviando={enviando}
          alTocar={() => {
            void guardar();
          }}
        >
          {textos.guardarComoVersion}
        </Boton>
        <Boton
          variante="secundaria"
          deshabilitado={enviando}
          alTocar={() => {
            setPaso("EDITAR");
          }}
        >
          {textos.volverAEditar}
        </Boton>
      </Pila>
    );
  }

  return (
    <Pila separacion={3}>
      {formulario.productos === null ? null : (
        <Selector
          dato="producto-de-receta"
          etiqueta={textos.producto}
          valor={producto}
          alCambiar={setProducto}
          opciones={formulario.productos}
          textoDeElegir={textos.sinElegir}
        />
      )}
      <CampoNumero
        dato="rinde-de-receta"
        etiqueta={textos.rinde}
        valor={rinde}
        alCambiar={setRinde}
        regla={REGLA_DE_CANTIDAD}
      />
      <h2 className={estilos["titulo"]}>{textos.ingredientes}</h2>
      {lineas.map((l) => {
        const ingrediente = formulario.catalogo[l.ingredienteId];
        return (
          <fieldset key={l.clave} className={estilos["linea"]}>
            <legend>{ingrediente?.nombre ?? ""}</legend>
            <CampoNumero
              dato="bruto-de-ingrediente-de-receta"
              etiqueta={`${textos.bruto} (${ingrediente?.unidad ?? ""})`}
              valor={l.bruto}
              alCambiar={(valor) => {
                cambiar(l.clave, { bruto: valor });
              }}
              regla={REGLA_DE_CANTIDAD}
            />
            <CampoNumero
              dato="merma-de-ingrediente-de-receta"
              etiqueta={`${textos.merma} (%)`}
              valor={l.merma}
              alCambiar={(valor) => {
                cambiar(l.clave, { merma: valor });
              }}
              regla={REGLA_DE_MERMA}
            />
            <div>
              <Boton
                variante="secundaria"
                alTocar={() => {
                  setLineas((actuales) => actuales.filter((x) => x.clave !== l.clave));
                }}
              >
                {textos.quitar}
              </Boton>
            </div>
          </fieldset>
        );
      })}
      <Selector
        dato="ingrediente-de-receta"
        etiqueta={textos.ingredientes}
        valor={aAgregar}
        alCambiar={setAAgregar}
        opciones={disponibles}
        textoDeElegir={textos.sinElegir}
      />
      <div>
        <Boton
          variante="secundaria"
          deshabilitado={aAgregar === "" || !enIngredientesDisponible(disponibles, aAgregar)}
          alTocar={() => {
            setLineas((actuales) => [
              ...actuales,
              { clave: `l${String(siguiente)}`, ingredienteId: aAgregar, bruto: "", merma: "" },
            ]);
            setSiguiente(siguiente + 1);
            setAAgregar("");
          }}
        >
          {textos.agregar}
        </Boton>
      </div>
      <Campo dato="pasos-de-receta" etiqueta={textos.pasos} valor={pasos} alCambiar={setPasos} />
      {errorDeLaVista === null ? null : <ErrorDeRespuesta error={errorDeLaVista} />}
      <Boton
        deshabilitado={!sePuedeGuardar}
        enviando={calculando}
        alTocar={() => {
          void pedirLaConfirmacion();
        }}
      >
        {textos.guardar}
      </Boton>
    </Pila>
  );
}

/** ¿El ingrediente elegido sigue entre los que se pueden agregar? (uno ya agregado no se repite). */
const enIngredientesDisponible = (
  disponibles: readonly Readonly<{ valor: string }>[],
  elegido: string,
): boolean => disponibles.some((o) => o.valor === elegido);
