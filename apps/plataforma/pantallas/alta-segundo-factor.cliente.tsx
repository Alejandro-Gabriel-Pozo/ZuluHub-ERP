"use client";

import { useState } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton";
import { CampoDeCodigo } from "../../web/ui/componentes/CampoDeCodigo";
import { Pila } from "../../web/ui/primitivas/Pila";
import { Texto } from "../../web/ui/primitivas/Texto";
import { datosDelAlta, secretoEnGrupos, type DatosDelAlta } from "../logica/alta";
import {
  esCodigoDeAplicacion,
  normalizarCodigo,
  resultadoDeVerificacion,
  TEXTO_NEUTRO_DE_INGRESO,
} from "../logica/ingreso";

/** Dibuja el QR ya validado con elementos propios (la web no pinta HTML crudo). */
function CodigoQr({ lado, trazo }: Readonly<{ lado: number; trazo: string }>) {
  return (
    <svg
      viewBox={`0 0 ${lado} ${lado}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Código QR para la aplicación autenticadora"
      width="240"
      height="240"
    >
      <rect width={lado} height={lado} fill="#ffffff" />
      <path d={trazo} fill="#000000" />
    </svg>
  );
}

/**
 * Pantalla 4c: el segundo factor la primera vez, todo en una pantalla (QR dibujado en el servidor, clave en texto,
 * códigos de recuperación UNA sola vez y confirmación de que se guardaron). El secreto y los códigos viven solo en la
 * memoria de este componente: no van a almacenamiento del navegador ni a ningún registro.
 */
export function AltaDelSegundoFactor() {
  const [datos, setDatos] = useState<DatosDelAlta | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [guardados, setGuardados] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function empezar() {
    if (pidiendo) return;
    setPidiendo(true);
    setError(null);
    try {
      const respuesta = await fetch("/api/auth/two-factor/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      const cuerpo: unknown = await respuesta.json().catch(() => null);
      if (respuesta.ok) {
        const alta = datosDelAlta(cuerpo);
        if (alta === null) {
          setError(TEXTO_NEUTRO_DE_INGRESO);
        } else {
          setDatos(alta);
          return;
        }
      } else {
        const resultado = resultadoDeVerificacion(respuesta.status, cuerpo);
        if (resultado.tipo === "ir") {
          window.location.assign(resultado.destino);
          return;
        }
        setError(TEXTO_NEUTRO_DE_INGRESO);
      }
    } catch {
      setError(TEXTO_NEUTRO_DE_INGRESO);
    }
    setPidiendo(false);
  }

  async function confirmar() {
    const normalizado = normalizarCodigo(codigo);
    if (verificando || !guardados || !esCodigoDeAplicacion(normalizado)) return;
    setVerificando(true);
    setError(null);
    try {
      const respuesta = await fetch("/api/auth/two-factor/verify-totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalizado }),
      });
      const cuerpo: unknown = await respuesta.json().catch(() => null);
      const resultado = resultadoDeVerificacion(respuesta.status, cuerpo);
      if (resultado.tipo === "error") {
        setError(resultado.texto);
      } else {
        window.location.assign(resultado.tipo === "ok" ? "/" : resultado.destino);
        return;
      }
    } catch {
      setError(TEXTO_NEUTRO_DE_INGRESO);
    }
    setVerificando(false);
  }

  const aviso =
    error === null ? null : (
      <Aviso tono="peligro">
        <Texto>{error}</Texto>
      </Aviso>
    );

  if (datos === null) {
    return (
      <Pila separacion={4}>
        {aviso}
        <Texto>
          Para entrar a la consola necesitás un segundo factor: una aplicación de autenticación en
          tu celular que da un código de seis números cada 30 segundos.
        </Texto>
        <Boton
          ancho="completo"
          enviando={pidiendo}
          textoEnviando="Preparando…"
          alTocar={() => void empezar()}
        >
          Configurar el segundo factor
        </Boton>
      </Pila>
    );
  }

  return (
    <form
      onSubmit={(evento) => {
        evento.preventDefault();
        void confirmar();
      }}
    >
      <Pila separacion={5}>
        {aviso}
        <Pila separacion={2}>
          <Texto como="h2" variante="subtitulo">
            1. Escaneá el código
          </Texto>
          {datos.dibujo === null ? null : (
            <CodigoQr lado={datos.dibujo.lado} trazo={datos.dibujo.trazo} />
          )}
          <Texto variante="chico">
            Si no podés escanearlo, cargá esta clave a mano en la aplicación:
          </Texto>
          <Texto>
            <strong translate="no">{secretoEnGrupos(datos.secreto)}</strong>
          </Texto>
        </Pila>
        <Pila separacion={2}>
          <Texto como="h2" variante="subtitulo">
            2. Guardá los códigos de recuperación
          </Texto>
          <Texto variante="chico">
            Se muestran una sola vez. Cada uno sirve una vez, si perdés el celular. Guardalos en un
            lugar seguro.
          </Texto>
          <ul aria-label="Códigos de recuperación" translate="no">
            {datos.codigosDeRecuperacion.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <label>
            <input
              type="checkbox"
              checked={guardados}
              onChange={(evento) => {
                setGuardados(evento.target.checked);
              }}
            />{" "}
            Guardé los códigos de recuperación
          </label>
        </Pila>
        <Pila separacion={2}>
          <Texto como="h2" variante="subtitulo">
            3. Confirmá con un código
          </Texto>
          <CampoDeCodigo
            etiqueta="Código de la aplicación"
            valor={codigo}
            alCambiar={setCodigo}
            deshabilitado={verificando}
          />
          <Boton
            tipo="submit"
            ancho="completo"
            deshabilitado={!guardados || !esCodigoDeAplicacion(normalizarCodigo(codigo))}
            motivo={
              guardados ? undefined : "Primero confirmá que guardaste los códigos de recuperación."
            }
            enviando={verificando}
            textoEnviando="Verificando…"
          >
            Confirmar y entrar
          </Boton>
        </Pila>
      </Pila>
    </form>
  );
}
