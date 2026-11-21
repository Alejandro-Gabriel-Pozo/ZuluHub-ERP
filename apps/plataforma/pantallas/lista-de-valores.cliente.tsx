"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton.cliente";
import { Campo } from "../../web/ui/componentes/Campo";
import { Insignia } from "../../web/ui/componentes/Insignia";
import { Texto } from "../../web/ui/primitivas/Texto";
import type { ErrorParaLaPantalla } from "../logica/errores-de-plataforma";
import type { NombreDeLista } from "../logica/listas-del-sistema";
import type { ValorParaLaPantalla } from "../logica/cambio-de-lista";
import estilos from "./lista-de-valores.module.css";
import { useCambioDeLista } from "./usar-cambio-de-lista.cliente";

// Textos aprobados el 09/11/2026 (`listas.html`, «Textos nuevos»): Agregar valor · Editar nombre · Desactivar · Reactivar · Desactivado · Fija · Guardar · Así se ve al
// cobrar · Valores · Esta acción no está permitida. «Nombre» es el rótulo del campo; «Cancelar» y «Reintentar» ya están en la consola.
const TEXTO_NO_PERMITIDO = "Esta acción no está permitida";

export type PropsDeListaDeValores = Readonly<{
  lista: NombreDeLista;
  valores: readonly ValorParaLaPantalla[];
  /** Solo una ayuda para apagar los botones: el guard y el segundo factor deciden al enviar. */
  puedeEditar: boolean;
}>;

type Modo =
  Readonly<{ tipo: "AGREGAR" }> | Readonly<{ tipo: "EDITAR"; valor: ValorParaLaPantalla }> | null;

/** El error que va en el formulario: el del campo «Nombre» debajo del campo y todo lo demás arriba, sin códigos técnicos. */
function textoDelError(error: ErrorParaLaPantalla): { campo?: string; general?: string } {
  switch (error.tipo) {
    case "CAMPO":
      return { campo: error.texto };
    case "GENERAL":
    case "PANTALLA_VIEJA":
    case "MARCA_RETIRADA":
      return { general: error.texto };
    default:
      return { general: TEXTO_NO_PERMITIDO };
  }
}

/**
 * Los valores de una lista del sistema: la vista de cómo se ve al cobrar, agregar, corregir el nombre, desactivar y reactivar. Nada se borra. Cada cambio usa una
 * clave de idempotencia por intento y, si el servidor pide el segundo factor reciente, abre la ventana del código y repite el mismo pedido.
 */
