"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton";
import { Campo } from "../../web/ui/componentes/Campo";
import { CampoDeCodigo } from "../../web/ui/componentes/CampoDeCodigo";
import { Superposicion } from "../../web/ui/patrones/Superposicion";
import { Pila } from "../../web/ui/primitivas/Pila";
import { Texto } from "../../web/ui/primitivas/Texto";
import {
  esCodigoDeAplicacion,
  esCodigoDeRecuperacion,
  normalizarCodigo,
  resultadoDeVerificacion,
  TEXTO_NEUTRO_DE_INGRESO,
} from "../logica/ingreso";

type Modo = "aplicacion" | "recuperacion";

const ID_DE_LA_DESCRIPCION = "descripcion-de-ventana-de-codigo";

async function verificar(modo: Modo, codigo: string) {
  const ruta = modo === "aplicacion" ? "verify-totp" : "verify-backup-code";
  const respuesta = await fetch(`/api/auth/two-factor/${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: codigo }),
  });
  const cuerpo: unknown = await respuesta.json().catch(() => null);
  return resultadoDeVerificacion(respuesta.status, cuerpo);
}

/**
 * Pide el segundo factor en el momento de una acción sensible, sin sacar a la persona de la pantalla.
 * `pedirCodigo()` abre la ventana y devuelve una promesa: true cuando el código se verificó, false si cancela
 * (Escape, la cruz o «Cancelar»). Si la sesión venció, lleva al ingreso. `ventana` hay que pintarla en la pantalla.
 */
export function useVentanaDeCodigo(): { pedirCodigo: () => Promise<boolean>; ventana: ReactNode } {
  const [abierta, setAbierta] = useState(false);
  const [modo, setModo] = useState<Modo>("aplicacion");
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((verificado: boolean) => void) | null>(null);

  const pedirCodigo = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        // Si ya había un pedido abierto, se lo da por cancelado: nunca queda una promesa colgada.
        resolver.current?.(false);
        resolver.current = resolve;
        setModo("aplicacion");
        setCodigo("");
        setError(null);
        setEnviando(false);
        setAbierta(true);
      }),
    [],
  );

  function terminar(verificado: boolean) {
    setAbierta(false);
    const resolve = resolver.current;
    resolver.current = null;
    resolve?.(verificado);
  }

  const normalizado = normalizarCodigo(codigo);
  const completo =
    modo === "aplicacion" ? esCodigoDeAplicacion(normalizado) : esCodigoDeRecuperacion(normalizado);

  async function enviar() {
    if (enviando || !completo) return;
    setEnviando(true);
    setError(null);
    try {
      const resultado = await verificar(modo, normalizado);
      if (resultado.tipo === "ok") {
        setEnviando(false);
        terminar(true);
        return;
      }
      if (resultado.tipo === "ir") {
        window.location.assign(resultado.destino);
        return;
      }
      setError(resultado.texto);
    } catch {
      setError(TEXTO_NEUTRO_DE_INGRESO);
    }
    setEnviando(false);
  }

  function cambiarModo() {
    setModo(modo === "aplicacion" ? "recuperacion" : "aplicacion");
    setCodigo("");
    setError(null);
  }

  const ventana = (
    <Superposicion
      abierta={abierta}
      titulo="Confirmá que sos vos"
      proposito="confirmar"
      cerrable={!enviando}
      etiquetaDeCerrar="Cancelar"
      idDeLaDescripcion={ID_DE_LA_DESCRIPCION}
      alCerrar={() => {
        terminar(false);
      }}
    >
      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          void enviar();
        }}
      >
        <Pila separacion={4}>
          <Texto id={ID_DE_LA_DESCRIPCION}>
            Esta acción es sensible. Ingresá el código de tu aplicación de autenticación.
          </Texto>
          {error === null ? null : (
            <Aviso tono="peligro">
              <Texto>{error}</Texto>
            </Aviso>
          )}
          {modo === "aplicacion" ? (
            <CampoDeCodigo
              etiqueta="Código de la aplicación"
              ayuda="Los seis números que muestra tu aplicación de autenticación."
              valor={codigo}
              alCambiar={setCodigo}
              deshabilitado={enviando}
            />
          ) : (
            <Campo
              etiqueta="Código de recuperación"
              ayuda="Uno de los códigos que guardaste al configurar el segundo factor. Sirve una sola vez."
              valor={codigo}
              alCambiar={setCodigo}
              autoComplete="off"
              autoCapitalize="off"
              deshabilitado={enviando}
            />
          )}
          <Boton
            tipo="submit"
            ancho="completo"
            deshabilitado={!completo}
            enviando={enviando}
            textoEnviando="Verificando…"
          >
            Confirmar
          </Boton>
          <Boton
            variante="secundaria"
            ancho="completo"
            alTocar={cambiarModo}
            deshabilitado={enviando}
          >
            {modo === "aplicacion" ? "Usar un código de recuperación" : "Usar la aplicación"}
          </Boton>
          <Boton
            variante="secundaria"
            ancho="completo"
            deshabilitado={enviando}
            alTocar={() => {
              terminar(false);
            }}
          >
            Cancelar
          </Boton>
        </Pila>
      </form>
    </Superposicion>
  );

  return { pedirCodigo, ventana };
}
