"use client";

import { useState } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton";
import { Campo } from "../../web/ui/componentes/Campo";
import { CampoDeCodigo } from "../../web/ui/componentes/CampoDeCodigo";
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

/**
 * Manda el código al servidor y devuelve qué hacer. El código de la aplicación vale una sola vez; no hay clave de
 * idempotencia porque repetirlo no es seguro ni necesario: la pantalla impide el doble envío mientras espera.
 */
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

export type PropsDeVerificarCodigo = Readonly<{
  /** A dónde se va cuando el código es bueno (la consola, o la pantalla desde la que se pidió el código). */
  destino: string;
}>;

/** Pantalla 4b: el segundo factor, con la opción del código de recuperación. */
export function VerificarCodigo({ destino }: PropsDeVerificarCodigo) {
  const [modo, setModo] = useState<Modo>("aplicacion");
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        window.location.assign(destino);
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

  return (
    <form
      onSubmit={(evento) => {
        evento.preventDefault();
        void enviar();
      }}
    >
      <Pila separacion={4}>
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
          Verificar
        </Boton>
        <Boton
          variante="secundaria"
          ancho="completo"
          alTocar={cambiarModo}
          deshabilitado={enviando}
        >
          {modo === "aplicacion" ? "Usar un código de recuperación" : "Usar la aplicación"}
        </Boton>
      </Pila>
    </form>
  );
}