export function ListaDeValores({ lista, valores, puedeEditar }: PropsDeListaDeValores) {
  const router = useRouter();
  const [, enTransicion] = useTransition();
  const [modo, setModo] = useState<Modo>(null);
  const [nombre, setNombre] = useState("");
  const { envio, pedir, referenciaIncierta, ventana } = useCambioDeLista();

  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const hecho = estado.tipo === "hecho";
  const bloqueado = !puedeEditar || envio.enCurso || incierto;
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const error = rechazo?.tipo === "ERROR" ? textoDelError(rechazo.error) : null;
  const referencia = rechazo?.tipo === "ERROR" ? rechazo.referencia : referenciaIncierta;

  // Hecho el cambio: la lista se vuelve a pedir al servidor (con las versiones nuevas) y el formulario deja de verse (`formularioAbierto`); el próximo `abrir` lo reinicia.
  useEffect(() => {
    if (!hecho) return;
    enTransicion(() => {
      router.refresh();
    });
  }, [hecho, router]);
  const formularioAbierto = modo !== null && !hecho;

  const abrir = (nuevo: Modo) => {
    envio.reiniciar();
    setNombre(nuevo?.tipo === "EDITAR" ? nuevo.valor.nombre : "");
    setModo(nuevo);
  };

  const guardar = () => {
    if (modo === null) return;
    pedir(
      modo.tipo === "AGREGAR"
        ? { tipo: "AGREGAR", lista, nombre }
        : {
            tipo: "CORREGIR",
            valorId: modo.valor.id,
            nombre,
            versionEsperada: modo.valor.version,
          },
    );
  };

  const activos = valores.filter((v) => v.activo);

  return (
    <div className={estilos["pantalla"]}>
      <section className={estilos["vista"]} aria-label="Así se ve al cobrar">
        <Texto como="h2" variante="subtitulo">
          Así se ve al cobrar
        </Texto>
        <Texto variante="suave">{activos.map((v) => v.nombre).join(" · ")}</Texto>
      </section>

      {puedeEditar ? null : (
        <Aviso tono="info">
          <Texto>{TEXTO_NO_PERMITIDO}</Texto>
        </Aviso>
      )}

      <div className={estilos["cabecera"]}>
        <Texto como="h2" variante="subtitulo">
          Valores
        </Texto>
        <Boton
          alTocar={() => {
            abrir({ tipo: "AGREGAR" });
          }}
          deshabilitado={bloqueado}
        >
          Agregar valor
        </Boton>
      </div>

      {!formularioAbierto ? null : (
        <form
          className={estilos["formulario"]}
          onSubmit={(evento) => {
            evento.preventDefault();
            guardar();
          }}
        >
          <Texto como="h3" variante="subtitulo">
            {modo?.tipo === "AGREGAR" ? "Agregar valor" : "Editar nombre"}
          </Texto>
          <Campo
            dato="nombre-de-valor-de-lista"
            etiqueta="Nombre"
            valor={nombre}
            alCambiar={setNombre}
            autoComplete="off"
            error={error?.campo}
            deshabilitado={envio.enCurso || incierto}
          />
          {error?.general === undefined ? null : (
            <Aviso tono="peligro">
              <Texto>{error.general}</Texto>
            </Aviso>
          )}
          <div className={estilos["botones"]}>
            <Boton
              tipo="submit"
              enviando={envio.enCurso}
              deshabilitado={!envio.enCurso && bloqueado}
            >
              Guardar
            </Boton>
            <Boton
              variante="secundaria"
              alTocar={() => {
                abrir(null);
              }}
              deshabilitado={envio.enCurso}
            >
              Cancelar
            </Boton>
          </div>
        </form>
      )}

      {formularioAbierto || error?.general === undefined ? null : (
        <Aviso tono="peligro">
          <Texto>{error.general}</Texto>
        </Aviso>
      )}
      {incierto && !envio.enCurso ? (
        <div className={estilos["botones"]}>
          <Boton variante="secundaria" alTocar={envio.enviar}>
            Reintentar
          </Boton>
          {referencia === undefined ? null : <Texto>Código de referencia: {referencia}</Texto>}
        </div>
      ) : null}

      <ul className={estilos["valores"]}>
        {valores.map((v) => (
          <li key={v.id} className={estilos["valor"]}>
            <div className={estilos["pastillas"]}>
              <span className={estilos["nombre"]}>
                <Texto variante="subtitulo">{v.nombre}</Texto>
              </span>
              {v.fija ? <Insignia tono="info">Fija</Insignia> : null}
              {v.activo ? null : <Insignia tono="aviso">Desactivado</Insignia>}
            </div>
            <div className={estilos["botones"]}>
              <Boton
                variante="secundaria"
                alTocar={() => {
                  abrir({ tipo: "EDITAR", valor: v });
                }}
                deshabilitado={bloqueado || v.fija}
              >
                Editar nombre
              </Boton>
              <Boton
                variante="secundaria"
                alTocar={() => {
                  pedir({
                    tipo: v.activo ? "DESACTIVAR" : "REACTIVAR",
                    valorId: v.id,
                    versionEsperada: v.version,
                  });
                }}
                deshabilitado={bloqueado || v.fija}
              >
                {v.activo ? "Desactivar" : "Reactivar"}
              </Boton>
            </div>
          </li>
        ))}
      </ul>
      {ventana}
    </div>
  );
}
